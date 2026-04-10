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
import { registerAllProviders, LLMProviderFactory } from '../llm/index.js';
import { AgentRuntime } from '../agent/runtime.js';
import { createEmbeddingProvider } from '../memory/embeddings.js';
import { initializeMCP, shutdownMCP } from '../agent/mcp/runtime.js';
import { initMCPPersistence } from './services/mcpService.js';

import { TaskQueue, BackgroundWorker, TaskPriority } from '../autonomous/index.js';
import { FeedbackManager } from '../autonomous/urgeFilter.js';
import { SubAgentManager } from '../autonomous/curiosityEngine.js';
import { SemanticRouter } from '../router/semantic.js';
import { logger, runWithTraceId } from '../utils/logger.js';
import { registerRoutes } from './routes.js';
import { setupWebSocket } from './websocket.js';
import { registerSystemJobs } from './jobs/systemTasks.js';
import { registerAutonomousWorkerJobs } from './jobs/autonomousWorker.js';
import {
    attachDashboardWebSocketUpgrade,
    createDashboardAuthMiddleware,
    registerRequestTracing,
    resolveGatewayPublicDir,
} from './bootstrap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

    // 2. Veritabanı — embedding boyutunu provider'dan al
    const embeddingProbe = createEmbeddingProvider();
    const embeddingDimensions = embeddingProbe?.dimensions ?? 1536;
    const database = new PenceDatabase(config.dbPath, embeddingDimensions);
    const memory = new MemoryManager(database);
    logger.info(`[Gateway] 💾 Veritabanı hazır: ${config.dbPath} (embedding dim=${embeddingDimensions})`);

    // MCP Persistence — Marketplace server'larını veritabanından yükle
    await initMCPPersistence(config.dbPath);

    // 3. LLM Provider
    registerAllProviders();
    let llm;
    try {
        llm = await LLMProviderFactory.create(config.defaultLLMProvider);
        logger.info(`[Gateway] 🤖 LLM Provider: ${llm.name}`);

        // Model doğrulaması — config'deki model bu provider'da destekleniyor mu?
        const configModel = config.defaultLLMModel;
        if (llm.supportedModels.length > 0 && !llm.supportedModels.includes(configModel)) {
            logger.warn(`[Gateway] ⚠️  DEFAULT_LLM_MODEL="${configModel}" ${llm.name} provider'ı tarafından desteklenmiyor!`);
            logger.warn(`[Gateway] 💡 Desteklenen bazı modeller: ${llm.supportedModels.slice(0, 8).join(', ')}`);
            logger.warn(`[Gateway] ℹ️  Provider varsayılan modeli kullanılacak: ${llm.supportedModels[0]}`);
        } else {
            logger.info(`[Gateway] ✅ Model doğrulandı: ${configModel}`);
        }
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

    // 4.5 Autonomous Sub-system Managers
    const feedbackManager = new FeedbackManager(database.getDb());
    const subAgentManager = new SubAgentManager(database.getDb());

    // AgentRuntime'a Feedback Manager'ı bağla ki message events (read/reply vb) yakalansın.
    agent.setAutonomousManagers(feedbackManager);

    // ============ EXPRESS & WSS INIT ============
    const app = express();
    const server = createServer(app);
    const wss = new WebSocketServer({ noServer: true });

    // 4.6 Autonomous Worker (With SQLite Checkpointing)
    const taskQueue = new TaskQueue(database.getDb());
    const autonomousWorker = new BackgroundWorker(taskQueue);
    logger.info(`[Gateway] ⚙️ Autonomous Background Worker and Persistent Priority Queue initialized`);

    // Background jobs ayrıştırıldı
    registerSystemJobs(taskQueue, { memory, agent, broadcastStats });
    registerAutonomousWorkerJobs(taskQueue, { memory, llm, feedbackManager, subAgentManager, wss, config });

    memory.setTaskQueue(taskQueue);
    agent.setTaskQueue(taskQueue);

    taskQueue.loadPendingTasks();

    // Uygulama başladığında ilk tik çalışsın
    taskQueue.enqueue({ id: `auto_tick_${Date.now()}`, type: 'autonomous_tick', priority: TaskPriority.P3_NORMAL, payload: {}, addedAt: Date.now() + 5000 });

    // 5. Message & Semantic Routers
    const router = new MessageRouter();
    const semanticRouter = new SemanticRouter(0.82);

    // Register basic local intents to test 0-latency routing
    semanticRouter.registerIntent({
        name: 'clear_queue',
        description: 'Bekleyen otonom görevleri temizler',
        examples: ['kuyruğu temizle', 'görevleri durdur', 'bütün işleri iptal et', 'arkaplan işlerini sil'],
        action: async (msg) => {
            taskQueue.clear();
            return '✅ Arka plan görev kuyruğu başarıyla temizlendi ve sıfırlandı.';
        }
    });

    semanticRouter.registerIntent({
        name: 'worker_status',
        description: 'Arka plan işçisinin durumunu raporlar',
        examples: ['durum nedir', 'worker durumu', 'kuyrukta kaç iş var', 'ajan ne yapıyor'],
        action: async (msg) => {
            return `⚙️ Otonom Worker Durumu:\n- Bekleyen Görev Sayısı: ${taskQueue.length}`;
        }
    });

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

    // broadcastStats — debounce ile flood önleme (#19)
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

    // ============ Kanalları Bağla ============

    // Router'dan gelen mesajları Agent'a yönlendir
    router.onMessage(async (message) => {
        try {
            await runWithTraceId(async () => {
                const { response } = await agent.processMessage(message);
                await router.sendResponse(message.channelType, message.channelId, {
                    content: response,
                });
            });
        } catch (err: any) {
            logger.error({ err }, `[Gateway] Mesaj işleme hatası`);
            await router.sendResponse(message.channelType, message.channelId, {
                content: `⚠️ Hata: ${err.message}`,
            });
        }
    });

    // TODO: Telegram, Discord, WhatsApp kanallarını bağla (Faz 2)

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
        logger.info(`\n[Gateway] 🚀 PençeAI çalışıyor!`);
        logger.info(`[Gateway] 🌐 Dashboard: http://${config.host}:${config.port}`);
        logger.info(`[Gateway] 📡 WebSocket: ws://${config.host}:${config.port}/ws`);
        logger.info(`[Gateway] 💡 API: http://${config.host}:${config.port}/api/health\n`);
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
