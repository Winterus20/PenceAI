import { encode } from 'gpt-tokenizer';
import type { ConversationMessage, LLMMessage, LLMToolDefinition, Attachment } from '../router/types.js';
import type { MemoryRow } from '../memory/types.js';
import type { PromptContextBundle } from '../memory/manager/types.js';
import { buildSystemPrompt } from './prompt.js';
import { injectFallbackToolDirectives } from './toolPromptBuilder.js';
import { formatRecentContextMessages } from './runtimeContext.js';
import { GraphRAGConfigManager } from '../memory/graphRAG/config.js';
import type { MemoryManager } from '../memory/manager.js';
import { logger } from '../utils/index.js';

export interface PreparedContext {
    systemPrompt: string;
    finalSystemPrompt: string;
    llmMessages: LLMMessage[];
    memoryStrings: string[];
    archivalMemoryStrings: string[];
    trimmedMemories: string[];
    memoryTokensUsed: number;
    maxMemoryTokens: number;
    contextTokenInfo: {
        systemPromptTokens: number;
        userMsgTokens: number;
        pastHistoryTokens: number;
    };
}

export class ContextPreparer {
    private memory: MemoryManager;

    /** System prompt encoding cache — aynı prompt tekrar encode edilmesin */
    private _cachedSystemPromptHash: string = '';
    private _cachedSystemPromptTokens: number = 0;

    constructor(memory: MemoryManager) {
        this.memory = memory;
    }

    /** Basit hash fonksiyonu — string'ten hızlı fingerprint */
    private simpleHash(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return hash.toString(36);
    }

    getMemoryRelationsForPrompt(memories: Array<{ id: number; content: string }>): Array<{ source: string; target: string; relation: string; description: string }> {
        if (memories.length < 2) return [];

        const relations: Array<{ source: string; target: string; relation: string; description: string }> = [];
        const memoryContentMap = new Map(memories.map(m => [m.id, m.content]));
        const memoryIds = memories.map(m => m.id);
        const seenKeys = new Set<string>();

        const neighborsMap = this.memory.getMemoryNeighborsBatch(memoryIds, 5);

        for (const memId of memoryIds) {
            const neighbors = neighborsMap.get(memId) || [];
            for (const n of neighbors) {
                if (memoryContentMap.has(n.id)) {
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

        return relations.slice(0, 15);
    }

    private estimateTokens(text: string): number {
        if (!text) return 0;
        return Math.ceil(text.length / 4);
    }

    convertHistoryToLLMMessages(history: ConversationMessage[]): LLMMessage[] {
        return history.map(h => ({
            role: h.role,
            content: h.content,
            toolCalls: h.toolCalls,
            toolResults: h.toolResults,
        }));
    }

    prepare(params: {
        senderName: string;
        userMessage: string;
        relevantMemories: MemoryRow[];
        supplementalMemories: MemoryRow[];
        archivalMemories: MemoryRow[];
        reviewMemories: MemoryRow[];
        followUpCandidates: MemoryRow[];
        conversationSummaries: Array<{ title: string; summary: string; updated_at: string }>;
        recentMessages: Array<{ role: string; content: string; created_at: string; conversation_title: string }>;
        history: ConversationMessage[];
        graphRAGCommunitySummaries: Array<{ id: string; summary: string }>;
        shouldAddCommunitySummaries: boolean;
        communitySummariesFormatted: string | null;
        telescopicSummaries?: Array<{ id: number; summary: string; level: number; created_at: string; end_msg_id: number }>;
        allTools: LLMToolDefinition[];
        mcpListPrompt: string | null;
        requiresFallback: boolean;
        messageContent: {
            content: string;
            attachments: Attachment[];
        };
        getBase64: (buf: Buffer | string) => string | undefined;
        maxMemoryTokens?: number;
    }): PreparedContext {
        let memoryStrings = [
            ...params.relevantMemories.map(m => m.content),
            ...params.supplementalMemories.map(m => m.content),
        ];

        const archivalMemoryStrings = params.archivalMemories.map(m => m.content);

        const MAX_MEMORY_TOKENS = params.maxMemoryTokens ?? (GraphRAGConfigManager.getConfig().sampleRate === 1.0 ? 2500 : 1500);
        const trimmedMemories: string[] = [];
        let memoryTokensUsed = 0;

        for (const mem of memoryStrings) {
            const tokens = this.estimateTokens(mem);
            if (memoryTokensUsed + tokens > MAX_MEMORY_TOKENS) {
                logger.info(`[ContextPreparer] ✂️ Hafıza context sınırına ulaşıldı (${MAX_MEMORY_TOKENS} token).`);
                break;
            }
            trimmedMemories.push(mem);
            memoryTokensUsed += tokens;
        }
        memoryStrings = trimmedMemories;

        const recentContextStrings = formatRecentContextMessages(params.recentMessages);

        const memoryRelations = this.getMemoryRelationsForPrompt(params.relevantMemories);

        let systemPrompt = buildSystemPrompt(
            params.senderName,
            memoryStrings,
            recentContextStrings,
            params.conversationSummaries,
            params.reviewMemories.map(m => m.content),
            memoryRelations,
            archivalMemoryStrings,
            params.followUpCandidates.map(m => m.content),
        );

        if (params.shouldAddCommunitySummaries && params.communitySummariesFormatted) {
            systemPrompt += `\n\n## GraphRAG Community Context\nAşağıdaki topluluk özetleri, kullanıcının bellek grafiğinden otomatik olarak çıkarılmıştır:\n${params.communitySummariesFormatted}`;
        }

        if (params.mcpListPrompt) {
            systemPrompt += params.mcpListPrompt;
        }

        let finalSystemPrompt = systemPrompt;
        if (params.requiresFallback) {
            finalSystemPrompt = injectFallbackToolDirectives(finalSystemPrompt, params.allTools);
        }

        // Telescopic summaries işleme
        let historyToKeep = params.history;
        if (params.telescopicSummaries && params.telescopicSummaries.length > 0) {
            finalSystemPrompt += `\n\n## Önceki Konuşma Özetleri (Teleskopik)\nAşağıdaki özetler, bu konuşmanın daha eski ve sıkıştırılmış kısımlarını içerir:\n\n`;
            let maxEndMsgId = 0;
            for (const sum of params.telescopicSummaries) {
                finalSystemPrompt += `[Seviye ${sum.level} Özet]: ${sum.summary}\n`;
                if (sum.end_msg_id > maxEndMsgId) {
                    maxEndMsgId = sum.end_msg_id;
                }
            }
            if (maxEndMsgId > 0) {
                historyToKeep = params.history.filter(h => (h.id ?? Infinity) > maxEndMsgId);
            }
        }

        const llmMessages: LLMMessage[] = historyToKeep.map(h => ({
            role: h.role,
            content: h.content,
            toolCalls: h.toolCalls,
            toolResults: h.toolResults,
        }));

        const imageAttachments = params.messageContent.attachments.filter(a => a.type === 'image' && a.data && a.data.length > 0);
        if (imageAttachments.length > 0) {
            for (let i = llmMessages.length - 1; i >= 0; i--) {
                if (llmMessages[i]?.role === 'user') {
                    const msgUser = llmMessages[i] as LLMMessage;
                    msgUser.imageBlocks = imageAttachments.map(a => ({
                        mimeType: a.mimeType,
                        data: Buffer.isBuffer(a.data) ? params.getBase64(a.data)! : '',
                        fileName: a.fileName,
                    }));
                    break;
                }
            }
        }

        // System prompt token cache — prompt değişmediyse encode() çağrısını atla
        const promptHash = this.simpleHash(finalSystemPrompt);
        let systemPromptTokens: number;
        if (promptHash === this._cachedSystemPromptHash) {
            systemPromptTokens = this._cachedSystemPromptTokens;
        } else {
            systemPromptTokens = encode(finalSystemPrompt).length;
            this._cachedSystemPromptHash = promptHash;
            this._cachedSystemPromptTokens = systemPromptTokens;
        }

        const userMsgContent = typeof params.messageContent.content === 'string' ? params.messageContent.content : '';
        const userMsgTokens = encode(userMsgContent).length;
        const historyText = llmMessages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => typeof m.content === 'string' ? m.content : '')
            .join('\n');
        const totalHistoryTokens = encode(historyText).length;
        const pastHistoryTokens = totalHistoryTokens - userMsgTokens;

        return {
            systemPrompt,
            finalSystemPrompt,
            llmMessages,
            memoryStrings,
            archivalMemoryStrings,
            trimmedMemories,
            memoryTokensUsed,
            maxMemoryTokens: MAX_MEMORY_TOKENS,
            contextTokenInfo: {
                systemPromptTokens,
                userMsgTokens,
                pastHistoryTokens,
            },
        };
    }

    getTotalContextTokens(prepared: PreparedContext): number {
        return prepared.contextTokenInfo.systemPromptTokens
            + prepared.contextTokenInfo.userMsgTokens
            + prepared.contextTokenInfo.pastHistoryTokens;
    }
}