/**
 * ShadowMode — GraphRAG için Güvenli Test Ortamı.
 * 
 * GraphRAG'ı production'da gerçek kullanıcı sorgularıyla test eder
 * ama sonuçları kullanıcıya göstermez. Sadece loglar ve karşılaştırır.
 * 
 * Çalışma Mantığı:
 * 1. Kullanıcı sorgusu geldiğinde, sample rate kontrolü yap
 * 2. Eğer sample'a girdiyse:
 *    a. Standard search yap (baseline)
 *    b. GraphRAG search yap (shadow)
 *    c. İki sonucu karşılaştır
 *    d. Metrikleri hesapla ve logla
 *    e. Kullanıcıya baseline sonucu göster (graphRAG'i gösterme)
 * 3. Belirli aralıklarla rapor oluştur
 */

import { logger } from '../../utils/logger.js';
import type { MemoryRow } from '../types.js';
import type { GraphRAGEngine, GraphRAGResult } from './GraphRAGEngine.js';

/** ShadowMode konfigürasyonu */
export interface ShadowModeConfig {
  sampleRate: number;        // Default: 0.1 (%10 sorgu)
  logToFile: boolean;        // Default: true
  compareWithBaseline: boolean; // Default: true
  maxComparisons: number;    // Default: 1000
}

/** ShadowMode karşılaştırma sonucu */
export interface ShadowModeComparison {
  query: string;
  baselineResults: MemoryRow[];
  graphRAGResults: MemoryRow[];
  baselineTokenCount: number;
  graphRAGTokenCount: number;
  overlap: number;           // Jaccard similarity
  graphRAGUniqueCount: number;
  baselineUniqueCount: number;
  duration: number;
  timestamp: Date;
}

/** ShadowMode metrikleri */
export interface ShadowModeMetrics {
  precision: number;
  recall: number;
  f1: number;
  tokenOverhead: number;
  latencyOverhead: number;
}

/** ShadowMode raporu */
export interface ShadowModeReport {
  totalComparisons: number;
  avgPrecision: number;
  avgRecall: number;
  avgF1: number;
  avgTokenOverhead: number;
  avgLatencyOverhead: number;
  comparisons: ShadowModeComparison[];
}

/** Default konfigürasyon */
const DEFAULT_CONFIG: ShadowModeConfig = {
  sampleRate: 0.1,
  logToFile: true,
  compareWithBaseline: true,
  maxComparisons: 1000,
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
 * Token sayısını tahmin et (basit kelime bazlı).
 */
function estimateTokenCount(memories: MemoryRow[]): number {
  return memories.reduce((sum, m) => {
    const contentTokens = Math.ceil(m.content.split(/\s+/).length * 1.3);
    return sum + contentTokens;
  }, 0);
}

export class ShadowMode {
  private config: ShadowModeConfig;
  private comparisons: ShadowModeComparison[] = [];
  private isRunning: boolean = false;
  private randomSeed: number = Math.random();

  constructor(
    private graphRAGEngine: GraphRAGEngine,
    private hybridSearchFn: (query: string, limit: number) => Promise<MemoryRow[]>,
    config?: Partial<ShadowModeConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.isRunning = true;
    logger.info(`[ShadowMode] Shadow mode initialized with sampleRate: ${this.config.sampleRate}`);
  }

  /**
   * Query'yi shadow mode'da çalıştır.
   * 
   * @param query - Arama sorgusu
   * @param baselineResults - Baseline sonuçları (önceden hesaplanmış)
   * @returns ShadowModeComparison | null
   */
  async runShadowQuery(query: string, baselineResults: MemoryRow[]): Promise<ShadowModeComparison | null> {
    if (!this.isRunning) return null;
    if (!this.shouldRun()) return null;
    if (!this.config.compareWithBaseline) return null;

    const startTime = Date.now();

    try {
      // GraphRAG search yap (shadow)
      const graphRAGResult = await this.graphRAGEngine.retrieve(query);
      
      if (!graphRAGResult.success) {
        logger.warn('[ShadowMode] GraphRAG search failed for shadow comparison');
        return null;
      }

      // Metrikleri hesapla
      const comparison = this.buildComparison(
        query,
        baselineResults,
        graphRAGResult,
        Date.now() - startTime,
      );

      // Karşılaştırmayı kaydet
      this.addComparison(comparison);

      // Logla
      if (this.config.logToFile) {
        this.logComparison(comparison);
      }

      return comparison;
    } catch (err) {
      logger.error({ err }, '[ShadowMode] Shadow query failed:');
      return null;
    }
  }

  /**
   * Shadow mode aktif mi? (sample rate kontrolü)
   */
  shouldRun(): boolean {
    if (!this.isRunning) return false;
    if (this.comparisons.length >= this.config.maxComparisons) {
      logger.info('[ShadowMode] Max comparisons reached, stopping shadow mode');
      this.isRunning = false;
      return false;
    }
    
    // Sample rate kontrolü
    this.randomSeed = (this.randomSeed * 9301 + 49297) % 233280;
    const randomValue = this.randomSeed / 233280;
    return randomValue < this.config.sampleRate;
  }

  /**
   * Karşılaştırma metrikleri hesapla.
   */
  computeMetrics(comparison: ShadowModeComparison): ShadowModeMetrics {
    const baselineSet = new Set(comparison.baselineResults.map(m => m.id));
    const graphRAGSet = new Set(comparison.graphRAGResults.map(m => m.id));

    // True positives: Her iki sonuçta da olanlar
    const truePositives = new Set([...baselineSet].filter(id => graphRAGSet.has(id))).size;
    
    // False positives: Sadece GraphRAG'de olanlar
    const falsePositives = graphRAGSet.size - truePositives;
    
    // False negatives: Sadece baseline'da olanlar
    const falseNegatives = baselineSet.size - truePositives;

    // Precision = TP / (TP + FP)
    const precision = truePositives + falsePositives > 0
      ? truePositives / (truePositives + falsePositives)
      : 0;

    // Recall = TP / (TP + FN)
    const recall = truePositives + falseNegatives > 0
      ? truePositives / (truePositives + falseNegatives)
      : 0;

    // F1 = 2 * (precision * recall) / (precision + recall)
    const f1 = precision + recall > 0
      ? 2 * (precision * recall) / (precision + recall)
      : 0;

    // Token overhead
    const tokenOverhead = comparison.baselineTokenCount > 0
      ? (comparison.graphRAGTokenCount - comparison.baselineTokenCount) / comparison.baselineTokenCount
      : 0;

    // Latency overhead (GraphRAG her zaman daha yavaş olacak)
    const latencyOverhead = comparison.duration;

    return {
      precision,
      recall,
      f1,
      tokenOverhead,
      latencyOverhead,
    };
  }

  /**
   * Rapor oluştur.
   */
  generateReport(): ShadowModeReport {
    if (this.comparisons.length === 0) {
      return {
        totalComparisons: 0,
        avgPrecision: 0,
        avgRecall: 0,
        avgF1: 0,
        avgTokenOverhead: 0,
        avgLatencyOverhead: 0,
        comparisons: [],
      };
    }

    const metrics = this.comparisons.map(c => this.computeMetrics(c));

    const avgMetric = (fn: (m: ShadowModeMetrics) => number) =>
      metrics.reduce((sum, m) => sum + fn(m), 0) / metrics.length;

    return {
      totalComparisons: this.comparisons.length,
      avgPrecision: avgMetric(m => m.precision),
      avgRecall: avgMetric(m => m.recall),
      avgF1: avgMetric(m => m.f1),
      avgTokenOverhead: avgMetric(m => m.tokenOverhead),
      avgLatencyOverhead: avgMetric(m => m.latencyOverhead),
      comparisons: [...this.comparisons],
    };
  }

  /**
   * Shadow mode'u durdur.
   */
  stop(): void {
    this.isRunning = false;
    logger.info('[ShadowMode] Shadow mode stopped');
  }

  /**
   * Shadow mode'u başlat.
   */
  start(): void {
    this.isRunning = true;
    logger.info('[ShadowMode] Shadow mode started');
  }

  /**
   * Karşılaştırma sayısını getir.
   */
  getComparisonCount(): number {
    return this.comparisons.length;
  }

  /**
   * Karşılaştırmaları temizle.
   */
  clearComparisons(): void {
    this.comparisons = [];
    logger.info('[ShadowMode] Comparisons cleared');
  }

  /**
   * Karşılaştırma ekle.
   */
  private addComparison(comparison: ShadowModeComparison): void {
    if (this.comparisons.length >= this.config.maxComparisons) {
      // En eski karşılaştırmayı kaldır
      this.comparisons.shift();
    }
    this.comparisons.push(comparison);
  }

  /**
   * Karşılaştırma objesi oluştur.
   */
  private buildComparison(
    query: string,
    baselineResults: MemoryRow[],
    graphRAGResult: GraphRAGResult,
    duration: number,
  ): ShadowModeComparison {
    const baselineSet = new Set(baselineResults.map(m => m.id));
    const graphRAGSet = new Set(graphRAGResult.memories.map(m => m.id));

    const overlap = jaccardSimilarity(baselineSet, graphRAGSet);
    const graphRAGUniqueCount = [...graphRAGSet].filter(id => !baselineSet.has(id)).length;
    const baselineUniqueCount = [...baselineSet].filter(id => !graphRAGSet.has(id)).length;

    return {
      query,
      baselineResults,
      graphRAGResults: graphRAGResult.memories,
      baselineTokenCount: estimateTokenCount(baselineResults),
      graphRAGTokenCount: graphRAGResult.searchMetadata.tokenUsage,
      overlap,
      graphRAGUniqueCount,
      baselineUniqueCount,
      duration,
      timestamp: new Date(),
    };
  }

  /**
   * Karşılaştırmayı logla.
   */
  private logComparison(comparison: ShadowModeComparison): void {
    const metrics = this.computeMetrics(comparison);

    logger.info({
      msg: '[ShadowMode] Comparison',
      query: comparison.query.substring(0, 50),
      baselineCount: comparison.baselineResults.length,
      graphRAGCount: comparison.graphRAGResults.length,
      overlap: comparison.overlap.toFixed(3),
      graphRAGUnique: comparison.graphRAGUniqueCount,
      baselineUnique: comparison.baselineUniqueCount,
      precision: metrics.precision.toFixed(3),
      recall: metrics.recall.toFixed(3),
      f1: metrics.f1.toFixed(3),
      tokenOverhead: `${(metrics.tokenOverhead * 100).toFixed(1)}%`,
      latencyMs: comparison.duration,
    }, '[ShadowMode]');
  }
}
