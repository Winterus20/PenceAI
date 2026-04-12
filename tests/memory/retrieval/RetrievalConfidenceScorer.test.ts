/**
 * RetrievalConfidenceScorer Tests
 *
 * Retrieval güven skorlama birim testleri.
 */

import { computeRetrievalConfidence } from '../../../src/memory/retrieval/RetrievalConfidenceScorer.js';
import type { RetrievalIntentSignals } from '../../../src/memory/retrieval/types.js';

function makeSignals(overrides: Partial<RetrievalIntentSignals> = {}): RetrievalIntentSignals {
  return {
    hasQuestion: false,
    hasPreferenceCue: false,
    hasFollowUpCue: false,
    hasRecallCue: false,
    hasConstraintCue: false,
    hasRecentContext: false,
    hasAnalyticalCue: false,
    hasExploratoryCue: false,
    hasPersonalReference: false,
    hasContextualQuestion: false,
    queryLength: 50,
    clauseCount: 1,
    ...overrides,
  };
}

describe('RetrievalConfidenceScorer', () => {
  describe('computeRetrievalConfidence()', () => {
    it('should return high confidence for strong signals', () => {
      const signals = makeSignals({
        hasRecallCue: true,
        hasPersonalReference: true,
        hasFollowUpCue: true,
      });

      const result = computeRetrievalConfidence(signals, 'test query');

      expect(result.score).toBeGreaterThan(0.7);
      expect(result.needsRetrieval).toBe(true);
      expect(result.reasons).toContain('explicit_recall');
      expect(result.reasons).toContain('personal_reference');
      expect(result.reasons).toContain('temporal_followup');
    });

    it('should return low confidence for weak signals', () => {
      const signals = makeSignals({
        queryLength: 10,
        clauseCount: 1,
      });

      const result = computeRetrievalConfidence(signals, 'short');

      expect(result.score).toBeLessThan(0.4);
      expect(result.needsRetrieval).toBe(false);
    });

    it('should calculate multi-factor score', () => {
      const signals = makeSignals({
        hasAnalyticalCue: true,
        hasContextualQuestion: true,
        queryLength: 150,
        clauseCount: 4,
        hasQuestion: true,
      });

      const result = computeRetrievalConfidence(signals, 'long analytical query with multiple clauses');

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
      expect(result.reasons.length).toBeGreaterThan(0);
    });

    it('should cap score at 1.0', () => {
      const signals = makeSignals({
        hasRecallCue: true,
        hasPersonalReference: true,
        hasFollowUpCue: true,
        hasAnalyticalCue: true,
        hasContextualQuestion: true,
        queryLength: 150,
        clauseCount: 4,
        hasQuestion: true,
        hasRecentContext: true,
      });

      const result = computeRetrievalConfidence(signals, 'test');

      expect(result.score).toBeLessThanOrEqual(1.0);
    });

    it('should handle all signals false', () => {
      const signals = makeSignals();

      const result = computeRetrievalConfidence(signals, 'hello');

      expect(result.score).toBe(0);
      expect(result.needsRetrieval).toBe(false);
      expect(result.reasons).toHaveLength(0);
    });

    it('should respect custom threshold', () => {
      const signals = makeSignals({
        hasAnalyticalCue: true,
        hasQuestion: true,
      });

      const result = computeRetrievalConfidence(signals, 'query', { threshold: 0.1 });

      expect(result.needsRetrieval).toBe(true);
      expect(result.score).toBeGreaterThan(0.1);
    });

    it('should handle high threshold preventing retrieval', () => {
      const signals = makeSignals({
        hasAnalyticalCue: true,
      });

      const result = computeRetrievalConfidence(signals, 'query', { threshold: 0.9 });

      expect(result.needsRetrieval).toBe(false);
    });

    it('should normalize scores to 0-1 range', () => {
      const testCases: RetrievalIntentSignals[] = [
        makeSignals({ hasRecallCue: true }),
        makeSignals({ hasQuestion: true }),
        makeSignals({ queryLength: 200, clauseCount: 5 }),
        makeSignals({ hasPersonalReference: true, hasFollowUpCue: true }),
        makeSignals(),
      ];

      for (const signals of testCases) {
        const result = computeRetrievalConfidence(signals, 'test query');
        expect(result.confidence ?? result.score).toBeGreaterThanOrEqual(0);
        expect(result.confidence ?? result.score).toBeLessThanOrEqual(1);
      }
    });

    describe('STRONG signals (+0.3 each)', () => {
      it('should add 0.3 for hasRecallCue', () => {
        const signals = makeSignals({ hasRecallCue: true });
        const result = computeRetrievalConfidence(signals, 'query');
        expect(result.score).toBeGreaterThanOrEqual(0.3);
        expect(result.reasons).toContain('explicit_recall');
      });

      it('should add 0.3 for hasPersonalReference', () => {
        const signals = makeSignals({ hasPersonalReference: true });
        const result = computeRetrievalConfidence(signals, 'query');
        expect(result.score).toBeGreaterThanOrEqual(0.3);
        expect(result.reasons).toContain('personal_reference');
      });

      it('should add 0.3 for hasFollowUpCue', () => {
        const signals = makeSignals({ hasFollowUpCue: true });
        const result = computeRetrievalConfidence(signals, 'query');
        expect(result.score).toBeGreaterThanOrEqual(0.3);
        expect(result.reasons).toContain('temporal_followup');
      });
    });

    describe('MEDIUM signals (+0.15 each)', () => {
      it('should add 0.15 for hasAnalyticalCue', () => {
        const signals = makeSignals({ hasAnalyticalCue: true });
        const result = computeRetrievalConfidence(signals, 'query');
        expect(result.score).toBeGreaterThanOrEqual(0.15);
        expect(result.reasons).toContain('analytical_needs_context');
      });

      it('should add 0.15 for hasContextualQuestion', () => {
        const signals = makeSignals({ hasContextualQuestion: true });
        const result = computeRetrievalConfidence(signals, 'query');
        expect(result.score).toBeGreaterThanOrEqual(0.15);
        expect(result.reasons).toContain('contextual_question');
      });

      it('should add 0.15 for queryLength > 100', () => {
        const signals = makeSignals({ queryLength: 101 });
        const result = computeRetrievalConfidence(signals, 'query');
        expect(result.score).toBeGreaterThanOrEqual(0.15);
        expect(result.reasons).toContain('long_query_contextual');
      });

      it('should add 0.15 for clauseCount >= 3', () => {
        const signals = makeSignals({ clauseCount: 3 });
        const result = computeRetrievalConfidence(signals, 'query');
        expect(result.score).toBeGreaterThanOrEqual(0.15);
        expect(result.reasons).toContain('multi_clause_complex');
      });
    });

    describe('WEAK signals (+0.1 each)', () => {
      it('should add 0.1 for hasQuestion', () => {
        const signals = makeSignals({ hasQuestion: true });
        const result = computeRetrievalConfidence(signals, 'query');
        expect(result.score).toBeGreaterThanOrEqual(0.1);
        expect(result.reasons).toContain('question_may_need_context');
      });

      it('should add 0.1 for hasRecentContext', () => {
        const signals = makeSignals({ hasRecentContext: true });
        const result = computeRetrievalConfidence(signals, 'query');
        expect(result.score).toBeGreaterThanOrEqual(0.1);
        expect(result.reasons).toContain('active_conversation');
      });
    });

    describe('mandatory retrieval conditions', () => {
      it('should force retrieval for temporal reference', () => {
        const signals = makeSignals();
        const result = computeRetrievalConfidence(signals, 'dun ne yaptim?');
        expect(result.needsRetrieval).toBe(true);
        expect(result.score).toBe(1.0);
        expect(result.reasons.some(r => r.includes('mandatory'))).toBe(true);
      });

      it('should force retrieval for personal reference', () => {
        const signals = makeSignals();
        const result = computeRetrievalConfidence(signals, 'Yigit hakkında ne biliyorsun?');
        expect(result.needsRetrieval).toBe(true);
        expect(result.score).toBe(1.0);
      });

      it('should force retrieval for short questions', () => {
        const signals = makeSignals();
        const result = computeRetrievalConfidence(signals, 'O proje ne oldu?');
        expect(result.needsRetrieval).toBe(true);
        expect(result.score).toBe(1.0);
      });

      it('should force retrieval for implicit references', () => {
        const signals = makeSignals();
        const result = computeRetrievalConfidence(signals, 'o konu hakkında ne var?');
        expect(result.needsRetrieval).toBe(true);
        expect(result.score).toBe(1.0);
      });

      it('should force retrieval for active context short responses', () => {
        const signals = makeSignals();
        const result = computeRetrievalConfidence(signals, 'evet', { recentMessagesCount: 5 });
        expect(result.needsRetrieval).toBe(true);
        expect(result.score).toBe(1.0);
      });
    });
  });
});
