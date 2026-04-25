import { describe, it, expect } from '@jest/globals';
import {
  computeConfidence,
  computeFrequency,
  computeRecency,
  computeConsistency,
  computeUserAffirmation,
  computeCrossSession,
  getConfidenceLevel,
  computeDynamicTTL,
  DEFAULT_CONFIG,
} from '../../../src/memory/insightEngine/confidence.js';
import type { ConfidenceDimensions } from '../../../src/memory/insightEngine/types.js';

describe('Confidence Module', () => {
  describe('computeConfidence', () => {
    it('should return 0.5 for neutral dimensions', () => {
      const dim: ConfidenceDimensions = {
        frequency: 0.5,
        recency: 0.5,
        consistency: 0.5,
        userAffirmation: 0.5,
        crossSession: 0.5,
      };
      const result = computeConfidence(dim, DEFAULT_CONFIG);
      expect(result).toBeCloseTo(0.5, 1);
    });

    it('should return high value for strong dimensions', () => {
      const dim: ConfidenceDimensions = {
        frequency: 1,
        recency: 1,
        consistency: 1,
        userAffirmation: 1,
        crossSession: 1,
      };
      const result = computeConfidence(dim, DEFAULT_CONFIG);
      expect(result).toBeGreaterThan(0.9);
    });

    it('should return low value for weak dimensions', () => {
      const dim: ConfidenceDimensions = {
        frequency: 0,
        recency: 0,
        consistency: 0,
        userAffirmation: 0,
        crossSession: 0,
      };
      const result = computeConfidence(dim, DEFAULT_CONFIG);
      expect(result).toBeLessThan(0.1);
    });
  });

  describe('computeFrequency', () => {
    it('should cap at 1', () => {
      expect(computeFrequency(10)).toBe(1);
    });

    it('should scale linearly up to 5', () => {
      expect(computeFrequency(0)).toBe(0);
      expect(computeFrequency(1)).toBe(0.2);
      expect(computeFrequency(5)).toBe(1);
    });
  });

  describe('computeRecency', () => {
    it('should be 1 for now', () => {
      const result = computeRecency(Date.now());
      expect(result).toBeCloseTo(1, 2);
    });

    it('should decay over time', () => {
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const result = computeRecency(thirtyDaysAgo);
      expect(result).toBeCloseTo(Math.exp(-1), 2);
    });
  });

  describe('computeConsistency', () => {
    it('should return 1 when no contradictions', () => {
      expect(computeConsistency(0, 5)).toBe(1);
    });

    it('should return 0.5 when half contradictions', () => {
      expect(computeConsistency(5, 10)).toBe(0.5);
    });

    it('should return 0.5 for zero total observations', () => {
      expect(computeConsistency(0, 0)).toBe(0.5);
    });
  });

  describe('computeUserAffirmation', () => {
    it('should return 0.5 when no feedback', () => {
      expect(computeUserAffirmation(0, 0)).toBe(0.5);
    });

    it('should compute positive ratio', () => {
      expect(computeUserAffirmation(8, 2)).toBe(0.8);
    });
  });

  describe('computeCrossSession', () => {
    it('should cap at 1', () => {
      expect(computeCrossSession(10)).toBe(1);
    });

    it('should scale linearly up to 5', () => {
      expect(computeCrossSession(0)).toBe(0);
      expect(computeCrossSession(1)).toBe(0.2);
      expect(computeCrossSession(5)).toBe(1);
    });
  });

  describe('getConfidenceLevel', () => {
    it('should classify correctly', () => {
      expect(getConfidenceLevel(0.95)).toBe('certain');
      expect(getConfidenceLevel(0.75)).toBe('high');
      expect(getConfidenceLevel(0.55)).toBe('medium');
      expect(getConfidenceLevel(0.35)).toBe('low');
      expect(getConfidenceLevel(0.15)).toBe('garbage');
    });
  });

  describe('computeDynamicTTL', () => {
    it('should return default when dynamicTTL is false', () => {
      const config = { ...DEFAULT_CONFIG, dynamicTTL: false };
      expect(computeDynamicTTL(0.9, config)).toBe(config.defaultTTLDays);
    });

    it('should scale TTL with confidence', () => {
      const low = computeDynamicTTL(0, DEFAULT_CONFIG);
      const high = computeDynamicTTL(1, DEFAULT_CONFIG);
      expect(high).toBeGreaterThan(low);
      expect(low).toBe(DEFAULT_CONFIG.defaultTTLDays);
      expect(high).toBe(DEFAULT_CONFIG.defaultTTLDays * 3);
    });
  });
});
