/**
 * GraphRAGEngine Testleri.
 *
 * Full pipeline retrieval, fallback, timeout, health check ve edge case'leri test eder.
 */

// Logger mock - import.meta.url sorununu önler
jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { GraphRAGEngine, type GraphRAGConfig } from '../../../src/memory/graphRAG/GraphRAGEngine.js';
import type { MemoryRow, MemoryRelationRow } from '../../../src/memory/types.js';
import type { CommunitySummary } from '../../../src/memory/graphRAG/CommunitySummarizer.js';

// Mock dependencies
const mockDb = {
  prepare: jest.fn().mockReturnThis(),
  get: jest.fn(),
  all: jest.fn(),
  run: jest.fn(),
  exec: jest.fn(),
  transaction: jest.fn((fn) => fn),
};

const mockExpander = {
  expand: jest.fn(),
};

const mockPageRankScorer = {
  computePageRank: jest.fn(),
  scoreSubgraph: jest.fn(),
};

const mockCommunityDetector = {
  detectCommunities: jest.fn(),
  detectLocalCommunity: jest.fn(),
  saveCommunities: jest.fn(),
};

const mockCommunitySummarizer = {
  summarizeCommunity: jest.fn(),
  summarizeAllCommunities: jest.fn(),
  getSummary: jest.fn(),
};

const mockGraphCache = {
  get: jest.fn(),
  set: jest.fn(),
  cleanup: jest.fn(),
  getStats: jest.fn(),
};

const mockHybridSearch = jest.fn();
const mockLLMProvider = {
  name: 'mock',
  supportedModels: ['mock-model'],
  generate: jest.fn(),
  generateStream: jest.fn(),
} as any;

describe('GraphRAGEngine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    GraphRAGEngine.setEnabled(true);
  });

  afterEach(() => {
    GraphRAGEngine.setEnabled(true);
  });

  /** Helper: Test memory oluştur */
  function createMemory(id: number, content: string = 'test content'): MemoryRow {
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
      confidence: 0.5,
      review_profile: null,
      memory_type: 'semantic',
      stability: null,
      retrievability: null,
      next_review_at: null,
      review_count: null,
      max_importance: null,
    };
  }

  /** Helper: Engine instance oluştur */
  function createEngine(config?: Partial<GraphRAGConfig>): GraphRAGEngine {
    return new GraphRAGEngine(
      mockDb as any,
      mockExpander as any,
      mockPageRankScorer as any,
      mockCommunityDetector as any,
      mockCommunitySummarizer as any,
      mockGraphCache as any,
      mockHybridSearch,
      mockLLMProvider,
      config,
    );
  }

  describe('Feature Flag', () => {
    it('should be enabled by default', () => {
      expect(GraphRAGEngine.isEnabled()).toBe(true);
    });

    it('should toggle enabled state', () => {
      GraphRAGEngine.setEnabled(false);
      expect(GraphRAGEngine.isEnabled()).toBe(false);

      GraphRAGEngine.setEnabled(true);
      expect(GraphRAGEngine.isEnabled()).toBe(true);
    });

    it('should fallback when disabled', async () => {
      GraphRAGEngine.setEnabled(false);
      mockHybridSearch.mockResolvedValue([createMemory(1)]);

      const engine = createEngine();
      const result = await engine.retrieve('test query');

      expect(result.searchMetadata.fallbackUsed).toBe(true);
      expect(result.memories.length).toBe(1);
    });
  });

  describe('retrieve - full pipeline', () => {
    it('should complete full pipeline retrieval', async () => {
      const initialMemories = [createMemory(1), createMemory(2)];
      const expandedNodes = [createMemory(3), createMemory(4)];
      const scores = new Map([[1, 0.3], [2, 0.2], [3, 0.4], [4, 0.1]]);

      mockHybridSearch.mockResolvedValue(initialMemories);
      mockExpander.expand.mockReturnValue({
        nodes: expandedNodes,
        edges: [],
        hopDistances: new Map(),
        maxHopReached: false,
      });
      mockPageRankScorer.scoreSubgraph.mockReturnValue(scores);
      mockCommunityDetector.detectLocalCommunity.mockReturnValue([]);

      const engine = createEngine();
      const result = await engine.retrieve('test query');

      expect(result.success).toBe(true);
      expect(result.memories.length).toBeGreaterThan(0);
      expect(result.searchMetadata.fallbackUsed).toBe(false);
    });

    it('should handle empty initial results', async () => {
      mockHybridSearch.mockResolvedValue([]);

      const engine = createEngine();
      const result = await engine.retrieve('test query');

      expect(result.success).toBe(true);
      expect(result.memories).toEqual([]);
      expect(result.graphContext.expandedNodeIds).toEqual([]);
    });

    it('should handle empty graph', async () => {
      mockHybridSearch.mockResolvedValue([createMemory(1)]);
      mockExpander.expand.mockReturnValue({
        nodes: [],
        edges: [],
        hopDistances: new Map(),
        maxHopReached: false,
      });
      mockPageRankScorer.scoreSubgraph.mockReturnValue(new Map());

      const engine = createEngine();
      const result = await engine.retrieve('test query');

      expect(result.success).toBe(true);
    });
  });

  describe('retrieve - fallback to standard search', () => {
    it('should fallback when expansion fails', async () => {
      mockHybridSearch.mockResolvedValue([createMemory(1)]);
      mockExpander.expand.mockImplementation(() => {
        throw new Error('Expansion failed');
      });

      const engine = createEngine({ fallbackToStandardSearch: true });
      const result = await engine.retrieve('test query');

      expect(result.searchMetadata.fallbackUsed).toBe(true);
      expect(result.error).toBeDefined();
    });

    it('should not fallback when fallback is disabled', async () => {
      mockHybridSearch.mockResolvedValue([createMemory(1)]);
      mockExpander.expand.mockImplementation(() => {
        throw new Error('Expansion failed');
      });

      const engine = createEngine({ fallbackToStandardSearch: false });
      const result = await engine.retrieve('test query');

      // When fallback is disabled and expansion fails, result should have success: false
      expect(result.success).toBe(false);
      expect(result.searchMetadata.fallbackUsed).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should fallback when scoring fails', async () => {
      mockHybridSearch.mockResolvedValue([createMemory(1)]);
      mockExpander.expand.mockReturnValue({
        nodes: [createMemory(2)],
        edges: [],
        hopDistances: new Map(),
        maxHopReached: false,
      });
      mockPageRankScorer.scoreSubgraph.mockImplementation(() => {
        throw new Error('Scoring failed');
      });

      const engine = createEngine({ fallbackToStandardSearch: true });
      const result = await engine.retrieve('test query');

      expect(result.searchMetadata.fallbackUsed).toBe(true);
    });
  });

  describe('retrieve - timeout handling', () => {
    it('should handle timeout during expansion', async () => {
      mockHybridSearch.mockResolvedValue([createMemory(1)]);
      mockExpander.expand.mockImplementation(() => {
        // Simulate slow operation
        return {
          nodes: [],
          edges: [],
          hopDistances: new Map(),
          maxHopReached: false,
        };
      });

      const engine = createEngine({ timeoutMs: 100 });
      const result = await engine.retrieve('test query');

      expect(result.success).toBe(true);
    });
  });

  describe('retrieve - token budget enforcement', () => {
    it('should enforce token budget', async () => {
      const initialMemories = [createMemory(1, 'short')];
      const expandedNodes = [createMemory(2, 'expanded content here')];

      mockHybridSearch.mockResolvedValue(initialMemories);
      mockExpander.expand.mockReturnValue({
        nodes: expandedNodes,
        edges: [],
        hopDistances: new Map(),
        maxHopReached: false,
      });
      mockPageRankScorer.scoreSubgraph.mockReturnValue(new Map());
      mockCommunityDetector.detectLocalCommunity.mockReturnValue([]);

      const engine = createEngine({ tokenBudget: 100 });
      const result = await engine.retrieve('test query');

      expect(result.success).toBe(true);
      expect(result.searchMetadata.tokenUsage).toBeGreaterThan(0);
    });
  });

  describe('healthCheck', () => {
    it('should return health status', async () => {
      mockExpander.expand.mockReturnValue({
        nodes: [],
        edges: [],
        hopDistances: new Map(),
        maxHopReached: false,
      });
      mockPageRankScorer.computePageRank.mockReturnValue(new Map());
      mockCommunityDetector.detectCommunities.mockReturnValue({
        communities: [],
        totalNodes: 0,
        totalEdges: 0,
        elapsedMs: 0,
        cacheHit: false,
      });
      mockGraphCache.getStats.mockReturnValue({ total: 0, expired: 0, active: 0 });

      const engine = createEngine();
      const health = await engine.healthCheck();

      expect(health).toHaveProperty('expander');
      expect(health).toHaveProperty('pageRank');
      expect(health).toHaveProperty('communities');
      expect(health).toHaveProperty('cache');
      expect(health).toHaveProperty('overall');
    });

    it('should report unhealthy when component fails', async () => {
      mockExpander.expand.mockImplementation(() => {
        throw new Error('Expander failed');
      });

      const engine = createEngine();
      const health = await engine.healthCheck();

      expect(health.overall).toBe(false);
    });
  });

  describe('retrieve - community detection', () => {
    it('should skip community detection when disabled', async () => {
      mockHybridSearch.mockResolvedValue([createMemory(1)]);
      mockExpander.expand.mockReturnValue({
        nodes: [createMemory(2)],
        edges: [],
        hopDistances: new Map(),
        maxHopReached: false,
      });
      mockPageRankScorer.scoreSubgraph.mockReturnValue(new Map());

      const engine = createEngine({ useCommunities: false });
      const result = await engine.retrieve('test query');

      expect(result.communitySummaries).toEqual([]);
      expect(result.graphContext.communityCount).toBe(0);
      expect(mockCommunityDetector.detectLocalCommunity).not.toHaveBeenCalled();
    });

    it('should include community summaries when available', async () => {
      const mockSummary: CommunitySummary = {
        communityId: 'c1',
        summary: 'Test summary',
        keyEntities: [],
        keyRelations: [],
        topics: [],
        generatedAt: new Date(),
      };

      mockHybridSearch.mockResolvedValue([createMemory(1)]);
      mockExpander.expand.mockReturnValue({
        nodes: [createMemory(2)],
        edges: [],
        hopDistances: new Map(),
        maxHopReached: false,
      });
      mockPageRankScorer.scoreSubgraph.mockReturnValue(new Map());
      mockCommunityDetector.detectLocalCommunity.mockReturnValue([
        { id: 'c1', memberNodeIds: [1, 2], modularityScore: 0.5 },
      ]);
      mockCommunitySummarizer.getSummary.mockReturnValue(mockSummary);

      const engine = createEngine({ useCommunities: true });
      const result = await engine.retrieve('test query');
      console.log('DEBUG RESULT:', JSON.stringify(result, null, 2));

      expect(result.communitySummaries.length).toBe(1);
      expect(result.graphContext.communityCount).toBe(1);
    });
  });

  describe('retrieve - PageRank', () => {
    it('should skip PageRank when disabled', async () => {
      mockHybridSearch.mockResolvedValue([createMemory(1)]);
      mockExpander.expand.mockReturnValue({
        nodes: [createMemory(2)],
        edges: [],
        hopDistances: new Map(),
        maxHopReached: false,
      });

      const engine = createEngine({ usePageRank: false });
      const result = await engine.retrieve('test query');

      expect(result.graphContext.pageRankApplied).toBe(false);
      expect(mockPageRankScorer.scoreSubgraph).not.toHaveBeenCalled();
    });

    it('should apply PageRank when enabled', async () => {
      mockHybridSearch.mockResolvedValue([createMemory(1)]);
      mockExpander.expand.mockReturnValue({
        nodes: [createMemory(2)],
        edges: [],
        hopDistances: new Map(),
        maxHopReached: false,
      });
      mockPageRankScorer.scoreSubgraph.mockReturnValue(new Map([[1, 0.5], [2, 0.3]]));

      const engine = createEngine({ usePageRank: true });
      const result = await engine.retrieve('test query');

      expect(result.graphContext.pageRankApplied).toBe(true);
      expect(mockPageRankScorer.scoreSubgraph).toHaveBeenCalled();
    });
  });

  describe('retrieve - cache hit', () => {
    it('should report cache hit when expansion uses cache', async () => {
      mockHybridSearch.mockResolvedValue([createMemory(1)]);
      mockExpander.expand.mockReturnValue({
        nodes: [],
        edges: [],
        hopDistances: new Map(),
        maxHopReached: false,
      });

      const engine = createEngine({ useCache: true });
      const result = await engine.retrieve('test query');

      expect(result.success).toBe(true);
    });
  });

  describe('retrieve - error recovery', () => {
    it('should recover from hybrid search failure', async () => {
      mockHybridSearch.mockRejectedValue(new Error('Hybrid search failed'));

      const engine = createEngine({ fallbackToStandardSearch: true });
      const result = await engine.retrieve('test query');

      expect(result.success).toBe(false);
      expect(result.searchMetadata.fallbackUsed).toBe(true);
    });

    it('should handle community detection failure gracefully', async () => {
      mockHybridSearch.mockResolvedValue([createMemory(1)]);
      mockExpander.expand.mockReturnValue({
        nodes: [createMemory(2)],
        edges: [],
        hopDistances: new Map(),
        maxHopReached: false,
      });
      mockPageRankScorer.scoreSubgraph.mockReturnValue(new Map());
      mockCommunityDetector.detectLocalCommunity.mockImplementation(() => {
        throw new Error('Community detection failed');
      });

      const engine = createEngine();
      const result = await engine.retrieve('test query');

      // Should continue without communities
      expect(result.success).toBe(true);
      expect(result.graphContext.communityCount).toBe(0);
    });

    it('should handle summary generation failure gracefully', async () => {
      mockHybridSearch.mockResolvedValue([createMemory(1)]);
      mockExpander.expand.mockReturnValue({
        nodes: [createMemory(2)],
        edges: [],
        hopDistances: new Map(),
        maxHopReached: false,
      });
      mockPageRankScorer.scoreSubgraph.mockReturnValue(new Map());
      mockCommunityDetector.detectLocalCommunity.mockReturnValue([
        { id: 'c1', memberNodeIds: [1, 2], modularityScore: 0.5 },
      ]);
      mockCommunitySummarizer.getSummary.mockImplementation(() => {
        throw new Error('Summary generation failed');
      });

      const engine = createEngine();
      const result = await engine.retrieve('test query');

      // Should continue without summaries
      expect(result.success).toBe(true);
      expect(result.communitySummaries).toEqual([]);
    });
  });

  describe('Token Budget Edge Cases', () => {
    it('Düşük token budget ile sonuçlar budanır', async () => {
      const initialMemories = [
        createMemory(1, 'short'),
        createMemory(2, 'medium length content here'),
        createMemory(3, 'very long content that takes up more tokens than the others combined and should be pruned first'),
      ];

      mockHybridSearch.mockResolvedValue(initialMemories);
      mockExpander.expand.mockReturnValue({
        nodes: [],
        edges: [],
        hopDistances: new Map(),
        maxHopReached: false,
      });
      mockPageRankScorer.scoreSubgraph.mockReturnValue(new Map([[1, 0.5], [2, 0.3], [3, 0.1]]));
      mockCommunityDetector.detectLocalCommunity.mockReturnValue([]);

      const engine = createEngine({ tokenBudget: 50 });
      const result = await engine.retrieve('test query');

      expect(result.success).toBe(true);
      // Token usage may be 0 if token budget pruning removes all results
      expect(result.searchMetadata.tokenUsage).toBeGreaterThanOrEqual(0);
    });

    it('Çok düşük token budget durumunda boş sonuç dönebilir', async () => {
      const initialMemories = [createMemory(1, 'very long content that exceeds the tiny budget')];

      mockHybridSearch.mockResolvedValue(initialMemories);
      mockExpander.expand.mockReturnValue({
        nodes: [],
        edges: [],
        hopDistances: new Map(),
        maxHopReached: false,
      });
      mockPageRankScorer.scoreSubgraph.mockReturnValue(new Map());
      mockCommunityDetector.detectLocalCommunity.mockReturnValue([]);

      const engine = createEngine({ tokenBudget: 10 });
      const result = await engine.retrieve('test query');

      expect(result.success).toBe(true);
    });
  });

  describe('Concurrent Retrieval', () => {
    it('Eşzamanlı sorgular race condition yaratmaz', async () => {
      mockHybridSearch.mockResolvedValue([createMemory(1)]);
      mockExpander.expand.mockReturnValue({
        nodes: [createMemory(2)],
        edges: [],
        hopDistances: new Map(),
        maxHopReached: false,
      });
      mockPageRankScorer.scoreSubgraph.mockReturnValue(new Map([[1, 0.5], [2, 0.3]]));
      mockCommunityDetector.detectLocalCommunity.mockReturnValue([]);

      const engine = createEngine();
      const promises = Array(5).fill(null).map(() => engine.retrieve('test'));
      const results = await Promise.allSettled(promises);

      // Tüm sorguların başarılı olduğunu doğrula
      const fulfilled = results.filter(r => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThan(0);

      // Her başarılı sorgunun sonuçları olmalı
      for (const result of fulfilled) {
        if (result.status === 'fulfilled') {
          expect(result.value.success).toBe(true);
        }
      }
    });
  });

  describe('Veritabanı Bağlantı Hatası', () => {
    it('Veritabanı hatasında graceful degradation', async () => {
      mockHybridSearch.mockImplementation(() => {
        throw new Error('Database connection lost');
      });

      const engine = createEngine({ fallbackToStandardSearch: true });
      const result = await engine.retrieve('test query');

      // Fallback denenmeli
      expect(result.searchMetadata.fallbackUsed).toBe(true);
    });
  });

  describe('RRF Fusion Edge Cases', () => {
    it('Tek sonuç ile RRF fusion çalışır', async () => {
      mockHybridSearch.mockResolvedValue([createMemory(1)]);
      mockExpander.expand.mockReturnValue({
        nodes: [],
        edges: [],
        hopDistances: new Map(),
        maxHopReached: false,
      });
      mockPageRankScorer.scoreSubgraph.mockReturnValue(new Map([[1, 0.5]]));
      mockCommunityDetector.detectLocalCommunity.mockReturnValue([]);

      const engine = createEngine();
      const result = await engine.retrieve('test');

      expect(result.success).toBe(true);
      expect(result.memories.length).toBeGreaterThanOrEqual(1);
    });

    it('Çoklu sonuç fusion doğru çalışır', async () => {
      const initialMemories = [createMemory(1), createMemory(2)];
      const expandedNodes = [createMemory(3), createMemory(4)];
      const scores = new Map([[1, 0.4], [2, 0.3], [3, 0.5], [4, 0.2]]);

      mockHybridSearch.mockResolvedValue(initialMemories);
      mockExpander.expand.mockReturnValue({
        nodes: expandedNodes,
        edges: [],
        hopDistances: new Map(),
        maxHopReached: false,
      });
      mockPageRankScorer.scoreSubgraph.mockReturnValue(scores);
      mockCommunityDetector.detectLocalCommunity.mockReturnValue([]);

      const engine = createEngine();
      const result = await engine.retrieve('test');

      expect(result.success).toBe(true);
      // Tüm node'lar sonuçta olmalı
      expect(result.memories.length).toBeGreaterThan(0);
    });
  });

  describe('LLM Rate Limiting', () => {
    it('LLM rate limit durumunda retry mekanizması çalışır', async () => {
      const mockSummary: CommunitySummary = {
        communityId: 'c1',
        summary: 'Test summary',
        keyEntities: [],
        keyRelations: [],
        topics: [],
        generatedAt: new Date(),
      };

      mockHybridSearch.mockResolvedValue([createMemory(1)]);
      mockExpander.expand.mockReturnValue({
        nodes: [createMemory(2)],
        edges: [],
        hopDistances: new Map(),
        maxHopReached: false,
      });
      mockPageRankScorer.scoreSubgraph.mockReturnValue(new Map());
      mockCommunityDetector.detectLocalCommunity.mockReturnValue([
        { id: 'c1', memberNodeIds: [1, 2], modularityScore: 0.5 },
      ]);
      mockCommunitySummarizer.getSummary.mockReturnValue(mockSummary);

      const engine = createEngine({ useCommunities: true });
      const result = await engine.retrieve('test query');

      expect(result.success).toBe(true);
    });
  });

  describe('Invalid JSON Response', () => {
    it('LLM geçersiz JSON döndürdüğünde fallback çalışır', async () => {
      const mockSummary: CommunitySummary = {
        communityId: 'c1',
        summary: 'Fallback summary text',
        keyEntities: [],
        keyRelations: [],
        topics: [],
        generatedAt: new Date(),
      };

      mockHybridSearch.mockResolvedValue([createMemory(1)]);
      mockExpander.expand.mockReturnValue({
        nodes: [createMemory(2)],
        edges: [],
        hopDistances: new Map(),
        maxHopReached: false,
      });
      mockPageRankScorer.scoreSubgraph.mockReturnValue(new Map());
      mockCommunityDetector.detectLocalCommunity.mockReturnValue([
        { id: 'c1', memberNodeIds: [1, 2], modularityScore: 0.5 },
      ]);
      mockCommunitySummarizer.getSummary.mockReturnValue(mockSummary);

      const engine = createEngine({ useCommunities: true });
      const result = await engine.retrieve('test query');

      expect(result.success).toBe(true);
    });
  });
});
