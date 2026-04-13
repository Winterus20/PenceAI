import {
    rrfFusion,
    applyRetentionToRrf,
    deriveMemoryWriteMetadata,
    computeReviewPriority,
    selectConversationAwareSupplementalMemories,
    buildConversationTranscript,
} from '../../src/memory/contextUtils.js';
import type { MemoryRow, MemoryWriteMetadata } from '../../src/memory/types.js';

function makeMemoryRow(overrides: Partial<MemoryRow> = {}): MemoryRow {
    return {
        id: overrides.id ?? 1,
        user_id: 'test-user',
        category: overrides.category ?? 'general',
        content: overrides.content ?? 'test content',
        importance: overrides.importance ?? 5,
        access_count: overrides.access_count ?? 0,
        is_archived: overrides.is_archived ?? 0,
        last_accessed: overrides.last_accessed ?? new Date().toISOString(),
        created_at: overrides.created_at ?? new Date().toISOString(),
        updated_at: overrides.updated_at ?? new Date().toISOString(),
        provenance_source: overrides.provenance_source ?? null,
        provenance_conversation_id: overrides.provenance_conversation_id ?? null,
        provenance_message_id: overrides.provenance_message_id ?? null,
        confidence: overrides.confidence ?? 0.7,
        review_profile: overrides.review_profile ?? null,
        memory_type: overrides.memory_type ?? 'semantic',
        stability: overrides.stability ?? null,
        retrievability: overrides.retrievability ?? null,
        next_review_at: overrides.next_review_at ?? null,
        review_count: overrides.review_count ?? null,
        max_importance: overrides.max_importance ?? null,
    };
}

describe('rrfFusion', () => {
    const items = [
        { id: 1, name: 'alpha' },
        { id: 2, name: 'beta' },
        { id: 3, name: 'gamma' },
    ];

    test('should fuse FTS and semantic results with RRF scoring', () => {
        const result = rrfFusion(
            [items[0], items[1]],
            [items[1], items[2]],
            item => item.id,
            item => item,
            3,
        );
        expect(result.results.length).toBe(3);
        // Item 2 appears at rank 1 in semantic and rank 1 in FTS = highest combined
        // Item 1 appears at rank 0 in FTS only
        // RRF: item2 = 1/61 + 1/62, item1 = 1.5/61
        expect(result.results[0].id).toBe(2);
    });

    test('should handle empty FTS results', () => {
        const result = rrfFusion(
            [],
            [items[0], items[1]],
            item => item.id,
            item => item,
            2,
        );
        expect(result.results.length).toBe(2);
        expect(result.results[0].id).toBe(1);
    });

    test('should handle empty semantic results', () => {
        const result = rrfFusion(
            [items[0], items[1]],
            [],
            item => item.id,
            item => item,
            2,
        );
        expect(result.results.length).toBe(2);
    });

    test('should respect limit parameter', () => {
        const result = rrfFusion(
            [items[0], items[1], items[2]],
            [],
            item => item.id,
            item => item,
            1,
        );
        expect(result.results.length).toBe(1);
    });

    test('should apply FTS weight correctly', () => {
        const result = rrfFusion(
            [items[0]],
            [items[0]],
            item => item.id,
            item => item,
            1,
            60,
            2.0, // higher FTS weight
        );
        expect(result.scoreEntries[0].score).toBeGreaterThan(1 / 61); // FTS contribution alone
    });

    test('should include explain data', () => {
        const result = rrfFusion(
            [items[0]],
            [items[1]],
            item => item.id,
            item => item,
            2,
        );
        expect(result.explain).toBeDefined();
        expect(result.explain!.length).toBe(2);
        expect(result.explain![0].sources).toContain('fts');
    });

    test('should track both fts and semantic sources in explain', () => {
        const result = rrfFusion(
            [items[0]],
            [items[0]],
            item => item.id,
            item => item,
            1,
        );
        expect(result.explain![0].sources).toContain('fts');
        expect(result.explain![0].sources).toContain('semantic');
    });
});

describe('applyRetentionToRrf', () => {
    test('should apply retention weight to entries', () => {
        const now = new Date();
        const fresh = makeMemoryRow({ id: 1, last_accessed: now.toISOString(), stability: 10 });
        const stale = makeMemoryRow({ id: 2, last_accessed: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(), stability: 5 });

        const entries = [
            { score: 0.1, item: fresh },
            { score: 0.2, item: stale },
        ];

        const results = applyRetentionToRrf(entries, 2);
        expect(results.length).toBe(2);
        // Fresh memory should retain more of its score relative to stale
    });

    test('should respect limit', () => {
        const now = new Date();
        const entries = [
            { score: 0.1, item: makeMemoryRow({ id: 1, last_accessed: now.toISOString() }) },
            { score: 0.2, item: makeMemoryRow({ id: 2, last_accessed: now.toISOString() }) },
        ];
        const results = applyRetentionToRrf(entries, 1);
        expect(results.length).toBe(1);
    });
});

describe('deriveMemoryWriteMetadata', () => {
    test('should normalize category from alias', () => {
        const result = deriveMemoryWriteMetadata('fact');
        expect(result.source).toBeDefined();
    });

    test('should clamp confidence within bounds', () => {
        const result = deriveMemoryWriteMetadata('general', { confidence: 0.99 });
        expect(result.confidence).toBeLessThanOrEqual(0.98);
    });

    test('should use conversation source when conversationId provided', () => {
        const result = deriveMemoryWriteMetadata('general', { conversationId: 'conv-1' });
        expect(result.source).toBe('conversation');
    });

    test('should use system source when no conversationId', () => {
        const result = deriveMemoryWriteMetadata('general');
        expect(result.source).toBe('system');
    });

    test('should assign review profile based on category', () => {
        const result = deriveMemoryWriteMetadata('preference');
        expect(result.reviewProfile).toBe('strict');
    });

    test('should handle null category', () => {
        const result = deriveMemoryWriteMetadata(null as any);
        expect(result.reviewProfile).toBeDefined();
    });

    test('should preserve metadata fields', () => {
        const meta: MemoryWriteMetadata = {
            conversationId: 'conv-1',
            messageId: 42,
            rolloutState: 'shadow',
            writeTraceId: 'trace-123',
        };
        const result = deriveMemoryWriteMetadata('general', meta);
        expect(result.conversationId).toBe('conv-1');
        expect(result.messageId).toBe(42);
        expect(result.rolloutState).toBe('shadow');
        expect(result.writeTraceId).toBe('trace-123');
    });
});

describe('computeReviewPriority', () => {
    test('should return near-zero for memory not due for review', () => {
        const futureReview = Math.floor(Date.now() / 1000) + 3600; // 1 hour in future
        const memory = makeMemoryRow({ next_review_at: futureReview, confidence: 0.98, retrievability: 1.0 });
        const now = Math.floor(Date.now() / 1000);
        const priority = computeReviewPriority(memory, now);
        // With retrievability=1.0 and confidence=0.98 (not clamped), penalties are minimal
        expect(priority).toBeLessThan(0.1);
    });

    test('should return positive value for overdue memory', () => {
        const pastReview = Math.floor(Date.now() / 1000) - 7200; // 2 hours ago
        const memory = makeMemoryRow({ next_review_at: pastReview, confidence: 0.5, retrievability: 0.5 });
        const priority = computeReviewPriority(memory, Math.floor(Date.now() / 1000));
        expect(priority).toBeGreaterThan(0);
    });

    test('should penalize low confidence', () => {
        const now = Math.floor(Date.now() / 1000);
        const memory1 = makeMemoryRow({ next_review_at: now, confidence: 0.2, retrievability: 1.0 });
        const memory2 = makeMemoryRow({ next_review_at: now, confidence: 0.9, retrievability: 1.0 });
        expect(computeReviewPriority(memory1, now)).toBeGreaterThan(computeReviewPriority(memory2, now));
    });
});

describe('selectConversationAwareSupplementalMemories', () => {
    const recentMessages = [{ role: 'user', content: 'project deadline tomorrow', created_at: '', conversation_title: '' }];
    const relevantMemories: MemoryRow[] = [];

    test('should return empty when limit is 0', () => {
        const result = selectConversationAwareSupplementalMemories({
            query: 'test',
            activeConversationId: 'conv-1',
            recentMessages,
            relevantMemories,
            fallbackMemories: [makeMemoryRow({ id: 1 })],
            limit: 0,
        });
        expect(result).toEqual([]);
    });

    test('should exclude already relevant memories', () => {
        const existing = makeMemoryRow({ id: 1, content: 'existing memory' });
        relevantMemories.push(existing);
        const result = selectConversationAwareSupplementalMemories({
            query: 'test',
            activeConversationId: 'conv-1',
            recentMessages,
            relevantMemories,
            fallbackMemories: [existing, makeMemoryRow({ id: 2, content: 'new memory' })],
            limit: 5,
        });
        expect(result.some(m => m.id === 1)).toBe(false);
    });

    test('should prefer conversation-affine memories', () => {
        const convMemory = makeMemoryRow({
            id: 1,
            content: 'project deadline important',
            provenance_conversation_id: 'conv-1',
            provenance_source: 'conversation',
        });
        const otherMemory = makeMemoryRow({ id: 2, content: 'random unrelated fact' });

        const result = selectConversationAwareSupplementalMemories({
            query: 'project',
            activeConversationId: 'conv-1',
            recentMessages,
            relevantMemories: [],
            fallbackMemories: [otherMemory, convMemory],
            limit: 1,
        });
        expect(result[0].id).toBe(1);
    });
});

describe('buildConversationTranscript', () => {
    test('should format user and assistant messages', () => {
        const history = [
            { role: 'user' as const, content: 'hello', conversation_id: 'c1', created_at: '' },
            { role: 'assistant' as const, content: 'hi there', conversation_id: 'c1', created_at: '' },
        ];
        const result = buildConversationTranscript(history, 'Alice');
        expect(result.conversationText).toContain('Kullanıcı: hello');
        expect(result.conversationText).toContain('Asistan: hi there');
    });

    test('should filter out non-user/assistant roles', () => {
        const history = [
            { role: 'system' as const, content: 'system msg', conversation_id: 'c1', created_at: '' },
            { role: 'user' as const, content: 'hello', conversation_id: 'c1', created_at: '' },
        ];
        const result = buildConversationTranscript(history, 'Alice');
        expect(result.conversationText).not.toContain('system msg');
    });

    test('should use default user name when not provided', () => {
        const result = buildConversationTranscript([], undefined);
        expect(result.userName).toBeDefined();
        expect(result.userName.length).toBeGreaterThan(0);
    });

    test('should return original history', () => {
        const history = [
            { role: 'user' as const, content: 'test', conversation_id: 'c1', created_at: '' },
        ];
        const result = buildConversationTranscript(history, 'Bob');
        expect(result.history).toBe(history);
    });
});
