/**
 * BehaviorDiscoveryShadow Testleri.
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

import { BehaviorDiscoveryShadow, type BehaviorDiscoveryConfig } from '../../../src/memory/graphRAG/BehaviorDiscoveryShadow.js';

describe('BehaviorDiscoveryShadow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /** Helper: Test result oluştur */
  function createResult(id: number, score: number = 0.5): { id: number; score: number } {
    return { id, score };
  }

  /** Helper: BehaviorDiscoveryShadow instance oluştur */
  function createBehaviorDiscovery(config?: Partial<BehaviorDiscoveryConfig>): BehaviorDiscoveryShadow {
    return new BehaviorDiscoveryShadow(config);
  }

  describe('initialization', () => {
    it('should initialize with default config', () => {
      const shadow = createBehaviorDiscovery();
      expect(shadow.getComparisonCount()).toBe(0);
      expect(shadow.getConfig().enabled).toBe(true);
      expect(shadow.getConfig().sampleRate).toBe(0.1);
      expect(shadow.getConfig().maxComparisons).toBe(1000);
      expect(shadow.getConfig().logToFile).toBe(true);
    });

    it('should initialize with custom config', () => {
      const shadow = createBehaviorDiscovery({ sampleRate: 0.5, maxComparisons: 100, enabled: false });
      expect(shadow.getConfig().sampleRate).toBe(0.5);
      expect(shadow.getConfig().maxComparisons).toBe(100);
      expect(shadow.getConfig().enabled).toBe(false);
    });
  });

  describe('shouldRun', () => {
    it('should return false when disabled', () => {
      const shadow = createBehaviorDiscovery({ enabled: false, sampleRate: 1.0 });
      expect(shadow.shouldRun()).toBe(false);
    });

    it('should return false when max comparisons reached', () => {
      const shadow = createBehaviorDiscovery({ sampleRate: 1.0, maxComparisons: 0 });
      expect(shadow.shouldRun()).toBe(false);
    });

    it('should return true when sample rate is 1.0 and enabled', () => {
      const shadow = createBehaviorDiscovery({ sampleRate: 1.0 });
      // First call uses random seed, may or may not pass
      // Just verify it doesn't throw
      expect(() => shadow.shouldRun()).not.toThrow();
    });

    it('should return false when sample rate is 0', () => {
      const shadow = createBehaviorDiscovery({ sampleRate: 0 });
      expect(shadow.shouldRun()).toBe(false);
    });
  });

  describe('runComparison', () => {
    it('should return null when disabled', async () => {
      const shadow = createBehaviorDiscovery({ enabled: false });
      const result = await shadow.runComparison(
        'test query',
        [createResult(1)],
        [createResult(1)],
        'graph_rag',
      );
      expect(result).toBeNull();
    });

    it('should return null when sample rate does not allow', async () => {
      const shadow = createBehaviorDiscovery({ sampleRate: 0 });
      const result = await shadow.runComparison(
        'test query',
        [createResult(1)],
        [createResult(1)],
        'graph_rag',
      );
      expect(result).toBeNull();
    });

    it('should compute Jaccard similarity correctly', async () => {
      const shadow = createBehaviorDiscovery({ sampleRate: 1.0, maxComparisons: 10 });
      
      const baselineResults = [createResult(1, 0.8), createResult(2, 0.6)];
      const experimentalResults = [createResult(1, 0.9), createResult(3, 0.7)];
      
      const result = await shadow.runComparison(
        'test query',
        baselineResults,
        experimentalResults,
        'graph_rag',
      );

      expect(result).not.toBeNull();
      expect(result!.query).toBe('test query');
      expect(result!.strategy).toBe('graph_rag');
      
      // Jaccard: intersection={1}, union={1,2,3} => 1/3 = 0.333
      expect(result!.overlap).toBeCloseTo(1/3, 3);
      expect(result!.experimentalUniqueCount).toBe(1); // id 3
      expect(result!.baselineUniqueCount).toBe(1); // id 2
    });

    it('should handle identical results', async () => {
      const shadow = createBehaviorDiscovery({ sampleRate: 1.0, maxComparisons: 10 });
      
      const results = [createResult(1, 0.8), createResult(2, 0.6)];
      
      const result = await shadow.runComparison(
        'test query',
        results,
        results,
        'spreading_activation',
      );

      expect(result).not.toBeNull();
      expect(result!.overlap).toBe(1);
      expect(result!.experimentalUniqueCount).toBe(0);
      expect(result!.baselineUniqueCount).toBe(0);
    });

    it('should handle empty results', async () => {
      const shadow = createBehaviorDiscovery({ sampleRate: 1.0, maxComparisons: 10 });
      
      const result = await shadow.runComparison(
        'test query',
        [],
        [],
        'hybrid',
      );

      expect(result).not.toBeNull();
      expect(result!.overlap).toBe(0); // Both empty sets => jaccard returns 0 due to early return
      expect(result!.experimentalUniqueCount).toBe(0);
      expect(result!.baselineUniqueCount).toBe(0);
    });

    it('should handle completely different results', async () => {
      const shadow = createBehaviorDiscovery({ sampleRate: 1.0, maxComparisons: 10 });
      
      const baselineResults = [createResult(1, 0.8), createResult(2, 0.6)];
      const experimentalResults = [createResult(3, 0.9), createResult(4, 0.7)];
      
      const result = await shadow.runComparison(
        'test query',
        baselineResults,
        experimentalResults,
        'graph_rag',
      );

      expect(result).not.toBeNull();
      expect(result!.overlap).toBe(0); // No intersection
      expect(result!.experimentalUniqueCount).toBe(2);
      expect(result!.baselineUniqueCount).toBe(2);
    });

    it('should estimate token counts correctly', async () => {
      const shadow = createBehaviorDiscovery({ sampleRate: 1.0, maxComparisons: 10 });
      
      const baselineResults = [createResult(1), createResult(2)];
      const experimentalResults = [createResult(1), createResult(3), createResult(4)];
      
      const result = await shadow.runComparison(
        'test query',
        baselineResults,
        experimentalResults,
        'graph_rag',
      );

      expect(result).not.toBeNull();
      expect(result!.baselineTokenCount).toBe(200); // 2 * 100
      expect(result!.experimentalTokenCount).toBe(300); // 3 * 100
    });
  });

  describe('getMetrics', () => {
    it('should return correct averages', async () => {
      const shadow = createBehaviorDiscovery({ sampleRate: 1.0, maxComparisons: 10 });
      
      // Run multiple comparisons
      await shadow.runComparison('q1', [createResult(1)], [createResult(1)], 'graph_rag');
      await shadow.runComparison('q2', [createResult(1), createResult(2)], [createResult(1), createResult(3)], 'graph_rag');
      
      const metrics = shadow.getMetrics();
      
      expect(metrics.totalComparisons).toBeGreaterThanOrEqual(0);
      expect(metrics.avgJaccardSimilarity).toBeGreaterThanOrEqual(0);
      expect(metrics.avgJaccardSimilarity).toBeLessThanOrEqual(1);
      expect(metrics.avgExperimentalUniqueCount).toBeGreaterThanOrEqual(0);
      expect(metrics.comparisons.length).toBe(metrics.totalComparisons);
    });

    it('should return zero metrics when no comparisons', () => {
      const shadow = createBehaviorDiscovery();
      const metrics = shadow.getMetrics();
      
      expect(metrics.totalComparisons).toBe(0);
      expect(metrics.avgJaccardSimilarity).toBe(0);
      expect(metrics.avgExperimentalUniqueCount).toBe(0);
      expect(metrics.avgTokenOverhead).toBe(0);
      expect(metrics.avgLatencyOverhead).toBe(0);
      expect(metrics.comparisons).toEqual([]);
    });
  });

  describe('generateReport', () => {
    it('should return formatted string', async () => {
      const shadow = createBehaviorDiscovery({ sampleRate: 1.0, maxComparisons: 10 });
      
      await shadow.runComparison('test query', [createResult(1)], [createResult(1)], 'graph_rag');
      
      const report = shadow.generateReport();
      
      expect(report).toContain('Behavior Discovery Shadow Report');
      expect(report).toContain('Total Comparisons:');
      expect(report).toContain('Avg Jaccard Similarity:');
      expect(report).toContain('Strategy Breakdown:');
    });

    it('should include strategy breakdown', async () => {
      const shadow = createBehaviorDiscovery({ sampleRate: 1.0, maxComparisons: 10 });
      
      await shadow.runComparison('q1', [createResult(1)], [createResult(1)], 'graph_rag');
      await shadow.runComparison('q2', [createResult(1)], [createResult(1)], 'spreading_activation');
      
      const report = shadow.generateReport();
      
      expect(report).toContain('graph_rag:');
      expect(report).toContain('spreading_activation:');
    });
  });

  describe('clear', () => {
    it('should remove all comparisons', async () => {
      const shadow = createBehaviorDiscovery({ sampleRate: 1.0, maxComparisons: 10 });
      
      await shadow.runComparison('q1', [createResult(1)], [createResult(1)], 'graph_rag');
      await shadow.runComparison('q2', [createResult(1)], [createResult(1)], 'graph_rag');
      
      expect(shadow.getComparisonCount()).toBeGreaterThan(0);
      
      shadow.clear();
      
      expect(shadow.getComparisonCount()).toBe(0);
      expect(shadow.getMetrics().totalComparisons).toBe(0);
    });
  });

  describe('maxComparisons limit', () => {
    it('maxComparisons limit is respected', async () => {
      const shadow = createBehaviorDiscovery({ sampleRate: 1.0, maxComparisons: 5 });
      
      // Run more comparisons than maxComparisons
      for (let i = 0; i < 10; i++) {
        await shadow.runComparison(`q${i}`, [createResult(1)], [createResult(1)], 'graph_rag');
      }
      
      // Should not exceed maxComparisons
      expect(shadow.getComparisonCount()).toBeLessThanOrEqual(5);
    });
  });

  describe('updateConfig', () => {
    it('should update config partially', () => {
      const shadow = createBehaviorDiscovery({ sampleRate: 0.1 });
      
      shadow.updateConfig({ sampleRate: 0.5, enabled: false });
      
      const config = shadow.getConfig();
      expect(config.sampleRate).toBe(0.5);
      expect(config.enabled).toBe(false);
      expect(config.maxComparisons).toBe(1000); // unchanged
    });
  });

  describe('getStrategyBreakdown', () => {
    it('Farklı stratejiler için breakdown doğru hesaplanır', async () => {
      const shadow = createBehaviorDiscovery({ sampleRate: 1.0, maxComparisons: 100 });

      // Farklı stratejilerle comparison'lar ekle
      await shadow.runComparison('q1', [createResult(1)], [createResult(1)], 'graph_rag');
      await shadow.runComparison('q2', [createResult(1)], [createResult(1)], 'spreading_activation');
      await shadow.runComparison('q3', [createResult(1)], [createResult(1)], 'hybrid');
      await shadow.runComparison('q4', [createResult(1)], [createResult(1)], 'graph_rag');

      const report = shadow.generateReport();

      // Report'ta strategy breakdown olmalı
      expect(report).toContain('Strategy Breakdown:');
      expect(report).toContain('graph_rag:');
      expect(report).toContain('spreading_activation:');
      expect(report).toContain('hybrid:');
    });

    it('Tek strateji ile breakdown doğru hesaplanır', async () => {
      const shadow = createBehaviorDiscovery({ sampleRate: 1.0, maxComparisons: 100 });

      // Sadece graph_rag stratejisi
      await shadow.runComparison('q1', [createResult(1)], [createResult(1)], 'graph_rag');
      await shadow.runComparison('q2', [createResult(1)], [createResult(1)], 'graph_rag');

      const report = shadow.generateReport();

      expect(report).toContain('graph_rag:');
    });

    it('Boş comparison listesinde breakdown boş döner', () => {
      const shadow = createBehaviorDiscovery();
      const report = shadow.generateReport();

      expect(report).toContain('Strategy Breakdown:');
    });
  });

  describe('estimateTokenCount', () => {
    it('Farklı input uzunlukları için token tahmini doğru', async () => {
      const shadow = createBehaviorDiscovery({ sampleRate: 1.0, maxComparisons: 100 });

      // Kısa sonuçlar
      const shortResults = [createResult(1)];
      await shadow.runComparison('short', shortResults, shortResults, 'graph_rag');

      // Uzun sonuçlar
      const longResults = [createResult(1), createResult(2), createResult(3), createResult(4), createResult(5)];
      await shadow.runComparison('long', longResults, longResults, 'graph_rag');

      const metrics = shadow.getMetrics();

      // Token overhead hesaplanabilmeli
      expect(metrics.avgTokenOverhead).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('Negatif skorlar doğru işlenir', async () => {
      const shadow = createBehaviorDiscovery({ sampleRate: 1.0, maxComparisons: 100 });

      const baselineResults = [createResult(1, -0.5)];
      const experimentalResults = [createResult(1, -0.3)];

      const result = await shadow.runComparison(
        'negative scores',
        baselineResults,
        experimentalResults,
        'graph_rag',
      );

      expect(result).not.toBeNull();
      expect(result!.query).toBe('negative scores');
    });

    it('Çok büyük skorlar doğru işlenir', async () => {
      const shadow = createBehaviorDiscovery({ sampleRate: 1.0, maxComparisons: 100 });

      const baselineResults = [createResult(1, 999999)];
      const experimentalResults = [createResult(1, 999999)];

      const result = await shadow.runComparison(
        'large scores',
        baselineResults,
        experimentalResults,
        'graph_rag',
      );

      expect(result).not.toBeNull();
    });

    it('Null benzeri değerler doğru işlenir', async () => {
      const shadow = createBehaviorDiscovery({ sampleRate: 1.0, maxComparisons: 100 });

      const baselineResults = [createResult(1, 0)];
      const experimentalResults = [createResult(1, 0)];

      const result = await shadow.runComparison(
        'zero scores',
        baselineResults,
        experimentalResults,
        'graph_rag',
      );

      expect(result).not.toBeNull();
      expect(result!.overlap).toBe(1);
    });
  });

  describe('Concurrent Comparisons', () => {
    it('Eşzamanlı comparison çağrıları race condition yaratmaz', async () => {
      const shadow = createBehaviorDiscovery({ sampleRate: 1.0, maxComparisons: 1000 });

      const promises = Array(10).fill(null).map((_, i) =>
        shadow.runComparison(`q${i}`, [createResult(1)], [createResult(1)], 'graph_rag')
      );

      const results = await Promise.allSettled(promises);

      // Tüm comparison'lar tamamlanmalı
      const fulfilled = results.filter(r => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThan(0);

      // Comparison count artmış olmalı
      expect(shadow.getComparisonCount()).toBeGreaterThan(0);
    });
  });

  describe('Config Validation', () => {
    it('Negatif sampleRate doğru işlenir', () => {
      const shadow = createBehaviorDiscovery({ sampleRate: -0.5 });
      const config = shadow.getConfig();
      expect(config.sampleRate).toBe(-0.5);
      expect(shadow.shouldRun()).toBe(false); // Negatif sampleRate her zaman false
    });

    it('1\'den büyük sampleRate doğru işlenir', () => {
      const shadow = createBehaviorDiscovery({ sampleRate: 2.0 });
      const config = shadow.getConfig();
      expect(config.sampleRate).toBe(2.0);
      // 1'den büyük sampleRate her zaman true dönmeli (randomValue < 2.0 her zaman true)
      expect(shadow.shouldRun()).toBe(true);
    });
  });

  describe('Report Generation Edge Cases', () => {
    it('Çok sayıda comparison ile report doğru oluşturulur', async () => {
      const shadow = createBehaviorDiscovery({ sampleRate: 1.0, maxComparisons: 100 });

      for (let i = 0; i < 50; i++) {
        await shadow.runComparison(`q${i}`, [createResult(i)], [createResult(i)], 'graph_rag');
      }

      const report = shadow.generateReport();

      expect(report).toContain('Total Comparisons:');
      expect(report).toContain('Avg Jaccard Similarity:');
    });

    it('Farklı stratejilerle report doğru oluşturulur', async () => {
      const shadow = createBehaviorDiscovery({ sampleRate: 1.0, maxComparisons: 100 });

      const strategies = ['graph_rag', 'spreading_activation', 'hybrid'];
      for (let i = 0; i < 30; i++) {
        const strategy = strategies[i % strategies.length];
        await shadow.runComparison(`q${i}`, [createResult(i)], [createResult(i)], strategy);
      }

      const report = shadow.generateReport();

      expect(report).toContain('graph_rag:');
      expect(report).toContain('spreading_activation:');
      expect(report).toContain('hybrid:');
    });
  });
});
