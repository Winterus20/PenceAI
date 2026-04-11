import type { RetrievalSpreadingActivationState, RetrievalSpreadingActivationConfig, BundleSelectionContext, RetrievalSpreadingActivationSkipSummary, RetrievalOrchestratorDeps, RetrievalSpreadingActivationReason, RetrievalActivatedCandidateSummary, MemoryRelationNeighbor } from './types.js';
import type { MemoryRow } from '../types.js';
import { RetrievalPrimer } from './RetrievalPrimer.js';

function localNormalizeConfidence(confidence: number | null | undefined): number {
    if (!Number.isFinite(confidence)) return 0.7;
    return Math.max(0.2, Math.min(2, Number(confidence)));
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

export class SpreadingActivationEngine {
    buildConfig(overrides?: Partial<RetrievalSpreadingActivationConfig>): RetrievalSpreadingActivationConfig {
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

    buildInactiveState(context: BundleSelectionContext): RetrievalSpreadingActivationState;
    buildInactiveState(config: RetrievalSpreadingActivationConfig): RetrievalSpreadingActivationState;
    buildInactiveState(arg: BundleSelectionContext | RetrievalSpreadingActivationConfig): RetrievalSpreadingActivationState {
        const config = 'config' in arg
            ? (arg as { config: RetrievalSpreadingActivationConfig }).config
            : this.buildConfig();
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

    buildState(
        deps: RetrievalOrchestratorDeps,
        relevantBase: MemoryRow[],
        context: Omit<BundleSelectionContext, 'spreadingActivation'>,
        primer: RetrievalPrimer,
    ): RetrievalSpreadingActivationState {
        const config = this.buildConfig(deps.getSpreadingActivationConfig?.());
        const inactiveState = this.buildInactiveState(config);
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
                normalizedConfidence: localNormalizeConfidence(memory.confidence),
                score: primer.computeBaseScore(
                    primer.computeSignalScore(memory, context.activeConversationId, context.recipe, context.typePreference),
                    primer.computeBonus(memory, { ...context, spreadingActivation: inactiveState }),
                    memory,
                ),
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

                const relationConfidence = localNormalizeConfidence(neighbor.relation_confidence ?? 0);
                if (relationConfidence < config.relationConfidenceFloor) {
                    relationFloorSkips += 1;
                    neighborSkipEntries.push({ id: neighbor.id, reason: 'relation_confidence_below_floor' });
                    continue;
                }

                const candidateConfidence = localNormalizeConfidence(neighbor.confidence);
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

    getBonus(memoryId: number, state: RetrievalSpreadingActivationState): number {
        return state.bonusByMemoryId.get(memoryId) ?? 0;
    }

    summarizeSkips(skips: Array<{ id: number; reason: string }>): RetrievalSpreadingActivationSkipSummary[] {
        return summarizeActivationSkips(skips);
    }
}
