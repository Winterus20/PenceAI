import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { PenceDatabase } from '../../../src/memory/database.js';
import { InsightStorage } from '../../../src/memory/insightEngine/storage.js';
import { InsightRetrieval } from '../../../src/memory/insightEngine/retrieval.js';
import type { DetectedPattern } from '../../../src/memory/insightEngine/types.js';

function createPattern(description: string, type: DetectedPattern['type'] = 'preference'): DetectedPattern {
  const now = Date.now();
  return {
    id: 'pattern_' + description.replace(/\s+/g, '_') + '_' + now,
    type,
    description,
    observations: ['feedback:' + now],
    confidence: 0,
    firstSeen: now,
    lastSeen: now,
    hitCount: 2,
    sessionIds: ['s1'],
    sourceMemoryIds: [],
  };
}

describe('InsightRetrieval', () => {
  let db: PenceDatabase;
  let storage: InsightStorage;
  let retrieval: InsightRetrieval;

  beforeEach(() => {
    db = new PenceDatabase(':memory:', 1536);
    storage = new InsightStorage(db.getDb());
    retrieval = new InsightRetrieval(db.getDb());
  });

  afterEach(() => {
    db.close();
  });

  it('should retrieve high confidence insights', async () => {
    storage.upsertInsight(createPattern('Python tercihi'), 'default');
    storage.upsertInsight(createPattern('TypeScript tercihi'), 'default');
    // Force one to very high confidence
    db.getDb().prepare('UPDATE insights SET confidence = 0.95 WHERE description = ?').run('Python tercihi');

    const results = await retrieval.getHighConfidenceInsights(0.9, 10);
    expect(results).toHaveLength(1);
    expect(results[0].description).toBe('Python tercihi');
  });

  it('should return empty when no high confidence insights', async () => {
    storage.upsertInsight(createPattern('Python tercihi'), 'default');
    const results = await retrieval.getHighConfidenceInsights(0.99, 10);
    expect(results).toHaveLength(0);
  });

  it('should retrieve relevant insights via FTS', async () => {
    storage.upsertInsight(createPattern('Python programlama tercihi'), 'default');
    storage.upsertInsight(createPattern('Java kullanım alışkanlığı'), 'default');
    // Wait for FTS backfill / triggers
    const results = await retrieval.getRelevantInsights('Python', 0.1, 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].insight.description).toContain('Python');
  });

  it('should return empty for irrelevant query', async () => {
    storage.upsertInsight(createPattern('Python programlama'), 'default');
    const results = await retrieval.getRelevantInsights('totally unrelated xyz', 0.1, 5);
    expect(results).toHaveLength(0);
  });

  it('should filter by minConfidence in relevant search', async () => {
    const p1 = createPattern('Yüksek güven Python');
    const p2 = createPattern('Düşük güven Java');
    storage.upsertInsight(p1, 'default');
    storage.upsertInsight(p2, 'default');
    db.getDb().prepare('UPDATE insights SET confidence = 0.9 WHERE description = ?').run('Yüksek güven Python');
    db.getDb().prepare('UPDATE insights SET confidence = 0.2 WHERE description = ?').run('Düşük güven Java');

    const results = await retrieval.getRelevantInsights('Python Java', 0.8, 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every(r => r.insight.confidence >= 0.8)).toBe(true);
  });
});
