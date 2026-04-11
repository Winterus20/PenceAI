import type {
    BehaviorDiscoveryCandidate,
    BehaviorDiscoveryTrace,
    GraphAwareSearchResult,
    MemoryRow,
    MemoryType,
} from '../types.js';
import type { PromptContextBundle } from '../manager/types.js';

// Re-export PromptContextBundle for backward compatibility
export type { PromptContextBundle } from '../manager/types.js';

export type MemoryRelationNeighbor = MemoryRow & {
    relation_type: string;
    relation_confidence?: number;
    relation_description: string;
};

export interface RetrievalPrimingBonusSummary {
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

export interface RetrievalPrimerSnapshot {
    triggered: boolean;
    reasons: string[];
    entityHints: string[];
    topicHints: string[];
    typeHints: MemoryType[];
    bonusSummary: RetrievalPrimingBonusSummary;
}

export interface RetrievalMemoryBreakdown {
    total: number;
    byCategory: Record<string, number>;
    bySource: Record<string, number>;
    byMemoryType: Record<MemoryType | 'unknown', number>;
    archivalCount: number;
    activeCount: number;
    conversationScopedCount: number;
}

export interface RetrievalTypePreference {
    preferredType: MemoryType | 'balanced';
    episodicWeight: number;
    semanticWeight: number;
    reason: string;
}

export interface RetrievalSelectionSnapshot {
    candidateCount: number;
    selectedCount: number;
    selectedIds: number[];
    breakdown: RetrievalMemoryBreakdown;
}

export interface RetrievalCoverageGap {
    type: 'semantic' | 'episodic' | 'conversation_scoped' | 'novel_category';
    reason: string;
}

export interface RetrievalSecondPassAdjustment {
    lane: 'relevant' | 'supplemental';
    applied: boolean;
    reason: string | null;
    removedId: number | null;
    addedId: number | null;
    preservedIds: number[];
}

export interface RetrievalSecondPassAuditSnapshot {
    applied: boolean;
    mode: DualProcessMode;
    coverageGaps: RetrievalCoverageGap[];
    guardrailSummary: string[];
    adjustments: RetrievalSecondPassAdjustment[];
}

export interface RetrievalMemoryExplanation {
    id: number;
    rank: number;
    lane: 'relevant' | 'archival' | 'supplemental' | 'review' | 'follow_up';
    category: string;
    memoryType: MemoryType | 'unknown';
    source: string;
    conversationScoped: boolean;
    finalScore: number;
    components: {
        signalScore: number;
        primingBonus: number;
        activationBonus: number;
        importanceBonus: number;
        accessBonus: number;
    };
    reasons: string[];
}

export interface RetrievalRankedEntry {
    memory: MemoryRow;
    signalScore: number;
    primingBonus: number;
    activationBonus: number;
    importanceBonus: number;
    accessBonus: number;
    finalScore: number;
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
    name: 'default' | 'conversation_followup' | 'preference_recall' | 'exploratory' | 'graph_rag_exploration' | 'graph_rag_deep';
    graphDepth: number;
    preferArchivalForSupplemental: boolean;
    expandFallbackPool: boolean;
    preferReviewSignals: boolean;
    preferConversationSignals: boolean;
    // GraphRAG-specific fields
    useGraphRAG?: boolean;
    maxHops?: number;
    usePageRank?: boolean;
    useCommunities?: boolean;
    tokenBudget?: number;
    timeoutMs?: number;
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
    getBehaviorDiscoveryConfig?: () => {
        retrieval?: {
            state?: 'disabled' | 'observe' | 'candidate' | 'shadow';
        };
    };
    prioritizeConversationMemories: (
        memories: MemoryRow[],
        recentMessages: Array<{ role: string; content: string; created_at: string; conversation_title: string }>,
        activeConversationId: string,
        limit: number,
    ) => MemoryRow[];
    recordDebug: (payload: unknown) => void;
    // GraphRAG engine (optional, backward compatible)
    graphRAGEngine?: import('../graphRAG/index.js').GraphRAGEngine | (() => import('../graphRAG/index.js').GraphRAGEngine | undefined);
    // BehaviorDiscoveryShadow (optional, for shadow comparison)
    behaviorDiscoveryShadow?: import('../graphRAG/index.js').BehaviorDiscoveryShadow;
}

export interface RetrievalIntentSignals {
    hasQuestion: boolean;
    hasPreferenceCue: boolean;
    hasFollowUpCue: boolean;
    hasRecallCue: boolean;
    hasConstraintCue: boolean;
    hasRecentContext: boolean;
    hasAnalyticalCue: boolean;
    hasExploratoryCue: boolean;
    queryLength: number;
    clauseCount: number;
}

export type CognitiveLoadLevel = 'low' | 'medium' | 'high';

export type BudgetProfileName = 'supportive_expansion' | 'balanced_default' | 'focused_recall';

export interface CognitiveLoadAssessment {
    level: CognitiveLoadLevel;
    score: number;
    reasons: string[];
}

export type DualProcessMode = 'system1' | 'system2';

export interface DualProcessRoutingSnapshot {
    selectedMode: DualProcessMode;
    routingReasons: string[];
    escalationTriggers: string[];
    secondPassApplied: boolean;
    secondPassSummary: string | null;
    adjustedBudgetProfile: BudgetProfileName;
    adjustedGraphDepth: number;
}

export interface RetrievalBudgetProfile {
    name: BudgetProfileName;
    relevantLimit: number;
    archivalLimit: number;
    supplementalLimit: number;
    fallbackPoolMultiplier: number;
    candidateExpansionFactor: number;
    reviewLimit: number;
    followUpLimit: number;
}

export interface RetrievalBudgetApplication {
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

export type RetrievalSpreadingActivationRolloutState = 'off' | 'shadow' | 'soft';

export interface RetrievalSpreadingActivationConfig {
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

export interface RetrievalSpreadingActivationReason {
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

export interface RetrievalActivatedCandidateSummary {
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

export interface RetrievalSpreadingActivationSkipSummary {
    reason: string;
    count: number;
    sampleIds: number[];
}

export interface RetrievalSpreadingActivationSnapshot {
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

export interface RetrievalSpreadingActivationState {
    config: RetrievalSpreadingActivationConfig;
    snapshot: RetrievalSpreadingActivationSnapshot;
    bonusByMemoryId: Map<number, number>;
}

export interface BundleSelectionContext {
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

export interface RetrievalBehaviorDiscoveryConfig {
    state: 'disabled' | 'observe' | 'candidate' | 'shadow';
}

export interface RetrievalBehaviorDiscoveryShadowPlan {
    candidate: BehaviorDiscoveryCandidate;
    shadowSelectionIds: number[];
}
