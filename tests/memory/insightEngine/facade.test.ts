import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { PenceDatabase } from '../../../src/memory/database.js';
import { InsightEngine } from '../../../src/memory/insightEngine/index.js';
import type { Observation } from '../../../src/memory/insightEngine/types.js';

describe('InsightEngine Facade', () => {
  let db: PenceDatabase;
  let engine: InsightEngine;

  beforeEach(() => {
    db = new PenceDatabase(':memory:', 1536);
    engine = new InsightEngine(db.getDb());
  });

  afterEach(() => {
    db.close();
  });

  it('should observe and process observations into insights', async () => {
    engine.observe({
      type: 'preference',
      timestamp: Date.now(),
      sessionId: 's1',
      context: 'tercih Python kullanmayı',
      source: 'feedback',
    });
    engine.observe({
      type: 'preference',
      timestamp: Date.now() + 1000,
      sessionId: 's1',
      context: 'tercih Python kullanmayı',
      source: 'feedback',
    });

    const insights = await engine.processObservations('default');
    expect(insights.length).toBeGreaterThanOrEqual(1);
    expect(insights[0].type).toBe('preference');
  });

  it('should get high confidence insights', async () => {
    engine.observe({
      type: 'preference',
      timestamp: Date.now(),
      sessionId: 's1',
      context: 'tercih Python kullanmayı',
      source: 'feedback',
    });
    engine.observe({
      type: 'preference',
      timestamp: Date.now() + 1000,
      sessionId: 's2',
      context: 'tercih Python kullanmayı',
      source: 'feedback',
    });
    await engine.processObservations('default');

    const high = await engine.getHighConfidenceInsights(0.1);
    expect(high.length).toBeGreaterThanOrEqual(1);
  });

  it('should get active insights', async () => {
    engine.observe({
      type: 'preference',
      timestamp: Date.now(),
      sessionId: 's1',
      context: 'tercih Python kullanmayı',
      source: 'feedback',
    });
    engine.observe({
      type: 'preference',
      timestamp: Date.now() + 1000,
      sessionId: 's1',
      context: 'tercih Python kullanmayı',
      source: 'feedback',
    });
    await engine.processObservations('default');

    const active = engine.getActiveInsights('default');
    expect(active.length).toBeGreaterThanOrEqual(1);
  });

  it('should update insight status', async () => {
    engine.observe({
      type: 'preference',
      timestamp: Date.now(),
      sessionId: 's1',
      context: 'tercih Python kullanmayı',
      source: 'feedback',
    });
    engine.observe({
      type: 'preference',
      timestamp: Date.now() + 1000,
      sessionId: 's1',
      context: 'tercih Python kullanmayı',
      source: 'feedback',
    });
    const insights = await engine.processObservations('default');
    expect(insights.length).toBeGreaterThanOrEqual(1);
    const id = insights[0].id;

    const ok = engine.updateInsightStatus(id, 'suppressed');
    expect(ok).toBe(true);
    const active = engine.getActiveInsights('default');
    expect(active.find(i => i.id === id)).toBeUndefined();
  });

  it('should update insight description', async () => {
    engine.observe({
      type: 'preference',
      timestamp: Date.now(),
      sessionId: 's1',
      context: 'tercih Python kullanmayı',
      source: 'feedback',
    });
    engine.observe({
      type: 'preference',
      timestamp: Date.now() + 1000,
      sessionId: 's1',
      context: 'tercih Python kullanmayı',
      source: 'feedback',
    });
    const insights = await engine.processObservations('default');
    expect(insights.length).toBeGreaterThanOrEqual(1);
    const id = insights[0].id;

    const ok = engine.updateInsightDescription(id, 'Updated');
    expect(ok).toBe(true);
  });

  it('should apply feedback', async () => {
    engine.observe({
      type: 'preference',
      timestamp: Date.now(),
      sessionId: 's1',
      context: 'tercih Python kullanmayı',
      source: 'feedback',
    });
    engine.observe({
      type: 'preference',
      timestamp: Date.now() + 1000,
      sessionId: 's1',
      context: 'tercih Python kullanmayı',
      source: 'feedback',
    });
    const insights = await engine.processObservations('default');
    expect(insights.length).toBeGreaterThanOrEqual(1);
    const id = insights[0].id;
    const before = insights[0].confidence;

    engine.applyFeedback(id, true);
    const after = engine.getActiveInsights('default').find(i => i.id === id)!.confidence;
    expect(after).toBeGreaterThan(before);
  });

  it('should prune insights', async () => {
    engine.observe({
      type: 'preference',
      timestamp: Date.now(),
      sessionId: 's1',
      context: 'tercih Python kullanmayı',
      source: 'feedback',
    });
    engine.observe({
      type: 'preference',
      timestamp: Date.now() + 1000,
      sessionId: 's1',
      context: 'tercih Python kullanmayı',
      source: 'feedback',
    });
    await engine.processObservations('default');

    const result = engine.prune();
    expect(typeof result.pruned).toBe('number');
    expect(typeof result.suppressed).toBe('number');
  });

  it('should build insight context string', async () => {
    engine.observe({
      type: 'preference',
      timestamp: Date.now(),
      sessionId: 's1',
      context: 'tercih Python kullanmayı',
      source: 'feedback',
    });
    engine.observe({
      type: 'preference',
      timestamp: Date.now() + 1000,
      sessionId: 's1',
      context: 'tercih Python kullanmayı',
      source: 'feedback',
    });
    await engine.processObservations('default');

    const context = await engine.buildInsightContext();
    expect(typeof context).toBe('string');
    if (context.length > 0) {
      expect(context).toContain('Kullanıcı Tercihleri');
    }
  });
});
