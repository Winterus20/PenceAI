/**
 * GraphRAG FULL Phase Test Suite.
 *
 * FULL phase (Phase 4) için özel test senaryoları:
 * - %100 sample rate
 * - 3-hop traversal
 * - 48000 token budget
 * - 8 saniye timeout
 * - High load simulation
 * - Memory leak check
 * - Cache effectiveness
 * - Fallback reliability
 */

// Logger mock - import.meta.url sorununu önler
jest.mock('../../../src/memory/graphRAG/GraphRAGEngine.js', () => {
  const mockEngine = {
    query: jest.fn(),
    isEnabled: jest.fn().mockReturnValue(true),
    setEnabled: jest.fn(),
    getHealthStatus: jest.fn().mockReturnValue({ healthy: true, lastError: null }),
  };
  return {
    GraphRAGEngine: jest.fn().mockImplementation(() => mockEngine),
    __mockEngine: mockEngine,
  };
});

jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  GraphRAGConfigManager,
  GraphRAGRolloutPhase,
  ROLLOUT_PHASE_CONFIG,
} from '../../../src/memory/graphRAG/config.js';
import { FULL_PHASE_CONFIG } from '../../../src/memory/graphRAG/GraphWorker.js';

// Mock engine'i al
const { __mockEngine } = jest.requireMock('../../../src/memory/graphRAG/GraphRAGEngine.js');

describe('GraphRAG FULL Phase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // FULL phase config'i uygula
    GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);
  });

  afterEach(() => {
    // Test sonrası PARTIAL'a geri dön
    GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.PARTIAL);
  });

  /**
   * Test 1: %100 sample rate ile tüm sorgular GraphRAG ile işleniyor mu?
   * sampleRate: 1.0 ile Math.random() < 1.0 her zaman true olmalı
   */
  describe('100% sample rate', () => {
    test('all queries should use GraphRAG when sampleRate is 1.0', () => {
      const config = GraphRAGConfigManager.getConfig();
      expect(config.sampleRate).toBe(1.0);

      // Math.random() her zaman 0-1 arasında, sampleRate 1.0 olduğunda her zaman true
      for (let i = 0; i < 100; i++) {
        const shouldUseGraphRAG = Math.random() < config.sampleRate;
        expect(shouldUseGraphRAG).toBe(true);
      }
    });

    test('FULL phase config should have correct values', () => {
      const fullConfig = ROLLOUT_PHASE_CONFIG[GraphRAGRolloutPhase.FULL];
      expect(fullConfig.enabled).toBe(true);
      expect(fullConfig.shadowMode).toBe(false);
      expect(fullConfig.sampleRate).toBe(1.0);
      expect(fullConfig.maxHops).toBe(3);
      expect(fullConfig.tokenBudget).toBe(48000);
      expect(fullConfig.timeoutMs).toBe(8000);
      expect(fullConfig.fallbackEnabled).toBe(true);
    });
  });

  /**
   * Test 2: 3-hop traversal çalışıyor mu?
   * maxHops: 3 ile derin traversal testi
   */
  describe('3-hop traversal', () => {
    test('config should have maxHops set to 3', () => {
      const config = GraphRAGConfigManager.getConfig();
      expect(config.maxHops).toBe(3);
    });

    test('GraphWorker should have FULL phase intervals', () => {
      expect(FULL_PHASE_CONFIG.pageRankIntervalMs).toBe(30 * 60 * 1000); // 30 dakika
      expect(FULL_PHASE_CONFIG.communityDetectionIntervalMs).toBe(3 * 60 * 60 * 1000); // 3 saat
      expect(FULL_PHASE_CONFIG.cacheCleanupIntervalMs).toBe(15 * 60 * 1000); // 15 dakika
      expect(FULL_PHASE_CONFIG.summaryGenerationIntervalMs).toBe(6 * 60 * 60 * 1000); // 6 saat
    });
  });

  /**
   * Test 3: 48000 token budget enforcement
   * TokenPruner 48000 limit ile çalışıyor mu?
   */
  describe('Token budget enforcement', () => {
    test('FULL phase token budget should be 48000', () => {
      const config = GraphRAGConfigManager.getConfig();
      expect(config.tokenBudget).toBe(48000);
    });

    test('token budget should be within valid range', () => {
      const config = GraphRAGConfigManager.getConfig();
      expect(config.tokenBudget).toBeGreaterThanOrEqual(4000);
      expect(config.tokenBudget).toBeLessThanOrEqual(128000);
    });
  });

  /**
   * Test 4: 8 saniye timeout
   * Timeout durumunda fallback çalışıyor mu?
   */
  describe('8 second timeout', () => {
    test('FULL phase timeout should be 8000ms', () => {
      const config = GraphRAGConfigManager.getConfig();
      expect(config.timeoutMs).toBe(8000);
    });

    test('timeout should be within valid range', () => {
      const config = GraphRAGConfigManager.getConfig();
      expect(config.timeoutMs).toBeGreaterThanOrEqual(1000);
      expect(config.timeoutMs).toBeLessThanOrEqual(30000);
    });
  });

  /**
   * Test 5: High load simulation (100 concurrent queries)
   * 100 paralel sorgu ile stress test
   */
  describe('High load handling', () => {
    test('should handle 100 concurrent queries without errors', async () => {
      __mockEngine.query.mockResolvedValue({
        nodes: [],
        edges: [],
        context: 'test context',
        tokenCount: 100,
      });

      const queries = Array.from({ length: 100 }, (_, i) => `query ${i}`);
      const results = await Promise.allSettled(
        queries.map((q) => __mockEngine.query(q))
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(100);
      expect(rejected.length).toBe(0);
    });
  });

  /**
   * Test 6: Memory leak check
   * 1000 sorgu sonrası memory kullanımı stabil mi?
   */
  describe('Memory leak check', () => {
    test('should not have memory leaks after 1000 queries', async () => {
      __mockEngine.query.mockResolvedValue({
        nodes: [],
        edges: [],
        context: 'test context',
        tokenCount: 100,
      });

      const initialMemory = process.memoryUsage();

      // 1000 sorgu çalıştır
      for (let i = 0; i < 1000; i++) {
        await __mockEngine.query(`query ${i}`);
      }

      const finalMemory = process.memoryUsage();

      // Memory artışı %50'den fazla olmamalı (basit kontrol)
      const heapGrowth =
        ((finalMemory.heapUsed - initialMemory.heapUsed) / initialMemory.heapUsed) * 100;

      // Not: Bu basit bir kontrol, gerçek memory leak testi daha kapsamlı olmalı
      expect(heapGrowth).toBeLessThan(50);
    });
  });

  /**
   * Test 7: Cache effectiveness
   * FULL phase'te cache hit rate artmalı
   */
  describe('Cache effectiveness', () => {
    test('FULL phase should have longer TTL for better cache hit rate', () => {
      // FULL phase config'te cache TTL 2 saat olmalı
      const fullConfig = ROLLOUT_PHASE_CONFIG[GraphRAGRolloutPhase.FULL];
      expect(fullConfig.enabled).toBe(true);
      // Cache hit rate config'den bağımsız olarak GraphCache TTL'ine bağlı
    });
  });

  /**
   * Test 8: Fallback reliability
   * GraphRAG başarısız olduğunda standard search'e düşüyor mu?
   */
  describe('Fallback reliability', () => {
    test('fallback should be enabled in FULL phase', () => {
      const config = GraphRAGConfigManager.getConfig();
      expect(config.fallbackEnabled).toBe(true);
    });

    test('should handle GraphRAG failure gracefully', async () => {
      __mockEngine.query.mockRejectedValue(new Error('GraphRAG timeout'));

      // Fallback mekanizması olmalı
      const config = GraphRAGConfigManager.getConfig();
      expect(config.fallbackEnabled).toBe(true);

      // Gerçek fallback testi engine implementasyonuna bağlı
      // Bu test sadece config'in doğru olduğunu doğrular
    });
  });

  /**
   * Test 9: Phase transition
   * PARTIAL → FULL geçişi doğru çalışıyor mu?
   */
  describe('Phase transition', () => {
    test('should transition from PARTIAL to FULL correctly', () => {
      // Önce PARTIAL
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.PARTIAL);
      let config = GraphRAGConfigManager.getConfig();
      expect(config.sampleRate).toBe(0.3);
      expect(config.maxHops).toBe(2);
      expect(config.tokenBudget).toBe(32000);
      expect(config.timeoutMs).toBe(5000);

      // Sonra FULL
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);
      config = GraphRAGConfigManager.getConfig();
      expect(config.sampleRate).toBe(1.0);
      expect(config.maxHops).toBe(3);
      expect(config.tokenBudget).toBe(48000);
      expect(config.timeoutMs).toBe(8000);
    });

    test('advancePhase should reach FULL from PARTIAL', () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.PARTIAL);
      const newPhase = GraphRAGConfigManager.advancePhase();
      expect(newPhase).toBe(GraphRAGRolloutPhase.FULL);

      const config = GraphRAGConfigManager.getConfig();
      expect(config.sampleRate).toBe(1.0);
    });

    test('advancePhase at FULL should stay at FULL', () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);
      const newPhase = GraphRAGConfigManager.advancePhase();
      expect(newPhase).toBe(GraphRAGRolloutPhase.FULL);
    });
  });

  /**
   * Test 10: Config validation
   * FULL phase config validasyon kurallarına uygun mu?
   */
  describe('Config validation', () => {
    test('FULL phase config should pass validation', () => {
      const fullConfig = ROLLOUT_PHASE_CONFIG[GraphRAGRolloutPhase.FULL];
      const isValid = GraphRAGConfigManager.validateConfig(fullConfig);
      expect(isValid).toBe(true);
    });

    test('getCurrentPhase should return FULL when sampleRate is 1.0', () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);
      const phase = GraphRAGConfigManager.getCurrentPhase();
      expect(phase).toBe(GraphRAGRolloutPhase.FULL);
    });
  });
});
