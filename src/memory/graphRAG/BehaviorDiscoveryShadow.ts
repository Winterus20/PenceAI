/**
 * BehaviorDiscoveryShadow — Retrieval Orchestrator için Shadow Comparison.
 * 
 * Standard retrieval vs yeni retrieval stratejileri (spreading activation, GraphRAG)
 * karşılaştırması yapar ve sonuçları loglar.
 * 
 * Çalışma Mantığı:
 * 1. Her sorguda sample rate kontrolü yap
 * 2. Eğer sample'a girdiyse:
 *    a. Baseline (standard) sonuçları al
 *    b. Experimental (GraphRAG/Spreading Activation) sonuçları al
 *    c. İki sonucu karşılaştır (Jaccard similarity, unique counts)
 *    d. Metrikleri hesapla ve logla
 * 3. Belirli aralıklarla rapor oluştur
 */

import { logger } from '../../utils/logger.js';

/** BehaviorDiscovery konfigürasyonu */
export interface BehaviorDiscoveryConfig {
  enabled: boolean;
  sampleRate: number;          // Default: 0.1
  maxComparisons: number;      // Default: 1000
  logToFile: boolean;          // Default: true
}

/** Retrieval karşılaştırma sonucu */
export interface RetrievalComparison {
  query: string;
  baselineResults: { id: number; score: number }[];
  experimentalResults: { id: number; score: number }[];
  baselineTokenCount: number;
  experimentalTokenCount: number;
  overlap: number;             // Jaccard similarity
  experimentalUniqueCount: number;
  baselineUniqueCount: number;
  duration: number;
  timestamp: Date;
  strategy: string;            // 'spreading_activation' | 'graph_rag' | 'hybrid'
}

/** BehaviorDiscovery metrikleri */
export interface BehaviorDiscoveryMetrics {
  totalComparisons: number;
  avgJaccardSimilarity: number;
  avgExperimentalUniqueCount: number;
  avgTokenOverhead: number;
  avgLatencyOverhead: number;
  comparisons: RetrievalComparison[];
}

/** Default konfigürasyon */
const DEFAULT_CONFIG: BehaviorDiscoveryConfig = {
  enabled: true,
  sampleRate: 0.1,
  maxComparisons: 1000,
  logToFile: true,
};

/**
 * Jaccard similarity hesapla.
 */
function jaccardSimilarity(setA: Set<number>, setB: Set<number>): number {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);

  return intersection.size / union.size;
}

/**
 * Token sayısını tahmin et (basit result bazlı).
 */
function estimateTokenCount(results: { id: number; score: number }[]): number {
  // Basit token tahmini: her result için ~100 token
  return results.length * 100;
}

export class BehaviorDiscoveryShadow {
  private config: BehaviorDiscoveryConfig;
  private comparisons: RetrievalComparison[] = [];

  constructor(config?: Partial<BehaviorDiscoveryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info({ msg: '[BehaviorDiscoveryShadow] Initialized', config: this.config });
  }

  /**
   * Shadow comparison çalıştırılmalı mı?
   */
  shouldRun(): boolean {
    if (!this.config.enabled) return false;
    if (this.comparisons.length >= this.config.maxComparisons) {
      logger.info({ msg: '[BehaviorDiscoveryShadow] Max comparisons reached, stopping' });
      return false;
    }
    
    // Sample rate kontrolü
    return Math.random() < this.config.sampleRate;
  }

  /**
   * Shadow comparison yap.
   * 
   * @param query - Arama sorgusu
   * @param baselineResults - Standard retrieval sonuçları
   * @param experimentalResults - Experimental retrieval sonuçları
   * @param strategy - Kullanılan strateji ('spreading_activation' | 'graph_rag' | 'hybrid')
   * @returns RetrievalComparison | null
   */
  async runComparison(
    query: string,
    baselineResults: { id: number; score: number }[],
    experimentalResults: { id: number; score: number }[],
    strategy: string,
    duration: number = 0,
  ): Promise<RetrievalComparison | null> {
    if (!this.shouldRun()) return null;

    const baselineIds = new Set(baselineResults.map(r => r.id));
    const experimentalIds = new Set(experimentalResults.map(r => r.id));

    // Jaccard similarity
    const intersection = new Set([...baselineIds].filter(x => experimentalIds.has(x)));
    const union = new Set([...baselineIds, ...experimentalIds]);
    const jaccard = union.size > 0 ? intersection.size / union.size : 0;

    // Unique counts
    const experimentalUniqueCount = [...experimentalIds].filter(id => !baselineIds.has(id)).length;
    const baselineUniqueCount = [...baselineIds].filter(id => !experimentalIds.has(id)).length;

    const comparison: RetrievalComparison = {
      query,
      baselineResults,
      experimentalResults,
      baselineTokenCount: estimateTokenCount(baselineResults),
      experimentalTokenCount: estimateTokenCount(experimentalResults),
      overlap: jaccard,
      experimentalUniqueCount,
      baselineUniqueCount,
      duration,
      timestamp: new Date(),
      strategy,
    };

    this.comparisons.push(comparison);
    logger.info({ msg: '[BehaviorDiscoveryShadow] Comparison completed', comparison });

    return comparison;
  }

  /**
   * Metrikleri getir.
   */
  getMetrics(): BehaviorDiscoveryMetrics {
    if (this.comparisons.length === 0) {
      return {
        totalComparisons: 0,
        avgJaccardSimilarity: 0,
        avgExperimentalUniqueCount: 0,
        avgTokenOverhead: 0,
        avgLatencyOverhead: 0,
        comparisons: [],
      };
    }

    return {
      totalComparisons: this.comparisons.length,
      avgJaccardSimilarity: this.comparisons.reduce((sum, c) => sum + c.overlap, 0) / this.comparisons.length,
      avgExperimentalUniqueCount: this.comparisons.reduce((sum, c) => sum + c.experimentalUniqueCount, 0) / this.comparisons.length,
      avgTokenOverhead: this.comparisons.reduce((sum, c) => sum + (c.experimentalTokenCount - c.baselineTokenCount), 0) / this.comparisons.length,
      avgLatencyOverhead: this.comparisons.reduce((sum, c) => sum + c.duration, 0) / this.comparisons.length,
      comparisons: [...this.comparisons],
    };
  }

  /**
   * Rapor oluştur.
   */
  generateReport(): string {
    const metrics = this.getMetrics();
    const strategyBreakdown = this.getStrategyBreakdown();

    return `
Behavior Discovery Shadow Report
================================
Total Comparisons: ${metrics.totalComparisons}
Avg Jaccard Similarity: ${metrics.avgJaccardSimilarity.toFixed(3)}
Avg Experimental Unique Results: ${metrics.avgExperimentalUniqueCount.toFixed(1)}
Avg Token Overhead: ${metrics.avgTokenOverhead.toFixed(0)}
Avg Latency Overhead: ${metrics.avgLatencyOverhead.toFixed(0)}ms

Strategy Breakdown:
${strategyBreakdown}
`;
  }

  /**
   * Strategy bazlı breakdown getir.
   */
  private getStrategyBreakdown(): string {
    const strategies = new Map<string, number>();
    for (const c of this.comparisons) {
      strategies.set(c.strategy, (strategies.get(c.strategy) || 0) + 1);
    }
    return [...strategies.entries()]
      .map(([strategy, count]) => `  ${strategy}: ${count}`)
      .join('\n');
  }

  /**
   * Comparisons'ı temizle.
   */
  clear(): void {
    this.comparisons = [];
    logger.info({ msg: '[BehaviorDiscoveryShadow] Comparisons cleared' });
  }

  /**
   * Comparison sayısını getir.
   */
  getComparisonCount(): number {
    return this.comparisons.length;
  }

  /**
   * Config'i güncelle.
   */
  updateConfig(config: Partial<BehaviorDiscoveryConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info({ msg: '[BehaviorDiscoveryShadow] Config updated', config: this.config });
  }

  /**
   * Config'i getir.
   */
  getConfig(): BehaviorDiscoveryConfig {
    return { ...this.config };
  }
}
