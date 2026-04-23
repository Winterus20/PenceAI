import type { RetrievalRankedEntry, BundleSelectionContext, RetrievalMemoryExplanation, RetrievalMemoryBreakdown } from './types.js';
import type { MemoryRow } from '../types.js';
import type { RetrievalPrimer } from './RetrievalPrimer.js';
import type { RetrievalSpreadingActivationState } from './types.js';

function localNormalizePrimerText(text: string): string {
    return text
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function computeSpreadingActivationBonus(memory: MemoryRow, context: BundleSelectionContext): number {
    if (!context.spreadingActivation.snapshot.appliedToRanking) {
        return 0;
    }
    return context.spreadingActivation.bonusByMemoryId.get(memory.id) ?? 0;
}

export interface ScoringPipelineDeps {
    primer: RetrievalPrimer;
    getActivationBonus: (memoryId: number) => number;
    activeConversationId: string;
}

export class ScoringPipeline {
    constructor(private readonly deps: ScoringPipelineDeps) {}

    buildRankedEntries(
        memories: MemoryRow[],
        context: BundleSelectionContext,
    ): RetrievalRankedEntry[] {
        return memories
            .map(memory => {
                const signalScore = this.deps.primer.computeSignalScore(memory, context.activeConversationId, context.recipe, context.typePreference);
                const primingBonus = this.deps.primer.computeBonus(memory, context);
                const activationBonus = computeSpreadingActivationBonus(memory, context);
                const importanceBonus = Number((memory.importance * 0.04).toFixed(3));
                const accessBonus = Number((memory.access_count * 0.015).toFixed(3));
                const finalScore = Number((
                    signalScore
                    + primingBonus
                    + activationBonus
                    + importanceBonus
                    + accessBonus
                ).toFixed(3));

                return {
                    memory,
                    signalScore: Number(signalScore.toFixed(3)),
                    primingBonus,
                    activationBonus,
                    importanceBonus,
                    accessBonus,
                    finalScore,
                };
            })
            .sort((a, b) => b.finalScore - a.finalScore || b.memory.updated_at.localeCompare(a.memory.updated_at));
    }

    rankAndSlice(
        memories: MemoryRow[],
        limit: number,
        context: BundleSelectionContext,
    ): { entries: RetrievalRankedEntry[]; memories: MemoryRow[] } {
        const entries = this.buildRankedEntries(memories, context);
        return {
            entries,
            memories: entries.slice(0, limit).map(entry => entry.memory),
        };
    }

    buildExplanations(
        lane: RetrievalMemoryExplanation['lane'],
        rankedEntries: RetrievalRankedEntry[],
        selected: MemoryRow[],
        context: BundleSelectionContext,
    ): RetrievalMemoryExplanation[] {
        const selectedIds = new Set(selected.map(memory => memory.id));

        return rankedEntries
            .filter(entry => selectedIds.has(entry.memory.id))
            .slice(0, selected.length)
            .map((entry, index) => {
                const normalizedMemoryText = localNormalizePrimerText(entry.memory.content);
                const reasons: string[] = [];

                if (entry.signalScore > 1.2) reasons.push('strong_signal_score');
                if (entry.primingBonus > 0) reasons.push('intent_primed');
                if (entry.activationBonus > 0) reasons.push('graph_supported');
                if (entry.memory.provenance_conversation_id === context.activeConversationId) reasons.push('conversation_scoped');
                if (context.typePreference.preferredType !== 'balanced' && entry.memory.memory_type === context.typePreference.preferredType) {
                    reasons.push(`type_aligned:${context.typePreference.preferredType}`);
                }
                if (context.primer.entityHints.some(entity => normalizedMemoryText.includes(entity))) reasons.push('entity_hint_match');
                if (context.primer.topicHints.some(topic => normalizedMemoryText.includes(topic))) reasons.push('topic_hint_match');
                if (lane === 'supplemental') reasons.push('supplemental_context');
                if (lane === 'review') reasons.push('review_queue');
                if (lane === 'follow_up') reasons.push('follow_up_candidate');

                return {
                    id: entry.memory.id,
                    rank: index + 1,
                    lane,
                    category: entry.memory.category?.trim() || 'unknown',
                    memoryType: entry.memory.memory_type ?? 'unknown',
                    source: entry.memory.provenance_source?.trim() || 'unknown',
                    conversationScoped: entry.memory.provenance_conversation_id === context.activeConversationId,
                    finalScore: entry.finalScore,
                    components: {
                        signalScore: entry.signalScore,
                        primingBonus: entry.primingBonus,
                        activationBonus: entry.activationBonus,
                        importanceBonus: entry.importanceBonus,
                        accessBonus: entry.accessBonus,
                    },
                    reasons,
                };
            });
    }

    summarizeBreakdown(memories: MemoryRow[]): RetrievalMemoryBreakdown {
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
            (breakdown.byMemoryType as Record<string, number>)[memoryTypeKey] = ((breakdown.byMemoryType as Record<string, number>)[memoryTypeKey] ?? 0) + 1;

            if (memory.is_archived) {
                breakdown.archivalCount += 1;
            } else {
                breakdown.activeCount += 1;
            }

            if (memory.provenance_conversation_id && memory.provenance_conversation_id === this.deps.activeConversationId) {
                breakdown.conversationScopedCount += 1;
            }
        }

        return breakdown;
    }
}
