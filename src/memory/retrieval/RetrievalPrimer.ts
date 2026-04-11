import { computeReviewPriority } from '../contextUtils.js';
import type { MemoryRow } from '../types.js';
import type {
    BundleSelectionContext,
    CognitiveLoadAssessment,
    PromptContextRecipe,
    RetrievalIntentSignals,
    RetrievalPrimerSnapshot,
    RetrievalPrimingBonusSummary,
    RetrievalTypePreference,
} from './types.js';

function clampScore(value: number, min: number = 0, max: number = 2): number {
    return Math.max(min, Math.min(max, value));
}

function normalizeConfidence(confidence: number | null | undefined): number {
    if (!Number.isFinite(confidence)) return 0.7;
    return clampScore(Number(confidence), 0.2, 0.98);
}

function resolveReviewProfileWeight(reviewProfile: string | null | undefined): number {
    switch ((reviewProfile || 'standard').trim().toLowerCase()) {
        case 'strict':
            return 1.18;
        case 'durable':
            return 1.08;
        case 'volatile':
            return 0.9;
        default:
            return 1;
    }
}

function resolveProvenanceWeight(memory: MemoryRow, activeConversationId: string): number {
    let weight = 1;

    if (memory.provenance_conversation_id && memory.provenance_conversation_id === activeConversationId) {
        weight += 0.28;
    }

    if (memory.provenance_source === 'conversation') {
        weight += 0.08;
    } else if (memory.provenance_source === 'system') {
        weight += 0.04;
    }

    return weight;
}

function resolveMemoryTypeWeight(memory: MemoryRow, typePreference: RetrievalTypePreference): number {
    if (typePreference.preferredType === 'balanced') {
        return 1;
    }

    const memoryType = memory.memory_type ?? 'semantic';
    if (memoryType === 'episodic') {
        return typePreference.episodicWeight;
    }
    if (memoryType === 'semantic') {
        return typePreference.semanticWeight;
    }
    return 1;
}

function normalizePrimerText(text: string): string {
    return text
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenizePrimerText(text: string): string[] {
    return normalizePrimerText(text)
        .split(/\s+/)
        .map(token => token.trim())
        .filter(Boolean);
}

function extractPrimerTopicHints(query: string, recentMessages: Array<{ role: string; content: string }>): string[] {
    const stopwords = new Set([
        'acaba', 'adim', 'ama', 'analiz', 'artik', 'aslında', 'az', 'bazi', 'bana', 'beni', 'benim', 'bir', 'biraz',
        'biz', 'bu', 'bunu', 'boyle', 'cok', 'cunku', 'da', 'daha', 'de', 'defa', 'diye', 'durum', 'en', 'gibi',
        'gore', 'hangi', 'hatirla', 'hem', 'icin', 'ile', 'ise', 'is', 'iyi', 'kadar', 'kendi', 'kez', 'konu',
        'mi', 'mi', 'mu', 'mu', 'nasil', 'ne', 'neden', 'nedir', 'olarak', 'olan', 'oldugunu', 'olsun', 'onu',
        'orada', 'profil', 'sanki', 'sence', 'senin', 'son', 'sonra', 'soyle', 'sey', 'takip', 'tercih', 've',
        'veya', 'ya', 'yani', 'yap', 'yapalim', 'yardim', 'yorum', 'about', 'actually', 'an', 'and', 'any',
        'are', 'around', 'because', 'brainstorm', 'compare', 'context', 'default', 'do', 'does', 'explain',
        'follow', 'focused', 'for', 'from', 'how', 'idea', 'ideas', 'info', 'information', 'is', 'it', 'like',
        'me', 'my', 'of', 'on', 'or', 'please', 'prefer', 'preference', 'profile', 'progress', 'question',
        'recall', 'recent', 'remember', 'selam', 'should', 'soft', 'status', 'step', 'tell', 'that', 'the', 'them',
        'there', 'this', 'update', 'what', 'why', 'with', 'would', 'your', 'durumu', 'durumunu', 'konuyu',
        'tercihlerimi', 'profilimi', 'hatirla', 'soyler', 'soyle', 'takip', 'edelim', 'nedir', 'oner', 'fikir',
        'secentler', 'hakkinda', 'bilgi', 'ver', 'calisiyor', 'calisiyor?', 'konusunda', 'bugun', 'dun',
    ]);
    const tokens = tokenizePrimerText([
        query,
        ...recentMessages.slice(0, 2).map(message => message.content),
    ].join(' '));
    const seen = new Set<string>();
    const hints: string[] = [];

    for (const token of tokens) {
        if (token.length < 4 || stopwords.has(token) || seen.has(token)) {
            continue;
        }
        seen.add(token);
        hints.push(token);
        if (hints.length >= 4) {
            break;
        }
    }

    return hints;
}

function extractPrimerEntityHints(query: string, recentMessages: Array<{ role: string; content: string }>): string[] {
    const combinedText = [query, ...recentMessages.slice(0, 2).map(message => message.content)].join(' ');
    const matches = combinedText.match(/\b(?:[A-ZÇĞİÖŞÜ][\p{L}\p{N}_-]{2,}|[A-Z]{2,}[\p{L}\p{N}_-]*)\b/gu) ?? [];
    const excludedEntities = new Set([
        'acaba', 'bu', 'bunu', 'genel', 'hangi', 'kullanici', 'ne', 'neden', 'nedir', 'profilimi',
        'selam', 'son', 'soyle', 'takip', 'tercihlerimi', 've', 'veya', 'yardim',
    ]);
    const seen = new Set<string>();
    const hints: string[] = [];

    for (const match of matches) {
        const normalized = normalizePrimerText(match);
        if (!normalized || excludedEntities.has(normalized) || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        hints.push(normalized);
        if (hints.length >= 3) {
            break;
        }
    }

    return hints;
}

export class RetrievalPrimer {
    /**
     * TF tabanli konu tokeni cikarma (max 4)
     */
    extractTopicHints(query: string, recentMessages: { role: string; content: string; conversation_title?: string }[]): string[] {
        const recentUserMessages = recentMessages.filter(message => message.role === 'user').slice(0, 2);
        return extractPrimerTopicHints(query, recentUserMessages);
    }

    /**
     * Buyuk harfli entity cikarma (max 3)
     */
    extractEntityHints(query: string, recentMessages: { role: string; content: string; conversation_title?: string }[]): string[] {
        const recentUserMessages = recentMessages.filter(message => message.role === 'user').slice(0, 2);
        return extractPrimerEntityHints(query, recentUserMessages);
    }

    /**
     * Tam priming snapshot olusturma
     */
    buildPrimer(
        query: string,
        recentMessages: { role: string; content: string; created_at: string; conversation_title: string }[],
        signals: RetrievalIntentSignals,
        recipe: PromptContextRecipe,
    ): RetrievalPrimerSnapshot {
        const recentUserMessages = recentMessages.filter(message => message.role === 'user');
        const entityHints = extractPrimerEntityHints(query, recentUserMessages);
        const topicHints = extractPrimerTopicHints(query, recentUserMessages);
        const typeHints: Array<'episodic' | 'semantic'> = [];
        const reasons: string[] = [];
        const hasMeaningfulTopicSignal = topicHints.length >= 2 || (topicHints.length === 1 && signals.queryLength >= 12);
        const focusedQuery = !signals.hasExploratoryCue
            && !signals.hasAnalyticalCue
            && signals.queryLength > 0
            && signals.clauseCount <= 2
            && (entityHints.length > 0 || hasMeaningfulTopicSignal);

        if (entityHints.length > 0) reasons.push('entity_hint');
        if (hasMeaningfulTopicSignal) reasons.push('topic_hint');
        if (signals.hasPreferenceCue) {
            typeHints.push('semantic');
            reasons.push('preference_profile_query');
        }
        if (signals.hasFollowUpCue || recipe.name === 'conversation_followup') {
            typeHints.push('episodic');
            reasons.push('recent_follow_up_context');
        }
        if (signals.hasExploratoryCue || recipe.name === 'exploratory') {
            reasons.push('exploratory_context');
        }
        if (focusedQuery) {
            reasons.push('focused_query');
        }

        const dedupedTypeHints = Array.from(new Set(typeHints));
        const bonusSummary: RetrievalPrimingBonusSummary = {
            entityMatchBonus: entityHints.length > 0 ? 0.08 : 0,
            topicMatchBonus: hasMeaningfulTopicSignal ? 0.05 : 0,
            typeMatchBonus: dedupedTypeHints.length > 0 ? 0.04 : 0,
            recentContextBonus: signals.hasRecentContext ? 0.03 : 0,
            focusedQueryBonus: focusedQuery ? 0.02 : 0,
            preferenceBiasBonus: signals.hasPreferenceCue ? 0.03 : 0,
            followUpBiasBonus: signals.hasFollowUpCue ? 0.03 : 0,
            exploratoryBiasBonus: signals.hasExploratoryCue || recipe.name === 'exploratory' ? 0.01 : 0,
            maxCandidateBonus: 0,
        };

        bonusSummary.maxCandidateBonus = Number((
            bonusSummary.entityMatchBonus
            + bonusSummary.topicMatchBonus
            + bonusSummary.typeMatchBonus
            + bonusSummary.recentContextBonus
            + bonusSummary.focusedQueryBonus
            + Math.max(bonusSummary.preferenceBiasBonus, bonusSummary.followUpBiasBonus, bonusSummary.exploratoryBiasBonus)
        ).toFixed(3));

        return {
            triggered: reasons.length > 0,
            reasons,
            entityHints,
            topicHints,
            typeHints: dedupedTypeHints,
            bonusSummary,
        };
    }

    /**
     * Bir memory icin toplam priming bonusunu hesaplama (cap'li)
     */
    computeBonus(memory: MemoryRow, context: BundleSelectionContext): number {
        const primer = context.primer;
        if (!primer.triggered) {
            return 0;
        }

        const normalizedMemoryText = normalizePrimerText([
            memory.content,
            memory.category,
            memory.provenance_source ?? '',
            memory.memory_type ?? '',
        ].join(' '));
        let bonus = 0;

        if (primer.entityHints.some(entity => normalizedMemoryText.includes(entity))) {
            bonus += primer.bonusSummary.entityMatchBonus;
        }
        if (primer.topicHints.some(topic => normalizedMemoryText.includes(topic))) {
            bonus += primer.bonusSummary.topicMatchBonus;
        }
        if (primer.typeHints.length > 0 && memory.memory_type && primer.typeHints.includes(memory.memory_type)) {
            bonus += primer.bonusSummary.typeMatchBonus;
        }
        if (
            primer.reasons.includes('recent_follow_up_context')
            && memory.provenance_conversation_id
            && memory.provenance_conversation_id === context.activeConversationId
        ) {
            bonus += primer.bonusSummary.recentContextBonus;
        }
        if (
            primer.reasons.includes('focused_query')
            && (primer.entityHints.some(entity => normalizedMemoryText.includes(entity))
                || primer.topicHints.some(topic => normalizedMemoryText.includes(topic)))
        ) {
            bonus += primer.bonusSummary.focusedQueryBonus;
        }
        if (primer.reasons.includes('preference_profile_query') && memory.memory_type === 'semantic') {
            bonus += primer.bonusSummary.preferenceBiasBonus;
        }
        if (primer.reasons.includes('recent_follow_up_context') && memory.memory_type === 'episodic') {
            bonus += primer.bonusSummary.followUpBiasBonus;
        }
        if (primer.reasons.includes('exploratory_context') && memory.memory_type === 'semantic') {
            bonus += primer.bonusSummary.exploratoryBiasBonus;
        }

        return Math.min(primer.bonusSummary.maxCandidateBonus, Number(bonus.toFixed(3)));
    }

    /**
     * Base signal skoru hesaplama
     */
    computeSignalScore(memory: MemoryRow, activeConversationId: string, recipe: PromptContextRecipe, typePreference: RetrievalTypePreference): number {
        const confidenceWeight = 0.85 + normalizeConfidence(memory.confidence) * 0.35;
        const reviewProfileWeight = resolveReviewProfileWeight(memory.review_profile);
        const provenanceWeight = resolveProvenanceWeight(memory, activeConversationId);
        const reviewUrgencyWeight = recipe.preferReviewSignals
            ? 1 + Math.min(0.35, computeReviewPriority(memory) / 18)
            : 1;
        const memoryTypeWeight = resolveMemoryTypeWeight(memory, typePreference);

        return confidenceWeight * reviewProfileWeight * provenanceWeight * reviewUrgencyWeight * memoryTypeWeight;
    }

    /**
     * Combined base ranking skoru
     */
    computeBaseScore(signalScore: number, primingBonus: number, memory: MemoryRow): number {
        return signalScore
            + primingBonus
            + (memory.importance * 0.04)
            + (memory.access_count * 0.015);
    }
}
