import type {
    CognitiveLoadAssessment,
    DualProcessMode,
    DualProcessRoutingSnapshot,
    PromptContextRecipe,
    RetrievalBudgetApplication,
    RetrievalIntentSignals,
} from './types.js';

interface CognitiveLoadBudgetLimits {
    searchLimit: number;
    relevantMemoryLimit: number;
    fallbackMemoryLimit: number;
    reviewLimit: number;
    followUpLimit: number;
}

export class BudgetApplier {
    applyCognitiveLoadBudget(
        recipe: PromptContextRecipe,
        cognitiveLoad: CognitiveLoadAssessment,
        baseOptions: CognitiveLoadBudgetLimits,
    ): RetrievalBudgetApplication {
        const limits = {
            searchLimit: baseOptions.searchLimit,
            relevantMemoryLimit: baseOptions.relevantMemoryLimit,
            fallbackMemoryLimit: baseOptions.fallbackMemoryLimit,
            reviewLimit: baseOptions.reviewLimit,
            followUpLimit: baseOptions.followUpLimit,
        };
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

    resolveDualProcessRouting(
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

    applyDualProcessAdjustments(
        routing: DualProcessRoutingSnapshot,
        budget: RetrievalBudgetApplication,
    ): RetrievalBudgetApplication {
        if (!routing.secondPassApplied || routing.adjustedBudgetProfile === budget.profile.name) {
            return budget;
        }

        if (routing.adjustedBudgetProfile === 'balanced_default') {
            const relevantLimit = Math.max(
                budget.relevantLimit,
                Math.min(budget.relevantLimit + 1, budget.archivalLimit, 5),
            );
            const archivalLimit = Math.max(budget.archivalLimit, relevantLimit + 1);
            const supplementalLimit = Math.max(1, budget.supplementalLimit);
            return {
                profile: {
                    ...budget.profile,
                    name: 'balanced_default',
                    relevantLimit,
                    archivalLimit,
                    supplementalLimit,
                },
                relevantLimit,
                archivalLimit,
                supplementalLimit,
                fallbackPoolSize: budget.fallbackPoolSize,
                reviewLimit: budget.reviewLimit,
                followUpLimit: budget.followUpLimit,
                candidateExpansionLimit: Math.max(budget.candidateExpansionLimit, supplementalLimit * 2),
                selectionReasons: [...budget.selectionReasons, 'selection:dual_process_deliberate_pass'],
            };
        }

        return {
            ...budget,
            selectionReasons: [...budget.selectionReasons, 'selection:dual_process_deliberate_pass'],
        };
    }
}
