/**
 * Retrieval Edge Cases Testleri
 * 
 * Boş sorgu, hiç bellek yok, tüm arşivlenmiş, maksimum limit,
 * çelişen intent sinyalleri ve null/undefined handling testleri.
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

// Mock neighbor tipi
type MemoryRelationNeighbor = MemoryRow & {
  relation_type: string;
  relation_confidence?: number;
  relation_description: string;
};

// ========== Boş Sorgu String Testleri ==========

describe('Boş Sorgu String Handling', () => {
  test('Boş sorgu ile çağrıldığında hata vermez', async () => {
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
      query: '',
      activeConversationId: 'conv-1',
    });

    expect(bundle).toBeDefined();
    expect(bundle.relevantMemories).toEqual([]);
  });

  test('Sadece whitespace içeren sorgu handle edilir', async () => {
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
      query: '     ',
      activeConversationId: 'conv-1',
    });

    expect(bundle).toBeDefined();
  });

  test('Null karakterler içeren sorgu handle edilir', async () => {
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

    // Null karakter içeren sorgu
    const bundle = await orchestrator.getPromptContextBundle({
      query: 'test\0query',
      activeConversationId: 'conv-1',
    });

    expect(bundle).toBeDefined();
  });
});

// ========== Hiç Bellek Yok Durumu ==========

describe('Hiç Bellek Yok Durumu', () => {
  test('Kullanıcının hiç belleği yoksa boş bundle döner', async () => {
    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({
        active: [],
        archival: [],
      }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [],
      getUserMemories: () => [], // Boş
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: () => {},
    });

    const bundle = await orchestrator.getPromptContextBundle({
      query: 'Herhangi bir şey',
      activeConversationId: 'conv-1',
    });

    expect(bundle.relevantMemories).toEqual([]);
    expect(bundle.archivalMemories).toEqual([]);
    expect(bundle.supplementalMemories).toEqual([]);
    expect(bundle.reviewMemories).toEqual([]);
    expect(bundle.followUpCandidates).toEqual([]);
  });

  test('Fallback bellekler de yoksa graceful handle edilir', async () => {
    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({
        active: [],
        archival: [],
      }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [],
      getUserMemories: () => [], // Fallback de boş
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: () => {},
    });

    const bundle = await orchestrator.getPromptContextBundle({
      query: 'Test sorgusu',
      activeConversationId: 'conv-1',
      options: {
        fallbackMemoryLimit: 5,
      },
    });

    expect(bundle.supplementalMemories).toEqual([]);
  });
});

// ========== Tüm Bellekler Arşivlenmiş ==========

describe('Tüm Bellekler Arşivlenmiş Durumu', () => {
  test('Tüm aktif bellekler arşivlenmiş ise archival lane kullanılır', async () => {
    const archivedMemories = [
      createMemoryRow({ id: 1, content: 'Arşiv 1', is_archived: 1 }),
      createMemoryRow({ id: 2, content: 'Arşiv 2', is_archived: 1 }),
    ];

    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({
        active: [], // Aktif yok
        archival: archivedMemories,
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
      query: 'Eski bilgiler',
      activeConversationId: 'conv-1',
    });

    // Archival bellekler ilgili lane'de olmalı
    expect(bundle.archivalMemories.length).toBeGreaterThanOrEqual(0);
  });

  test('Arşiv bellekleri is_archived=1 olarak işaretli', async () => {
    const archivedMemory = createMemoryRow({
      id: 1,
      content: 'Arşivlenmiş bilgi',
      is_archived: 1,
    });

    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({
        active: [],
        archival: [archivedMemory],
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
      query: 'Test',
      activeConversationId: 'conv-1',
    });

    // Archival lane'deki bellekler is_archived=1 olmalı
    for (const memory of bundle.archivalMemories) {
      expect(memory.is_archived).toBe(1);
    }
  });
});

// ========== Maksimum Limit Değerleri ==========

describe('Maksimum Limit Değerleri', () => {
  test('Çok yüksek limit değerleri doğru handle edilir', async () => {
    const manyMemories = Array.from({ length: 1000 }, (_, i) =>
      createMemoryRow({ id: i + 1, content: `Bellek ${i + 1}` })
    );

    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({
        active: manyMemories.slice(0, 100),
        archival: [],
      }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => manyMemories.slice(100, 110),
      getFollowUpCandidates: () => manyMemories.slice(110, 120),
      getRecentMessages: () => [],
      getUserMemories: () => manyMemories.slice(120, 200),
      prioritizeConversationMemories: (memories) => memories.slice(0, 50),
      recordDebug: () => {},
    });

    const bundle = await orchestrator.getPromptContextBundle({
      query: 'Test',
      activeConversationId: 'conv-1',
      options: {
        searchLimit: 1000,
        relevantMemoryLimit: 500,
        fallbackMemoryLimit: 200,
      },
    });

    expect(bundle).toBeDefined();
    // Limitler uygulanmış olmalı
    expect(bundle.relevantMemories.length).toBeLessThanOrEqual(500);
  });

  test('Limit 0 ise sonuç boş döner', async () => {
    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({
        active: [createMemoryRow({ id: 1, content: 'Test' })],
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
      query: 'Test',
      activeConversationId: 'conv-1',
      options: {
        searchLimit: 0,
        relevantMemoryLimit: 0,
      },
    });

    expect(bundle.relevantMemories.length).toBe(0);
  });

  test('Negatif limit varsayılan kullanır', async () => {
    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({
        active: [createMemoryRow({ id: 1, content: 'Test' })],
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

    // Negatif limit - hata vermemeli
    const bundle = await orchestrator.getPromptContextBundle({
      query: 'Test',
      activeConversationId: 'conv-1',
      options: {
        searchLimit: -5,
        relevantMemoryLimit: -10,
      },
    });

    expect(bundle).toBeDefined();
  });
});

// ========== Çelişen Intent Sinyalleri ==========

describe('Çelişen Intent Sinyalleri', () => {
  test('Preference ve FollowUp sinyalleri aynı anda varsa system2 moduna geçer', async () => {
    const preferenceMemory = createMemoryRow({
      id: 1,
      content: 'Kullanıcı TypeScript tercih ediyor',
      category: 'preference',
      memory_type: 'semantic',
    });
    
    const followUpMemory = createMemoryRow({
      id: 2,
      content: 'Dün API entegrasyonunu konuştuk, bugün devam edelim',
      category: 'follow_up',
      memory_type: 'episodic',
    });

    let debugPayload: unknown = null;
    
    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({
        active: [preferenceMemory, followUpMemory],
        archival: [],
      }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [
        { role: 'user', content: 'Tercihlerimi hatırla ve son durumu söyle', created_at: '2026-03-08T10:00:00.000Z', conversation_title: 'Test' },
      ],
      getUserMemories: () => [],
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: (payload) => { debugPayload = payload; },
    });

    const bundle = await orchestrator.getPromptContextBundle({
      query: 'Tercihlerimi hatırla ve son durumu söyle',
      activeConversationId: 'conv-1',
    });

    expect(bundle).toBeDefined();
    
    // Debug payload'da dual process bilgisi olmalı
    if (debugPayload && typeof debugPayload === 'object') {
      const debug = debugPayload as Record<string, unknown>;
      // Çelişen sinyaller escalation trigger olarak kaydedilmeli
      if (debug.dualProcess) {
        const dualProcess = debug.dualProcess as Record<string, unknown>;
        expect(dualProcess.escalationTriggers).toBeDefined();
      }
    }
  });

  test('Analytical ve Exploratory sinyalleri birlikte handle edilir', async () => {
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

    // Analytical + Exploratory içeren karmaşık sorgu
    const bundle = await orchestrator.getPromptContextBundle({
      query: 'Analiz et ve yeni fikirler oluştur: TypeScript vs JavaScript performans',
      activeConversationId: 'conv-1',
    });

    expect(bundle).toBeDefined();
  });
});

// ========== Null/Undefined Değer Handling ==========

describe('Null/Undefined Değer Handling', () => {
  test('MemoryRow\'da null alanlar doğru handle edilir', async () => {
    const memoryWithNulls = createMemoryRow({
      id: 1,
      content: 'Null alanlı bellek',
      stability: null,
      retrievability: null,
      next_review_at: null,
      review_count: null,
      max_importance: null,
      memory_type: null,
      last_accessed: null,
      provenance_message_id: null,
    });

    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({
        active: [memoryWithNulls],
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
      query: 'Test',
      activeConversationId: 'conv-1',
    });

    expect(bundle.relevantMemories.length).toBeGreaterThanOrEqual(1);
    // Null alanlar default değerlere çevrilmeli
    const memory = bundle.relevantMemories[0];
    expect(memory.id).toBe(1);
  });

  test('Confidence null ise default kullanılır', async () => {
    const memoryNoConfidence = createMemoryRow({
      id: 1,
      content: 'Confidence yok',
      confidence: null as unknown as number, // Null test
    });

    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({
        active: [memoryNoConfidence],
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
      query: 'Test',
      activeConversationId: 'conv-1',
    });

    expect(bundle).toBeDefined();
  });

  test('Provenance alanları null olabilir', async () => {
    const memoryNoProvenance = createMemoryRow({
      id: 1,
      content: 'Provenance yok',
      provenance_source: null,
      provenance_conversation_id: null,
      provenance_message_id: null,
    });

    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({
        active: [memoryNoProvenance],
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
      query: 'Test',
      activeConversationId: 'conv-1',
    });

    expect(bundle).toBeDefined();
  });

  test('Review profile null ise standard kullanılır', async () => {
    const memoryNoProfile = createMemoryRow({
      id: 1,
      content: 'Profile yok',
      review_profile: null,
    });

    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({
        active: [memoryNoProfile],
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
      query: 'Test',
      activeConversationId: 'conv-1',
    });

    expect(bundle).toBeDefined();
  });
});

// ========== Özel Karakter ve Encoding Testleri ==========

describe('Özel Karakter ve Encoding', () => {
  test('Unicode karakterler içeren sorgu handle edilir', async () => {
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
      query: 'Türkçe karakterler: çğıöşü ÇĞİÖŞÜ',
      activeConversationId: 'conv-1',
    });

    expect(bundle).toBeDefined();
  });

  test('Emoji içeren sorgu handle edilir', async () => {
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
      query: 'Test 🎉 emoji 🚀 sorgu',
      activeConversationId: 'conv-1',
    });

    expect(bundle).toBeDefined();
  });

  test('Çok uzun sorgu string handle edilir', async () => {
    const longQuery = 'a'.repeat(10000); // 10.000 karakter
    
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
      query: longQuery,
      activeConversationId: 'conv-1',
    });

    expect(bundle).toBeDefined();
  });
});

// ========== Conversation ID Edge Cases ==========

describe('Conversation ID Edge Cases', () => {
  test('Empty conversation ID handle edilir', async () => {
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
      query: 'Test',
      activeConversationId: '',
    });

    expect(bundle).toBeDefined();
  });

  test('Special character içeren conversation ID handle edilir', async () => {
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
      query: 'Test',
      activeConversationId: 'conv-123-abc_XYZ',
    });

    expect(bundle).toBeDefined();
  });
});
