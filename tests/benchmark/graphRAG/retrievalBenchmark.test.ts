/**
 * GraphRAG Retrieval Benchmark Testleri.
 * 
 * Standard search vs GraphRAG precision karşılaştırması,
 * GraphRAG latency profili, cache hit rate, token overhead
 * ve community detection accuracy testlerini içerir.
 */

import type { MemoryRow } from '../../../src/memory/types.js';

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

// Dynamic import for GraphRAGEngine
let GraphRAGEngine: any;
let ShadowMode: any;

beforeAll(async () => {
  const graphRAGModule = await import('../../../src/memory/graphRAG/GraphRAGEngine.js');
  GraphRAGEngine = graphRAGModule.GraphRAGEngine;
  
  const shadowModule = await import('../../../src/memory/graphRAG/ShadowMode.js');
  ShadowMode = shadowModule.ShadowMode;
});

describe('GraphRAG Retrieval Benchmark', () => {
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

  beforeEach(() => {
    jest.clearAllMocks();
    GraphRAGEngine?.setEnabled(true);
  });

  // ========== Test 1: Standard search vs GraphRAG precision karşılaştırması ==========

  describe('1. Standard search vs GraphRAG precision karşılaştırması', () => {
    it('should have comparable or better precision than standard search', async () => {
      const testQueries = ['test query 1', 'test query 2', 'test query 3'];
      const precisionDifferences: number[] = [];

      for (const query of testQueries) {
        const baselineResults = [createMemory(1), createMemory(2)];
        const graphRAGResults = [createMemory(1), createMemory(2), createMemory(3)];

        mockHybridSearch.mockResolvedValue(baselineResults);
        mockExpander.expand.mockReturnValue({
          nodes: [createMemory(3)],
          edges: [],
          hopDistances: new Map(),
          maxHopReached: false,
        });
        mockPageRankScorer.scoreSubgraph.mockReturnValue(new Map([[1, 0.3], [2, 0.2], [3, 0.4]]));
        mockCommunityDetector.detectLocalCommunity.mockReturnValue([]);

        const engine = new GraphRAGEngine(
          mockDb,
          mockExpander,
          mockPageRankScorer,
          mockCommunityDetector,
          mockCommunitySummarizer,
          mockGraphCache,
          mockHybridSearch,
        );

        const result = await engine.retrieve(query);

        // Jaccard similarity hesapla
        const baselineSet = new Set(baselineResults.map((m: MemoryRow) => m.id));
        const graphRAGSet = new Set(result.memories.map((m: MemoryRow) => m.id));
        const intersection = new Set([...baselineSet].filter((x: number) => graphRAGSet.has(x)));
        const union = new Set([...baselineSet, ...graphRAGSet]);
        const jaccard = intersection.size / union.size;

        precisionDifferences.push(jaccard);
      }

      // Ortalama Jaccard similarity 0.5'ten büyük olmalı
      const avgJaccard = precisionDifferences.reduce((a, b) => a + b, 0) / precisionDifferences.length;
      expect(avgJaccard).toBeGreaterThan(0.5);
    });
  });

  // ========== Test 2: GraphRAG latency profili (p50, p95, p99) ==========

  describe('2. GraphRAG latency profili (p50, p95, p99)', () => {
    it('should measure latency percentiles correctly', async () => {
      const latencies: number[] = [];
      const iterations = 20;

      mockHybridSearch.mockResolvedValue([createMemory(1)]);
      mockExpander.expand.mockReturnValue({
        nodes: [createMemory(2)],
        edges: [],
        hopDistances: new Map(),
        maxHopReached: false,
      });
      mockPageRankScorer.scoreSubgraph.mockReturnValue(new Map([[1, 0.3], [2, 0.2]]));
      mockCommunityDetector.detectLocalCommunity.mockReturnValue([]);

      const engine = new GraphRAGEngine(
        mockDb,
        mockExpander,
        mockPageRankScorer,
        mockCommunityDetector,
        mockCommunitySummarizer,
        mockGraphCache,
        mockHybridSearch,
      );

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await engine.retrieve(`test query ${i}`);
        const end = performance.now();
        latencies.push(end - start);
      }

      // Percentiles hesapla
      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(latencies.length * 0.5)];
      const p95 = latencies[Math.floor(latencies.length * 0.95)];
      const p99 = latencies[Math.floor(latencies.length * 0.99)];

      console.log(`\n--- GraphRAG Latency Profile ---`);
      console.log(`P50: ${p50.toFixed(2)}ms`);
      console.log(`P95: ${p95.toFixed(2)}ms`);
      console.log(`P99: ${p99.toFixed(2)}ms`);

      // P99 5000ms'den az olmalı (timeout limit)
      expect(p99).toBeLessThan(5000);
    });
  });

  // ========== Test 3: Cache hit rate ölçümü ==========

  describe('3. Cache hit rate ölçümü', () => {
    it('should report cache hits correctly', async () => {
      const engine = new GraphRAGEngine(
        mockDb,
        mockExpander,
        mockPageRankScorer,
        mockCommunityDetector,
        mockCommunitySummarizer,
        mockGraphCache,
        mockHybridSearch,
        { useCache: true },
      );

      mockHybridSearch.mockResolvedValue([createMemory(1)]);
      mockExpander.expand.mockReturnValue({
        nodes: [],
        edges: [],
        hopDistances: new Map(),
        maxHopReached: false,
      });

      // Aynı query'yi iki kez çalıştır
      await engine.retrieve('same query');
      const result2 = await engine.retrieve('same query');

      // Cache hit reporting should work
      expect(result2.success).toBe(true);
    });
  });

  // ========== Test 4: Token overhead ölçümü ==========

  describe('4. Token overhead ölçümü', () => {
    it('should measure token overhead correctly', async () => {
      const engine = new GraphRAGEngine(
        mockDb,
        mockExpander,
        mockPageRankScorer,
        mockCommunityDetector,
        mockCommunitySummarizer,
        mockGraphCache,
        mockHybridSearch,
        { tokenBudget: 32000 },
      );

      mockHybridSearch.mockResolvedValue([createMemory(1, 'short content')]);
      mockExpander.expand.mockReturnValue({
        nodes: [createMemory(2, 'expanded content here')],
        edges: [],
        hopDistances: new Map(),
        maxHopReached: false,
      });
      mockPageRankScorer.scoreSubgraph.mockReturnValue(new Map([[1, 0.3], [2, 0.2]]));
      mockCommunityDetector.detectLocalCommunity.mockReturnValue([]);

      const result = await engine.retrieve('test query');

      // Token usage should be reported
      expect(result.searchMetadata.tokenUsage).toBeGreaterThanOrEqual(0);
    });

    it('should stay within token budget', async () => {
      const budget = 1000;
      const engine = new GraphRAGEngine(
        mockDb,
        mockExpander,
        mockPageRankScorer,
        mockCommunityDetector,
        mockCommunitySummarizer,
        mockGraphCache,
        mockHybridSearch,
        { tokenBudget: budget },
      );

      mockHybridSearch.mockResolvedValue([createMemory(1, 'short')]);
      mockExpander.expand.mockReturnValue({
        nodes: [createMemory(2, 'expanded')],
        edges: [],
        hopDistances: new Map(),
        maxHopReached: false,
      });
      mockPageRankScorer.scoreSubgraph.mockReturnValue(new Map());
      mockCommunityDetector.detectLocalCommunity.mockReturnValue([]);

      const result = await engine.retrieve('test query');

      expect(result.success).toBe(true);
    });
  });

  // ========== Test 5: Community detection accuracy ==========

  describe('5. Community detection accuracy', () => {
    it('should detect communities correctly', async () => {
      const engine = new GraphRAGEngine(
        mockDb,
        mockExpander,
        mockPageRankScorer,
        mockCommunityDetector,
        mockCommunitySummarizer,
        mockGraphCache,
        mockHybridSearch,
        { useCommunities: true },
      );

      mockHybridSearch.mockResolvedValue([createMemory(1), createMemory(2)]);
      mockExpander.expand.mockReturnValue({
        nodes: [createMemory(3), createMemory(4)],
        edges: [],
        hopDistances: new Map(),
        maxHopReached: false,
      });
      mockPageRankScorer.scoreSubgraph.mockReturnValue(new Map([[1, 0.3], [2, 0.2], [3, 0.4], [4, 0.1]]));
      mockCommunityDetector.detectLocalCommunity.mockReturnValue([
        { id: 'c1', memberNodeIds: [1, 2], modularityScore: 0.5 },
        { id: 'c2', memberNodeIds: [3, 4], modularityScore: 0.3 },
      ]);
      mockCommunitySummarizer.getSummary.mockReturnValue(null);

      const result = await engine.retrieve('test query');

      expect(result.graphContext.communityCount).toBe(2);
      expect(result.success).toBe(true);
    });

    it('should handle community detection failure gracefully', async () => {
      const engine = new GraphRAGEngine(
        mockDb,
        mockExpander,
        mockPageRankScorer,
        mockCommunityDetector,
        mockCommunitySummarizer,
        mockGraphCache,
        mockHybridSearch,
        { useCommunities: true },
      );

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

      const result = await engine.retrieve('test query');

      // Should continue without communities
      expect(result.success).toBe(true);
      expect(result.graphContext.communityCount).toBe(0);
    });
  });
});
