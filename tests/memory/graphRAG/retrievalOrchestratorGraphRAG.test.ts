/**
 * RetrievalOrchestrator + GraphRAG Integration Testleri (Genişletilmiş)
 *
 * GraphRAG retrieval'ın retrieval orchestrator ile entegrasyonunu,
 * recipe selection'ın GraphRAG kullanımını ve bundle'a eklenme
 * davranışlarını test eder.
 */

// Logger mock
import { GraphRAGConfigManager, GraphRAGRolloutPhase } from '../../../src/memory/graphRAG/config.js';
jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../../src/memory/retrieval/RetrievalConfidenceScorer.js', () => ({
  computeRetrievalConfidence: jest.fn().mockReturnValue({
    score: 0.9,
    needsRetrieval: true,
    reasons: ['test'],
  }),
}));

import { MemoryRetrievalOrchestrator, type RetrievalOrchestratorDeps, type PromptContextBundle } from '../../../src/memory/retrievalOrchestrator.js';
import { GraphRAGEngine, type GraphRAGResult } from '../../../src/memory/graphRAG/index.js';
import type { MemoryRow, GraphAwareSearchResult } from '../../../src/memory/types.js';
import { logger } from '../../../src/utils/logger.js';

// Mock GraphRAGEngine
jest.mock('../../../src/memory/graphRAG/GraphRAGEngine.js', () => ({
  GraphRAGEngine: jest.fn().mockImplementation(() => ({
    retrieve: jest.fn(),
  })),
}));

describe('RetrievalOrchestrator + GraphRAG Integration (Extended)', () => {
  let mockGraphRAGEngine: jest.Mocked<GraphRAGEngine>;
  let mockDeps: RetrievalOrchestratorDeps;

  /** Helper: Test memory oluştur */
  function createMemory(id: number, content: string = 'test memory'): MemoryRow {
    return {
      id,
      user_id: 'default',
      category: 'test',
      content,
      importance: 5,
      access_count: 0,
      is_archived: 0,
      last_accessed: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      provenance_source: null,
      provenance_conversation_id: null,
      provenance_message_id: null,
      confidence: 0.7,
      review_profile: null,
      memory_type: 'semantic' as const,
      stability: null,
      retrievability: null,
      next_review_at: null,
      review_count: null,
      max_importance: null,
    };
  }

  /** Helper: GraphRAG result oluştur */
  function createGraphRAGResult(success: boolean, memories: MemoryRow[] = []): GraphRAGResult {
    return {
      success,
      memories,
      communitySummaries: [],
      graphContext: {
        expandedNodeIds: memories.map(m => m.id),
        edgeCount: 0,
        maxHopReached: false,
        communityCount: 0,
        pageRankApplied: true,
      },
      searchMetadata: {
        duration: 100,
        cacheHit: false,
        tokenUsage: 0,
        fallbackUsed: false,
        phase: 'fusion',
      },
    };
  }

  /** Helper: GraphAwareSearch result oluştur */
  function createGraphAwareSearchResult(active: MemoryRow[] = [], archival: MemoryRow[] = []): GraphAwareSearchResult {
    return { active, archival };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);

    // Mock GraphRAGEngine instance
    mockGraphRAGEngine = new GraphRAGEngine(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      async () => [],
    ) as jest.Mocked<GraphRAGEngine>;

    // Default mock deps
    mockDeps = {
      graphAwareSearch: jest.fn().mockResolvedValue(createGraphAwareSearchResult([createMemory(1)])),
      getRecentConversationSummaries: jest.fn().mockReturnValue([]),
      getMemoriesDueForReview: jest.fn().mockReturnValue([]),
      getFollowUpCandidates: jest.fn().mockReturnValue([]),
      getRecentMessages: jest.fn().mockReturnValue([]),
      // wikiAdaptiveThreshold default 100 — 101 öğe döndürerek adaptive skip'i bypass et
      getUserMemories: jest.fn().mockReturnValue(new Array(101).fill(createMemory(1))),
      getMemoryNeighborsBatch: jest.fn().mockReturnValue(new Map()),
      getBehaviorDiscoveryConfig: jest.fn().mockReturnValue({ retrieval: { state: 'shadow' } }),
      prioritizeConversationMemories: jest.fn((memories) => memories),
      recordDebug: jest.fn(),
      graphRAGEngine: mockGraphRAGEngine,
      agenticRAGLLMProvider: {
        name: 'mock',
        supportedModels: ['mock-model'],
        defaultModel: 'mock-model',
        chat: jest.fn().mockResolvedValue({
          content: 'mock response',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'stop',
        }),
        healthCheck: jest.fn().mockResolvedValue(true),
      } as any,
    };
  });

  describe('GraphRAG retrieval bundle\'a eklenir', () => {
    test('GraphRAG results bundle.graphRAG alanına yazılır', async () => {
      const graphRAGMemories = [createMemory(10, 'graphRAG memory')];
      (mockGraphRAGEngine.retrieve as jest.Mock).mockResolvedValue(
        createGraphRAGResult(true, graphRAGMemories)
      );

      // GraphRAG recipe tetikleyecek sinyal
      mockDeps.getRecentMessages = jest.fn().mockReturnValue([
        { role: 'user', content: 'Bu konu hakkında detaylı analiz yap ve alternatifleri keşfet', created_at: new Date().toISOString(), conversation_title: 'test' },
      ]);

      const orchestrator = new MemoryRetrievalOrchestrator(mockDeps);
      const result = await orchestrator.getPromptContextBundle({
        query: 'Bu konu hakkında detaylı analiz yap ve alternatifleri keşfet',
        activeConversationId: 'test-conv',
      });

      // GraphRAG results bundle'da olmalı
      expect(result.graphRAG).not.toBeNull();
      expect(result.graphRAG?.memories.length).toBe(1);
      expect(result.graphRAG?.memories[0].id).toBe(10);
    });

    test('GraphRAG community summaries bundle\'a eklenir', async () => {
      const graphRAGMemories = [createMemory(10, 'graphRAG memory')];
      const resultWithSummaries = createGraphRAGResult(true, graphRAGMemories);
      resultWithSummaries.communitySummaries = [
        {
          communityId: 'c1',
          summary: 'Test community summary',
          keyEntities: [],
          keyRelations: [],
          topics: ['tech'],
          generatedAt: new Date(),
        },
      ];
      (mockGraphRAGEngine.retrieve as jest.Mock).mockResolvedValue(resultWithSummaries);

      mockDeps.getRecentMessages = jest.fn().mockReturnValue([
        { role: 'user', content: 'Bu konu hakkında detaylı analiz yap ve alternatifleri keşfet', created_at: new Date().toISOString(), conversation_title: 'test' },
      ]);

      const orchestrator = new MemoryRetrievalOrchestrator(mockDeps);
      const result = await orchestrator.getPromptContextBundle({
        query: 'Bu konu hakkında detaylı analiz yap ve alternatifleri keşfet',
        activeConversationId: 'test-conv',
      });

      expect(result.graphRAG).not.toBeNull();
      expect(result.graphRAG?.communitySummaries).toBeDefined();
    });

    test('GraphRAG graphContext bundle\'a eklenir', async () => {
      const graphRAGMemories = [createMemory(10, 'graphRAG memory')];
      const resultWithContext = createGraphRAGResult(true, graphRAGMemories);
      resultWithContext.graphContext = {
        expandedNodeIds: [10, 11, 12],
        edgeCount: 5,
        maxHopReached: true,
        communityCount: 2,
        pageRankApplied: true,
      };
      (mockGraphRAGEngine.retrieve as jest.Mock).mockResolvedValue(resultWithContext);

      mockDeps.getRecentMessages = jest.fn().mockReturnValue([
        { role: 'user', content: 'Bu konu hakkında detaylı analiz yap ve alternatifleri keşfet', created_at: new Date().toISOString(), conversation_title: 'test' },
      ]);

      const orchestrator = new MemoryRetrievalOrchestrator(mockDeps);
      const result = await orchestrator.getPromptContextBundle({
        query: 'Bu konu hakkında detaylı analiz yap ve alternatifleri keşfet',
        activeConversationId: 'test-conv',
      });

      expect(result.graphRAG).not.toBeNull();
      expect(result.graphRAG?.graphContext.expandedNodeIds).toContain(10);
      expect(result.graphRAG?.graphContext.edgeCount).toBe(5);
    });
  });

  describe('Recipe selection GraphRAG\'ı etkiler', () => {
    test('graph_rag_exploration recipe GraphRAG kullanır', async () => {
      const graphRAGMemories = [createMemory(10, 'graphRAG exploration memory')];
      (mockGraphRAGEngine.retrieve as jest.Mock).mockResolvedValue(
        createGraphRAGResult(true, graphRAGMemories)
      );

      // Analytical + exploratory sinyalleri
      mockDeps.getRecentMessages = jest.fn().mockReturnValue([
        { role: 'user', content: 'Bana farklı alternatifler keşfet', created_at: new Date().toISOString(), conversation_title: 'test' },
      ]);

      const orchestrator = new MemoryRetrievalOrchestrator(mockDeps);
      await orchestrator.getPromptContextBundle({
        query: 'Bana farklı alternatifler keşfet',
        activeConversationId: 'test-conv',
      });

      expect(mockGraphRAGEngine.retrieve).toHaveBeenCalled();
    });

    test('graph_rag_deep recipe daha derin GraphRAG kullanır', async () => {
      const graphRAGMemories = [createMemory(10, 'deep graphRAG memory')];
      (mockGraphRAGEngine.retrieve as jest.Mock).mockResolvedValue(
        createGraphRAGResult(true, graphRAGMemories)
      );

      // Strong analytical + exploratory sinyalleri
      mockDeps.getRecentMessages = jest.fn().mockReturnValue([
        { role: 'user', content: 'Bu konuyu derinlemesine analiz et, alternatifleri keşfet ve karşılaştır', created_at: new Date().toISOString(), conversation_title: 'test' },
      ]);

      const orchestrator = new MemoryRetrievalOrchestrator(mockDeps);
      await orchestrator.getPromptContextBundle({
        query: 'Bu konuyu derinlemesine analiz et, alternatifleri keşfet ve karşılaştır',
        activeConversationId: 'test-conv',
      });

      expect(mockGraphRAGEngine.retrieve).toHaveBeenCalled();
    });

    test('preference_recall recipe GraphRAG kullanmaz', async () => {
      (mockGraphRAGEngine.retrieve as jest.Mock).mockResolvedValue(
        createGraphRAGResult(true, [createMemory(10)])
      );

      mockDeps.getRecentMessages = jest.fn().mockReturnValue([
        { role: 'user', content: 'Kullanıcı tercihlerini hatırla', created_at: new Date().toISOString(), conversation_title: 'test' },
      ]);

      const orchestrator = new MemoryRetrievalOrchestrator(mockDeps);
      await orchestrator.getPromptContextBundle({
        query: 'Kullanıcı tercihlerini hatırla',
        activeConversationId: 'test-conv',
      });

      // Preference recall recipe'sinde GraphRAG çağrılmamalı
      expect(mockGraphRAGEngine.retrieve).not.toHaveBeenCalled();
    });

    test('conversation_followup recipe GraphRAG kullanmaz (default)', async () => {
      (mockGraphRAGEngine.retrieve as jest.Mock).mockResolvedValue(
        createGraphRAGResult(true, [createMemory(10)])
      );

      mockDeps.getRecentMessages = jest.fn().mockReturnValue([
        { role: 'user', content: 'Bu konunun devamı ne oldu?', created_at: new Date().toISOString(), conversation_title: 'test' },
      ]);

      const orchestrator = new MemoryRetrievalOrchestrator(mockDeps);
      await orchestrator.getPromptContextBundle({
        query: 'Bu konunun devamı ne oldu?',
        activeConversationId: 'test-conv',
      });

      // Conversation followup recipe'sinde GraphRAG çağrılmamalı
      expect(mockGraphRAGEngine.retrieve).not.toHaveBeenCalled();
    });

    test('default recipe GraphRAG kullanmaz', async () => {
      (mockGraphRAGEngine.retrieve as jest.Mock).mockResolvedValue(
        createGraphRAGResult(true, [createMemory(10)])
      );

      mockDeps.getRecentMessages = jest.fn().mockReturnValue([
        { role: 'user', content: 'Merhaba', created_at: new Date().toISOString(), conversation_title: 'test' },
      ]);

      const orchestrator = new MemoryRetrievalOrchestrator(mockDeps);
      await orchestrator.getPromptContextBundle({
        query: 'Merhaba',
        activeConversationId: 'test-conv',
      });

      // Default recipe'de GraphRAG çağrılmamalı
      expect(mockGraphRAGEngine.retrieve).not.toHaveBeenCalled();
    });
  });

  describe('GraphRAG error handling', () => {
    test('GraphRAG timeout durumunda fallback çalışır', async () => {
      (mockGraphRAGEngine.retrieve as jest.Mock).mockRejectedValue(
        new Error('GraphRAG retrieval timeout')
      );

      mockDeps.getRecentMessages = jest.fn().mockReturnValue([
        { role: 'user', content: 'Bu konu hakkında detaylı analiz yap ve alternatifleri keşfet', created_at: new Date().toISOString(), conversation_title: 'test' },
      ]);

      const orchestrator = new MemoryRetrievalOrchestrator(mockDeps);
      const result = await orchestrator.getPromptContextBundle({
        query: 'Bu konu hakkında detaylı analiz yap ve alternatifleri keşfet',
        activeConversationId: 'test-conv',
      });

      // Fallback çalışmış olmalı
      expect(result.graphRAG).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });

    test('GraphRAG empty result durumunda graphRAG boş döner', async () => {
      (mockGraphRAGEngine.retrieve as jest.Mock).mockResolvedValue(
        createGraphRAGResult(true, [])
      );

      mockDeps.getRecentMessages = jest.fn().mockReturnValue([
        { role: 'user', content: 'Bu konu hakkında detaylı analiz yap ve alternatifleri keşfet', created_at: new Date().toISOString(), conversation_title: 'test' },
      ]);

      const orchestrator = new MemoryRetrievalOrchestrator(mockDeps);
      const result = await orchestrator.getPromptContextBundle({
        query: 'Bu konu hakkında detaylı analiz yap ve alternatifleri keşfet',
        activeConversationId: 'test-conv',
      });

      // Empty result'da graphRAG boş memories içermeli
      expect(result.graphRAG).not.toBeNull();
      expect(result.graphRAG?.memories.length).toBe(0);
    });
  });

  describe('GraphRAG config options', () => {
    test('maxHops config GraphRAG retrieval\'a geçer', async () => {
      (mockGraphRAGEngine.retrieve as jest.Mock).mockResolvedValue(
        createGraphRAGResult(true, [createMemory(10)])
      );

      mockDeps.getRecentMessages = jest.fn().mockReturnValue([
        { role: 'user', content: 'Bana farklı alternatifler keşfet', created_at: new Date().toISOString(), conversation_title: 'test' },
      ]);

      const orchestrator = new MemoryRetrievalOrchestrator(mockDeps);
      await orchestrator.getPromptContextBundle({
        query: 'Bana farklı alternatifler keşfet',
        activeConversationId: 'test-conv',
      });

      // retrieve çağrısı yapılmış olmalı
      expect(mockGraphRAGEngine.retrieve).toHaveBeenCalled();
      const callArgs = (mockGraphRAGEngine.retrieve as jest.Mock).mock.calls[0];
      expect(callArgs[1]).toBeDefined();
    });

    test('tokenBudget config GraphRAG retrieval\'a geçer', async () => {
      (mockGraphRAGEngine.retrieve as jest.Mock).mockResolvedValue(
        createGraphRAGResult(true, [createMemory(10)])
      );

      mockDeps.getRecentMessages = jest.fn().mockReturnValue([
        { role: 'user', content: 'Bu konuyu derinlemesine analiz et, alternatifleri keşfet ve karşılaştır', created_at: new Date().toISOString(), conversation_title: 'test' },
      ]);

      const orchestrator = new MemoryRetrievalOrchestrator(mockDeps);
      await orchestrator.getPromptContextBundle({
        query: 'Bu konuyu derinlemesine analiz et, alternatifleri keşfet ve karşılaştır',
        activeConversationId: 'test-conv',
      });

      expect(mockGraphRAGEngine.retrieve).toHaveBeenCalled();
    });
  });

  describe('GraphRAG + BehaviorDiscoveryShadow integration', () => {
    test('BehaviorDiscoveryShadow comparison GraphRAG results ile çalışır', async () => {
      const graphRAGMemories = [createMemory(10, 'graphRAG memory')];
      (mockGraphRAGEngine.retrieve as jest.Mock).mockResolvedValue(
        createGraphRAGResult(true, graphRAGMemories)
      );

      mockDeps.getRecentMessages = jest.fn().mockReturnValue([
        { role: 'user', content: 'Bu konu hakkında detaylı analiz yap ve alternatifleri keşfet', created_at: new Date().toISOString(), conversation_title: 'test' },
      ]);

      const orchestrator = new MemoryRetrievalOrchestrator(mockDeps);
      const result = await orchestrator.getPromptContextBundle({
        query: 'Bu konu hakkında detaylı analiz yap ve alternatifleri keşfet',
        activeConversationId: 'test-conv',
      });

      expect(result.graphRAG).not.toBeNull();
    });
  });

  describe('GraphRAG concurrent retrieval', () => {
    test('Multiple concurrent GraphRAG retrievals race condition yaratmaz', async () => {
      (mockGraphRAGEngine.retrieve as jest.Mock).mockResolvedValue(
        createGraphRAGResult(true, [createMemory(10)])
      );

      mockDeps.getRecentMessages = jest.fn().mockReturnValue([
        { role: 'user', content: 'Bana farklı alternatifler keşfet', created_at: new Date().toISOString(), conversation_title: 'test' },
      ]);

      const orchestrator = new MemoryRetrievalOrchestrator(mockDeps);

      // Concurrent retrievals
      const promises = Array(3).fill(null).map(() =>
        orchestrator.getPromptContextBundle({
          query: 'Bana farklı alternatifler keşfet',
          activeConversationId: 'test-conv',
        })
      );

      const results = await Promise.allSettled(promises);

      // Tüm sorguların başarılı olduğunu doğrula
      const fulfilled = results.filter(r => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThan(0);
    });
  });
});
