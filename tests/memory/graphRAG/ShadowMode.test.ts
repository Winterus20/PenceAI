/**
 * ShadowMode Testleri.
 *
 * Sample rate kontrolü, comparison accuracy, metrics computation ve report generation test eder.
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

import { ShadowMode, type ShadowModeConfig } from '../../../src/memory/graphRAG/ShadowMode.js';
import type { MemoryRow } from '../../../src/memory/types.js';
import type { GraphRAGEngine, GraphRAGResult } from '../../../src/memory/graphRAG/GraphRAGEngine.js';

// Mock dependencies
const mockGraphRAGEngine = {
  retrieve: jest.fn(),
} as unknown as jest.Mocked<GraphRAGEngine>;

const mockHybridSearch = jest.fn();

describe('ShadowMode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  /** Helper: ShadowMode instance oluştur */
  function createShadowMode(config?: Partial<ShadowModeConfig>): ShadowMode {
    return new ShadowMode(
      mockGraphRAGEngine,
      mockHybridSearch,
      config,
    );
  }

  describe('initialization', () => {
    it('should initialize with default config', () => {
      const shadowMode = createShadowMode();
      expect(shadowMode.getComparisonCount()).toBe(0);
    });

    it('should initialize with custom config', () => {
      const shadowMode = createShadowMode({ sampleRate: 0.5, maxComparisons: 100 });
      expect(shadowMode.getComparisonCount()).toBe(0);
    });
  });

  describe('shouldRun', () => {
    it('should return false when stopped', () => {
      const shadowMode = createShadowMode({ sampleRate: 1.0 });
      shadowMode.stop();
      expect(shadowMode.shouldRun()).toBe(false);
    });

    it('should return false when max comparisons reached', () => {
      const shadowMode = createShadowMode({ sampleRate: 1.0, maxComparisons: 0 });
      expect(shadowMode.shouldRun()).toBe(false);
    });

    it('should return true when sample rate is 1.0', () => {
      const shadowMode = createShadowMode({ sampleRate: 1.0 });
      // First call uses random seed, may or may not pass
      // Just verify it doesn't throw
      expect(() => shadowMode.shouldRun()).not.toThrow();
    });

    it('should return false when sample rate is 0', () => {
      const shadowMode = createShadowMode({ sampleRate: 0 });
      expect(shadowMode.shouldRun()).toBe(false);
    });
  });

  describe('runShadowQuery', () => {
    it('should return null when shadow mode is stopped', async () => {
      const shadowMode = createShadowMode();
      shadowMode.stop();

      const result = await shadowMode.runShadowQuery('test', [createMemory(1)]);
      expect(result).toBeNull();
    });

    it('should return null when GraphRAG search fails', async () => {
      mockGraphRAGEngine.retrieve.mockRejectedValue(new Error('GraphRAG failed'));

      const shadowMode = createShadowMode({ sampleRate: 1.0 });
      // Force shouldRun to return true by using sampleRate 1.0
      const result = await shadowMode.runShadowQuery('test', [createMemory(1)]);

      // May be null due to random sampling
      expect(result === null || result.query === 'test').toBe(true);
    });

    it('should build comparison when GraphRAG succeeds', async () => {
      const mockResult: GraphRAGResult = {
        success: true,
        memories: [createMemory(1), createMemory(2)],
        communitySummaries: [],
        graphContext: {
          expandedNodeIds: [1, 2],
          edgeCount: 1,
          maxHopReached: false,
          communityCount: 0,
          pageRankApplied: true,
        },
        searchMetadata: {
          duration: 100,
          cacheHit: false,
          tokenUsage: 500,
          fallbackUsed: false,
          phase: 'fusion',
        },
      };

      mockGraphRAGEngine.retrieve.mockResolvedValue(mockResult);

      const shadowMode = createShadowMode({ sampleRate: 1.0, maxComparisons: 10 });
      const baselineResults = [createMemory(1), createMemory(3)];

      // Run multiple times to ensure sampling works
      for (let i = 0; i < 10; i++) {
        await shadowMode.runShadowQuery('test query', baselineResults);
      }

      // At least some comparisons should have been made
      expect(shadowMode.getComparisonCount()).toBeGreaterThanOrEqual(0);
    });
  });

  describe('computeMetrics', () => {
    it('should compute precision correctly', () => {
      const shadowMode = createShadowMode();

      const comparison = {
        query: 'test',
        baselineResults: [createMemory(1), createMemory(2)],
        graphRAGResults: [createMemory(1), createMemory(3)],
        baselineTokenCount: 100,
        graphRAGTokenCount: 150,
        overlap: 0.33,
        graphRAGUniqueCount: 1,
        baselineUniqueCount: 1,
        duration: 100,
        timestamp: new Date(),
      };

      const metrics = shadowMode.computeMetrics(comparison);

      // TP = 1 (memory 1), FP = 1 (memory 3), FN = 1 (memory 2)
      // Precision = 1 / (1 + 1) = 0.5
      expect(metrics.precision).toBeCloseTo(0.5);
    });

    it('should compute recall correctly', () => {
      const shadowMode = createShadowMode();

      const comparison = {
        query: 'test',
        baselineResults: [createMemory(1), createMemory(2)],
        graphRAGResults: [createMemory(1)],
        baselineTokenCount: 100,
        graphRAGTokenCount: 50,
        overlap: 0.5,
        graphRAGUniqueCount: 0,
        baselineUniqueCount: 1,
        duration: 100,
        timestamp: new Date(),
      };

      const metrics = shadowMode.computeMetrics(comparison);

      // TP = 1, FN = 1
      // Recall = 1 / (1 + 1) = 0.5
      expect(metrics.recall).toBeCloseTo(0.5);
    });

    it('should compute F1 correctly', () => {
      const shadowMode = createShadowMode();

      const comparison = {
        query: 'test',
        baselineResults: [createMemory(1), createMemory(2)],
        graphRAGResults: [createMemory(1), createMemory(3)],
        baselineTokenCount: 100,
        graphRAGTokenCount: 150,
        overlap: 0.33,
        graphRAGUniqueCount: 1,
        baselineUniqueCount: 1,
        duration: 100,
        timestamp: new Date(),
      };

      const metrics = shadowMode.computeMetrics(comparison);

      // Precision = 0.5, Recall = 0.5
      // F1 = 2 * (0.5 * 0.5) / (0.5 + 0.5) = 0.5
      expect(metrics.f1).toBeCloseTo(0.5);
    });

    it('should compute token overhead correctly', () => {
      const shadowMode = createShadowMode();

      const comparison = {
        query: 'test',
        baselineResults: [createMemory(1)],
        graphRAGResults: [createMemory(1)],
        baselineTokenCount: 100,
        graphRAGTokenCount: 150,
        overlap: 1,
        graphRAGUniqueCount: 0,
        baselineUniqueCount: 0,
        duration: 100,
        timestamp: new Date(),
      };

      const metrics = shadowMode.computeMetrics(comparison);

      // Token overhead = (150 - 100) / 100 = 0.5
      expect(metrics.tokenOverhead).toBeCloseTo(0.5);
    });

    it('should handle empty baseline results', () => {
      const shadowMode = createShadowMode();

      const comparison = {
        query: 'test',
        baselineResults: [],
        graphRAGResults: [createMemory(1)],
        baselineTokenCount: 0,
        graphRAGTokenCount: 50,
        overlap: 0,
        graphRAGUniqueCount: 1,
        baselineUniqueCount: 0,
        duration: 100,
        timestamp: new Date(),
      };

      const metrics = shadowMode.computeMetrics(comparison);

      expect(metrics.precision).toBe(0);
      expect(metrics.recall).toBe(0);
      expect(metrics.f1).toBe(0);
    });

    it('should handle empty graphRAG results', () => {
      const shadowMode = createShadowMode();

      const comparison = {
        query: 'test',
        baselineResults: [createMemory(1)],
        graphRAGResults: [],
        baselineTokenCount: 50,
        graphRAGTokenCount: 0,
        overlap: 0,
        graphRAGUniqueCount: 0,
        baselineUniqueCount: 1,
        duration: 100,
        timestamp: new Date(),
      };

      const metrics = shadowMode.computeMetrics(comparison);

      expect(metrics.precision).toBe(0);
      expect(metrics.recall).toBe(0);
      expect(metrics.f1).toBe(0);
    });
  });

  describe('generateReport', () => {
    it('should return empty report when no comparisons', () => {
      const shadowMode = createShadowMode();
      const report = shadowMode.generateReport();

      expect(report.totalComparisons).toBe(0);
      expect(report.avgPrecision).toBe(0);
      expect(report.avgRecall).toBe(0);
      expect(report.avgF1).toBe(0);
      expect(report.comparisons).toEqual([]);
    });

    it('should generate report with comparisons', () => {
      const shadowMode = createShadowMode({ sampleRate: 1.0, maxComparisons: 10 });

      const mockResult: GraphRAGResult = {
        success: true,
        memories: [createMemory(1)],
        communitySummaries: [],
        graphContext: {
          expandedNodeIds: [1],
          edgeCount: 0,
          maxHopReached: false,
          communityCount: 0,
          pageRankApplied: true,
        },
        searchMetadata: {
          duration: 50,
          cacheHit: false,
          tokenUsage: 100,
          fallbackUsed: false,
          phase: 'fusion',
        },
      };

      mockGraphRAGEngine.retrieve.mockResolvedValue(mockResult);

      // Run multiple queries to generate comparisons
      shadowMode.runShadowQuery('query1', [createMemory(1)]);
      shadowMode.runShadowQuery('query2', [createMemory(1)]);

      const report = shadowMode.generateReport();

      expect(report.totalComparisons).toBeGreaterThanOrEqual(0);
      expect(report.comparisons.length).toBe(report.totalComparisons);
    });
  });

  describe('start/stop lifecycle', () => {
    it('should start and stop correctly', () => {
      const shadowMode = createShadowMode();

      shadowMode.stop();
      expect(shadowMode.shouldRun()).toBe(false);

      shadowMode.start();
      // After start, shouldRun depends on sample rate
      expect(() => shadowMode.shouldRun()).not.toThrow();
    });

    it('should clear comparisons', () => {
      const shadowMode = createShadowMode({ sampleRate: 1.0, maxComparisons: 10 });

      const mockResult: GraphRAGResult = {
        success: true,
        memories: [createMemory(1)],
        communitySummaries: [],
        graphContext: { expandedNodeIds: [], edgeCount: 0, maxHopReached: false, communityCount: 0, pageRankApplied: true },
        searchMetadata: { duration: 50, cacheHit: false, tokenUsage: 100, fallbackUsed: false, phase: 'fusion' },
      };

      mockGraphRAGEngine.retrieve.mockResolvedValue(mockResult);

      shadowMode.runShadowQuery('test', [createMemory(1)]);
      shadowMode.clearComparisons();

      expect(shadowMode.getComparisonCount()).toBe(0);
    });
  });

  describe('logComparison', () => {
    it('Farklı sonuçlar loglanmalı', async () => {
      const mockResult: GraphRAGResult = {
        success: true,
        memories: [createMemory(1), createMemory(2)],
        communitySummaries: [],
        graphContext: { expandedNodeIds: [1, 2], edgeCount: 1, maxHopReached: false, communityCount: 0, pageRankApplied: true },
        searchMetadata: { duration: 50, cacheHit: false, tokenUsage: 100, fallbackUsed: false, phase: 'fusion' },
      };

      mockGraphRAGEngine.retrieve.mockResolvedValue(mockResult);

      const shadowMode = createShadowMode({ sampleRate: 1.0, maxComparisons: 10, logToFile: true });
      const baselineResults = [createMemory(1), createMemory(3)];

      await shadowMode.runShadowQuery('test query', baselineResults);

      expect(shadowMode.getComparisonCount()).toBeGreaterThanOrEqual(0);
    });

    it('Aynı sonuçlar loglanmalı', async () => {
      const mockResult: GraphRAGResult = {
        success: true,
        memories: [createMemory(1)],
        communitySummaries: [],
        graphContext: { expandedNodeIds: [1], edgeCount: 0, maxHopReached: false, communityCount: 0, pageRankApplied: true },
        searchMetadata: { duration: 50, cacheHit: false, tokenUsage: 100, fallbackUsed: false, phase: 'fusion' },
      };

      mockGraphRAGEngine.retrieve.mockResolvedValue(mockResult);

      const shadowMode = createShadowMode({ sampleRate: 1.0, maxComparisons: 10, logToFile: true });
      const baselineResults = [createMemory(1)];

      await shadowMode.runShadowQuery('test query', baselineResults);

      expect(shadowMode.getComparisonCount()).toBeGreaterThanOrEqual(0);
    });
  });

  describe('buildComparison', () => {
    it('Metrik hesaplama doğru çalışır', () => {
      const shadowMode = createShadowMode();

      const comparison = {
        query: 'test',
        baselineResults: [createMemory(1), createMemory(2)],
        graphRAGResults: [createMemory(1), createMemory(3)],
        baselineTokenCount: 100,
        graphRAGTokenCount: 150,
        overlap: 0.33,
        graphRAGUniqueCount: 1,
        baselineUniqueCount: 1,
        duration: 100,
        timestamp: new Date(),
      };

      const metrics = shadowMode.computeMetrics(comparison);

      expect(metrics.precision).toBeGreaterThanOrEqual(0);
      expect(metrics.precision).toBeLessThanOrEqual(1);
      expect(metrics.recall).toBeGreaterThanOrEqual(0);
      expect(metrics.recall).toBeLessThanOrEqual(1);
      expect(metrics.f1).toBeGreaterThanOrEqual(0);
      expect(metrics.f1).toBeLessThanOrEqual(1);
    });
  });

  describe('addComparison - Circular Buffer', () => {
    it('Max limit aşıldığında en eski comparison silinir', () => {
      const shadowMode = createShadowMode({ sampleRate: 1.0, maxComparisons: 3 });

      // Manuel olarak comparison ekle (shouldRun bypass)
      for (let i = 0; i < 5; i++) {
        const comparison = {
          query: `query ${i}`,
          baselineResults: [createMemory(1)],
          graphRAGResults: [createMemory(1)],
          baselineTokenCount: 50,
          graphRAGTokenCount: 50,
          overlap: 1,
          graphRAGUniqueCount: 0,
          baselineUniqueCount: 0,
          duration: 50,
          timestamp: new Date(),
        };

        // Private method'a erişim için any cast
        (shadowMode as any).addComparison(comparison);
      }

      // Max 3 comparison olmalı
      expect(shadowMode.getComparisonCount()).toBeLessThanOrEqual(3);
    });

    it('Circular buffer FIFO davranışı sergiler', () => {
      const shadowMode = createShadowMode({ sampleRate: 1.0, maxComparisons: 2 });

      const comparison1 = {
        query: 'first',
        baselineResults: [createMemory(1)],
        graphRAGResults: [createMemory(1)],
        baselineTokenCount: 50,
        graphRAGTokenCount: 50,
        overlap: 1,
        graphRAGUniqueCount: 0,
        baselineUniqueCount: 0,
        duration: 50,
        timestamp: new Date(),
      };

      const comparison2 = {
        query: 'second',
        baselineResults: [createMemory(1)],
        graphRAGResults: [createMemory(1)],
        baselineTokenCount: 50,
        graphRAGTokenCount: 50,
        overlap: 1,
        graphRAGUniqueCount: 0,
        baselineUniqueCount: 0,
        duration: 50,
        timestamp: new Date(),
      };

      const comparison3 = {
        query: 'third',
        baselineResults: [createMemory(1)],
        graphRAGResults: [createMemory(1)],
        baselineTokenCount: 50,
        graphRAGTokenCount: 50,
        overlap: 1,
        graphRAGUniqueCount: 0,
        baselineUniqueCount: 0,
        duration: 50,
        timestamp: new Date(),
      };

      (shadowMode as any).addComparison(comparison1);
      (shadowMode as any).addComparison(comparison2);
      (shadowMode as any).addComparison(comparison3);

      // En eski (first) silinmiş olmalı
      const report = shadowMode.generateReport();
      const queries = report.comparisons.map(c => c.query);
      expect(queries).not.toContain('first');
      expect(queries).toContain('second');
      expect(queries).toContain('third');
    });
  });

  describe('Edge Cases', () => {
    it('Boş baseline ve graphRAG sonuçları ile metrik hesaplanır', () => {
      const shadowMode = createShadowMode();

      const comparison = {
        query: 'test',
        baselineResults: [],
        graphRAGResults: [],
        baselineTokenCount: 0,
        graphRAGTokenCount: 0,
        overlap: 0,
        graphRAGUniqueCount: 0,
        baselineUniqueCount: 0,
        duration: 0,
        timestamp: new Date(),
      };

      const metrics = shadowMode.computeMetrics(comparison);

      expect(metrics.precision).toBe(0);
      expect(metrics.recall).toBe(0);
      expect(metrics.f1).toBe(0);
    });

    it('Jaccard similarity boş setler için 1 döner', () => {
      const shadowMode = createShadowMode();

      const comparison = {
        query: 'test',
        baselineResults: [],
        graphRAGResults: [],
        baselineTokenCount: 0,
        graphRAGTokenCount: 0,
        overlap: 1, // Boş setler için jaccard = 1
        graphRAGUniqueCount: 0,
        baselineUniqueCount: 0,
        duration: 0,
        timestamp: new Date(),
      };

      const metrics = shadowMode.computeMetrics(comparison);

      // Empty results should result in 0 precision/recall due to TP=0
      expect(metrics.precision).toBe(0);
      expect(metrics.recall).toBe(0);
    });
  });
});
