import type { LLMProvider } from '../llm/provider.js';
import { TOOL_CALL_CLEAR_SIGNAL } from '../llm/provider.js';
import type { UnifiedMessage, ConversationMessage, LLMMessage, LLMResponse, ToolCall } from '../router/types.js';
import { MemoryManager } from '../memory/manager.js';
import { buildSystemPrompt, getBuiltinToolDefinitions, buildLightExtractionPrompt, buildDeepExtractionPrompt, buildSummarizationPrompt, buildEntityExtractionPrompt } from './prompt.js';
import { createBuiltinTools, type ToolExecutor, type ConfirmCallback } from './tools.js';
import { logger } from '../utils/logger.js';
import type { FeedbackManager } from '../autonomous/urgeFilter.js';
import type { TaskQueue } from '../autonomous/queue.js';
import { TaskPriority } from '../autonomous/queue.js';
import { formatRecentContextMessages, pruneConversationHistory } from './runtimeContext.js';

const MAX_TOOL_ITERATIONS = 5;

export interface AgentEvent {
    type: 'thinking' | 'tool_start' | 'tool_end' | 'iteration' | 'token' | 'clear_stream';
    data: Record<string, unknown>;
}

export type AgentEventCallback = (event: AgentEvent) => void;

/**
 * Agent Runtime — ReAct (Reason → Act → Observe) döngüsü.
 *
 * Kullanıcı mesajını alır, LLM ile etkileşime girer,
 * gerekirse araçları çağırır ve sonucu döndürür.
 */
export class AgentRuntime {
    private llm: LLMProvider;
    private memory: MemoryManager;
    private tools: Map<string, ToolExecutor> = new Map();
    private toolDefinitions = getBuiltinToolDefinitions();

    // Light extraction throttle — her mesajda değil, her N mesajda bir LLM çağrısı ya
    private _extractionCounter: number = 0;
    private static readonly EXTRACTION_INTERVAL = 3; // 3 mesajda 1 extraction
    private _pendingExtractionContext: Array<{ user: string; assistant: string; prevAssistant: string; userName?: string }> = [];

    private feedbackManager?: FeedbackManager;
    private taskQueue?: TaskQueue;
    private _lastConfirmCallback?: ConfirmCallback;

    constructor(llm: LLMProvider, memory: MemoryManager) {
        this.llm = llm;
        this.memory = memory;
    }

    private beginConversationTurn(message: UnifiedMessage, userMessage: ConversationMessage) {
        return this.memory.beginConversationTurn(
            message.channelType,
            message.channelId,
            message.senderName,
            userMessage,
            100,
        );
    }

    private addConversationMessage(
        conversationId: string,
        message: Pick<ConversationMessage, 'role' | 'content' | 'timestamp' | 'toolCalls' | 'toolResults'>,
    ): void {
        this.memory.addMessage(conversationId, message);
    }

    private scheduleConversationAnalysis(conversationId: string): Promise<void> {
        return Promise.all([
            this.extractMemoriesDeep(conversationId),
            this.summarizeConversation(conversationId),
        ]).then(() => undefined);
    }

    /**
     * OPT F-04: Bellek birleştirme fonksiyonunu tek noktadan üretir.
     * Hem hafif hem derin çıkarımda kullanılır.
     */
    private createMergeFn(userName: string = 'Kullanıcı'): (oldContent: string, newContent: string) => Promise<string> {
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

    /**
     * Otonom sistem yöneticilerini bağlar (Feedback)
     */
    setAutonomousManagers(feedbackManager: FeedbackManager) {
        this.feedbackManager = feedbackManager;
        logger.info('[Agent] 🔌 Autonomous managers (Feedback) connected to runtime.');
    }

    /**
     * TaskQueue referansını bağlar — arka plan LLM görevleri kuyruğa alınır.
     */
    setTaskQueue(queue: TaskQueue) {
        this.taskQueue = queue;
        logger.info('[Agent] 🔌 TaskQueue connected to runtime.');
    }

    private createUserConversationMessage(
        message: UnifiedMessage,
        getBase64: (buf: Buffer) => string | undefined,
    ): ConversationMessage {
        const attachmentMeta = message.attachments.length > 0
            ? message.attachments.map(att => ({
                fileName: att.fileName ?? 'dosya',
                mimeType: att.mimeType,
                size: att.size,
                data: att.type === 'image' && att.data instanceof Buffer
                    ? getBase64(att.data as Buffer)
                    : undefined,
            }))
            : undefined;

        return {
            role: 'user',
            content: message.content,
            timestamp: message.timestamp,
            attachments: attachmentMeta,
        };
    }

    private handleClosedConversation(previousConversationId?: string): void {
        if (!previousConversationId) {
            return;
        }

        logger.info(`[Agent] 🔍 Derin analiz planlandı (kapanan konuşma: ${previousConversationId.substring(0, 8)}...)`);

        if (this.taskQueue) {
            this.taskQueue.enqueue({
                id: `deep_extract_${previousConversationId}`,
                type: 'deep_memory_extraction',
                priority: TaskPriority.P3_NORMAL,
                payload: { conversationId: previousConversationId },
                addedAt: Date.now(),
            });
            this.taskQueue.enqueue({
                id: `summarize_${previousConversationId}`,
                type: 'conversation_summarization',
                priority: TaskPriority.P3_NORMAL,
                payload: { conversationId: previousConversationId },
                addedAt: Date.now(),
            });
            logger.info(`[Agent] 🗂️ Derin analiz ve özet kuyruğa alındı (konuşma: ${previousConversationId.substring(0, 8)}...)`);
            return;
        }

        this.scheduleConversationAnalysis(previousConversationId).catch(err => {
            logger.error({ err: err }, '[Agent] Arka plan analizi hatası:');
        });
    }

    /**
     * Gelen mesajı işler ve yanıt oluşturur.
     * @param onEvent — düşünme ve araç olaylarını gerçek zamanlı göndermek için callback
     */
    async processMessage(
        message: UnifiedMessage,
        onEvent?: AgentEventCallback,
        confirmCallback?: ConfirmCallback,
        options?: { thinking?: boolean },
    ): Promise<{ response: string; conversationId: string }> {
        const startTimeMs = Date.now();

        // 1. Geri Bildirim Döngüsü — Etkileşim geldiğinde cezaları sıfırla
        if (this.feedbackManager) {
            this.feedbackManager.applySignal({ type: 'active_chat', timestamp: startTimeMs });
        }

        // OPT-2: Mükerrer Base64 dönüşümünü önlemek için cache mekanizması
        const base64Cache = new Map<Buffer, string>();
        const getBase64 = (buf: Buffer) => {
            if (!base64Cache.has(buf)) base64Cache.set(buf, buf.toString('base64'));
            return base64Cache.get(buf);
        };

        const userMessage = this.createUserConversationMessage(message, getBase64);
        let { conversationId, previousConversationId, history } = this.beginConversationTurn(message, userMessage);

        this.handleClosedConversation(previousConversationId);

        // OPT F-03: Lazy init — araçları yalnızca confirmCallback değiştiğinde yeniden oluştur
        // Burada memory merge işlemi kullanılabilir diye userName bilgisini geçiriyoruz
        if (!this._lastConfirmCallback || this._lastConfirmCallback !== confirmCallback) {
            const builtinTools = createBuiltinTools(this.memory, confirmCallback, this.createMergeFn(message.senderName || 'Kullanıcı'));
            this.tools.clear();
            for (const tool of builtinTools) {
                this.tools.set(tool.name, tool);
            }
            this._lastConfirmCallback = confirmCallback;
        }

        // --- Sliding Window Context Budaması (Atomik Çift-Korumalı) ---
        // assistant(toolCalls) + tool(toolResults) çiftleri bölünemez birim olarak ele alınır.
        // Böylece MiniMax/OpenAI'da "tool result not found" veya "does not follow" hataları önlenir.
        const MAX_HISTORY_TOKENS = 6000;
        const prunedHistory = pruneConversationHistory(
            history,
            this.estimateMessageTokens.bind(this),
            MAX_HISTORY_TOKENS,
        );
        history = prunedHistory.history;
        if (prunedHistory.prunedChunkCount > 0) {
            logger.info(`[Agent] ✂️ Context sınırına ulaşıldı (${MAX_HISTORY_TOKENS} token). ${prunedHistory.prunedChunkCount} eski chunk budandı.`);
        }
        if (prunedHistory.repairedAssistantCount > 0) {
            logger.info(`[Agent] ⚠️ ${prunedHistory.repairedAssistantCount} eşsiz assistant(toolCalls) mesajı düzeltildi.`);
        }
        if (prunedHistory.skippedToolCount > 0) {
            logger.info(`[Agent] ⚠️ ${prunedHistory.skippedToolCount} eşsiz tool result mesajı atlandı.`);
        }

        // Kullanıcı belleklerini akıllı şekilde al — hibrit arama (FTS + Semantik)
        // + geçmiş konuşma özetleri + review due bellekler paralel çekilir
        const {
            relevantMemories,
            archivalMemories,
            supplementalMemories,
            conversationSummaries,
            reviewMemories,
            followUpCandidates,
            recentMessages,
        } = await this.memory.getPromptContextBundle(message.content, conversationId);

        let memoryStrings = [
            ...relevantMemories.map(m => m.content),
            ...supplementalMemories.map(m => m.content),
        ];

        // Archival bellekleri prompt için hazırla (aktif belleklerden ayrı)
        const archivalMemoryStrings = archivalMemories.map(m => m.content);

        // Context bütçesi: toplam bellek metni ~1500 token'i aşmasın
        const MAX_MEMORY_TOKENS = 1500;
        const trimmedMemories: string[] = [];
        let memoryTokensUsed = 0;

        for (const mem of memoryStrings) {
            const tokens = this.estimateTokens(mem);
            if (memoryTokensUsed + tokens > MAX_MEMORY_TOKENS) {
                logger.info(`[Agent] ✂️ Hafıza context sınırına ulaşıldı (${MAX_MEMORY_TOKENS} token).`);
                break;
            }
            trimmedMemories.push(mem);
            memoryTokensUsed += tokens;
        }
        memoryStrings = trimmedMemories;

        const recentContextStrings = formatRecentContextMessages(recentMessages);

        // Sistem prompt'unu oluştur — ilişkisel bağlam da ekle
        const memoryRelations = this.getMemoryRelationsForPrompt(relevantMemories);

        const systemPrompt = buildSystemPrompt(
            message.senderName,
            memoryStrings,
            recentContextStrings,
            conversationSummaries,
            reviewMemories.map(m => m.content),
            memoryRelations,
            archivalMemoryStrings,
            followUpCandidates.map(m => m.content)
        );

        // LLM mesajlarını hazırla
        const llmMessages: LLMMessage[] = history.map(h => ({
            role: h.role,
            content: h.content,
            toolCalls: h.toolCalls,
            toolResults: h.toolResults,
        }));

        // Mevcut kullanıcı mesajındaki görselleri son user LLMMessage'a enjekte et
        const imageAttachments = message.attachments.filter(a => a.type === 'image' && a.data && a.data.length > 0);
        if (imageAttachments.length > 0) {
            // En son user mesajını bul (history'nin en sonunda olmalı)
            for (let i = llmMessages.length - 1; i >= 0; i--) {
                if (llmMessages[i].role === 'user') {
                    llmMessages[i].imageBlocks = imageAttachments.map(a => ({
                        mimeType: a.mimeType,
                        data: getBase64(a.data as Buffer)!, // CACHED & Guaranteed
                        fileName: a.fileName,
                    }));
                    break;
                }
            }
        }

        // ReAct döngüsü
        let response = '';
        let iterations = 0;

        while (iterations < MAX_TOOL_ITERATIONS) {
            iterations++;

            logger.info(`[Agent] 🧠 LLM çağrılıyor (iterasyon ${iterations})...`);
            onEvent?.({ type: 'iteration', data: { iteration: iterations } });

            const chatOptions = {
                systemPrompt,
                tools: this.toolDefinitions,
                temperature: 0.7,
                maxTokens: 4096,
                thinking: options?.thinking,
            };

            let llmResponse: LLMResponse;
            if (this.llm.chatStream) {
                llmResponse = await this.llm.chatStream(llmMessages, chatOptions, (token) => {
                    if (token === TOOL_CALL_CLEAR_SIGNAL) {
                        // Provider tool call tespit etti — önceden stream edilmiş metni anında temizle
                        onEvent?.({ type: 'clear_stream', data: {} });
                    } else {
                        onEvent?.({ type: 'token', data: { content: token } });
                    }
                });
            } else {
                llmResponse = await this.llm.chat(llmMessages, chatOptions);
            }

            // <think> etiketlerini içerikten temizle (güvenlik için her durumda)
            const cleanContent = (llmResponse.content || '')
                .replace(/<think>[\s\S]*?<\/think>/gi, '')
                .replace(/<think>[\s\S]*/g, '')
                .trim();

            // Gerçek düşünme içeriği (reasoning_split: true ile gelir, thinking: true ise)
            const thinkingContent = llmResponse.thinkingContent;

            // Fallback: Model tool_calls array yerine content içerisine direkt JSON döndürdüyse
            if ((!llmResponse.toolCalls || llmResponse.toolCalls.length === 0) && cleanContent) {
                try {
                    // Sadece JSON objesini yakalamaya çalış (bazen markdown veya ekstra metinle sarmalanmış olabilir)
                    const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        const parsed = JSON.parse(jsonMatch[0]);
                        // Eğer JSON bir array değilse ve type="function", veya name varsa bunu bir ToolCall olarak ele al
                        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                            if (parsed.name || (parsed.type === 'function' && parsed.function?.name)) {
                                const toolName = parsed.name || parsed.function.name;
                                const toolArgs = parsed.arguments || parsed.parameters || parsed.function?.arguments || parsed;

                                llmResponse.toolCalls = [{
                                    id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                                    name: toolName,
                                    arguments: typeof toolArgs === 'string' ? JSON.parse(toolArgs) : toolArgs
                                }];
                                logger.warn(`[Agent] ⚠️ Model tool'u string content olarak döndürdü. Fallback parser ile yakalandı: ${toolName}`);
                                // tool_call haline geldiği için content'i temizle, böylece kullanıcıya JSON görünmez
                                llmResponse.content = '';
                                // Streaming sırasında zaten gönderilmiş olan JSON tokenlarını temizle
                                onEvent?.({ type: 'clear_stream', data: {} });
                            }
                        }
                    }
                } catch {
                    // Parse edilemiyorsa sadece düz metindir, normal devam et
                }
            }

            // Araç çağrısı varsa
            if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
                // İlk mesajda searchConversation çağrısını engelle — henüz aranacak geçmiş yok
                const isFirstMessage = history.filter(h => h.role === 'user').length <= 1;
                if (isFirstMessage) {
                    llmResponse.toolCalls = llmResponse.toolCalls.filter(tc => {
                        if (tc.name === 'searchConversation') {
                            logger.info(`[Agent] 🚫 searchConversation ilk mesajda engellendi.`);
                            return false;
                        }
                        return true;
                    });
                    // Tüm araç çağrıları filtrelendiyse normal yanıt olarak devam et
                    if (llmResponse.toolCalls.length === 0) {
                        response = llmResponse.content || cleanContent || '';
                        if (thinkingContent) {
                            onEvent?.({ type: 'thinking', data: { content: thinkingContent } });
                        }
                        break;
                    }
                }

                // Gerçek düşünme içeriği varsa frontend'e gönder
                if (thinkingContent) {
                    onEvent?.({ type: 'thinking', data: { content: thinkingContent } });
                }

                logger.info(`[Agent] 🔧 ${llmResponse.toolCalls.length} araç çağrılıyor...`);

                // Asistan mesajını ekle — düşünme içeriği LLM geçmişi için <think> ile saklanır
                const historyContent = thinkingContent
                    ? `<think>${thinkingContent}</think>\n${llmResponse.content || ''}`
                    : (llmResponse.content || '');
                const assistantMessage: LLMMessage = {
                    role: 'assistant',
                    content: historyContent,
                    toolCalls: llmResponse.toolCalls,
                };
                llmMessages.push(assistantMessage);

                // Araçları çalıştır — her biri için event gönder
                const toolResults = await this.executeToolsWithEvents(llmResponse.toolCalls, onEvent);

                // Araç sonuçlarını ekle
                const toolMessage: LLMMessage = {
                    role: 'tool',
                    content: '',
                    toolResults,
                };
                llmMessages.push(toolMessage);

                // Araç sonuçlarını veritabanına kaydet (temiz içerikle, düşünme olmadan)
                this.addConversationMessage(conversationId, {
                    role: 'assistant',
                    content: llmResponse.content || '',
                    timestamp: new Date(),
                    toolCalls: llmResponse.toolCalls,
                });
                this.addConversationMessage(conversationId, {
                    role: 'tool',
                    content: '',
                    timestamp: new Date(),
                    toolResults,
                });

                continue; // LLM'e tekrar dön
            }

            // Araç çağrısı yok — son yanıt
            response = llmResponse.content || cleanContent;
            // Son yanıt için de düşünme içeriğini gönder (varsa)
            if (thinkingContent) {
                onEvent?.({ type: 'thinking', data: { content: thinkingContent } });
            }
            break;
        }

        if (!response) {
            response = '⚠️ Yanıt oluşturulamadı.';
        }

        if (iterations >= MAX_TOOL_ITERATIONS) {
            response += '\n\n⚠️ Maksimum araç iterasyon sayısına ulaşıldı.';
        }

        // Asistan yanıtını kaydet
        this.addConversationMessage(conversationId, {
            role: 'assistant',
            content: response,
            timestamp: new Date(),
        });

        logger.info(`[Agent] ✅ Yanıt oluşturuldu (${response.length} karakter, ${iterations} iterasyon)`);

        // Geri Bildirim Döngüsü — Yanıt süresini kaydet
        if (this.feedbackManager) {
            const responseTimeMs = Date.now() - startTimeMs;
            this.feedbackManager.applySignal({ type: 'message_replied', timestamp: Date.now(), responseTimeMs });
        }

        // Kullanıcının mesajından önceki asistan mesajını (bağlam) bul
        let previousAssistantMessage = '';
        if (history.length > 0) {
            // History sondan başa sondaki eleman kullanıcının mesajı DEĞİLDİR (çünkü processMessage metodunun başında eklenir, ama history argümanına gelmez)
            // history listesini sondan tarayarak en son asistan mesajını bulalım
            for (let i = history.length - 1; i >= 0; i--) {
                if (history[i].role === 'assistant') {
                    previousAssistantMessage = history[i].content;
                    break;
                }
            }
        }

        // Arka planda hafif bellek çıkarımı — throttle: her 3 mesajda bir LLM çağrısı
        this._extractionCounter++;
        this._pendingExtractionContext.push({
            user: message.content,
            assistant: response,
            prevAssistant: previousAssistantMessage,
            userName: message.senderName // userName takibini buraya kaydet
        });

        logger.info(`[Agent] 🧪 Hafif tarama kuyruğu güncellendi (${this._extractionCounter}/${AgentRuntime.EXTRACTION_INTERVAL})`);

        if (this._extractionCounter >= AgentRuntime.EXTRACTION_INTERVAL) {
            // Biriken bağlamı birleştirip tek bir extraction isteği gönder
            const batchedContext = this._pendingExtractionContext.splice(0);
            this._extractionCounter = 0;

            const combinedUser = batchedContext.map(c => c.user).join('\n');
            const combinedAssistant = batchedContext.map(c => c.assistant).join('\n');
            const combinedPrev = batchedContext.map(c => c.prevAssistant).filter(Boolean).join('\n');
            const contextUserName = batchedContext[0].userName || 'Kullanıcı';

            logger.info(`[Agent] 🚀 Hafif tarama başlatıldı (${batchedContext.length} mesaj çifti birleştirildi)`);

            this.extractMemoriesLight(combinedUser, combinedAssistant, combinedPrev, contextUserName).catch(err => {
                logger.error({ err: err }, '[Agent] Hafif bellek çıkarımı hatası:');
            });
        } else {
            logger.info(`[Agent] ⏳ Hafif tarama ertelendi (${this._extractionCounter}/${AgentRuntime.EXTRACTION_INTERVAL})`);
        }

        return { response, conversationId };
    }

    // ========== Otomatik Bellek Çıkarımı ==========

    /**
     * Belleklerin ilişkisel bağlamını prompt için hazırlar.
     * İlgili belleklerin aralarındaki graph ilişkilerini çıkarır.
     */
    private getMemoryRelationsForPrompt(memories: Array<{ id: number; content: string }>): Array<{ source: string; target: string; relation: string; description: string }> {
        if (memories.length < 2) return [];

        const relations: Array<{ source: string; target: string; relation: string; description: string }> = [];
        const memoryContentMap = new Map(memories.map(m => [m.id, m.content]));
        const memoryIds = memories.map(m => m.id);
        const seenKeys = new Set<string>();

        // OPT-1: N+1 Sorgu Giderimi — Tüm komşuları tek sorguda çek
        const neighborsMap = this.memory.getMemoryNeighborsBatch(memoryIds, 5);

        for (const memId of memoryIds) {
            const neighbors = neighborsMap.get(memId) || [];
            for (const n of neighbors) {
                // Sadece prompt'a dahil edilen bellekler arasındaki ilişkileri göster
                if (memoryContentMap.has(n.id)) {
                    // Duplicate kontrolü — canonical key (küçük ID önce)
                    const key = [memId, n.id].sort((a, b) => a - b).join('-');
                    if (seenKeys.has(key)) continue;
                    seenKeys.add(key);

                    relations.push({
                        source: memoryContentMap.get(memId)!.substring(0, 60),
                        target: memoryContentMap.get(n.id)!.substring(0, 60),
                        relation: n.relation_type,
                        description: n.relation_description || '',
                    });
                }
            }
        }

        // Maksimum 15 ilişki göster (token bütçesi - 2-hop için artırıldı)
        return relations.slice(0, 15);
    }

    /**
     * LLM ile entity extraction yapıp memory graph'ı günceller.
     * addMemory sonrası arka planda çağrılır.
     */
    private async processMemoryGraphWithLLM(memoryId: number, content: string, userName: string = 'Kullanıcı'): Promise<void> {
        try {
            // İlgili bellekleri bul (entity extraction prompt'una bağlam olarak verilecek)
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

                // Parse JSON response — robustly handle markdown fences, extra text, trailing commas
                let jsonStr = result.content.trim();

                // 1) Markdown code fence temizle: ```json ... ``` veya ``` ... ```
                jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

                // 2) İlk { ... son } bloğunu çıkar
                const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    // JSON bulunamadı — boş sonuç dön, hata fırlatma
                    return { entities: [], relations: [] };
                }
                jsonStr = jsonMatch[0];

                // 3) Trailing comma düzelt: ,] ve ,} → ] ve }
                jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1');

                let parsed: any;
                try {
                    parsed = JSON.parse(jsonStr);
                } catch {
                    // Hâlâ parse edilemiyorsa boş sonuç dön — loglamadan sessizce geç
                    return { entities: [], relations: [] };
                }
                return {
                    entities: Array.isArray(parsed.entities) ? parsed.entities.filter(
                        (e: any) => e && typeof e.name === 'string' && e.name.length > 0
                    ).map((e: any) => ({
                        name: e.name,
                        type: ['person', 'technology', 'project', 'place', 'organization', 'concept'].includes(e.type) ? e.type : 'concept',
                    })) : [],
                    relations: Array.isArray(parsed.relations) ? parsed.relations.filter(
                        (r: any) => r && typeof r.targetMemoryId === 'number' &&
                            filteredRelated.some(m => m.id === r.targetMemoryId)
                    ).map((r: any) => ({
                        targetMemoryId: r.targetMemoryId,
                        relationType: ['related_to', 'supports', 'contradicts', 'caused_by', 'part_of'].includes(r.relationType) ? r.relationType : 'related_to',
                        confidence: typeof r.confidence === 'number' ? Math.min(1, Math.max(0, r.confidence)) : 0.5,
                        description: typeof r.description === 'string' ? r.description.substring(0, 200) : '',
                    })) : [],
                };
            };

            await this.memory.processMemoryGraph(memoryId, content, extractFn);
            logger.info(`[Agent] 🕸️ Memory graph güncellendi (id=${memoryId})`);
        } catch (err) {
            // JSON parse veya LLM hatası — sessizce geç. Proximity ilişkileri addMemory'de zaten kuruldu.
            logger.warn({ err: err }, `[Agent] ⚠️ Memory graph LLM extraction başarısız (id=${memoryId}):`);
        }
    }

    /**
     * Konuşmayı JSON formatında özetler ve veritabanına kaydeder.
     * Konuşma timeout'la kapandığında arka planda tetiklenir.
     */
    async summarizeConversation(conversationId: string): Promise<void> {
        try {
            const transcript = this.memory.getConversationTranscriptBundle(conversationId, 100);
            if (!transcript || transcript.history.length < 2) return; // Çok kısa konuşmaları atla

            const result = await this.llm.chat(
                [{ role: 'user', content: transcript.conversationText }],
                { systemPrompt: buildSummarizationPrompt(), temperature: 0.2, maxTokens: 512 }
            );

            let summary = result.content.trim();

            // JSON parse — sadece summary alanını al; başarısızsa plain-text fallback
            try {
                const jsonMatch = summary.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    if (parsed.summary) {
                        summary = parsed.summary;
                    }
                }
            } catch {
                // Fallback: ham metin olduğu gibi kaydedilir
            }

            this.memory.updateConversationSummary(conversationId, summary);
            logger.info(`[Agent] 📝 Konuşma özetlendi (${conversationId.substring(0, 8)}...): "${summary.substring(0, 80)}..."`);
        } catch (err) {
            logger.error({ err: err }, '[Agent] Konuşma özetleme başarısız:');
        }
    }


    /**
     * Hafif bellek çıkarımı — son mesaj çiftinden hızlı bilgi çıkarır.
     * Arka planda çalışır, kullanıcı yanıtını beklemez.
     */
    private async extractMemoriesLight(userMessage: string, assistantResponse: string, previousAssistantMessage: string = '', userName: string = 'Kullanıcı'): Promise<void> {
        // Skip extraction for very short messages to save LLM API costs
        if (userMessage.trim().length < 15 && previousAssistantMessage.length === 0) {
            logger.info(`[Agent] ⏩ Hafif tarama atlandı (mesaj çok kısa ve bağlam yok)`);
            return;
        }

        try {
            logger.info('[Agent] 🧩 Hafif tarama çalışıyor');
            const extractionPrompt = buildLightExtractionPrompt(userName);

            // Mevcut bellekleri LLM'e göster — tekrar çıkarımını engelle
            const existingMemories = this.memory.getUserMemories(20);
            const existingStr = existingMemories.length > 0
                ? `\n\n## Bellekte Zaten Kayıtlı Bilgiler (bunları tekrar çıkarma)\n${existingMemories.map((m, i) => `${i + 1}. ${m.content}`).join('\n')}`
                : '';

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

            const memories = this.parseExtractionResponse(result.content).slice(0, 3); // Max 3 bellek / çalışma
            if (memories.length > 0) {
                const mergeFn = this.createMergeFn(userName);

                for (const mem of memories) {
                    const result = await this.memory.addMemory(mem.content, mem.category, mem.importance, mergeFn);

                    // Arka planda memory graph'ı güncelle
                    this.processMemoryGraphWithLLM(result.id, mem.content, userName).catch(err => {
                        logger.warn({ err: err }, `[Agent] Graph güncelleme hatası (hafif):`);
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

    /**
     * Derin bellek çıkarımı — tüm konuşmayı analiz eder.
     * Konuşma sona erdiğinde (timeout veya yeni sohbet) tetiklenir.
     */
    async extractMemoriesDeep(conversationId: string): Promise<void> {
        try {
            logger.info(`[Agent] 🔍 Derin analiz başlatıldı (konuşma: ${conversationId.substring(0, 8)}...)`);
            const transcript = this.memory.getConversationTranscriptBundle(conversationId, 100);
            if (!transcript || transcript.history.length < 2) {
                logger.info(`[Agent] ⏩ Derin analiz atlandı (konuşma çok kısa: ${conversationId.substring(0, 8)}...)`);
                return;
            }

            const extractionPrompt = buildDeepExtractionPrompt(transcript.userName);
            const existingMemories = this.memory.getUserMemories(30);
            const existingStr = existingMemories.length > 0
                ? `\n\n## Bellekte Zaten Kayıtlı Bilgiler (bunları tekrar çıkarma)\n${existingMemories.map((m, i) => `${i + 1}. ${m.content}`).join('\n')}`
                : '';
            const messages = [{
                role: 'user' as const,
                content: `${transcript.conversationText}${existingStr}`,
            }];

            logger.debug({
                conversationId,
                transcriptLength: transcript.conversationText.length,
                existingMemoryCount: existingMemories.length,
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
                    const result = await this.memory.addMemory(mem.content, mem.category, mem.importance, mergeFn);

                    // Arka planda memory graph'ı güncelle
                    this.processMemoryGraphWithLLM(result.id, mem.content, transcript.userName).catch(err => {
                        logger.warn({ err: err }, `[Agent] Graph güncelleme hatası (derin):`);
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

    /**
     * Düz metinden (örneğin onboarding biyografisi) bellek ve entity çıkarımı yapar.
     */
    public async processRawTextForMemories(text: string, userName: string = 'Kullanıcı'): Promise<void> {
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

                    // Arka planda memory graph'ı güncelle
                    this.processMemoryGraphWithLLM(added.id, mem.content, userName).catch(err => {
                        logger.warn({ err: err }, `[Agent] Raw text graph güncelleme hatası:`);
                    });
                }
                logger.info(`[Agent] 🔍 Düz metin analizi: ${memories.length} bellek çıkarıldı.`);
            }
        } catch (err) {
            logger.error({ err: err }, '[Agent] Düz metinden bellek çıkarımı başarısız:');
        }
    }

    /**
     * LLM'den dönen extraction yanıtını parse eder.
     */
    private parseExtractionResponse(content: string): Array<{ content: string; category: string; importance: number }> {
        try {
            // JSON bloğunu bul (bazen LLM markdown code block ile sarar)
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

    /**
     * Araç çağrılarını paralel yürütür ve her adımda event gönderir.
     * Bağımsız araçlar (webSearch, dosya okuma vb.) eşzamanlı çalışır.
     */
    private async executeToolsWithEvents(toolCalls: ToolCall[], onEvent?: AgentEventCallback) {
        // Tüm araçları paralel başlat
        const promises = toolCalls.map(async (tc) => {
            const tool = this.tools.get(tc.name);
            let result: string;
            let isError = false;

            // Araç başlangıç event'i
            onEvent?.({
                type: 'tool_start',
                data: { name: tc.name, arguments: tc.arguments },
            });

            if (!tool) {
                result = `Hata: Bilinmeyen araç: ${tc.name}`;
                isError = true;
            } else {
                try {
                    logger.info(`[Agent]   → ${tc.name}(${JSON.stringify(tc.arguments).substring(0, 100)})`);
                    result = await tool.execute(tc.arguments);
                } catch (err: any) {
                    result = `Hata: ${err.message}`;
                    isError = true;
                }
            }

            // Araç bitiş event'i
            onEvent?.({
                type: 'tool_end',
                data: {
                    name: tc.name,
                    result: result.substring(0, 500),
                    isError,
                },
            });

            return {
                toolCallId: tc.id,
                name: tc.name,
                result,
                isError,
            };
        });

        // Tüm araçların bitmesini bekle (Promise.allSettled — biri hata verse diğerleri devam eder)
        const settled = await Promise.allSettled(promises);
        return settled.map((s, i) => {
            if (s.status === 'fulfilled') return s.value;
            // Beklenmeyen rejection — hata objesi oluştur
            return {
                toolCallId: toolCalls[i].id,
                name: toolCalls[i].name,
                result: `Hata: ${(s.reason as Error)?.message || 'Bilinmeyen hata'}`,
                isError: true,
            };
        });
    }

    /**
     * Token tahmini: hızlı heuristik (event loop'u bloklamaz).
     * gpt-tokenizer senkron encode() yerine karakter tabanlı yaklaşım.
     * Ortalama 1 token ≈ 4 karakter (İngilizce/Türkçe karışık metin için).
     */
    private estimateTokens(text: string): number {
        if (!text) return 0;
        return Math.ceil(text.length / 4);
    }

    /**
     * Bir mesajın kapladığı token miktarını tahmin eder (Araç verileri dahil)
     */
    private estimateMessageTokens(msg: ConversationMessage): number {
        // Önbelleğe alınmış token tahmini varsa doğrudan döndür
        if ((msg as any)._cachedTokens !== undefined) return (msg as any)._cachedTokens;

        let tokens = this.estimateTokens(msg.content);

        if (msg.toolCalls) {
            for (const tc of msg.toolCalls) {
                tokens += this.estimateTokens(tc.name);
                tokens += this.estimateTokens(JSON.stringify(tc.arguments));
            }
        }

        if (msg.toolResults) {
            for (const tr of msg.toolResults) {
                tokens += this.estimateTokens(tr.name);
                tokens += this.estimateTokens(String(tr.result || ''));
            }
        }

        // Mesaj rolü ve metadata payı
        tokens += 4;

        // Sonraki erişimler için önbelleğe al
        (msg as any)._cachedTokens = tokens;
        return tokens;
    }
}
