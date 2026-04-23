import type { LLMProvider } from '../llm/provider.js';
import type { UnifiedMessage, ConversationMessage } from '../router/types.js';
import type { MemoryManager } from '../memory/manager.js';
import type { PromptContextBundle } from '../memory/manager/types.js';

import type { ConfirmCallback } from './tools.js';
import { ToolManager } from './toolManager.js';
import { logger } from '../utils/index.js';
import { getHookRegistry } from './mcp/hooks.js';
import type { FeedbackManager } from '../autonomous/urgeFilter.js';
import type { TaskQueue } from '../autonomous/queue.js';
import { TaskPriority } from '../autonomous/queue.js';
import { pruneConversationHistory } from './runtimeContext.js';
import { getConfig } from '../gateway/config.js';
import type { GraphRAGEngine } from '../memory/graphRAG/GraphRAGEngine.js';
import { GraphRAGManager } from './graphRAGManager.js';
import type { ResponseVerifier } from '../memory/retrieval/ResponseVerifier.js';
import { MetricsTracker } from './metricsTracker.js';
import { ContextPreparer } from './contextPreparer.js';
import { MemoryExtractor } from './memoryExtractor.js';
import { ReActLoop } from './reactLoop.js';
import { CompactEngine } from './compactEngine.js';

const MAX_TOOL_ITERATIONS_DEFAULT = 5;

export interface AgentEvent {
    type: 'thinking' | 'tool_start' | 'tool_end' | 'iteration' | 'token' | 'clear_stream' | 'replace_stream' | 'metrics' | 'compaction';
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
    private toolManager: ToolManager = new ToolManager();
    private maxToolIterations: number;

    // GraphRAG integration
    private graphRAGManager: GraphRAGManager = new GraphRAGManager();

    private contextPreparer: ContextPreparer;

    private memoryExtractor: MemoryExtractor;
    private compactEngine: CompactEngine;

    // Agentic RAG — Response Verification
    private responseVerifier?: ResponseVerifier;
    private _agenticRAGMaxRegenerations = 1;

    private feedbackManager?: FeedbackManager;
    private taskQueue?: TaskQueue;

    private metricsTracker: MetricsTracker = new MetricsTracker();

constructor(llm: LLMProvider, memory: MemoryManager) {
        this.llm = llm;
        this.memory = memory;
        this.contextPreparer = new ContextPreparer(this.memory);
        this.memoryExtractor = new MemoryExtractor(this.llm, this.memory);
        this.compactEngine = new CompactEngine(this.llm);
        this.maxToolIterations = getConfig().autonomousStepLimit || MAX_TOOL_ITERATIONS_DEFAULT;
        logger.info(`[Agent] Max tool iterations set to ${this.maxToolIterations}`);

        // GraphRAG initialization handled by GraphRAGManager
    }

    /**
     * GraphRAG motorunu dış bağımlılıklarla bağlar.
     * MemoryManager üzerinden erişilebilir bileşenlerle çağrılmalıdır.
     */
    setGraphRAGComponents(engine: GraphRAGEngine): void {
        this.graphRAGManager.setEngine(engine);
        this.memory.setGraphRAGEngine(engine);
        logger.info('[Agent] GraphRAG components connected');
    }

    /**
     * Agentic RAG ResponseVerifier'ı yapılandır.
     * MemoryManager'dan gelen config ile çalışır.
     */
    setAgenticRAGVerifier(verifier: ResponseVerifier, maxRegenerations: number = 1): void {
        this.responseVerifier = verifier;
        this._agenticRAGMaxRegenerations = maxRegenerations;
        logger.info(`[Agent] Agentic RAG verifier connected (maxRegenerations=${maxRegenerations})`);
    }

    /**
     * GraphRAG motorunu döndürür (API endpoint'leri için).
     */
    getGraphRAGEngine(): GraphRAGEngine | undefined {
        return this.graphRAGManager.getEngine();
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

    private scheduleConversationAnalysis(conversationId: string): Promise<void> {
        return Promise.all([
            this.memoryExtractor.extractMemoriesDeep(conversationId),
            this.memoryExtractor.summarizeConversation(conversationId),
        ]).then(() => undefined);
    }

    /**
     * OPT F-04: Bellek birleştirme fonksiyonunu MemoryExtractor'dan alır.
     */

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
        return this._processMessageInternal(message, onEvent, confirmCallback, options);
    }

    /**
     * Internal message processing logic.
     */
    private async _processMessageInternal(
        message: UnifiedMessage,
        onEvent?: AgentEventCallback,
        confirmCallback?: ConfirmCallback,
        options?: { thinking?: boolean },
    ): Promise<{ response: string; conversationId: string }> {
        const startTimeMs = Date.now();
        this.metricsTracker.reset(startTimeMs);

        // Top-level error boundary — bir tool çökerse tüm runtime durmasın
        try {

        // 1. Geri Bildirim Döngüsü — Etkileşim geldiğinde cezaları sıfırla
        if (this.feedbackManager) {
            this.feedbackManager.applySignal({ type: 'active_chat', timestamp: startTimeMs });
        }

        // OPT-2: Mükerrer Base64 dönüşümünü önlemek için cache mekanizması
        const base64Cache = new Map<Buffer | string, string>();
        const getBase64 = (buf: any) => {
            if (!Buffer.isBuffer(buf)) {
                if (typeof buf === 'string') return buf;
                return '';
            }
            if (!base64Cache.has(buf)) base64Cache.set(buf, buf.toString('base64'));
            return base64Cache.get(buf) as string;
        };

        const userMessage = this.createUserConversationMessage(message, getBase64);
        const { conversationId, previousConversationId, history } = this.beginConversationTurn(message, userMessage);

        this.handleClosedConversation(previousConversationId);

        // Eğer mesaj sessizce dinlenen bir arka plan bağlamı ise LLM çağrısı yapmadan işlemi sonlandır.
        if (message.metadata?.isBackgroundContext) {
            logger.info(`[Agent] 🤫 Arka plan bağlamı eklendi (LLM yanıtı üretilmeyecek): ${conversationId}`);
            return { response: '', conversationId };
        }

        this.toolManager.ensureTools(this.memory, confirmCallback, this.memoryExtractor.createMergeFn(message.senderName || 'Kullanıcı'));

        // Hook: Session tracking for tool manager
        this.toolManager.setSessionId(conversationId);

        // Hook: UserPromptSubmit
        const config = getConfig();
        if (config.enableHooks) {
            const hookRegistry = getHookRegistry();
            await hookRegistry.executePhase('UserPromptSubmit', {
                toolName: '*',
                args: { content: message.content.substring(0, 500) },
                sessionId: conversationId,
                callCount: 0,
            });
        }

        // --- Context Compaction (Akıllı Sıkıştırma) ---
        // Token bütçesi aşıldığında eski mesajları LLM ile özetle, bilgileri koru
        const compactResult = await this.compactEngine.compactIfNeeded(
            this.contextPreparer.convertHistoryToLLMMessages(history),
            history,
            conversationId,
            0, // sessionToolCallCount will be tracked in ReAct loop
        );

        // Fallback: eğer compact başarısız olursa veya yeterli değilse, sliding window kullan
        let finalHistory = history;
        if (compactResult.wasCompacted) {
            // Compacted mesajları ConversationMessage'a geri çeviremeyiz,
            // bu yüzden llmMessages'ı doğrudan contextPreparer'dan alacağız
            this.metricsTracker.recordCompaction({
                originalTokens: compactResult.originalTokens,
                compactedTokens: compactResult.compactedTokens,
                durationMs: compactResult.durationMs,
                messagesCompacted: compactResult.messagesCompacted,
                summaryLength: compactResult.summaryLength,
            });
            logger.info(`[Agent] 🗜️ Context compacted: ${compactResult.originalTokens} → ${compactResult.compactedTokens} tokens (${compactResult.messagesCompacted} mesaj özetlendi, ${compactResult.durationMs}ms)`);
        } else {
            // Compaction gerekmedi veya devre dışı — sliding window fallback
            const MAX_HISTORY_TOKENS = 128000;
            const prunedHistory = pruneConversationHistory(
finalHistory,
                this.estimateMessageTokens.bind(this),
                MAX_HISTORY_TOKENS,
            );
            finalHistory = prunedHistory.history;
            if (prunedHistory.prunedChunkCount > 0) {
                logger.info(`[Agent] ✂️ Context sınırına ulaşıldı (${MAX_HISTORY_TOKENS} token). ${prunedHistory.prunedChunkCount} eski chunk budandı.`);
            }
            if (prunedHistory.repairedAssistantCount > 0) {
                logger.info(`[Agent] ⚠️ ${prunedHistory.repairedAssistantCount} eşsiz assistant(toolCalls) mesajı düzeltildi.`);
            }
            if (prunedHistory.skippedToolCount > 0) {
                logger.info(`[Agent] ⚠️ ${prunedHistory.skippedToolCount} eşsiz tool result mesajı atlandı.`);
            }
        }

        // Kullanıcı belleklerini akıllı şekilde al — hibrit arama (FTS + Semantik)
        // + geçmiş konuşma özetleri + review due bellekler paralel çekilir
        const retrievalStart = Date.now();
        const contextBundle: PromptContextBundle = await this.memory.getPromptContextBundle(message.content, conversationId);
        const {
            relevantMemories,
            archivalMemories,
            supplementalMemories,
            conversationSummaries,
            reviewMemories,
            followUpCandidates,
            recentMessages,
        } = contextBundle;
        const retrievalMs = Date.now() - retrievalStart;
        this.metricsTracker.recordPerf('retrieval', retrievalMs);
        logger.info(`[Agent] ⏱️ getPromptContextBundle: ${retrievalMs}ms`);

const graphRAGResult = await this.graphRAGManager.retrieve(
            message.content,
            contextBundle,
            relevantMemories,
            recentMessages.length,
        );
        const finalRelevantMemories = graphRAGResult.finalRelevantMemories;

        if (graphRAGResult.perfTimingGraphRAG !== null) this.metricsTracker.recordPerf('graphRAG', graphRAGResult.perfTimingGraphRAG);

        const requiresFallback = !this.llm.supportsNativeToolCalling;
        const isToolingDisabled = message.channelType === 'discord';
        const allTools = isToolingDisabled ? [] : this.toolManager.getEffectiveToolDefinitions();
        const mcpListPrompt = this.toolManager.getMcpListPrompt(allTools);

        const shouldAddCommunitySummaries = this.graphRAGManager.shouldAddToSystemPrompt(graphRAGResult.graphRAGResult);
        const communitySummariesFormatted = graphRAGResult.graphRAGResult
            ? this.graphRAGManager.formatCommunitySummaries(graphRAGResult.graphRAGResult.communitySummaries)
            : null;

        let prepared = this.contextPreparer.prepare({
            senderName: message.senderName,
            userMessage: message.content,
            relevantMemories: finalRelevantMemories,
            supplementalMemories,
            archivalMemories,
            reviewMemories,
            followUpCandidates,
            conversationSummaries,
            recentMessages,
history: finalHistory,
            graphRAGCommunitySummaries: graphRAGResult.graphRAGResult?.communitySummaries ?? [],
            shouldAddCommunitySummaries,
            communitySummariesFormatted,
            allTools,
            mcpListPrompt,
            requiresFallback,
            messageContent: {
                content: message.content,
                attachments: message.attachments,
            },
            getBase64,
        });

        // Compact sonrası llmMessages'ı güncelle
        if (compactResult.wasCompacted) {
            const systemMsg = prepared.llmMessages.find(m => m.role === 'system');
            prepared = { ...prepared, llmMessages: compactResult.messages };
            // Compact boundary zaten system mesajı içeriyor, orijinal system prompt'u ekle (ilk sıraya)
            if (systemMsg) {
                prepared.llmMessages.unshift(systemMsg);
            }
        }

        const { finalSystemPrompt, llmMessages, contextTokenInfo } = prepared;
        const { systemPromptTokens, userMsgTokens, pastHistoryTokens } = contextTokenInfo;

        this.metricsTracker.setContextTokens({ systemPrompt: systemPromptTokens, userMsg: userMsgTokens, pastHistory: pastHistoryTokens });

        // ReAct döngüsü
        const reactLoop = new ReActLoop();
        const loopResult = await reactLoop.execute({
            llm: this.llm,
            toolManager: this.toolManager,
            metricsTracker: this.metricsTracker,
            memory: this.memory,
            conversationId,
            finalSystemPrompt,
            llmMessages,
            maxIterations: this.maxToolIterations,
            isToolingDisabled: message.channelType === 'discord',
            onEvent,
            thinking: options?.thinking,
            isFirstMessage: history.filter(h => h.role === 'user').length <= 1,
            contextTokenInfo: { systemPromptTokens, userMsgTokens, pastHistoryTokens },
            compactEngine: this.compactEngine,
            compactThreshold: getConfig().compactTokenThreshold,
        });

        const response = loopResult.uiContent;
        const totalDuration = Date.now() - startTimeMs;
        logger.info(`[Agent] ✅ Yanıt oluşturuldu (${response.length} karakter, ${loopResult.iterations} iterasyon, toplam: ${totalDuration}ms)`);

        // Agentic RAG — Response Verification (self-evaluation)
        if (this.responseVerifier && message.content) {
            try {
                const verifyStart = Date.now();
                const usedMemories = await this.memory.hybridSearch(message.content, 5);
                const verification = await this.responseVerifier.verify(message.content, response, usedMemories);
                this.metricsTracker.recordPerf('responseVerification', Date.now() - verifyStart);

                logger.info({
                    msg: '[Agentic RAG] Response verification',
                    isSupported: verification.isSupported,
                    supportScore: verification.supportScore,
                    utilityScore: verification.utilityScore,
                    needsRegeneration: verification.needsRegeneration,
                    hallucinations: verification.hallucinations.length,
                });

                if (verification.needsRegeneration && this._agenticRAGMaxRegenerations > 0) {
                    logger.warn({
                        msg: '[Agentic RAG] Response needs regeneration',
                        feedback: verification.feedback,
                        hallucinations: verification.hallucinations.slice(0, 3),
                    });
                }
            } catch (err) {
                logger.warn({ msg: '[Agentic RAG] Response verification failed', err });
            }
        }

        logger.info(this.metricsTracker.buildPerformanceLog());

        // Token maliyet özeti
        const costLog = this.metricsTracker.buildCostLog();
        if (costLog) {
            for (const line of costLog.split('\n')) {
                logger.info(line);
            }
        }

        // Geri Bildirim Döngüsü — Yanıt süresini kaydet
        if (this.feedbackManager) {
            const responseTimeMs = Date.now() - startTimeMs;
            this.feedbackManager.applySignal({ type: 'message_replied', timestamp: Date.now(), responseTimeMs });
        }

        // Metrics event'i gönder (frontend UI'da göstermek için)
        const metricsEvent = this.metricsTracker.buildMetricsEvent(conversationId);
        onEvent?.(metricsEvent);

        // Metrics'i veritabanına kaydet (observability endpoint'leri için)
        await this.metricsTracker.saveToDatabase(conversationId);

        // Kullanıcının mesajından önceki asistan mesajını (bağlam) bul
        let previousAssistantMessage = '';
        if (history.length > 0) {
            // History sondan başa sondaki eleman kullanıcının mesajı DEĞİLDİR (çünkü processMessage metodunun başında eklenir, ama history argümanına gelmez)
            // history listesini sondan tarayarak en son asistan mesajını bulalım
            for (let i = history.length - 1; i >= 0; i--) {
                if (history[i] && history[i]?.role === 'assistant') {
                    previousAssistantMessage = history[i]?.content || '';
                    break;
                }
            }
        }

        // Arka planda hafif bellek çıkarımı — throttle: her 3 mesajda bir LLM çağrısı
        this.memoryExtractor.pushExtractionContext({
            user: message.content,
            assistant: response,
            prevAssistant: previousAssistantMessage,
            userName: message.senderName
        });

        const extractionResult = this.memoryExtractor.checkAndPrepareExtraction();
        if (extractionResult.shouldExtract) {
            this.memoryExtractor.extractMemoriesLight(
                extractionResult.combinedUser,
                extractionResult.combinedAssistant,
                extractionResult.combinedPrev,
                extractionResult.contextUserName
            ).catch(err => {
                logger.error({ err: err }, '[Agent] Hafif bellek çıkarımı hatası:');
            });
        }

        // Hook: SessionEnd
        if (config.enableHooks) {
            const hookRegistry = getHookRegistry();
            hookRegistry.executePhase('SessionEnd', {
                toolName: '*',
                args: {},
                sessionId: conversationId,
                callCount: this.toolManager.sessionToolCallCount,
            }).catch(err => {
                logger.debug({ err }, '[Agent] SessionEnd hook error (non-blocking)');
            });
        }

        return { response, conversationId };
        } catch (criticalError: unknown) {
            // Top-level error boundary — graceful degradation
            const errMsg = criticalError instanceof Error ? criticalError.message : String(criticalError);
            logger.error({ err: criticalError }, '[Agent] ❌ Critical error in processMessage — graceful degradation');
            return {
                response: `⚠️ Bir hata oluştu: ${errMsg}. Lütfen tekrar deneyin.`,
                conversationId: '',
            };
        }
    }

    /**
     * Delegates to MemoryExtractor for deep memory extraction.
     */
    async extractMemoriesDeep(conversationId: string): Promise<void> {
        return this.memoryExtractor.extractMemoriesDeep(conversationId);
    }

    /**
     * Delegates to MemoryExtractor for conversation summarization.
     */
    async summarizeConversation(conversationId: string): Promise<void> {
        return this.memoryExtractor.summarizeConversation(conversationId);
    }

    /**
     * Delegates to MemoryExtractor for raw text memory extraction.
     */
    async processRawTextForMemories(text: string, userName: string = 'Kullanıcı'): Promise<void> {
        return this.memoryExtractor.processRawTextForMemories(text, userName);
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

    private estimateMessageTokens(msg: ConversationMessage & { _cachedTokens?: number }): number {
        // Önbelleğe alınmış token tahmini varsa doğrudan döndür
        if (msg._cachedTokens !== undefined) return msg._cachedTokens;

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
        msg._cachedTokens = tokens;
        return tokens;
    }
}
