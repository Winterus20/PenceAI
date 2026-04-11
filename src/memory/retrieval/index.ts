// Re-export types
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
    // Re-exported from parent manager
    PromptContextBundle,
} from './types.js';

// Re-export orchestrator class
export { MemoryRetrievalOrchestrator } from './Orchestrator.js';

// Re-export extracted modules
export { IntentAnalyzer } from './IntentAnalyzer.js';
export { RetrievalPrimer } from './RetrievalPrimer.js';
export { ScoringPipeline } from './ScoringPipeline.js';
export { SpreadingActivationEngine } from './SpreadingActivation.js';
export { CoverageRepair } from './CoverageRepair.js';
export { BudgetApplier } from './BudgetApplier.js';
export { BehaviorDiscovery } from './BehaviorDiscovery.js';
