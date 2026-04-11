import type {
    BundleSelectionContext,
    CognitiveLoadAssessment,
    DualProcessRoutingSnapshot,
    PromptContextRecipe,
    RetrievalBehaviorDiscoveryConfig,
    RetrievalBehaviorDiscoveryShadowPlan,
    RetrievalBudgetApplication,
    RetrievalIntentSignals,
    RetrievalOrchestratorDeps,
    RetrievalPrimerSnapshot,
    RetrievalRankedEntry,
    RetrievalTypePreference,
} from './types.js';
import type { BehaviorDiscoveryCandidate, BehaviorDiscoveryTrace } from '../types.js';

export class BehaviorDiscovery {
    constructor(private readonly deps: RetrievalOrchestratorDeps) {}

    resolveConfig(): RetrievalBehaviorDiscoveryConfig {
        return {
            state: this.deps.getBehaviorDiscoveryConfig?.().retrieval?.state ?? 'shadow',
        };
    }

    collectObservedSignals(signals: RetrievalIntentSignals, dualProcess: DualProcessRoutingSnapshot): string[] {
        const observedSignals: string[] = [];
        if (signals.hasPreferenceCue) observedSignals.push('signal:preference_cue');
        if (signals.hasFollowUpCue) observedSignals.push('signal:follow_up_cue');
        if (signals.hasRecallCue) observedSignals.push('signal:recall_cue');
        if (signals.hasRecentContext) observedSignals.push('signal:recent_context');
        if (dualProcess.escalationTriggers.includes('cross_signal_conflict')) observedSignals.push('trigger:cross_signal_conflict');
        if (dualProcess.escalationTriggers.includes('follow_up_ambiguity')) observedSignals.push('trigger:follow_up_ambiguity');
        return observedSignals;
    }

    buildShadowPlan(
        config: RetrievalBehaviorDiscoveryConfig,
        signals: RetrievalIntentSignals,
        rankedEntries: RetrievalRankedEntry[],
        context: BundleSelectionContext,
        limit: number,
    ): RetrievalBehaviorDiscoveryShadowPlan | null {
        if (config.state === 'disabled' || config.state === 'observe' || rankedEntries.length === 0) {
            return null;
        }

        const observedSignals = this.collectObservedSignals(signals, context.dualProcess);
        const shouldProbeMixedIntent = signals.hasPreferenceCue && signals.hasFollowUpCue;
        const shouldProbeConversationSupport = signals.hasFollowUpCue
            && rankedEntries.some(entry => entry.memory.provenance_conversation_id === context.activeConversationId)
            && rankedEntries.some(entry => entry.memory.provenance_conversation_id !== context.activeConversationId);

        if (!shouldProbeMixedIntent && !shouldProbeConversationSupport) {
            return null;
        }

        const candidate: BehaviorDiscoveryCandidate = {
            id: shouldProbeMixedIntent
                ? 'retrieval_mixed_intent_shadow_v1'
                : 'retrieval_followup_conversation_shadow_v1',
            domain: 'retrieval',
            feature: shouldProbeMixedIntent ? 'mixed_intent_shadow_probe' : 'conversation_followup_shadow_probe',
            state: config.state === 'candidate' ? 'candidate' : 'shadow',
            summary: shouldProbeMixedIntent
                ? 'Preference + follow-up sinyallerinde gölge karşılaştırma için çift taraflı coverage bias uygula.'
                : 'Follow-up sorgularında conversation-scoped episodic desteği gölgede karşılaştır.',
            trigger: shouldProbeMixedIntent ? 'cross_signal_conflict' : 'follow_up_conversation_support_gap',
            observedSignals,
            riskProfile: 'low',
        };

        const shadowRankedEntries = [...rankedEntries]
            .map(entry => {
                let shadowBonus = 0;
                if (shouldProbeMixedIntent) {
                    if (entry.memory.memory_type === 'semantic' && /preference|profile|user_fact/i.test(entry.memory.category || '')) {
                        shadowBonus += 0.08;
                    }
                    if (entry.memory.memory_type === 'episodic' && entry.memory.provenance_conversation_id === context.activeConversationId) {
                        shadowBonus += 0.08;
                    }
                } else if (entry.memory.provenance_conversation_id === context.activeConversationId && entry.memory.memory_type === 'episodic') {
                    shadowBonus += 0.1;
                }

                return {
                    id: entry.memory.id,
                    score: Number((entry.finalScore + shadowBonus).toFixed(3)),
                    updatedAt: entry.memory.updated_at,
                };
            })
            .sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, limit)
            .map(entry => entry.id);

        return {
            candidate,
            shadowSelectionIds: shadowRankedEntries,
        };
    }

    buildTrace(
        config: RetrievalBehaviorDiscoveryConfig,
        signals: RetrievalIntentSignals,
        routing: DualProcessRoutingSnapshot,
        selectedIds: number[],
        shadowPlan: RetrievalBehaviorDiscoveryShadowPlan | null,
    ): BehaviorDiscoveryTrace {
        const observedSignals = this.collectObservedSignals(signals, routing);
        const guardrails = [
            'behavior_discovery:shadow_safe_only',
            'behavior_discovery:no_live_effect',
            'behavior_discovery:active_policy_unchanged',
        ];

        if (config.state === 'disabled') {
            return {
                enabled: false,
                domain: 'retrieval',
                state: 'disabled',
                liveEffectAllowed: false,
                observedSignals,
                candidates: [],
                shadowComparison: null,
                guardrails: [...guardrails, 'behavior_discovery:kill_switch_disabled'],
            };
        }

        if (!shadowPlan) {
            return {
                enabled: true,
                domain: 'retrieval',
                state: 'observe',
                liveEffectAllowed: false,
                observedSignals,
                candidates: [],
                shadowComparison: null,
                guardrails,
            };
        }

        const addedIds = shadowPlan.shadowSelectionIds.filter(id => !selectedIds.includes(id));
        const removedIds = selectedIds.filter(id => !shadowPlan.shadowSelectionIds.includes(id));
        const changed = addedIds.length > 0 || removedIds.length > 0;
        const readiness = !changed
            ? 'hold'
            : addedIds.length <= 1 && removedIds.length <= 1
                ? 'shadow_ready'
                : 'promotion_blocked';

        return {
            enabled: true,
            domain: 'retrieval',
            state: shadowPlan.candidate.state === 'candidate' ? 'candidate' : 'shadow',
            liveEffectAllowed: false,
            observedSignals,
            candidates: [shadowPlan.candidate],
            shadowComparison: {
                candidateId: shadowPlan.candidate.id,
                currentSelectionIds: selectedIds,
                shadowSelectionIds: shadowPlan.shadowSelectionIds,
                addedIds,
                removedIds,
                changed,
                summary: changed
                    ? `shadow_diff:+${addedIds.join(',') || 'none'}:-${removedIds.join(',') || 'none'}`
                    : 'shadow_matches_current_selection',
                readiness,
            },
            guardrails,
        };
    }

    buildReasonList(
        signals: RetrievalIntentSignals,
        recipe: PromptContextRecipe,
        typePreference: RetrievalTypePreference,
        cognitiveLoad: CognitiveLoadAssessment,
        budget: RetrievalBudgetApplication,
        primer: RetrievalPrimerSnapshot,
        routing: DualProcessRoutingSnapshot,
    ): string[] {
        const reasons = [
            `recipe:${recipe.name}`,
            `graph_depth:${recipe.graphDepth}`,
            `memory_type_preference:${typePreference.preferredType}`,
            `memory_type_reason:${typePreference.reason}`,
            `cognitive_load:${cognitiveLoad.level}`,
            `budget_profile:${budget.profile.name}`,
            ...cognitiveLoad.reasons.map(reason => `load_signal:${reason}`),
            ...budget.selectionReasons,
        ];

        if (signals.hasPreferenceCue) reasons.push('signal:preference_cue');
        if (signals.hasFollowUpCue) reasons.push('signal:follow_up_cue');
        if (signals.hasRecallCue) reasons.push('signal:recall_cue');
        if (signals.hasConstraintCue) reasons.push('signal:constraint_cue');
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
        reasons.push(`dual_process:${routing.selectedMode}`);
        reasons.push(...routing.routingReasons.map(reason => `dual_process_reason:${reason}`));
        reasons.push(...routing.escalationTriggers.map(trigger => `dual_process_trigger:${trigger}`));
        if (routing.secondPassApplied) {
            reasons.push('dual_process:second_pass_applied');
        }

        return reasons;
    }
}
