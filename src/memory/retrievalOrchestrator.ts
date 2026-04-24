import { selectConversationAwareSupplementalMemories } from './contextUtils.js';
import type {
    BehaviorDiscoveryTrace,
    GraphAwareSearchResult,
    MemoryRow,
} from './types.js';
import type { ConversationSummary } from './manager/types.js';
import type {
    BundleSelectionContext,
    CognitiveLoadAssessment,
    DualProcessRoutingSnapshot,
    PromptContextRecipe,
    PromptContextRequest,
    RetrievalBehaviorDiscoveryConfig,
    RetrievalBehaviorDiscoveryShadowPlan,
    RetrievalBudgetApplication,
    RetrievalIntentSignals,
    RetrievalMemoryExplanation,
    RetrievalOrchestratorDeps,
    RetrievalPrimerSnapshot,
    RetrievalSecondPassAuditSnapshot,
    RetrievalSelectionSnapshot,
    RetrievalSpreadingActivationState,
    RetrievalTypePreference,
} from './retrieval/types.js';
import type { PromptContextBundle } from './manager/types.js';
import { IntentAnalyzer } from './retrieval/IntentAnalyzer.js';
import { RetrievalPrimer } from './retrieval/RetrievalPrimer.js';
import { ScoringPipeline } from './retrieval/ScoringPipeline.js';
import { SpreadingActivationEngine } from './retrieval/SpreadingActivation.js';
import { CoverageRepair } from './retrieval/CoverageRepair.js';
import { BudgetApplier } from './retrieval/BudgetApplier.js';
import { BehaviorDiscovery } from './retrieval/BehaviorDiscovery.js';
import { computeRetrievalConfidence, type RetrievalConfidenceResult } from './retrieval/RetrievalConfidenceScorer.js';
import { getConfig } from '../gateway/config.js';
import { LLMProviderFactory, type LLMProvider } from '../llm/provider.js';
import { registerAllProviders } from '../llm/index.js';
import { PassageCritique } from './retrieval/PassageCritique.js';
import { MultiHopRetrieval } from './retrieval/MultiHopRetrieval.js';
export type { PromptContextBundle } from './manager/types.js';
export type {
    PromptContextRequest,
    PromptContextRecipe,
    RetrievalOrchestratorDeps,
    RetrievalIntentSignals,
    CognitiveLoadLevel,
    CognitiveLoadAssessment,
    BudgetProfileName,
    DualProcessMode,
    DualProcessRoutingSnapshot,
    RetrievalBudgetProfile,
    RetrievalBudgetApplication,
    RetrievalPrimingBonusSummary,
    RetrievalPrimerSnapshot,
    RetrievalRankedEntry,
    RetrievalMemoryExplanation,
    RetrievalSpreadingActivationRolloutState,
    RetrievalSpreadingActivationConfig,
    RetrievalSpreadingActivationReason,
    RetrievalActivatedCandidateSummary,
    RetrievalSpreadingActivationSkipSummary,
    RetrievalSpreadingActivationSnapshot,
    RetrievalSpreadingActivationState,
    BundleSelectionContext,
    RetrievalSelectionSnapshot,
    RetrievalMemoryBreakdown,
    RetrievalTypePreference,
    RetrievalCoverageGap,
    RetrievalSecondPassAdjustment,
    RetrievalSecondPassAuditSnapshot,
    RetrievalBehaviorDiscoveryConfig,
    RetrievalBehaviorDiscoveryShadowPlan,
    MemoryRelationNeighbor,
} from './retrieval/types.js';
import { type GraphRAGResult } from './graphRAG/index.js';
import { logger } from '../utils/logger.js';

function estimateMemoryTokenCount(memories: MemoryRow[]): number {
    return memories.reduce((total, memory) => total + Math.ceil(memory.content.length / 4), 0);
}

interface Phase1Result {
    recentMessages: Array<{ role: string; content: string; created_at: string; conversation_title: string }>;
    signals: RetrievalIntentSignals;
    recipe: PromptContextRecipe;
    typePreference: RetrievalTypePreference;
    cognitiveLoad: CognitiveLoadAssessment;
    confidenceResult: RetrievalConfidenceResult | null;
    skipHeavyRetrieval: boolean;
}

interface Phase2Result {
    graphRAGResult: GraphRAGResult | null;
    searchResult: GraphAwareSearchResult;
    conversationSummaries: ConversationSummary[];
    telescopicSummaries?: Array<{ id: number; summary: string; level: number; created_at: string; end_msg_id: number }>;
    reviewMemories: MemoryRow[];
    followUpCandidates: MemoryRow[];
    effectiveSearchLimit: number;
}

interface Phase3Result {
    relevantMemories: MemoryRow[];
    archivalMemories: MemoryRow[];
    supplementalMemories: MemoryRow[];
    rankedReviewMemories: MemoryRow[];
    rankedFollowUpCandidates: MemoryRow[];
    relevantBase: MemoryRow[];
    supplementalCandidates: MemoryRow[];
    relevantSecondPass: ReturnType<InstanceType<typeof CoverageRepair>['applySecondPass']>;
    supplementalSecondPass: ReturnType<InstanceType<typeof CoverageRepair>['applySecondPass']>;
    primer: RetrievalPrimerSnapshot;
    dualProcess: DualProcessRoutingSnapshot;
    budgetApplication: RetrievalBudgetApplication;
    behaviorDiscoveryConfig: RetrievalBehaviorDiscoveryConfig;
    behaviorDiscoveryShadowPlan: RetrievalBehaviorDiscoveryShadowPlan | null;
    selectionContext: BundleSelectionContext;
    relevantRankedEntries: ReturnType<InstanceType<typeof ScoringPipeline>['buildRankedEntries']>;
    archivalRankedEntries: ReturnType<InstanceType<typeof ScoringPipeline>['buildRankedEntries']>;
    supplementalRankedEntries: ReturnType<InstanceType<typeof ScoringPipeline>['buildRankedEntries']>;
    reviewRankedEntries: ReturnType<InstanceType<typeof ScoringPipeline>['buildRankedEntries']>;
    followUpRankedEntries: ReturnType<InstanceType<typeof ScoringPipeline>['buildRankedEntries']>;
}

export class MemoryRetrievalOrchestrator {
    private readonly intentAnalyzer: IntentAnalyzer;
    private readonly retrievalPrimer: RetrievalPrimer;
    private readonly scoringPipeline: ScoringPipeline;
    private readonly spreadingActivation: SpreadingActivationEngine;
    private readonly coverageRepair: CoverageRepair;
    private readonly budgetApplier: BudgetApplier;
    private readonly behaviorDiscovery: BehaviorDiscovery;

    // Agentic RAG
    private readonly llmProvider: LLMProvider;
    private readonly passageCritique: PassageCritique;
    private readonly multiHopRetrieval: MultiHopRetrieval;

    // Confidence score icin gerekli alanlar
    private confidenceThreshold: number = 0.6;

    constructor(private readonly deps: RetrievalOrchestratorDeps) {
        this.intentAnalyzer = new IntentAnalyzer(deps);
        this.retrievalPrimer = new RetrievalPrimer();
        this.spreadingActivation = new SpreadingActivationEngine();
        this.scoringPipeline = new ScoringPipeline({
            primer: this.retrievalPrimer,
            getActivationBonus: (memoryId: number) => 0,
            activeConversationId: '',
        });
        this.coverageRepair = new CoverageRepair();
        this.budgetApplier = new BudgetApplier();
        this.behaviorDiscovery = new BehaviorDiscovery(deps);
        this.confidenceThreshold = this.deps.agenticRAGDecisionConfidence ?? 0.6;

        const appConfig = getConfig();
        if (this.deps.agenticRAGLLMProvider) {
            this.llmProvider = this.deps.agenticRAGLLMProvider;
        } else {
            registerAllProviders();
            this.llmProvider = LLMProviderFactory.create(appConfig.defaultLLMProvider);
        }

        this.passageCritique = new PassageCritique(this.llmProvider, {
            completenessFloor: this.deps.agenticRAGCritiqueCompletenessFloor ?? appConfig.agenticRAGCritiqueCompletenessFloor ?? 0.3,
            relevanceFloor: this.deps.agenticRAGCritiqueRelevanceFloor ?? appConfig.agenticRAGCritiqueRelevanceFloor ?? 0.5,
        });
        this.multiHopRetrieval = new MultiHopRetrieval(this.llmProvider, this.passageCritique, {
            maxHops: this.deps.agenticRAGMaxHops ?? appConfig.agenticRAGMaxHops ?? 2,
        });
    }

    /**
     * Confidence threshold'i runtime'da yapilandir.
     */
    setConfidenceThreshold(threshold: number): void {
        this.confidenceThreshold = Math.max(0.3, Math.min(1.0, threshold));
        logger.info({ msg: '[ConfidenceScore] Threshold updated', threshold: this.confidenceThreshold });
    }

    private createSelectionSnapshot(
        candidates: MemoryRow[],
        selected: MemoryRow[],
        _activeConversationId: string,
    ): RetrievalSelectionSnapshot {
        return {
            candidateCount: candidates.length,
            selectedCount: selected.length,
            selectedIds: selected.map(memory => memory.id),
            breakdown: this.scoringPipeline.summarizeBreakdown(selected),
        };
    }

    private buildDebugPayload(params: {
        query: string;
        activeConversationId: string;
        recipe: PromptContextRecipe;
        signals: RetrievalIntentSignals;
        typePreference: RetrievalTypePreference;
        cognitiveLoad: CognitiveLoadAssessment;
        primer: RetrievalPrimerSnapshot;
        dualProcess: DualProcessRoutingSnapshot;
        secondPassAudit: RetrievalSecondPassAuditSnapshot;
        explanations: Record<string, RetrievalMemoryExplanation[]>;
        spreadingActivationState: RetrievalSpreadingActivationState;
        behaviorDiscovery: BehaviorDiscoveryTrace;
        budgetApplication: RetrievalBudgetApplication;
        budgetOptions: {
            searchLimit: number;
            summaryLimit: number;
            reviewLimit: number;
            followUpDays: number;
            followUpLimit: number;
            relevantMemoryLimit: number;
            fallbackMemoryLimit: number;
            recentHours: number;
            recentMessagesLimit: number;
        };
        relevantSnapshot: RetrievalSelectionSnapshot;
        archivalSnapshot: RetrievalSelectionSnapshot;
        supplementalSnapshot: RetrievalSelectionSnapshot;
        reviewSnapshot: RetrievalSelectionSnapshot;
        followUpSnapshot: RetrievalSelectionSnapshot;
        searchResultActive: MemoryRow[];
        searchResultArchival: MemoryRow[];
        supplementalCandidates: MemoryRow[];
        reviewMemories: MemoryRow[];
        followUpCandidates: MemoryRow[];
        relevantMemories: MemoryRow[];
        supplementalMemories: MemoryRow[];
        archivalMemories: MemoryRow[];
        decisionReasons: string[];
        confidenceResult?: RetrievalConfidenceResult | null;
    }) {
        const {
            query, activeConversationId, recipe, signals, typePreference, cognitiveLoad,
            primer, dualProcess, secondPassAudit, explanations, spreadingActivationState,
            behaviorDiscovery, budgetApplication, budgetOptions,
            relevantSnapshot, archivalSnapshot, supplementalSnapshot, reviewSnapshot, followUpSnapshot,
            searchResultActive, searchResultArchival, supplementalCandidates,
            reviewMemories, followUpCandidates,
            relevantMemories, supplementalMemories, archivalMemories,
            decisionReasons,
            confidenceResult,
        } = params;

        return {
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
            secondPass: secondPassAudit,
            explanations,
            spreadingActivation: spreadingActivationState.snapshot,
            behaviorDiscovery,
            budget: {
                searchLimit: budgetOptions.searchLimit,
                summaryLimit: budgetOptions.summaryLimit,
                reviewLimit: budgetOptions.reviewLimit,
                followUpDays: budgetOptions.followUpDays,
                followUpLimit: budgetOptions.followUpLimit,
                relevantMemoryLimit: budgetOptions.relevantMemoryLimit,
                fallbackMemoryLimit: budgetOptions.fallbackMemoryLimit,
                recentHours: budgetOptions.recentHours,
                recentMessagesLimit: budgetOptions.recentMessagesLimit,
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
                guardrails: {
                    searchLimitReached: searchResultActive.length > budgetApplication.relevantLimit,
                    archivalLimitReached: searchResultArchival.length > budgetApplication.archivalLimit,
                    supplementalExpansionUsed: supplementalCandidates.length > 0,
                    candidateExpansionPressure: supplementalCandidates.length > budgetApplication.supplementalLimit,
                    reviewLimitReached: reviewMemories.length > budgetApplication.reviewLimit,
                    followUpLimitReached: followUpCandidates.length > budgetApplication.followUpLimit,
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
            retrievalControl: {
                rolloutState: spreadingActivationState.snapshot.rolloutState,
                graphDepth: recipe.graphDepth,
                dualProcessMode: dualProcess.selectedMode,
                primerTriggered: primer.triggered,
                behaviorDiscoveryState: behaviorDiscovery.state,
                behaviorDiscoveryLiveEffect: behaviorDiscovery.liveEffectAllowed,
                candidatePressure: {
                    relevant: Math.max(0, relevantSnapshot.candidateCount - relevantSnapshot.selectedCount),
                    supplemental: Math.max(0, supplementalSnapshot.candidateCount - supplementalSnapshot.selectedCount),
                    archival: Math.max(0, archivalSnapshot.candidateCount - archivalSnapshot.selectedCount),
                },
            },
            counts: {
                relevant: relevantMemories.length,
                archival: archivalMemories.length,
                supplemental: supplementalMemories.length,
                review: reviewMemories.length,
                followUp: followUpCandidates.length,
                recentMessages: 0,
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
            confidenceScore: confidenceResult ? {
                score: confidenceResult.score,
                needsRetrieval: confidenceResult.needsRetrieval,
                reasons: confidenceResult.reasons,
            } : null,
        };
    }

    private async phase1IntentAnalysis(request: PromptContextRequest): Promise<Phase1Result> {
        const { query, activeConversationId, options } = request;
        const recentHours = options?.recentHours ?? 48;
        const recentMessagesLimit = options?.recentMessagesLimit ?? 20;

        const recentMessages = this.deps.getRecentMessages(recentHours, recentMessagesLimit, activeConversationId);
        const analysis = this.intentAnalyzer.analyze(query, recentMessages);
        const { signals, recipe, typePreference, cognitiveLoad } = analysis;

        const confidenceResult = computeRetrievalConfidence(signals, query, {
            threshold: this.confidenceThreshold,
            recentMessagesCount: recentMessages?.length ?? 0,
        });
        const skipHeavyRetrieval = !confidenceResult.needsRetrieval;

        logger.info({
            msg: '[ConfidenceScore] Retrieval decision',
            score: confidenceResult.score,
            needsRetrieval: confidenceResult.needsRetrieval,
            reasons: confidenceResult.reasons,
        });

        return { recentMessages, signals, recipe, typePreference, cognitiveLoad, confidenceResult, skipHeavyRetrieval };
    }

    private async phase2Retrieval(request: PromptContextRequest, phase1: Phase1Result): Promise<Phase2Result> {
        const { query, options } = request;
        const { signals, recipe } = phase1;
        let { skipHeavyRetrieval } = phase1;
        const searchLimit = options?.searchLimit ?? 10;
        const summaryLimit = options?.summaryLimit ?? 5;
        const reviewLimit = options?.reviewLimit ?? 5;
        const followUpDays = options?.followUpDays ?? 14;
        const followUpLimit = options?.followUpLimit ?? 3;

        // Adaptive routing: küçük bellek setlerinde masraflı path'leri atla
        const appConfig = getConfig();
        if (!skipHeavyRetrieval && appConfig.wikiAdaptiveThreshold > 0) {
            const sampleMemories = await Promise.resolve(this.deps.getUserMemories(100));
            if (sampleMemories.length < appConfig.wikiAdaptiveThreshold) {
                skipHeavyRetrieval = true;
                logger.info(`[AdaptiveRetrieval] Memory set size ${sampleMemories.length} < threshold ${appConfig.wikiAdaptiveThreshold} — forcing keyword-only strategy`);
            }
        }

        let graphRAGResult: GraphRAGResult | null = null;
        const resolvedEngine = typeof this.deps.graphRAGEngine === 'function'
            ? this.deps.graphRAGEngine()
            : this.deps.graphRAGEngine;
        if (resolvedEngine && recipe.useGraphRAG && !skipHeavyRetrieval) {
            try {
                const result = await resolvedEngine.retrieve(query, {
                    maxHops: recipe.maxHops ?? 2,
                    usePageRank: recipe.usePageRank ?? true,
                    useCommunities: recipe.useCommunities ?? true,
                    tokenBudget: recipe.tokenBudget ?? 32000,
                    timeoutMs: recipe.timeoutMs ?? 5000,
                });
                if (result.success) {
                    graphRAGResult = result;
                    // Shadow mode bitti: GraphRAG sonuçlarını ana sonuçlara (active) enjekte et
                    logger.info(`[GraphRAG] Full Mode: Injecting ${result.memories.length} graph-aware memories into active set`);
                } else {
                    logger.warn({ msg: 'GraphRAG retrieval returned unsuccessful result', error: result.error });
                }
            } catch (err) {
                logger.warn({ msg: 'GraphRAG retrieval failed, falling back to standard', err });
            }
        }

        const effectiveSearchLimit = skipHeavyRetrieval ? Math.min(searchLimit, 3) : searchLimit;
        const [searchResult, conversationSummaries, telescopicSummaries, reviewMemories, followUpCandidates] = await Promise.all([
            this.deps.graphAwareSearch(query, effectiveSearchLimit, skipHeavyRetrieval ? 0 : recipe.graphDepth),
            Promise.resolve(this.deps.getRecentConversationSummaries(summaryLimit)),
            Promise.resolve(this.deps.getTelescopicSummaries ? this.deps.getTelescopicSummaries(request.activeConversationId, 10) : []),
            Promise.resolve(this.deps.getMemoriesDueForReview(reviewLimit * (recipe.preferReviewSignals ? 2 : 1))),
            Promise.resolve(this.deps.getFollowUpCandidates(followUpDays, followUpLimit)),
        ]);

        // GraphRAG sonuçlarını active kümesine ekle ve mükerrerleri temizle
        if (graphRAGResult && graphRAGResult.memories.length > 0) {
            const existingIds = new Set(searchResult.active.map(m => m.id));
            const uniqueGraphMemories = graphRAGResult.memories.filter(m => !existingIds.has(m.id));
            searchResult.active = [...uniqueGraphMemories, ...searchResult.active];
        }

        if (getConfig().agenticRAGEnabled && !skipHeavyRetrieval && searchResult.active.length > 0) {
            logger.info({ msg: '[Agentic RAG] Evaluating initial passages' });
            // Step 1: Initial Critique
            const critique = await this.passageCritique.evaluate(query, searchResult.active);

            // Step 2: Keep only relevant passages
            let agenticActive = searchResult.active.filter((_, i) => critique.evaluations[i]?.keep);

            // Step 3: Multi-Hop execution if missing info exists
            if (critique.needsMoreRetrieval) {
                logger.info({ msg: '[Agentic RAG] Missing info detected. Triggering multi-hop loop' });
                const extraMemoriesResult = await this.multiHopRetrieval.execute(
                    query,
                    agenticActive,
                    critique,
                    async (refinedQuery, _hop, _target) => {
                        // Multi-hop retrieveFn: GraphRAG intentionally bypassed to prevent
                        // recursive graph traversal. Standard hybrid search used instead.
                        const res = await this.deps.graphAwareSearch(refinedQuery, effectiveSearchLimit, 0);
                        return res.active;
                    }
                );
                
                // Append multi-hop results
                agenticActive = [...agenticActive, ...extraMemoriesResult.memories];
            }

            // Fallback: If evaluation filtered everything but there was no extra memories returned, fallback to initial search
            if (agenticActive.length === 0) {
                logger.warn({ msg: '[Agentic RAG] All passages filtered and no extra info found. Falling back to active search' });
                agenticActive = searchResult.active;
            }

            searchResult.active = agenticActive;
        }

        return { graphRAGResult, searchResult, conversationSummaries, telescopicSummaries, reviewMemories, followUpCandidates, effectiveSearchLimit };
    }

    private phase3Selection(request: PromptContextRequest, phase1: Phase1Result, phase2: Phase2Result): Phase3Result {
        const { query, activeConversationId, options } = request;
        const { recentMessages, signals, recipe, typePreference, cognitiveLoad } = phase1;
        const { searchResult, reviewMemories, followUpCandidates } = phase2;
        const {
            searchLimit = 10,
            relevantMemoryLimit = 5,
            fallbackMemoryLimit = 10,
        } = options ?? {};

        const primer = this.retrievalPrimer.buildPrimer(query, recentMessages, signals, recipe);
        const baseBudgetApplication = this.budgetApplier.applyCognitiveLoadBudget(recipe, cognitiveLoad, {
            searchLimit,
            relevantMemoryLimit,
            fallbackMemoryLimit,
            reviewLimit: options?.reviewLimit ?? 5,
            followUpLimit: options?.followUpLimit ?? 3,
        });
        const dualProcess = this.budgetApplier.resolveDualProcessRouting(query, signals, recipe, cognitiveLoad, baseBudgetApplication);
        const budgetApplication = this.budgetApplier.applyDualProcessAdjustments(dualProcess, baseBudgetApplication);

        const agenticFilteredMemories: MemoryRow[] = searchResult.active;

        const relevantCandidateLimit = Math.max(budgetApplication.relevantLimit, searchLimit);
        const conversationPrioritized = this.deps.prioritizeConversationMemories(
            agenticFilteredMemories,
            recentMessages,
            activeConversationId,
            relevantCandidateLimit,
        );
        const relevantBase = recipe.preferConversationSignals ? conversationPrioritized : agenticFilteredMemories;
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
        const spreadingActivationState = this.spreadingActivation.buildState(this.deps, relevantBase, selectionContextBase, this.retrievalPrimer);
        const selectionContext: BundleSelectionContext = {
            ...selectionContextBase,
            spreadingActivation: spreadingActivationState,
        };

        const relevantRankedEntries = this.scoringPipeline.buildRankedEntries(relevantBase, selectionContext);
        const relevantSecondPass = this.coverageRepair.applySecondPass('relevant', relevantRankedEntries, budgetApplication.relevantLimit, selectionContext);
        const relevantMemories = relevantSecondPass.selected;

        const behaviorDiscoveryConfig = this.behaviorDiscovery.resolveConfig();
        const behaviorDiscoveryShadowPlan = this.behaviorDiscovery.buildShadowPlan(
            behaviorDiscoveryConfig,
            signals,
            relevantRankedEntries,
            selectionContext,
            budgetApplication.relevantLimit,
        );

        const archivalRankedEntries = this.scoringPipeline.buildRankedEntries(searchResult.archival, selectionContext);
        const archivalMemories = archivalRankedEntries
            .slice(0, budgetApplication.archivalLimit)
            .map(entry => entry.memory);

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
        const supplementalRankedEntries = this.scoringPipeline.buildRankedEntries(supplementalCandidates, selectionContext);
        const supplementalSecondPass = this.coverageRepair.applySecondPass('supplemental', supplementalRankedEntries, supplementalLimit, selectionContext);
        const supplementalMemories = supplementalSecondPass.selected;

        const reviewRankedEntries = this.scoringPipeline.buildRankedEntries(reviewMemories, selectionContext);
        const rankedReviewMemories = reviewRankedEntries
            .slice(0, budgetApplication.reviewLimit)
            .map(entry => entry.memory);
        const followUpRankedEntries = this.scoringPipeline.buildRankedEntries(followUpCandidates, selectionContext);
        const rankedFollowUpCandidates = followUpRankedEntries
            .slice(0, budgetApplication.followUpLimit)
            .map(entry => entry.memory);

        return {
            relevantMemories, archivalMemories, supplementalMemories,
            rankedReviewMemories, rankedFollowUpCandidates,
            relevantBase, supplementalCandidates,
            relevantSecondPass, supplementalSecondPass,
            relevantRankedEntries, archivalRankedEntries, supplementalRankedEntries,
            reviewRankedEntries, followUpRankedEntries,
            primer, dualProcess, budgetApplication,
            behaviorDiscoveryConfig, behaviorDiscoveryShadowPlan,
            selectionContext,
        };
    }

    private phase4Assembly(
        request: PromptContextRequest,
        phase1: Phase1Result,
        phase2: Phase2Result,
        phase3: Phase3Result,
    ): PromptContextBundle {
        const { query, activeConversationId, options } = request;
        const { recentMessages, signals, recipe, typePreference, cognitiveLoad, confidenceResult } = phase1;
        const { graphRAGResult, searchResult, conversationSummaries, telescopicSummaries } = phase2;
        const {
            relevantMemories, archivalMemories, supplementalMemories,
            rankedReviewMemories, rankedFollowUpCandidates,
            relevantBase, supplementalCandidates,
            relevantSecondPass, supplementalSecondPass,
            relevantRankedEntries, archivalRankedEntries, supplementalRankedEntries,
            reviewRankedEntries, followUpRankedEntries,
            primer, dualProcess, budgetApplication,
            behaviorDiscoveryConfig, behaviorDiscoveryShadowPlan,
            selectionContext,
        } = phase3;
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

        const relevantSnapshot = this.createSelectionSnapshot(relevantBase, relevantMemories, activeConversationId);
        const archivalSnapshot = this.createSelectionSnapshot(searchResult.archival, archivalMemories, activeConversationId);
        const supplementalSnapshot = this.createSelectionSnapshot(supplementalCandidates, supplementalMemories, activeConversationId);
        const reviewSnapshot = this.createSelectionSnapshot(phase2.reviewMemories, rankedReviewMemories, activeConversationId);
        const followUpSnapshot = this.createSelectionSnapshot(phase2.followUpCandidates, rankedFollowUpCandidates, activeConversationId);

        const secondPassAudit: RetrievalSecondPassAuditSnapshot = {
            applied: relevantSecondPass.adjustment.applied || supplementalSecondPass.adjustment.applied,
            mode: dualProcess.selectedMode,
            coverageGaps: [...relevantSecondPass.coverageGaps, ...supplementalSecondPass.coverageGaps],
            guardrailSummary: Array.from(new Set([...relevantSecondPass.guardrailSummary, ...supplementalSecondPass.guardrailSummary])),
            adjustments: [relevantSecondPass.adjustment, supplementalSecondPass.adjustment],
        };

        const explanations = {
            relevant: this.scoringPipeline.buildExplanations('relevant', relevantRankedEntries, relevantMemories, selectionContext),
            archival: this.scoringPipeline.buildExplanations('archival', archivalRankedEntries, archivalMemories, selectionContext),
            supplemental: this.scoringPipeline.buildExplanations('supplemental', supplementalRankedEntries, supplementalMemories, selectionContext),
            review: this.scoringPipeline.buildExplanations('review', reviewRankedEntries, rankedReviewMemories, selectionContext),
            followUp: this.scoringPipeline.buildExplanations('follow_up', followUpRankedEntries, rankedFollowUpCandidates, selectionContext),
        };

        const behaviorDiscoveryTrace = this.behaviorDiscovery.buildTrace(
            behaviorDiscoveryConfig,
            signals,
            dualProcess,
            relevantSnapshot.selectedIds,
            behaviorDiscoveryShadowPlan,
        );
        const decisionReasons = this.behaviorDiscovery.buildReasonList(signals, recipe, typePreference, cognitiveLoad, budgetApplication, primer, dualProcess);
        decisionReasons.push(...secondPassAudit.guardrailSummary);
        decisionReasons.push(...secondPassAudit.coverageGaps.map(gap => `coverage_gap:${gap.reason}`));
        decisionReasons.push(...secondPassAudit.adjustments.filter(adjustment => adjustment.applied && adjustment.reason).map(adjustment => `second_pass_adjustment:${adjustment.lane}:${adjustment.reason}`));

        if (confidenceResult) {
            if (confidenceResult.needsRetrieval) {
                decisionReasons.push(`confidence_score:retrieve (score=${confidenceResult.score.toFixed(2)}, reasons=${confidenceResult.reasons.join(',')})`);
            } else {
                decisionReasons.push(`confidence_score:no_retrieve (score=${confidenceResult.score.toFixed(2)})`);
            }
        }

        decisionReasons.push(`behavior_discovery:${behaviorDiscoveryTrace.state}`);
        if (behaviorDiscoveryTrace.shadowComparison) {
            decisionReasons.push(`behavior_discovery_shadow:${behaviorDiscoveryTrace.shadowComparison.summary}`);
            decisionReasons.push(`behavior_discovery_readiness:${behaviorDiscoveryTrace.shadowComparison.readiness}`);
        }

        const debugPayload = this.buildDebugPayload({
            query,
            activeConversationId,
            recipe,
            signals,
            typePreference,
            cognitiveLoad,
            primer,
            dualProcess,
            secondPassAudit,
            explanations,
            spreadingActivationState: phase3.selectionContext.spreadingActivation,
            behaviorDiscovery: behaviorDiscoveryTrace,
            budgetApplication,
            budgetOptions: {
                searchLimit,
                summaryLimit,
                reviewLimit,
                followUpDays,
                followUpLimit,
                relevantMemoryLimit,
                fallbackMemoryLimit,
                recentHours,
                recentMessagesLimit,
            },
            relevantSnapshot,
            archivalSnapshot,
            supplementalSnapshot,
            reviewSnapshot,
            followUpSnapshot,
            searchResultActive: searchResult.active,
            searchResultArchival: searchResult.archival,
            supplementalCandidates,
            reviewMemories: rankedReviewMemories,
            followUpCandidates: rankedFollowUpCandidates,
            relevantMemories,
            supplementalMemories,
            archivalMemories,
            decisionReasons,
            confidenceResult,
        });
        this.deps.recordDebug(debugPayload);

        logger.info(`[Memory] Retrieval: ${relevantMemories.length} relevant, ${archivalMemories.length} archival, ${supplementalMemories.length} supplemental | ${conversationSummaries.length} summaries | ${rankedReviewMemories.length} review | ${rankedFollowUpCandidates.length} followup`);

        return {
            relevantMemories,
            archivalMemories,
            supplementalMemories,
            conversationSummaries,
            telescopicSummaries,
            reviewMemories: rankedReviewMemories,
            followUpCandidates: rankedFollowUpCandidates,
            recentMessages,
            graphRAG: graphRAGResult ? {
                memories: graphRAGResult.memories,
                communitySummaries: graphRAGResult.communitySummaries.map(cs => ({
                    communityId: cs.communityId,
                    summary: cs.summary,
                })),
                graphContext: graphRAGResult.graphContext as unknown as Record<string, unknown>,
            } : null,
        };
    }

    async getPromptContextBundle(request: PromptContextRequest): Promise<PromptContextBundle> {
        const phase1 = await this.phase1IntentAnalysis(request);
        const phase2 = await this.phase2Retrieval(request, phase1);
        const phase3 = this.phase3Selection(request, phase1, phase2);
        return this.phase4Assembly(request, phase1, phase2, phase3);
    }
}
