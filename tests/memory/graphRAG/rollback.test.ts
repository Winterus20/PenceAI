/**
 * GraphRAG Rollback Manager Testleri
 * 
 * Emergency rollback, gradual rollback, rollback to phase,
 * cooldown management ve rollback history testleri.
 */

import {
  defaultRollbackManager as GraphRAGRollbackManager,
  RollbackReason,
} from '../../../src/memory/graphRAG/rollback.js';
import {
  GraphRAGConfigManager,
  GraphRAGRolloutPhase,
} from '../../../src/memory/graphRAG/config.js';

// Logger mock
jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('GraphRAGRollbackManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Her test öncesi rollback manager'ı sıfırla
    GraphRAGRollbackManager.resetCooldown();
    // Config'i OFF phase'e sıfırla (test başlangıç durumu)
    GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.OFF);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('emergencyRollback', () => {
    test('FULL phase\'den PARTIAL phase\'e acil geri alma yapar', async () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);

      await GraphRAGRollbackManager.emergencyRollback(
        RollbackReason.HIGH_ERROR_RATE,
        'test-system',
      );

      expect(GraphRAGConfigManager.getCurrentPhase()).toBe(GraphRAGRolloutPhase.PARTIAL);
    });

    test('PARTIAL phase\'den PARTIAL phase\'e geri alma yapar (değişmez)', async () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.PARTIAL);

      await GraphRAGRollbackManager.emergencyRollback(
        RollbackReason.MANUAL_TRIGGER,
        'admin',
      );

      expect(GraphRAGConfigManager.getCurrentPhase()).toBe(GraphRAGRolloutPhase.PARTIAL);
    });

    test('OFF phase\'de emergency rollback işlem yapmaz', async () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.OFF);

      await GraphRAGRollbackManager.emergencyRollback(
        RollbackReason.UNKNOWN,
        'system',
      );

      expect(GraphRAGConfigManager.getCurrentPhase()).toBe(GraphRAGRolloutPhase.OFF);
    });

    test('Cooldown aktifken emergency rollback yoksayılır', async () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);

      // İlk rollback
      await GraphRAGRollbackManager.emergencyRollback(
        RollbackReason.TIMEOUT_ISSUES,
        'system',
      );

      expect(GraphRAGConfigManager.getCurrentPhase()).toBe(GraphRAGRolloutPhase.PARTIAL);

      // Config'i tekrar FULL yap
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);

      // Cooldown aktifken ikinci rollback
      await GraphRAGRollbackManager.emergencyRollback(
        RollbackReason.MEMORY_PRESSURE,
        'system',
      );

      // Cooldown nedeniyle phase değişmemeli
      expect(GraphRAGConfigManager.getCurrentPhase()).toBe(GraphRAGRolloutPhase.FULL);
    });

    test('Varsayılan parametrelerle emergency rollback çalışır', async () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);

      await GraphRAGRollbackManager.emergencyRollback();

      expect(GraphRAGConfigManager.getCurrentPhase()).toBe(GraphRAGRolloutPhase.PARTIAL);
    });

    test('Rollback history\'ye event eklenir', async () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);

      const historyBefore = GraphRAGRollbackManager.getRollbackHistory().length;

      await GraphRAGRollbackManager.emergencyRollback(
        RollbackReason.PERFORMANCE_DEGRADATION,
        'monitor',
      );

      const history = GraphRAGRollbackManager.getRollbackHistory();
      expect(history.length).toBeGreaterThan(historyBefore);
      const lastEvent = history[history.length - 1];
      expect(lastEvent.fromPhase).toBe(GraphRAGRolloutPhase.FULL);
      expect(lastEvent.toPhase).toBe(GraphRAGRolloutPhase.PARTIAL);
      expect(lastEvent.reason).toBe(RollbackReason.PERFORMANCE_DEGRADATION);
      expect(lastEvent.triggeredBy).toBe('monitor');
      expect(lastEvent.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('gradualRollback', () => {
    test('FULL\'dan 1 adım geri PARTIAL\'a gider', async () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);

      await GraphRAGRollbackManager.gradualRollback(1, RollbackReason.UNKNOWN, 'test');

      expect(GraphRAGConfigManager.getCurrentPhase()).toBe(GraphRAGRolloutPhase.PARTIAL);
    });

    test('FULL\'dan 2 adım geri SHADOW\'a gider', async () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);

      await GraphRAGRollbackManager.gradualRollback(2, RollbackReason.UNKNOWN, 'test');

      expect(GraphRAGConfigManager.getCurrentPhase()).toBe(GraphRAGRolloutPhase.SHADOW);
    });

    test('FULL\'dan 3 adım geri OFF\'a gider', async () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);

      await GraphRAGRollbackManager.gradualRollback(3, RollbackReason.UNKNOWN, 'test');

      expect(GraphRAGConfigManager.getCurrentPhase()).toBe(GraphRAGRolloutPhase.OFF);
    });

    test('FULL\'dan 4 adım geri OFF\'a gider (minimum phase)', async () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);

      await GraphRAGRollbackManager.gradualRollback(4, RollbackReason.UNKNOWN, 'test');

      expect(GraphRAGConfigManager.getCurrentPhase()).toBe(GraphRAGRolloutPhase.OFF);
    });

    test('PARTIAL\'dan 1 adım geri SHADOW\'a gider', async () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.PARTIAL);

      await GraphRAGRollbackManager.gradualRollback(1, RollbackReason.UNKNOWN, 'test');

      expect(GraphRAGConfigManager.getCurrentPhase()).toBe(GraphRAGRolloutPhase.SHADOW);
    });

    test('OFF phase\'de gradual rollback işlem yapmaz', async () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.OFF);

      await GraphRAGRollbackManager.gradualRollback(1, RollbackReason.UNKNOWN, 'test');

      expect(GraphRAGConfigManager.getCurrentPhase()).toBe(GraphRAGRolloutPhase.OFF);
    });

    test('Varsayılan steps=1 ile gradual rollback çalışır', async () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);

      await GraphRAGRollbackManager.gradualRollback();

      expect(GraphRAGConfigManager.getCurrentPhase()).toBe(GraphRAGRolloutPhase.PARTIAL);
    });

    test('Cooldown aktifken gradual rollback yoksayılır', async () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);

      // İlk rollback ile cooldown başlat
      await GraphRAGRollbackManager.gradualRollback(1, RollbackReason.UNKNOWN, 'test');

      // Config'i tekrar FULL yap
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);

      // İkinci rollback cooldown nedeniyle yoksayılmalı
      await GraphRAGRollbackManager.gradualRollback(1, RollbackReason.UNKNOWN, 'test');

      expect(GraphRAGConfigManager.getCurrentPhase()).toBe(GraphRAGRolloutPhase.FULL);
    });
  });

  describe('rollbackToPhase', () => {
    test('FULL\'dan SHADOW\'a doğrudan rollback yapar', async () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);

      await GraphRAGRollbackManager.rollbackToPhase(
        GraphRAGRolloutPhase.SHADOW,
        RollbackReason.MANUAL_TRIGGER,
        'admin',
      );

      expect(GraphRAGConfigManager.getCurrentPhase()).toBe(GraphRAGRolloutPhase.SHADOW);
    });

    test('FULL\'dan OFF\'a doğrudan rollback yapar', async () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);

      await GraphRAGRollbackManager.rollbackToPhase(
        GraphRAGRolloutPhase.OFF,
        RollbackReason.HIGH_ERROR_RATE,
        'system',
      );

      expect(GraphRAGConfigManager.getCurrentPhase()).toBe(GraphRAGRolloutPhase.OFF);
    });

    test('PARTIAL\'dan SHADOW\'a rollback yapar', async () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.PARTIAL);

      await GraphRAGRollbackManager.rollbackToPhase(
        GraphRAGRolloutPhase.SHADOW,
        RollbackReason.UNKNOWN,
        'test',
      );

      expect(GraphRAGConfigManager.getCurrentPhase()).toBe(GraphRAGRolloutPhase.SHADOW);
    });

    test('Hedef phase mevcut phase ile aynıysa işlem yapmaz', async () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);

      const historyBefore = GraphRAGRollbackManager.getRollbackHistory().length;

      await GraphRAGRollbackManager.rollbackToPhase(
        GraphRAGRolloutPhase.FULL,
        RollbackReason.UNKNOWN,
        'test',
      );

      expect(GraphRAGConfigManager.getCurrentPhase()).toBe(GraphRAGRolloutPhase.FULL);
      const historyAfter = GraphRAGRollbackManager.getRollbackHistory().length;
      expect(historyAfter).toBe(historyBefore);
    });

    test('Hedef phase mevcut phase\'den yüksekse işlem yapmaz', async () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.SHADOW);

      const historyBefore = GraphRAGRollbackManager.getRollbackHistory().length;

      await GraphRAGRollbackManager.rollbackToPhase(
        GraphRAGRolloutPhase.FULL,
        RollbackReason.UNKNOWN,
        'test',
      );

      expect(GraphRAGConfigManager.getCurrentPhase()).toBe(GraphRAGRolloutPhase.SHADOW);
      const historyAfter = GraphRAGRollbackManager.getRollbackHistory().length;
      expect(historyAfter).toBe(historyBefore);
    });

    test('Cooldown aktifken rollbackToPhase yoksayılır', async () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);

      // İlk rollback
      await GraphRAGRollbackManager.rollbackToPhase(
        GraphRAGRolloutPhase.SHADOW,
        RollbackReason.UNKNOWN,
        'test',
      );

      // Config'i tekrar FULL yap
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);

      // İkinci rollback cooldown nedeniyle yoksayılmalı
      await GraphRAGRollbackManager.rollbackToPhase(
        GraphRAGRolloutPhase.OFF,
        RollbackReason.UNKNOWN,
        'test',
      );

      expect(GraphRAGConfigManager.getCurrentPhase()).toBe(GraphRAGRolloutPhase.FULL);
    });
  });

  describe('getLastRollbackTime', () => {
    test('Rollback sonrası tarih döner', async () => {

    });
  });

  describe('getRollbackHistory', () => {
    test('Rollback sonrası history\'de event olur', async () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);

      const historyBefore = GraphRAGRollbackManager.getRollbackHistory().length;

      await GraphRAGRollbackManager.emergencyRollback(
        RollbackReason.HIGH_ERROR_RATE,
        'system',
      );

      const history = GraphRAGRollbackManager.getRollbackHistory();
      expect(history.length).toBeGreaterThan(historyBefore);
    });

    test('Birden fazla rollback history\'de birikir', async () => {
      const historyBefore = GraphRAGRollbackManager.getRollbackHistory().length;

      // İlk rollback
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);
      await GraphRAGRollbackManager.emergencyRollback(
        RollbackReason.HIGH_ERROR_RATE,
        'system',
      );

      // Cooldown'u sıfırla ve ikinci rollback
      GraphRAGRollbackManager.resetCooldown();
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);
      await GraphRAGRollbackManager.gradualRollback(
        2,
        RollbackReason.TIMEOUT_ISSUES,
        'monitor',
      );

      const history = GraphRAGRollbackManager.getRollbackHistory();
      expect(history.length).toBeGreaterThanOrEqual(historyBefore + 2);
    });

    test('History kopya döner, orijinal array değil', async () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);
      await GraphRAGRollbackManager.emergencyRollback(
        RollbackReason.UNKNOWN,
        'test',
      );

      const history1 = GraphRAGRollbackManager.getRollbackHistory();
      const history2 = GraphRAGRollbackManager.getRollbackHistory();

      expect(history1).toEqual(history2);
      expect(history1).not.toBe(history2); // Farklı array referansları
    });

    test('History maksimum 100 event ile sınırlıdır', async () => {
      GraphRAGRollbackManager.resetCooldown();

      // 105 rollback simüle et
      for (let i = 0; i < 105; i++) {
        GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);
        await GraphRAGRollbackManager.emergencyRollback(
          RollbackReason.UNKNOWN,
          `test-${i}`,
        );
        GraphRAGRollbackManager.resetCooldown();
      }

      const history = GraphRAGRollbackManager.getRollbackHistory();
      expect(history.length).toBeLessThanOrEqual(100);
    });
  });

  describe('isOnCooldown', () => {
    test('İlk başta false döner', () => {
      expect(GraphRAGRollbackManager.isOnCooldown()).toBe(false);
    });

    test('Rollback sonrası true döner', async () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);
      await GraphRAGRollbackManager.emergencyRollback(
        RollbackReason.UNKNOWN,
        'test',
      );

      expect(GraphRAGRollbackManager.isOnCooldown()).toBe(true);
    });

    test('resetCooldown sonrası false döner', async () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);
      await GraphRAGRollbackManager.emergencyRollback(
        RollbackReason.UNKNOWN,
        'test',
      );

      expect(GraphRAGRollbackManager.isOnCooldown()).toBe(true);

      GraphRAGRollbackManager.resetCooldown();

      expect(GraphRAGRollbackManager.isOnCooldown()).toBe(false);
    });

    test('Cooldown süresi dolunca false döner', async () => {
      jest.useFakeTimers();
      GraphRAGRollbackManager.setCooldownMs(1000); // Test için 1 saniye cooldown

      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);
      await GraphRAGRollbackManager.emergencyRollback(
        RollbackReason.UNKNOWN,
        'test',
      );

      expect(GraphRAGRollbackManager.isOnCooldown()).toBe(true);

      // Cooldown süresini ilerlet
      jest.advanceTimersByTime(1000);

      expect(GraphRAGRollbackManager.isOnCooldown()).toBe(false);
    });
  });

  describe('resetCooldown', () => {
    test('Cooldown\'u sıfırlar', async () => {
      GraphRAGConfigManager.setRolloutPhase(GraphRAGRolloutPhase.FULL);
      await GraphRAGRollbackManager.emergencyRollback(
        RollbackReason.UNKNOWN,
        'test',
      );

      expect(GraphRAGRollbackManager.isOnCooldown()).toBe(true);

      GraphRAGRollbackManager.resetCooldown();

      expect(GraphRAGRollbackManager.isOnCooldown()).toBe(false);
    });
  });

  describe('getCooldownMs', () => {
    test('Cooldown süresini getirir', () => {
      GraphRAGRollbackManager.setCooldownMs(60000);
      expect(GraphRAGRollbackManager.getCooldownMs()).toBe(60000);
      // Reset to default
      GraphRAGRollbackManager.setCooldownMs(30 * 60 * 1000);
    });
  });

  describe('setCooldownMs', () => {
    test('Cooldown süresini değiştirir', () => {
      GraphRAGRollbackManager.setCooldownMs(5000);
      expect(GraphRAGRollbackManager.getCooldownMs()).toBe(5000);

      // Reset to default
      GraphRAGRollbackManager.setCooldownMs(30 * 60 * 1000);
    });
  });

  describe('RollbackReason enum', () => {
    test('Tüm rollback reason değerleri tanımlı', () => {
      expect(RollbackReason.HIGH_ERROR_RATE).toBe('high_error_rate');
      expect(RollbackReason.TIMEOUT_ISSUES).toBe('timeout_issues');
      expect(RollbackReason.MEMORY_PRESSURE).toBe('memory_pressure');
      expect(RollbackReason.PERFORMANCE_DEGRADATION).toBe('performance_degradation');
      expect(RollbackReason.MANUAL_TRIGGER).toBe('manual_trigger');
      expect(RollbackReason.UNKNOWN).toBe('unknown');
    });
  });
});
