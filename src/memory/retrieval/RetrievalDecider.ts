/**
 * RetrievalDecider — Agentic RAG Retrieval Decision Engine (Faz 1)
 *
 * LLM'e "Bu soru için bellek/kaynak aramam gerekli mi?" sorusunu sorar.
 * Gerekliyse hangi retriever'ların (system1, system2, graphRAG, web) kullanılacağını belirtir.
 *
 * Self-RAG'deki [Retrieve] / [NoRetrieve] token'ının prompt-based karşılığıdır.
 * Fine-tuning gerektirmez, mevcut LLM provider ile çalışır.
 */

import type { RetrievalIntentSignals } from './types.js';
import type { LLMProvider } from '../../llm/provider.js';

export type RetrieverType = 'system1' | 'system2' | 'graphRAG' | 'web' | 'memory';

export interface RetrievalDecision {
    needsRetrieval: boolean;
    confidence: number;            // 0-1 arası
    reason: string;
    suggestedRetrievers: RetrieverType[];
    skipReason?: string;           // Retrieval gerekmiyorsa neden
}

const RETRIEVAL_DECISION_PROMPT = `You are a Retrieval Decision Engine for a personal AI assistant. Given a user query and context signals, decide whether external memory retrieval is needed.

RULES:
- If the user is asking about personal info, past conversations, specific facts, or preferences → Retrieve
- If it's general knowledge (common facts, definitions, how-to) that any LLM knows → NoRetrieve
- If it's a greeting, opinion request without personal context, or creative/philosophical question → NoRetrieve
- If it's about real-time/current events → Retrieve (use web if available)

If retrieval IS needed, specify which retriever(s):
- system1: Fast semantic search — simple queries, single-topic
- system2: Deep hybrid search — complex queries, multiple topics, needs detail
- graphRAG: Relationship/multi-hop queries — "how are X and Y related?", connections between memories
- web: Real-time or current events beyond stored knowledge
- memory: User-specific memories, preferences, past conversations

Output format (be concise):
<decision>Retrieve or NoRetrieve</decision>
<confidence>0.0 to 1.0</confidence>
<reason>One sentence explaining why</reason>
<retrievers>comma-separated list, only if Retrieve</retrievers>`;

export interface RetrievalDeciderConfig {
    minConfidence: number;         // Default: 0.5 — altındaysa NoRetrieve fallback
}

const DEFAULT_CONFIG: RetrievalDeciderConfig = {
    minConfidence: 0.5,
};

export class RetrievalDecider {
    private config: RetrievalDeciderConfig;

    constructor(
        private llmProvider: LLMProvider,
        config?: Partial<RetrievalDeciderConfig>,
    ) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    async decide(
        query: string,
        signals: RetrievalIntentSignals,
        recentMessages: Array<{ role: string; content: string }>,
    ): Promise<RetrievalDecision> {
        const prompt = this.buildPrompt(query, signals, recentMessages);

        const response = await this.llmProvider.chat([
            { role: 'system', content: RETRIEVAL_DECISION_PROMPT },
            { role: 'user', content: prompt },
        ], { temperature: 0.2, maxTokens: 256 });

        const decision = this.parseResponse(response.content);

        // Güvenlik: confidence threshold altındaysa retrieval yapma
        if (decision.needsRetrieval && decision.confidence < this.config.minConfidence) {
            return {
                needsRetrieval: false,
                confidence: decision.confidence,
                reason: `Confidence too low (${decision.confidence.toFixed(2)} < ${this.config.minConfidence})`,
                suggestedRetrievers: [],
                skipReason: `Retrieval decision confidence (${decision.confidence.toFixed(2)}) below threshold (${this.config.minConfidence})`,
            };
        }

        return decision;
    }

    private buildPrompt(query: string, signals: RetrievalIntentSignals, recentMessages: Array<{ role: string; content: string }>): string {
        const recentContext = recentMessages.length > 0
            ? recentMessages.slice(-3).map(m => `${m.role}: ${m.content.substring(0, 120)}`).join('\n')
            : '(none)';

        return `Query: "${query}"

Intent Signals:
- Has Question: ${signals.hasQuestion}
- Has Preference Cue: ${signals.hasPreferenceCue}
- Has Follow-Up Cue: ${signals.hasFollowUpCue}
- Has Recall Cue: ${signals.hasRecallCue}
- Has Constraint Cue: ${signals.hasConstraintCue}
- Has Recent Context: ${signals.hasRecentContext}
- Has Analytical Cue: ${signals.hasAnalyticalCue}
- Has Exploratory Cue: ${signals.hasExploratoryCue}
- Query Length: ${signals.queryLength} chars
- Clause Count: ${signals.clauseCount}

Recent Conversation (last 3 messages):
${recentContext}`;
    }

    private parseResponse(content: string): RetrievalDecision {
        const decisionMatch = content.match(/<decision>(Retrieve|NoRetrieve)<\/decision>/i);
        const confidenceMatch = content.match(/<confidence>([0-9.]+)<\/confidence>/i);
        const reasonMatch = content.match(/<reason>(.+?)<\/reason>/is);
        const retrieversMatch = content.match(/<retrievers>(.+?)<\/retrievers>/is);

        const rawConfidence = parseFloat(confidenceMatch?.[1] || '0.5');
        const confidence = Math.min(1, Math.max(0, isNaN(rawConfidence) ? 0.5 : rawConfidence));

        const rawRetrievers = retrieversMatch
            ? retrieversMatch[1].split(',').map(r => r.trim().toLowerCase())
            : ['system1'];
        const suggestedRetrievers: RetrieverType[] = rawRetrievers.filter((r): r is RetrieverType => this.isValidRetriever(r));

        return {
            needsRetrieval: decisionMatch?.[1].toLowerCase() === 'retrieve',
            confidence,
            reason: reasonMatch?.[1]?.trim() || 'Unknown',
            suggestedRetrievers,
        };
    }

    private isValidRetriever(type: string): type is RetrieverType {
        return ['system1', 'system2', 'graphRAG', 'web', 'memory'].includes(type);
    }
}
