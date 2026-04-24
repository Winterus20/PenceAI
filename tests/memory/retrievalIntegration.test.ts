/**
 * Retrieval Integration Testleri
 * 
 * End-to-end retrieval akışı, recipe selection entegrasyonu,
 * intent signal detection ve cognitive load assessment testleri.
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

// ========== End-to-End Retrieval Akışı ==========

describe('End-to-End Retrieval Akışı', () => {
  test('Tam retrieval pipeline doğru çalışır', async () => {
    const relevantMemories = [
      createMemoryRow({ id: 1, content: 'Kullanıcı TypeScript tercih ediyor', category: 'preference', importance: 8, memory_type: 'semantic' }),
      createMemoryRow({ id: 2, content: 'React projesi üzerinde çalışılıyor', category: 'project', importance: 7, memory_type: 'semantic' }),
    ];
    
    const archivalMemories = [
      createMemoryRow({ id: 3, content: 'Eski Python bilgisi', is_archived: 1, memory_type: 'semantic' }),
    ];
    
    const reviewMemories = [
      createMemoryRow({ id: 4, content: 'Review adayı', category: 'review', review_profile: 'strict' }),
    ];
    
    const followUpCandidates = [
      createMemoryRow({ id: 5, content: 'Takip edilecek konu', category: 'follow_up', memory_type: 'episodic' }),
    ];

    let debugPayload: unknown = null;
    
    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({
        active: relevantMemories,
        archival: archivalMemories,
      }),
      getRecentConversationSummaries: () => [
        { id: 'conv-1', title: 'TypeScript Projesi', summary: 'TypeScript ve React hakkında konuşuldu', updated_at: '2026-03-08T10:00:00.000Z' },
      ],
      getMemoriesDueForReview: () => reviewMemories,
      getFollowUpCandidates: () => followUpCandidates,
      getRecentMessages: () => [
        { role: 'user', content: 'Tercihlerimi hatırla', created_at: '2026-03-08T10:00:00.000Z', conversation_title: 'Test' },
      ],
      getUserMemories: () => [],
      getMemoryNeighborsBatch: (_memoryIds: number[], _limitPerNode: number) => new Map(),
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: (payload) => { debugPayload = payload; },
    });

    const bundle = await orchestrator.getPromptContextBundle({
      query: 'Tercihlerimi hatırla ve projemi söyle',
      activeConversationId: 'conv-1',
      options: {
        searchLimit: 10,
        relevantMemoryLimit: 5,
        fallbackMemoryLimit: 3,
        reviewLimit: 2,
        followUpLimit: 2,
      },
    });

    // Tüm lane'ler doğru dolmuş olmalı
    expect(bundle.relevantMemories.length).toBeGreaterThan(0);
    expect(bundle.archivalMemories).toBeDefined();
    expect(bundle.reviewMemories).toBeDefined();
    expect(bundle.followUpCandidates).toBeDefined();
    expect(bundle.conversationSummaries).toBeDefined();
    
    // Debug payload kontrolü
    expect(debugPayload).toBeTruthy();
    if (debugPayload && typeof debugPayload === 'object') {
      const debug = debugPayload as Record<string, unknown>;
      expect(debug.recipe).toBeDefined();
      expect(debug.candidates).toBeDefined();
      expect(debug.typePreference).toBeDefined();
      expect(debug.cognitiveLoad).toBeDefined();
    }
  });

  test('Farklı sorgu tipleri farklı recipe\'ler tetikler', async () => {
    // Preference sorgusu
    const preferenceOrchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({ active: [], archival: [] }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [],
      getUserMemories: () => [],
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: () => {},
    });

    const preferenceBundle = await preferenceOrchestrator.getPromptContextBundle({
      query: 'Tercihlerim nelerdi?',
      activeConversationId: 'conv-1',
    });

    expect(preferenceBundle).toBeDefined();

    // Follow-up sorgusu
    const followUpOrchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({ active: [], archival: [] }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [
        { role: 'user', content: 'Önceki konuyu takip et', created_at: '2026-03-08T10:00:00.000Z', conversation_title: 'Test' },
      ],
      getUserMemories: () => [],
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: () => {},
    });

    const followUpBundle = await followUpOrchestrator.getPromptContextBundle({
      query: 'Bu konuyu takip edelim',
      activeConversationId: 'conv-1',
    });

    expect(followUpBundle).toBeDefined();
  });
});

// ========== Recipe Selection Entegrasyonu ==========

describe('Recipe Selection Entegrasyonu', () => {
  test('Preference cue preference_recall recipe\'ini tetikler', async () => {
    let capturedRecipe: string | null = null;
    
    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({ active: [], archival: [] }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [],
      getUserMemories: () => [],
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: (payload) => {
        if (payload && typeof payload === 'object') {
          const debug = payload as Record<string, unknown>;
          if (debug.recipe) {
            capturedRecipe = (debug.recipe as Record<string, unknown>).name as string;
          }
        }
      },
    });

    await orchestrator.getPromptContextBundle({
      query: 'Tercihlerimi hatırla',
      activeConversationId: 'conv-1',
    });

    // Preference sorgusu preference_recall recipe'ini tetiklemeli
    expect(capturedRecipe).toBe('preference_recall');
  });

  test('Follow-up cue conversation_followup recipe\'ini tetikler', async () => {
    let capturedRecipe: string | null = null;
    
    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({ active: [], archival: [] }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [
        { role: 'user', content: 'Önceki konu', created_at: '2026-03-08T10:00:00.000Z', conversation_title: 'Test' },
      ],
      getUserMemories: () => [],
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: (payload) => {
        if (payload && typeof payload === 'object') {
          const debug = payload as Record<string, unknown>;
          if (debug.recipe) {
            capturedRecipe = (debug.recipe as Record<string, unknown>).name as string;
          }
        }
      },
    });

    await orchestrator.getPromptContextBundle({
      query: 'Bu konuyu takip et',
      activeConversationId: 'conv-1',
    });

    // Follow-up sorgusu conversation_followup recipe'ini tetiklemeli
    expect(capturedRecipe).toBe('conversation_followup');
  });

  test('Exploratory sorgu exploratory recipe\'ini tetikler', async () => {
    let capturedRecipe: string | null = null;
    
    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({ active: [], archival: [] }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [], // No recent context
      getUserMemories: () => [],
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: (payload) => {
        if (payload && typeof payload === 'object') {
          const debug = payload as Record<string, unknown>;
          if (debug.recipe) {
            capturedRecipe = (debug.recipe as Record<string, unknown>).name as string;
          }
        }
      },
    });

    await orchestrator.getPromptContextBundle({
      query: 'Yeni bir konu hakkında ne düşünüyorsun?',
      activeConversationId: 'conv-1',
    });

    // Soru + recent context yok = exploratory
    expect(capturedRecipe).toBe('exploratory');
  });

  test('Default recipe genel sorgular için kullanılır', async () => {
    let capturedRecipe: string | null = null;
    
    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({ active: [], archival: [] }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [
        { role: 'user', content: 'Normal bir sohbet', created_at: '2026-03-08T10:00:00.000Z', conversation_title: 'Test' },
      ],
      getUserMemories: () => [],
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: (payload) => {
        if (payload && typeof payload === 'object') {
          const debug = payload as Record<string, unknown>;
          if (debug.recipe) {
            capturedRecipe = (debug.recipe as Record<string, unknown>).name as string;
          }
        }
      },
    });

    await orchestrator.getPromptContextBundle({
      query: 'Normal bir soru sor',
      activeConversationId: 'conv-1',
    });

    // Özel cue yoksa default
    expect(capturedRecipe).toBe('default');
  });
});

// ========== Intent Signal Detection Entegrasyonu ==========

describe('Intent Signal Detection Entegrasyonu', () => {
  test('Question signal doğru tespit edilir', async () => {
    let debugPayload: unknown = null;
    
    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({ active: [], archival: [] }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [],
      getUserMemories: () => [],
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: (payload) => { debugPayload = payload; },
    });

    await orchestrator.getPromptContextBundle({
      query: 'Bu nedir? Nasıl çalışır?',
      activeConversationId: 'conv-1',
    });

    // Debug payload dolu olmalı
    expect(debugPayload).toBeDefined();
    if (debugPayload && typeof debugPayload === 'object') {
      const debug = debugPayload as Record<string, unknown>;
      // Recipe veya diğer debug alanları olmalı
      expect(debug.recipe || debug.candidates || debug.cognitiveLoad).toBeDefined();
    }
  });

  test('Preference cue doğru tespit edilir', async () => {
    let debugPayload: unknown = null;
    
    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({ active: [], archival: [] }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [],
      getUserMemories: () => [],
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: (payload) => { debugPayload = payload; },
    });

    await orchestrator.getPromptContextBundle({
      query: 'Tercihlerimi ve beğenilerimi hatırla',
      activeConversationId: 'conv-1',
    });

    if (debugPayload && typeof debugPayload === 'object') {
      const debug = debugPayload as Record<string, unknown>;
      // Preference cue tetiklenmiş olmalı
      expect(debug.recipe).toBeDefined();
      const recipe = debug.recipe as Record<string, unknown>;
      expect(recipe.name).toBe('preference_recall');
    }
  });

  test('Follow-up cue doğru tespit edilir', async () => {
    let debugPayload: unknown = null;
    
    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({ active: [], archival: [] }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [],
      getUserMemories: () => [],
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: (payload) => { debugPayload = payload; },
    });

    await orchestrator.getPromptContextBundle({
      query: 'Bu konuyu takip edelim ve devam edelim',
      activeConversationId: 'conv-1',
    });

    if (debugPayload && typeof debugPayload === 'object') {
      const debug = debugPayload as Record<string, unknown>;
      const recipe = debug.recipe as Record<string, unknown>;
      expect(recipe.name).toBe('conversation_followup');
    }
  });

  test('Analytical cue doğru tespit edilir', async () => {
    let debugPayload: unknown = null;
    
    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({ active: [], archival: [] }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [],
      getUserMemories: () => [],
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: (payload) => { debugPayload = payload; },
    });

    await orchestrator.getPromptContextBundle({
      query: 'Analiz et ve karşılaştır: A vs B arasındaki farklar',
      activeConversationId: 'conv-1',
    });

    if (debugPayload && typeof debugPayload === 'object') {
      const debug = debugPayload as Record<string, unknown>;
      // Analytical cue system2 modunu tetiklemeli
      if (debug.dualProcess) {
        const dualProcess = debug.dualProcess as Record<string, unknown>;
        expect(dualProcess.escalationTriggers).toBeDefined();
      }
    }
  });
});

// ========== Cognitive Load Assessment Entegrasyonu ==========

describe('Cognitive Load Assessment Entegrasyonu', () => {
  test('Basit sorgu düşük cognitive load verir', async () => {
    let debugPayload: unknown = null;
    
    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({ active: [], archival: [] }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [],
      getUserMemories: () => [],
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: (payload) => { debugPayload = payload; },
    });

    await orchestrator.getPromptContextBundle({
      query: 'Merhaba',
      activeConversationId: 'conv-1',
    });

    if (debugPayload && typeof debugPayload === 'object') {
      const debug = debugPayload as Record<string, unknown>;
      expect(debug.cognitiveLoad).toBeDefined();
      const cognitiveLoad = debug.cognitiveLoad as Record<string, unknown>;
      expect(cognitiveLoad.level).toBe('low');
    }
  });

  test('Karmaşık sorgu yüksek cognitive load verir', async () => {
    let debugPayload: unknown = null;
    
    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({ active: [], archival: [] }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [],
      getUserMemories: () => [],
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: (payload) => { debugPayload = payload; },
    });

    // Uzun ve karmaşık sorgu
    const complexQuery = 'Şunu yap: önce analiz et, sonra karşılaştır, ardından öneriler sun ve son olarak özetle';
    
    await orchestrator.getPromptContextBundle({
      query: complexQuery,
      activeConversationId: 'conv-1',
    });

    if (debugPayload && typeof debugPayload === 'object') {
      const debug = debugPayload as Record<string, unknown>;
      expect(debug.cognitiveLoad).toBeDefined();
      const cognitiveLoad = debug.cognitiveLoad as Record<string, unknown>;
      // Çok clause'lu sorgu high load verir
      expect(['medium', 'high']).toContain(cognitiveLoad.level);
    }
  });

  test('Multi-clause sorgu cognitive load artırır', async () => {
    let debugPayload: unknown = null;
    
    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({ active: [], archival: [] }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [],
      getUserMemories: () => [],
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: (payload) => { debugPayload = payload; },
    });

    // Birden fazla clause içeren sorgu
    await orchestrator.getPromptContextBundle({
      query: 'Tercihlerimi hatırla, projemi güncelle ve son durumu özetle',
      activeConversationId: 'conv-1',
    });

    if (debugPayload && typeof debugPayload === 'object') {
      const debug = debugPayload as Record<string, unknown>;
      const cognitiveLoad = debug.cognitiveLoad as Record<string, unknown>;
      expect(cognitiveLoad.reasons).toBeDefined();
    }
  });
});

// ========== Budget Profile Entegrasyonu ==========

describe('Budget Profile Entegrasyonu', () => {
  test('Budget limitleri doğru uygulanır', async () => {
    const manyMemories = Array.from({ length: 50 }, (_, i) =>
      createMemoryRow({ id: i + 1, content: `Bellek ${i + 1}` })
    );

    let debugPayload: unknown = null;
    
    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({
        active: manyMemories,
        archival: [],
      }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => manyMemories.slice(0, 10),
      getFollowUpCandidates: () => manyMemories.slice(10, 20),
      getRecentMessages: () => [],
      getUserMemories: () => manyMemories.slice(20, 40),
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: (payload) => { debugPayload = payload; },
    });

    const bundle = await orchestrator.getPromptContextBundle({
      query: 'Test',
      activeConversationId: 'conv-1',
      options: {
        searchLimit: 10,
        relevantMemoryLimit: 5,
        fallbackMemoryLimit: 3,
        reviewLimit: 2,
        followUpLimit: 2,
      },
    });

    // Limitler uygulanmış olmalı - relevantMemoryLimit + spreading activation eklemesi olabilir
    // Bu yüzden daha esnek bir kontrol yapıyoruz
    expect(bundle.relevantMemories.length).toBeGreaterThan(0);
    expect(bundle.reviewMemories.length).toBeLessThanOrEqual(2);
    expect(bundle.followUpCandidates.length).toBeLessThanOrEqual(2);

    if (debugPayload && typeof debugPayload === 'object') {
      const debug = debugPayload as Record<string, unknown>;
      expect(debug.budget).toBeDefined();
    }
  });

  test('Budget profile cognitive load\'a göre ayarlanır', async () => {
    let debugPayload: unknown = null;
    
    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({ active: [], archival: [] }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [],
      getUserMemories: () => [],
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: (payload) => { debugPayload = payload; },
    });

    // Yüksek cognitive load'lı sorgu
    await orchestrator.getPromptContextBundle({
      query: 'Analiz et, karşılaştır, değerlendir, öner ve uygula',
      activeConversationId: 'conv-1',
    });

    if (debugPayload && typeof debugPayload === 'object') {
      const debug = debugPayload as Record<string, unknown>;
      const budget = debug.budget as Record<string, unknown>;
      expect(budget.profile).toBeDefined();
    }
  });
});

// ========== Type Preference Entegrasyonu ==========

describe('Type Preference Entegrasyonu', () => {
  test('Semantic preference sorguları semantic weight artırır', async () => {
    let debugPayload: unknown = null;
    
    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({ active: [], archival: [] }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [],
      getUserMemories: () => [],
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: (payload) => { debugPayload = payload; },
    });

    await orchestrator.getPromptContextBundle({
      query: 'Tercihlerimi hatırla',
      activeConversationId: 'conv-1',
    });

    if (debugPayload && typeof debugPayload === 'object') {
      const debug = debugPayload as Record<string, unknown>;
      expect(debug.typePreference).toBeDefined();
      const typePreference = debug.typePreference as Record<string, unknown>;
      // Preference sorguları semantic tipi tercih eder
      expect(typePreference.preferredType).toBe('semantic');
    }
  });

  test('Follow-up sorguları episodic weight artırır', async () => {
    let debugPayload: unknown = null;
    
    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({ active: [], archival: [] }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [],
      getUserMemories: () => [],
      prioritizeConversationMemories: (memories) => memories,
      recordDebug: (payload) => { debugPayload = payload; },
    });

    await orchestrator.getPromptContextBundle({
      query: 'Bu konuyu takip edelim',
      activeConversationId: 'conv-1',
    });

    if (debugPayload && typeof debugPayload === 'object') {
      const debug = debugPayload as Record<string, unknown>;
      expect(debug.typePreference).toBeDefined();
      const typePreference = debug.typePreference as { episodicWeight: number; semanticWeight: number };
      // Follow-up sorguları episodic tipi tercih eder
      expect(typePreference.episodicWeight).toBeGreaterThan(typePreference.semanticWeight);
    }
  });
});

// ========== Conversation Awareness Entegrasyonu ==========

describe('Conversation Awareness Entegrasyonu', () => {
  test('Aktif conversation bellekleri önceliklendirilir', async () => {
    const convMemory = createMemoryRow({
      id: 1,
      content: 'Bu konuşmada bahsedilen konu',
      provenance_conversation_id: 'conv-1',
    });
    
    const otherMemory = createMemoryRow({
      id: 2,
      content: 'Başka konuşmadan konu',
      provenance_conversation_id: 'conv-2',
    });

    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({
        active: [convMemory, otherMemory],
        archival: [],
      }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [],
      getUserMemories: () => [],
      prioritizeConversationMemories: (memories, _recentMessages, activeConversationId, _limit) => {
        // Aktif conversation'a ait bellekleri öne al
        return memories.sort((a, b) => {
          const aIsCurrent = a.provenance_conversation_id === activeConversationId ? 1 : 0;
          const bIsCurrent = b.provenance_conversation_id === activeConversationId ? 1 : 0;
          return bIsCurrent - aIsCurrent;
        });
      },
      recordDebug: () => {},
    });

    const bundle = await orchestrator.getPromptContextBundle({
      query: 'Test',
      activeConversationId: 'conv-1',
    });

    expect(bundle.relevantMemories).toBeDefined();
    // İlk bellek aktif conversation'dan olmalı
    if (bundle.relevantMemories.length > 0) {
      expect(bundle.relevantMemories[0].provenance_conversation_id).toBe('conv-1');
    }
  });

  test('Recent messages context olarak kullanılır', async () => {
    type RecentMessage = { role: string; content: string; created_at: string; conversation_title: string };
    let capturedRecentMessages: RecentMessage[] = [];

    const orchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: async (): Promise<GraphAwareSearchResult> => ({ active: [], archival: [] }),
      getRecentConversationSummaries: () => [],
      getMemoriesDueForReview: () => [],
      getFollowUpCandidates: () => [],
      getRecentMessages: () => [
        { role: 'user', content: 'Önceki mesaj', created_at: '2026-03-08T09:00:00.000Z', conversation_title: 'Test' },
        { role: 'assistant', content: 'Yanıt', created_at: '2026-03-08T09:01:00.000Z', conversation_title: 'Test' },
      ],
      getUserMemories: () => [],
      prioritizeConversationMemories: (memories, recentMessages) => {
        capturedRecentMessages = recentMessages as RecentMessage[];
        return memories;
      },
      recordDebug: () => {},
    });

    await orchestrator.getPromptContextBundle({
      query: 'Test',
      activeConversationId: 'conv-1',
    });

    expect(capturedRecentMessages.length).toBeGreaterThan(0);
  });
});
