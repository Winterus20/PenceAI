import type { TaskQueue } from '../../autonomous/index.js';
import type { MemoryManager } from '../../memory/manager.js';
import type { LLMProvider } from '../../llm/provider.js';
import type { FeedbackManager } from '../../autonomous/urgeFilter.js';
import type { SubAgentManager } from '../../autonomous/curiosityEngine.js';
import type { BackgroundWorker } from '../../autonomous/index.js';
import { filterThought } from '../../autonomous/urgeFilter.js';
import { think } from '../../autonomous/thinkEngine.js';
import { TaskPriority } from '../../autonomous/index.js';
import { logger } from '../../utils/logger.js';
import type { WebSocketServer } from 'ws';
import type { AppConfig } from '../config.js';
import { z } from 'zod';

export interface AutonomousWorkerDeps {
    memory: MemoryManager;
    llm: LLMProvider;
    feedbackManager: FeedbackManager;
    subAgentManager: SubAgentManager;
    wss: WebSocketServer;
    config: AppConfig;
    worker: BackgroundWorker;
}

export function registerAutonomousWorkerJobs(taskQueue: TaskQueue, deps: AutonomousWorkerDeps): void {
    const { memory, llm, feedbackManager, subAgentManager, wss, config, worker } = deps;

    // Autonomous tick state — son seçilen seed'i takip et
    let lastSelectedSeedId: number | undefined = undefined;
    let lastSeedSelectedAt: number = 0; // Unix timestamp ms

    // Zod schema for LLM self-reflection output (1.2)
    const ThoughtSchema = z.object({
        relevance: z.number().min(0).max(1).optional(),
        timeSensitivity: z.number().min(0).max(1).optional(),
        reasoning: z.string().optional(),
    });

    /** Compute dynamic idle threshold based on user activity feedback (4.1) */
    function computeIdleThreshold(feedbackState: ReturnType<FeedbackManager['getState']>): number {
        if (feedbackState.lastSignalAt === 0) return 60 * 60 * 1000; // default 1 hour
        const hoursSinceActive = (Date.now() - feedbackState.lastSignalAt) / (1000 * 60 * 60);
        if (hoursSinceActive < 0.5) return 2 * 60 * 60 * 1000;      // active: 2h
        if (hoursSinceActive > 24) return 15 * 60 * 1000;           // >24h: 15m
        if (hoursSinceActive > 4) return 30 * 60 * 1000;            // >4h: 30m
        return 60 * 60 * 1000;                                       // default 1h
    }

    // 1. Otonom Düşünme Döngüsü
    taskQueue.registerHandler('autonomous_tick', async (payload, signal) => {
        if (signal.aborted) return;

        // --- 0. FEEDBACK DECAY (2.2) ---
        feedbackManager.applyDecay();

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

        // Seed cooldown kontrolü
        const SEED_COOLDOWN_MS = 30 * 60 * 1000; // 30 dakika
        const now = Date.now();
        if (lastSelectedSeedId && (now - lastSeedSelectedAt) < SEED_COOLDOWN_MS) {
            logger.debug(`[Worker] Seed #${lastSelectedSeedId} cooldown'da, alternatif seed aranıyor...`);
        }

        // Rastgele soru şablonu seç (0-4 arası)
        const questionIdx = Math.floor(Math.random() * 5);
        const thoughtResult = think(memory, neutralEmotion, lastSelectedSeedId, 30, questionIdx, undefined, 'autonomous_worker');
        if (!thoughtResult) {
            // Düşünecek bir tohum bulunamadı. Kısa bekle ve tekrar dene.
            taskQueue.enqueue({ id: `auto_tick_${Date.now()}`, type: 'autonomous_tick', priority: TaskPriority.P4_LOW, payload: {}, addedAt: Date.now() + (30 * 60 * 1000) });
            return;
        }

        // Seçilen seed'i kaydet
        lastSelectedSeedId = thoughtResult.thought.seed.memoryId;
        lastSeedSelectedAt = Date.now();

        if (signal.aborted) return;

        // --- 3. MODEL TIERING: Hafif LLM ile Öz Düşünüm (Self-Reflection) ---
        // Burada ağır bir model yerine arka plan araştırmaları için daha hafif bir model kullanılmalı
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

        // --- 4. OPT F-15: URGE FILTER — Dinamik Değerlendirme (Zod schema 1.2) ---
        let relevanceScore = 0.5;
        let timeSensitivity = 0.3;
        let llmReasoning = '';
        let parseValid = false;
        try {
            const codeFenceMatch = llmThoughtOutput.match(/```json\s*([\s\S]*?)```/i);
            const jsonStr = codeFenceMatch?.[1] ?? llmThoughtOutput;
            const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = ThoughtSchema.safeParse(JSON.parse(jsonMatch[0]));
                if (parsed.success) {
                    parseValid = true;
                    if (parsed.data.relevance !== undefined) {
                        relevanceScore = Math.max(0, Math.min(1, parsed.data.relevance));
                    }
                    if (parsed.data.timeSensitivity !== undefined) {
                        timeSensitivity = Math.max(0, Math.min(1, parsed.data.timeSensitivity));
                    }
                    if (parsed.data.reasoning !== undefined) {
                        llmReasoning = parsed.data.reasoning;
                    }
                } else {
                    logger.warn(`[Worker] LLM JSON schema violation: ${parsed.error.message}`);
                }
            }
        } catch (err) {
            logger.warn({ err }, '[Worker] LLM JSON parse başarısız, güvenli mod devreye girdi.');
        }

        // Parse başarısızsa güvenli mod: relevance/time sıfırlanır → urge filter discard eder
        if (!parseValid) {
            relevanceScore = 0;
            timeSensitivity = 0;
            llmReasoning = '[LLM yanıtı parse edilemedi — güvenli mod]';
        }

        const evaluation = {
            relevanceScore,
            timeSensitivity,
            sourceType: 'thought_chain' as const
        };
        const currentHour = new Date().getHours();
        const decisionResult = filterThought(evaluation, feedbackManager.getState(), currentHour);

        logger.info(`[Worker] ⚖️ Otonom Karar: ${decisionResult.decision.toUpperCase()}. Skor: ${decisionResult.score.toFixed(2)} (Eşik: ${decisionResult.threshold.toFixed(2)}) [Relevance: ${relevanceScore.toFixed(2)}, TimeSensitivity: ${timeSensitivity.toFixed(2)}]`);
        if (llmReasoning) {
            logger.debug(`[Worker] 🧠 LLM Reasoning: ${llmReasoning}`);
        }

        // --- 5. AKSİYON AL ---
        if (decisionResult.decision === 'send') {
            logger.info(`[Worker] 🚀 PROAKTİF MESAJ GÖNDERİLİYOR: ` + llmThoughtOutput.substring(0, 100));
            wss.clients.forEach((client: any) => {
                if (client.readyState === 1 /* WebSocket.OPEN */) {
                    client.send(JSON.stringify({
                        type: 'system_thought',
                        payload: llmThoughtOutput,
                        reasoning: llmReasoning,
                    }));
                }
            });
        } else if (decisionResult.decision === 'digest') {
            logger.info(`[Worker] 📥 Düşünce Digest havuzuna alındı.`);
            const mergeFn = async (oldC: string, newC: string) => oldC + '\n---\n' + newC;
            await memory.addMemory(llmThoughtOutput, 'autonomous_digest', 3, mergeFn, {
                confidence: 0.9,
                source: 'autonomous_think',
            });
        }

        // Bir sonraki döngüyü exponential backoff ile planla
        const feedback = feedbackManager.getState();
        let delayMinutes = 15;

        if (decisionResult.decision === 'send') {
            delayMinutes = 60;
        } else if (decisionResult.decision === 'digest') {
            delayMinutes = 30;
        } else {
            delayMinutes = 15;
        }

        if (feedback.lastSignalAt > 0) {
            const hoursSinceActive = (Date.now() - feedback.lastSignalAt) / (1000 * 60 * 60);
            if (hoursSinceActive > 24) delayMinutes = 1440;
            else if (hoursSinceActive > 4) delayMinutes = 120;
            else if (hoursSinceActive < 0.5) delayMinutes = Math.min(delayMinutes, 30);
        }

        // Update idle threshold based on latest feedback state (4.1)
        const updatedThreshold = computeIdleThreshold(feedback);
        worker.updateIdleThreshold(updatedThreshold);
        logger.debug(`[Worker] Idle threshold updated: ${Math.round(updatedThreshold / 60000)} min`);

        logger.info(`[Worker] ⏭️ Sonraki otonom tick: ${delayMinutes} dakika sonra`);
        taskQueue.enqueue({ id: `auto_tick_${Date.now()}`, type: 'autonomous_tick', priority: TaskPriority.P4_LOW, payload: {}, addedAt: Date.now() + (delayMinutes * 60 * 1000) });
    });

    // 2. Alt Ajan Merak Motoru
    taskQueue.registerHandler('subagent_research', async (payload, signal) => {
        if (signal.aborted) return;
        const fixationTopic = payload.fixationTopic;
        if (!fixationTopic) return;

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

        let researchContent = '';
        if (config.braveSearchApiKey) {
            try {
                const params = new URLSearchParams({
                    q: fixationTopic,
                    count: '3',
                    search_lang: 'tr',
                });
                const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
                    headers: { 'Accept': 'application/json', 'X-Subscription-Token': config.braveSearchApiKey }
                });
                if (response.ok) {
                    const data = await response.json() as any;
                    const results = data?.web?.results || [];
                    if (results.length > 0) {
                        researchContent = results.map((r: any) => `* **${r.title}**: ${r.description}`).join('\\n');
                    }
                }
            } catch (err) {
                logger.warn({ err }, '[Worker] Merak arama API çağrısında hata.');
            }
        }
        
        let subagentPrompt = `Şu arama bulgularını özetle ve genel bilgi ver: ${fixationTopic}.`;
        if (researchContent) {
            subagentPrompt += `\\n\\nBulgular:\\n${researchContent}`;
        }
        
        const mockReportStr = await llm.chat([{ role: 'user', content: subagentPrompt }], { temperature: 0.3, maxTokens: 400 });

        subAgentManager.completeTask(task.id, {
            summary: mockReportStr.content,
            keyFindings: researchContent ? ['Arama sonuçlarından veriler elde edildi'] : ['Varsayılan bilgi (Arama yapılamadı)'],
            sources: researchContent ? ['brave_search'] : ['llm_base_knowledge'],
            relevanceScore: 0.8,
            isTimeSensitive: false,
            generatedAt: new Date().toISOString()
        });

        logger.info(`[Worker] ✅ SubAgent Raporu Tamamlandı: "${fixationTopic}"`);
    });
}
