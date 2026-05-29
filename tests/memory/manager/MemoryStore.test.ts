/**
 * MemoryStore unit tests — basic CRUD, settings, FTS dedup
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type Database from 'better-sqlite3';
import { MemoryStore } from '../../../src/memory/manager/MemoryStore.js';
import { PenceDatabase } from '../../../src/memory/database.js';

function canUseBetterSqlite(): boolean {
  try {
    const probe = new PenceDatabase(':memory:');
    probe.close();
    return true;
  } catch {
    return false;
  }
}

const describeIfSqlite = canUseBetterSqlite() ? describe : describe.skip;
describeIfSqlite('MemoryStore', () => {
  let penceDb: PenceDatabase;
  let db: Database.Database;
  let memoryStore: MemoryStore;
  let mockGraphManager: {
    autoCreateProximityRelations: ReturnType<typeof jest.fn>;
    cleanupMemoryGraph: ReturnType<typeof jest.fn>;
    updateStabilityOnAccess: ReturnType<typeof jest.fn>;
  };

  beforeEach(() => {
    penceDb = new PenceDatabase(':memory:');
    db = penceDb.getDb();

    mockGraphManager = {
      autoCreateProximityRelations: jest.fn(),
      cleanupMemoryGraph: jest.fn(),
      updateStabilityOnAccess: jest.fn(),
    };

    memoryStore = new MemoryStore(db, null, null, mockGraphManager);
  });

  afterEach(() => {
    penceDb.close();
  });

  describe('addMemory without embedding provider', () => {
    it('inserts a new memory record', async () => {
      const result = await memoryStore.addMemory('TypeScript projesi kullanıyor', 'general', 5);

      expect(result.id).toBeGreaterThan(0);
      expect(result.isUpdate).toBe(false);

      const row = db.prepare('SELECT content, category FROM memories WHERE id = ?').get(result.id) as {
        content: string;
        category: string;
      };
      expect(row.content).toBe('TypeScript projesi kullanıyor');
      expect(row.category).toBe('general');
      expect(mockGraphManager.autoCreateProximityRelations).toHaveBeenCalledWith(result.id);
    });

    it('deduplicates near-identical content via FTS fallback', async () => {
      const first = await memoryStore.addMemory(
        'Kullanıcı Python programlama dilini tercih ediyor',
        'preference',
        6,
      );
      const second = await memoryStore.addMemory(
        'Kullanıcı Python programlama dilini tercih ediyor',
        'preference',
        6,
      );

      expect(first.id).toBe(second.id);
      expect(second.isUpdate).toBe(false);

      const count = db.prepare("SELECT COUNT(*) as count FROM memories WHERE category = 'preference'").get() as {
        count: number;
      };
      expect(count.count).toBe(1);

      const row = db.prepare('SELECT access_count FROM memories WHERE id = ?').get(first.id) as {
        access_count: number;
      };
      expect(row.access_count).toBe(1);
    });
  });

  describe('deleteMemory', () => {
    it('removes an existing memory and cleans up graph', async () => {
      const { id } = await memoryStore.addMemory('Silinecek bellek', 'general', 3);

      const deleted = memoryStore.deleteMemory(id);
      expect(deleted).toBe(true);
      expect(mockGraphManager.cleanupMemoryGraph).toHaveBeenCalledWith(id);

      const row = db.prepare('SELECT id FROM memories WHERE id = ?').get(id);
      expect(row).toBeUndefined();
    });

    it('returns false for non-existent id', () => {
      expect(memoryStore.deleteMemory(99999)).toBe(false);
    });
  });

  describe('settings', () => {
    it('stores and retrieves settings via getSetting/setSetting', () => {
      memoryStore.setSetting('test_key', 'test_value');
      expect(memoryStore.getSetting('test_key')).toBe('test_value');
    });

    it('deletes settings via deleteSetting', () => {
      memoryStore.setSetting('temp_key', 'temp');
      expect(memoryStore.deleteSetting('temp_key')).toBe(true);
      expect(memoryStore.getSetting('temp_key')).toBeNull();
      expect(memoryStore.deleteSetting('temp_key')).toBe(false);
    });
  });

  describe('getStats', () => {
    it('returns aggregate counts', async () => {
      await memoryStore.addMemory('stat test memory', 'general', 4);

      const stats = memoryStore.getStats();
      expect(stats.memories).toBeGreaterThanOrEqual(1);
      expect(stats).toHaveProperty('conversations');
      expect(stats).toHaveProperty('messages');
    });
  });
});
