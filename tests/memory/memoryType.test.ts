import { MemoryRetrievalOrchestrator } from '../../src/memory/retrievalOrchestrator.js';
import { inferMemoryType, type MemoryRow } from '../../src/memory/types.js';

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

describe('memory type inference', () => {
    test('infers semantic for preference/profile oriented memories', () => {
        expect(inferMemoryType('Kullanıcı kahveyi çaya tercih ediyor', 'project', {
            source: 'conversation',
            conversationId: 'conv-1',
        })).toEqual({
            memoryType: 'semantic',
            reason: 'content:preference_or_profile_cue',
        });
    });

    test('infers episodic for follow-up and temporal memories', () => {
        expect(inferMemoryType('Bugün toplantıda API gecikmesini konuştuk, takip et', 'project', {
            source: 'conversation',
            conversationId: 'conv-9',
        })).toEqual({
            memoryType: 'episodic',
            reason: 'content:temporal_or_followup_cue',
        });
    });

    test('uses explicit metadata override when provided', () => {
        expect(inferMemoryType('Kullanıcı Python seviyor', 'preference', {
            source: 'conversation',
            conversationId: 'conv-1',
            memoryType: 'episodic',
        })).toEqual({
            memoryType: 'episodic',
            reason: 'explicit_metadata',
        });
    });

    test('falls back to semantic safely when cues are ambiguous', () => {
        expect(inferMemoryType('PenceAI repository üzerinde çalışılıyor', 'project', {
            source: 'system',
        })).toEqual({
            memoryType: 'semantic',
            reason: 'source:system',
        });
    });
});

describe('memory type aware retrieval weighting', () => {
    test('prefers episodic memories for follow-up oriented queries with soft weighting', async () => {
        let debugPayload: any = null;
        const episodic = createMemoryRow({
            id: 1,
            content: 'Dün ödeme hatasını konuştuk ve bugün tekrar kontrol edeceğiz',
            category: 'follow_up',
            memory_type: 'episodic',
            importance: 5,
            access_count: 0,
        });
        const semantic = createMemoryRow({
            id: 2,
            content: 'Kullanıcı ödeme sistemleri konusunda çalışıyor',
            category: 'profile',
            provenance_source: 'system',
            memory_type: 'semantic',
            importance: 5,
            access_count: 0,
        });

        const orchestrator = new MemoryRetrievalOrchestrator({
            graphAwareSearch: async () => ({ active: [semantic, episodic], archival: [] }),
            getRecentConversationSummaries: () => [],
            getMemoriesDueForReview: () => [],
            getFollowUpCandidates: () => [],
            getRecentMessages: () => [
                { role: 'user', content: 'Son durum ne, bu konuyu takip edelim', created_at: '2026-03-08T10:00:00.000Z', conversation_title: 'Test' },
            ],
            getUserMemories: () => [],
            prioritizeConversationMemories: (memories) => memories,
            recordDebug: (payload) => {
                debugPayload = payload;
            },
        });

        const bundle = await orchestrator.getPromptContextBundle({
            query: 'Son durum ne, bu konuyu takip edelim',
            activeConversationId: 'conv-1',
            options: {
                relevantMemoryLimit: 2,
                searchLimit: 2,
            },
        });

        expect(bundle.relevantMemories.map(memory => memory.id)).toEqual([1, 2]);
        expect(debugPayload.typePreference).toMatchObject({
            preferredType: 'episodic',
            reason: 'recent_event_followup',
            episodicWeight: 1.16,
            semanticWeight: 0.96,
        });
    });

    test('prefers semantic memories for preference or profile recall queries', async () => {
        let debugPayload: any = null;
        const episodic = createMemoryRow({
            id: 3,
            content: 'Geçen hafta editör temasını birlikte değiştirdik',
            category: 'follow_up',
            memory_type: 'episodic',
            importance: 5,
            access_count: 0,
        });
        const semantic = createMemoryRow({
            id: 4,
            content: 'Kullanıcı koyu tema tercih ediyor ve kısa yanıt seviyor',
            category: 'preference',
            provenance_source: 'system',
            provenance_conversation_id: null,
            memory_type: 'semantic',
            importance: 5,
            access_count: 0,
        });

        const orchestrator = new MemoryRetrievalOrchestrator({
            graphAwareSearch: async () => ({ active: [episodic, semantic], archival: [] }),
            getRecentConversationSummaries: () => [],
            getMemoriesDueForReview: () => [],
            getFollowUpCandidates: () => [],
            getRecentMessages: () => [],
            getUserMemories: () => [],
            prioritizeConversationMemories: (memories) => memories,
            recordDebug: (payload) => {
                debugPayload = payload;
            },
        });

        const bundle = await orchestrator.getPromptContextBundle({
            query: 'Tercihlerimi ve profilimi hatırla',
            activeConversationId: 'conv-1',
            options: {
                relevantMemoryLimit: 2,
                searchLimit: 2,
            },
        });

        expect(bundle.relevantMemories.map(memory => memory.id)).toEqual([4, 3]);
        expect(debugPayload.typePreference).toMatchObject({
            preferredType: 'semantic',
            reason: 'preference_profile_recall',
            semanticWeight: 1.16,
            episodicWeight: 0.96,
        });
    });

    test('keeps balanced behavior when there is no clear type signal', async () => {
        let debugPayload: any = null;
        const episodic = createMemoryRow({
            id: 5,
            content: 'Dün test koşusunu tamamladık',
            category: 'follow_up',
            memory_type: 'episodic',
            importance: 5,
            access_count: 0,
            updated_at: '2026-03-08T10:00:01.000Z',
        });
        const semantic = createMemoryRow({
            id: 6,
            content: 'PenceAI bir TypeScript kod tabanıdır',
            category: 'knowledge',
            memory_type: 'semantic',
            importance: 5,
            access_count: 0,
            updated_at: '2026-03-08T10:00:00.000Z',
        });

        const orchestrator = new MemoryRetrievalOrchestrator({
            graphAwareSearch: async () => ({ active: [semantic, episodic], archival: [] }),
            getRecentConversationSummaries: () => [],
            getMemoriesDueForReview: () => [],
            getFollowUpCandidates: () => [],
            getRecentMessages: () => [],
            getUserMemories: () => [],
            prioritizeConversationMemories: (memories) => memories,
            recordDebug: (payload) => {
                debugPayload = payload;
            },
        });

        const bundle = await orchestrator.getPromptContextBundle({
            query: 'PenceAI hakkında bilgi ver',
            activeConversationId: 'conv-neutral',
            options: {
                relevantMemoryLimit: 2,
                searchLimit: 2,
            },
        });

        expect(bundle.relevantMemories.map(memory => memory.id)).toEqual([6, 5]);
        expect(debugPayload.typePreference).toMatchObject({
            preferredType: 'balanced',
            reason: 'soft_default_balance',
            semanticWeight: 1,
            episodicWeight: 1,
        });
        expect(debugPayload.cognitiveLoad).toMatchObject({
            level: 'low',
            score: 0,
        });
        expect(debugPayload.budget.profile).toBe('supportive_expansion');
    });

    test('routes simple factual query through system1 fast path', async () => {
        let debugPayload: any = null;
        const semantic = createMemoryRow({
            id: 21,
            content: 'PenceAI TypeScript tabanlı bir projedir',
            category: 'knowledge',
            memory_type: 'semantic',
            updated_at: '2026-03-08T10:00:01.000Z',
        });
        const episodic = createMemoryRow({
            id: 22,
            content: 'Dün test koşusunu tamamladık',
            category: 'follow_up',
            memory_type: 'episodic',
            updated_at: '2026-03-08T10:00:00.000Z',
        });

        const orchestrator = new MemoryRetrievalOrchestrator({
            graphAwareSearch: async () => ({ active: [semantic, episodic], archival: [] }),
            getRecentConversationSummaries: () => [],
            getMemoriesDueForReview: () => [],
            getFollowUpCandidates: () => [],
            getRecentMessages: () => [],
            getUserMemories: () => [],
            prioritizeConversationMemories: (memories) => memories,
            recordDebug: (payload) => {
                debugPayload = payload;
            },
        });

        await orchestrator.getPromptContextBundle({
            query: 'PenceAI nedir?',
            activeConversationId: 'conv-fast',
            options: {
                relevantMemoryLimit: 2,
                searchLimit: 2,
            },
        });

        expect(debugPayload.dualProcess).toMatchObject({
            selectedMode: 'system1',
            routingReasons: expect.arrayContaining([
                'fast_path_low_load',
                'direct_question_low_ambiguity',
            ]),
            escalationTriggers: [],
            secondPassApplied: false,
            secondPassSummary: null,
            adjustedBudgetProfile: 'supportive_expansion',
        });
        expect(debugPayload.secondPass).toMatchObject({
            applied: false,
            mode: 'system1',
            coverageGaps: [],
            adjustments: expect.arrayContaining([
                expect.objectContaining({ lane: 'relevant', applied: false }),
                expect.objectContaining({ lane: 'supplemental', applied: false }),
            ]),
        });
        expect(debugPayload.reasons).toEqual(expect.arrayContaining([
            'dual_process:system1',
            'dual_process_reason:fast_path_low_load',
            'dual_process_reason:direct_question_low_ambiguity',
            'second_pass:bounded_to_existing_candidates',
        ]));
    });

    test('escalates ambiguous follow-up query through deliberate route', async () => {
        let debugPayload: any = null;
        const memories = [
            createMemoryRow({ id: 23, content: 'Dün deploy sonrası hata oranını kontrol ettik', category: 'follow_up', memory_type: 'episodic' }),
            createMemoryRow({ id: 24, content: 'Kullanıcı kısa özetleri tercih ediyor', category: 'preference', memory_type: 'semantic' }),
        ];

        const orchestrator = new MemoryRetrievalOrchestrator({
            graphAwareSearch: async () => ({ active: memories, archival: [] }),
            getRecentConversationSummaries: () => [],
            getMemoriesDueForReview: () => [],
            getFollowUpCandidates: () => [],
            getRecentMessages: () => [
                { role: 'user', content: 'Dün deploy sonrası hatayı konuşmuştuk', created_at: '2026-03-08T10:00:00.000Z', conversation_title: 'Test' },
            ],
            getUserMemories: () => [],
            prioritizeConversationMemories: (entries) => entries,
            recordDebug: (payload) => {
                debugPayload = payload;
            },
        });

        await orchestrator.getPromptContextBundle({
            query: 'Bunu neden böyle yaptık?',
            activeConversationId: 'conv-ambiguous',
            options: {
                relevantMemoryLimit: 2,
                searchLimit: 2,
            },
        });

        expect(debugPayload.dualProcess).toMatchObject({
            selectedMode: 'system2',
            routingReasons: expect.arrayContaining([
                'deliberate_route_escalated',
            ]),
            escalationTriggers: expect.arrayContaining([
                'follow_up_ambiguity',
            ]),
            secondPassApplied: true,
            secondPassSummary: 'deliberate_rerank_existing_budget',
            adjustedBudgetProfile: 'balanced_default',
            adjustedGraphDepth: 2,
        });
        expect(debugPayload.reasons).toEqual(expect.arrayContaining([
            'dual_process:system2',
            'dual_process_trigger:follow_up_ambiguity',
            'dual_process:second_pass_applied',
            'second_pass:bounded_to_existing_candidates',
        ]));
        expect(debugPayload.budget.profile).toBe('balanced_default');
    });
 
    test('narrows selection under high cognitive load while preserving soft ranking compatibility', async () => {
        let debugPayload: any = null;
        const memories = [
            createMemoryRow({ id: 31, content: 'Kullanıcı kısa ve maddeli özetleri tercih ediyor', category: 'preference', memory_type: 'semantic', importance: 10, access_count: 8, confidence: 0.98 }),
            createMemoryRow({ id: 32, content: 'Dün entegrasyon hatasını inceleyip geçici çözüm uyguladık', category: 'follow_up', memory_type: 'episodic', importance: 9, access_count: 5, confidence: 0.92 }),
            createMemoryRow({ id: 33, content: 'Kullanıcı backend gözlemleriyle karar vermeyi seviyor', category: 'profile', memory_type: 'semantic', importance: 8, access_count: 4, confidence: 0.94 }),
            createMemoryRow({ id: 34, content: 'Geçen hafta log seviyesini artırmıştık', category: 'follow_up', memory_type: 'episodic', importance: 6, access_count: 1, confidence: 0.72 }),
            createMemoryRow({ id: 35, content: 'Genel proje bilgisi', category: 'knowledge', memory_type: 'semantic', importance: 5, access_count: 0, confidence: 0.7 }),
        ];

        const orchestrator = new MemoryRetrievalOrchestrator({
            graphAwareSearch: async () => ({ active: memories, archival: [] }),
            getRecentConversationSummaries: () => [],
            getMemoriesDueForReview: () => [],
            getFollowUpCandidates: () => [],
            getRecentMessages: () => [
                { role: 'user', content: 'Bunu adım adım analiz etmiştik', created_at: '2026-03-08T10:00:00.000Z', conversation_title: 'Test' },
            ],
            getUserMemories: () => [],
            prioritizeConversationMemories: (entries) => entries,
            recordDebug: (payload) => {
                debugPayload = payload;
            },
        });

        const bundle = await orchestrator.getPromptContextBundle({
            query: 'Tercihlerimi hatırla, son durumu adım adım analiz et ve neden böyle olduğunu açıkla; ardından riskleri karşılaştır.',
            activeConversationId: 'conv-1',
            options: {
                relevantMemoryLimit: 5,
                searchLimit: 5,
                fallbackMemoryLimit: 4,
                reviewLimit: 4,
                followUpLimit: 3,
            },
        });

        expect(bundle.relevantMemories).toHaveLength(4);
        expect(debugPayload.cognitiveLoad).toMatchObject({
            level: 'high',
        });
        expect(debugPayload.budget.profile).toBe('focused_recall');
        expect(debugPayload.budget.applied).toMatchObject({
            relevantLimit: 4,
            archivalLimit: 4,
            supplementalLimit: 4,
            fallbackPoolSize: 5,
            reviewLimit: 3,
            followUpLimit: 2,
            candidateExpansionLimit: 4,
        });
        expect(debugPayload.budget.trimming.relevantTrimmed).toBe(1);
        expect(debugPayload.reasons).toEqual(expect.arrayContaining([
            'cognitive_load:high',
            'budget_profile:focused_recall',
            'load_signal:analytical_intent',
            'load_signal:multi_clause',
            'selection:focused_high_confidence',
            'trim:high_load_narrowing',
        ]));
    });

    test('allows wider supportive selection for exploratory or low-load queries', async () => {
        let debugPayload: any = null;
        const active = [
            createMemoryRow({ id: 41, content: 'Pizza hamurunda yüksek hidratasyon daha açık doku verir', category: 'knowledge', memory_type: 'semantic' }),
            createMemoryRow({ id: 42, content: 'Kullanıcı daha çıtır tarifleri seviyor', category: 'preference', memory_type: 'semantic', provenance_source: 'system', provenance_conversation_id: null }),
            createMemoryRow({ id: 43, content: 'Geçen sefer soğuk fermantasyon konuşmuştuk', category: 'follow_up', memory_type: 'episodic' }),
        ];

        const orchestrator = new MemoryRetrievalOrchestrator({
            graphAwareSearch: async () => ({ active, archival: [] }),
            getRecentConversationSummaries: () => [],
            getMemoriesDueForReview: () => [],
            getFollowUpCandidates: () => [],
            getRecentMessages: () => [],
            getUserMemories: () => [],
            prioritizeConversationMemories: (entries) => entries,
            recordDebug: (payload) => {
                debugPayload = payload;
            },
        });

        const bundle = await orchestrator.getPromptContextBundle({
            query: 'Pizza için farklı tarif fikirleri ve seçenekler öner',
            activeConversationId: 'conv-food',
            options: {
                relevantMemoryLimit: 2,
                searchLimit: 3,
            },
        });

        expect(bundle.relevantMemories).toHaveLength(3);
        expect(debugPayload.cognitiveLoad).toMatchObject({
            level: 'low',
            score: 0,
        });
        expect(debugPayload.budget.profile).toBe('balanced_default');
        expect(debugPayload.budget.applied.relevantLimit).toBe(3);
        expect(debugPayload.dualProcess).toMatchObject({
            selectedMode: 'system2',
            escalationTriggers: expect.arrayContaining([
                'exploratory_complexity',
            ]),
            secondPassApplied: true,
            secondPassSummary: 'deliberate_rerank_budget:supportive_expansion->balanced_default',
            adjustedBudgetProfile: 'balanced_default',
            adjustedGraphDepth: 2,
        });
        expect(debugPayload.reasons).toEqual(expect.arrayContaining([
            'cognitive_load:low',
            'budget_profile:balanced_default',
            'signal:exploratory_cue',
            'selection:allow_supporting_context',
            'selection:breadth_low_load',
            'selection:dual_process_deliberate_pass',
            'dual_process:system2',
            'dual_process_trigger:exploratory_complexity',
        ]));
    });

    test('keeps weighting soft so strong non-type signals can still win', async () => {
        let debugPayload: any = null;
        const episodic = createMemoryRow({
            id: 7,
            content: 'Dün çıkan hata için takip notu',
            category: 'follow_up',
            memory_type: 'episodic',
            importance: 2,
            access_count: 0,
            confidence: 0.55,
            review_profile: 'volatile',
            provenance_source: 'conversation',
            provenance_conversation_id: null,
        });
        const semantic = createMemoryRow({
            id: 8,
            content: 'Kullanıcı hata ayıklamada sistematik analiz tercih ediyor',
            category: 'profile',
            memory_type: 'semantic',
            importance: 10,
            access_count: 12,
            confidence: 0.98,
            review_profile: 'strict',
            provenance_source: 'conversation',
            provenance_conversation_id: 'conv-strong',
        });

        const orchestrator = new MemoryRetrievalOrchestrator({
            graphAwareSearch: async () => ({ active: [episodic, semantic], archival: [] }),
            getRecentConversationSummaries: () => [],
            getMemoriesDueForReview: () => [],
            getFollowUpCandidates: () => [],
            getRecentMessages: () => [
                { role: 'user', content: 'Bu işin son durumunu takip edelim', created_at: '2026-03-08T10:00:00.000Z', conversation_title: 'Test' },
            ],
            getUserMemories: () => [],
            prioritizeConversationMemories: (memories) => memories,
            recordDebug: (payload) => {
                debugPayload = payload;
            },
        });

        const bundle = await orchestrator.getPromptContextBundle({
            query: 'Bu işin son durumunu takip edelim',
            activeConversationId: 'conv-strong',
            options: {
                relevantMemoryLimit: 2,
                searchLimit: 2,
            },
        });

        expect(bundle.relevantMemories.map(memory => memory.id)).toEqual([8, 7]);
        expect(debugPayload.typePreference).toMatchObject({
            preferredType: 'episodic',
            reason: 'recent_event_followup',
        });
    });

    test('applies soft priming to lightly elevate entity/topic aligned memories', async () => {
        let debugPayload: any = null;
        const primedMemory = createMemoryRow({
            id: 9,
            content: 'PenceAI retrieval pipeline içinde priming katmanını hafifçe ısıtıyoruz',
            category: 'project',
            memory_type: 'semantic',
            importance: 4,
            access_count: 0,
            confidence: 0.8,
            provenance_source: 'system',
            provenance_conversation_id: null,
        });
        const baselineMemory = createMemoryRow({
            id: 11,
            content: 'Genel bakım notu ve nötr teknik bağlam',
            category: 'general',
            memory_type: 'semantic',
            importance: 4,
            access_count: 0,
            confidence: 0.8,
            provenance_source: 'system',
            provenance_conversation_id: null,
            updated_at: '2026-03-08T09:59:59.000Z',
        });

        const orchestrator = new MemoryRetrievalOrchestrator({
            graphAwareSearch: async () => ({ active: [baselineMemory, primedMemory], archival: [] }),
            getRecentConversationSummaries: () => [],
            getMemoriesDueForReview: () => [],
            getFollowUpCandidates: () => [],
            getRecentMessages: () => [],
            getUserMemories: () => [],
            prioritizeConversationMemories: (memories) => memories,
            recordDebug: (payload) => {
                debugPayload = payload;
            },
        });

        const bundle = await orchestrator.getPromptContextBundle({
            query: 'PenceAI priming davranışı hakkında kısa bilgi ver',
            activeConversationId: 'conv-primer',
            options: {
                relevantMemoryLimit: 2,
                searchLimit: 2,
            },
        });

        expect(bundle.relevantMemories.map(memory => memory.id)).toEqual([9, 11]);
        expect(debugPayload.primer).toMatchObject({
            triggered: true,
            entityHints: expect.arrayContaining(['penceai']),
            topicHints: expect.arrayContaining(['priming']),
        });
        expect(debugPayload.primer.bonusSummary.maxCandidateBonus).toBeLessThanOrEqual(0.22);
    });

    test('applies deterministic second-pass swap to restore preferred type coverage when bounded candidates allow it', async () => {
        let debugPayload: any = null;
        const semanticHigh = createMemoryRow({
            id: 201,
            content: 'Kullanıcının ürün kararlarında metrik odaklı düşündüğü bilgisi',
            category: 'profile',
            memory_type: 'semantic',
            importance: 10,
            access_count: 8,
            confidence: 0.98,
            provenance_conversation_id: 'conv-second-pass',
        });
        const semanticMid = createMemoryRow({
            id: 202,
            content: 'Kullanıcı kısa özetleri tercih ediyor',
            category: 'preference',
            memory_type: 'semantic',
            importance: 8,
            access_count: 4,
            confidence: 0.92,
            provenance_conversation_id: 'conv-second-pass',
            updated_at: '2026-03-08T10:00:01.000Z',
        });
        const episodicLower = createMemoryRow({
            id: 203,
            content: 'Dün dashboard alarmını birlikte kontrol ettik',
            category: 'follow_up',
            memory_type: 'episodic',
            importance: 4,
            access_count: 0,
            confidence: 0.74,
            provenance_conversation_id: 'conv-second-pass',
            updated_at: '2026-03-08T10:00:02.000Z',
        });

        const orchestrator = new MemoryRetrievalOrchestrator({
            graphAwareSearch: async () => ({ active: [semanticHigh, semanticMid, episodicLower], archival: [] }),
            getRecentConversationSummaries: () => [],
            getMemoriesDueForReview: () => [],
            getFollowUpCandidates: () => [],
            getRecentMessages: () => [
                { role: 'user', content: 'Bu işi dün konuşmuştuk', created_at: '2026-03-08T10:00:00.000Z', conversation_title: 'Test' },
            ],
            getUserMemories: () => [],
            prioritizeConversationMemories: (memories) => memories,
            recordDebug: (payload) => {
                debugPayload = payload;
            },
        });

        const bundle = await orchestrator.getPromptContextBundle({
            query: 'Son durumu kısaca analiz et ve sadece ilgili şeyleri hatırla',
            activeConversationId: 'conv-second-pass',
            options: {
                relevantMemoryLimit: 2,
                searchLimit: 3,
            },
        });

        expect(bundle.relevantMemories.map(memory => memory.id)).toEqual([201, 203]);
        expect(debugPayload.secondPass).toMatchObject({
            applied: false,
            mode: 'system2',
            coverageGaps: [],
            guardrailSummary: expect.arrayContaining([
                'second_pass:bounded_to_existing_candidates',
                'second_pass:selection_limit_preserved:2',
            ]),
            adjustments: expect.arrayContaining([
                expect.objectContaining({
                    lane: 'relevant',
                    applied: false,
                    reason: null,
                    removedId: null,
                    addedId: null,
                    preservedIds: [201, 203],
                }),
            ]),
        });
        expect(debugPayload.explanations.relevant).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 201, reasons: expect.arrayContaining(['conversation_scoped']) }),
            expect.objectContaining({ id: 203, reasons: expect.arrayContaining(['conversation_scoped', 'type_aligned:episodic']) }),
        ]));
        expect(debugPayload.reasons).toEqual(expect.arrayContaining([
            'load_signal:follow_up',
            'load_signal:analytical_intent',
        ]));
    });

    test('preserves default balanced behavior when primer is not triggered', async () => {
        let debugPayload: any = null;
        const newer = createMemoryRow({
            id: 12,
            content: 'Nötr mühendislik notu',
            category: 'general',
            memory_type: 'semantic',
            provenance_source: 'system',
            provenance_conversation_id: null,
            updated_at: '2026-03-08T10:00:02.000Z',
        });
        const older = createMemoryRow({
            id: 13,
            content: 'Başka bir nötr not',
            category: 'general',
            memory_type: 'semantic',
            provenance_source: 'system',
            provenance_conversation_id: null,
            updated_at: '2026-03-08T10:00:01.000Z',
        });

        const orchestrator = new MemoryRetrievalOrchestrator({
            graphAwareSearch: async () => ({ active: [older, newer], archival: [] }),
            getRecentConversationSummaries: () => [],
            getMemoriesDueForReview: () => [],
            getFollowUpCandidates: () => [],
            getRecentMessages: () => [],
            getUserMemories: () => [],
            prioritizeConversationMemories: (memories) => memories,
            recordDebug: (payload) => {
                debugPayload = payload;
            },
        });

        const bundle = await orchestrator.getPromptContextBundle({
            query: 'selam',
            activeConversationId: 'conv-neutral-primer',
            options: {
                relevantMemoryLimit: 2,
                searchLimit: 2,
            },
        });

        expect(bundle.relevantMemories.map(memory => memory.id)).toEqual([12, 13]);
        expect(debugPayload.typePreference).toMatchObject({
            preferredType: 'balanced',
            reason: 'soft_default_balance',
        });
        expect(debugPayload.primer).toMatchObject({
            triggered: false,
            entityHints: [],
            topicHints: [],
            typeHints: [],
        });
        expect(debugPayload.reasons).toContain('primer:triggered:no');
    });

    test('keeps priming soft so stronger baseline scores are not overturned', async () => {
        let debugPayload: any = null;
        const primedButWeak = createMemoryRow({
            id: 14,
            content: 'PenceAI priming notu',
            category: 'project',
            memory_type: 'semantic',
            importance: 1,
            access_count: 0,
            confidence: 0.45,
            review_profile: 'volatile',
            provenance_source: 'system',
            provenance_conversation_id: null,
        });
        const strongerBase = createMemoryRow({
            id: 15,
            content: 'Genel retrieval mimarisi notu',
            category: 'knowledge',
            memory_type: 'semantic',
            importance: 10,
            access_count: 10,
            confidence: 0.98,
            review_profile: 'strict',
            provenance_source: 'conversation',
            provenance_conversation_id: 'conv-soft-primer',
        });

        const orchestrator = new MemoryRetrievalOrchestrator({
            graphAwareSearch: async () => ({ active: [primedButWeak, strongerBase], archival: [] }),
            getRecentConversationSummaries: () => [],
            getMemoriesDueForReview: () => [],
            getFollowUpCandidates: () => [],
            getRecentMessages: () => [],
            getUserMemories: () => [],
            prioritizeConversationMemories: (memories) => memories,
            recordDebug: (payload) => {
                debugPayload = payload;
            },
        });

        const bundle = await orchestrator.getPromptContextBundle({
            query: 'PenceAI priming durumunu özetle',
            activeConversationId: 'conv-soft-primer',
            options: {
                relevantMemoryLimit: 2,
                searchLimit: 2,
            },
        });

        expect(bundle.relevantMemories.map(memory => memory.id)).toEqual([15, 14]);
        expect(debugPayload.primer.triggered).toBe(true);
        expect(debugPayload.primer.bonusSummary.maxCandidateBonus).toBeLessThan(0.25);
    });

    test('gives a related neighbor a small spreading activation advantage without boosting unrelated memories', async () => {
        let debugPayload: any = null;
        const seed = createMemoryRow({
            id: 101,
            content: 'PenceAI retrieval çekirdeği',
            category: 'project',
            memory_type: 'semantic',
            importance: 8,
            confidence: 0.95,
            provenance_source: 'conversation',
            provenance_conversation_id: 'conv-graph',
        });
        const activatedNeighbor = createMemoryRow({
            id: 102,
            content: 'Graph komşu hafıza',
            category: 'knowledge',
            memory_type: 'semantic',
            importance: 5,
            confidence: 0.8,
            provenance_source: 'system',
            provenance_conversation_id: null,
            updated_at: '2026-03-08T10:00:01.000Z',
        });
        const unrelated = createMemoryRow({
            id: 103,
            content: 'İlgisiz bakım kaydı',
            category: 'general',
            memory_type: 'semantic',
            importance: 5,
            confidence: 0.8,
            provenance_source: 'system',
            provenance_conversation_id: null,
            updated_at: '2026-03-08T10:00:02.000Z',
        });

        const orchestrator = new MemoryRetrievalOrchestrator({
            graphAwareSearch: async () => ({ active: [seed, unrelated, activatedNeighbor], archival: [] }),
            getRecentConversationSummaries: () => [],
            getMemoriesDueForReview: () => [],
            getFollowUpCandidates: () => [],
            getRecentMessages: () => [],
            getUserMemories: () => [],
            getMemoryNeighborsBatch: () => new Map([
                [101, [{ ...activatedNeighbor, relation_type: 'related_to', relation_confidence: 0.9, relation_description: 'Aynı retrieval konusu' }]],
                [103, []],
            ]),
            prioritizeConversationMemories: (memories) => memories,
            recordDebug: (payload) => {
                debugPayload = payload;
            },
        });

        const bundle = await orchestrator.getPromptContextBundle({
            query: 'selam',
            activeConversationId: 'conv-graph',
            options: {
                relevantMemoryLimit: 3,
                searchLimit: 3,
            },
        });

        expect(bundle.relevantMemories.map(memory => memory.id)).toEqual([101, 103, 102]);
        expect(debugPayload.spreadingActivation).toMatchObject({
            rolloutState: 'shadow',
            shadowMode: true,
            appliedToRanking: false,
            activatedCandidateCount: 1,
            activatedCandidates: [
                expect.objectContaining({
                    id: 102,
                    strongestSeedId: 101,
                    relationType: 'related_to',
                    candidateConfidence: 0.8,
                    capped: false,
                }),
            ],
            guardrails: expect.objectContaining({
                seedLimitTriggered: true,
                maxCandidateLimitTriggered: false,
                candidateBonusCapTriggered: false,
            }),
            bonusSummary: expect.objectContaining({
                maxCandidateBonus: 0.05,
                minEffectiveBonus: 0.025,
            }),
        });
        expect(debugPayload.spreadingActivation.activatedCandidates).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 103 }),
        ]));
    });

    test('keeps spreading activation bonus soft so stronger baseline ordering still holds', async () => {
        let debugPayload: any = null;
        const seed = createMemoryRow({
            id: 111,
            content: 'Retrieval seed memory',
            category: 'project',
            memory_type: 'semantic',
            importance: 10,
            access_count: 3,
            confidence: 0.98,
            provenance_source: 'conversation',
            provenance_conversation_id: 'conv-shadow-soft',
        });
        const strongBaseline = createMemoryRow({
            id: 112,
            content: 'Daha güçlü bağımsız aday',
            category: 'knowledge',
            memory_type: 'semantic',
            importance: 8,
            access_count: 8,
            confidence: 0.96,
            review_profile: 'strict',
            provenance_source: 'conversation',
            provenance_conversation_id: 'conv-shadow-soft',
            updated_at: '2026-03-08T10:00:02.000Z',
        });
        const weakNeighbor = createMemoryRow({
            id: 113,
            content: 'Seed ile ilişkili ama daha zayıf komşu',
            category: 'knowledge',
            memory_type: 'semantic',
            importance: 4,
            access_count: 0,
            confidence: 0.76,
            provenance_source: 'system',
            provenance_conversation_id: null,
            updated_at: '2026-03-08T10:00:01.000Z',
        });

        const orchestrator = new MemoryRetrievalOrchestrator({
            graphAwareSearch: async () => ({ active: [seed, strongBaseline, weakNeighbor], archival: [] }),
            getRecentConversationSummaries: () => [],
            getMemoriesDueForReview: () => [],
            getFollowUpCandidates: () => [],
            getRecentMessages: () => [],
            getUserMemories: () => [],
            getMemoryNeighborsBatch: () => new Map([
                [111, [{ ...weakNeighbor, relation_type: 'supports', relation_confidence: 0.95, relation_description: 'Destekleyici edge' }]],
                [112, []],
            ]),
            prioritizeConversationMemories: (memories) => memories,
            recordDebug: (payload) => {
                debugPayload = payload;
            },
        });

        const bundle = await orchestrator.getPromptContextBundle({
            query: 'selam',
            activeConversationId: 'conv-shadow-soft',
            options: {
                relevantMemoryLimit: 3,
                searchLimit: 3,
            },
        });

        expect(bundle.relevantMemories.map(memory => memory.id)).toEqual([112, 111, 113]);
        expect(debugPayload.spreadingActivation.activatedCandidates).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 113,
                strongestSeedId: 111,
                relationType: 'supports',
                capped: false,
            }),
        ]));
        expect(debugPayload.spreadingActivation.bonusSummary.maxCandidateBonus).toBeLessThanOrEqual(0.05);
        expect(debugPayload.spreadingActivation.bonusSummary.strongestBonus).toBeLessThanOrEqual(0.05);
        expect(debugPayload.spreadingActivation.appliedToRanking).toBe(false);
    });

    test('skips low-quality seeds and weak neighbors under rollout guardrails', async () => {
        let debugPayload: any = null;
        const weakSeed = createMemoryRow({
            id: 121,
            content: 'Düşük güvenli seed',
            category: 'project',
            memory_type: 'semantic',
            importance: 2,
            access_count: 0,
            confidence: 0.45,
            provenance_source: 'conversation',
            provenance_conversation_id: 'conv-guardrail',
        });
        const strongBase = createMemoryRow({
            id: 122,
            content: 'Daha güçlü temel aday',
            category: 'knowledge',
            memory_type: 'semantic',
            importance: 8,
            access_count: 3,
            confidence: 0.94,
            provenance_source: 'conversation',
            provenance_conversation_id: 'conv-guardrail',
            updated_at: '2026-03-08T10:00:02.000Z',
        });
        const weakNeighbor = createMemoryRow({
            id: 123,
            content: 'Zayıf komşu',
            category: 'knowledge',
            memory_type: 'semantic',
            importance: 4,
            access_count: 0,
            confidence: 0.4,
            provenance_source: 'system',
            provenance_conversation_id: null,
            updated_at: '2026-03-08T10:00:01.000Z',
        });

        const orchestrator = new MemoryRetrievalOrchestrator({
            graphAwareSearch: async () => ({ active: [weakSeed, strongBase, weakNeighbor], archival: [] }),
            getRecentConversationSummaries: () => [],
            getMemoriesDueForReview: () => [],
            getFollowUpCandidates: () => [],
            getRecentMessages: () => [],
            getUserMemories: () => [],
            getMemoryNeighborsBatch: () => new Map([
                [122, [{ ...weakNeighbor, relation_type: 'related_to', relation_confidence: 0.4, relation_description: 'Zayıf edge' }]],
            ]),
            prioritizeConversationMemories: (memories) => memories,
            recordDebug: (payload) => {
                debugPayload = payload;
            },
        });

        const bundle = await orchestrator.getPromptContextBundle({
            query: 'selam',
            activeConversationId: 'conv-guardrail',
            options: {
                relevantMemoryLimit: 3,
                searchLimit: 3,
            },
        });

        expect(bundle.relevantMemories.map(memory => memory.id)).toEqual([122, 121, 123]);
        expect(debugPayload.spreadingActivation.activatedCandidates).toEqual([]);
        expect(debugPayload.spreadingActivation.guardrails).toMatchObject({
            relationFloorSkips: 1,
            seedQualitySkips: 2,
            candidateQualitySkips: 0,
            minBonusSkips: 0,
        });
        expect(debugPayload.spreadingActivation.skips.seeds).toEqual(expect.arrayContaining([
            expect.objectContaining({
                reason: 'seed_confidence_below_floor',
                count: 2,
                sampleIds: [121, 123],
            }),
        ]));
        expect(debugPayload.spreadingActivation.skips.neighbors).toEqual(expect.arrayContaining([
            expect.objectContaining({
                reason: 'relation_confidence_below_floor',
                count: 1,
                sampleIds: [123],
            }),
        ]));
    });

    test('soft rollout applies bounded activation impact with cap and truncation guardrails', async () => {
        let debugPayload: any = null;
        const seedOne = createMemoryRow({
            id: 131,
            content: 'Birinci güçlü seed',
            category: 'project',
            memory_type: 'semantic',
            importance: 10,
            access_count: 4,
            confidence: 0.97,
            provenance_source: 'conversation',
            provenance_conversation_id: 'conv-soft-rollout',
            updated_at: '2026-03-08T10:00:05.000Z',
        });
        const seedTwo = createMemoryRow({
            id: 132,
            content: 'İkinci güçlü seed',
            category: 'project',
            memory_type: 'semantic',
            importance: 9,
            access_count: 4,
            confidence: 0.96,
            provenance_source: 'conversation',
            provenance_conversation_id: 'conv-soft-rollout',
            updated_at: '2026-03-08T10:00:04.000Z',
        });
        const promotedNeighbor = createMemoryRow({
            id: 133,
            content: 'İki seed ile bağlı aday',
            category: 'knowledge',
            memory_type: 'semantic',
            importance: 9,
            access_count: 4,
            confidence: 0.94,
            provenance_source: 'system',
            provenance_conversation_id: null,
            updated_at: '2026-03-08T10:00:03.000Z',
        });
        const truncatedNeighbor = createMemoryRow({
            id: 134,
            content: 'Truncate olacak aday',
            category: 'knowledge',
            memory_type: 'semantic',
            importance: 8,
            access_count: 3,
            confidence: 0.9,
            provenance_source: 'system',
            provenance_conversation_id: null,
            updated_at: '2026-03-08T10:00:02.000Z',
        });
        const anotherActivated = createMemoryRow({
            id: 135,
            content: 'Diğer activated aday',
            category: 'knowledge',
            memory_type: 'semantic',
            importance: 7,
            access_count: 2,
            confidence: 0.89,
            provenance_source: 'system',
            provenance_conversation_id: null,
            updated_at: '2026-03-08T10:00:01.000Z',
        });
        const baselineLeader = createMemoryRow({
            id: 136,
            content: 'Baz skor lideri',
            category: 'knowledge',
            memory_type: 'semantic',
            importance: 10,
            access_count: 10,
            confidence: 0.98,
            review_profile: 'strict',
            provenance_source: 'conversation',
            provenance_conversation_id: 'conv-soft-rollout',
            updated_at: '2026-03-08T10:00:06.000Z',
        });

        const orchestrator = new MemoryRetrievalOrchestrator({
            graphAwareSearch: async () => ({ active: [seedOne, seedTwo, promotedNeighbor, truncatedNeighbor, anotherActivated, baselineLeader], archival: [] }),
            getRecentConversationSummaries: () => [],
            getMemoriesDueForReview: () => [],
            getFollowUpCandidates: () => [],
            getRecentMessages: () => [],
            getUserMemories: () => [],
            getSpreadingActivationConfig: () => ({ rolloutState: 'soft', seedLimit: 3, maxCandidates: 2 }),
            getMemoryNeighborsBatch: () => new Map([
                [131, [
                    { ...promotedNeighbor, relation_type: 'related_to', relation_confidence: 0.98, relation_description: 'Ana edge 1' },
                    { ...truncatedNeighbor, relation_type: 'related_to', relation_confidence: 0.95, relation_description: 'Truncate edge 1' },
                    { ...anotherActivated, relation_type: 'supports', relation_confidence: 0.9, relation_description: 'Destek edge 1' },
                ]],
                [132, [
                    { ...promotedNeighbor, relation_type: 'related_to', relation_confidence: 0.98, relation_description: 'Ana edge 2' },
                    { ...truncatedNeighbor, relation_type: 'supports', relation_confidence: 0.95, relation_description: 'Truncate edge 2' },
                    { ...anotherActivated, relation_type: 'supports', relation_confidence: 0.9, relation_description: 'Destek edge 2' },
                ]],
            ]),
            prioritizeConversationMemories: (memories) => memories,
            recordDebug: (payload) => {
                debugPayload = payload;
            },
        });

        const bundle = await orchestrator.getPromptContextBundle({
            query: 'selam',
            activeConversationId: 'conv-soft-rollout',
            options: {
                relevantMemoryLimit: 6,
                searchLimit: 6,
            },
        });

        expect(debugPayload.spreadingActivation).toMatchObject({
            rolloutState: 'soft',
            shadowMode: false,
            appliedToRanking: true,
            activatedCandidateCount: 3,
            guardrails: expect.objectContaining({
                seedLimitTriggered: true,
                maxCandidateLimitTriggered: true,
                candidateBonusCapTriggered: true,
            }),
        });
        expect(debugPayload.spreadingActivation.activatedCandidates).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 133 }),
            expect.objectContaining({ id: 134 }),
        ]));
        expect(debugPayload.spreadingActivation.skips.neighbors).toEqual(expect.arrayContaining([
            expect.objectContaining({
                reason: 'activated_candidate_truncated',
                count: 1,
                sampleIds: [135],
            }),
        ]));
        expect(debugPayload.spreadingActivation.bonusSummary).toMatchObject({
            maxCandidateBonus: 0.05,
            strongestBonus: 0.05,
        });
        expect(bundle.relevantMemories.slice(0, 2).map(memory => memory.id)).toEqual([136, 131]);
    });

    test('keeps backward compatibility when memory type is missing', async () => {
        const legacyMemory = createMemoryRow({
            id: 10,
            content: 'Legacy memory without explicit type',
            category: 'general',
            memory_type: null,
        });

        const orchestrator = new MemoryRetrievalOrchestrator({
            graphAwareSearch: async () => ({ active: [legacyMemory], archival: [] }),
            getRecentConversationSummaries: () => [],
            getMemoriesDueForReview: () => [],
            getFollowUpCandidates: () => [],
            getRecentMessages: () => [],
            getUserMemories: () => [],
            prioritizeConversationMemories: (memories) => memories,
            recordDebug: () => {},
        });

        const bundle = await orchestrator.getPromptContextBundle({
            query: 'Bu konu hakkında bilgi ver',
            activeConversationId: 'conv-legacy',
            options: {
                relevantMemoryLimit: 1,
                searchLimit: 1,
            },
        });

        expect(bundle.relevantMemories).toHaveLength(1);
        expect(bundle.relevantMemories[0]?.id).toBe(10);
    });
});
