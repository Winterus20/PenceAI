import { describe, it, expect } from '@jest/globals';
import { PenceDatabase } from '../../../src/memory/database.js';

describe('Database Schema v20 Migration', () => {
  it('creates memory_contradictions table on init', () => {
    const db = new PenceDatabase(':memory:', 1536);
    const tables = db.getDb().prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_contradictions'"
    ).get() as { name: string } | undefined;
    expect(tables?.name).toBe('memory_contradictions');
    db.close();
  });

  it('creates memory_revisions table on init', () => {
    const db = new PenceDatabase(':memory:', 1536);
    const tables = db.getDb().prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_revisions'"
    ).get() as { name: string } | undefined;
    expect(tables?.name).toBe('memory_revisions');
    db.close();
  });

  it('creates contradiction indexes', () => {
    const db = new PenceDatabase(':memory:', 1536);
    const indexes = db.getDb().prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_contradictions%'"
    ).all() as Array<{ name: string }>;
    expect(indexes.map((i) => i.name).sort()).toEqual([
      'idx_contradictions_memory',
      'idx_contradictions_status',
    ]);
    db.close();
  });

  it('creates revision indexes', () => {
    const db = new PenceDatabase(':memory:', 1536);
    const indexes = db.getDb().prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_revisions_memory'"
    ).get() as { name: string } | undefined;
    expect(indexes?.name).toBe('idx_revisions_memory');
    db.close();
  });
});
