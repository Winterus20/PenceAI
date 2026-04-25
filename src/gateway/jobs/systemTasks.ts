import type { TaskQueue } from '../../autonomous/index.js';
import type { MemoryManager } from '../../memory/manager.js';
import type { AgentRuntime } from '../../agent/runtime.js';
import { logger } from '../../utils/logger.js';

export interface SystemJobsDeps {
    memory: MemoryManager;
    agent: AgentRuntime;
    broadcastStats: () => void;
}

export function registerSystemJobs(taskQueue: TaskQueue, deps: SystemJobsDeps): void {
    const { memory, agent, broadcastStats } = deps;

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

    taskQueue.registerHandler('deep_memory_extraction', async (payload, signal) => {
        if (signal.aborted) return;
        try {
            await agent.extractMemoriesDeep(payload.conversationId);
        } catch (err) {
            logger.error({ err }, '[Worker] Derin bellek çıkarımı hatası');
        }
    });

    taskQueue.registerHandler('conversation_summarization', async (payload, signal) => {
        if (signal.aborted) return;
        try {
            await agent.summarizeConversation(payload.conversationId);
        } catch (err) {
            logger.error({ err }, '[Worker] Konuşma özetleme hatası');
        }
    });

    taskQueue.registerHandler('insight_prune', async (_payload, signal) => {
        if (signal.aborted) return;
        try {
            const engine = memory.getInsightEngine();
            const result = engine.prune();
            if (result.pruned > 0 || result.suppressed > 0) {
                logger.info(`[Worker] 🧠 Insight bakımı: ${result.pruned} pruned, ${result.suppressed} suppressed`);
            }
        } catch (err) {
            logger.error({ err }, '[Worker] Insight prune hatası');
        }
    });
}
