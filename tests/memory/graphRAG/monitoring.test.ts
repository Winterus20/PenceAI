/**
 * GraphRAG Monitor Testleri
 * 
 * Query kaydı, metrik hesaplama, alert kontrolü,
 * threshold yönetimi ve metrik sıfırlama testleri.
 */

import {
  defaultMonitor as GraphRAGMonitor,
  AlertSeverity,
} from '../../../src/memory/graphRAG/monitoring.js';

// Logger mock
jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('GraphRAGMonitor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Her test öncesi metrikleri sıfırla
    GraphRAGMonitor.resetMetrics();
    // Varsayılan threshold'ları geri yükle
    GraphRAGMonitor.setThresholds({
      errorRateCritical: 0.05,
      p95LatencyWarning: 3000,
      cacheHitRateWarning: 0.5,
      avgTokenUsageWarning: 40000,
    });
  });

  describe('recordQuery', () => {
    test('Başarılı query kaydını artırır', () => {
      GraphRAGMonitor.recordQuery(100, 1000, true, false, true);

      const metrics = GraphRAGMonitor.getMetrics();
      expect(metrics.totalQueries).toBe(1);
      expect(metrics.graphRAGQueries).toBe(1);
      expect(metrics.errorRate).toBe(0);
    });

    test('Başarısız query error rate\'i artırır', () => {
      GraphRAGMonitor.recordQuery(100, 1000, false, false, true);

      const metrics = GraphRAGMonitor.getMetrics();
      expect(metrics.totalQueries).toBe(1);
      expect(metrics.errorRate).toBe(1); // 1/1 = 100%
    });

    test('Cache hit kaydını doğru takip eder', () => {
      GraphRAGMonitor.recordQuery(100, 1000, true, true, true);
      GraphRAGMonitor.recordQuery(100, 1000, true, false, true);

      const metrics = GraphRAGMonitor.getMetrics();
      expect(metrics.cacheHitRate).toBe(0.5); // 1/2
    });

    test('usedGraphRAG=false ise graphRAGQueries artmaz', () => {
      GraphRAGMonitor.recordQuery(100, 1000, true, false, false);

      const metrics = GraphRAGMonitor.getMetrics();
      expect(metrics.totalQueries).toBe(1);
      expect(metrics.graphRAGQueries).toBe(0);
    });

    test('Latency array\'i 1000 elemanla sınırlıdır', () => {
      // 1001 query kaydet
      for (let i = 0; i < 1001; i++) {
        GraphRAGMonitor.recordQuery(i, 1000, true, false, true);
      }

      const metrics = GraphRAGMonitor.getMetrics();
      expect(metrics.totalQueries).toBe(1001);
      // avgLatency son 1000 query'nin ortalaması olmalı
      // İlk query (i=0) atılmış olmalı, i=1..1000 kalmalı
      const expectedAvg = (1 + 1000) / 2; // 1'den 1000'e kadar ortalama
      expect(metrics.avgLatency).toBeCloseTo(expectedAvg, 0);
    });

    test('Token usage array\'i 1000 elemanla sınırlıdır', () => {
      // 1001 query kaydet
      for (let i = 0; i < 1001; i++) {
        GraphRAGMonitor.recordQuery(100, i, true, false, true);
      }

      const metrics = GraphRAGMonitor.getMetrics();
      expect(metrics.totalQueries).toBe(1001);
      // avgTokenUsage son 1000 query'nin ortalaması olmalı
      const expectedAvg = (1 + 1000) / 2;
      expect(metrics.avgTokenUsage).toBeCloseTo(expectedAvg, 0);
    });
  });

  describe('recordFallback', () => {
    test('Fallback query sayısını artırır', () => {
      GraphRAGMonitor.recordFallback();
      GraphRAGMonitor.recordFallback();

      const metrics = GraphRAGMonitor.getMetrics();
      expect(metrics.fallbackQueries).toBe(2);
    });

    test('Fallback, totalQueries\'i artırmaz', () => {
      GraphRAGMonitor.recordFallback();

      const metrics = GraphRAGMonitor.getMetrics();
      expect(metrics.totalQueries).toBe(0);
      expect(metrics.fallbackQueries).toBe(1);
    });
  });

  describe('recordError', () => {
    test('Error count\'u artırır', () => {
      GraphRAGMonitor.recordError('Test error');

      const metrics = GraphRAGMonitor.getMetrics();
      expect(metrics.errorRate).toBeGreaterThan(0);
    });

    test('Birden fazla error error rate\'i artırır', () => {
      GraphRAGMonitor.recordQuery(100, 1000, true, false, true);
      GraphRAGMonitor.recordError('Error 1');
      GraphRAGMonitor.recordError('Error 2');

      const metrics = GraphRAGMonitor.getMetrics();
      expect(metrics.totalQueries).toBe(1);
      expect(metrics.errorRate).toBe(2); // 2 error / 1 query = 2 (200%)
    });
  });

  describe('recordCacheHit', () => {
    test('Cache hit sayısını artırır', () => {
      GraphRAGMonitor.recordCacheHit();
      GraphRAGMonitor.recordCacheHit();

      // Cache hit rate hesaplamak için graphRAGQueries gerekli
      GraphRAGMonitor.recordQuery(100, 1000, true, false, true);

      const metrics = GraphRAGMonitor.getMetrics();
      // 2 cacheHits / 1 graphRAGQueries = 2 (200%)
      expect(metrics.cacheHitRate).toBe(2);
    });
  });

  describe('getMetrics', () => {
    test('İlk başta tüm metrikler sıfır', () => {
      const metrics = GraphRAGMonitor.getMetrics();

      expect(metrics.totalQueries).toBe(0);
      expect(metrics.graphRAGQueries).toBe(0);
      expect(metrics.fallbackQueries).toBe(0);
      expect(metrics.avgLatency).toBe(0);
      expect(metrics.p95Latency).toBe(0);
      expect(metrics.p99Latency).toBe(0);
      expect(metrics.avgTokenUsage).toBe(0);
      expect(metrics.cacheHitRate).toBe(0);
      expect(metrics.errorRate).toBe(0);
    });

    test('avgLatency doğru hesaplanır', () => {
      GraphRAGMonitor.recordQuery(100, 1000, true, false, true);
      GraphRAGMonitor.recordQuery(200, 1000, true, false, true);
      GraphRAGMonitor.recordQuery(300, 1000, true, false, true);

      const metrics = GraphRAGMonitor.getMetrics();
      expect(metrics.avgLatency).toBe(200); // (100+200+300)/3
    });

    test('p95Latency doğru hesaplanır', () => {
      // 20 query kaydet
      for (let i = 1; i <= 20; i++) {
        GraphRAGMonitor.recordQuery(i * 10, 1000, true, false, true);
      }

      const metrics = GraphRAGMonitor.getMetrics();
      // p95 index = floor(20 * 0.95) = 19, sorted array'de 19. eleman (0-indexed)
      // Sorted: [10, 20, 30, ..., 200], index 19 = 200
      expect(metrics.p95Latency).toBe(200);
    });

    test('p99Latency doğru hesaplanır', () => {
      // 100 query kaydet
      for (let i = 1; i <= 100; i++) {
        GraphRAGMonitor.recordQuery(i, 1000, true, false, true);
      }

      const metrics = GraphRAGMonitor.getMetrics();
      // p99 index = floor(100 * 0.99) = 99, sorted array'de 99. eleman (0-indexed)
      // Sorted: [1, 2, 3, ..., 100], index 99 = 100
      expect(metrics.p99Latency).toBe(100);
    });

    test('avgTokenUsage doğru hesaplanır', () => {
      GraphRAGMonitor.recordQuery(100, 1000, true, false, true);
      GraphRAGMonitor.recordQuery(100, 2000, true, false, true);
      GraphRAGMonitor.recordQuery(100, 3000, true, false, true);

      const metrics = GraphRAGMonitor.getMetrics();
      expect(metrics.avgTokenUsage).toBe(2000); // (1000+2000+3000)/3
    });

    test('errorRate doğru hesaplanır', () => {
      GraphRAGMonitor.recordQuery(100, 1000, true, false, true);
      GraphRAGMonitor.recordQuery(100, 1000, true, false, true);
      GraphRAGMonitor.recordQuery(100, 1000, false, false, true); // 1 error

      const metrics = GraphRAGMonitor.getMetrics();
      expect(metrics.errorRate).toBeCloseTo(1 / 3, 5); // ~0.333
    });

    test('cacheHitRate doğru hesaplanır', () => {
      GraphRAGMonitor.recordQuery(100, 1000, true, true, true);
      GraphRAGMonitor.recordQuery(100, 1000, true, true, true);
      GraphRAGMonitor.recordQuery(100, 1000, true, false, true);

      const metrics = GraphRAGMonitor.getMetrics();
      expect(metrics.cacheHitRate).toBeCloseTo(2 / 3, 5); // ~0.667
    });

    test('graphRAGQueries=0 iken cacheHitRate=0', () => {
      GraphRAGMonitor.recordCacheHit();

      const metrics = GraphRAGMonitor.getMetrics();
      expect(metrics.cacheHitRate).toBe(0);
    });
  });

  describe('checkAlerts', () => {
    test('Error rate > 5% CRITICAL alert üretir', () => {
      // %10 error rate oluştur
      for (let i = 0; i < 9; i++) {
        GraphRAGMonitor.recordQuery(100, 1000, true, false, true);
      }
      GraphRAGMonitor.recordQuery(100, 1000, false, false, true); // 1 error / 10 total

      const alerts = GraphRAGMonitor.checkAlerts();
      const criticalAlerts = alerts.filter(a => a.severity === AlertSeverity.CRITICAL);

      expect(criticalAlerts.length).toBeGreaterThan(0);
      const errorAlert = criticalAlerts.find(a => a.metric === 'errorRate');
      expect(errorAlert).toBeDefined();
      expect(errorAlert!.currentValue).toBeCloseTo(0.1, 5);
      expect(errorAlert!.threshold).toBe(0.05);
    });

    test('p95Latency > 3000ms WARNING alert üretir', () => {
      // Yüksek latency'li query'ler kaydet
      for (let i = 0; i < 20; i++) {
        GraphRAGMonitor.recordQuery(4000, 1000, true, false, true);
      }

      const alerts = GraphRAGMonitor.checkAlerts();
      const warningAlerts = alerts.filter(a => a.severity === AlertSeverity.WARNING);

      expect(warningAlerts.length).toBeGreaterThan(0);
      const latencyAlert = warningAlerts.find(a => a.metric === 'p95Latency');
      expect(latencyAlert).toBeDefined();
      expect(latencyAlert!.currentValue).toBe(4000);
      expect(latencyAlert!.threshold).toBe(3000);
    });

    test('cacheHitRate < 50% WARNING alert üretir (10+ query sonrası)', () => {
      // Düşük cache hit rate (11 query, 0 cache hit)
      for (let i = 0; i < 11; i++) {
        GraphRAGMonitor.recordQuery(100, 1000, true, false, true);
      }

      const alerts = GraphRAGMonitor.checkAlerts();
      const warningAlerts = alerts.filter(a => a.severity === AlertSeverity.WARNING);

      expect(warningAlerts.length).toBeGreaterThan(0);
      const cacheAlert = warningAlerts.find(a => a.metric === 'cacheHitRate');
      expect(cacheAlert).toBeDefined();
      expect(cacheAlert!.currentValue).toBe(0);
      expect(cacheAlert!.threshold).toBe(0.5);
    });

    test('cacheHitRate < 50% ama 10 query altında alert üretmez', () => {
      // Düşük cache hit rate ama 10 query altında
      for (let i = 0; i < 5; i++) {
        GraphRAGMonitor.recordQuery(100, 1000, true, false, true);
      }

      const alerts = GraphRAGMonitor.checkAlerts();
      const cacheAlert = alerts.find(a => a.metric === 'cacheHitRate');
      expect(cacheAlert).toBeUndefined();
    });

    test('avgTokenUsage > 40000 WARNING alert üretir', () => {
      // Yüksek token usage
      for (let i = 0; i < 5; i++) {
        GraphRAGMonitor.recordQuery(100, 50000, true, false, true);
      }

      const alerts = GraphRAGMonitor.checkAlerts();
      const warningAlerts = alerts.filter(a => a.severity === AlertSeverity.WARNING);

      expect(warningAlerts.length).toBeGreaterThan(0);
      const tokenAlert = warningAlerts.find(a => a.metric === 'avgTokenUsage');
      expect(tokenAlert).toBeDefined();
      expect(tokenAlert!.currentValue).toBe(50000);
      expect(tokenAlert!.threshold).toBe(40000);
    });

    test('Alertler alerts arrayine eklenir', () => {
      // CRITICAL alert üret
      for (let i = 0; i < 9; i++) {
        GraphRAGMonitor.recordQuery(100, 1000, true, false, true);
      }
      GraphRAGMonitor.recordQuery(100, 1000, false, false, true);

      GraphRAGMonitor.checkAlerts();

      const allAlerts = GraphRAGMonitor.getAllAlerts();
      expect(allAlerts.length).toBeGreaterThan(0);
    });

    test('Alerts array\'i 100 elemanla sınırlıdır', () => {
      // 105 alert üretecek şekilde threshold'ları düşür
      GraphRAGMonitor.setThresholds({
        errorRateCritical: 0.001, // Çok düşük threshold
        p95LatencyWarning: 1,
        cacheHitRateWarning: 0.99,
        avgTokenUsageWarning: 1,
      });

      for (let i = 0; i < 105; i++) {
        GraphRAGMonitor.recordQuery(100, 1000, false, false, true);
        GraphRAGMonitor.checkAlerts();
      }

      const allAlerts = GraphRAGMonitor.getAllAlerts();
      expect(allAlerts.length).toBeLessThanOrEqual(100);
    });

    test('Normal koşullarda alert üretilmez', () => {
      // Normal query'ler
      for (let i = 0; i < 10; i++) {
        GraphRAGMonitor.recordQuery(100, 1000, true, true, true);
      }

      const alerts = GraphRAGMonitor.checkAlerts();
      expect(alerts).toHaveLength(0);
    });
  });

  describe('getRecentAlerts', () => {
    test('Varsayılan olarak son 10 alert\'i döner', () => {
      // Alert üret
      GraphRAGMonitor.setThresholds({
        errorRateCritical: 0.001,
        p95LatencyWarning: 1,
        cacheHitRateWarning: 0.99,
        avgTokenUsageWarning: 1,
      });

      for (let i = 0; i < 15; i++) {
        GraphRAGMonitor.recordQuery(100, 1000, false, false, true);
        GraphRAGMonitor.checkAlerts();
      }

      const recentAlerts = GraphRAGMonitor.getRecentAlerts();
      expect(recentAlerts.length).toBeLessThanOrEqual(10);
    });

    test('Belirtilen sayıda alert döner', () => {
      GraphRAGMonitor.setThresholds({
        errorRateCritical: 0.001,
        p95LatencyWarning: 1,
        cacheHitRateWarning: 0.99,
        avgTokenUsageWarning: 1,
      });

      for (let i = 0; i < 5; i++) {
        GraphRAGMonitor.recordQuery(100, 1000, false, false, true);
        GraphRAGMonitor.checkAlerts();
      }

      const recentAlerts = GraphRAGMonitor.getRecentAlerts(3);
      expect(recentAlerts.length).toBeLessThanOrEqual(3);
    });

    test('Alert yoksa boş dizi döner', () => {
      const recentAlerts = GraphRAGMonitor.getRecentAlerts();
      expect(recentAlerts).toEqual([]);
    });
  });

  describe('getAllAlerts', () => {
    test('Tüm alert\'leri döner', () => {
      GraphRAGMonitor.setThresholds({
        errorRateCritical: 0.001,
        p95LatencyWarning: 1,
        cacheHitRateWarning: 0.99,
        avgTokenUsageWarning: 1,
      });

      for (let i = 0; i < 3; i++) {
        GraphRAGMonitor.recordQuery(100, 1000, false, false, true);
        GraphRAGMonitor.checkAlerts();
      }

      const allAlerts = GraphRAGMonitor.getAllAlerts();
      expect(allAlerts.length).toBeGreaterThan(0);
    });

    test('Alert yoksa boş dizi döner', () => {
      const allAlerts = GraphRAGMonitor.getAllAlerts();
      expect(allAlerts).toEqual([]);
    });

    test('Kopya array döner, orijinal değil', () => {
      const alerts1 = GraphRAGMonitor.getAllAlerts();
      const alerts2 = GraphRAGMonitor.getAllAlerts();

      expect(alerts1).toEqual(alerts2);
      expect(alerts1).not.toBe(alerts2);
    });
  });

  describe('clearAlerts', () => {
    test('Tüm alert\'leri temizler', () => {
      GraphRAGMonitor.setThresholds({
        errorRateCritical: 0.001,
        p95LatencyWarning: 1,
        cacheHitRateWarning: 0.99,
        avgTokenUsageWarning: 1,
      });

      GraphRAGMonitor.recordQuery(100, 1000, false, false, true);
      GraphRAGMonitor.checkAlerts();

      expect(GraphRAGMonitor.getAllAlerts().length).toBeGreaterThan(0);

      GraphRAGMonitor.clearAlerts();

      expect(GraphRAGMonitor.getAllAlerts()).toEqual([]);
    });
  });

  describe('resetMetrics', () => {
    test('Tüm metrikleri sıfırlar', () => {
      // Metrik biriktir
      GraphRAGMonitor.recordQuery(100, 1000, true, true, true);
      GraphRAGMonitor.recordFallback();
      GraphRAGMonitor.recordError('Test error');

      GraphRAGMonitor.resetMetrics();

      const metrics = GraphRAGMonitor.getMetrics();
      expect(metrics.totalQueries).toBe(0);
      expect(metrics.graphRAGQueries).toBe(0);
      expect(metrics.fallbackQueries).toBe(0);
      expect(metrics.avgLatency).toBe(0);
      expect(metrics.avgTokenUsage).toBe(0);
      expect(metrics.cacheHitRate).toBe(0);
      expect(metrics.errorRate).toBe(0);
    });

    test('Alert\'leri de temizler', () => {
      GraphRAGMonitor.setThresholds({
        errorRateCritical: 0.001,
        p95LatencyWarning: 1,
        cacheHitRateWarning: 0.99,
        avgTokenUsageWarning: 1,
      });

      GraphRAGMonitor.recordQuery(100, 1000, false, false, true);
      GraphRAGMonitor.checkAlerts();

      expect(GraphRAGMonitor.getAllAlerts().length).toBeGreaterThan(0);

      GraphRAGMonitor.resetMetrics();

      expect(GraphRAGMonitor.getAllAlerts()).toEqual([]);
    });
  });

  describe('getThresholds', () => {
    test('Varsayılan threshold\'ları döner', () => {
      const thresholds = GraphRAGMonitor.getThresholds();

      expect(thresholds.errorRateCritical).toBe(0.05);
      expect(thresholds.p95LatencyWarning).toBe(3000);
      expect(thresholds.cacheHitRateWarning).toBe(0.5);
      expect(thresholds.avgTokenUsageWarning).toBe(40000);
    });

    test('Kopya obje döner, orijinal değil', () => {
      const thresholds1 = GraphRAGMonitor.getThresholds();
      const thresholds2 = GraphRAGMonitor.getThresholds();

      expect(thresholds1).toEqual(thresholds2);
      expect(thresholds1).not.toBe(thresholds2);
    });
  });

  describe('setThresholds', () => {
    test('Threshold\'ları günceller', () => {
      GraphRAGMonitor.setThresholds({
        errorRateCritical: 0.1,
        p95LatencyWarning: 5000,
      });

      const thresholds = GraphRAGMonitor.getThresholds();
      expect(thresholds.errorRateCritical).toBe(0.1);
      expect(thresholds.p95LatencyWarning).toBe(5000);
      // Değiştirilmeyenler varsayılan kalmalı
      expect(thresholds.cacheHitRateWarning).toBe(0.5);
      expect(thresholds.avgTokenUsageWarning).toBe(40000);
    });

    test('Kısmi threshold güncellemesi çalışır', () => {
      GraphRAGMonitor.setThresholds({
        errorRateCritical: 0.01,
      });

      const thresholds = GraphRAGMonitor.getThresholds();
      expect(thresholds.errorRateCritical).toBe(0.01);
      expect(thresholds.p95LatencyWarning).toBe(3000); // Değişmedi
    });
  });

  describe('AlertSeverity enum', () => {
    test('Tüm severity değerleri tanımlı', () => {
      expect(AlertSeverity.INFO).toBe('info');
      expect(AlertSeverity.WARNING).toBe('warning');
      expect(AlertSeverity.CRITICAL).toBe('critical');
    });
  });
});
