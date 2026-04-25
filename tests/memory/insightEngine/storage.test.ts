import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import Database from 'better-sqlite3';
import { InsightStorage } from '../../../src/memory/insightEngine/storage.js';
import type { DetectedPattern } from '../../../src/memory/insightEngine/types.js';

function createInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT 'default',
      type TEXT NOT NULL CHECK(type IN ('preference', 'habit', 'correction_pattern', 'tool_pattern')),
      description TEXT NOT NULL,
      confidence REAL DEFAULT 0.5,
      hit_count INTEGER DEFAULT 1,
      first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      source_memory_ids TEXT DEFAULT '[]',
      session_ids TEXT DEFAULT '[]',
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'suppressed', 'pruned')),
      ttl_days INTEGER DEFAULT 30,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_insights_user ON insights(user_id);
    CREATE INDEX idx_insights_status ON insights(status);
    CREATE INDEX idx_insights_confidence ON insights(confidence);
    CREATE INDEX idx_insights_type ON insights(type);
    CREATE INDEX idx_insights_last_seen ON insights(last_seen);
  `);
  return db;
}

function createPattern(overrides: Partial<DetectedPattern> = {}): DetectedPattern {
  const now = Date.now();
  return {
    id: 'pattern_test_' + now,
    type: 'preference',
    description: 'Kullanıcı tercihi: Python',
    observations: ['feedback:' + now],
    confidence: 0,
    firstSeen: now,
    lastSeen: now,
    hitCount: 2,
    sessionIds: ['s1'],
    sourceMemoryIds: [1],
    ...overrides,
  };
}

describe('InsightStorage', () => {
  let db: Database.Database;
  let storage: InsightStorage;

  beforeEach(() => {
    db = createInMemoryDb();
    storage = new InsightStorage(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should insert a new insight', () => {
    const pattern = createPattern();
    const insight = storage.upsertInsight(pattern, 'default');
    expect(insight.id).toBeGreaterThan(0);
    expect(insight.description).toBe(pattern.description);
    expect(insight.status).toBe('active');
    expect(insight.hitCount).toBe(pattern.hitCount);
  });

  it('should update an existing insight by description', () => {
    const pattern = createPattern();
    const first = storage.upsertInsight(pattern, 'default');
    const second = storage.upsertInsight({ ...pattern, hitCount: 3, sessionIds: ['s1', 's2'] }, 'default');
    expect(second.id).toBe(first.id);
    expect(second.hitCount).toBe(first.hitCount + 3);
    expect(second.sessionIds).toContain('s2');
  });

  it('should get active insights', () => {
    storage.upsertInsight(createPattern(), 'default');
    storage.upsertInsight(createPattern({ description: 'Kullanıcı tercihi: TypeScript' }), 'default');
    const active = storage.getActiveInsights('default');
    expect(active).toHaveLength(2);
  });

  it('should get insight by id', () => {
    const created = storage.upsertInsight(createPattern(), 'default');
    const found = storage.getInsightById(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
  });

  it('should update status', () => {
    const created = storage.upsertInsight(createPattern(), 'default');
    const ok = storage.updateStatus(created.id, 'suppressed');
    expect(ok).toBe(true);
    const found = storage.getInsightById(created.id);
    expect(found!.status).toBe('suppressed');
  });

  it('should update description', () => {
    const created = storage.upsertInsight(createPattern(), 'default');
    const ok = storage.updateDescription(created.id, 'Updated description');
    expect(ok).toBe(true);
    const found = storage.getInsightById(created.id);
    expect(found!.description).toBe('Updated description');
  });

  it('should apply positive feedback', () => {
    const created = storage.upsertInsight(createPattern(), 'default');
    const before = created.confidence;
    storage.applyFeedback(created.id, true);
    const after = storage.getInsightById(created.id)!;
    expect(after.confidence).toBeGreaterThan(before);
  });

  it('should apply negative feedback', () => {
    const created = storage.upsertInsight(createPattern(), 'default');
    const before = created.confidence;
    storage.applyFeedback(created.id, false);
    const after = storage.getInsightById(created.id)!;
    expect(after.confidence).toBeLessThan(before);
  });

  it('should prune old insights by TTL', () => {
    const now = Date.now();
    const oldPattern = createPattern({
      firstSeen: now - 100 * 24 * 60 * 60 * 1000,
      lastSeen: now - 100 * 24 * 60 * 60 * 1000,
    });
    const created = storage.upsertInsight(oldPattern, 'default');
    // Force TTL to something small so it prunes
    db.prepare('UPDATE insights SET ttl_days = 1 WHERE id = ?').run(created.id);
    const result = storage.pruneInsights();
    expect(result.pruned).toBeGreaterThanOrEqual(1);
    const found = storage.getInsightById(created.id);
    expect(found!.status).toBe('pruned');
  });

  it('should suppress low confidence insights', () => {
    const pattern = createPattern();
    const created = storage.upsertInsight(pattern, 'default');
    db.prepare('UPDATE insights SET confidence = 0.1 WHERE id = ?').run(created.id);
    const result = storage.pruneInsights();
    expect(result.suppressed).toBeGreaterThanOrEqual(1);
    const found = storage.getInsightById(created.id);
    expect(found!.status).toBe('suppressed');
  });
});
