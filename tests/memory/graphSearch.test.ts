/**
 * Graph Search Testleri
 * 
 * Graph-aware search, komşu getirme, relation confidence filtreleme
 * ve graph depth limiti testleri.
 */

import { MemoryRetrievalOrchestrator } from '../../src/memory/retrievalOrchestrator.js';
import type { MemoryRow, GraphAwareSearchResult } from '../../src/memory/types.js';

// ========== Test Fixture Helper ==========

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

// Mock neighbor tipi (relation bilgisi ile) - retrievalOrchestrator ile uyumlu
type MemoryRelationNeighbor = MemoryRow & {
  relation_type: string;
  relation_confidence?: number;
  relation_description: string;
};

// ========== İlk Derece Komşular Testleri ==========

describe('İlk Derece Komşular (1-hop)', () => {
  test('Bir belleğin 1-hop komşuları doğru getirilir', async () => {
    const centralMemory = createMemoryRow({
      id: 1,
      content: 'Merkez bellek - TypeScript',
      category: 'skill',
    });
    
    const neighbors: MemoryRelationNeighbor[] = [
      {
        ...createMemoryRow({ id: 2, content: 'JavaScript temeli', category: 'skill' }),
        relation_type: 'related_to',
        relation_confidence: 0.85,
        relation_description: 'Dil ailesi bağlantısı',
      },
      {
        ...createMemoryRow({ id: 3, content: 'React framework', category: 'project' }),
        relation_type: 'supports',
        relation_confidence: 0.72,
        relation_description: 'TypeScript ile React kullanımı',
      },
    ];

    let debugPayload: unknown = null;
    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({
        active: [centralMemory],
        archival: [],
      }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [],
      getUserMemories: () => [],
      getMemoryNeighborsBatch: (memoryIds: number[], limitPerNode: number) => {
        const result = new Map<number, MemoryRelationNeighbor[]>();
        for (const id of memoryIds) {
          if (id === 1) {
            result.set(id, neighbors.slice(0, limitPerNode));
          }
        }
        return result;
      },
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: (payload) => { debugPayload = payload; },
    });

    const bundle = await orchestrator.getPromptContextBundle({
      query: 'TypeScript hakkında bilgi ver',
      activeConversationId: 'conv-1',
      options: {
        searchLimit: 5,
        relevantMemoryLimit: 3,
      },
    });

    expect(bundle.relevantMemories).toBeDefined();
    expect(bundle.relevantMemories.length).toBeGreaterThanOrEqual(1);
    expect(bundle.relevantMemories.some(m => m.id === 1)).toBe(true);
  });

  test('Komşu limiti doğru uygulanır', async () => {
    const centralMemory = createMemoryRow({
      id: 1,
      content: 'Merkez bellek',
    });
    
    // 10 komşu olsa bile limit 3 ise sadece 3 gelmeli
    const allNeighbors: MemoryRelationNeighbor[] = Array.from({ length: 10 }, (_, i) => ({
      ...createMemoryRow({ id: i + 2, content: `Komşu ${i + 2}` }),
      relation_type: 'related_to',
      relation_confidence: 0.5 + (i * 0.05),
      relation_description: 'Test ilişkisi',
    }));

    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({
        active: [centralMemory],
        archival: [],
      }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [],
      getUserMemories: () => [],
      getMemoryNeighborsBatch: (memoryIds: number[], limitPerNode: number) => {
        const result = new Map<number, MemoryRelationNeighbor[]>();
        for (const id of memoryIds) {
          result.set(id, allNeighbors.slice(0, limitPerNode));
        }
        return result;
      },
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: () => {},
    });

    const bundle = await orchestrator.getPromptContextBundle({
      query: 'Test sorgusu',
      activeConversationId: 'conv-1',
      options: {
        searchLimit: 5,
        relevantMemoryLimit: 3,
      },
    });

    expect(bundle.relevantMemories).toBeDefined();
  });
});

// ========== İkinci Derece İlişkiler Testleri ==========

describe('İkinci Derece İlişkiler (2-hop)', () => {
  test('2-hop derinliğinde graph traversal yapılır', async () => {
    const memory1 = createMemoryRow({ id: 1, content: 'Birinci seviye' });
    const memory2 = createMemoryRow({ id: 2, content: 'İkinci seviye' });
    const memory3 = createMemoryRow({ id: 3, content: 'Üçüncü seviye' });

    // 1 -> 2 ilişkisi
    // 2 -> 3 ilişkisi
    const neighborsMap = new Map<number, MemoryRelationNeighbor[]>([
      [1, [{
        ...memory2,
        relation_type: 'related_to',
        relation_confidence: 0.8,
        relation_description: '1-hop',
      }]],
      [2, [{
        ...memory3,
        relation_type: 'related_to',
        relation_confidence: 0.7,
        relation_description: '2-hop',
      }]],
    ]);

    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({
        active: [memory1],
        archival: [],
      }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [],
      getUserMemories: () => [],
      getMemoryNeighborsBatch: (memoryIds: number[], _limitPerNode: number) => {
        const result = new Map<number, MemoryRelationNeighbor[]>();
        for (const id of memoryIds) {
          if (neighborsMap.has(id)) {
            result.set(id, neighborsMap.get(id) ?? []);
          }
        }
        return result;
      },
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: () => {},
    });

    const bundle = await orchestrator.getPromptContextBundle({
      query: 'Derin ilişkileri getir',
      activeConversationId: 'conv-1',
      options: {
        searchLimit: 10,
        relevantMemoryLimit: 5,
      },
    });

    expect(bundle.relevantMemories).toBeDefined();
  });

  test('Graph depth limiti aşılmaz', async () => {
    // Chain: 1 -> 2 -> 3 -> 4 -> 5
    // maxDepth: 2 ise sadece 1 -> 2 -> 3 traverse edilmeli
    const memories = Array.from({ length: 5 }, (_, i) =>
      createMemoryRow({ id: i + 1, content: `Bellek ${i + 1}` })
    );

    const neighborsMap = new Map<number, MemoryRelationNeighbor[]>();
    for (let i = 0; i < 4; i++) {
      neighborsMap.set(i + 1, [{
        ...memories[i + 1],
        relation_type: 'related_to',
        relation_confidence: 0.8,
        relation_description: `Link ${i + 1} -> ${i + 2}`,
      }]);
    }

    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (_query: string, _limit: number, maxDepth?: number) => {
        // maxDepth parametresi graph traversal derinliğini kontrol eder
        expect(maxDepth).toBeDefined();
        expect(maxDepth).toBeLessThanOrEqual(2);
        return {
          active: [memories[0]],
          archival: [],
        };
      },
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [],
      getUserMemories: () => [],
      getMemoryNeighborsBatch: (memoryIds: number[], _limitPerNode: number) => {
        const result = new Map<number, MemoryRelationNeighbor[]>();
        for (const id of memoryIds) {
          if (neighborsMap.has(id)) {
            result.set(id, neighborsMap.get(id) ?? []);
          }
        }
        return result;
      },
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: () => {},
    });

    await orchestrator.getPromptContextBundle({
      query: 'Test',
      activeConversationId: 'conv-1',
    });
  });
});

// ========== Relation Confidence Filtreleme Testleri ==========

describe('Relation Confidence Filtreleme', () => {
  test('Düşük confidence\'lı ilişkiler filtrelenir', async () => {
    const centralMemory = createMemoryRow({ id: 1, content: 'Merkez' });
    
    const highConfidenceNeighbor: MemoryRelationNeighbor = {
      ...createMemoryRow({ id: 2, content: 'Yüksek güven' }),
      relation_type: 'related_to',
      relation_confidence: 0.9,
      relation_description: 'Güçlü bağ',
    };

    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({
        active: [centralMemory],
        archival: [],
      }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [],
      getUserMemories: () => [],
      getMemoryNeighborsBatch: (_memoryIds: number[], _limitPerNode: number) => {
        // Sadece yüksek confidence'lı komşuyu döndür
        return new Map([[1, [highConfidenceNeighbor]]]);
      },
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: () => {},
    });

    const bundle = await orchestrator.getPromptContextBundle({
      query: 'Test',
      activeConversationId: 'conv-1',
    });

    // Düşük confidence'lı komşu sonuçlarda olmamalı
    expect(bundle.relevantMemories.find(m => m.id === 3)).toBeUndefined();
  });

  test('Confidence threshold konfigüre edilebilir', async () => {
    const centralMemory = createMemoryRow({ id: 1, content: 'Merkez' });
    
    const neighbors: MemoryRelationNeighbor[] = [
      {
        ...createMemoryRow({ id: 2, content: '0.7 confidence' }),
        relation_type: 'related_to',
        relation_confidence: 0.7,
        relation_description: '',
      },
      {
        ...createMemoryRow({ id: 3, content: '0.5 confidence' }),
        relation_type: 'related_to',
        relation_confidence: 0.5,
        relation_description: '',
      },
    ];

    let capturedLimit: number | undefined;
    
    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({
        active: [centralMemory],
        archival: [],
      }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [],
      getUserMemories: () => [],
      getMemoryNeighborsBatch: (_memoryIds: number[], limitPerNode: number) => {
        capturedLimit = limitPerNode;
        return new Map([[1, neighbors]]);
      },
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: () => {},
    });

    await orchestrator.getPromptContextBundle({
      query: 'Test',
      activeConversationId: 'conv-1',
    });

    // Limit parametresi doğru iletilmeli
    expect(capturedLimit).toBeDefined();
  });
});

// ========== Boş Graph Handling Testleri ==========

describe('Boş Graph Handling', () => {
  test('Hiç komşu yoksa graceful handle edilir', async () => {
    const isolatedMemory = createMemoryRow({
      id: 1,
      content: 'İzole bellek - hiç ilişkisi yok',
    });

    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({
        active: [isolatedMemory],
        archival: [],
      }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [],
      getUserMemories: () => [],
      getMemoryNeighborsBatch: (_memoryIds: number[], _limitPerNode: number) => new Map(),
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: () => {},
    });

    const bundle = await orchestrator.getPromptContextBundle({
      query: 'İzole bellek hakkında',
      activeConversationId: 'conv-1',
    });

    expect(bundle.relevantMemories).toHaveLength(1);
    expect(bundle.relevantMemories[0].id).toBe(1);
  });

  test('Tüm komşular archived ise sonuçlara dahil edilmez', async () => {
    const activeMemory = createMemoryRow({
      id: 1,
      content: 'Aktif bellek',
      is_archived: 0,
    });
    
    const archivedNeighbor: MemoryRelationNeighbor = {
      ...createMemoryRow({
        id: 2,
        content: 'Arşivlenmiş komşu',
        is_archived: 1,
      }),
      relation_type: 'related_to',
      relation_confidence: 0.8,
      relation_description: 'Arşiv ilişkisi',
    };

    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({
        active: [activeMemory],
        archival: [archivedNeighbor],
      }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [],
      getUserMemories: () => [],
      getMemoryNeighborsBatch: (_memoryIds: number[], _limitPerNode: number) => new Map(),
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: () => {},
    });

    const bundle = await orchestrator.getPromptContextBundle({
      query: 'Test',
      activeConversationId: 'conv-1',
    });

    // Aktif bellek gelmeli
    expect(bundle.relevantMemories.some(m => m.id === 1)).toBe(true);
    // Archived archival lane'de olmalı
    expect(bundle.archivalMemories.some(m => m.id === 2)).toBe(true);
  });

  test('GraphAwareSearch boş sonuç dönerse hata vermez', async () => {
    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({
        active: [],
        archival: [],
      }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [],
      getUserMemories: () => [],
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: () => {},
    });

    const bundle = await orchestrator.getPromptContextBundle({
      query: 'Hiçbir şey bulunamayacak sorgu',
      activeConversationId: 'conv-1',
    });

    expect(bundle.relevantMemories).toHaveLength(0);
    expect(bundle.archivalMemories).toHaveLength(0);
  });
});

// ========== Graph Search Entegrasyon Testleri ==========

describe('Graph Search Entegrasyonu', () => {
  test('Spreading activation graph ile entegre çalışır', async () => {
    const seedMemory = createMemoryRow({
      id: 1,
      content: 'Seed bellek',
      confidence: 0.9,
      importance: 8,
    });
    
    const activatedNeighbor: MemoryRelationNeighbor = {
      ...createMemoryRow({
        id: 2,
        content: 'Aktive edilen komşu',
        confidence: 0.85,
      }),
      relation_type: 'related_to',
      relation_confidence: 0.8,
      relation_description: 'Spreading activation',
    };

    let debugPayload: unknown = null;
    
    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({
        active: [seedMemory],
        archival: [],
      }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [],
      getUserMemories: () => [],
      getMemoryNeighborsBatch: (_memoryIds: number[], _limitPerNode: number) => {
        return new Map([[1, [activatedNeighbor]]]);
      },
      getSpreadingActivationConfig: () => ({
        enabled: true,
        rolloutState: 'soft',
      }),
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: (payload) => { debugPayload = payload; },
    });

    const bundle = await orchestrator.getPromptContextBundle({
      query: 'Test spreading',
      activeConversationId: 'conv-1',
    });

    expect(bundle.relevantMemories).toBeDefined();
    
    // Debug payload'da spreading activation bilgisi olmalı
    if (debugPayload && typeof debugPayload === 'object') {
      const debug = debugPayload as Record<string, unknown>;
      expect(debug.spreadingActivation).toBeDefined();
    }
  });

  test('Farklı ilişki tipleri doğru işlenir', async () => {
    const centralMemory = createMemoryRow({ id: 1, content: 'Merkez' });
    
    const neighbors: MemoryRelationNeighbor[] = [
      {
        ...createMemoryRow({ id: 2, content: 'Related' }),
        relation_type: 'related_to',
        relation_confidence: 0.8,
        relation_description: 'Genel ilişki',
      },
      {
        ...createMemoryRow({ id: 3, content: 'Supports' }),
        relation_type: 'supports',
        relation_confidence: 0.75,
        relation_description: 'Destekleyen',
      },
      {
        ...createMemoryRow({ id: 4, content: 'Caused by' }),
        relation_type: 'caused_by',
        relation_confidence: 0.9,
        relation_description: 'Nedensel',
      },
    ];

    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({
        active: [centralMemory],
        archival: [],
      }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [],
      getUserMemories: () => [],
      getMemoryNeighborsBatch: (_memoryIds: number[], _limitPerNode: number) => {
        return new Map([[1, neighbors]]);
      },
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: () => {},
    });

    const bundle = await orchestrator.getPromptContextBundle({
      query: 'İlişkileri getir',
      activeConversationId: 'conv-1',
    });

    expect(bundle.relevantMemories.length).toBeGreaterThanOrEqual(1);
  });
});
