import type { LLMProvider } from '../llm/provider.js';
import { encode } from 'gpt-tokenizer';
import { TOOL_CALL_CLEAR_SIGNAL } from '../llm/provider.js';
import type { UnifiedMessage, ConversationMessage, LLMMessage, LLMResponse, ToolCall, LLMToolDefinition } from '../router/types.js';
import { MemoryManager } from '../memory/manager.js';
import type { PromptContextBundle } from '../memory/manager/types.js';
import type { MemoryRow } from '../memory/types.js';
import { buildSystemPrompt, getBuiltinToolDefinitions, buildLightExtractionPrompt, buildDeepExtractionPrompt, buildSummarizationPrompt, buildEntityExtractionPrompt } from './prompt.js';
import { injectFallbackToolDirectives } from './toolPromptBuilder.js';
import { createBuiltinTools, type ToolExecutor, type ConfirmCallback } from './tools.js';
import { getUnifiedToolRegistry } from './mcp/registry.js';
import { isMCPEnabled } from './mcp/config.js';
import { logger } from '../utils/index.js';
import type { FeedbackManager } from '../autonomous/urgeFilter.js';
import type { TaskQueue } from '../autonomous/queue.js';
import { TaskPriority } from '../autonomous/queue.js';
import { formatRecentContextMessages, pruneConversationHistory } from './runtimeContext.js';
import { getConfig } from '../gateway/config.js';
import { GraphRAGEngine } from '../memory/graphRAG/GraphRAGEngine.js';
import { ShadowMode } from '../memory/graphRAG/ShadowMode.js';
import { GraphRAGConfigManager, GraphRAGRolloutPhase } from '../memory/graphRAG/config.js';
import { ResponseVerifier } from '../memory/retrieval/ResponseVerifier.js';
import { calculateCost } from '../utils/index.js';

const MAX_TOOL_ITERATIONS_DEFAULT = 5;

export interface AgentEvent {
    type: 'thinking' | 'tool_start' | 'tool_end' | 'iteration' | 'token' | 'clear_stream' | 'replace_stream' | 'metrics';
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
    private toolDefinitions: LLMToolDefinition[] = getBuiltinToolDefinitions();
    private maxToolIterations: number;

    // MCP Integration — Unified Tool Registry
    private _mcpEnabled = false;
    private _mcpToolsRegistered = false;

    // Tool cache — hash-based, tekrar eden çağrılarda aynı tool listesi döner
    private _lastToolHash: string | null = null;
    private _lastToolPayload: LLMToolDefinition[] | null = null;

    // MCP server listesi cache (sistem prompt'undaki MCP listesi)
    private _lastMcpListHash: string | null = null;
    private _lastMcpListPrompt: string | null = null;

    // Category fallback threshold
    private static readonly MAX_TOOLS_IN_CONTEXT = 20;

    // GraphRAG integration
    private graphRAGEngine?: GraphRAGEngine;
    private shadowMode?: ShadowMode;

    // Agentic RAG — Response Verification
    private responseVerifier?: ResponseVerifier;
    private _agenticRAGMaxRegenerations = 1;

    private feedbackManager?: FeedbackManager;
    private taskQueue?: TaskQueue;
    private _lastConfirmCallback?: ConfirmCallback;

    // Light extraction throttle — her mesajda değil, her N mesajda bir LLM çağrısı
    private _extractionCounter: number = 0;
    private static readonly EXTRACTION_INTERVAL = 3; // 3 mesajda 1 extraction
    private _pendingExtractionContext: Array<{ user: string; assistant: string; prevAssistant: string; userName?: string }> = [];

    // Graph Queue with retry support
    private _graphQueue: Array<{ task: () => Promise<void>; retries: number; maxRetries: number }> = [];
    private _isGraphQueueRunning = false;
    private static readonly MAX_GRAPH_QUEUE_RETRIES = 3;

    // Session-level tool timing tracking
    private _sessionTotalToolTime = 0;
    private _sessionToolCallCount = 0;

    constructor(llm: LLMProvider, memory: MemoryManager) {
        this.llm = llm;
        this.memory = memory;
        this.maxToolIterations = getConfig().autonomousStepLimit || MAX_TOOL_ITERATIONS_DEFAULT;
        logger.info(`[Agent] Max tool iterations set to ${this.maxToolIterations}`);

        // MCP Integration — Feature flag kontrolü
        this._mcpEnabled = isMCPEnabled();
        if (this._mcpEnabled) {
            logger.info('[Agent] 🔌 MCP integration enabled');
        }

        // GraphRAG initialization
        this.initializeGraphRAG();
    }

    /**
     * GraphRAG bileşenlerini başlatır.
     */
    private initializeGraphRAG(): void {
        const config = GraphRAGConfigManager.getConfig();
        if (!config.enabled) {
            logger.info('[Agent] GraphRAG is disabled in config');
            return;
        }

        try {
            // GraphRAGEngine'i memory manager üzerinden erişilebilir bileşenlerle oluştur
            // Not: GraphRAGEngine constructor'ı db, graphExpander, pageRankScorer,
            // communityDetector, communitySummarizer, graphCache, hybridSearchFn gerektirir
            // Bu bağımlılıklar MemoryManager üzerinden sağlanmalıdır
            logger.info('[Agent] GraphRAG components initialized');
        } catch (err) {
            logger.warn({ err }, '[Agent] GraphRAG initialization failed:');
        }
    }

    /**
     * GraphRAG motorunu dış bağımlılıklarla bağlar.
     * MemoryManager üzerinden erişilebilir bileşenlerle çağrılmalıdır.
     */
    setGraphRAGComponents(engine: GraphRAGEngine, shadow?: ShadowMode): void {
        this.graphRAGEngine = engine;
        this.shadowMode = shadow;
        // MemoryManager'a da bildir ki retrieval orchestrator'a geçebilsin
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
        return this.graphRAGEngine;
    }

    /**
     * ShadowMode instance'ını döndürür (API endpoint'leri için).
     */
    getShadowMode(): ShadowMode | undefined {
        return this.shadowMode;
    }

    /**
     * MCP araçlarını registry'den alıp runtime'a kaydeder.
     * Tool definitions'ı günceller ve built-in araçları registry'ye ekler.
     */
    private _registerMCPTools(registry: ReturnType<typeof getUnifiedToolRegistry>): void {
        try {
            // MCP tool definitions'larını al
            const allTools = registry.getAllToolDefinitions();
            this.toolDefinitions = allTools;
            this._mcpToolsRegistered = true;

            // Cache'i temizle — yeni tool listesi
            this._lastToolHash = null;
            this._lastToolPayload = null;
            this._lastMcpListHash = null;
            this._lastMcpListPrompt = null;

            const mcpToolCount = allTools.length - getBuiltinToolDefinitions().length;
            logger.info(`[Agent] MCP tools registered — ${allTools.length} total tools (${mcpToolCount} MCP tools)`);
        } catch (error: unknown) {
            logger.error({ err: error }, '[Agent] Failed to register MCP tools');
        }
    }

    /**
     * Etkin tool definitions'ı döndürür (built-in + MCP).
     * Hash-based cache — tool listesi değişmediyse cache'ten döndürür.
     */
    private _getEffectiveToolDefinitions(): LLMToolDefinition[] {
        if (this._mcpEnabled) {
            try {
                const registry = getUnifiedToolRegistry();
                const allTools = registry.getAllToolDefinitions();
                
                // Hash ile değişim kontrolü
                const currentHash = this._computeToolHash(allTools);
                
                if (currentHash === this._lastToolHash && this._lastToolPayload) {
                    // Cache hit — aynı tool listesi, işlem yapma
                    return this._lastToolPayload;
                }
                
                // Cache miss — sıkıştır ve cache'le
                const compressed = this._compressToolDefinitions(allTools);
                
                // Category fallback — tool sayısı çok fazlaysa prune et
                const pruned = this._pruneExcessTools(compressed);
                
                this._lastToolHash = currentHash;
                this._lastToolPayload = pruned;
                this.toolDefinitions = pruned;
                this._mcpToolsRegistered = true;
                
                logger.info(`[Agent] Tool cache miss — ${pruned.length} tools (${this._lastToolHash})`);
                return pruned;
            } catch (error: unknown) {
                logger.warn({ err: error }, '[Agent] Failed to get MCP tools, falling back to built-in tools');
            }
        }
        return this.toolDefinitions;
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
        const perfTimings: Record<string, number> = {};

        // Session-level token ve maliyet takibi
        let sessionTotalPromptTokens = 0;
        let sessionTotalCompletionTokens = 0;
        let sessionTotalCost = 0;
        this._sessionTotalToolTime = 0;
        this._sessionToolCallCount = 0;
        const sessionPerCallDetails: string[] = [];

        // Context token bilgileri (ReAct loop'da set edilir, metrics event'te kullanılır)
        let contextSystemPromptTokens = 0;
        let contextUserMsgTokens = 0;
        let contextHistoryTokens = 0;

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
        let { conversationId, previousConversationId, history } = this.beginConversationTurn(message, userMessage);

        this.handleClosedConversation(previousConversationId);

        // Eğer mesaj sessizce dinlenen bir arka plan bağlamı ise LLM çağrısı yapmadan işlemi sonlandır.
        if (message.metadata?.isBackgroundContext) {
            logger.info(`[Agent] 🤫 Arka plan bağlamı eklendi (LLM yanıtı üretilmeyecek): ${conversationId}`);
            return { response: '', conversationId };
        }

        // OPT F-03: Lazy init — araçları yalnızca confirmCallback değiştiğinde yeniden oluştur
        // Burada memory merge işlemi kullanılabilir diye userName bilgisini geçiriyoruz
        if (!this._lastConfirmCallback || this._lastConfirmCallback !== confirmCallback) {
            const builtinTools = createBuiltinTools(this.memory, confirmCallback, this.createMergeFn(message.senderName || 'Kullanıcı'));
            this.tools.clear();
            for (const tool of builtinTools) {
                this.tools.set(tool.name, tool);
            }
            this._lastConfirmCallback = confirmCallback;

            // MCP Integration — Unified Tool Registry'den MCP araçlarını da ekle
            if (this._mcpEnabled) {
                const registry = getUnifiedToolRegistry();
                // Registry'ye built-in tools'ı kaydet (bir kez)
                registry.registerBuiltins(this.memory, confirmCallback, this.createMergeFn(message.senderName || 'Kullanıcı'));
                
                // MCP tool definitions'larını al ve runtime'a ekle
                this._registerMCPTools(registry);
            }
        }

        // MCP Integration — Her mesajda toolDefinitions'ı güncelle (runtime'da yeni MCP server'lar bağlanmış olabilir)
        if (this._mcpEnabled && !this._mcpToolsRegistered) {
            const registry = getUnifiedToolRegistry();
            this._registerMCPTools(registry);
        }

        // --- Sliding Window Context Budaması (Atomik Çift-Korumalı) ---
        // assistant(toolCalls) + tool(toolResults) çiftleri bölünemez birim olarak ele alınır.
        // Böylece MiniMax/OpenAI'da "tool result not found" veya "does not follow" hataları önlenir.
        const MAX_HISTORY_TOKENS = 128000;
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
        perfTimings.retrieval = Date.now() - retrievalStart;
        logger.info(`[Agent] ⏱️ getPromptContextBundle: ${perfTimings.retrieval}ms`);

        // GraphRAG retrieval — Akıllı strateji:
        // 1. Eğer getPromptContextBundle zaten GraphRAG sonuçları getirdiyse → reuse
        // 2. Kısa mesaj + aktif konuşma varsa → skip (bağlam zaten var)
        // 3. Normal durumlarda → GraphRAG retrieval yap
        const graphRAGConfig = GraphRAGConfigManager.getConfig();
        let graphRAGResult: { memories: MemoryRow[]; communitySummaries: Array<{ id: string; summary: string }>; graphContext?: Record<string, unknown> } | null = null;

        // Double retrieval önleme: contextBundle'dan GraphRAG sonuçları varsa reuse et
        if (contextBundle.graphRAG && contextBundle.graphRAG.memories.length > 0) {
            graphRAGResult = {
                memories: contextBundle.graphRAG.memories,
                communitySummaries: contextBundle.graphRAG.communitySummaries.map(cs => ({
                    id: cs.communityId,
                    summary: cs.summary,
                })),
                graphContext: contextBundle.graphRAG.graphContext,
            };
            logger.info('[Agent] GraphRAG results reused from context bundle (no double retrieval)');
        } else if (graphRAGConfig.shadowMode && this.shadowMode) {
            // Shadow mode: GraphRAG'ı çalıştır ama sonucu kullanma
            const shadowStart = Date.now();
            this.shadowMode.runShadowQuery(message.content, relevantMemories)
                .catch(err => logger.error({ err }, '[Agent] Shadow mode query error'));
            perfTimings.graphRAGShadow = Date.now() - shadowStart;
            logger.info(`[Agent] ⏱️ GraphRAG shadow query: ${perfTimings.graphRAGShadow}ms`);
        } else if (graphRAGConfig.enabled && this.graphRAGEngine) {
            // FULL mode: Akıllı pre-check ile gereksiz retrieval'ı önle
            const queryLength = message.content.trim().length;
            const hasActiveContext = recentMessages.length >= 3;

            // Kısa mesaj + aktif bağlam = GraphRAG skip (bağlam zaten mevcut)
            const shouldSkipGraphRAG = hasActiveContext 
                && queryLength < 15 
                && !/\b(o|bu|şu|onun|bunun|dün|geçen|önceki|hani|projeyi|konuyu)\b/i.test(message.content);

            if (shouldSkipGraphRAG) {
                logger.info(`[Agent] GraphRAG skipped (short response in active context: ${queryLength} chars, ${recentMessages.length} recent messages)`);
            } else if (Math.random() < graphRAGConfig.sampleRate) {
                const graphRAGStart = Date.now();
                try {
                    const result = await this.graphRAGEngine.retrieve(message.content, {
                        maxHops: graphRAGConfig.maxHops,
                        maxExpandedNodes: graphRAGConfig.sampleRate === 1.0 ? 100 : 50,
                        minConfidence: 0.3,
                        usePageRank: graphRAGConfig.usePageRank,
                        useCommunities: graphRAGConfig.useCommunities,
                        useCache: true,
                        tokenBudget: graphRAGConfig.tokenBudget,
                        communitySummaryBudget: Math.floor(graphRAGConfig.tokenBudget * 0.25),
                        timeoutMs: graphRAGConfig.timeoutMs,
                        fallbackToStandardSearch: graphRAGConfig.fallbackEnabled,
                        rrfKConstant: graphRAGConfig.rrfKConstant,
                        memoryImportanceWeight: graphRAGConfig.memoryImportanceWeight,
                        memoryAccessCountWeight: graphRAGConfig.memoryAccessCountWeight,
                        memoryConfidenceWeight: graphRAGConfig.memoryConfidenceWeight,
                    });
                    perfTimings.graphRAG = Date.now() - graphRAGStart;

                    if (result.success) {
                        graphRAGResult = {
                            memories: result.memories,
                            communitySummaries: (result.communitySummaries || []).map(cs => ({
                                id: cs.communityId,
                                summary: cs.summary,
                            })),
                            graphContext: {
                                expandedNodeIds: result.graphContext?.expandedNodeIds ?? [],
                                communityCount: result.graphContext?.communityCount ?? 0,
                            },
                        };
                        logger.info(`[Agent] ⏱️ GraphRAG retrieval successful: ${perfTimings.graphRAG}ms`);
                    } else {
                        logger.warn(`[Agent] ⏱️ GraphRAG retrieval failed after ${perfTimings.graphRAG}ms`);
                    }
                } catch (err) {
                    perfTimings.graphRAG = Date.now() - graphRAGStart;
                    logger.error({ err }, `[Agent] ⏱️ GraphRAG retrieval error after ${perfTimings.graphRAG}ms, falling back to standard`);
                    // Fallback to standard — graphRAGResult null kalır
                }
            } else {
                logger.info('[Agent] ⏱️ GraphRAG skipped (sample rate)');
            }
        }

        // GraphRAG sonuçlarını relevantMemories'e ekle (eğer varsa)
        let finalRelevantMemories = relevantMemories;
        if (graphRAGResult && graphRAGResult.memories.length > 0) {
            // GraphRAG'den gelen bellekleri mevcut listede olmayanları doğrudan context'e ekle
            const existingIds = new Set(relevantMemories.map(m => m.id));
            const missingMemories = graphRAGResult.memories.filter(gm => !existingIds.has(gm.id));

            if (missingMemories.length > 0) {
                const memoryMap = new Map<number, MemoryRow>(
                    relevantMemories.map(m => [m.id, m])
                );
                for (const gm of missingMemories) {
                    memoryMap.set(gm.id, gm);
                }
                finalRelevantMemories = Array.from(memoryMap.values());
                logger.info(`[Agent] GraphRAG added ${missingMemories.length} new memories to context directly`);
            }
        }

        let memoryStrings = [
            ...finalRelevantMemories.map(m => m.content),
            ...supplementalMemories.map(m => m.content),
        ];

        // Archival bellekleri prompt için hazırla (aktif belleklerden ayrı)
        const archivalMemoryStrings = archivalMemories.map(m => m.content);

        // Context bütçesi: FULL mode'da GraphRAG zenginleştirilmiş context için daha fazla alan
        const MAX_MEMORY_TOKENS = graphRAGConfig.sampleRate === 1.0 ? 2500 : 1500;
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
        const memoryRelations = this.getMemoryRelationsForPrompt(finalRelevantMemories);

        let systemPrompt = buildSystemPrompt(
            message.senderName,
            memoryStrings,
            recentContextStrings,
            conversationSummaries,
            reviewMemories.map(m => m.content),
            memoryRelations,
            archivalMemoryStrings,
            followUpCandidates.map(m => m.content)
        );

        // GraphRAG community summaries'ı sisteme prompt'a ekle
        if (graphRAGResult && graphRAGResult.communitySummaries.length > 0) {
            const communityContext = graphRAGResult.communitySummaries
                .map(cs => `- **${cs.id}**: ${cs.summary}`)
                .join('\n');
            systemPrompt += `\n\n## GraphRAG Community Context\nAşağıdaki topluluk özetleri, kullanıcının bellek grafiğinden otomatik olarak çıkarılmıştır:\n${communityContext}`;
        }

        // Native Tool Calling desteklemeyen modeller (fallback modu)
        // Modelin arayüz yeteneğini doğrudan provider'dan alıyoruz.
        const requiresFallback = !this.llm.supportsNativeToolCalling;

        // MCP araç listesini sistem prompt'una ekle — LLM araçları görebilsin
        // Cache: Sadece MCP server listesi değiştiğinde güncelle
        // Eğer mesaj Discord'dan geliyorsa şu anlık (kullanıcı talebiyle) araçları yasakla
        const isToolingDisabled = message.channelType === 'discord';
        const allTools = isToolingDisabled ? [] : this._getEffectiveToolDefinitions();
        const mcpTools = allTools.filter((t: LLMToolDefinition) => t.name.startsWith('mcp:'));
        
        if (mcpTools.length > 0) {
            const currentMcpHash = this._computeMcpListHash(mcpTools);
            
            if (currentMcpHash === this._lastMcpListHash && this._lastMcpListPrompt) {
                // Cache hit — MCP listesi değişmemiş
                systemPrompt += this._lastMcpListPrompt;
            } else {
                // Cache miss — yeni MCP listesi oluştur
                const serverMap = new Map<string, string[]>();
                for (const tool of mcpTools) {
                    const parts = tool.name.split(':');
                    const serverName = parts[1];
                    if (!serverMap.has(serverName)) serverMap.set(serverName, []);
                    serverMap.get(serverName)!.push(tool.name);
                }
                const mcpList = Array.from(serverMap.entries())
                    .map(([server, tools]) => `  - **${server}**: ${tools.length} araç (${tools.map(t => `\`${t}\``).join(', ')})`)
                    .join('\n');
                const mcpPrompt = `\n\n## Aktif MCP Sunucuları\nŞu anda bağlı MCP sunucuları ve araçları:\n${mcpList}\n\nKullanıcı "hangi MCP sunucuları var?" diye sorarsa, yukarıdaki listeyi aynen kullanıcıya ilet.`;
                
                this._lastMcpListHash = currentMcpHash;
                this._lastMcpListPrompt = mcpPrompt;
                systemPrompt += mcpPrompt;
            }
        }

        let finalSystemPrompt = systemPrompt;
        if (requiresFallback) {
            // Eğer native tool calling desteklenmiyorsa, tool prompt builder'ı kullanarak
            // dinamik olan tüm tool imza ve açıklamalarını sisteme enjekte et
            finalSystemPrompt = injectFallbackToolDirectives(finalSystemPrompt, allTools);
        }

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

        // Token sayımı — sistem promptu ve konuşma geçmişi
        const systemPromptTokens = encode(finalSystemPrompt).length;
        const userMsgContent = typeof message.content === 'string' ? message.content : '';
        const userMsgTokens = encode(userMsgContent).length;
        const historyText = llmMessages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => typeof m.content === 'string' ? m.content : '')
            .join('\n');
        const totalHistoryTokens = encode(historyText).length;
        const pastHistoryTokens = totalHistoryTokens - userMsgTokens;

        // Metrics event için dış scope değişkenlerine ata
        contextSystemPromptTokens = systemPromptTokens;
        contextUserMsgTokens = userMsgTokens;
        contextHistoryTokens = pastHistoryTokens;

        // ReAct döngüsü
        let uiContent = '';
        let lastDbContent = '';
        let iterations = 0;

        while (iterations < this.maxToolIterations) {
            iterations++;

            // İlk iterasyonda token bilgisini logla
            if (iterations === 1) {
                logger.info(`[Agent] 📊 Context: geçmiş ${pastHistoryTokens} token, kullanıcı mesajı ${userMsgTokens} token, sistem promptu ${systemPromptTokens} token`);
            }

            logger.info(`[Agent] 🧠 LLM çağrılıyor (iterasyon ${iterations})...`);
            onEvent?.({ type: 'iteration', data: { iteration: iterations } });

            // Tool definitions'ı her iterasyonda güncelle (MCP araçları dinamik olarak değişebilir)
            const currentToolDefinitions = isToolingDisabled ? [] : this._getEffectiveToolDefinitions();

            // MCP araç durumunu logla
            const mcpTools = currentToolDefinitions.filter(t => t.name.startsWith('mcp:'));
            if (mcpTools.length > 0) {
                logger.debug(`[Agent] MCP tools active: ${mcpTools.map(t => t.name).join(', ')}`);
            }

            const chatOptions = {
                systemPrompt: finalSystemPrompt,
                tools: currentToolDefinitions,
                temperature: 0.7,
                maxTokens: 4096,
                thinking: options?.thinking,
            };

            let llmResponse: LLMResponse;
            const llmCallStart = Date.now();
            if (this.llm.chatStream) {
                llmResponse = await this.llm.chatStream(llmMessages, chatOptions, (token) => {
                    if (token === TOOL_CALL_CLEAR_SIGNAL) {
                        // clear_stream engellendi; ara yazılar artık silinmeyecek.
                    } else {
                        onEvent?.({ type: 'token', data: { content: token } });
                    }
                });
            } else {
                llmResponse = await this.llm.chat(llmMessages, chatOptions);
            }
            const llmCallDuration = Date.now() - llmCallStart;
            perfTimings[`llm_call_${iterations}`] = llmCallDuration;

            // Token usage bilgisini kaydet ve maliyet hesapla
            if (llmResponse.usage) {
                const config = getConfig();
                const currentProvider = config.defaultLLMProvider;
                const currentModel = config.defaultLLMModel || 'unknown';

                const promptTokens = llmResponse.usage.promptTokens || 0;
                const completionTokens = llmResponse.usage.completionTokens || 0;
                const totalTokens = llmResponse.usage.totalTokens || 0;
                const callCost = calculateCost(currentProvider, currentModel, promptTokens, completionTokens);

                // Session toplamlarına ekle
                sessionTotalPromptTokens += promptTokens;
                sessionTotalCompletionTokens += completionTokens;
                sessionTotalCost += callCost;
                sessionPerCallDetails.push(`${currentProvider}/${currentModel}: ${promptTokens} in + ${completionTokens} out = ${totalTokens} tokens | $${callCost.toFixed(4)}`);

                try {
                    this.memory.saveTokenUsage({
                        provider: currentProvider,
                        model: currentModel,
                        promptTokens,
                        completionTokens,
                        totalTokens,
                    });
                } catch (err) {
                    // Usage kaydetme hatası kullanıcı akışını bozmaz
                    logger.warn({ err }, '[Agent] Token usage kaydedilemedi:');
                }

                logger.info(`[Agent] ⏱️ LLM call (iterasyon ${iterations}): ${llmCallDuration}ms | ${currentProvider}/${currentModel} | ${promptTokens} input + ${completionTokens} output = ${totalTokens} tokens | $${callCost.toFixed(4)}`);
            }

            // <think> etiketlerini içerikten temizle (güvenlik için her durumda)
            const cleanContent = (llmResponse.content || '')
                .replace(/<think>[\s\S]*?<\/think>/gi, '')
                .replace(/<think>[\s\S]*/g, '')
                .trim();

            // Gerçek düşünme içeriği (reasoning_split: true ile gelir, thinking: true ise)
            const thinkingContent = llmResponse.thinkingContent;

            // Fallback: Model tool_calls array yerine content içerisine direkt JSON veya fonksiyon formatı döndürdüyse
            if ((!llmResponse.toolCalls || llmResponse.toolCalls.length === 0) && cleanContent) {
                const fallbackResult = this.extractFallbackToolCalls(cleanContent);
                if (fallbackResult.calls.length > 0) {
                    llmResponse.toolCalls = fallbackResult.calls;
                    // Fallback aracı bulunduğu için tespit edilen tam metinler (rawMatches) içerikten silinir
                    let strippedContent = cleanContent;
                    fallbackResult.rawMatches.forEach(matchStr => {
                        strippedContent = strippedContent.replace(matchStr, '').trim();
                    });

                    llmResponse.content = strippedContent;
                    logger.warn(`[Agent] ⚠️ Fallback parser: ${fallbackResult.calls.length} araç çağrısı yakalandı — ${fallbackResult.calls.map(tc => tc.name).join(', ')}`);
                    
                    uiContent = this.joinUIContent(uiContent, strippedContent);
                    onEvent?.({ type: 'replace_stream', data: { content: uiContent } });
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
                        lastDbContent = llmResponse.content || cleanContent || '';
                        uiContent = this.joinUIContent(uiContent, lastDbContent);
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

                // UI içeriğini güncelle
                uiContent = this.joinUIContent(uiContent, llmResponse.content || '');

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
            lastDbContent = llmResponse.content || cleanContent;
            uiContent = this.joinUIContent(uiContent, lastDbContent);
            // Son yanıt için de düşünme içeriğini gönder (varsa)
            if (thinkingContent) {
                onEvent?.({ type: 'thinking', data: { content: thinkingContent } });
            }
            break;
        }

        if (!uiContent) {
            uiContent = '⚠️ Yanıt oluşturulamadı.';
        }

        if (iterations >= this.maxToolIterations) {
            uiContent += '\n\n⚠️ Maksimum araç iterasyon sayısına ulaşıldı.';
        }

        // Asistan yanıtını kaydet (veritabanında sadece son iterasyon)
        this.addConversationMessage(conversationId, {
            role: 'assistant',
            content: lastDbContent || (iterations >= this.maxToolIterations ? '⚠️ Maksimum araç iterasyon sayısına ulaşıldı.' : '⚠️ Yanıt oluşturulamadı.'),
            timestamp: new Date(),
        });

        let response = uiContent;
        const totalDuration = Date.now() - startTimeMs;
        logger.info(`[Agent] ✅ Yanıt oluşturuldu (${response.length} karakter, ${iterations} iterasyon, toplam: ${totalDuration}ms)`);

        // Agentic RAG — Response Verification (self-evaluation)
        if (this.responseVerifier && message.content) {
            try {
                const verifyStart = Date.now();
                const usedMemories = await this.memory.hybridSearch(message.content, 5);
                const verification = await this.responseVerifier.verify(message.content, response, usedMemories);
                perfTimings.responseVerification = Date.now() - verifyStart;

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

        // Performans breakdown — Agentic RAG dahil
        const agenticParts = Object.entries(perfTimings)
            .filter(([k]) => ['retrievalDecision', 'passageCritique', 'multiHop', 'responseVerification'].includes(k))
            .map(([k, v]) => `${k}=${v}ms`);
        const agenticSuffix = agenticParts.length > 0 ? ` | Agentic: ${agenticParts.join(', ')}` : '';
        const toolSuffix = this._sessionTotalToolTime > 0 ? ` | Tools: ${this._sessionTotalToolTime}ms (${this._sessionToolCallCount} çağrı)` : '';
        logger.info(`[Agent] ⏱️ PERFORMANCE BREAKDOWN — Toplam: ${Date.now() - startTimeMs}ms | Retrieval: ${perfTimings.retrieval ?? 0}ms | GraphRAG: ${perfTimings.graphRAG ?? 0}ms | LLM: ${Object.entries(perfTimings).filter(([k]) => k.startsWith('llm_call_')).map(([k, v]) => `${k}=${v}ms`).join(', ') || 'none'}${agenticSuffix}${toolSuffix}`);

        // Token maliyet özeti
        if (sessionTotalCost > 0) {
            const totalTokens = sessionTotalPromptTokens + sessionTotalCompletionTokens;
            logger.info(`[Agent] 💰 TOPLAM MALİYET: $${sessionTotalCost.toFixed(4)} | ${sessionTotalPromptTokens} input + ${sessionTotalCompletionTokens} output = ${totalTokens} tokens`);
            if (sessionPerCallDetails.length > 1) {
                sessionPerCallDetails.forEach((detail, i) => {
                    logger.info(`[Agent] 💰   [${i + 1}] ${detail}`);
                });
            }
        }

        // Geri Bildirim Döngüsü — Yanıt süresini kaydet
        if (this.feedbackManager) {
            const responseTimeMs = Date.now() - startTimeMs;
            this.feedbackManager.applySignal({ type: 'message_replied', timestamp: Date.now(), responseTimeMs });
        }

        // Metrics event'i gönder (frontend UI'da göstermek için)
        const metricsMessageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const metricsData = {
          conversationId,
          messageId: metricsMessageId,
          performance: {
            total: Date.now() - startTimeMs,
            retrieval: perfTimings.retrieval ?? 0,
            graphRAG: perfTimings.graphRAG ?? 0,
            llmCalls: Object.entries(perfTimings).filter(([k]) => k.startsWith('llm_call_')).map(([k, v]) => ({ key: k, ms: v })),
            agentic: Object.entries(perfTimings).filter(([k]) => ['retrievalDecision', 'passageCritique', 'multiHop', 'responseVerification'].includes(k)).reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {} as Record<string, number>),
            tools: this._sessionTotalToolTime,
            toolCalls: this._sessionToolCallCount,
          },
          cost: {
            total: sessionTotalCost,
            promptTokens: sessionTotalPromptTokens,
            completionTokens: sessionTotalCompletionTokens,
            totalTokens: sessionTotalPromptTokens + sessionTotalCompletionTokens,
            breakdown: sessionPerCallDetails,
          },
          context: {
            historyTokens: contextHistoryTokens,
            userMessageTokens: contextUserMsgTokens,
            systemPromptTokens: contextSystemPromptTokens,
          },
        };
      
        onEvent?.({
          type: 'metrics',
          data: metricsData,
        });
      
        // Metrics'i veritabanına kaydet (observability endpoint'leri için)
        try {
          const { metricsCollector } = await import('../observability/metricsCollector.js');
          await metricsCollector.recordMetrics({
            conversationId,
            messageId: metricsMessageId,
            timestamp: new Date().toISOString(),
            performance: metricsData.performance,
            cost: metricsData.cost,
            context: metricsData.context,
          });
        } catch (metricsErr) {
          logger.warn({ err: metricsErr }, '[Agent] Metrics DB kaydı başarısız (non-critical)');
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

    // ==========================================
    // LLM Async Graph Extraction Queue Manager
    // ==========================================

    private async _runGraphQueue() {
        if (this._isGraphQueueRunning) return;
        this._isGraphQueueRunning = true;

        while (this._graphQueue.length > 0) {
            const queueItem = this._graphQueue.shift();
            if (!queueItem) continue;

            const { task, retries, maxRetries } = queueItem;
            try {
                await task();
            } catch (err) {
                if (retries < maxRetries) {
                    // Retry mekanizması: kalan denemeler varsa tekrar kuyruğa ekle
                    const backoffMs = Math.min(1000 * Math.pow(2, retries), 10000); // Exponential backoff: 1s, 2s, 4s
                    logger.warn(`[Agent] Graph extraction task failed (attempt ${retries + 1}/${maxRetries + 1}), retrying in ${backoffMs}ms`);
                    
                    setTimeout(() => {
                        this._graphQueue.unshift({ task, retries: retries + 1, maxRetries });
                        this._runGraphQueue().catch(() => {});
                    }, backoffMs);
                    break; // Mevcut loop'u dur, retry için bekle
                } else {
                    logger.error({ err }, `[Agent] Background Graph extraction task failed after ${maxRetries + 1} attempts, giving up`);
                }
            }
        }

        this._isGraphQueueRunning = false;
    }

    private enqueueGraphTask(task: () => Promise<void>) {
        this._graphQueue.push({ task, retries: 0, maxRetries: AgentRuntime.MAX_GRAPH_QUEUE_RETRIES });
        this._runGraphQueue().catch(() => {});
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

                interface ParsedGraphResult {
                    entities?: Array<{ name?: string; type?: string }>;
                    relations?: Array<{ targetMemoryId?: number; relation?: string; relationType?: string; confidence?: number; description?: string }>;
                }

                let parsed: ParsedGraphResult;
                try {
                    parsed = JSON.parse(jsonStr);
                } catch {
                    // Hâlâ parse edilemiyorsa boş sonuç dön — loglamadan sessizce geç
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
            // JSON parse veya LLM hatası — sessizce geç. Proximity ilişkileri addMemory'de zaten kuruldu.
            logger.warn({ err: err }, `[Agent] ⚠️ Memory graph LLM extraction başarısız (id=${memoryId}):`);
        }
    }

    /**
     * Konuşmayı JSON formatında özetler ve veritabanına kaydeder.
     * Konuşma timeout'la kapandığında arka planda tetiklenir.
     * Başlık üretimi de bu fonksiyon içinde yapılır (ekstra API çağrısı yok).
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
            let title: string | null = null;

            // JSON parse — summary ve title alanlarını al; başarısızsa plain-text fallback
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

            // Özet güncelle
            this.memory.updateConversationSummary(conversationId, summary);
            logger.info(`[Agent] 📝 Konuşma özetlendi (${conversationId.substring(0, 8)}...): "${summary.substring(0, 80)}..."`);

            // Başlık güncelle (sadece LLM ürettiyse ve kullanıcı manuel değiştirmediyse)
            if (title) {
                this.memory.updateConversationTitle(conversationId, title, false);
                logger.info(`[Agent] 🏷️ Konuşma başlığı güncellendi (${conversationId.substring(0, 8)}...): "${title}"`);
            }
        } catch (err) {
            logger.error({ err: err }, '[Agent] Konuşma özetleme başarısız:');
        }
    }


    /**
     * Semantic duplikasyon filtresi — mevcut belleklerle benzerlik hesaplar.
     * Yüksek benzerlikli bellekleri LLM'e gösterir, duplikasyonu önler.
     */
    private async getSimilarMemoriesForDedup(query: string, limit: number = 10): Promise<Array<{ id: number; content: string; similarity: number }>> {
        try {
            // Embedding provider varsa semantic search kullan
            const similarMemories = await this.memory.semanticSearch(query, limit);
            return similarMemories
                .filter(m => m.similarity > 0.6) // Düşük benzerlikleri filtrele
                .map(m => ({
                    id: m.id,
                    content: m.content,
                    similarity: m.similarity,
                }));
        } catch (err) {
            // Semantic search başarısızsa, fallback olarak user memories kullan
            logger.warn({ err }, '[Agent] Semantic dedup başarısız, fallback kullanılıyor:');
            const fallbackMemories = this.memory.getUserMemories(20);
            return fallbackMemories.map(m => ({
                id: m.id,
                content: m.content,
                similarity: 0, // Benzerlik bilgisi yok
            }));
        }
    }

    /**
     * Mevcut bellekleri LLM'e gönderilecek formatta hazırlar.
     * Semantic benzerlik ile filtrelenmiş bellekleri gösterir.
     */
    private formatExistingMemoriesForLLM(
        similarMemories: Array<{ id: number; content: string; similarity: number }>
    ): string {
        if (similarMemories.length === 0) return '';

        const existingStr = similarMemories
            .filter(m => m.similarity > 0.7) // Sadece yüksek benzerlikli bellekleri göster
            .map((m, i) => {
                const similarityLabel = m.similarity > 0 ? `[benzerlik: ${Math.round(m.similarity * 100)}%]` : '';
                return `${i + 1}. ${m.content} ${similarityLabel}`;
            })
            .join('\n');

        if (!existingStr.trim()) return '';

        return `\n\n## Bellekte Zaten Kayıtlı Benzer Bilgiler (bunları tekrar çıkarma)\n${existingStr}`;
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

            // Semantic dedup — kullanıcının mesajına benzer mevcut bellekleri bul
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

            const memories = this.parseExtractionResponse(result.content).slice(0, 3); // Max 3 bellek / çalışma
            if (memories.length > 0) {
                const mergeFn = this.createMergeFn(userName);

                for (const mem of memories) {
                    const result = await this.memory.addMemory(mem.content, mem.category, mem.importance, mergeFn);

                    // Arka planda memory graph'ı güncelle - queue ile (rate-limit koruması)
                    this.enqueueGraphTask(async () => {
                        try {
                            await this.processMemoryGraphWithLLM(result.id, mem.content, userName);
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

            // Semantic dedup — konuşmanın son mesajına benzer mevcut bellekleri bul
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
                    const result = await this.memory.addMemory(mem.content, mem.category, mem.importance, mergeFn);

                    // Arka planda memory graph'ı güncelle - queue ile (rate-limit koruması)
                    this.enqueueGraphTask(async () => {
                        try {
                            await this.processMemoryGraphWithLLM(result.id, mem.content, transcript.userName);
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

                    // Arka planda memory graph'ı güncelle - queue ile (rate-limit koruması)
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
     * Fallback araç çağrısı çıkarıcı — LLM native tool calling yerine
     * metin olarak araç çağrısı döndürdüğünde devreye girer.
     * 
     * Desteklenen formatlar:
     * 1) tool_code blokları (```tool_code ... ``` veya tool_code [...])
     * 2) JSON objeleri ({ "name": "readFile", "arguments": {...} })
     * 3) Fonksiyon çağrısı formatı (readFile(path="C:\..."))
     */
    private extractFallbackToolCalls(content: string): { calls: ToolCall[], rawMatches: string[] } {
        const results: ToolCall[] = [];
        const rawMatches: string[] = [];
        const knownToolNames = new Set(this.toolDefinitions.map(t => t.name));

        // ——— Senaryo 1: tool_code blokları ———
        // ```tool_code\nreadFile(path="...")``` veya tool_code [readFile(...)]
        const toolCodeBlockRegex = /```tool_code\s*([\s\S]*?)```/gi;
        for (const m of content.matchAll(toolCodeBlockRegex)) {
            const innerCalls = this.parseFunctionCallsFromText(m[1], knownToolNames);
            results.push(...innerCalls.calls);
            rawMatches.push(m[0]); // match'in tamamı (koduyla beraber) metinden silinecek
        }
        // tool_code readFile(...) veya tool_code [readFile(...)]
        const toolCodeInlineRegex = /tool_code\s*\[?\s*([\s\S]*?)\s*\]?\s*(?:\n|$)/gi;
        if (results.length === 0) {
            for (const m of content.matchAll(toolCodeInlineRegex)) {
                const innerCalls = this.parseFunctionCallsFromText(m[1], knownToolNames);
                results.push(...innerCalls.calls);
                rawMatches.push(m[0]);
            }
        }

        if (results.length > 0) return { calls: results, rawMatches };

        // ——— Senaryo 2: JSON objeleri ———
        // Tüm {...} bloklarını tara (greedy olmayan, iç içe olmayan)
        const jsonBlockRegex = /\{[^{}]*\}/g;
        for (const m of content.matchAll(jsonBlockRegex)) {
            try {
                const parsed = JSON.parse(m[0]);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    const toolName = parsed.name || (parsed.type === 'function' && parsed.function?.name);
                    if (toolName && knownToolNames.has(toolName)) {
                        const toolArgs = parsed.arguments || parsed.parameters || parsed.function?.arguments || {};
                        results.push({
                            id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                            name: toolName,
                            arguments: typeof toolArgs === 'string' ? this.safeJsonParse(toolArgs) : toolArgs,
                        });
                        rawMatches.push(m[0]);
                    }
                }
            } catch {
                // JSON parse hatası — devam et
            }
        }

        // İç içe JSON'lar için daha greedy regex
        if (results.length === 0) {
            const greedyJsonRegex = /\{[\s\S]*?\}/g;
            for (const m of content.matchAll(greedyJsonRegex)) {
                try {
                    // Windows backslash'lerini escape et: C:\Users → C:\\Users
                    const escaped = m[0].replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
                    const parsed = JSON.parse(escaped);
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                        const toolName = parsed.name || (parsed.type === 'function' && parsed.function?.name);
                        if (toolName && knownToolNames.has(toolName)) {
                            const toolArgs = parsed.arguments || parsed.parameters || parsed.function?.arguments || {};
                            results.push({
                                id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                                name: toolName,
                                arguments: typeof toolArgs === 'string' ? this.safeJsonParse(toolArgs) : toolArgs,
                            });
                            rawMatches.push(m[0]);
                        }
                    }
                } catch {
                    // devam et
                }
            }
        }

        if (results.length > 0) return { calls: results, rawMatches };

        // ——— Senaryo 3: Fonksiyon çağrısı formatı ———
        const functionResult = this.parseFunctionCallsFromText(content, knownToolNames);
        results.push(...functionResult.calls);
        rawMatches.push(...functionResult.rawMatches);

        return { calls: results, rawMatches };
    }

    /**
     * Metin içinden fonksiyon çağrısı formatındaki araç çağrılarını çıkarır.
     * Örn: readFile(path="C:\Users\Yigit\file.txt")
     * Parantez dengeleme ile iç içe parantezleri doğru ele alır.
     */
    private parseFunctionCallsFromText(text: string, knownToolNames: Set<string>): { calls: ToolCall[], rawMatches: string[] } {
        const results: ToolCall[] = [];
        const rawMatches: string[] = [];
        const toolNamePattern = Array.from(knownToolNames).join('|');
        // Araç adını ve açılan parantezi yakala; kapanışı manuel bul
        const callStartRegex = new RegExp(`(${toolNamePattern})\\s*\\(`, 'g');
        
        let startMatch: RegExpExecArray | null;
        while ((startMatch = callStartRegex.exec(text)) !== null) {
            const toolName = startMatch[1];
            const argsStartIdx = startMatch.index + startMatch[0].length;
            // Parantez dengeleme ile argüman sonunu bul
            let depth = 1;
            let idx = argsStartIdx;
            while (idx < text.length && depth > 0) {
                if (text[idx] === '(') depth++;
                else if (text[idx] === ')') depth--;
                idx++;
            }
            if (depth !== 0) continue; // Dengesiz parantez — atla
            
            const rawMatchString = text.substring(startMatch.index, idx);
            const argsString = text.substring(argsStartIdx, idx - 1).trim();
            const parsedArgs = this.parseFallbackArgs(toolName, argsString);
            results.push({
                id: `call_${Date.now()}_func_${Math.random().toString(36).substring(2, 6)}`,
                name: toolName,
                arguments: parsedArgs,
            });
            rawMatches.push(rawMatchString);
        }
        return { calls: results, rawMatches };
    }

    /**
     * Fallback argüman parser — çeşitli formatları destekler:
     * - JSON: {"path": "..."}
     * - key=value: path="C:\...", query="test"
     * - Raw string: doğrudan argüman olarak
     */
    private parseFallbackArgs(toolName: string, argsString: string): Record<string, unknown> {
        if (!argsString.trim()) return {};

        // 1) JSON formatı
        if (argsString.trim().startsWith('{')) {
            try {
                return JSON.parse(argsString);
            } catch {
                try {
                    // Windows backslash escape: C:\Users → C:\\Users
                    const escaped = argsString.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
                    return JSON.parse(escaped);
                } catch { /* devam */ }
            }
        }

        // 2) key="value" veya key='value' formatı — regex ile ayıkla
        const kvPairs: Record<string, string> = {};
        // Tırnaklı değerleri yakala: key="value with spaces" veya key='value'
        const kvRegex = /([a-zA-Z0-9_]+)\s*=\s*(?:"([^"]*?)"|'([^']*?)')/g;
        let kvMatch: RegExpExecArray | null;
        while ((kvMatch = kvRegex.exec(argsString)) !== null) {
            kvPairs[kvMatch[1]] = kvMatch[2] ?? kvMatch[3];
        }
        if (Object.keys(kvPairs).length > 0) return kvPairs;

        // 3) key=value (tırnaksız) — tek bir değer
        const simpleKvMatch = argsString.match(/^([a-zA-Z0-9_]+)\s*=\s*(.+)$/s);
        if (simpleKvMatch) {
            return { [simpleKvMatch[1]]: simpleKvMatch[2].replace(/^["']|["']$/g, '').trim() };
        }

        // 4) Araç türüne göre fallback — raw string'i ana parametreye ata
        const primaryParam = this.getPrimaryParam(toolName);
        return { [primaryParam]: argsString.replace(/^["']|["']$/g, '').trim() };
    }

    /**
     * Araç adından birincil parametre adını döndürür.
     */
    private getPrimaryParam(toolName: string): string {
        if (toolName === 'listDirectory' || toolName === 'readFile' || toolName === 'writeFile') return 'path';
        if (toolName === 'executeShell') return 'command';
        if (toolName === 'searchConversation' || toolName === 'webSearch' || toolName === 'searchMemory') return 'query';
        if (toolName === 'deleteMemory') return 'id';
        return 'path'; // Varsayılan
    }

    /**
     * Windows backslash'li yolları güvenli şekilde JSON parse eder.
     */
    private safeJsonParse(str: string): Record<string, unknown> {
        try { return JSON.parse(str); } catch { /* fallthrough */ }
        try { return JSON.parse(str.replace(/\\(?!["\\/bfnrtu])/g, '\\\\')); } catch { /* fallthrough */ }
        return {};
    }

    /**
     * Araç çağrılarını paralel yürütür ve her adımda event gönderir.
     * Bağımsız araçlar (webSearch, dosya okuma vb.) eşzamanlı çalışır.
     */
    private async executeToolsWithEvents(toolCalls: ToolCall[], onEvent?: AgentEventCallback) {
        // Tüm araçları paralel başlat
        const promises = toolCalls.map(async (tc) => {
            let result: string;
            let isError = false;
            const toolCallIndex = ++this._sessionToolCallCount;

            // Araç başlangıç event'i
            onEvent?.({
                type: 'tool_start',
                data: { name: tc.name, arguments: tc.arguments },
            });

            const toolStart = Date.now();
            try {
                // MCP Integration — Önce built-in, sonra MCP registry üzerinden çalıştır
                if (this._mcpEnabled && tc.name.startsWith('mcp:')) {
                    // MCP aracı — Unified Tool Registry üzerinden çalıştır
                    const registry = getUnifiedToolRegistry();
                    logger.info(`[Agent]   → [MCP] ${tc.name}(${JSON.stringify(tc.arguments).substring(0, 100)})`);
                    result = await registry.executeTool(tc.name, tc.arguments);
                } else {
                    // Built-in araç
                    const tool = this.tools.get(tc.name);
                    if (!tool) {
                        result = `Hata: Bilinmeyen araç: ${tc.name}`;
                        isError = true;
                    } else {
                        logger.info(`[Agent]   → ${tc.name}(${JSON.stringify(tc.arguments).substring(0, 100)})`);
                        result = await tool.execute(tc.arguments);
                    }
                }
            } catch (err: unknown) {
                result = `Hata: ${err instanceof Error ? err.message : String(err)}`;
                isError = true;
            }

            const duration = Date.now() - toolStart;
            this._sessionTotalToolTime += duration;
            logger.info(`[Agent] 🔧 tool #${toolCallIndex}: ${tc.name} completed in ${duration}ms | ${result.length} chars`);

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
     * ReAct iterasyonları arasındaki UI içeriğini akıllıca birleştirir.
     * Markdown yapılarını (tablo, liste) bozmamak için aşırı \n\n eklemez.
     */
    private joinUIContent(current: string, next: string): string {
        if (!next) return current;
        if (!current) return next;

        const nextTrimmed = next.trimStart();
        // Eğer yeni içerik tablo satırı (|), liste elemanı (-, *, 1.) veya kod bloğu (```) ise
        const isStructural = nextTrimmed.startsWith('|') ||
            nextTrimmed.startsWith('- ') ||
            nextTrimmed.startsWith('* ') ||
            /^\d+\.\s/.test(nextTrimmed) ||
            nextTrimmed.startsWith('```');

        if (isStructural) {
            // Yapısal içerik için: eğer mevcut içerik \n ile bitmiyorsa ekle, ama \n\n ekleme
            if (current.endsWith('\n')) return current + next;
            return current + '\n' + next;
        }

        // Normal metin için: eğer paragraf devam ediyorsa (noktalama yoksa) boşlukla bağla, değilse \n\n
        const lastChar = current.trimEnd().slice(-1);
        const isSentenceEnd = ['.', '!', '?', ':', ';'].includes(lastChar);

        if (!isSentenceEnd && !current.endsWith('\n')) {
            return current + ' ' + next;
        }

        if (current.endsWith('\n\n')) return current + next;
        if (current.endsWith('\n')) return current + '\n' + next;
        return current + '\n\n' + next;
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
     * Tool listesinin hash'ini hesaplar — cache validasyonu için.
     */
    private _computeToolHash(tools: LLMToolDefinition[]): string {
        const sig = tools.map(t => `${t.name}|${t.description ?? ''}|${t.llmDescription ?? ''}`).join(';');
        let hash = 0;
        for (let i = 0; i < sig.length; i++) {
            hash = ((hash << 5) - hash) + sig.charCodeAt(i);
            hash |= 0;
        }
        return hash.toString(36);
    }

    /**
     * MCP server listesinin hash'ini hesaplar.
     */
    private _computeMcpListHash(mcpTools: LLMToolDefinition[]): string {
        const sig = mcpTools.map(t => t.name).join(',');
        let hash = 0;
        for (let i = 0; i < sig.length; i++) {
            hash = ((hash << 5) - hash) + sig.charCodeAt(i);
            hash |= 0;
        }
        return hash.toString(36);
    }

    /**
     * Tool tanımlarını LLM için sıkıştırır.
     * llmDescription ve llmParameters varsa onları kullanır, yoksa orijinalini kullanır.
     */
    private _compressToolDefinitions(tools: LLMToolDefinition[]): LLMToolDefinition[] {
        return tools.map(tool => {
            const compressed: LLMToolDefinition = {
                name: tool.name,
                description: tool.llmDescription ?? tool.description,
                parameters: tool.llmParameters ?? tool.parameters,
            };
            return compressed;
        });
    }

    /**
     * Tool sayısı çok fazlaysa en az gerekli MCP tools'ları çıkar.
     * Built-in tools her zaman korunur.
     */
    private _pruneExcessTools(tools: LLMToolDefinition[]): LLMToolDefinition[] {
        const maxTools = AgentRuntime.MAX_TOOLS_IN_CONTEXT;
        if (tools.length <= maxTools) return tools;
        
        // Built-in tools her zaman kalsın
        const builtin = tools.filter(t => !t.name.startsWith('mcp:'));
        const mcp = tools.filter(t => t.name.startsWith('mcp:'));
        
        // MCP tools'tan en son eklenenleri çıkar (ilk eklenenler daha önemli)
        const keepCount = Math.max(0, maxTools - builtin.length);
        const prunedMcp = mcp.slice(0, keepCount);
        
        if (mcp.length > keepCount) {
            const removed = mcp.slice(keepCount).map(t => t.name);
            logger.warn(`[Agent] ⚠️ Tool count (${tools.length}) exceeds limit (${maxTools}), pruning: ${removed.join(', ')}`);
        }
        
        return [...builtin, ...prunedMcp];
    }

    /**
     * Bir mesajın kapladığı token miktarını tahmin eder (Araç verileri dahil)
     */
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
