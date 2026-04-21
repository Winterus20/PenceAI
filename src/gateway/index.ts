import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';


import { getConfig, loadConfig } from './config.js';

import { PenceDatabase } from '../memory/database.js';
import { MemoryManager } from '../memory/manager.js';
import { MessageRouter } from '../router/index.js';
import { registerAllProviders, LLMProviderFactory, LLMProvider } from '../llm/index.js';
import { AgentRuntime } from '../agent/runtime.js';
import { createEmbeddingProvider } from '../memory/embeddings.js';
import { initializeMCP, shutdownMCP } from '../agent/mcp/runtime.js';
import { initMCPPersistence } from './services/mcpService.js';
import { metricsCollector } from '../observability/metricsCollector.js';

import { TaskQueue, BackgroundWorker, TaskPriority } from '../autonomous/index.js';
import { FeedbackManager } from '../autonomous/urgeFilter.js';
import { SubAgentManager } from '../autonomous/curiosityEngine.js';
import { SemanticRouter } from '../router/semantic.js';
import { logger, runWithTraceId } from '../utils/index.js';
import { registerRoutes } from './routes.js';
import { setupWebSocket } from './websocket.js';
import { registerLocalIntents } from './intents.js';
import { registerSystemJobs } from './jobs/systemTasks.js';
import { registerAutonomousWorkerJobs } from './jobs/autonomousWorker.js';
import {
    attachDashboardWebSocketUpgrade,
    createDashboardAuthMiddleware,
    registerRequestTracing,
    resolveGatewayPublicDir,
} from './bootstrap.js';

import { DiscordChannel } from './channels/discord.js';

// GraphRAG imports
import { GraphCache } from '../memory/graphRAG/GraphCache.js';
import { GraphExpander } from '../memory/graphRAG/GraphExpander.js';
import { PageRankScorer } from '../memory/graphRAG/PageRankScorer.js';
import { CommunityDetector } from '../memory/graphRAG/CommunityDetector.js';
import { CommunitySummarizer } from '../memory/graphRAG/CommunitySummarizer.js';
import { GraphRAGEngine } from '../memory/graphRAG/GraphRAGEngine.js';

import { GraphWorker } from '../memory/graphRAG/GraphWorker.js';
import { GraphRAGConfigManager, DEFAULT_GRAPH_RAG_CONFIG } from '../memory/graphRAG/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ═══════════════════════════════════════════════════════════
//  Bootstrap Helpers
// ═══════════════════════════════════════════════════════════

async function bootstrapDatabase(): Promise<{ database: PenceDatabase; memory: MemoryManager; embeddingProvider: ReturnType<typeof createEmbeddingProvider> }> {
    const embeddingProvider = createEmbeddingProvider();
    const embeddingDimensions = embeddingProvider?.dimensions ?? 1536;
    const config = getConfig();
    const database = new PenceDatabase(config.dbPath, embeddingDimensions);
    const memory = new MemoryManager(database);
    logger.info(`[Gateway] 💾 Veritabanı hazır: ${config.dbPath} (embedding dim=${embeddingDimensions})`);
    metricsCollector.setDatabase(database.getDb());
    await initMCPPersistence(config.dbPath);
    return { database, memory, embeddingProvider };
}

function bootstrapLLM(): LLMProvider {
    registerAllProviders();
    const config = getConfig();
    const llm = LLMProviderFactory.create(config.defaultLLMProvider);
    logger.info(`[Gateway] 🤖 LLM Provider: ${llm.name}`);

    const configModel = config.defaultLLMModel;
    if (llm.supportedModels.length > 0 && !llm.supportedModels.includes(configModel)) {
        logger.warn(`[Gateway] ⚠️  DEFAULT_LLM_MODEL="${configModel}" ${llm.name} provider'ı tarafından desteklenmiyor!`);
        logger.warn(`[Gateway] 💡 Desteklenen bazı modeller: ${llm.supportedModels.slice(0, 8).join(', ')}`);
        logger.warn(`[Gateway] ℹ️  Provider varsayılan modeli kullanılacak: ${llm.supportedModels[0]}`);
    } else {
        logger.info(`[Gateway] ✅ Model doğrulandı: ${configModel}`);
    }
    return llm;
}

async function main() {
    logger.info(`
  ╔══════════════════════════════════════╗
  ║         🐾  PençeAI  v0.1.0         ║
  ║   Self-Hosted AI Agent Platform      ║
  ╚══════════════════════════════════════╝
  `);

    // 1. Konfigürasyon
    const config = loadConfig();
    logger.info(`[Gateway] ⚙️  Port: ${config.port} | Provider: ${config.defaultLLMProvider} | Model: ${config.defaultLLMModel}`);

    // 2. Veritabanı
    const { database, memory, embeddingProvider } = await bootstrapDatabase();

    // 3. LLM Provider
    let llm: LLMProvider;
    try {
        llm = bootstrapLLM();
    } catch (err: any) {
        logger.error(`[Gateway] ❌ LLM Provider başlatılamadı: ${err.message}`);
        logger.error(`[Gateway] 💡 .env dosyanızda API anahtarını ayarlayın. Kopya: cp .env.example .env`);
        process.exit(1);
    }

    // 3.5 MCP Initialization
    const { getInstalledServers } = await import('./services/mcpService.js');
    const activeServers = getInstalledServers()
        .filter(s => s.status === 'active')
        .map(s => ({
            name: s.name,
            command: s.command,
            args: s.args,
            env: s.env,
            cwd: s.cwd,
            timeout: s.timeout,
        }));
    
    const mcpManager = await initializeMCP(activeServers);
    if (mcpManager) {
        logger.info(`[Gateway] 🔌 MCP Runtime initialized — ${mcpManager.connectedServerCount} server(s), ${mcpManager.totalToolCount} tool(s)`);
    }

    // 4. Agent Runtime
    const agent = new AgentRuntime(llm, memory);
    logger.info(`[Gateway] 🧠 Agent Runtime hazır`);

    // 4.1 GraphRAG Initialization
    const graphRAGConfig = GraphRAGConfigManager.getConfig();
    logger.info(`[Gateway] 🕸️ GraphRAG initializing: enabled=${graphRAGConfig.enabled}, phase=${GraphRAGConfigManager.getCurrentPhase()}`);

    // Initialize GraphRAG (optional — agent/memory work without it)
    let graphRAGComponents: { engine: GraphRAGEngine; worker: GraphWorker } | null = null;
    try {
        const db = database.getDb();
        const graphCache = new GraphCache(db);
        const graphExpander = new GraphExpander(db, graphCache);
        const pageRankScorer = new PageRankScorer(db);
        const communityDetector = new CommunityDetector(db);
        const communitySummarizer = new CommunitySummarizer(db, llm);

        const hybridSearchFn = async (query: string, limit: number) => {
            try {
                const results = await memory.hybridSearch(query, limit);
                return results;
            } catch (err) {
                logger.warn({ err }, '[Gateway] GraphRAG hybrid search failed:');
                return [];
            }
        };

        const graphRAGEngine = new GraphRAGEngine(
            db, graphExpander, pageRankScorer, communityDetector,
            communitySummarizer, graphCache, hybridSearchFn, llm,
            {
                maxHops: graphRAGConfig.maxHops,
                maxExpandedNodes: graphRAGConfig.sampleRate === 1.0 ? 100 : 50,
                minConfidence: 0.3,
                usePageRank: graphRAGConfig.usePageRank,
                useCommunities: graphRAGConfig.useCommunities,
                useCache: true,
                tokenBudget: graphRAGConfig.tokenBudget,
                communitySummaryBudget: Math.floor(graphRAGConfig.tokenBudget * 0.25),
                timeoutMs: graphRAGConfig.timeoutMs,
                fallbackToStandardSearch: graphRAGConfig.fallbackEnabled,
                rrfKConstant: graphRAGConfig.rrfKConstant,
                memoryImportanceWeight: graphRAGConfig.memoryImportanceWeight,
                memoryAccessCountWeight: graphRAGConfig.memoryAccessCountWeight,
                memoryConfidenceWeight: graphRAGConfig.memoryConfidenceWeight,
                searchMode: graphRAGConfig.useGlobalSearch ? 'auto' : 'local',
                globalSearchTopK: graphRAGConfig.globalSearchTopK,
                globalSearchLevel: graphRAGConfig.globalSearchLevel,
            },
        );

        agent.setGraphRAGComponents(graphRAGEngine);
        memory.setGraphRAGEngine(graphRAGEngine);
        memory.setConfidenceThreshold();

        // Semantic Top-K: GlobalSearchEngine'e embedding provider bağla (bootstrap'ten reuse)
        if (embeddingProvider) {
            graphRAGEngine.setEmbeddingProvider(embeddingProvider);
            logger.info('[Gateway] ✅ GlobalSearchEngine semantic Top-K enabled (embedding provider connected)');
        }

        const { ResponseVerifier } = await import('../memory/retrieval/ResponseVerifier.js');
        const agenticVerifier = new ResponseVerifier(llm, {
            supportFloor: config.agenticRAGVerificationSupportFloor,
            utilityFloor: config.agenticRAGVerificationUtilityFloor,
            maxRegenerations: config.agenticRAGMaxRegenerations,
        });
        agent.setAgenticRAGVerifier(agenticVerifier, config.agenticRAGMaxRegenerations);

        const graphWorker = new GraphWorker(
            db, pageRankScorer, communityDetector, communitySummarizer, graphCache,
        );
        graphWorker.start();
        logger.info(`[Gateway] ✅ GraphRAG Background Worker started`);

        graphRAGComponents = { engine: graphRAGEngine, worker: graphWorker };
    } catch (err) {
        logger.warn({ err }, '[Gateway] GraphRAG init failed, continuing without it');
    }

    // 4.5 Autonomous Sub-system Managers
    const feedbackManager = new FeedbackManager(database.getDb());
    const subAgentManager = new SubAgentManager(database.getDb());

    // AgentRuntime'a Feedback Manager'ı bağla ki message events (read/reply vb) yakalansın.
    agent.setAutonomousManagers(feedbackManager);

    // ============ EXPRESS & WSS INIT ============
    const app = express();
    const server = createServer(app);
    const wss = new WebSocketServer({ noServer: true });

    // broadcastStats — debounce ile flood önleme
    let statsDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    function broadcastStats() {
        if (statsDebounceTimer) clearTimeout(statsDebounceTimer);
        statsDebounceTimer = setTimeout(() => {
            const stats = memory.getStats();
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'stats', stats }));
                }
            });
        }, 500);
    }

    // 4.6 Autonomous Worker (With SQLite Checkpointing)
    const taskQueue = new TaskQueue(database.getDb());
    const autonomousWorker = new BackgroundWorker(taskQueue);
    logger.info(`[Gateway] ⚙️ Autonomous Background Worker and Persistent Priority Queue initialized`);

    // Background jobs ayrıştırıldı
    registerSystemJobs(taskQueue, { memory, agent, broadcastStats });
    registerAutonomousWorkerJobs(taskQueue, { memory, llm, feedbackManager, subAgentManager, wss, config, worker: autonomousWorker });

    memory.setTaskQueue(taskQueue);
    agent.setTaskQueue(taskQueue);

    taskQueue.loadPendingTasks();

    // Uygulama başladığında ilk tik çalışsın
    taskQueue.enqueue({ id: `auto_tick_${Date.now()}`, type: 'autonomous_tick', priority: TaskPriority.P3_NORMAL, payload: {}, addedAt: Date.now() + 5000 });

    // 5. Message & Semantic Routers
    const router = new MessageRouter();
    const semanticRouter = new SemanticRouter(0.82);

    // Register basic local intents to test 0-latency routing
    registerLocalIntents(semanticRouter, taskQueue, TaskPriority);
    logger.info(`[Gateway] 🧠 Semantic Router hazır (Lokal Niyet Algılama Aktif)`);

    // 6. Express (WebSocket zaten init edildi)
    attachDashboardWebSocketUpgrade(server, wss, config.dashboardPassword);

    // Static dosyalar (Dashboard)
    app.use(cors());

    // Dashboard şifre koruması (DASHBOARD_PASSWORD ayırlanmışsa)
    app.use(createDashboardAuthMiddleware(config.dashboardPassword));

    const publicDir = resolveGatewayPublicDir(__dirname);
    app.use(express.static(publicDir));
    app.use(express.json());

    registerRequestTracing(app, () => {
        autonomousWorker.registerUserActivity();
    });

    // ============ REST API & SPA ============

    registerRoutes(app, { memory, llm, router, agent, broadcastStats });

    app.get('*', (_req, res) => {
        res.sendFile(path.join(publicDir, 'index.html'));
    });

    // ============ WebSocket ============

    setupWebSocket(wss, { memory, agent, semanticRouter, autonomousWorker, broadcastStats });

    // ============ Kanalları Bağla ============

    // Router'dan gelen mesajları Agent'a yönlendir
    router.onMessage(async (message) => {
        try {
            await runWithTraceId(async () => {
                const { response } = await agent.processMessage(message);
                if (response && response.trim() !== '') {
                    await router.sendResponse(message.channelType, message.channelId, {
                        content: response,
                    });
                }
            });
        } catch (err: any) {
            logger.error({ err }, `[Gateway] Mesaj işleme hatası`);
            await router.sendResponse(message.channelType, message.channelId, {
                content: `⚠️ Hata: ${err.message}`,
            });
        }
    });

    // TODO: Telegram, WhatsApp kanallarını bağla (Faz 2)
    if (config.discordBotToken) {
        const discordChannel = new DiscordChannel(config.discordBotToken, config.discordAllowedUsers);
        router.registerChannel(discordChannel);
    }

    // Eklenen dış kanalların WebSocket/REST'den bağımsız bağlantılarını başlat
    await router.connectAll();

    // ============ Bellek Bakımı (Decay) ============

    // Enqueue an initial memory maintenance task 
    taskQueue.enqueue({
        id: `decay_init_${Date.now()}`,
        type: 'memory_decay',
        priority: TaskPriority.P3_NORMAL,
        payload: {},
        addedAt: Date.now()
    });

    // Her 24 saatte bir çalışması için düzenli kontrol
    const DECAY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 saat
    const decayTimer = setInterval(() => {
        taskQueue.enqueue({
            id: `decay_scheduled_${Date.now()}`,
            type: 'memory_decay',
            priority: TaskPriority.P3_NORMAL,
            payload: {},
            addedAt: Date.now()
        });
    }, DECAY_INTERVAL_MS);
    decayTimer.unref(); // Process exit'i engelleme — shutdown sırasında temizlenmese bile

    // Embedding'i eksik bellekleri arka planda tamamla (P4_LOW)
    taskQueue.enqueue({
        id: `embedding_backfill_${Date.now()}`,
        type: 'embedding_backfill',
        priority: TaskPriority.P4_LOW,
        payload: {},
        addedAt: Date.now()
    });

    // ============ Sunucuyu Başlat ============

    autonomousWorker.start();

    server.listen(config.port, config.host, () => {
        const displayHost = config.host === '0.0.0.0' ? 'localhost' : config.host;
        logger.info(`\n[Gateway] 🚀 PençeAI çalışıyor!`);
        logger.info(`[Gateway] 🌐 Dashboard: http://${displayHost}:${config.port}`);
        logger.info(`[Gateway] 📡 WebSocket: ws://${displayHost}:${config.port}/ws`);
        logger.info(`[Gateway] 💡 API: http://${displayHost}:${config.port}/api/health\n`);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
            logger.error(`[Gateway] ❌ Port ${config.port} zaten kullanımda!`);
            logger.error(`[Gateway] 💡 Çözüm seçenekleri:`);
            logger.error(`[Gateway]    1) .env dosyasında PORT değerini değiştirin (örn: PORT=3001)`);
            logger.error(`[Gateway]    2) Portu kullanan süreci bulup kapatın:`);
            logger.error(`[Gateway]       Windows: netstat -ano | findstr :${config.port}  →  taskkill /PID <PID> /F`);
            logger.error(`[Gateway]       Linux/Mac: lsof -ti:${config.port} | xargs kill -9`);
        } else {
            logger.error({ err }, '[Gateway] ❌ Sunucu hatası');
        }
        autonomousWorker.stop();
        database.close();
        process.exit(1);
    });

    // Graceful shutdown
    const shutdown = async () => {
        logger.info('\n[Gateway] 🛑 Kapatılıyor...');
        if (statsDebounceTimer) clearTimeout(statsDebounceTimer);
        clearInterval(decayTimer);
        
        // Stop GraphRAG worker
        try {
            if (graphRAGComponents?.worker) {
                graphRAGComponents.worker.stop();
                logger.info('[Gateway] 🕸️ GraphRAG Worker stopped');
            }
        } catch (err) {
            logger.warn({ err }, '[Gateway] GraphRAG Worker shutdown error:');
        }
        
        autonomousWorker.stop();
        try {
            await router.disconnectAll();
        } catch (err) {
            logger.error({ err }, '[Gateway] Kanal kapatma hatası');
        }
        // MCP shutdown
        await shutdownMCP();
        database.close();
        server.close(() => {
            logger.info('[Gateway] ✅ Sunucu kapatıldı.');
            process.exit(0);
        });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch(err => {
    logger.error({ err }, 'PençeAI başlatılamadı');
    process.exit(1);
});
