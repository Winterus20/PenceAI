import type { RetrievalRankedEntry, BundleSelectionContext, RetrievalCoverageGap, RetrievalSecondPassAdjustment, RetrievalSecondPassAuditSnapshot } from './types.js';
import type { MemoryRow } from '../types.js';

export class CoverageRepair {
    detectGaps(
        selected: MemoryRow[],
        candidatePool: MemoryRow[],
        activeConversationId: string,
        context: BundleSelectionContext,
    ): RetrievalCoverageGap[] {
        const gaps: RetrievalCoverageGap[] = [];
        const selectedIds = new Set(selected.map(memory => memory.id));
        const unselected = candidatePool.filter(memory => !selectedIds.has(memory.id));
        const selectedCategories = new Set(selected.map(memory => memory.category?.trim().toLowerCase() || 'unknown'));

        if (
            context.typePreference.preferredType !== 'balanced'
            && selected.every(memory => memory.memory_type !== context.typePreference.preferredType)
            && unselected.some(memory => memory.memory_type === context.typePreference.preferredType)
        ) {
            gaps.push({
                type: context.typePreference.preferredType,
                reason: `missing_preferred_type:${context.typePreference.preferredType}`,
            });
        }

        if (
            (context.recipe.preferConversationSignals || context.primer.reasons.includes('recent_follow_up_context'))
            && selected.every(memory => memory.provenance_conversation_id !== activeConversationId)
            && unselected.some(memory => memory.provenance_conversation_id === activeConversationId)
        ) {
            gaps.push({
                type: 'conversation_scoped',
                reason: 'missing_conversation_scoped_support',
            });
        }

        if (
            context.recipe.name === 'exploratory'
            && unselected.some(memory => !selectedCategories.has(memory.category?.trim().toLowerCase() || 'unknown'))
        ) {
            gaps.push({
                type: 'novel_category',
                reason: 'missing_exploratory_category_coverage',
            });
        }

        return gaps;
    }

    applySecondPass(
        lane: RetrievalSecondPassAdjustment['lane'],
        rankedEntries: RetrievalRankedEntry[],
        limit: number,
        context: BundleSelectionContext,
    ): { selected: MemoryRow[]; adjustment: RetrievalSecondPassAdjustment; coverageGaps: RetrievalCoverageGap[]; guardrailSummary: string[] } {
        const initialSelected = rankedEntries.slice(0, limit).map(entry => entry.memory);
        const selectedIds = new Set(initialSelected.map(memory => memory.id));
        const unselectedEntries = rankedEntries.filter(entry => !selectedIds.has(entry.memory.id));
        const coverageGaps = this.detectGaps(initialSelected, rankedEntries.map(entry => entry.memory), context.activeConversationId, context);
        const guardrailSummary = [
            'second_pass:bounded_to_existing_candidates',
            `second_pass:selection_limit_preserved:${limit}`,
        ];

        if (context.dualProcess.selectedMode !== 'system2' || coverageGaps.length === 0 || initialSelected.length === 0 || unselectedEntries.length === 0) {
            return {
                selected: initialSelected,
                adjustment: {
                    lane,
                    applied: false,
                    reason: null,
                    removedId: null,
                    addedId: null,
                    preservedIds: initialSelected.map(memory => memory.id),
                },
                coverageGaps,
                guardrailSummary,
            };
        }

        const replacementEntry = unselectedEntries.find(entry => {
            const categoryKey = entry.memory.category?.trim().toLowerCase() || 'unknown';
            return coverageGaps.some(gap => {
                if (gap.type === 'conversation_scoped') {
                    return entry.memory.provenance_conversation_id === context.activeConversationId;
                }
                if (gap.type === 'novel_category') {
                    return !initialSelected.some(memory => (memory.category?.trim().toLowerCase() || 'unknown') === categoryKey);
                }
                return entry.memory.memory_type === gap.type;
            });
        });

        if (!replacementEntry) {
            guardrailSummary.push('second_pass:no_eligible_replacement');
            return {
                selected: initialSelected,
                adjustment: {
                    lane,
                    applied: false,
                    reason: null,
                    removedId: null,
                    addedId: null,
                    preservedIds: initialSelected.map(memory => memory.id),
                },
                coverageGaps,
                guardrailSummary,
            };
        }

        const removableEntry = [...rankedEntries.slice(0, limit)]
            .reverse()
            .find(entry => {
                const memory = entry.memory;
                return !coverageGaps.some(gap => {
                    if (gap.type === 'conversation_scoped') {
                        return memory.provenance_conversation_id === context.activeConversationId;
                    }
                    if (gap.type === 'novel_category') {
                        const categoryKey = memory.category?.trim().toLowerCase() || 'unknown';
                        const categoryCount = initialSelected.filter(item => (item.category?.trim().toLowerCase() || 'unknown') === categoryKey).length;
                        return categoryCount <= 1;
                    }
                    return memory.memory_type === gap.type;
                });
            });

        if (!removableEntry) {
            guardrailSummary.push('second_pass:no_safe_removal');
            return {
                selected: initialSelected,
                adjustment: {
                    lane,
                    applied: false,
                    reason: null,
                    removedId: null,
                    addedId: null,
                    preservedIds: initialSelected.map(memory => memory.id),
                },
                coverageGaps,
                guardrailSummary,
            };
        }

        const selected = rankedEntries
            .slice(0, limit)
            .map(entry => entry.memory.id === removableEntry.memory.id ? replacementEntry.memory : entry.memory);
        guardrailSummary.push('second_pass:coverage_swap_applied');

        return {
            selected,
            adjustment: {
                lane,
                applied: true,
                reason: coverageGaps[0]?.reason ?? 'coverage_gap',
                removedId: removableEntry.memory.id,
                addedId: replacementEntry.memory.id,
                preservedIds: selected.filter(memory => memory.id !== replacementEntry.memory.id).map(memory => memory.id),
            },
            coverageGaps,
            guardrailSummary,
        };
    }
}
