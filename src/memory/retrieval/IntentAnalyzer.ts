import type {
    CognitiveLoadAssessment,
    PromptContextRecipe,
    RetrievalIntentSignals,
    RetrievalOrchestratorDeps,
    RetrievalTypePreference,
} from './types.js';

/** GraphRAG-enabled recipe tanimlari */
const GRAPH_RAG_RECIPES: Record<string, PromptContextRecipe> = {
    graph_rag_exploration: {
        name: 'graph_rag_exploration',
        graphDepth: 2,
        preferArchivalForSupplemental: true,
        expandFallbackPool: true,
        preferReviewSignals: false,
        preferConversationSignals: false,
        useGraphRAG: true,
        maxHops: 2,
        usePageRank: true,
        useCommunities: true,
        tokenBudget: 32000,
        timeoutMs: 5000,
    },
    graph_rag_deep: {
        name: 'graph_rag_deep',
        graphDepth: 3,
        preferArchivalForSupplemental: true,
        expandFallbackPool: true,
        preferReviewSignals: false,
        preferConversationSignals: false,
        useGraphRAG: true,
        maxHops: 3,
        usePageRank: true,
        useCommunities: true,
        tokenBudget: 48000,
        timeoutMs: 8000,
    },
};

export class IntentAnalyzer {
    constructor(private readonly deps: RetrievalOrchestratorDeps) {}

    /**
     * Regex tabanli niyet sinyali tespiti (8 sinyal)
     */
    detectSignals(
        query: string,
        recentMessages: { role: string; content: string; conversation_title?: string }[],
    ): RetrievalIntentSignals {
        const normalizedQuery = query.toLowerCase();
        const recentUserMessages = recentMessages.filter(message => message.role === 'user').slice(0, 4);
        const clauseCount = query
            .split(/[,.!?;:\n]+/)
            .map(part => part.trim())
            .filter(Boolean)
            .length;

        return {
            hasQuestion: /\?|nasil|neden|ne|hangi|hatirla|remember|recall/.test(normalizedQuery),
            hasPreferenceCue: /tercih|sev|sever|istemem|favori|aliskanlik|preference|prefer|like|dislike|hangisi|hangisi daha|tercih edersin|ne dersin|nasil bulursun|oneri|oner/.test(normalizedQuery),
            hasFollowUpCue: /takip|devam|son durum|guncel|update|follow[ -]?up|progress|durum|az once|demin|bugun|dun|peki|ya da|ya da ne|baska|alternatif|devami|sonrasi|nerede|ne oldu|sonuc|sonuc ne|ne yapacagiz|peki ne|peki ya|o zaman|oyleyse|madem|peki ya onun|onun yerine|onun yerine ne|bir de|suna da|buna da|diger|obur/.test(normalizedQuery),
            hasRecallCue: /hatirla|hatirlat|recall|remember|bildikler(in|ini)|what do you know|retrieve|ne demistin|ne soyledin|ne konustuk|bahsettigim|dedigim|soyledigim|paylastigim|dun|evvelsi gun|gecen (hafta|ay)|az once|demin|biraz once|bir sure once|daha once|o proje|o konu|o sey|onun hakkinda|bununla ilgili|bu konuda|hatirlarsan|hatirladigim kadariyla|bildigim kadariyla|bahsi gecen|sozunu ettigim|kastettigim/.test(normalizedQuery),
            hasConstraintCue: /sadece|yalnizca|ozellikle|kisa|short|brief|odaklan|focus|bounded|limit/.test(normalizedQuery),
            hasRecentContext: recentUserMessages.some(message => message.content.trim().length > 0),
            hasAnalyticalCue: /analiz|karsilastir|trade-?off|step by step|adim adim|degerlendir|planla|reason|explain|why|diagnose|neden|nicin|niye|acikla|detayli|detay|karmasik/.test(normalizedQuery),
            hasExploratoryCue: /oner|fikir|arastir|kesfet|alternatif|recipe|tarif|brainstorm|explore|options|ideas/.test(normalizedQuery),
            hasPersonalReference: /benim|bana|bende|benimki|benimle|benden|yigit|yigit'in|yigit'e|yigit'le|yigit'ten|projem|isim|calismam|odevim|arkadasim|ailem|evim|odam|okulum|sirketim|patronum|mudurum|hocam|yaptigim|ettigim|verdigim|aldigim/.test(normalizedQuery),
            hasContextualQuestion: /(o|bu|su) (proje|konu|is|sey|olay|durum|yaptigimiz)|nasil (gidiyor|ilerliyor|bitiyor)|ne zaman (bitecek|baslayacak|yapacagiz)|hangi (proje|konu|is|karar)|kim (yapacak|dedi|soyledi|istiyor)/.test(normalizedQuery),
            queryLength: query.trim().length,
            clauseCount,
        };
    }

    /**
     * Bilsel yuk skorlama (low/medium/high)
     */
    assessCognitiveLoad(signals: RetrievalIntentSignals, recipe: PromptContextRecipe): CognitiveLoadAssessment {
        let score = 0;
        const reasons: string[] = [];

        if (signals.hasPreferenceCue) {
            score += 1;
            reasons.push('preference_recall');
        }
        if (signals.hasFollowUpCue) {
            score += 1;
            reasons.push('follow_up');
        }
        if (signals.hasAnalyticalCue) {
            score += 2;
            reasons.push('analytical_intent');
        }
        if (signals.queryLength >= 160) {
            score += 1;
            reasons.push('long_query');
        }
        if (signals.clauseCount >= 3) {
            score += 1;
            reasons.push('multi_clause');
        }
        if (recipe.name === 'exploratory' || signals.hasExploratoryCue) {
            score -= 1;
            reasons.push('exploratory_breadth');
        }
        if (signals.hasQuestion && !signals.hasAnalyticalCue && signals.queryLength < 90) {
            score -= 1;
            reasons.push('simple_question');
        }

        const normalizedScore = Math.max(0, score);
        if (normalizedScore >= 3) {
            return { level: 'high', score: normalizedScore, reasons };
        }
        if (normalizedScore <= 0) {
            return { level: 'low', score: normalizedScore, reasons };
        }
        return { level: 'medium', score: normalizedScore, reasons };
    }

    /**
     * Episodic vs semantic agirlik cozumlemesi
     */
    resolveTypePreference(signals: RetrievalIntentSignals, recipe: PromptContextRecipe): RetrievalTypePreference {
        if (signals.hasPreferenceCue) {
            return {
                preferredType: 'semantic',
                semanticWeight: 1.16,
                episodicWeight: 0.96,
                reason: 'preference_profile_recall',
            };
        }

        if (signals.hasFollowUpCue || recipe.name === 'conversation_followup') {
            return {
                preferredType: 'episodic',
                semanticWeight: 0.96,
                episodicWeight: 1.16,
                reason: 'recent_event_followup',
            };
        }

        if (signals.hasRecallCue) {
            return {
                preferredType: 'semantic',
                semanticWeight: 1.08,
                episodicWeight: 0.98,
                reason: 'explicit_recall_bias',
            };
        }

        return {
            preferredType: 'balanced',
            semanticWeight: 1,
            episodicWeight: 1,
            reason: 'soft_default_balance',
        };
    }

    /**
     * Sinyallere gore retrieval recipe secimi
     */
    selectRecipe(signals: RetrievalIntentSignals): PromptContextRecipe {
        // GraphRAG engine varsa ve analitik/kesif sinyalleri gucluyse GraphRAG recipe sec
        if (this.deps.graphRAGEngine) {
            if (signals.hasAnalyticalCue && signals.hasExploratoryCue) {
                return GRAPH_RAG_RECIPES.graph_rag_deep!;
            }
            if (signals.hasExploratoryCue || signals.hasAnalyticalCue) {
                return GRAPH_RAG_RECIPES.graph_rag_exploration!;
            }
        }

        if (signals.hasPreferenceCue) {
            return {
                name: 'preference_recall',
                graphDepth: 1,
                preferArchivalForSupplemental: false,
                expandFallbackPool: false,
                preferReviewSignals: true,
                preferConversationSignals: false,
            };
        }

        if (signals.hasFollowUpCue) {
            return {
                name: 'conversation_followup',
                graphDepth: 2,
                preferArchivalForSupplemental: false,
                expandFallbackPool: true,
                preferReviewSignals: true,
                preferConversationSignals: true,
            };
        }

        if (signals.hasQuestion && !signals.hasRecentContext) {
            return {
                name: 'exploratory',
                graphDepth: 2,
                preferArchivalForSupplemental: true,
                expandFallbackPool: true,
                preferReviewSignals: false,
                preferConversationSignals: false,
            };
        }

        return {
            name: 'default',
            graphDepth: 2,
            preferArchivalForSupplemental: false,
            expandFallbackPool: true,
            preferReviewSignals: true,
            preferConversationSignals: true,
        };
    }

    /**
     * Convenience: tum analizi tek cagrida calistir
     */
    analyze(
        query: string,
        recentMessages: { role: string; content: string; conversation_title?: string }[],
    ): {
        signals: RetrievalIntentSignals;
        recipe: PromptContextRecipe;
        typePreference: RetrievalTypePreference;
        cognitiveLoad: CognitiveLoadAssessment;
    } {
        const signals = this.detectSignals(query, recentMessages);
        const recipe = this.selectRecipe(signals);
        const typePreference = this.resolveTypePreference(signals, recipe);
        const cognitiveLoad = this.assessCognitiveLoad(signals, recipe);

        return { signals, recipe, typePreference, cognitiveLoad };
    }
}
