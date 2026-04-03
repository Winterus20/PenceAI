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

import { TaskQueue, BackgroundWorker, TaskPriority } from '../autonomous/index.js';
import { FeedbackManager, filterThought } from '../autonomous/urgeFilter.js';
import { SubAgentManager } from '../autonomous/curiosityEngine.js';
import { think } from '../autonomous/thinkEngine.js';
import { SemanticRouter } from '../router/semantic.js';
import { logger, runWithTraceId } from '../utils/logger.js';
import { registerRoutes } from './routes.js';
import { setupWebSocket } from './websocket.js';
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

    // 4. Agent Runtime
    const agent = new AgentRuntime(llm, memory);
    logger.info(`[Gateway] 🧠 Agent Runtime hazır`);

    // 4.5 Autonomous Sub-system Managers
    const feedbackManager = new FeedbackManager(database.getDb());
    const subAgentManager = new SubAgentManager(database.getDb());

    // AgentRuntime'a Feedback Manager'ı bağla ki message events (read/reply vb) yakalansın.
    agent.setAutonomousManagers(feedbackManager);

    // 4.6 Autonomous Worker (With SQLite Checkpointing)
    const taskQueue = new TaskQueue(database.getDb());
    const autonomousWorker = new BackgroundWorker(taskQueue);
    logger.info(`[Gateway] ⚙️ Autonomous Background Worker and Persistent Priority Queue initialized`);

    taskQueue.registerHandler('memory_decay', async (payload, signal) => {
        if (signal.aborted) return;
        try {
            const result = memory.decayMemories();
            if (result.decayed > 0 || result.archived > 0) {
                logger.info(`[Worker] 🧹 Bellek bakımı: ${result.decayed} azaltıldı, ${result.archived} arşivlendi`);
            }
            const relResult = memory.decayRelationships();
            if (relResult.pruned > 0) {
                logger.info(`[Worker] 🧹 İlişki bakımı: ${relResult.pruned} zayıf ilişki temizlendi`);
            }
            broadcastStats();
        } catch (err) {
            logger.error({ err }, '[Worker] Bellek/İlişki bakımı hatası');
        }
    });

    taskQueue.registerHandler('embedding_backfill', async (payload, signal) => {
        if (signal.aborted) return;
        try {
            const count = await memory.ensureAllEmbeddings();
            if (count > 0) {
                logger.info(`[Worker] 🔢 ${count} bellek için embedding hesaplandı (backfill)`);
            }

            if (signal.aborted) return;
            const relCount = await memory.ensureAllMemoryGraphRelations();
            if (relCount && relCount > 0) {
                logger.info(`[Worker] 🔗 ${relCount} bellek için graf ilişkisi oluşturuldu (backfill)`);
            }

            if (signal.aborted) return;
            const msgCount = await memory.ensureAllMessageEmbeddings();
            if (msgCount && msgCount > 0) {
                logger.info(`[Worker] 🔢 ${msgCount} mesaj için embedding hesaplandı (backfill)`);
            }
        } catch (err) {
            logger.warn({ err }, '[Worker] Embedding/Graph backfill hatası');
        }
    });

    // Ebbinghaus stability güncellemeleri — searchMemories'den enqueue edilen ID'leri toplu işle
    taskQueue.registerHandler('ebbinghaus_update', async (payload, signal) => {
        if (signal.aborted) return;
        try {
            const memoryIds: number[] = payload.memoryIds ?? [];
            if (memoryIds.length > 0) {
                memory.executeEbbinghausUpdates(memoryIds);
            }
        } catch (err) {
            logger.warn({ err }, '[Worker] Ebbinghaus güncelleme hatası');
        }
    });

    // MemoryManager'a TaskQueue referansını bağla — Ebbinghaus update'leri artık worker'a gider
    memory.setTaskQueue(taskQueue);

    // AgentRuntime'a TaskQueue bağla — arka plan LLM görevleri kuyruğa alınır
    agent.setTaskQueue(taskQueue);

    // OPT-3: Derin bellek çıkarımı handler'ı — TaskQueue üzerinden çalışır
    taskQueue.registerHandler('deep_memory_extraction', async (payload, signal) => {
        if (signal.aborted) return;
        try {
            await agent.extractMemoriesDeep(payload.conversationId);
        } catch (err) {
            logger.error({ err }, '[Worker] Derin bellek çıkarımı hatası');
        }
    });

    // OPT-3: Konuşma özetleme handler'ı — TaskQueue üzerinden çalışır
    taskQueue.registerHandler('conversation_summarization', async (payload, signal) => {
        if (signal.aborted) return;
        try {
            await agent.summarizeConversation(payload.conversationId);
        } catch (err) {
            logger.error({ err }, '[Worker] Konuşma özetleme hatası');
        }
    });

    // ═══════════════════════════════════════════════════════════
    // OTONOM İŞLEYİCİLER (AUTONOMOUS HANDLERS)
    // ═══════════════════════════════════════════════════════════

    // 1. Otonom Düşünme Döngüsü
    taskQueue.registerHandler('autonomous_tick', async (payload, signal) => {
        if (signal.aborted) return;

        // --- 1. PRE-LLM GATEKEEPER: Feedback-based kontrol ---
        const preFeedback = feedbackManager.getState();
        if (preFeedback.reluctancePenalty > 0.4) {
            logger.info('[Worker] 💤 Kullanıcı isteksiz, otonom döngü uykuda.');
            let sleepDelayMinutes = 15;
            if (preFeedback.lastSignalAt > 0) {
                const hoursSinceActive = (Date.now() - preFeedback.lastSignalAt) / (1000 * 60 * 60);
                if (hoursSinceActive > 24) sleepDelayMinutes = 1440;
                else if (hoursSinceActive > 4) sleepDelayMinutes = 120;
            }
            taskQueue.enqueue({ id: `auto_tick_${Date.now()}`, type: 'autonomous_tick', priority: TaskPriority.P4_LOW, payload: {}, addedAt: Date.now() + (sleepDelayMinutes * 60 * 1000) });
            return;
        }

        // --- 2. THINK ENGINE: Saf Düşünme ---
        const neutralEmotion = { primary: 'Nötr', intensity: 'low' as const, description: 'Sakin ve odaklı' };
        const thoughtResult = think(database.getDb(), neutralEmotion);
        if (!thoughtResult) {
            // Düşünecek bir tohum bulunamadı. Kısa bekle ve tekrar dene.
            taskQueue.enqueue({ id: `auto_tick_${Date.now()}`, type: 'autonomous_tick', priority: TaskPriority.P4_LOW, payload: {}, addedAt: Date.now() + (30 * 60 * 1000) });
            return;
        }

        if (signal.aborted) return;

        // --- 3. MODEL TIERING: Hafif LLM ile Öz Düşünüm (Self-Reflection) ---
        // Burada ağır bir model yerine arka plan araştırmaları için daha hafif bir model kullanılmalı
        // Şimdilik ana modeli (llm objesi) kullanıyoruz; ileride config üzerinden config.backgroundLLMModel ile ayrıştırılabilir.
        logger.info(`[Worker] 🤔 Otonom düşünce başlıyor. Konu: "${thoughtResult.thought.seed.content.substring(0, 30)}..."`);
        let llmThoughtOutput = "";
        try {
            const result = await llm.chat([{ role: 'user', content: thoughtResult.prompt }], { temperature: 0.6, maxTokens: 800 });
            llmThoughtOutput = result.content;
        } catch (err) {
            logger.error({ err }, '[Worker] LLM Self-Reflection çağrısı başarısız oldu.');
            return;
        }

        if (signal.aborted) return;

        // --- 4. OPT F-15: URGE FILTER — Dinamik Değerlendirme ---
        // LLM çıktısından JSON metadata parse et; başarısızlıkta güvenli varsayılanlar kullan.
        let relevanceScore = 0.5;
        let timeSensitivity = 0.3;
        try {
            const jsonMatch = llmThoughtOutput.match(/\{[\s\S]*?"relevance"[\s\S]*?\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (typeof parsed.relevance === 'number') relevanceScore = Math.max(0, Math.min(1, parsed.relevance));
                if (typeof parsed.timeSensitivity === 'number') timeSensitivity = Math.max(0, Math.min(1, parsed.timeSensitivity));
            }
        } catch {
            // JSON parse başarısız — varsayılanlar kullanılır
        }

        const evaluation = {
            relevanceScore,
            timeSensitivity,
            emotionalIntensity: 0.5,
            sourceType: 'thought_chain' as const
        };
        const currentHour = new Date().getHours();
        const decisionResult = filterThought(evaluation, feedbackManager.getState(), currentHour);

        logger.info(`[Worker] ⚖️ Otonom Karar: ${decisionResult.decision.toUpperCase()}. Skor: ${decisionResult.score.toFixed(2)} (Eşik: ${decisionResult.threshold.toFixed(2)})`);

        // --- 5. AKSİYON AL ---
        if (decisionResult.decision === 'send') {
            // Kullanıcıya mesaj atmaya karar verdik! (Uygulamanın aktif bir Frontend WebSocket kanalı olması lazım, 
            // şimdilik sisteme broadcast atıyoruz veya DB ye Action olarka ekliyoruz.)
            logger.info(`[Worker] 🚀 PROAKTİF MESAJ GÖNDERİLİYOR: ` + llmThoughtOutput.substring(0, 100));
        } else if (decisionResult.decision === 'digest') {
            // Bir kenara not et
            logger.info(`[Worker] 📥 Düşünce Digest havuzuna alındı.`);
            // TODO: Digest tablosuna ekle
        }

        // Bir sonraki döngüyü exponential backoff ile planla
        const feedback = feedbackManager.getState();
        let delayMinutes = 15;
        if (feedback.lastSignalAt > 0) {
            const hoursSinceActive = (Date.now() - feedback.lastSignalAt) / (1000 * 60 * 60);
            if (hoursSinceActive > 24) delayMinutes = 1440; // 24 saatte bir
            else if (hoursSinceActive > 4) delayMinutes = 120; // 2 saatte bir
        }
        taskQueue.enqueue({ id: `auto_tick_${Date.now()}`, type: 'autonomous_tick', priority: TaskPriority.P4_LOW, payload: {}, addedAt: Date.now() + (delayMinutes * 60 * 1000) });
    });

    // 2. Alt Ajan Merak Motoru
    taskQueue.registerHandler('subagent_research', async (payload, signal) => {
        if (signal.aborted) return;
        const fixationTopic = payload.fixationTopic;
        if (!fixationTopic) return;

        // Görevi Yarat
        const task = subAgentManager.createTask({
            topic: fixationTopic,
            urgency: 'medium',
            source: 'thought_chain',
            relatedMemoryIds: []
        });

        if (!task) {
            logger.info(`[Worker] 🛑 SubAgent limiti doldu. Merak iptal: "${fixationTopic}"`);
            return;
        }

        logger.info(`[Worker] 🔎 SubAgent Merak Motoru başladı: "${fixationTopic}"`);

        // --- BURADA WEB ARAMASI YAPILIP ÖZETLENMELİ (MOCK) ---
        // Şimdilik hafif modeli çağırarak mock bir rapor dönüyoruz.
        const mockReportStr = await llm.chat([{ role: 'user', content: `Lütfen şu konu hakkında genel bilgi ver ve kısaca özetle: ${fixationTopic}.` }], { temperature: 0.3, maxTokens: 400 });

        subAgentManager.completeTask(task.id, {
            summary: mockReportStr.content,
            keyFindings: ['Örnek bulgu 1', 'Örnek bulgu 2'],
            sources: ["web_search_mock"],
            relevanceScore: 0.8,
            isTimeSensitive: false,
            generatedAt: new Date().toISOString()
        });

        logger.info(`[Worker] ✅ SubAgent Raporu Tamamlandı: "${fixationTopic}"`);
    });

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

    // 6. Express + WebSocket
    const app = express();
    const server = createServer(app);
    const wss = new WebSocketServer({ noServer: true });

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
        clearInterval(decayTimer);
        autonomousWorker.stop();
        try {
            await router.disconnectAll();
        } catch (err) {
            logger.error({ err }, '[Gateway] Kanal kapatma hatası');
        }
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
