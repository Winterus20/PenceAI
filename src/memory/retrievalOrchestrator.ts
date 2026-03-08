import { computeReviewPriority, selectConversationAwareSupplementalMemories } from './contextUtils.js';
import type { GraphAwareSearchResult, MemoryRow, MemoryType } from './types.js';

type MemoryRelationNeighbor = MemoryRow & {
    relation_type: string;
    confidence: number;
    relation_description: string;
};

interface RetrievalPrimingBonusSummary {
    entityMatchBonus: number;
    topicMatchBonus: number;
    typeMatchBonus: number;
    recentContextBonus: number;
    focusedQueryBonus: number;
    preferenceBiasBonus: number;
    followUpBiasBonus: number;
    exploratoryBiasBonus: number;
    maxCandidateBonus: number;
}

interface RetrievalPrimerSnapshot {
    triggered: boolean;
    reasons: string[];
    entityHints: string[];
    topicHints: string[];
    typeHints: MemoryType[];
    bonusSummary: RetrievalPrimingBonusSummary;
}

interface RetrievalMemoryBreakdown {
    total: number;
    byCategory: Record<string, number>;
    bySource: Record<string, number>;
    byMemoryType: Record<MemoryType | 'unknown', number>;
    archivalCount: number;
    activeCount: number;
    conversationScopedCount: number;
}

interface RetrievalTypePreference {
    preferredType: MemoryType | 'balanced';
    episodicWeight: number;
    semanticWeight: number;
    reason: string;
}

interface RetrievalSelectionSnapshot {
    candidateCount: number;
    selectedCount: number;
    selectedIds: number[];
    breakdown: RetrievalMemoryBreakdown;
}

export interface PromptContextBundle {
    relevantMemories: MemoryRow[];
    archivalMemories: MemoryRow[];
    supplementalMemories: MemoryRow[];
    conversationSummaries: Array<{ id: string; title: string; summary: string; updated_at: string }>;
    reviewMemories: MemoryRow[];
    followUpCandidates: MemoryRow[];
    recentMessages: Array<{ role: string; content: string; created_at: string; conversation_title: string }>;
}

export interface PromptContextRequest {
    query: string;
    activeConversationId: string;
    options?: {
        searchLimit?: number;
        summaryLimit?: number;
        reviewLimit?: number;
        followUpDays?: number;
        followUpLimit?: number;
        relevantMemoryLimit?: number;
        fallbackMemoryLimit?: number;
        recentHours?: number;
        recentMessagesLimit?: number;
    };
}

export interface PromptContextRecipe {
    name: 'default' | 'conversation_followup' | 'preference_recall' | 'exploratory';
    graphDepth: number;
    preferArchivalForSupplemental: boolean;
    expandFallbackPool: boolean;
    preferReviewSignals: boolean;
    preferConversationSignals: boolean;
}

export interface RetrievalOrchestratorDeps {
    graphAwareSearch: (query: string, limit: number, maxDepth?: number) => Promise<GraphAwareSearchResult>;
    getRecentConversationSummaries: (limit: number) => Array<{ id: string; title: string; summary: string; updated_at: string }>;
    getMemoriesDueForReview: (limit: number) => MemoryRow[];
    getFollowUpCandidates: (days: number, limit: number) => MemoryRow[];
    getRecentMessages: (hours: number, limit: number, excludeConversationId?: string) => Array<{ role: string; content: string; created_at: string; conversation_title: string }>;
    getUserMemories: (limit: number) => MemoryRow[];
    getMemoryNeighborsBatch?: (memoryIds: number[], limitPerNode: number) => Map<number, MemoryRelationNeighbor[]>;
    getSpreadingActivationConfig?: () => Partial<RetrievalSpreadingActivationConfig>;
    prioritizeConversationMemories: (
        memories: MemoryRow[],
        recentMessages: Array<{ role: string; content: string; created_at: string; conversation_title: string }>,
        activeConversationId: string,
        limit: number,
    ) => MemoryRow[];
    recordDebug: (payload: unknown) => void;
}

interface RetrievalIntentSignals {
    hasQuestion: boolean;
    hasPreferenceCue: boolean;
    hasFollowUpCue: boolean;
    hasRecentContext: boolean;
    hasAnalyticalCue: boolean;
    hasExploratoryCue: boolean;
    queryLength: number;
    clauseCount: number;
}

type CognitiveLoadLevel = 'low' | 'medium' | 'high';

type BudgetProfileName = 'supportive_expansion' | 'balanced_default' | 'focused_recall';

interface CognitiveLoadAssessment {
    level: CognitiveLoadLevel;
    score: number;
    reasons: string[];
}

type DualProcessMode = 'system1' | 'system2';

interface DualProcessRoutingSnapshot {
    selectedMode: DualProcessMode;
    routingReasons: string[];
    escalationTriggers: string[];
    secondPassApplied: boolean;
    secondPassSummary: string | null;
    adjustedBudgetProfile: BudgetProfileName;
    adjustedGraphDepth: number;
}

interface RetrievalBudgetProfile {
    name: BudgetProfileName;
    relevantLimit: number;
    archivalLimit: number;
    supplementalLimit: number;
    fallbackPoolMultiplier: number;
    candidateExpansionFactor: number;
    reviewLimit: number;
    followUpLimit: number;
}

interface RetrievalBudgetApplication {
    profile: RetrievalBudgetProfile;
    relevantLimit: number;
    archivalLimit: number;
    supplementalLimit: number;
    fallbackPoolSize: number;
    reviewLimit: number;
    followUpLimit: number;
    candidateExpansionLimit: number;
    selectionReasons: string[];
}

type RetrievalSpreadingActivationRolloutState = 'off' | 'shadow' | 'soft';

interface RetrievalSpreadingActivationConfig {
    enabled: boolean;
    rolloutState: RetrievalSpreadingActivationRolloutState;
    seedLimit: number;
    neighborsPerSeed: number;
    maxCandidates: number;
    maxHopDepth: number;
    seedConfidenceFloor: number;
    seedScoreFloor: number;
    candidateConfidenceFloor: number;
    relationConfidenceFloor: number;
    minEffectiveBonus: number;
    hopDecay: number;
    activationScale: number;
    maxCandidateBonus: number;
}

interface RetrievalSpreadingActivationReason {
    seedId: number;
    targetId: number;
    relationType: string;
    relationConfidence: number;
    hop: number;
    decayApplied: number;
    rawBonus: number;
    bonusApplied: number;
    candidateConfidence: number;
    description: string;
    capped: boolean;
}

interface RetrievalActivatedCandidateSummary {
    id: number;
    bonus: number;
    strongestSeedId: number;
    relationType: string;
    relationConfidence: number;
    candidateConfidence: number;
    hop: number;
    decayApplied: number;
    capped: boolean;
}

interface RetrievalSpreadingActivationSkipSummary {
    reason: string;
    count: number;
    sampleIds: number[];
}

interface RetrievalSpreadingActivationSnapshot {
    enabled: boolean;
    rolloutState: RetrievalSpreadingActivationRolloutState;
    shadowMode: boolean;
    appliedToRanking: boolean;
    seedCount: number;
    seedIds: number[];
    activatedCandidateCount: number;
    activatedCandidates: RetrievalActivatedCandidateSummary[];
    reasons: RetrievalSpreadingActivationReason[];
    skips: {
        seeds: RetrievalSpreadingActivationSkipSummary[];
        neighbors: RetrievalSpreadingActivationSkipSummary[];
    };
    guardrails: {
        eligibleSeedCount: number;
        eligibleActivatedCandidateCount: number;
        seedLimitTriggered: boolean;
        maxCandidateLimitTriggered: boolean;
        candidateBonusCapTriggered: boolean;
        relationFloorSkips: number;
        seedQualitySkips: number;
        candidateQualitySkips: number;
        minBonusSkips: number;
    };
    bonusSummary: {
        activationScale: number;
        hopDecay: number;
        maxCandidateBonus: number;
        minEffectiveBonus: number;
        totalBonusApplied: number;
        strongestBonus: number;
    };
}

interface RetrievalSpreadingActivationState {
    config: RetrievalSpreadingActivationConfig;
    snapshot: RetrievalSpreadingActivationSnapshot;
    bonusByMemoryId: Map<number, number>;
}

interface BundleSelectionContext {
    query: string;
    activeConversationId: string;
    recentMessages: Array<{ role: string; content: string; created_at: string; conversation_title: string }>;
    recipe: PromptContextRecipe;
    typePreference: RetrievalTypePreference;
    cognitiveLoad: CognitiveLoadAssessment;
    primer: RetrievalPrimerSnapshot;
    dualProcess: DualProcessRoutingSnapshot;
    spreadingActivation: RetrievalSpreadingActivationState;
}

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
        .toLocaleLowerCase('tr-TR')
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
        'acaba', 'adım', 'ama', 'analiz', 'artık', 'aslında', 'az', 'bazı', 'bana', 'beni', 'benim', 'bir', 'biraz',
        'biz', 'bu', 'bunu', 'böyle', 'çok', 'çünkü', 'da', 'daha', 'de', 'defa', 'diye', 'durum', 'en', 'gibi',
        'göre', 'hangi', 'hatırla', 'hem', 'için', 'ile', 'ise', 'iş', 'iyi', 'kadar', 'kendi', 'kez', 'konu',
        'mı', 'mi', 'mu', 'mü', 'nasıl', 'ne', 'neden', 'nedir', 'olarak', 'olan', 'olduğunu', 'olsun', 'onu',
        'orada', 'profil', 'sanki', 'sence', 'senin', 'son', 'sonra', 'söyle', 'şey', 'takip', 'tercih', 've',
        'veya', 'ya', 'yani', 'yap', 'yapalım', 'yardım', 'yorum', 'about', 'actually', 'an', 'and', 'any',
        'are', 'around', 'because', 'brainstorm', 'compare', 'context', 'default', 'do', 'does', 'explain',
        'follow', 'focused', 'for', 'from', 'how', 'idea', 'ideas', 'info', 'information', 'is', 'it', 'like',
        'me', 'my', 'of', 'on', 'or', 'please', 'prefer', 'preference', 'profile', 'progress', 'question',
        'recall', 'recent', 'remember', 'selam', 'should', 'soft', 'status', 'step', 'tell', 'that', 'the', 'them',
        'there', 'this', 'update', 'what', 'why', 'with', 'would', 'your', 'durumu', 'durumunu', 'konuyu',
        'tercihlerimi', 'profilimi', 'hatırla', 'söyler', 'söyle', 'takip', 'edelim', 'nedir', 'öner', 'fikir',
        'seçenekler', 'hakkında', 'bilgi', 'ver', 'çalışıyor', 'çalışıyor?', 'konusunda', 'bugün', 'dün',
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
        'acaba', 'bu', 'bunu', 'genel', 'hangi', 'kullanıcı', 'ne', 'neden', 'nedir', 'penceai', 'penceaiı', 'profilimi',
        'selam', 'son', 'söyle', 'takip', 'tercihlerimi', 've', 'veya', 'yardım',
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

function buildRetrievalPrimer(
    query: string,
    recentMessages: Array<{ role: string; content: string; created_at: string; conversation_title: string }>,
    signals: RetrievalIntentSignals,
    recipe: PromptContextRecipe,
): RetrievalPrimerSnapshot {
    const recentUserMessages = recentMessages.filter(message => message.role === 'user');
    const entityHints = extractPrimerEntityHints(query, recentUserMessages);
    const topicHints = extractPrimerTopicHints(query, recentUserMessages);
    const typeHints: MemoryType[] = [];
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

function computePrimingBonus(memory: MemoryRow, context: BundleSelectionContext): number {
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

function computeRetrievalSignalScore(memory: MemoryRow, context: BundleSelectionContext): number {
    const confidenceWeight = 0.85 + normalizeConfidence(memory.confidence) * 0.35;
    const reviewProfileWeight = resolveReviewProfileWeight(memory.review_profile);
    const provenanceWeight = resolveProvenanceWeight(memory, context.activeConversationId);
    const reviewUrgencyWeight = context.recipe.preferReviewSignals
        ? 1 + Math.min(0.35, computeReviewPriority(memory) / 18)
        : 1;
    const memoryTypeWeight = resolveMemoryTypeWeight(memory, context.typePreference);

    return confidenceWeight * reviewProfileWeight * provenanceWeight * reviewUrgencyWeight * memoryTypeWeight;
}

function computeBaseRankingScore(memory: MemoryRow, context: BundleSelectionContext): number {
    return computeRetrievalSignalScore(memory, context)
        + computePrimingBonus(memory, context)
        + (memory.importance * 0.04)
        + (memory.access_count * 0.015);
}

function buildSpreadingActivationConfig(overrides?: Partial<RetrievalSpreadingActivationConfig>): RetrievalSpreadingActivationConfig {
    return {
        enabled: true,
        rolloutState: 'shadow',
        seedLimit: 2,
        neighborsPerSeed: 3,
        maxCandidates: 3,
        maxHopDepth: 1,
        seedConfidenceFloor: 0.72,
        seedScoreFloor: 1.28,
        candidateConfidenceFloor: 0.68,
        relationConfidenceFloor: 0.55,
        minEffectiveBonus: 0.025,
        hopDecay: 0.55,
        activationScale: 0.05,
        maxCandidateBonus: 0.05,
        ...overrides,
    };
}

function summarizeActivationSkips(entries: Array<{ id: number; reason: string }>): RetrievalSpreadingActivationSkipSummary[] {
    const grouped = new Map<string, number[]>();
    for (const entry of entries) {
        const ids = grouped.get(entry.reason) ?? [];
        ids.push(entry.id);
        grouped.set(entry.reason, ids);
    }

    return Array.from(grouped.entries())
        .map(([reason, ids]) => ({
            reason,
            count: ids.length,
            sampleIds: ids.slice(0, 5),
        }))
        .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

function buildInactiveSpreadingActivationState(config: RetrievalSpreadingActivationConfig): RetrievalSpreadingActivationState {
    const appliedToRanking = config.enabled && config.rolloutState === 'soft';
    return {
        config,
        bonusByMemoryId: new Map<number, number>(),
        snapshot: {
            enabled: config.enabled,
            rolloutState: config.rolloutState,
            shadowMode: config.rolloutState === 'shadow',
            appliedToRanking,
            seedCount: 0,
            seedIds: [],
            activatedCandidateCount: 0,
            activatedCandidates: [],
            reasons: [],
            skips: {
                seeds: [],
                neighbors: [],
            },
            guardrails: {
                eligibleSeedCount: 0,
                eligibleActivatedCandidateCount: 0,
                seedLimitTriggered: false,
                maxCandidateLimitTriggered: false,
                candidateBonusCapTriggered: false,
                relationFloorSkips: 0,
                seedQualitySkips: 0,
                candidateQualitySkips: 0,
                minBonusSkips: 0,
            },
            bonusSummary: {
                activationScale: config.activationScale,
                hopDecay: config.hopDecay,
                maxCandidateBonus: config.maxCandidateBonus,
                minEffectiveBonus: config.minEffectiveBonus,
                totalBonusApplied: 0,
                strongestBonus: 0,
            },
        },
    };
}

function buildSpreadingActivationState(
    deps: RetrievalOrchestratorDeps,
    relevantBase: MemoryRow[],
    context: Omit<BundleSelectionContext, 'spreadingActivation'>,
): RetrievalSpreadingActivationState {
    const config = buildSpreadingActivationConfig(deps.getSpreadingActivationConfig?.());
    const inactiveState = buildInactiveSpreadingActivationState(config);
    if (!config.enabled || config.rolloutState === 'off' || !deps.getMemoryNeighborsBatch || relevantBase.length === 0) {
        return inactiveState;
    }

    const seedSkipEntries: Array<{ id: number; reason: string }> = [];
    const neighborSkipEntries: Array<{ id: number; reason: string }> = [];
    let relationFloorSkips = 0;
    let seedQualitySkips = 0;
    let candidateQualitySkips = 0;
    let minBonusSkips = 0;
    let candidateBonusCapTriggered = false;

    const scoredCandidates = relevantBase
        .map(memory => ({
            memory,
            normalizedConfidence: normalizeConfidence(memory.confidence),
            score: computeBaseRankingScore(memory, { ...context, spreadingActivation: inactiveState }),
        }))
        .sort((a, b) => b.score - a.score || b.memory.updated_at.localeCompare(a.memory.updated_at));

    const eligibleSeeds = scoredCandidates.filter(entry => {
        if (entry.normalizedConfidence < config.seedConfidenceFloor) {
            seedQualitySkips += 1;
            seedSkipEntries.push({ id: entry.memory.id, reason: 'seed_confidence_below_floor' });
            return false;
        }
        if (entry.score < config.seedScoreFloor) {
            seedQualitySkips += 1;
            seedSkipEntries.push({ id: entry.memory.id, reason: 'seed_score_below_floor' });
            return false;
        }
        return true;
    });

    const scoredSeeds = eligibleSeeds.slice(0, config.seedLimit);
    const seedIds = scoredSeeds.map(entry => entry.memory.id);
    if (seedIds.length === 0) {
        return {
            ...inactiveState,
            snapshot: {
                ...inactiveState.snapshot,
                skips: {
                    seeds: summarizeActivationSkips(seedSkipEntries),
                    neighbors: [],
                },
                guardrails: {
                    ...inactiveState.snapshot.guardrails,
                    eligibleSeedCount: eligibleSeeds.length,
                    seedQualitySkips,
                },
            },
        };
    }

    const candidateIds = new Set(relevantBase.map(memory => memory.id));
    const bonusByMemoryId = new Map<number, number>();
    const strongestReasonByTarget = new Map<number, RetrievalSpreadingActivationReason>();
    const allReasons: RetrievalSpreadingActivationReason[] = [];
    const neighborMap = deps.getMemoryNeighborsBatch(seedIds, config.neighborsPerSeed);

    for (const seedId of seedIds) {
        const neighbors = neighborMap.get(seedId) ?? [];
        for (const neighbor of neighbors) {
            if (!candidateIds.has(neighbor.id) || neighbor.id === seedId) {
                neighborSkipEntries.push({ id: neighbor.id, reason: 'target_not_in_candidate_pool' });
                continue;
            }

            const relationConfidence = normalizeConfidence(neighbor.confidence);
            if (relationConfidence < config.relationConfidenceFloor) {
                relationFloorSkips += 1;
                neighborSkipEntries.push({ id: neighbor.id, reason: 'relation_confidence_below_floor' });
                continue;
            }

            const candidateConfidence = normalizeConfidence(neighbor.confidence);
            if (candidateConfidence < config.candidateConfidenceFloor) {
                candidateQualitySkips += 1;
                neighborSkipEntries.push({ id: neighbor.id, reason: 'candidate_confidence_below_floor' });
                continue;
            }

            const hop = 1;
            const decayApplied = Number(Math.pow(config.hopDecay, hop - 1).toFixed(3));
            const rawBonus = Number((relationConfidence * config.activationScale * decayApplied).toFixed(3));
            if (rawBonus < config.minEffectiveBonus) {
                minBonusSkips += 1;
                neighborSkipEntries.push({ id: neighbor.id, reason: 'bonus_below_effective_floor' });
                continue;
            }

            const uncappedBonus = (bonusByMemoryId.get(neighbor.id) ?? 0) + rawBonus;
            const nextBonus = Number(Math.min(config.maxCandidateBonus, uncappedBonus).toFixed(3));
            const capped = uncappedBonus > config.maxCandidateBonus;
            if (capped) {
                candidateBonusCapTriggered = true;
            }
            bonusByMemoryId.set(neighbor.id, nextBonus);

            const reason: RetrievalSpreadingActivationReason = {
                seedId,
                targetId: neighbor.id,
                relationType: neighbor.relation_type,
                relationConfidence: Number(relationConfidence.toFixed(3)),
                hop,
                decayApplied,
                rawBonus,
                bonusApplied: Number(Math.min(config.maxCandidateBonus, rawBonus).toFixed(3)),
                candidateConfidence: Number(candidateConfidence.toFixed(3)),
                description: neighbor.relation_description || '',
                capped,
            };
            allReasons.push(reason);

            const strongestExisting = strongestReasonByTarget.get(neighbor.id);
            if (!strongestExisting || reason.bonusApplied > strongestExisting.bonusApplied) {
                strongestReasonByTarget.set(neighbor.id, reason);
            }
        }
    }

    const activatedCandidatesAll = Array.from(bonusByMemoryId.entries())
        .map(([id, bonus]) => {
            const strongestReason = strongestReasonByTarget.get(id);
            if (!strongestReason) return null;
            return {
                id,
                bonus,
                strongestSeedId: strongestReason.seedId,
                relationType: strongestReason.relationType,
                relationConfidence: strongestReason.relationConfidence,
                candidateConfidence: strongestReason.candidateConfidence,
                hop: strongestReason.hop,
                decayApplied: strongestReason.decayApplied,
                capped: strongestReason.capped,
            };
        })
        .filter((entry): entry is RetrievalActivatedCandidateSummary => Boolean(entry))
        .sort((a, b) => b.bonus - a.bonus || a.id - b.id);

    const activatedCandidates = activatedCandidatesAll.slice(0, config.maxCandidates);
    const retainedCandidateIds = new Set(activatedCandidates.map(candidate => candidate.id));
    const rankingBonuses = new Map<number, number>();
    for (const [memoryId, bonus] of bonusByMemoryId.entries()) {
        if (retainedCandidateIds.has(memoryId)) {
            rankingBonuses.set(memoryId, bonus);
        } else {
            neighborSkipEntries.push({ id: memoryId, reason: 'activated_candidate_truncated' });
        }
    }

    const totalBonusApplied = Number(
        Array.from(rankingBonuses.values()).reduce((sum, bonus) => sum + bonus, 0).toFixed(3),
    );
    const strongestBonus = activatedCandidates.length > 0 ? activatedCandidates[0].bonus : 0;
    const appliedToRanking = config.rolloutState === 'soft';

    return {
        config,
        bonusByMemoryId: appliedToRanking ? rankingBonuses : new Map<number, number>(),
        snapshot: {
            enabled: config.enabled,
            rolloutState: config.rolloutState,
            shadowMode: config.rolloutState === 'shadow',
            appliedToRanking,
            seedCount: seedIds.length,
            seedIds,
            activatedCandidateCount: activatedCandidatesAll.length,
            activatedCandidates,
            reasons: allReasons.slice(0, config.seedLimit * config.neighborsPerSeed),
            skips: {
                seeds: summarizeActivationSkips(seedSkipEntries),
                neighbors: summarizeActivationSkips(neighborSkipEntries),
            },
            guardrails: {
                eligibleSeedCount: eligibleSeeds.length,
                eligibleActivatedCandidateCount: activatedCandidatesAll.length,
                seedLimitTriggered: eligibleSeeds.length > config.seedLimit,
                maxCandidateLimitTriggered: activatedCandidatesAll.length > config.maxCandidates,
                candidateBonusCapTriggered,
                relationFloorSkips,
                seedQualitySkips,
                candidateQualitySkips,
                minBonusSkips,
            },
            bonusSummary: {
                activationScale: config.activationScale,
                hopDecay: config.hopDecay,
                maxCandidateBonus: config.maxCandidateBonus,
                minEffectiveBonus: config.minEffectiveBonus,
                totalBonusApplied,
                strongestBonus,
            },
        },
    };
}

function computeSpreadingActivationBonus(memory: MemoryRow, context: BundleSelectionContext): number {
    if (!context.spreadingActivation.snapshot.appliedToRanking) {
        return 0;
    }
    return context.spreadingActivation.bonusByMemoryId.get(memory.id) ?? 0;
}

function rankMemoriesBySignals(memories: MemoryRow[], limit: number, context: BundleSelectionContext): MemoryRow[] {
    return memories
        .map(memory => ({
            memory,
            score: computeBaseRankingScore(memory, context)
                + computeSpreadingActivationBonus(memory, context),
        }))
        .sort((a, b) => b.score - a.score || b.memory.updated_at.localeCompare(a.memory.updated_at))
        .slice(0, limit)
        .map(entry => entry.memory);
}

function summarizeMemoryBreakdown(memories: MemoryRow[], activeConversationId: string): RetrievalMemoryBreakdown {
    const breakdown: RetrievalMemoryBreakdown = {
        total: memories.length,
        byCategory: {},
        bySource: {},
        byMemoryType: {
            episodic: 0,
            semantic: 0,
            unknown: 0,
        },
        archivalCount: 0,
        activeCount: 0,
        conversationScopedCount: 0,
    };

    for (const memory of memories) {
        const categoryKey = memory.category?.trim() || 'unknown';
        const sourceKey = memory.provenance_source?.trim() || 'unknown';
        const memoryTypeKey = memory.memory_type ?? 'unknown';

        breakdown.byCategory[categoryKey] = (breakdown.byCategory[categoryKey] ?? 0) + 1;
        breakdown.bySource[sourceKey] = (breakdown.bySource[sourceKey] ?? 0) + 1;
        breakdown.byMemoryType[memoryTypeKey] = (breakdown.byMemoryType[memoryTypeKey] ?? 0) + 1;

        if (memory.is_archived) {
            breakdown.archivalCount += 1;
        } else {
            breakdown.activeCount += 1;
        }

        if (memory.provenance_conversation_id && memory.provenance_conversation_id === activeConversationId) {
            breakdown.conversationScopedCount += 1;
        }
    }

    return breakdown;
}

function createSelectionSnapshot(
    candidates: MemoryRow[],
    selected: MemoryRow[],
    activeConversationId: string,
): RetrievalSelectionSnapshot {
    return {
        candidateCount: candidates.length,
        selectedCount: selected.length,
        selectedIds: selected.map(memory => memory.id),
        breakdown: summarizeMemoryBreakdown(selected, activeConversationId),
    };
}

function buildReasonList(
    signals: RetrievalIntentSignals,
    recipe: PromptContextRecipe,
    typePreference: RetrievalTypePreference,
    cognitiveLoad: CognitiveLoadAssessment,
    budgetApplication: RetrievalBudgetApplication,
    primer: RetrievalPrimerSnapshot,
    dualProcess: DualProcessRoutingSnapshot,
): string[] {
    const reasons = [
        `recipe:${recipe.name}`,
        `graph_depth:${recipe.graphDepth}`,
        `memory_type_preference:${typePreference.preferredType}`,
        `memory_type_reason:${typePreference.reason}`,
        `cognitive_load:${cognitiveLoad.level}`,
        `budget_profile:${budgetApplication.profile.name}`,
        ...cognitiveLoad.reasons.map(reason => `load_signal:${reason}`),
        ...budgetApplication.selectionReasons,
    ];

    if (signals.hasPreferenceCue) reasons.push('signal:preference_cue');
    if (signals.hasFollowUpCue) reasons.push('signal:follow_up_cue');
    if (signals.hasQuestion) reasons.push('signal:question');
    if (signals.hasRecentContext) reasons.push('signal:recent_context');
    if (signals.hasAnalyticalCue) reasons.push('signal:analytical_cue');
    if (signals.hasExploratoryCue) reasons.push('signal:exploratory_cue');
    if (recipe.preferConversationSignals) reasons.push('ranking:prefer_conversation_signals');
    if (recipe.preferReviewSignals) reasons.push('ranking:prefer_review_signals');
    if (recipe.preferArchivalForSupplemental) reasons.push('fallback:prefer_archival');
    if (recipe.expandFallbackPool) reasons.push('fallback:expanded_pool');

    reasons.push(`primer:triggered:${primer.triggered ? 'yes' : 'no'}`);
    reasons.push(...primer.reasons.map(reason => `primer:${reason}`));
    reasons.push(`dual_process:${dualProcess.selectedMode}`);
    reasons.push(...dualProcess.routingReasons.map(reason => `dual_process_reason:${reason}`));
    reasons.push(...dualProcess.escalationTriggers.map(trigger => `dual_process_trigger:${trigger}`));
    if (dualProcess.secondPassApplied) {
        reasons.push('dual_process:second_pass_applied');
    }

    return reasons;
}

function estimateMemoryTokenCount(memories: MemoryRow[]): number {
    return memories.reduce((total, memory) => total + Math.ceil(memory.content.length / 4), 0);
}

function resolveTypePreference(signals: RetrievalIntentSignals, recipe: PromptContextRecipe): RetrievalTypePreference {
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

    return {
        preferredType: 'balanced',
        semanticWeight: 1,
        episodicWeight: 1,
        reason: 'soft_default_balance',
    };
}

function detectIntentSignals(
    query: string,
    recentMessages: Array<{ role: string; content: string; created_at: string; conversation_title: string }>,
): RetrievalIntentSignals {
    const normalizedQuery = query.toLowerCase();
    const recentUserMessages = recentMessages.filter(message => message.role === 'user').slice(0, 4);
    const clauseCount = query
        .split(/[,.!?;:\n]+/)
        .map(part => part.trim())
        .filter(Boolean)
        .length;

    return {
        hasQuestion: /\?|nasıl|neden|ne|hangi|hatırla|remember|recall/.test(normalizedQuery),
        hasPreferenceCue: /tercih|sev|sever|istemem|favori|alışkanlık|preference|prefer|like|dislike/.test(normalizedQuery),
        hasFollowUpCue: /takip|devam|son durum|güncel|update|follow[ -]?up|progress|durum|az önce|demin|bugün|dün/.test(normalizedQuery),
        hasRecentContext: recentUserMessages.some(message => message.content.trim().length > 0),
        hasAnalyticalCue: /analiz|karşılaştır|trade-?off|step by step|adım adım|değerlendir|planla|reason|explain|why|diagnose/.test(normalizedQuery),
        hasExploratoryCue: /öner|fikir|araştır|keşfet|alternatif|recipe|tarif|brainstorm|explore|options|ideas/.test(normalizedQuery),
        queryLength: query.trim().length,
        clauseCount,
    };
}

function assessCognitiveLoad(signals: RetrievalIntentSignals, recipe: PromptContextRecipe): CognitiveLoadAssessment {
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

function applyCognitiveLoadBudget(
    recipe: PromptContextRecipe,
    cognitiveLoad: CognitiveLoadAssessment,
    limits: {
        searchLimit: number;
        relevantMemoryLimit: number;
        fallbackMemoryLimit: number;
        reviewLimit: number;
        followUpLimit: number;
    },
): RetrievalBudgetApplication {
    const fallbackPoolSizeBase = Math.max(limits.fallbackMemoryLimit, limits.relevantMemoryLimit);
    const selectionReasons = [`selection:recipe_${recipe.name}`, `selection:load_${cognitiveLoad.level}`];

    if (cognitiveLoad.level === 'high') {
        const relevantLimit = Math.max(2, Math.min(limits.relevantMemoryLimit, limits.searchLimit, 4));
        const supplementalLimit = Math.max(1, Math.min(limits.fallbackMemoryLimit, relevantLimit));
        const archivalLimit = Math.max(1, Math.min(limits.searchLimit, relevantLimit));
        selectionReasons.push('selection:focused_high_confidence', 'trim:high_load_narrowing');
        return {
            profile: {
                name: 'focused_recall',
                relevantLimit,
                archivalLimit,
                supplementalLimit,
                fallbackPoolMultiplier: 1,
                candidateExpansionFactor: 1,
                reviewLimit: Math.max(1, Math.min(limits.reviewLimit, 3)),
                followUpLimit: Math.max(1, Math.min(limits.followUpLimit, 2)),
            },
            relevantLimit,
            archivalLimit,
            supplementalLimit,
            fallbackPoolSize: fallbackPoolSizeBase,
            reviewLimit: Math.max(1, Math.min(limits.reviewLimit, 3)),
            followUpLimit: Math.max(1, Math.min(limits.followUpLimit, 2)),
            candidateExpansionLimit: Math.max(supplementalLimit, supplementalLimit * 1),
            selectionReasons,
        };
    }

    if (cognitiveLoad.level === 'low') {
        const relevantLimit = Math.max(limits.relevantMemoryLimit, Math.min(limits.searchLimit, limits.relevantMemoryLimit + 1));
        const supplementalLimit = Math.max(limits.fallbackMemoryLimit, relevantLimit);
        const archivalLimit = Math.max(1, Math.min(limits.searchLimit, relevantLimit + 1));
        const fallbackPoolMultiplier = recipe.expandFallbackPool ? 2 : 1;
        selectionReasons.push('selection:allow_supporting_context', 'selection:breadth_low_load');
        return {
            profile: {
                name: 'supportive_expansion',
                relevantLimit,
                archivalLimit,
                supplementalLimit,
                fallbackPoolMultiplier,
                candidateExpansionFactor: 2,
                reviewLimit: limits.reviewLimit,
                followUpLimit: limits.followUpLimit,
            },
            relevantLimit,
            archivalLimit,
            supplementalLimit,
            fallbackPoolSize: fallbackPoolSizeBase * fallbackPoolMultiplier,
            reviewLimit: limits.reviewLimit,
            followUpLimit: limits.followUpLimit,
            candidateExpansionLimit: Math.max(supplementalLimit, supplementalLimit * 2),
            selectionReasons,
        };
    }

    const relevantLimit = limits.relevantMemoryLimit;
    const supplementalLimit = limits.fallbackMemoryLimit;
    const archivalLimit = limits.searchLimit;
    const fallbackPoolMultiplier = recipe.expandFallbackPool ? 2 : 1;
    selectionReasons.push('selection:balanced_default');
    return {
        profile: {
            name: 'balanced_default',
            relevantLimit,
            archivalLimit,
            supplementalLimit,
            fallbackPoolMultiplier,
            candidateExpansionFactor: 2,
            reviewLimit: limits.reviewLimit,
            followUpLimit: limits.followUpLimit,
        },
        relevantLimit,
        archivalLimit,
        supplementalLimit,
        fallbackPoolSize: fallbackPoolSizeBase * fallbackPoolMultiplier,
        reviewLimit: limits.reviewLimit,
        followUpLimit: limits.followUpLimit,
        candidateExpansionLimit: Math.max(supplementalLimit, supplementalLimit * 2),
        selectionReasons,
    };
}

function selectRecipe(signals: RetrievalIntentSignals): PromptContextRecipe {
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

function resolveDualProcessRouting(
    query: string,
    signals: RetrievalIntentSignals,
    recipe: PromptContextRecipe,
    cognitiveLoad: CognitiveLoadAssessment,
    budgetApplication: RetrievalBudgetApplication,
): DualProcessRoutingSnapshot {
    const normalizedQuery = query.trim().toLowerCase();
    const routingReasons: string[] = [];
    const escalationTriggers: string[] = [];

    if (cognitiveLoad.level === 'low' && !signals.hasAnalyticalCue && !signals.hasExploratoryCue && signals.clauseCount <= 2) {
        routingReasons.push('fast_path_low_load');
    }
    if (!signals.hasAnalyticalCue && !signals.hasExploratoryCue && !signals.hasPreferenceCue && !signals.hasFollowUpCue && signals.queryLength <= 48) {
        routingReasons.push('focused_simple_query');
    }
    if (signals.hasQuestion && signals.queryLength <= 90 && signals.clauseCount <= 2 && cognitiveLoad.level === 'low') {
        routingReasons.push('direct_question_low_ambiguity');
    }

    if (cognitiveLoad.level === 'high') {
        escalationTriggers.push('high_cognitive_load');
    }
    if (signals.hasAnalyticalCue) {
        escalationTriggers.push('analytical_intent');
    }
    if (signals.clauseCount >= 3) {
        escalationTriggers.push('multi_clause_request');
    }
    if (signals.hasPreferenceCue && signals.hasFollowUpCue) {
        escalationTriggers.push('cross_signal_conflict');
    }
    if (signals.hasExploratoryCue) {
        escalationTriggers.push('exploratory_complexity');
    }
    if (signals.hasRecentContext && /\b(bu|bunu|böyle|aynı|onu|o konu|that|this|it)\b/.test(normalizedQuery) && signals.queryLength <= 96) {
        escalationTriggers.push('follow_up_ambiguity');
    }
    if (recipe.name === 'default' && signals.hasQuestion && signals.hasRecentContext && signals.queryLength >= 72) {
        escalationTriggers.push('contextual_uncertainty');
    }
    if (budgetApplication.profile.name === 'focused_recall') {
        escalationTriggers.push('confidence_preserving_budget');
    }

    const selectedMode: DualProcessMode = escalationTriggers.length > 0 ? 'system2' : 'system1';
    if (selectedMode === 'system2' && routingReasons.length === 0) {
        routingReasons.push('deliberate_route_escalated');
    }
    if (selectedMode === 'system1' && routingReasons.length === 0) {
        routingReasons.push('default_fast_path');
    }

    const secondPassApplied = selectedMode === 'system2';
    const adjustedBudgetProfile = selectedMode === 'system2'
        ? (budgetApplication.profile.name === 'supportive_expansion' ? 'balanced_default' : budgetApplication.profile.name)
        : budgetApplication.profile.name;
    const adjustedGraphDepth = selectedMode === 'system2'
        ? Math.min(3, recipe.graphDepth + (recipe.graphDepth < 2 ? 1 : 0))
        : recipe.graphDepth;
    const secondPassSummary = secondPassApplied
        ? adjustedBudgetProfile === budgetApplication.profile.name
            ? 'deliberate_rerank_existing_budget'
            : `deliberate_rerank_budget:${budgetApplication.profile.name}->${adjustedBudgetProfile}`
        : null;

    return {
        selectedMode,
        routingReasons,
        escalationTriggers,
        secondPassApplied,
        secondPassSummary,
        adjustedBudgetProfile,
        adjustedGraphDepth,
    };
}

function applyDualProcessAdjustments(
    dualProcess: DualProcessRoutingSnapshot,
    budgetApplication: RetrievalBudgetApplication,
): RetrievalBudgetApplication {
    if (!dualProcess.secondPassApplied || dualProcess.adjustedBudgetProfile === budgetApplication.profile.name) {
        return budgetApplication;
    }

    if (dualProcess.adjustedBudgetProfile === 'balanced_default') {
        const relevantLimit = Math.max(
            budgetApplication.relevantLimit,
            Math.min(budgetApplication.relevantLimit + 1, budgetApplication.archivalLimit, 5),
        );
        const archivalLimit = Math.max(budgetApplication.archivalLimit, relevantLimit + 1);
        const supplementalLimit = Math.max(1, budgetApplication.supplementalLimit);
        return {
            profile: {
                ...budgetApplication.profile,
                name: 'balanced_default',
                relevantLimit,
                archivalLimit,
                supplementalLimit,
            },
            relevantLimit,
            archivalLimit,
            supplementalLimit,
            fallbackPoolSize: budgetApplication.fallbackPoolSize,
            reviewLimit: budgetApplication.reviewLimit,
            followUpLimit: budgetApplication.followUpLimit,
            candidateExpansionLimit: Math.max(budgetApplication.candidateExpansionLimit, supplementalLimit * 2),
            selectionReasons: [...budgetApplication.selectionReasons, 'selection:dual_process_deliberate_pass'],
        };
    }

    return {
        ...budgetApplication,
        selectionReasons: [...budgetApplication.selectionReasons, 'selection:dual_process_deliberate_pass'],
    };
}

export class MemoryRetrievalOrchestrator {
    constructor(private readonly deps: RetrievalOrchestratorDeps) {}

    async getPromptContextBundle(request: PromptContextRequest): Promise<PromptContextBundle> {
        const {
            query,
            activeConversationId,
            options,
        } = request;
        const {
            searchLimit = 10,
            summaryLimit = 5,
            reviewLimit = 5,
            followUpDays = 14,
            followUpLimit = 3,
            relevantMemoryLimit = 5,
            fallbackMemoryLimit = 10,
            recentHours = 48,
            recentMessagesLimit = 20,
        } = options ?? {};

        const recentMessages = this.deps.getRecentMessages(recentHours, recentMessagesLimit, activeConversationId);
        const signals = detectIntentSignals(query, recentMessages);
        const recipe = selectRecipe(signals);

        const [searchResult, conversationSummaries, reviewMemories, followUpCandidates] = await Promise.all([
            this.deps.graphAwareSearch(query, searchLimit, recipe.graphDepth),
            Promise.resolve(this.deps.getRecentConversationSummaries(summaryLimit)),
            Promise.resolve(this.deps.getMemoriesDueForReview(reviewLimit * (recipe.preferReviewSignals ? 2 : 1))),
            Promise.resolve(this.deps.getFollowUpCandidates(followUpDays, followUpLimit)),
        ]);

        const typePreference = resolveTypePreference(signals, recipe);
        const cognitiveLoad = assessCognitiveLoad(signals, recipe);
        const primer = buildRetrievalPrimer(query, recentMessages, signals, recipe);
        const baseBudgetApplication = applyCognitiveLoadBudget(recipe, cognitiveLoad, {
            searchLimit,
            relevantMemoryLimit,
            fallbackMemoryLimit,
            reviewLimit,
            followUpLimit,
        });
        const dualProcess = resolveDualProcessRouting(query, signals, recipe, cognitiveLoad, baseBudgetApplication);
        const budgetApplication = applyDualProcessAdjustments(dualProcess, baseBudgetApplication);
        const relevantCandidateLimit = Math.max(budgetApplication.relevantLimit, searchLimit);
        const conversationPrioritized = this.deps.prioritizeConversationMemories(
            searchResult.active,
            recentMessages,
            activeConversationId,
            relevantCandidateLimit,
        );
        const relevantBase = recipe.preferConversationSignals ? conversationPrioritized : searchResult.active;
        const selectionContextBase = {
            query,
            activeConversationId,
            recentMessages,
            recipe,
            typePreference,
            cognitiveLoad,
            primer,
            dualProcess,
        };
        const spreadingActivation = buildSpreadingActivationState(this.deps, relevantBase, selectionContextBase);
        const selectionContext: BundleSelectionContext = {
            ...selectionContextBase,
            spreadingActivation,
        };
        const relevantMemories = rankMemoriesBySignals(relevantBase, budgetApplication.relevantLimit, selectionContext);
        const archivalMemories = rankMemoriesBySignals(searchResult.archival, budgetApplication.archivalLimit, selectionContext);

        const baseCandidatePool = this.deps.getUserMemories(budgetApplication.fallbackPoolSize);
        const candidatePool = recipe.preferArchivalForSupplemental
            ? [...archivalMemories, ...baseCandidatePool]
            : baseCandidatePool;
        const supplementalLimit = relevantMemories.length > 0
            ? budgetApplication.supplementalLimit
            : Math.max(1, budgetApplication.supplementalLimit);
        const supplementalCandidates = selectConversationAwareSupplementalMemories({
            query,
            activeConversationId,
            recentMessages,
            relevantMemories,
            fallbackMemories: candidatePool,
            limit: budgetApplication.candidateExpansionLimit,
        });
        const supplementalMemories = rankMemoriesBySignals(supplementalCandidates, supplementalLimit, selectionContext);

        const rankedReviewMemories = rankMemoriesBySignals(reviewMemories, budgetApplication.reviewLimit, selectionContext);
        const rankedFollowUpCandidates = rankMemoriesBySignals(followUpCandidates, budgetApplication.followUpLimit, selectionContext);

        const relevantSnapshot = createSelectionSnapshot(relevantBase, relevantMemories, activeConversationId);
        const archivalSnapshot = createSelectionSnapshot(searchResult.archival, archivalMemories, activeConversationId);
        const supplementalSnapshot = createSelectionSnapshot(supplementalCandidates, supplementalMemories, activeConversationId);
        const reviewSnapshot = createSelectionSnapshot(reviewMemories, rankedReviewMemories, activeConversationId);
        const followUpSnapshot = createSelectionSnapshot(followUpCandidates, rankedFollowUpCandidates, activeConversationId);
        const decisionReasons = buildReasonList(signals, recipe, typePreference, cognitiveLoad, budgetApplication, primer, dualProcess);

        this.deps.recordDebug({
            query,
            activeConversationId,
            recipe,
            signals,
            typePreference,
            cognitiveLoad,
            primer,
            dualProcess: {
                selectedMode: dualProcess.selectedMode,
                routingReasons: dualProcess.routingReasons,
                escalationTriggers: dualProcess.escalationTriggers,
                secondPassApplied: dualProcess.secondPassApplied,
                secondPassSummary: dualProcess.secondPassSummary,
                adjustedBudgetProfile: dualProcess.adjustedBudgetProfile,
                adjustedGraphDepth: dualProcess.adjustedGraphDepth,
            },
            spreadingActivation: spreadingActivation.snapshot,
            budget: {
                searchLimit,
                summaryLimit,
                reviewLimit,
                followUpDays,
                followUpLimit,
                relevantMemoryLimit,
                fallbackMemoryLimit,
                recentHours,
                recentMessagesLimit,
                profile: budgetApplication.profile.name,
                applied: {
                    relevantLimit: budgetApplication.relevantLimit,
                    archivalLimit: budgetApplication.archivalLimit,
                    supplementalLimit: budgetApplication.supplementalLimit,
                    fallbackPoolSize: budgetApplication.fallbackPoolSize,
                    reviewLimit: budgetApplication.reviewLimit,
                    followUpLimit: budgetApplication.followUpLimit,
                    candidateExpansionLimit: budgetApplication.candidateExpansionLimit,
                },
                trimming: {
                    relevantTrimmed: Math.max(0, relevantSnapshot.candidateCount - relevantSnapshot.selectedCount),
                    archivalTrimmed: Math.max(0, archivalSnapshot.candidateCount - archivalSnapshot.selectedCount),
                    supplementalTrimmed: Math.max(0, supplementalSnapshot.candidateCount - supplementalSnapshot.selectedCount),
                    reviewTrimmed: Math.max(0, reviewSnapshot.candidateCount - reviewSnapshot.selectedCount),
                    followUpTrimmed: Math.max(0, followUpSnapshot.candidateCount - followUpSnapshot.selectedCount),
                    reasons: budgetApplication.selectionReasons,
                },
                memoryTokenEstimate: {
                    relevant: estimateMemoryTokenCount(relevantMemories),
                    supplemental: estimateMemoryTokenCount(supplementalMemories),
                    archival: estimateMemoryTokenCount(archivalMemories),
                    totalSelected: estimateMemoryTokenCount([
                        ...relevantMemories,
                        ...supplementalMemories,
                        ...archivalMemories,
                    ]),
                },
            },
            counts: {
                relevant: relevantMemories.length,
                archival: archivalMemories.length,
                supplemental: supplementalMemories.length,
                review: rankedReviewMemories.length,
                followUp: rankedFollowUpCandidates.length,
                recentMessages: recentMessages.length,
            },
            candidates: {
                relevant: relevantSnapshot.candidateCount,
                archival: archivalSnapshot.candidateCount,
                supplemental: supplementalSnapshot.candidateCount,
                review: reviewSnapshot.candidateCount,
                followUp: followUpSnapshot.candidateCount,
            },
            selectedIds: {
                relevant: relevantSnapshot.selectedIds,
                archival: archivalSnapshot.selectedIds,
                supplemental: supplementalSnapshot.selectedIds,
                review: reviewSnapshot.selectedIds,
                followUp: followUpSnapshot.selectedIds,
            },
            breakdowns: {
                relevant: relevantSnapshot.breakdown,
                archival: archivalSnapshot.breakdown,
                supplemental: supplementalSnapshot.breakdown,
                review: reviewSnapshot.breakdown,
                followUp: followUpSnapshot.breakdown,
            },
            reasons: decisionReasons,
        });

        return {
            relevantMemories,
            archivalMemories,
            supplementalMemories,
            conversationSummaries,
            reviewMemories: rankedReviewMemories,
            followUpCandidates: rankedFollowUpCandidates,
            recentMessages,
        };
    }
}
