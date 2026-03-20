import { MemoryRetrievalOrchestrator } from '../../src/memory/retrievalOrchestrator.js';
import type { MemoryRow } from '../../src/memory/types.js';

function createMemoryRow(overrides: Partial<MemoryRow> & Pick<MemoryRow, 'id' | 'content'>): MemoryRow {
    return {
        id: overrides.id,
        user_id: overrides.user_id ?? 'default',
        category: overrides.category ?? 'general',
        content: overrides.content,
        importance: overrides.importance ?? 5,
        access_count: overrides.access_count ?? 0,
        is_archived: overrides.is_archived ?? 0,
        last_accessed: overrides.last_accessed ?? null,
        created_at: overrides.created_at ?? '2026-03-08T10:00:00.000Z',
        updated_at: overrides.updated_at ?? '2026-03-08T10:00:00.000Z',
        provenance_source: overrides.provenance_source ?? 'conversation',
        provenance_conversation_id: overrides.provenance_conversation_id ?? 'conv-1',
        provenance_message_id: overrides.provenance_message_id ?? null,
        confidence: overrides.confidence ?? 0.8,
        review_profile: overrides.review_profile ?? 'standard',
        memory_type: overrides.memory_type ?? null,
        stability: overrides.stability ?? null,
        retrievability: overrides.retrievability ?? null,
        next_review_at: overrides.next_review_at ?? null,
        review_count: overrides.review_count ?? null,
        max_importance: overrides.max_importance ?? null,
    };
}

describe('MemoryRetrievalOrchestrator observability', () => {
    test('records recipe, candidates, breakdowns, cognitive load and budget details without altering bundle shape', async () => {
        const activeMemories = [
            createMemoryRow({ id: 1, content: 'Kullanıcı TypeScript seviyor', category: 'preference', importance: 8, access_count: 4, confidence: 0.9, memory_type: 'semantic' }),
            createMemoryRow({ id: 2, content: 'Kullanıcı backend geliştiriyor', category: 'project', provenance_source: 'system', importance: 6, access_count: 1, memory_type: 'semantic' }),
        ];
        const archivalMemories = [
            createMemoryRow({ id: 3, content: 'Eski tercih bilgisi', category: 'archive', is_archived: 1, provenance_source: 'import', provenance_conversation_id: 'conv-9', memory_type: 'semantic' }),
        ];
        const fallbackMemories = [
            createMemoryRow({ id: 4, content: 'Takip için ek not', category: 'follow_up', provenance_source: 'conversation', memory_type: 'episodic' }),
            createMemoryRow({ id: 5, content: 'Genel kullanıcı profili', category: 'profile', provenance_source: 'system', memory_type: 'semantic' }),
        ];
        const reviewMemories = [
            createMemoryRow({ id: 6, content: 'Review adayı', category: 'review', review_profile: 'strict', memory_type: 'semantic' }),
        ];
        const followUpCandidates = [
            createMemoryRow({ id: 7, content: 'Takip adayı', category: 'follow_up', provenance_source: 'conversation', memory_type: 'episodic' }),
        ];
        const recentMessages = [
            { role: 'user', content: 'Tercihlerimi hatırla ve son durumu söyle', created_at: '2026-03-08T10:00:00.000Z', conversation_title: 'Test' },
        ];

        let debugPayload: any = null;
        const orchestrator = new MemoryRetrievalOrchestrator({
            graphAwareSearch: async () => ({ active: activeMemories, archival: archivalMemories }),
            getRecentConversationSummaries: () => [],
            getMemoriesDueForReview: () => reviewMemories,
            getFollowUpCandidates: () => followUpCandidates,
            getRecentMessages: () => recentMessages,
            getUserMemories: () => fallbackMemories,
            getMemoryNeighborsBatch: () => new Map([
                [1, [{ ...activeMemories[1], relation_type: 'related_to', relation_confidence: 0.88, relation_description: 'Aynı kullanıcı profili' }]],
                [2, []],
            ]),
            prioritizeConversationMemories: (memories) => memories,
            recordDebug: (payload) => {
                debugPayload = payload;
            },
        });

        const bundle = await orchestrator.getPromptContextBundle({
            query: 'Tercihlerimi hatırla ve son durumu söyle',
            activeConversationId: 'conv-1',
            options: {
                searchLimit: 4,
                relevantMemoryLimit: 2,
                fallbackMemoryLimit: 2,
                reviewLimit: 1,
                followUpLimit: 1,
            },
        });

        expect(bundle.relevantMemories).toHaveLength(2);
        expect(bundle.archivalMemories).toHaveLength(1);
        expect(bundle.reviewMemories).toHaveLength(1);
        expect(bundle.followUpCandidates).toHaveLength(1);
        expect(debugPayload).toBeTruthy();

        expect(debugPayload.recipe.name).toBe('preference_recall');
        expect(debugPayload.candidates).toEqual({
            relevant: 2,
            archival: 1,
            supplemental: 2,
            review: 1,
            followUp: 1,
        });
        expect(debugPayload.selectedIds.relevant).toEqual(bundle.relevantMemories.map((memory: MemoryRow) => memory.id));
        expect(debugPayload.breakdowns.relevant).toMatchObject({
            total: 2,
            byCategory: {
                preference: 1,
                project: 1,
            },
            bySource: {
                conversation: 1,
                system: 1,
            },
            byMemoryType: {
                semantic: 2,
            },
            archivalCount: 0,
            activeCount: 2,
            conversationScopedCount: 2,
        });
        expect(debugPayload.breakdowns.archival).toMatchObject({
            total: 1,
            byMemoryType: {
                semantic: 1,
            },
            archivalCount: 1,
            activeCount: 0,
        });
        expect(debugPayload.typePreference).toMatchObject({
            preferredType: 'semantic',
            reason: 'preference_profile_recall',
            semanticWeight: 1.16,
            episodicWeight: 0.96,
        });
        expect(debugPayload.cognitiveLoad).toMatchObject({
            level: 'medium',
            score: 1,
        });
        expect(debugPayload.budget).toMatchObject({
            searchLimit: 4,
            relevantMemoryLimit: 2,
            fallbackMemoryLimit: 2,
            followUpLimit: 1,
            reviewLimit: 1,
            profile: 'balanced_default',
            applied: {
                relevantLimit: 2,
                archivalLimit: 4,
                supplementalLimit: 2,
                fallbackPoolSize: 2,
                reviewLimit: 1,
                followUpLimit: 1,
                candidateExpansionLimit: 4,
            },
            guardrails: {
                searchLimitReached: false,
                archivalLimitReached: false,
                supplementalExpansionUsed: true,
                candidateExpansionPressure: false,
                reviewLimitReached: false,
                followUpLimitReached: false,
            },
            trimming: {
                relevantTrimmed: 0,
                archivalTrimmed: 0,
                reviewTrimmed: 0,
                followUpTrimmed: 0,
                reasons: expect.arrayContaining([
                    'selection:recipe_preference_recall',
                    'selection:load_medium',
                    'selection:balanced_default',
                ]),
            },
        });
        expect(debugPayload.budget.memoryTokenEstimate.totalSelected).toBeGreaterThan(0);
        expect(debugPayload.retrievalControl).toEqual({
            rolloutState: 'shadow',
            graphDepth: 1,
            dualProcessMode: 'system2',
            primerTriggered: true,
            behaviorDiscoveryState: 'shadow',
            behaviorDiscoveryLiveEffect: false,
            candidatePressure: {
                relevant: 0,
                supplemental: 0,
                archival: 0,
            },
        });
        expect(debugPayload.behaviorDiscovery).toMatchObject({
            enabled: true,
            domain: 'retrieval',
            state: 'shadow',
            liveEffectAllowed: false,
            observedSignals: expect.arrayContaining([
                'signal:preference_cue',
                'signal:follow_up_cue',
                'signal:recall_cue',
                'signal:recent_context',
                'trigger:cross_signal_conflict',
            ]),
            candidates: [
                expect.objectContaining({
                    id: 'retrieval_mixed_intent_shadow_v1',
                    domain: 'retrieval',
                    feature: 'mixed_intent_shadow_probe',
                    state: 'shadow',
                    trigger: 'cross_signal_conflict',
                    riskProfile: 'low',
                }),
            ],
            shadowComparison: {
                candidateId: 'retrieval_mixed_intent_shadow_v1',
                currentSelectionIds: [1, 2],
                shadowSelectionIds: [1, 2],
                addedIds: [],
                removedIds: [],
                changed: false,
                summary: 'shadow_matches_current_selection',
                readiness: 'hold',
            },
            guardrails: expect.arrayContaining([
                'behavior_discovery:shadow_safe_only',
                'behavior_discovery:no_live_effect',
                'behavior_discovery:active_policy_unchanged',
            ]),
        });
        expect(debugPayload.dualProcess).toMatchObject({
            selectedMode: 'system2',
            routingReasons: expect.arrayContaining([
                'deliberate_route_escalated',
            ]),
            escalationTriggers: expect.arrayContaining([
                'cross_signal_conflict',
            ]),
            secondPassApplied: true,
            secondPassSummary: 'deliberate_rerank_existing_budget',
            adjustedBudgetProfile: 'balanced_default',
            adjustedGraphDepth: 2,
        });
        expect(debugPayload.primer).toMatchObject({
            triggered: true,
            reasons: expect.arrayContaining([
                'preference_profile_query',
                'recent_follow_up_context',
            ]),
            entityHints: [],
            topicHints: [],
            typeHints: expect.arrayContaining(['semantic', 'episodic']),
            bonusSummary: {
                entityMatchBonus: 0,
                topicMatchBonus: 0,
                typeMatchBonus: 0.04,
                recentContextBonus: 0.03,
                focusedQueryBonus: 0,
                preferenceBiasBonus: 0.03,
                followUpBiasBonus: 0.03,
                exploratoryBiasBonus: 0,
                maxCandidateBonus: 0.1,
            },
        });
        expect(debugPayload.spreadingActivation).toMatchObject({
            enabled: true,
            rolloutState: 'shadow',
            shadowMode: true,
            appliedToRanking: false,
            seedCount: 2,
            seedIds: [1, 2],
            activatedCandidateCount: 1,
            activatedCandidates: [
                {
                    id: 2,
                    strongestSeedId: 1,
                    relationType: 'related_to',
                    relationConfidence: 0.88,
                    candidateConfidence: 0.8,
                    hop: 1,
                    decayApplied: 1,
                    bonus: expect.any(Number),
                    capped: false,
                },
            ],
            skips: {
                seeds: [],
                neighbors: [],
            },
            guardrails: {
                eligibleSeedCount: 2,
                eligibleActivatedCandidateCount: 1,
                seedLimitTriggered: false,
                maxCandidateLimitTriggered: false,
                candidateBonusCapTriggered: false,
                relationFloorSkips: 0,
                seedQualitySkips: 0,
                candidateQualitySkips: 0,
                minBonusSkips: 0,
            },
            bonusSummary: {
                activationScale: 0.05,
                hopDecay: 0.55,
                maxCandidateBonus: 0.05,
                minEffectiveBonus: 0.025,
                totalBonusApplied: expect.any(Number),
                strongestBonus: expect.any(Number),
            },
        });
        expect(debugPayload.spreadingActivation.reasons).toEqual(expect.arrayContaining([
            expect.objectContaining({
                seedId: 1,
                targetId: 2,
                relationType: 'related_to',
                relationConfidence: 0.88,
                candidateConfidence: 0.8,
                hop: 1,
                decayApplied: 1,
                rawBonus: expect.any(Number),
                capped: false,
            }),
        ]));
        expect(debugPayload.secondPass).toMatchObject({
            applied: false,
            mode: 'system2',
            coverageGaps: [],
            guardrailSummary: expect.arrayContaining([
                'second_pass:bounded_to_existing_candidates',
                'second_pass:selection_limit_preserved:2',
            ]),
            adjustments: expect.arrayContaining([
                expect.objectContaining({ lane: 'relevant', applied: false }),
                expect.objectContaining({ lane: 'supplemental', applied: false }),
            ]),
        });
        expect(debugPayload.explanations.relevant).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 1,
                lane: 'relevant',
                memoryType: 'semantic',
                conversationScoped: true,
                reasons: expect.arrayContaining(['strong_signal_score', 'intent_primed', 'conversation_scoped', 'type_aligned:semantic']),
                components: expect.objectContaining({
                    signalScore: expect.any(Number),
                    primingBonus: expect.any(Number),
                    activationBonus: 0,
                }),
            }),
        ]));
        expect(debugPayload.explanations.supplemental).toEqual(expect.arrayContaining([
            expect.objectContaining({
                lane: 'supplemental',
                reasons: expect.arrayContaining(['supplemental_context']),
            }),
        ]));
        expect(debugPayload.reasons).toEqual(expect.arrayContaining([
            'recipe:preference_recall',
            'signal:preference_cue',
            'signal:follow_up_cue',
            'signal:recall_cue',
            'signal:recent_context',
            'memory_type_preference:semantic',
            'memory_type_reason:preference_profile_recall',
            'cognitive_load:medium',
            'budget_profile:balanced_default',
            'load_signal:preference_recall',
            'load_signal:follow_up',
            'ranking:prefer_review_signals',
            'primer:triggered:yes',
            'primer:preference_profile_query',
            'primer:recent_follow_up_context',
            'dual_process:system2',
            'dual_process_reason:deliberate_route_escalated',
            'dual_process_trigger:cross_signal_conflict',
            'dual_process:second_pass_applied',
            'second_pass:bounded_to_existing_candidates',
            'behavior_discovery:shadow',
            'behavior_discovery_shadow:shadow_matches_current_selection',
            'behavior_discovery_readiness:hold',
        ]));
    });

    test('records episodic type preference and reasons for follow-up recipe', async () => {
        let debugPayload: any = null;
        const activeMemories = [
            createMemoryRow({ id: 21, content: 'Dün deploy sonrası hata oranını kontrol ettik', category: 'follow_up', memory_type: 'episodic' }),
            createMemoryRow({ id: 22, content: 'Kullanıcı backend gözlemlerini raporlamayı tercih ediyor', category: 'profile', provenance_source: 'system', provenance_conversation_id: null, memory_type: 'semantic' }),
        ];

        const orchestrator = new MemoryRetrievalOrchestrator({
            graphAwareSearch: async () => ({ active: activeMemories, archival: [] }),
            getRecentConversationSummaries: () => [],
            getMemoriesDueForReview: () => [],
            getFollowUpCandidates: () => [],
            getRecentMessages: () => [
                { role: 'user', content: 'Son durum nedir, bu işi takip edelim', created_at: '2026-03-08T10:00:00.000Z', conversation_title: 'Test' },
            ],
            getUserMemories: () => [],
            prioritizeConversationMemories: (memories) => memories,
            recordDebug: (payload) => {
                debugPayload = payload;
            },
        });

        await orchestrator.getPromptContextBundle({
            query: 'Son durum nedir, bu işi takip edelim',
            activeConversationId: 'conv-1',
            options: {
                relevantMemoryLimit: 2,
                searchLimit: 2,
            },
        });

        expect(debugPayload.recipe.name).toBe('conversation_followup');
        expect(debugPayload.typePreference).toMatchObject({
            preferredType: 'episodic',
            reason: 'recent_event_followup',
            episodicWeight: 1.16,
            semanticWeight: 0.96,
        });
        expect(debugPayload.cognitiveLoad).toMatchObject({
            level: 'low',
            score: 0,
        });
        expect(debugPayload.budget.profile).toBe('balanced_default');
        expect(debugPayload.dualProcess).toMatchObject({
            selectedMode: 'system2',
            routingReasons: expect.arrayContaining([
                'fast_path_low_load',
            ]),
            escalationTriggers: expect.arrayContaining([
                'follow_up_ambiguity',
            ]),
            secondPassApplied: true,
            secondPassSummary: 'deliberate_rerank_budget:supportive_expansion->balanced_default',
            adjustedBudgetProfile: 'balanced_default',
            adjustedGraphDepth: 2,
        });
        expect(debugPayload.primer).toMatchObject({
            triggered: true,
            reasons: ['recent_follow_up_context'],
            typeHints: ['episodic'],
            topicHints: [],
            entityHints: [],
        });
        expect(debugPayload.reasons).toEqual(expect.arrayContaining([
            'recipe:conversation_followup',
            'signal:follow_up_cue',
            'signal:question',
            'signal:recent_context',
            'memory_type_preference:episodic',
            'memory_type_reason:recent_event_followup',
            'cognitive_load:low',
            'budget_profile:balanced_default',
            'load_signal:follow_up',
            'load_signal:simple_question',
            'selection:allow_supporting_context',
            'selection:breadth_low_load',
            'selection:dual_process_deliberate_pass',
            'ranking:prefer_conversation_signals',
            'ranking:prefer_review_signals',
            'fallback:expanded_pool',
            'primer:triggered:yes',
            'primer:recent_follow_up_context',
            'dual_process:system2',
            'dual_process_reason:fast_path_low_load',
            'dual_process_trigger:follow_up_ambiguity',
            'dual_process:second_pass_applied',
            'second_pass:bounded_to_existing_candidates',
        ]));
    });

    test('records rollout state, guardrail skips and cap details for spreading activation observability', async () => {
        let debugPayload: any = null;
        const seedOne = createMemoryRow({ id: 31, content: 'Seed one', category: 'project', importance: 10, access_count: 4, confidence: 0.97, memory_type: 'semantic', provenance_conversation_id: 'conv-soft' });
        const seedTwo = createMemoryRow({ id: 32, content: 'Seed two', category: 'project', importance: 9, access_count: 4, confidence: 0.96, memory_type: 'semantic', provenance_conversation_id: 'conv-soft', updated_at: '2026-03-08T10:00:01.000Z' });
        const weakSeed = createMemoryRow({ id: 33, content: 'Weak seed', category: 'project', importance: 1, access_count: 0, confidence: 0.4, memory_type: 'semantic', provenance_conversation_id: 'conv-soft', updated_at: '2026-03-08T10:00:02.000Z' });
        const promotedNeighbor = createMemoryRow({ id: 34, content: 'Promoted neighbor', category: 'knowledge', importance: 9, access_count: 3, confidence: 0.92, memory_type: 'semantic', provenance_source: 'system', provenance_conversation_id: null, updated_at: '2026-03-08T10:00:03.000Z' });
        const cappedNeighbor = createMemoryRow({ id: 35, content: 'Capped neighbor', category: 'knowledge', importance: 8, access_count: 2, confidence: 0.9, memory_type: 'semantic', provenance_source: 'system', provenance_conversation_id: null, updated_at: '2026-03-08T10:00:04.000Z' });
        const truncatedNeighbor = createMemoryRow({ id: 36, content: 'Truncated neighbor', category: 'knowledge', importance: 7, access_count: 2, confidence: 0.89, memory_type: 'semantic', provenance_source: 'system', provenance_conversation_id: null, updated_at: '2026-03-08T10:00:05.000Z' });
        const weakRelationNeighbor = createMemoryRow({ id: 37, content: 'Weak relation neighbor', category: 'knowledge', importance: 5, access_count: 0, confidence: 0.6, memory_type: 'semantic', provenance_source: 'system', provenance_conversation_id: null, updated_at: '2026-03-08T10:00:06.000Z' });

        const orchestrator = new MemoryRetrievalOrchestrator({
            graphAwareSearch: async () => ({ active: [seedOne, seedTwo, weakSeed, promotedNeighbor, cappedNeighbor, truncatedNeighbor, weakRelationNeighbor], archival: [] }),
            getRecentConversationSummaries: () => [],
            getMemoriesDueForReview: () => [],
            getFollowUpCandidates: () => [],
            getRecentMessages: () => [],
            getUserMemories: () => [],
            getSpreadingActivationConfig: () => ({ rolloutState: 'soft', maxCandidates: 2 }),
            getMemoryNeighborsBatch: () => new Map([
                [31, [
                    { ...promotedNeighbor, relation_type: 'related_to', relation_confidence: 0.98, relation_description: 'Primary edge' },
                    { ...cappedNeighbor, relation_type: 'supports', relation_confidence: 0.95, relation_description: 'Cap edge 1' },
                    { ...truncatedNeighbor, relation_type: 'supports', relation_confidence: 0.9, relation_description: 'Truncate edge' },
                ]],
                [32, [
                    { ...promotedNeighbor, relation_type: 'related_to', relation_confidence: 0.98, relation_description: 'Primary edge 2' },
                    { ...cappedNeighbor, relation_type: 'supports', relation_confidence: 0.95, relation_description: 'Cap edge 2' },
                    { ...weakRelationNeighbor, relation_type: 'related_to', relation_confidence: 0.4, relation_description: 'Weak edge' },
                ]],
            ]),
            prioritizeConversationMemories: (memories) => memories,
            recordDebug: (payload) => {
                debugPayload = payload;
            },
        });

        await orchestrator.getPromptContextBundle({
            query: 'selam',
            activeConversationId: 'conv-soft',
            options: {
                relevantMemoryLimit: 7,
                searchLimit: 7,
            },
        });

        expect(debugPayload.spreadingActivation).toMatchObject({
            enabled: true,
            rolloutState: 'soft',
            shadowMode: false,
            appliedToRanking: true,
            seedCount: 2,
            seedIds: [31, 32],
            activatedCandidateCount: 3,
            guardrails: {
                eligibleSeedCount: 5,
                eligibleActivatedCandidateCount: 3,
                seedLimitTriggered: true,
                maxCandidateLimitTriggered: true,
                candidateBonusCapTriggered: true,
                relationFloorSkips: 1,
                seedQualitySkips: 2,
                candidateQualitySkips: 0,
                minBonusSkips: 0,
            },
            bonusSummary: {
                activationScale: 0.05,
                hopDecay: 0.55,
                maxCandidateBonus: 0.05,
                minEffectiveBonus: 0.025,
                totalBonusApplied: expect.any(Number),
                strongestBonus: 0.05,
            },
        });
        expect(debugPayload.retrievalControl).toEqual({
            rolloutState: 'soft',
            graphDepth: 2,
            dualProcessMode: 'system1',
            primerTriggered: false,
            behaviorDiscoveryState: 'observe',
            behaviorDiscoveryLiveEffect: false,
            candidatePressure: {
                relevant: 0,
                supplemental: 0,
                archival: 0,
            },
        });
        expect(debugPayload.behaviorDiscovery).toMatchObject({
            enabled: true,
            domain: 'retrieval',
            state: 'observe',
            liveEffectAllowed: false,
            candidates: [],
            shadowComparison: null,
            guardrails: expect.arrayContaining([
                'behavior_discovery:shadow_safe_only',
                'behavior_discovery:no_live_effect',
            ]),
        });
        expect(debugPayload.spreadingActivation.activatedCandidates).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 34, capped: false }),
            expect.objectContaining({ id: 35, capped: false }),
        ]));
        expect(debugPayload.spreadingActivation.skips.seeds).toEqual(expect.arrayContaining([
            expect.objectContaining({ reason: 'seed_confidence_below_floor', count: 2, sampleIds: [33, 37] }),
        ]));
        expect(debugPayload.spreadingActivation.skips.neighbors).toEqual(expect.arrayContaining([
            expect.objectContaining({ reason: 'activated_candidate_truncated', count: 1, sampleIds: [36] }),
            expect.objectContaining({ reason: 'relation_confidence_below_floor', count: 1, sampleIds: [37] }),
        ]));
    });

    test('marks expanded fallback pool and archival preference for exploratory recipe', async () => {
        let debugPayload: any = null;
        const activeMemories = [
            createMemoryRow({ id: 11, content: 'Aktif hafıza', category: 'general', provenance_conversation_id: 'conv-2', memory_type: 'semantic' }),
        ];
        const archivalMemories = [
            createMemoryRow({ id: 12, content: 'Arşiv hafıza', category: 'archive', is_archived: 1, provenance_source: 'import', provenance_conversation_id: 'conv-9', memory_type: 'semantic' }),
        ];
        const fallbackMemories = [
            createMemoryRow({ id: 13, content: 'Fallback hafıza', category: 'profile', provenance_source: 'system', provenance_conversation_id: 'conv-8', memory_type: 'semantic' }),
        ];

        const orchestrator = new MemoryRetrievalOrchestrator({
            graphAwareSearch: async () => ({ active: activeMemories, archival: archivalMemories }),
            getRecentConversationSummaries: () => [],
            getMemoriesDueForReview: () => [],
            getFollowUpCandidates: () => [],
            getRecentMessages: () => [],
            getUserMemories: () => fallbackMemories,
            prioritizeConversationMemories: (memories) => memories,
            recordDebug: (payload) => {
                debugPayload = payload;
            },
        });

        await orchestrator.getPromptContextBundle({
            query: 'Bu konu ne ve nasıl çalışıyor?',
            activeConversationId: 'conv-2',
            options: {
                relevantMemoryLimit: 1,
                fallbackMemoryLimit: 3,
            },
        });

        expect(debugPayload.recipe.name).toBe('exploratory');
        expect(debugPayload.cognitiveLoad).toMatchObject({
            level: 'low',
            score: 0,
        });
        expect(debugPayload.budget.profile).toBe('supportive_expansion');
        expect(debugPayload.primer).toMatchObject({
            triggered: true,
            reasons: expect.arrayContaining([
                'exploratory_context',
            ]),
            entityHints: [],
            typeHints: [],
        });
        expect(debugPayload.budget.applied).toMatchObject({
            relevantLimit: 2,
            archivalLimit: 3,
            supplementalLimit: 3,
            fallbackPoolSize: 6,
            candidateExpansionLimit: 6,
        });
        expect(debugPayload.typePreference).toMatchObject({
            preferredType: 'balanced',
            reason: 'soft_default_balance',
            semanticWeight: 1,
            episodicWeight: 1,
        });
        expect(debugPayload.reasons).toEqual(expect.arrayContaining([
            'recipe:exploratory',
            'signal:question',
            'memory_type_preference:balanced',
            'memory_type_reason:soft_default_balance',
            'cognitive_load:low',
            'budget_profile:supportive_expansion',
            'load_signal:exploratory_breadth',
            'load_signal:simple_question',
            'selection:allow_supporting_context',
            'selection:breadth_low_load',
            'fallback:prefer_archival',
            'fallback:expanded_pool',
            'primer:triggered:yes',
            'primer:exploratory_context',
        ]));
    });

    test('respects behavior discovery kill switch and keeps retrieval decisions unchanged', async () => {
        let debugPayload: any = null;
        const activeMemories = [
            createMemoryRow({ id: 41, content: 'Kullanıcı kısa yanıt seviyor', category: 'preference', memory_type: 'semantic' }),
            createMemoryRow({ id: 42, content: 'Dün aynı konuyu takip ettik', category: 'follow_up', memory_type: 'episodic' }),
        ];

        const orchestrator = new MemoryRetrievalOrchestrator({
            graphAwareSearch: async () => ({ active: activeMemories, archival: [] }),
            getRecentConversationSummaries: () => [],
            getMemoriesDueForReview: () => [],
            getFollowUpCandidates: () => [],
            getRecentMessages: () => [
                { role: 'user', content: 'Tercihimi hatırla ve son durumu söyle', created_at: '2026-03-08T10:00:00.000Z', conversation_title: 'Test' },
            ],
            getUserMemories: () => [],
            getBehaviorDiscoveryConfig: () => ({ retrieval: { state: 'disabled' } }),
            prioritizeConversationMemories: (memories) => memories,
            recordDebug: (payload) => {
                debugPayload = payload;
            },
        });

        const bundle = await orchestrator.getPromptContextBundle({
            query: 'Tercihimi hatırla ve son durumu söyle',
            activeConversationId: 'conv-1',
            options: {
                relevantMemoryLimit: 2,
                searchLimit: 2,
            },
        });

        expect(bundle.relevantMemories.map((memory: MemoryRow) => memory.id)).toEqual([41, 42]);
        expect(debugPayload.behaviorDiscovery).toEqual({
            enabled: false,
            domain: 'retrieval',
            state: 'disabled',
            liveEffectAllowed: false,
            observedSignals: expect.arrayContaining([
                'signal:preference_cue',
                'signal:follow_up_cue',
            ]),
            candidates: [],
            shadowComparison: null,
            guardrails: expect.arrayContaining([
                'behavior_discovery:shadow_safe_only',
                'behavior_discovery:no_live_effect',
                'behavior_discovery:active_policy_unchanged',
                'behavior_discovery:kill_switch_disabled',
            ]),
        });
        expect(debugPayload.retrievalControl).toMatchObject({
            behaviorDiscoveryState: 'disabled',
            behaviorDiscoveryLiveEffect: false,
        });
        expect(debugPayload.reasons).toEqual(expect.arrayContaining([
            'behavior_discovery:disabled',
        ]));
    });
});
