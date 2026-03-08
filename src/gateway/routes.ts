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

export interface RouteDeps {
    memory: MemoryManager;
    llm: LLMProvider;
    router: MessageRouter;
    agent: AgentRuntime;
    broadcastStats: () => void;
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

    app.get('/api/memory-graph', (_req, res) => {
        try {
            const graph = memory.getMemoryGraph();
            res.json(graph);
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
            baseSystemPrompt: BASE_SYSTEM_PROMPT
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

    // API 404 handler
    app.all('/api/*', (_req, res) => {
        res.status(404).json({ error: 'API endpoint bulunamadı' });
    });
}
