/**
 * REST API route definitions.
 * Express route handler'ları — index.ts'den çıkarıldı.
 */

import type { Express } from 'express';
import type { MemoryManager } from '../memory/manager.js';
import type { MessageRouter } from '../router/index.js';
import { LLMProviderFactory } from '../llm/index.js';
import type { LLMProvider } from '../llm/provider.js';
import { readEnv, updateEnv } from './envUtils.js';
import { reloadConfig } from './config.js';
import { BASE_SYSTEM_PROMPT } from '../agent/prompt.js';
import { logger } from '../utils/logger.js';
import { AgentRuntime } from '../agent/runtime.js';
import { GraphRAGConfigManager, GraphRAGRolloutPhase } from '../memory/graphRAG/config.js';
import { BehaviorDiscoveryShadow } from '../memory/graphRAG/BehaviorDiscoveryShadow.js';
import { PageRankScorer } from '../memory/graphRAG/PageRankScorer.js';
import { CommunityDetector } from '../memory/graphRAG/CommunityDetector.js';
import type { MemoryGraph, GraphNode, GraphEdge } from '../memory/types.js';
import {
  getMarketplace,
  getInstalledServers,
  installServer,
  activateServer,
  deactivateServer,
  uninstallServer,
  getServerTools,
  getServerStatus,
} from './services/mcpService.js';

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

    // ============ REST API ============

    app.get('/api/stats', (_req, res) => {
        const stats = memory.getStats();
        res.json(stats);
    });

    app.get('/api/channels', (_req, res) => {
        res.json(router.getChannelStatus());
    });

    app.get('/api/conversations', (_req, res) => {
        const conversations = memory.getRecentConversations(50);
        res.json(conversations);
    });

    app.get('/api/conversations/:id/messages', (req, res) => {
        const messages = memory.getConversationHistory(req.params.id, 100);
        res.json(messages);
    });

    // Konuşma başlığı güncelleme
    app.patch('/api/conversations/:id', (req, res) => {
      const { id } = req.params;
      const { title } = req.body;

      if (!title || typeof title !== 'string') {
        return res.status(400).json({ error: 'Başlık zorunludur' });
      }

      if (title.length > 200) {
        return res.status(400).json({ error: 'Başlık maksimum 200 karakter olabilir' });
      }

      try {
        // Manuel güncelleme olduğu için is_title_custom = 1 yap
        memory.updateConversationTitle(id, title.trim(), true);
        res.json({ success: true, title: title.trim() });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    app.delete('/api/conversations/:id', (req, res) => {
      try {
        const deleted = memory.deleteConversation(req.params.id);
        if (!deleted) {
          return res.status(404).json({ error: 'Konuşma bulunamadı' });
        }
        broadcastStats();
        res.json({ success: true });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });
  
    // Toplu sohbet silme
    app.delete('/api/conversations', (req, res) => {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Silinecek ID\'ler (ids) bir dizi olarak verilmelidir' });
      }
  
      try {
        const results: { id: string; deleted: boolean }[] = [];
        for (const id of ids) {
          const deleted = memory.deleteConversation(id);
          results.push({ id, deleted });
        }
        broadcastStats();
        
        const deletedCount = results.filter(r => r.deleted).length;
        res.json({
          success: true,
          deletedCount,
          results
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    app.get('/api/memories', (_req, res) => {
        const memories = memory.getUserMemories(100);
        res.json(memories);
    });

    app.post('/api/memories', async (req, res) => {
        const { content, category, importance } = req.body;
        if (!content || typeof content !== 'string') {
            return res.status(400).json({ error: 'İçerik (content) zorunludur' });
        }
        try {
            const added = await memory.addMemory(content, category || 'general', importance || 5);
            broadcastStats();
            res.json({ success: true, memoryId: added.id, isUpdate: added.isUpdate });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.put('/api/memories/:id', async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Geçersiz bellek ID' });

        const { content, category, importance } = req.body;
        if (!content || typeof content !== 'string') {
            return res.status(400).json({ error: 'İçerik (content) zorunludur' });
        }

        try {
            const updated = await memory.editMemory(id, content, category || 'general', importance || 5);
            if (updated) {
                res.json({ success: true });
            } else {
                res.status(404).json({ error: 'Bellek bulunamadı veya güncellenemedi' });
            }
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // Bellek arama API'si (#14)
    app.get('/api/memories/search', (req, res) => {
        const q = req.query.q as string;
        if (!q || typeof q !== 'string' || q.trim().length < 2) {
            return res.status(400).json({ error: 'Arama sorgusu en az 2 karakter olmalı' });
        }
        try {
            const results = memory.searchMemories(q.trim(), 20);
            res.json(results);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.delete('/api/memories/:id', (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Geçersiz bellek ID' });
        try {
            const deleted = memory.deleteMemory(id);
            if (deleted) {
                broadcastStats();
                res.json({ success: true });
            } else {
                res.status(404).json({ error: 'Bellek bulunamadı' });
            }
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/memory-graph', (req, res) => {
        try {
            const {
                limit = 100,
                includePageRank = 'true',
                includeCommunities = 'true',
            } = req.query;

            const graphLimit = parseInt(limit as string, 10);
            const doPageRank = includePageRank === 'true';
            const doCommunities = includeCommunities === 'true';

            // Mevcut graph verisi (limit graph.ts'de default 200)
            const graphData = memory.getMemoryGraph();

            // Limit uygula (frontend tarafında da filtreleme yapılabilir)
            const limitedNodes = graphData.nodes.slice(0, graphLimit);
            const limitedNodeIds = new Set(limitedNodes.map((n: GraphNode) => n.id));
            const limitedEdges = graphData.edges.filter(
                (e: GraphEdge) => limitedNodeIds.has(typeof e.source === 'string' ? e.source : e.source) &&
                     limitedNodeIds.has(typeof e.target === 'string' ? e.target : e.target)
            );
            const limitedGraph: MemoryGraph = { nodes: limitedNodes, edges: limitedEdges };

            // PageRank skorları ekle
            let pageRankScores = new Map<number, number>();
            if (doPageRank) {
                try {
                    const db = memory.getDatabase();
                    if (db) {
                        const scorer = new PageRankScorer(db);
                        const allNodeIds = limitedGraph.nodes
                            .filter((n: GraphNode) => n.type === 'memory' && n.rawId != null)
                            .map((n: GraphNode) => n.rawId!);
                        if (allNodeIds.length > 0) {
                            pageRankScores = scorer.scoreSubgraph(allNodeIds);
                        }
                    }
                } catch (err) {
                    logger.warn({ err }, '[API] PageRank computation failed:');
                }
            }

            // Community etiketleri ekle
            let communityMap = new Map<number, string>();
            if (doCommunities) {
                try {
                    const db = memory.getDatabase();
                    if (db) {
                        const detector = new CommunityDetector(db);
                        const result = detector.detectCommunities();
                        for (const community of result.communities) {
                            for (const nodeId of community.memberNodeIds) {
                                communityMap.set(nodeId, community.id);
                            }
                        }
                    }
                } catch (err) {
                    logger.warn({ err }, '[API] Community detection failed:');
                }
            }

            // Node'ları zenginleştir
            interface EnrichedNode extends GraphNode {
                pageRankScore: number;
                communityId: string | null;
                importance: number;
            }
            const enrichedNodes: EnrichedNode[] = limitedGraph.nodes.map((node: GraphNode) => {
                const rawId = node.rawId ?? 0;
                const prScore = pageRankScores.get(rawId) ?? 0;
                const communityId = communityMap.get(rawId) ?? null;
                const accessCount = (node as any).access_count ?? 0;
                const importance = node.importance ?? 0;

                return {
                    ...node,
                    pageRankScore: prScore,
                    communityId,
                    // Node importance: PageRank + access_count + importance
                    importance: prScore * 0.5 + accessCount * 0.3 + importance * 0.2,
                };
            });

            // Edge'leri zenginleştir
            interface EnrichedEdge extends GraphEdge {
                displayWeight: number;
            }
            const enrichedEdges: EnrichedEdge[] = limitedGraph.edges.map((edge: GraphEdge) => {
                const confidence = edge.confidence ?? 0.5;
                const weight = (edge as any).weight ?? 1.0;
                return {
                    ...edge,
                    // Edge weight: confidence * weight
                    displayWeight: confidence * weight,
                };
            });

            // Community sayısını hesapla
            const uniqueCommunities = new Set(communityMap.values());

            // Ortalama PageRank
            const nodesWithRawId = enrichedNodes.filter((n: EnrichedNode) => n.type === 'memory');
            const avgPageRank = nodesWithRawId.length > 0
                ? nodesWithRawId.reduce((sum: number, n: EnrichedNode) => sum + (n.pageRankScore ?? 0), 0) / nodesWithRawId.length
                : 0;

            res.json({
                nodes: enrichedNodes,
                edges: enrichedEdges,
                metadata: {
                    totalNodes: enrichedNodes.length,
                    totalEdges: enrichedEdges.length,
                    communityCount: uniqueCommunities.size,
                    avgPageRank,
                    includePageRank: doPageRank,
                    includeCommunities: doCommunities,
                },
            });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

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
        openaiApiKey: env.OPENAI_API_KEY || '',
        anthropicApiKey: env.ANTHROPIC_API_KEY || '',
        minimaxApiKey: env.MINIMAX_API_KEY || '',
        githubToken: env.GITHUB_TOKEN || '',
        groqApiKey: env.GROQ_API_KEY || '',
        mistralApiKey: env.MISTRAL_API_KEY || '',
        nvidiaApiKey: env.NVIDIA_API_KEY || '',
        ollamaBaseUrl: env.OLLAMA_BASE_URL || 'http://localhost:11434',
        allowShellExecution: env.ALLOW_SHELL_EXECUTION === 'true',
        systemPrompt: env.SYSTEM_PROMPT || '',
        autonomousStepLimit: env.AUTONOMOUS_STEP_LIMIT || '5',
        memoryDecayThreshold: env.MEMORY_DECAY_THRESHOLD || '30',
        semanticSearchThreshold: env.SEMANTIC_SEARCH_THRESHOLD || '0.7',
        logLevel: env.LOG_LEVEL || 'info',
        embeddingProvider: env.EMBEDDING_PROVIDER || 'openai',
        embeddingModel: env.EMBEDDING_MODEL || 'text-embedding-3-small',
        braveSearchApiKey: env.BRAVE_SEARCH_API_KEY || '',
        baseSystemPrompt: BASE_SYSTEM_PROMPT,
        // Gelişmiş Model Ayarları
        temperature: env.TEMPERATURE || '0.7',
        maxTokens: env.MAX_TOKENS || '4096',
      });
    });

    app.post('/api/settings', (req, res) => {
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

        for (const [key, val] of Object.entries(body)) {
            if (map[key]) {
                if (typeof val === 'string' && val.includes('***')) continue;
                updates[map[key]] = String(val);
            }
        }

        const success = updateEnv(updates);
        if (success) {
            reloadConfig();
            logger.info('[Gateway] ⚙️ Ayarlar güncellendi.');
            res.json({ success: true });
        } else {
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
            // Arka planda derin analiz başlat (non-blocking)
            agent.processRawTextForMemories(bio, userName || 'Kullanıcı').then(() => {
                broadcastStats();
            }).catch(err => {
                logger.error({ err }, '[API] Onboarding bio extraction failed in background');
            });

            res.json({ success: true });
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
        shadowMode: config.shadowMode,
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

      if (!Object.values(GraphRAGRolloutPhase).includes(phaseNum) || isNaN(phaseNum)) {
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

    // GET /api/graphrag/shadow-report — Shadow mode raporu
    app.get('/api/graphrag/shadow-report', (_req, res) => {
      const config = GraphRAGConfigManager.getConfig();
      if (!config.shadowMode) {
        return res.status(400).json({ error: 'Shadow mode is not active' });
      }

      // ShadowMode instance'ına agent üzerinden eriş
      const shadowMode = agent.getShadowMode();
      if (!shadowMode) {
        return res.status(400).json({ error: 'ShadowMode instance not available' });
      }

      const report = shadowMode.generateReport();
      res.json(report);
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

    // ============ MCP Marketplace API ============

    // GET /api/mcp/marketplace — Marketplace catalog'unu getir
    app.get('/api/mcp/marketplace', async (_req, res) => {
      try {
        const { query } = _req.query;
        const catalog = await getMarketplace(query as string);
        res.json({ success: true, catalog });
      } catch (err) {
        logger.error({ err }, '[MCP:routes] Failed to fetch marketplace');
        res.status(500).json({ success: false, error: 'Failed to fetch marketplace' });
      }
    });

    // GET /api/mcp/servers — Kurulu server'ları getir
    app.get('/api/mcp/servers', (_req, res) => {
      try {
        const servers = getInstalledServers();
        const summary = {
          total: servers.length,
          active: servers.filter(s => s.status === 'active').length,
          disabled: servers.filter(s => s.status === 'disabled').length,
          error: servers.filter(s => s.status === 'error').length,
        };
        res.json({ success: true, servers, summary });
      } catch (error) {
        logger.error({ error }, '[MCP:routes] Failed to fetch servers');
        res.status(500).json({ success: false, error: 'Failed to fetch servers' });
      }
    });

    // POST /api/mcp/servers — Yeni server kur
    app.post('/api/mcp/servers', async (req, res) => {
      try {
        const { name, description, command, args, env, cwd, timeout } = req.body;
        if (!name || !command) {
          return res.status(400).json({ success: false, error: 'name and command required' });
        }
        const result = await installServer({
          name,
          description: description || '',
          command,
          args: args || [],
          env,
          cwd,
          timeout,
        });
        if (result.success) {
          res.status(201).json(result);
        } else {
          res.status(409).json(result);
        }
      } catch (error) {
        logger.error({ error }, '[MCP:routes] Failed to install server');
        res.status(500).json({ success: false, error: 'Failed to install server' });
      }
    });

    // PATCH /api/mcp/servers/:name/toggle — Server'ı aktif/pasif et
    app.patch('/api/mcp/servers/:name/toggle', async (req, res) => {
      try {
        const { name } = req.params;
        const { action } = req.body;
        if (action === 'enable') {
          const result = await activateServer(name);
          res.json(result);
        } else if (action === 'disable') {
          const result = await deactivateServer(name);
          res.json(result);
        } else {
          res.status(400).json({ success: false, error: 'action must be enable or disable' });
        }
      } catch (error) {
        logger.error({ error }, '[MCP:routes] Failed to toggle server');
        res.status(500).json({ success: false, error: 'Failed to toggle server' });
      }
    });

    // DELETE /api/mcp/servers/:name — Server'ı kaldır
    app.delete('/api/mcp/servers/:name', async (req, res) => {
      try {
        const { name } = req.params;
        const result = await uninstallServer(name);
        res.json(result);
      } catch (error) {
        logger.error({ error }, '[MCP:routes] Failed to uninstall server');
        res.status(500).json({ success: false, error: 'Failed to uninstall server' });
      }
    });

    // GET /api/mcp/servers/:name/tools — Server'ın araçlarını getir
    app.get('/api/mcp/servers/:name/tools', (req, res) => {
      try {
        const { name } = req.params;
        const tools = getServerTools(name);
        res.json({ success: true, tools });
      } catch (error) {
        logger.error({ error }, '[MCP:routes] Failed to fetch tools');
        res.status(500).json({ success: false, error: 'Failed to fetch tools' });
      }
    });

    // GET /api/mcp/servers/:name/status — Server durumunu getir
    app.get('/api/mcp/servers/:name/status', (req, res) => {
      try {
        const { name } = req.params;
        const server = getServerStatus(name);
        if (server) {
          res.json({ success: true, server });
        } else {
          res.status(404).json({ success: false, error: 'Server not found' });
        }
      } catch (error) {
        logger.error({ error }, '[MCP:routes] Failed to fetch status');
        res.status(500).json({ success: false, error: 'Failed to fetch status' });
      }
    });

    // ============ Token Usage Stats API ============

    // GET /api/usage/stats?period=day|week|month|all
    app.get('/api/usage/stats', (req, res) => {
      try {
        const period = (req.query.period as string) || 'week';
        const stats = memory.getTokenUsageStats(period);
        const dailyUsage = memory.getDailyUsage(period);
        
        res.json({
          period,
          totalTokens: stats.totalTokens,
          totalCost: stats.totalCost,
          providerBreakdown: stats.providerBreakdown,
          dailyUsage,
        });
      } catch (err: any) {
        logger.error({ err }, '[API] Token usage stats error:');
        res.status(500).json({ error: 'Token usage stats alınamadı' });
      }
    });

    // API 404 handler
    app.all('/api/*', (_req, res) => {
      res.status(404).json({ error: 'API endpoint bulunamadı' });
    });
  }
