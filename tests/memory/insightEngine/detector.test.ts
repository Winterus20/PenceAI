import { describe, it, expect } from '@jest/globals';
import { PatternDetector } from '../../../src/memory/insightEngine/detector.js';
import type { Observation } from '../../../src/memory/insightEngine/types.js';

describe('PatternDetector', () => {
  it('should store observations', () => {
    const detector = new PatternDetector();
    const obs: Observation = {
      type: 'preference',
      timestamp: Date.now(),
      sessionId: 's1',
      context: 'tercih ederim Python',
      source: 'feedback',
    };
    detector.observe(obs);
    expect(detector.getObservations()).toHaveLength(1);
  });

  it('should not detect patterns with less than 2 observations', () => {
    const detector = new PatternDetector();
    detector.observe({
      type: 'preference',
      timestamp: Date.now(),
      sessionId: 's1',
      context: 'tercih ederim Python',
      source: 'feedback',
    });
    const patterns = detector.detectPatterns();
    expect(patterns).toHaveLength(0);
  });

  it('should detect preference patterns after 2 observations', () => {
    const detector = new PatternDetector();
    detector.observe({
      type: 'preference',
      timestamp: Date.now(),
      sessionId: 's1',
      context: 'tercih Python kullanmayı',
      source: 'feedback',
    });
    detector.observe({
      type: 'preference',
      timestamp: Date.now() + 1000,
      sessionId: 's1',
      context: 'tercih Python kullanmayı',
      source: 'feedback',
    });
    const patterns = detector.detectPatterns();
    expect(patterns).toHaveLength(1);
    expect(patterns[0].type).toBe('preference');
    expect(patterns[0].hitCount).toBe(2);
  });

  it('should detect correction patterns', () => {
    const detector = new PatternDetector();
    detector.observe({
      type: 'correction',
      timestamp: Date.now(),
      sessionId: 's1',
      context: 'Java değil Python kullan',
      source: 'hook',
    });
    detector.observe({
      type: 'correction',
      timestamp: Date.now() + 1000,
      sessionId: 's2',
      context: 'Java değil Python kullanmayı tercih ederim',
      source: 'hook',
    });
    const patterns = detector.detectPatterns();
    expect(patterns).toHaveLength(1);
    expect(patterns[0].type).toBe('correction_pattern');
  });

  it('should detect tool patterns', () => {
    const detector = new PatternDetector();
    detector.observe({
      type: 'tool_pattern',
      timestamp: Date.now(),
      sessionId: 's1',
      context: 'used bash tool',
      source: 'hook',
      toolName: 'bash',
    });
    detector.observe({
      type: 'tool_pattern',
      timestamp: Date.now() + 1000,
      sessionId: 's1',
      context: 'used bash tool again',
      source: 'hook',
      toolName: 'bash',
    });
    const patterns = detector.detectPatterns();
    expect(patterns).toHaveLength(1);
    expect(patterns[0].type).toBe('tool_pattern');
    expect(patterns[0].description).toContain('bash');
  });

  it('should detect rejection patterns', () => {
    const detector = new PatternDetector();
    detector.observe({
      type: 'rejection',
      timestamp: Date.now(),
      sessionId: 's1',
      context: 'rejected edit operation',
      source: 'hook',
      toolName: 'Edit',
    });
    detector.observe({
      type: 'rejection',
      timestamp: Date.now() + 1000,
      sessionId: 's1',
      context: 'rejected edit operation again',
      source: 'hook',
      toolName: 'Edit',
    });
    const patterns = detector.detectPatterns();
    expect(patterns).toHaveLength(1);
    expect(patterns[0].type).toBe('habit');
    expect(patterns[0].description).toContain('Edit');
  });

  it('should aggregate session and memory ids', () => {
    const detector = new PatternDetector();
    detector.observe({
      type: 'preference',
      timestamp: Date.now(),
      sessionId: 's1',
      context: 'tercih Python kullanmayı',
      source: 'feedback',
      memoryId: 1,
    });
    detector.observe({
      type: 'preference',
      timestamp: Date.now() + 1000,
      sessionId: 's2',
      context: 'tercih Python kullanmayı',
      source: 'feedback',
      memoryId: 2,
    });
    const patterns = detector.detectPatterns();
    expect(patterns[0].sessionIds).toContain('s1');
    expect(patterns[0].sessionIds).toContain('s2');
    expect(patterns[0].sourceMemoryIds).toContain(1);
    expect(patterns[0].sourceMemoryIds).toContain(2);
  });

  it('should clear observations when clear is called', () => {
    const detector = new PatternDetector();
    detector.observe({
      type: 'preference',
      timestamp: Date.now(),
      sessionId: 's1',
      context: 'tercih Python kullanmayı',
      source: 'feedback',
    });
    detector.observe({
      type: 'preference',
      timestamp: Date.now() + 1000,
      sessionId: 's1',
      context: 'tercih Python kullanmayı',
      source: 'feedback',
    });
    detector.detectPatterns();
    expect(detector.getObservations()).toHaveLength(2);
    detector.clear();
    expect(detector.getObservations()).toHaveLength(0);
  });
});
