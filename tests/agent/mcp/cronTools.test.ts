/**
 * cronTools — Unit Tests
 *
 * createCronTools() ve rehydrateTimers() fonksiyonlarını test eder:
 * wake_me_in, wake_me_every, cancel_timer, list_timers araçları.
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// ── Mocks (Jest hoisting için import'lardan önce olmalı) ──────────────────

jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('test-uuid-1234'),
}));

jest.mock('croner', () => ({
  Cron: jest.fn().mockImplementation(() => ({
    nextRun: jest.fn().mockReturnValue(new Date(Date.now() + 60000)),
    stop: jest.fn(),
  })),
}));

jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../../src/utils/index.js', () => ({
  globalEventBus: { emit: jest.fn(), on: jest.fn() },
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactToolOutput: jest.fn((_: unknown, v: unknown) => v),
  redactSecrets: jest.fn((v: unknown) => v),
  countSecretMatches: jest.fn(() => ({ total: 0, labels: {} })),
}));

// ── Imports ───────────────────────────────────────────────────────────────

import { createCronTools, rehydrateTimers } from '../../../src/agent/mcp/tools/cronTools.js';
import { Cron } from 'croner';
import { logger } from '../../../src/utils/logger.js';
import type Database from 'better-sqlite3';

// ── Tip Yardımcıları ──────────────────────────────────────────────────────

/** makeMockDb içindeki jest mock'larına tip güvenli erişim için ara yüz. */
interface MockDbInternals {
  prepare: jest.Mock;
  run: jest.Mock;
  get: jest.Mock;
  all: jest.Mock;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * better-sqlite3 Database'ini taklit eden hafif bir mock nesnesi üretir.
 * `prepare` her çağrıda aynı `{ run, get, all }` statement mock'unu döndürür.
 * İçteki mock'lara `db as unknown as MockDbInternals` cast'iyle erişilir.
 */
function makeMockDb(rows: unknown[] = []): Database.Database {
  const run = jest.fn().mockReturnValue({ changes: 1 });
  const get = jest.fn().mockReturnValue({ last_id: 0 });
  const all = jest.fn().mockReturnValue(rows);
  const prepare = jest.fn().mockReturnValue({ run, get, all });
  return { prepare, run, get, all } as unknown as Database.Database;
}

// ── Test Suite ────────────────────────────────────────────────────────────

describe('cronTools', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  // ── wake_me_in ─────────────────────────────────────────────────────────
  describe('wake_me_in', () => {
    it('minutes sıfır ise hata döndürür', async () => {
      const tools = createCronTools();
      const tool = tools.find(t => t.name === 'wake_me_in')!;
      const result = await tool.execute({ minutes: 0, reason: 'test' });
      expect(result).toBe('Hata: "minutes" pozitif bir sayı olmalıdır.');
    });

    it('negatif minutes için hata döndürür', async () => {
      const tools = createCronTools();
      const tool = tools.find(t => t.name === 'wake_me_in')!;
      const result = await tool.execute({ minutes: -3, reason: 'test' });
      expect(result).toBe('Hata: "minutes" pozitif bir sayı olmalıdır.');
    });

    it('reason boş ise hata döndürür', async () => {
      const tools = createCronTools();
      const tool = tools.find(t => t.name === 'wake_me_in')!;
      const result = await tool.execute({ minutes: 10, reason: '' });
      expect(result).toBe('Hata: "reason" alanı zorunludur.');
    });

    it('geçerli girişte başarı mesajı ve timer ID döndürür', async () => {
      const tools = createCronTools();
      const tool = tools.find(t => t.name === 'wake_me_in')!;
      const result = await tool.execute({ minutes: 5, reason: 'Test uyandırma' });
      expect(result).toContain('Başarıyla');
      expect(result).toContain('5 dakika');
      expect(result).toContain('Timer ID: `test-uuid-1234`');
    });

    it('context.conversationId kullanıldığında başarı mesajı döndürür', async () => {
      const tools = createCronTools();
      const tool = tools.find(t => t.name === 'wake_me_in')!;
      const result = await tool.execute(
        { minutes: 2, reason: 'Context testi' },
        { conversationId: 'conv-abc' },
      );
      expect(result).toContain('Başarıyla');
      expect(result).toContain('Timer ID: `test-uuid-1234`');
    });

    it('DB varsa scheduled_tasks tablosuna INSERT çağrısı yapar', async () => {
      const db = makeMockDb();
      const tools = createCronTools(db);
      const tool = tools.find(t => t.name === 'wake_me_in')!;
      await tool.execute({ minutes: 5, reason: 'DB kayıt testi' });
      const { prepare } = db as unknown as MockDbInternals;
      expect(prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO scheduled_tasks'),
      );
    });
  });

  // ── wake_me_every ──────────────────────────────────────────────────────
  describe('wake_me_every', () => {
    it('cronExpression boş ise hata döndürür', async () => {
      const tools = createCronTools();
      const tool = tools.find(t => t.name === 'wake_me_every')!;
      const result = await tool.execute({ cronExpression: '', reason: 'test' });
      expect(result).toBe('Hata: "cronExpression" alanı zorunludur.');
    });

    it('reason boş ise hata döndürür', async () => {
      const tools = createCronTools();
      const tool = tools.find(t => t.name === 'wake_me_every')!;
      const result = await tool.execute({ cronExpression: '* * * * *', reason: '' });
      expect(result).toBe('Hata: "reason" alanı zorunludur.');
    });

    it('geçersiz cron ifadesi için hata döndürür', async () => {
      // İlk new Cron() çağrısını (doğrulama adımı) throw ile geçersiz kıl
      (Cron as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Invalid cron expression');
      });
      const tools = createCronTools();
      const tool = tools.find(t => t.name === 'wake_me_every')!;
      const result = await tool.execute({ cronExpression: 'invalid-cron', reason: 'test' });
      expect(result).toMatch(/^Hata: Geçersiz cron ifadesi/);
    });

    it('geçerli cron ifadesi ile başarı mesajı döndürür', async () => {
      const tools = createCronTools();
      const tool = tools.find(t => t.name === 'wake_me_every')!;
      const result = await tool.execute({ cronExpression: '* * * * *', reason: 'Periyodik kontrol' });
      expect(result).toContain('Başarıyla');
    });

    it('DB varsa scheduled_tasks tablosuna INSERT çağrısı yapar', async () => {
      const db = makeMockDb();
      const tools = createCronTools(db);
      const tool = tools.find(t => t.name === 'wake_me_every')!;
      await tool.execute({ cronExpression: '* * * * *', reason: 'DB kayıt testi' });
      const { prepare } = db as unknown as MockDbInternals;
      expect(prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO scheduled_tasks'),
      );
    });
  });

  // ── cancel_timer ───────────────────────────────────────────────────────
  describe('cancel_timer', () => {
    it('timerId boş ise hata döndürür', async () => {
      const tools = createCronTools();
      const tool = tools.find(t => t.name === 'cancel_timer')!;
      const result = await tool.execute({ timerId: '' });
      expect(result).toBe('Hata: "timerId" alanı zorunludur.');
    });

    it('var olmayan ID için uyarı döndürür', async () => {
      const tools = createCronTools();
      const tool = tools.find(t => t.name === 'cancel_timer')!;
      const result = await tool.execute({ timerId: 'non-existent-uuid-9999' });
      expect(result).toContain('⚠️ Timer bulunamadı:');
    });

    it('aktif timeout varken başarıyla iptal eder', async () => {
      const tools = createCronTools();
      const wakeTool = tools.find(t => t.name === 'wake_me_in')!;
      const cancelTool = tools.find(t => t.name === 'cancel_timer')!;
      // Önce timer oluştur — activeTimeouts map'e eklenir, fake timers ile tetiklenmez
      await wakeTool.execute({ minutes: 10, reason: 'İptal testi' });
      // Sonra iptal et
      const result = await cancelTool.execute({ timerId: 'test-uuid-1234' });
      expect(result).toContain('✅ Timer başarıyla iptal edildi:');
    });
  });

  // ── list_timers ────────────────────────────────────────────────────────
  describe('list_timers', () => {
    it('aktif zamanlayıcı yokken ve DB boşken uygun mesaj döndürür', async () => {
      const tools = createCronTools();
      const cancelTool = tools.find(t => t.name === 'cancel_timer')!;
      const listTool = tools.find(t => t.name === 'list_timers')!;
      // Önceki testlerden kalan in-memory state'i temizle
      await cancelTool.execute({ timerId: 'test-uuid-1234' });
      const result = await listTool.execute({});
      expect(result).toBe('Aktif zamanlayıcı yok.');
    });

    it("DB-only kayıtları (in-memory'de olmayan) listeler", async () => {
      const futureTime = new Date(Date.now() + 300_000).toISOString();
      const dbRows = [
        {
          id: 'db-only-timer-id',
          name: 'test_timer',
          cron_expression: '*/5 * * * *',
          timer_type: 'cron',
          conversation_id: null,
          next_run: futureTime,
        },
      ];
      const db = makeMockDb(dbRows);
      const tools = createCronTools(db);
      const cancelTool = tools.find(t => t.name === 'cancel_timer')!;
      const listTool = tools.find(t => t.name === 'list_timers')!;
      // In-memory state'i temizle; DB mock her zaman dbRows döndürür
      await cancelTool.execute({ timerId: 'test-uuid-1234' });
      const result = await listTool.execute({});
      expect(result).toContain('db-only-timer-id');
    });
  });

  // ── rehydrateTimers ────────────────────────────────────────────────────
  describe('rehydrateTimers', () => {
    it('DB boş ise hata vermez', () => {
      const db = makeMockDb([]);
      expect(() => rehydrateTimers(db)).not.toThrow();
    });

    it('süresi dolmuş one_time timer için DELETE çağrısı yapar', () => {
      const expiredRow = {
        id: 'expired-timer-id',
        cron_expression: 'after:5m',
        action: JSON.stringify({ reason: 'Süresi dolmuş test', conversationId: 'conv-1' }),
        timer_type: 'one_time',
        conversation_id: 'conv-1',
        // Geçmiş tarih → delay <= 0 dalı çalışır, DELETE hemen çağrılır
        next_run: new Date(Date.now() - 1000).toISOString(),
      };
      const db = makeMockDb([expiredRow]);
      const { prepare, run } = db as unknown as MockDbInternals;

      rehydrateTimers(db);

      expect(prepare).toHaveBeenCalledWith('DELETE FROM scheduled_tasks WHERE id = ?');
      expect(run).toHaveBeenCalledWith('expired-timer-id');
    });

    it('gelecekteki one_time timer için setTimeout kurulur, DELETE çağrılmaz', () => {
      const futureRow = {
        id: 'future-timer-id',
        cron_expression: 'after:10m',
        action: JSON.stringify({ reason: 'Gelecekteki test', conversationId: 'conv-3' }),
        timer_type: 'one_time',
        conversation_id: 'conv-3',
        next_run: new Date(Date.now() + 600_000).toISOString(),
      };
      const db = makeMockDb([futureRow]);
      const { prepare } = db as unknown as MockDbInternals;

      rehydrateTimers(db);

      // SELECT çağrılmış olmalı ama DELETE çağrılmamalı
      const deleteCalled = (prepare.mock.calls as unknown[][]).some(
        args => args[0] === 'DELETE FROM scheduled_tasks WHERE id = ?',
      );
      expect(deleteCalled).toBe(false);
    });

    it('geçerli cron tipi için Cron oluşturulur ve logger.info çağrılır', () => {
      const cronRow = {
        id: 'cron-timer-id',
        cron_expression: '* * * * *',
        action: JSON.stringify({ reason: 'Düzenli test', conversationId: 'conv-2' }),
        timer_type: 'cron',
        conversation_id: 'conv-2',
        next_run: null,
      };
      const db = makeMockDb([cronRow]);

      rehydrateTimers(db);

      expect(Cron as jest.Mock).toHaveBeenCalledWith('* * * * *', expect.any(Function));
      expect(jest.mocked(logger.info)).toHaveBeenCalled();
    });

    it('hatalı cron ifadesinde logger.warn çağrılır, hata fırlatmaz', () => {
      // Cron constructor'ı throw etsin
      (Cron as jest.Mock).mockImplementationOnce(() => {
        throw new Error('bad cron');
      });
      const badCronRow = {
        id: 'bad-cron-id',
        cron_expression: '99 99 99 99 99',
        action: JSON.stringify({ reason: 'Hatalı cron' }),
        timer_type: 'cron',
        conversation_id: null,
        next_run: null,
      };
      const db = makeMockDb([badCronRow]);

      expect(() => rehydrateTimers(db)).not.toThrow();
      expect(jest.mocked(logger.warn)).toHaveBeenCalled();
    });
  });
});
