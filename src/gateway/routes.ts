/**
 * REST API route definitions.
 * Express route handler'ları — index.ts'den çıkarıldı.
 */

import type { Express } from 'express';
import type { MemoryManager } from '../memory/manager.js';
import type { MessageRouter } from '../router/index.js';
import { LLMProviderFactory } from '../llm/index.js';
import type { LLMProvider } from '../llm/provider.js';
import { readEnv, secureUpdateEnv } from './envUtils.js';
import { reloadConfig } from './config.js';
import { BASE_SYSTEM_PROMPT } from '../agent/prompt.js';
import { logger } from '../utils/logger.js';
import { AgentRuntime } from '../agent/runtime.js';
import { GraphRAGConfigManager, GraphRAGRolloutPhase } from '../memory/graphRAG/config.js';
import { BehaviorDiscoveryShadow } from '../memory/graphRAG/BehaviorDiscoveryShadow.js';
import type { MemoryGraph, GraphNode, GraphEdge } from '../memory/types.js';
import { createMCPController } from './controllers/mcpController.js';
import { createMemoryController } from './controllers/memoryController.js';
import { metricsCollector } from '../observability/metricsCollector.js';

export interface RouteDeps {
    memory: MemoryManager;
    llm: LLMProvider;
    router: MessageRouter;
    agent: AgentRuntime;
    broadcastStats: () => void;
}

// Global BehaviorDiscoveryShadow instance (lazy initialized)
let behaviorDiscoveryShadow: BehaviorDiscoveryShadow | null = null;

function getBehaviorDiscoveryShadow(): BehaviorDiscoveryShadow {
    if (!behaviorDiscoveryShadow) {
        behaviorDiscoveryShadow = new BehaviorDiscoveryShadow();
    }
    return behaviorDiscoveryShadow;
}

export function registerRoutes(app: Express, deps: RouteDeps): void {
    const { memory, llm, router, agent, broadcastStats } = deps;

    const maskKey = (key: string | undefined) => {
        if (!key || key.length < 8) return '';
        return key.substring(0, 4) + '••••' + key.substring(key.length - 4);
    };

    // ============ REST API ============

    // ============ Controllers ============
    app.use('/api', createMemoryController(memory, router, broadcastStats));
    app.use('/api/mcp', createMCPController());

    app.get('/api/health', async (_req, res) => {
        const llmHealthy = await llm.healthCheck();
        res.json({
            status: 'ok',
            llm: { provider: llm.name, healthy: llmHealthy },
            channels: router.getChannelStatus(),
            stats: memory.getStats(),
        });
    });

    // ============ Hassas Dizin API ============

    app.get('/api/settings/sensitive-paths', (_req, res) => {
        const paths = memory.getSensitivePaths();
        res.json(paths);
    });

    app.post('/api/settings/sensitive-paths', (req, res) => {
        const { path: newPath } = req.body;
        if (!newPath || typeof newPath !== 'string') {
            return res.status(400).json({ error: 'Geçersiz dizin yolu' });
        }
        const paths = memory.getSensitivePaths();
        const trimmed = newPath.trim();
        if (paths.includes(trimmed)) {
            return res.status(409).json({ error: 'Bu dizin zaten listede' });
        }
        paths.push(trimmed);
        memory.setSensitivePaths(paths);
        res.json(paths);
    });

    app.delete('/api/settings/sensitive-paths', (req, res) => {
        const { path: removePath } = req.body;
        if (!removePath || typeof removePath !== 'string') {
            return res.status(400).json({ error: 'Geçersiz dizin yolu' });
        }
        const paths = memory.getSensitivePaths();
        const filtered = paths.filter(p => p !== removePath.trim());
        memory.setSensitivePaths(filtered);
        res.json(filtered);
    });

    // ============ Genel Ayarlar API ============

    app.get('/api/settings', (_req, res) => {
      const env = readEnv();
      res.json({
        defaultLLMProvider: env.DEFAULT_LLM_PROVIDER || 'openai',
        defaultLLMModel: env.DEFAULT_LLM_MODEL || '',
        defaultUserName: env.DEFAULT_USER_NAME || 'Kullanıcı',
        openaiApiKey: maskKey(env.OPENAI_API_KEY),
        anthropicApiKey: maskKey(env.ANTHROPIC_API_KEY),
        minimaxApiKey: maskKey(env.MINIMAX_API_KEY),
        githubToken: maskKey(env.GITHUB_TOKEN),
        groqApiKey: maskKey(env.GROQ_API_KEY),
        mistralApiKey: maskKey(env.MISTRAL_API_KEY),
        nvidiaApiKey: maskKey(env.NVIDIA_API_KEY),
        ollamaBaseUrl: env.OLLAMA_BASE_URL || 'http://localhost:11434',
        allowShellExecution: env.ALLOW_SHELL_EXECUTION === 'true',
        systemPrompt: env.SYSTEM_PROMPT || '',
        autonomousStepLimit: env.AUTONOMOUS_STEP_LIMIT || '5',
        memoryDecayThreshold: env.MEMORY_DECAY_THRESHOLD || '30',
        semanticSearchThreshold: env.SEMANTIC_SEARCH_THRESHOLD || '0.7',
        logLevel: env.LOG_LEVEL || 'info',
        embeddingProvider: env.EMBEDDING_PROVIDER || 'openai',
        embeddingModel: env.EMBEDDING_MODEL || 'text-embedding-3-small',
        braveSearchApiKey: maskKey(env.BRAVE_SEARCH_API_KEY),
        baseSystemPrompt: BASE_SYSTEM_PROMPT,
        // Gelişmiş Model Ayarları
        temperature: env.TEMPERATURE || '0.7',
        maxTokens: env.MAX_TOKENS || '4096',
      });
    });

    app.post('/api/settings', async (req, res) => {
    const body = req.body;
    const updates: Record<string, string> = {};
  
    const map: Record<string, string> = {
      defaultLLMProvider: 'DEFAULT_LLM_PROVIDER',
      defaultLLMModel: 'DEFAULT_LLM_MODEL',
      defaultUserName: 'DEFAULT_USER_NAME',
      openaiApiKey: 'OPENAI_API_KEY',
      anthropicApiKey: 'ANTHROPIC_API_KEY',
      minimaxApiKey: 'MINIMAX_API_KEY',
      githubToken: 'GITHUB_TOKEN',
      groqApiKey: 'GROQ_API_KEY',
      mistralApiKey: 'MISTRAL_API_KEY',
      nvidiaApiKey: 'NVIDIA_API_KEY',
      ollamaBaseUrl: 'OLLAMA_BASE_URL',
      allowShellExecution: 'ALLOW_SHELL_EXECUTION',
      systemPrompt: 'SYSTEM_PROMPT',
      autonomousStepLimit: 'AUTONOMOUS_STEP_LIMIT',
      memoryDecayThreshold: 'MEMORY_DECAY_THRESHOLD',
      semanticSearchThreshold: 'SEMANTIC_SEARCH_THRESHOLD',
      logLevel: 'LOG_LEVEL',
      embeddingProvider: 'EMBEDDING_PROVIDER',
      embeddingModel: 'EMBEDDING_MODEL',
      braveSearchApiKey: 'BRAVE_SEARCH_API_KEY',
      // Gelişmiş Model Ayarları
      temperature: 'TEMPERATURE',
      maxTokens: 'MAX_TOKENS',
    };
  
    // LLM provider/model değişiklikleri runtime'ı etkilemez (startup'ta oluşturulur)
    const llmKeys = new Set(['DEFAULT_LLM_PROVIDER', 'DEFAULT_LLM_MODEL']);
    let requiresRestart = false;
  
    for (const [key, val] of Object.entries(body)) {
      if (map[key]) {
        if (typeof val === 'string' && (val.includes('***') || val.includes('••••'))) continue;
        updates[map[key]] = String(val);
        if (llmKeys.has(map[key])) requiresRestart = true;
      }
    }
  
    try {
      await secureUpdateEnv(updates);
  
      // process.env'i güncelle — reloadConfig() process.env üzerinden okur
      for (const [key, value] of Object.entries(updates)) {
        process.env[key] = value;
      }
  
      reloadConfig();
      logger.info('[Gateway] ⚙️ Ayarlar güncellendi.');
  
      if (requiresRestart) {
        res.json({ success: true, requiresRestart: true, message: 'LLM provider/model değişiklikleri yeniden başlatma gerektirir.' });
      } else {
        res.json({ success: true, requiresRestart: false });
      }
    } catch (err: any) {
      logger.error({ err }, '[Gateway] .env güncellemesi başarısız oldu');
      res.status(500).json({ error: '.env dosyası güncellenemedi.' });
    }
  });

    // ============ Onboarding Bio İşleme API ============

    app.post('/api/onboarding/process', async (req, res) => {
        const { bio, userName } = req.body;
        if (!bio || typeof bio !== 'string') {
            return res.status(400).json({ error: 'Biyografi (bio) zorunludur' });
        }
        try {
            const jobId = `onboard_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            // Arka planda derin analiz başlat (non-blocking)
            agent.processRawTextForMemories(bio, userName || 'Kullanıcı').then(() => {
                broadcastStats();
            }).catch(err => {
                logger.error({ err }, '[API] Onboarding bio extraction failed in background');
            });

            res.json({ success: true, jobId, message: 'Bellek çıkarımı arka planda başlatıldı' });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/llm/providers', async (_req, res) => {
        const available = LLMProviderFactory.getAvailable();
        const providers = [];

        for (const name of available) {
            try {
                const p = await LLMProviderFactory.create(name);
                providers.push({
                    name: p.name,
                    models: p.supportedModels || []
                });
            } catch (e) {
                providers.push({
                    name: name,
                    models: []
                });
            }
        }
        res.json(providers);
    });

    // ============ Feedback API ============
  
    app.post('/api/feedback', (req, res) => {
      const { messageId, conversationId, type, comment } = req.body;
      
      if (!messageId || typeof messageId !== 'string') {
        return res.status(400).json({ error: 'Mesaj ID (messageId) zorunludur' });
      }
      
      if (!conversationId || typeof conversationId !== 'string') {
        return res.status(400).json({ error: 'Konuşma ID (conversationId) zorunludur' });
      }
      
      if (!type || !['positive', 'negative'].includes(type)) {
        return res.status(400).json({ error: 'Feedback tipi (type) "positive" veya "negative" olmalıdır' });
      }
  
      try {
        // Feedback'i veritabanına kaydet
        const feedback = memory.saveFeedback({
          messageId,
          conversationId,
          type,
          comment: comment || null,
          timestamp: new Date().toISOString(),
        });
        
        logger.info({ messageId, conversationId, type }, '[API] Feedback kaydedildi');
        res.json({ success: true, feedback });
      } catch (err: any) {
        logger.error({ err }, '[API] Feedback kaydetme hatası');
        res.status(500).json({ error: err.message });
      }
    });
  
    app.get('/api/feedback/:conversationId', (req, res) => {
      const { conversationId } = req.params;
      
      try {
        const feedbacks = memory.getFeedbacks(conversationId);
        res.json(feedbacks);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // ============ GraphRAG Rollout API ============

    // GET /api/graphrag/status — Mevcut GraphRAG durumunu getir
    app.get('/api/graphrag/status', (_req, res) => {
      const config = GraphRAGConfigManager.getConfig();
      const phase = GraphRAGConfigManager.getCurrentPhase();

      res.json({
        phase,
        phaseName: GraphRAGRolloutPhase[phase],
        config,
        enabled: config.enabled,
        sampleRate: config.sampleRate,
      });
    });

    // POST /api/graphrag/advance-phase — Phase'i ilerlet
    app.post('/api/graphrag/advance-phase', (_req, res) => {
      try {
        const newPhase = GraphRAGConfigManager.advancePhase();
        res.json({
          phase: newPhase,
          phaseName: GraphRAGRolloutPhase[newPhase],
          message: `GraphRAG rollout phase advanced to ${GraphRAGRolloutPhase[newPhase]}`
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // POST /api/graphrag/set-phase — Belirli bir phase'e set et
    app.post('/api/graphrag/set-phase', (req, res) => {
      const { phase } = req.body;
      const phaseNum = parseInt(phase, 10);
      const validPhases = Object.values(GraphRAGRolloutPhase).filter(v => typeof v === 'number') as number[];

      if (!validPhases.includes(phaseNum) || isNaN(phaseNum)) {
        return res.status(400).json({ error: 'Invalid phase. Use 1 (OFF), 2 (SHADOW), 3 (PARTIAL), or 4 (FULL).' });
      }

      try {
        GraphRAGConfigManager.setRolloutPhase(phaseNum as GraphRAGRolloutPhase);
        res.json({
          phase: phaseNum,
          phaseName: GraphRAGRolloutPhase[phaseNum],
          message: `GraphRAG rollout phase set to ${GraphRAGRolloutPhase[phaseNum]}`
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // ============ Behavior Discovery Shadow API ============

    // GET /api/behavior-discovery/metrics — BehaviorDiscovery metrikleri
    app.get('/api/behavior-discovery/metrics', (_req, res) => {
      const shadow = getBehaviorDiscoveryShadow();
      const metrics = shadow.getMetrics();
      res.json(metrics);
    });

    // GET /api/behavior-discovery/report — BehaviorDiscovery raporu
    app.get('/api/behavior-discovery/report', (_req, res) => {
      const shadow = getBehaviorDiscoveryShadow();
      const report = shadow.generateReport();
      res.type('text/plain').send(report);
    });

    // POST /api/behavior-discovery/config — BehaviorDiscovery konfigürasyonunu güncelle
    app.post('/api/behavior-discovery/config', (req, res) => {
      const shadow = getBehaviorDiscoveryShadow();
      const { enabled, sampleRate, maxComparisons, logToFile } = req.body;
      
      const config: Record<string, unknown> = {};
      if (typeof enabled === 'boolean') config.enabled = enabled;
      if (typeof sampleRate === 'number' && sampleRate >= 0 && sampleRate <= 1) config.sampleRate = sampleRate;
      if (typeof maxComparisons === 'number' && maxComparisons > 0) config.maxComparisons = maxComparisons;
      if (typeof logToFile === 'boolean') config.logToFile = logToFile;

      if (Object.keys(config).length === 0) {
        return res.status(400).json({ error: 'Geçerli bir konfigürasyon sağlanmalıdır' });
      }

      shadow.updateConfig(config);
      res.json({ success: true, config: shadow.getConfig() });
    });

    // POST /api/behavior-discovery/clear — Comparisons'ı temizle
    app.post('/api/behavior-discovery/clear', (_req, res) => {
      const shadow = getBehaviorDiscoveryShadow();
      shadow.clear();
      res.json({ success: true });
    });

    // ============ Metrics API ============
  
    // GET /api/metrics/all — Tüm metrics'leri getir (limit ile)
    app.get('/api/metrics/all', (req, res) => {
      try {
        const limit = parseInt(req.query.limit as string) || 100;
        const metrics = metricsCollector.getAllMetrics(limit);
        res.json({ success: true, metrics });
      } catch (error: unknown) {
        const err = error as Error;
        res.status(500).json({ success: false, error: err.message });
      }
    });
  
    // Static routes MUST be registered BEFORE the parameterized :conversationId route,
    // otherwise Express matches /metrics/summary as :conversationId="summary" etc.
  
    // GET /api/metrics/summary — Aggrege metrics özeti
    app.get('/api/metrics/summary', (req, res) => {
      try {
        const days = parseInt(req.query.days as string) || 1;
        const summary = metricsCollector.getAggregatedMetrics(days);
        res.json({ success: true, ...summary });
      } catch (error: unknown) {
        const err = error as Error;
        res.status(500).json({ success: false, error: err.message });
      }
    });
  
    // GET /api/metrics/provider-stats — Provider bazlı istatistikler
    app.get('/api/metrics/provider-stats', (req, res) => {
      try {
        const days = parseInt(req.query.days as string) || 7;
        const stats = metricsCollector.getProviderStats(days);
        res.json({ success: true, providerStats: stats });
      } catch (error: unknown) {
        const err = error as Error;
        res.status(500).json({ success: false, error: err.message });
      }
    });
  
    // GET /api/metrics/error-stats — Hata istatistikleri
    app.get('/api/metrics/error-stats', (req, res) => {
      try {
        const stats = metricsCollector.getErrorStats();
        res.json({ success: true, ...stats });
      } catch (error: unknown) {
        const err = error as Error;
        res.status(500).json({ success: false, error: err.message });
      }
    });
  
    // GET /api/metrics/:conversationId — Belirli conversation'ın metrics'leri
    app.get('/api/metrics/:conversationId', (req, res) => {
      try {
        const metrics = metricsCollector.getConversationMetrics(req.params.conversationId);
        res.json({ success: true, metrics });
      } catch (error: unknown) {
        const err = error as Error;
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // Usage stats moved to memoryController.

    // API 404 handler
    app.all('/api/*', (_req, res) => {
      res.status(404).json({ error: 'API endpoint bulunamadı' });
    });
  }
