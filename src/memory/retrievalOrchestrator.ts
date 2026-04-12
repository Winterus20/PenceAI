import { computeReviewPriority, selectConversationAwareSupplementalMemories } from './contextUtils.js';
import type {
    BehaviorDiscoveryTrace,
    GraphAwareSearchResult,
    MemoryRow,
    MemoryType,
} from './types.js';
import type {
    BundleSelectionContext,
    CognitiveLoadAssessment,
    CognitiveLoadLevel,
    DualProcessMode,
    DualProcessRoutingSnapshot,
    PromptContextRecipe,
    PromptContextRequest,
    RetrievalActivatedCandidateSummary,
    RetrievalBehaviorDiscoveryConfig,
    RetrievalBehaviorDiscoveryShadowPlan,
    RetrievalBudgetApplication,
    RetrievalCoverageGap,
    RetrievalIntentSignals,
    RetrievalMemoryBreakdown,
    RetrievalMemoryExplanation,
    RetrievalOrchestratorDeps,
    RetrievalPrimerSnapshot,
    RetrievalPrimingBonusSummary,
    RetrievalRankedEntry,
    RetrievalSecondPassAdjustment,
    RetrievalSecondPassAuditSnapshot,
    RetrievalSelectionSnapshot,
    RetrievalSpreadingActivationConfig,
    RetrievalSpreadingActivationReason,
    RetrievalSpreadingActivationSkipSummary,
    RetrievalSpreadingActivationSnapshot,
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
// Eski Agentic RAG importları (kullanılmıyor ama backward compatibility için tutuluyor)
// import { RetrievalDecider, type RetrievalDecision, type RetrieverType } from './retrieval/RetrievalDecider.js';
// import { PassageCritique, type CritiqueResult } from './retrieval/PassageCritique.js';
// import { MultiHopRetrieval, type MultiHopResult } from './retrieval/MultiHopRetrieval.js';
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
import { GraphRAGEngine, type GraphRAGResult, BehaviorDiscoveryShadow } from './graphRAG/index.js';
import { logger } from '../utils/logger.js';

function estimateMemoryTokenCount(memories: MemoryRow[]): number {
    return memories.reduce((total, memory) => total + Math.ceil(memory.content.length / 4), 0);
}

export class MemoryRetrievalOrchestrator {
    private readonly intentAnalyzer: IntentAnalyzer;
    private readonly retrievalPrimer: RetrievalPrimer;
    private readonly scoringPipeline: ScoringPipeline;
    private readonly spreadingActivation: SpreadingActivationEngine;
    private readonly coverageRepair: CoverageRepair;
    private readonly budgetApplier: BudgetApplier;
    private readonly behaviorDiscovery: BehaviorDiscovery;

    // Confidence score için gerekli alanlar
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
    }

    /**
     * Confidence threshold'ı runtime'da yapılandır.
     */
    setConfidenceThreshold(threshold: number): void {
        this.confidenceThreshold = Math.max(0.3, Math.min(1.0, threshold));
        logger.info({ msg: '[ConfidenceScore] Threshold updated', threshold: this.confidenceThreshold });
    }

    private createSelectionSnapshot(
        candidates: MemoryRow[],
        selected: MemoryRow[],
        activeConversationId: string,
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
        // Confidence score debug
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
                recentMessages: 0, // Not tracked in debug payload directly
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
            // Confidence score debug
            confidenceScore: confidenceResult ? {
                score: confidenceResult.score,
                needsRetrieval: confidenceResult.needsRetrieval,
                reasons: confidenceResult.reasons,
            } : null,
        };
    }

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

        // Phase 1: Intent analysis
        const recentMessages = this.deps.getRecentMessages(recentHours, recentMessagesLimit, activeConversationId);
        const analysis = this.intentAnalyzer.analyze(query, recentMessages);
        const { signals, recipe, typePreference, cognitiveLoad } = analysis;

        // Phase 1.5: Confidence Score - Deterministik retrieval decision
        const recentMessagesForConfidence = recentMessages ?? [];
        const confidenceResult = computeRetrievalConfidence(signals, query, { 
            threshold: this.confidenceThreshold,
            recentMessagesCount: recentMessagesForConfidence.length,
        });
        const skipHeavyRetrieval = !confidenceResult.needsRetrieval;

        logger.info({
            msg: '[ConfidenceScore] Retrieval decision',
            score: confidenceResult.score,
            needsRetrieval: confidenceResult.needsRetrieval,
            reasons: confidenceResult.reasons,
        });

        // Phase 2: GraphRAG retrieval
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
                } else {
                    logger.warn({ msg: 'GraphRAG retrieval returned unsuccessful result', error: result.error });
                }
            } catch (err) {
                logger.warn({ msg: 'GraphRAG retrieval failed, falling back to standard', err });
            }
        }

        // Parallel fetch
        const effectiveSearchLimit = skipHeavyRetrieval ? Math.min(searchLimit, 3) : searchLimit;
        const [searchResult, conversationSummaries, reviewMemories, followUpCandidates] = await Promise.all([
            this.deps.graphAwareSearch(query, effectiveSearchLimit, skipHeavyRetrieval ? 0 : recipe.graphDepth),
            Promise.resolve(this.deps.getRecentConversationSummaries(summaryLimit)),
            Promise.resolve(this.deps.getMemoriesDueForReview(reviewLimit * (recipe.preferReviewSignals ? 2 : 1))),
            Promise.resolve(this.deps.getFollowUpCandidates(followUpDays, followUpLimit)),
        ]);

        // Phase 2.5: Agentic RAG Passage Critique + Multi-Hop Retrieval DEVRE DIŞI
        // Performance optimizasyonu nedeniyle kapatıldı - ilk arama sonuçları direkt kullanılır

        // Budget + dual-process routing
        const primer = this.retrievalPrimer.buildPrimer(query, recentMessages, signals, recipe);
        const baseBudgetApplication = this.budgetApplier.applyCognitiveLoadBudget(recipe, cognitiveLoad, {
            searchLimit,
            relevantMemoryLimit,
            fallbackMemoryLimit,
            reviewLimit,
            followUpLimit,
        });
        const dualProcess = this.budgetApplier.resolveDualProcessRouting(query, signals, recipe, cognitiveLoad, baseBudgetApplication);
        const budgetApplication = this.budgetApplier.applyDualProcessAdjustments(dualProcess, baseBudgetApplication);

        // Relevant memory selection — Agentic RAG devre dışı, direkt arama sonuçları kullanılır
        let agenticFilteredMemories: MemoryRow[] = searchResult.active;
        // Not: Passage critique ve multi-hop devre dışı, filtreleme yapılmıyor

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

        // Scoring + second pass (relevant)
        const relevantRankedEntries = this.scoringPipeline.buildRankedEntries(relevantBase, selectionContext);
        const relevantSecondPass = this.coverageRepair.applySecondPass('relevant', relevantRankedEntries, budgetApplication.relevantLimit, selectionContext);
        const relevantMemories = relevantSecondPass.selected;

        // Behavior discovery shadow plan
        const behaviorDiscoveryConfig = this.behaviorDiscovery.resolveConfig();
        const behaviorDiscoveryShadowPlan = this.behaviorDiscovery.buildShadowPlan(
            behaviorDiscoveryConfig,
            signals,
            relevantRankedEntries,
            selectionContext,
            budgetApplication.relevantLimit,
        );

        // Archival + supplemental selection
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

        // Review + follow-up ranking
        const reviewRankedEntries = this.scoringPipeline.buildRankedEntries(reviewMemories, selectionContext);
        const rankedReviewMemories = reviewRankedEntries
            .slice(0, budgetApplication.reviewLimit)
            .map(entry => entry.memory);
        const followUpRankedEntries = this.scoringPipeline.buildRankedEntries(followUpCandidates, selectionContext);
        const rankedFollowUpCandidates = followUpRankedEntries
            .slice(0, budgetApplication.followUpLimit)
            .map(entry => entry.memory);

        // Snapshots + audit
        const relevantSnapshot = this.createSelectionSnapshot(relevantBase, relevantMemories, activeConversationId);
        const archivalSnapshot = this.createSelectionSnapshot(searchResult.archival, archivalMemories, activeConversationId);
        const supplementalSnapshot = this.createSelectionSnapshot(supplementalCandidates, supplementalMemories, activeConversationId);
        const reviewSnapshot = this.createSelectionSnapshot(reviewMemories, rankedReviewMemories, activeConversationId);
        const followUpSnapshot = this.createSelectionSnapshot(followUpCandidates, rankedFollowUpCandidates, activeConversationId);
        const secondPassAudit: RetrievalSecondPassAuditSnapshot = {
            applied: relevantSecondPass.adjustment.applied || supplementalSecondPass.adjustment.applied,
            mode: dualProcess.selectedMode,
            coverageGaps: [...relevantSecondPass.coverageGaps, ...supplementalSecondPass.coverageGaps],
            guardrailSummary: Array.from(new Set([...relevantSecondPass.guardrailSummary, ...supplementalSecondPass.guardrailSummary])),
            adjustments: [relevantSecondPass.adjustment, supplementalSecondPass.adjustment],
        };

        // Explanations
        const explanations = {
            relevant: this.scoringPipeline.buildExplanations('relevant', relevantRankedEntries, relevantMemories, selectionContext),
            archival: this.scoringPipeline.buildExplanations('archival', archivalRankedEntries, archivalMemories, selectionContext),
            supplemental: this.scoringPipeline.buildExplanations('supplemental', supplementalRankedEntries, supplementalMemories, selectionContext),
            review: this.scoringPipeline.buildExplanations('review', reviewRankedEntries, rankedReviewMemories, selectionContext),
            followUp: this.scoringPipeline.buildExplanations('follow_up', followUpRankedEntries, rankedFollowUpCandidates, selectionContext),
        };

        // BehaviorDiscovery shadow comparison
        if (this.deps.behaviorDiscoveryShadow && graphRAGResult) {
            const startTime = Date.now();
            const baselineResults = relevantMemories.map(m => ({ id: m.id, score: 0 }));
            const experimentalResults = graphRAGResult.memories.map(m => ({ id: m.id, score: 0 }));

            await this.deps.behaviorDiscoveryShadow.runComparison(
                query,
                baselineResults,
                experimentalResults,
                recipe.useGraphRAG ? 'graph_rag' : 'spreading_activation',
            );

            const duration = Date.now() - startTime;
            const metrics = this.deps.behaviorDiscoveryShadow.getMetrics();
            if (metrics.comparisons.length > 0) {
                metrics.comparisons[metrics.comparisons.length - 1].duration = duration;
            }
        }

        // Behavior discovery trace + reason list
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

        // Confidence score decisions
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

        // Debug payload + record
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
            spreadingActivationState,
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
            // Confidence score debug
            confidenceResult,
        });
        this.deps.recordDebug(debugPayload);

        // Bundle assembly
        logger.info(`[Memory] 📚 Retrieval: ${relevantMemories.length} relevant, ${archivalMemories.length} archival, ${supplementalMemories.length} supplemental | ${conversationSummaries.length} summaries | ${rankedReviewMemories.length} review | ${rankedFollowUpCandidates.length} followup`);

        return {
            relevantMemories,
            archivalMemories,
            supplementalMemories,
            conversationSummaries,
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
}
