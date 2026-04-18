import type { LLMProvider } from '../llm/provider.js';
import type { MemoryManager } from '../memory/manager.js';
import type { MemoryRow } from '../memory/types.js';
import { buildLightExtractionPrompt, buildDeepExtractionPrompt, buildSummarizationPrompt, buildEntityExtractionPrompt } from './prompt.js';
import { logger } from '../utils/index.js';

export interface ExtractionContext {
    user: string;
    assistant: string;
    prevAssistant: string;
    userName?: string;
}

export interface ExtractionCheckResult {
    shouldExtract: boolean;
    combinedUser: string;
    combinedAssistant: string;
    combinedPrev: string;
    contextUserName: string;
}

export class MemoryExtractor {
    private llm: LLMProvider;
    private memory: MemoryManager;
    private extractionCounter: number = 0;
    private pendingExtractionContext: ExtractionContext[] = [];
    private graphQueue: Array<{ task: () => Promise<void>; retries: number; maxRetries: number }> = [];
    private isGraphQueueRunning = false;

    static readonly EXTRACTION_INTERVAL = 3;
    static readonly MAX_GRAPH_QUEUE_RETRIES = 3;

    constructor(llm: LLMProvider, memory: MemoryManager) {
        this.llm = llm;
        this.memory = memory;
    }

    createMergeFn(userName: string = 'Kullanıcı'): (oldContent: string, newContent: string) => Promise<string> {
        return async (oldContent: string, newContent: string) => {
            const prompt = `Yeni bilgi: ${newContent}\nEski bilgi: ${oldContent}\n\nEğer yeni bilgi eski bilgiyi geçersiz kılıyorsa (örn: artık eski şehirde yaşamıyor, hobisi değişmiş) sadece yeni bilgiyi tut. Eğer birbirini tamamlıyorsa ikisini mantıklı bir şekilde harmanla. Sadece nihai gerçeği yaz. Ek açıklama yapma. DİKKAT: Nihai birleştirilmiş bilgiyi oluştururken ASLA "Kullanıcı..." diye başlama, ilgili kişinin gerçek adını kullan (Örn: "${userName}..." veya "Ayşegül..."). Çıktının dili Yeni Bilgi'nin yazıldığı dilde olmalıdır.`;
            const res = await this.llm.chat([{ role: 'user', content: prompt }], {
                systemPrompt: 'Sen bir bellek yöneticisisin. Sana verilen bilgileri direktiflere göre birleştir. Sadece sonucu yaz. Asla genel "Kullanıcı" kelimesini kullanma.',
                temperature: 0.1,
                maxTokens: 500,
            });
            return res.content.trim();
        };
    }

    pushExtractionContext(ctx: ExtractionContext): void {
        this.extractionCounter++;
        this.pendingExtractionContext.push(ctx);
        logger.info(`[Agent] 🧪 Hafif tarama kuyruğu güncellendi (${this.extractionCounter}/${MemoryExtractor.EXTRACTION_INTERVAL})`);
    }

    checkAndPrepareExtraction(): ExtractionCheckResult {
        if (this.extractionCounter >= MemoryExtractor.EXTRACTION_INTERVAL) {
            const batchedContext = this.pendingExtractionContext.splice(0);
            this.extractionCounter = 0;

            const combinedUser = batchedContext.map(c => c.user).join('\n');
            const combinedAssistant = batchedContext.map(c => c.assistant).join('\n');
            const combinedPrev = batchedContext.map(c => c.prevAssistant).filter(Boolean).join('\n');
            const contextUserName = batchedContext[0].userName || 'Kullanıcı';

            logger.info(`[Agent] 🚀 Hafif tarama başlatıldı (${batchedContext.length} mesaj çifti birleştirildi)`);

            return {
                shouldExtract: true,
                combinedUser,
                combinedAssistant,
                combinedPrev,
                contextUserName,
            };
        }

        logger.info(`[Agent] ⏳ Hafif tarama ertelendi (${this.extractionCounter}/${MemoryExtractor.EXTRACTION_INTERVAL})`);
        return { shouldExtract: false, combinedUser: '', combinedAssistant: '', combinedPrev: '', contextUserName: '' };
    }

    async extractMemoriesLight(userMessage: string, assistantResponse: string, previousAssistantMessage: string = '', userName: string = 'Kullanıcı'): Promise<void> {
        if (userMessage.trim().length < 15 && previousAssistantMessage.length === 0) {
            logger.info(`[Agent] ⏩ Hafif tarama atlandı (mesaj çok kısa ve bağlam yok)`);
            return;
        }

        try {
            logger.info('[Agent] 🧩 Hafif tarama çalışıyor');
            const extractionPrompt = buildLightExtractionPrompt(userName);

            const similarMemories = await this.getSimilarMemoriesForDedup(userMessage, 10);
            const existingStr = this.formatExistingMemoriesForLLM(similarMemories);

            let contextStr = ``;
            if (previousAssistantMessage) {
                contextStr += `Önceki Soru/Bağlam: ${previousAssistantMessage}\n`;
            }
            contextStr += `Kullanıcı: ${userMessage}\n\nAsistan: ${assistantResponse}${existingStr}`;

            const messages = [{
                role: 'user' as const,
                content: contextStr,
            }];

            const result = await this.llm.chat(messages, {
                systemPrompt: extractionPrompt,
                temperature: 0.3,
                maxTokens: 1024,
            });

            const memories = this.parseExtractionResponse(result.content).slice(0, 3);
            if (memories.length > 0) {
                const mergeFn = this.createMergeFn(userName);

                for (const mem of memories) {
                    const memResult = await this.memory.addMemory(mem.content, mem.category, mem.importance, mergeFn);

                    this.enqueueGraphTask(async () => {
                        try {
                            await this.processMemoryGraphWithLLM(memResult.id, mem.content, userName);
                        } catch (err) {
                            logger.warn({ err }, `[Agent] Graph güncelleme hatası (hafif):`);
                        }
                    });
                }
                logger.info(`[Agent] 🧩 Hafif tarama: ${memories.length} bellek çıkarıldı`);
            } else {
                logger.info('[Agent] 🧩 Hafif tarama tamamlandı, yeni bellek çıkarılmadı');
            }
        } catch (err) {
            logger.error({ err: err }, '[Agent] Hafif bellek çıkarımı başarısız:');
        }
    }

    async extractMemoriesDeep(conversationId: string): Promise<void> {
        try {
            logger.info(`[Agent] 🔍 Derin analiz başlatıldı (konuşma: ${conversationId.substring(0, 8)}...)`);
            const transcript = this.memory.getConversationTranscriptBundle(conversationId, 100);
            if (!transcript || transcript.history.length < 2) {
                logger.info(`[Agent] ⏩ Derin analiz atlandı (konuşma çok kısa: ${conversationId.substring(0, 8)}...)`);
                return;
            }

            const extractionPrompt = buildDeepExtractionPrompt(transcript.userName);

            const lastMessage = transcript.history[transcript.history.length - 1]?.content || '';
            const similarMemories = await this.getSimilarMemoriesForDedup(lastMessage, 10);
            const existingStr = this.formatExistingMemoriesForLLM(similarMemories);

            const messages = [{
                role: 'user' as const,
                content: `${transcript.conversationText}${existingStr}`,
            }];

            logger.debug({
                conversationId,
                transcriptLength: transcript.conversationText.length,
                similarMemoryCount: similarMemories.length,
            }, '[Agent] Deep extraction context prepared');

            const result = await this.llm.chat(messages, {
                systemPrompt: extractionPrompt,
                temperature: 0.3,
                maxTokens: 2048,
            });

            const memories = this.parseExtractionResponse(result.content);
            if (memories.length > 0) {
                const mergeFn = this.createMergeFn(transcript.userName);

                for (const mem of memories) {
                    const memResult = await this.memory.addMemory(mem.content, mem.category, mem.importance, mergeFn);

                    this.enqueueGraphTask(async () => {
                        try {
                            await this.processMemoryGraphWithLLM(memResult.id, mem.content, transcript.userName);
                        } catch (err) {
                            logger.warn({ err }, `[Agent] Graph güncelleme hatası (derin):`);
                        }
                    });
                }
                logger.info(`[Agent] 🔍 Derin analiz: ${memories.length} bellek çıkarıldı (konuşma: ${conversationId.substring(0, 8)}...)`);
            } else {
                logger.info(`[Agent] 🔍 Derin analiz tamamlandı, yeni bellek çıkarılmadı (konuşma: ${conversationId.substring(0, 8)}...)`);
            }
        } catch (err) {
            logger.error({ err: err }, '[Agent] Derin bellek çıkarımı başarısız:');
        }
    }

    async processRawTextForMemories(text: string, userName: string = 'Kullanıcı'): Promise<void> {
        try {
            const extractionPrompt = buildDeepExtractionPrompt(userName);
            const messages = [{
                role: 'user' as const,
                content: text,
            }];

            const result = await this.llm.chat(messages, {
                systemPrompt: extractionPrompt,
                temperature: 0.3,
                maxTokens: 2048,
            });

            const memories = this.parseExtractionResponse(result.content);
            if (memories.length > 0) {
                const mergeFn = this.createMergeFn(userName);
                for (const mem of memories) {
                    const added = await this.memory.addMemory(mem.content, mem.category, mem.importance, mergeFn);

                    this.enqueueGraphTask(async () => {
                        try {
                            await this.processMemoryGraphWithLLM(added.id, mem.content, userName);
                        } catch (err) {
                            logger.warn({ err }, `[Agent] Raw text graph güncelleme hatası:`);
                        }
                    });
                }
                logger.info(`[Agent] 🔍 Düz metin analizi: ${memories.length} bellek çıkarıldı.`);
            }
        } catch (err) {
            logger.error({ err: err }, '[Agent] Düz metinden bellek çıkarımı başarısız:');
        }
    }

    async summarizeConversation(conversationId: string): Promise<void> {
        try {
            const transcript = this.memory.getConversationTranscriptBundle(conversationId, 100);
            if (!transcript || transcript.history.length < 2) return;

            const result = await this.llm.chat(
                [{ role: 'user', content: transcript.conversationText }],
                { systemPrompt: buildSummarizationPrompt(), temperature: 0.2, maxTokens: 512 }
            );

            let summary = result.content.trim();
            let title: string | null = null;

            try {
                const jsonMatch = summary.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    if (parsed.summary) {
                        summary = parsed.summary;
                    }
                    if (parsed.title && typeof parsed.title === 'string') {
                        title = parsed.title.trim().substring(0, 200);
                    }
                }
            } catch {
                // Fallback: ham metin olduğu gibi kaydedilir
            }

            this.memory.updateConversationSummary(conversationId, summary);
            logger.info(`[Agent] 📝 Konuşma özetlendi (${conversationId.substring(0, 8)}...): "${summary.substring(0, 80)}..."`);

            if (title) {
                this.memory.updateConversationTitle(conversationId, title, false);
                logger.info(`[Agent] 🏷️ Konuşma başlığı güncellendi (${conversationId.substring(0, 8)}...): "${title}"`);
            }
        } catch (err) {
            logger.error({ err: err }, '[Agent] Konuşma özetleme başarısız:');
        }
    }

    parseExtractionResponse(content: string): Array<{ content: string; category: string; importance: number }> {
        try {
            let jsonStr = content.trim();
            const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                jsonStr = jsonMatch[0];
            }

            const parsed = JSON.parse(jsonStr);
            if (!Array.isArray(parsed)) return [];

            return parsed.filter((item: any) =>
                item && typeof item.content === 'string' && item.content.length > 0
            ).map((item: any) => ({
                content: item.content,
                category: ['preference', 'fact', 'habit', 'project', 'event', 'other'].includes(item.category) ? item.category : 'other',
                importance: typeof item.importance === 'number' ? Math.min(10, Math.max(1, item.importance)) : 5,
            }));
        } catch {
            return [];
        }
    }

    private async getSimilarMemoriesForDedup(query: string, limit: number = 10): Promise<Array<{ id: number; content: string; similarity: number }>> {
        try {
            const similarMemories = await this.memory.semanticSearch(query, limit);
            return similarMemories
                .filter(m => m.similarity > 0.6)
                .map(m => ({
                    id: m.id,
                    content: m.content,
                    similarity: m.similarity,
                }));
        } catch (err) {
            logger.warn({ err }, '[Agent] Semantic dedup başarısız, fallback kullanılıyor:');
            const fallbackMemories = this.memory.getUserMemories(20);
            return fallbackMemories.map(m => ({
                id: m.id,
                content: m.content,
                similarity: 0,
            }));
        }
    }

    private formatExistingMemoriesForLLM(
        similarMemories: Array<{ id: number; content: string; similarity: number }>
    ): string {
        if (similarMemories.length === 0) return '';

        const existingStr = similarMemories
            .filter(m => m.similarity > 0.7)
            .map((m, i) => {
                const similarityLabel = m.similarity > 0 ? `[benzerlik: ${Math.round(m.similarity * 100)}%]` : '';
                return `${i + 1}. ${m.content} ${similarityLabel}`;
            })
            .join('\n');

        if (!existingStr.trim()) return '';

        return `\n\n## Bellekte Zaten Kayıtlı Benzer Bilgiler (bunları tekrar çıkarma)\n${existingStr}`;
    }

    private async processMemoryGraphWithLLM(memoryId: number, content: string, userName: string = 'Kullanıcı'): Promise<void> {
        try {
            const relatedMemories = await this.memory.hybridSearch(content, 8);
            const filteredRelated = relatedMemories
                .filter(m => m.id !== memoryId)
                .map(m => ({ id: m.id, content: m.content }));

            const extractFn = async (memContent: string, existingEntities: string[]) => {
                const extractionPrompt = buildEntityExtractionPrompt(existingEntities, filteredRelated, userName);
                const result = await this.llm.chat(
                    [{ role: 'user', content: memContent }],
                    { systemPrompt: extractionPrompt, temperature: 0.2, maxTokens: 1024 }
                );

                let jsonStr = result.content.trim();

                jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

                const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    return { entities: [], relations: [] };
                }
                jsonStr = jsonMatch[0];

                jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1');

                interface ParsedGraphResult {
                    entities?: Array<{ name?: string; type?: string }>;
                    relations?: Array<{ targetMemoryId?: number; relation?: string; relationType?: string; confidence?: number; description?: string }>;
                }

                let parsed: ParsedGraphResult;
                try {
                    parsed = JSON.parse(jsonStr);
                } catch {
                    return { entities: [], relations: [] };
                }
                return {
                    entities: Array.isArray(parsed.entities) ? parsed.entities.filter(
                        (e): e is { name: string; type: string } =>
                            e != null && typeof e.name === 'string' && e.name.length > 0
                    ).map((e) => ({
                        name: e.name,
                        type: ['person', 'technology', 'project', 'place', 'organization', 'concept'].includes(e.type) ? e.type : 'concept',
                    })) : [],
                    relations: Array.isArray(parsed.relations) ? parsed.relations.filter(
                        (r): r is { targetMemoryId: number; relationType?: string; relation?: string; confidence?: number; description?: string } =>
                            r != null && typeof r.targetMemoryId === 'number' &&
                            filteredRelated.some(m => m.id === r.targetMemoryId)
                    ).map((r) => ({
                        targetMemoryId: r.targetMemoryId,
                        relationType: ['related_to', 'supports', 'contradicts', 'caused_by', 'part_of'].includes(r.relationType ?? r.relation ?? '') ? (r.relationType ?? r.relation ?? 'related_to') : 'related_to',
                        confidence: typeof r.confidence === 'number' ? Math.min(1, Math.max(0, r.confidence)) : 0.5,
                        description: typeof r.description === 'string' ? r.description.substring(0, 200) : '',
                    })) : [],
                };
            };

            await this.memory.processMemoryGraph(memoryId, content, extractFn);
            logger.info(`[Agent] 🕸️ Memory graph güncellendi (id=${memoryId})`);
        } catch (err) {
            logger.warn({ err: err }, `[Agent] ⚠️ Memory graph LLM extraction başarısız (id=${memoryId}):`);
        }
    }

    private async _runGraphQueue(): Promise<void> {
        if (this.isGraphQueueRunning) return;
        this.isGraphQueueRunning = true;

        while (this.graphQueue.length > 0) {
            const queueItem = this.graphQueue.shift();
            if (!queueItem) continue;

            const { task, retries, maxRetries } = queueItem;
            try {
                await task();
            } catch (err) {
                if (retries < maxRetries) {
                    const backoffMs = Math.min(1000 * Math.pow(2, retries), 10000);
                    logger.warn(`[Agent] Graph extraction task failed (attempt ${retries + 1}/${maxRetries + 1}), retrying in ${backoffMs}ms`);

                    setTimeout(() => {
                        this.graphQueue.unshift({ task, retries: retries + 1, maxRetries });
                        this._runGraphQueue().catch(() => {});
                    }, backoffMs);
                    break;
                } else {
                    logger.error({ err }, `[Agent] Background Graph extraction task failed after ${maxRetries + 1} attempts, giving up`);
                }
            }
        }

        this.isGraphQueueRunning = false;
    }

    enqueueGraphTask(task: () => Promise<void>): void {
        this.graphQueue.push({ task, retries: 0, maxRetries: MemoryExtractor.MAX_GRAPH_QUEUE_RETRIES });
        this._runGraphQueue().catch(() => {});
    }
}