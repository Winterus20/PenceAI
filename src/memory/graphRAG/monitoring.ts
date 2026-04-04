/**
 * GraphRAG Monitoring & Alerting — FULL Phase Metrics.
 *
 * GraphRAG'ın production performansını izler ve anormallik durumunda
 * alert üretir.
 *
 * Alert Koşulları:
 * - errorRate > 5% → CRITICAL
 * - p95Latency > 3000ms → WARNING
 * - cacheHitRate < 50% → WARNING
 * - avgTokenUsage > 40000 → WARNING
 */

import { logger } from '../../utils/logger.js';

/** Alert severity enum */
export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical',
}

/** Alert interface */
export interface Alert {
  severity: AlertSeverity;
  message: string;
  metric: string;
  currentValue: number;
  threshold: number;
  timestamp: Date;
}

/** GraphRAG Metrics interface */
export interface GraphRAGMetrics {
  totalQueries: number;
  graphRAGQueries: number;
  fallbackQueries: number;
  avgLatency: number;
  p95Latency: number;
  p99Latency: number;
  avgTokenUsage: number;
  cacheHitRate: number;
  errorRate: number;
}

/** Alert threshold config */
export interface AlertThresholds {
  errorRateCritical: number;       // Default: 0.05 (5%)
  p95LatencyWarning: number;       // Default: 3000ms
  cacheHitRateWarning: number;     // Default: 0.5 (50%)
  avgTokenUsageWarning: number;    // Default: 40000
}

/** Default alert thresholds */
const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  errorRateCritical: 0.05,
  p95LatencyWarning: 3000,
  cacheHitRateWarning: 0.5,
  avgTokenUsageWarning: 40000,
};

/**
 * GraphRAG Monitor.
 */
export class GraphRAGMonitor {
  private static totalQueries: number = 0;
  private static graphRAGQueries: number = 0;
  private static fallbackQueries: number = 0;
  private static errorCount: number = 0;
  private static cacheHits: number = 0;
  private static latencies: number[] = [];
  private static tokenUsages: number[] = [];
  private static alerts: Alert[] = [];
  private static thresholds: AlertThresholds = { ...DEFAULT_ALERT_THRESHOLDS };

  /**
   * Query kaydını tut.
   *
   * @param latency - Query latency (ms)
   * @param tokens - Token kullanımı
   * @param success - Başarılı mı?
   * @param cacheHit - Cache hit mi?
   * @param usedGraphRAG - GraphRAG kullanıldı mı?
   */
  static recordQuery(
    latency: number,
    tokens: number,
    success: boolean,
    cacheHit: boolean,
    usedGraphRAG: boolean = true,
  ): void {
    this.totalQueries++;
    if (usedGraphRAG) {
      this.graphRAGQueries++;
    }
    if (cacheHit) {
      this.cacheHits++;
    }
    if (!success) {
      this.errorCount++;
    }

    this.latencies.push(latency);
    this.tokenUsages.push(tokens);

    // Latency array boyutunu sınırla (son 1000 query)
    if (this.latencies.length > 1000) {
      this.latencies = this.latencies.slice(-1000);
    }
    if (this.tokenUsages.length > 1000) {
      this.tokenUsages = this.tokenUsages.slice(-1000);
    }

    // Alert kontrolü
    this.checkAlerts();
  }

  /**
   * Fallback query kaydını tut.
   */
  static recordFallback(): void {
    this.fallbackQueries++;
  }

  /**
   * Error kaydını tut.
   *
   * @param error - Hata mesajı
   */
  static recordError(error: string): void {
    this.errorCount++;
    logger.error({ msg: 'GraphRAG error recorded', error });
  }

  /**
   * Cache hit kaydını tut.
   */
  static recordCacheHit(): void {
    this.cacheHits++;
  }

  /**
   * Mevcut metrikleri getir.
   */
  static getMetrics(): GraphRAGMetrics {
    const total = this.totalQueries || 1; // Division by zero önleme

    // Latency percentiles
    const sortedLatencies = [...this.latencies].sort((a, b) => a - b);
    const p95Index = Math.floor(sortedLatencies.length * 0.95);
    const p99Index = Math.floor(sortedLatencies.length * 0.99);

    return {
      totalQueries: this.totalQueries,
      graphRAGQueries: this.graphRAGQueries,
      fallbackQueries: this.fallbackQueries,
      avgLatency: this.latencies.length > 0
        ? this.latencies.reduce((sum, l) => sum + l, 0) / this.latencies.length
        : 0,
      p95Latency: sortedLatencies.length > 0 ? sortedLatencies[p95Index] ?? 0 : 0,
      p99Latency: sortedLatencies.length > 0 ? sortedLatencies[p99Index] ?? 0 : 0,
      avgTokenUsage: this.tokenUsages.length > 0
        ? this.tokenUsages.reduce((sum, t) => sum + t, 0) / this.tokenUsages.length
        : 0,
      cacheHitRate: this.graphRAGQueries > 0 ? this.cacheHits / this.graphRAGQueries : 0,
      errorRate: this.errorCount / total,
    };
  }

  /**
   * Alert kontrolü yap.
   */
  static checkAlerts(): Alert[] {
    const metrics = this.getMetrics();
    const newAlerts: Alert[] = [];
    const now = new Date();

    // Error rate > 5% → CRITICAL
    if (metrics.errorRate > this.thresholds.errorRateCritical) {
      const alert: Alert = {
        severity: AlertSeverity.CRITICAL,
        message: `Error rate exceeded: ${(metrics.errorRate * 100).toFixed(1)}% > ${(this.thresholds.errorRateCritical * 100).toFixed(0)}%`,
        metric: 'errorRate',
        currentValue: metrics.errorRate,
        threshold: this.thresholds.errorRateCritical,
        timestamp: now,
      };
      newAlerts.push(alert);
      logger.error({ msg: 'GraphRAG ALERT: CRITICAL', ...alert });
    }

    // p95Latency > 3000ms → WARNING
    if (metrics.p95Latency > this.thresholds.p95LatencyWarning) {
      const alert: Alert = {
        severity: AlertSeverity.WARNING,
        message: `P95 latency exceeded: ${metrics.p95Latency.toFixed(0)}ms > ${this.thresholds.p95LatencyWarning}ms`,
        metric: 'p95Latency',
        currentValue: metrics.p95Latency,
        threshold: this.thresholds.p95LatencyWarning,
        timestamp: now,
      };
      newAlerts.push(alert);
      logger.warn({ msg: 'GraphRAG ALERT: WARNING', ...alert });
    }

    // cacheHitRate < 50% → WARNING
    if (metrics.cacheHitRate < this.thresholds.cacheHitRateWarning && this.graphRAGQueries > 10) {
      const alert: Alert = {
        severity: AlertSeverity.WARNING,
        message: `Cache hit rate low: ${(metrics.cacheHitRate * 100).toFixed(1)}% < ${(this.thresholds.cacheHitRateWarning * 100).toFixed(0)}%`,
        metric: 'cacheHitRate',
        currentValue: metrics.cacheHitRate,
        threshold: this.thresholds.cacheHitRateWarning,
        timestamp: now,
      };
      newAlerts.push(alert);
      logger.warn({ msg: 'GraphRAG ALERT: WARNING', ...alert });
    }

    // avgTokenUsage > 40000 → WARNING
    if (metrics.avgTokenUsage > this.thresholds.avgTokenUsageWarning) {
      const alert: Alert = {
        severity: AlertSeverity.WARNING,
        message: `Average token usage high: ${metrics.avgTokenUsage.toFixed(0)} > ${this.thresholds.avgTokenUsageWarning}`,
        metric: 'avgTokenUsage',
        currentValue: metrics.avgTokenUsage,
        threshold: this.thresholds.avgTokenUsageWarning,
        timestamp: now,
      };
      newAlerts.push(alert);
      logger.warn({ msg: 'GraphRAG ALERT: WARNING', ...alert });
    }

    // Yeni alert'leri kaydet
    this.alerts.push(...newAlerts);

    // Alert boyutunu sınırla (son 100 alert)
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-100);
    }

    return newAlerts;
  }

  /**
   * Son alert'leri getir.
   *
   * @param count - Kaç alert getirileceği (default: 10)
   */
  static getRecentAlerts(count: number = 10): Alert[] {
    return this.alerts.slice(-count);
  }

  /**
   * Tüm alert'leri getir.
   */
  static getAllAlerts(): Alert[] {
    return [...this.alerts];
  }

  /**
   * Alert'leri temizle.
   */
  static clearAlerts(): void {
    this.alerts = [];
  }

  /**
   * Metrikleri sıfırla.
   */
  static resetMetrics(): void {
    this.totalQueries = 0;
    this.graphRAGQueries = 0;
    this.fallbackQueries = 0;
    this.errorCount = 0;
    this.cacheHits = 0;
    this.latencies = [];
    this.tokenUsages = [];
    this.alerts = [];
    logger.info('[GraphRAGMonitor] Metrics reset');
  }

  /**
   * Alert threshold'larını getir.
   */
  static getThresholds(): AlertThresholds {
    return { ...this.thresholds };
  }

  /**
   * Alert threshold'larını ayarla.
   *
   * @param thresholds - Yeni threshold değerleri
   */
  static setThresholds(thresholds: Partial<AlertThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
    logger.info({ msg: 'GraphRAG alert thresholds updated', thresholds: this.thresholds });
  }
}
