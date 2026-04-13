import {
    isQuietHour,
    checkHardRules,
    computeUrgeScore,
    computeEffectiveThreshold,
    decideAction,
    applyBehaviorSignal,
    decayFeedbackState,
    filterThought,
    QUIET_HOURS_START,
    QUIET_HOURS_END,
    BASE_THRESHOLD,
    DIGEST_THRESHOLD,
    WEIGHT_RELEVANCE,
    WEIGHT_TIME_SENSITIVITY,
    MAX_RELUCTANCE_PENALTY,
    MAX_THRESHOLD_ADJUSTMENT,
    SIGNAL_MAX_AGE_MS,
    type ThoughtEvaluation,
    type FeedbackState,
    type UserBehaviorSignal,
} from '../../src/autonomous/urgeFilter.js';

// ═══════════════════════════════════════════════════════════
//  isQuietHour()
// ═══════════════════════════════════════════════════════════

describe('isQuietHour()', () => {
    it('should return true for hours within quiet range (2-8)', () => {
        expect(isQuietHour(2)).toBe(true);
        expect(isQuietHour(5)).toBe(true);
        expect(isQuietHour(7)).toBe(true);
    });

    it('should return false for hours outside quiet range', () => {
        expect(isQuietHour(0)).toBe(false);
        expect(isQuietHour(1)).toBe(false);
        expect(isQuietHour(8)).toBe(false);
        expect(isQuietHour(12)).toBe(false);
        expect(isQuietHour(23)).toBe(false);
    });

    it('should apply timezone offset correctly', () => {
        // Hour 0 with +3 offset => 3 (quiet hour)
        expect(isQuietHour(0, 3)).toBe(true);
        // Hour 10 with -5 offset => 5 (quiet hour)
        expect(isQuietHour(10, -5)).toBe(true);
        // Hour 12 with +3 offset => 15 (not quiet)
        expect(isQuietHour(12, 3)).toBe(false);
    });

    it('should handle wrap-around for negative results', () => {
        // Hour 1 with -2 offset => 23 (not quiet)
        expect(isQuietHour(1, -2)).toBe(false);
    });

    it('should handle wrap-around for results >= 24', () => {
        // Hour 23 with +2 offset => 1 (not quiet)
        expect(isQuietHour(23, 2)).toBe(false);
    });

    it('should treat boundary hour 2 as quiet', () => {
        expect(isQuietHour(2)).toBe(true);
    });

    it('should treat boundary hour 8 as not quiet', () => {
        expect(isQuietHour(8)).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════
//  checkHardRules()
// ═══════════════════════════════════════════════════════════

describe('checkHardRules()', () => {
    it('should block during quiet hours', () => {
        expect(checkHardRules(3)).toBe(`quiet_hours (${QUIET_HOURS_START}:00-${QUIET_HOURS_END}:00)`);
        expect(checkHardRules(5)).not.toBeNull();
    });

    it('should allow during non-quiet hours', () => {
        expect(checkHardRules(10)).toBeNull();
        expect(checkHardRules(15)).toBeNull();
    });

    it('should respect timezone offset', () => {
        // UTC 0 + offset 3 = 3 (quiet)
        expect(checkHardRules(0, 3)).not.toBeNull();
        // UTC 12 + offset 3 = 15 (not quiet)
        expect(checkHardRules(12, 3)).toBeNull();
    });
});

// ═══════════════════════════════════════════════════════════
//  computeUrgeScore()
// ═══════════════════════════════════════════════════════════

describe('computeUrgeScore()', () => {
    const makeEval = (relevance: number, timeSensitivity: number): ThoughtEvaluation => ({
        relevanceScore: relevance,
        timeSensitivity,
        sourceType: 'thought_chain',
    });

    it('should compute weighted score correctly', () => {
        // (0.8 * 0.6) + (0.5 * 0.4) = 0.48 + 0.20 = 0.68
        const score = computeUrgeScore(makeEval(0.8, 0.5));
        expect(score).toBeCloseTo(0.68, 5);
    });

    it('should apply reluctance penalty', () => {
        // raw = 0.68, penalty = 0.2 => 0.48
        const score = computeUrgeScore(makeEval(0.8, 0.5), 0.2);
        expect(score).toBeCloseTo(0.48, 5);
    });

    it('should clamp to 0 when penalty exceeds raw score', () => {
        const score = computeUrgeScore(makeEval(0.1, 0.1), 0.5);
        expect(score).toBe(0);
    });

    it('should clamp to 1 when raw score exceeds 1', () => {
        const score = computeUrgeScore(makeEval(1.0, 1.0));
        expect(score).toBe(1);
    });

    it('should default reluctance penalty to 0', () => {
        const score = computeUrgeScore(makeEval(0.5, 0.5));
        expect(score).toBeCloseTo(0.5, 5);
    });

    it('should handle zero inputs', () => {
        expect(computeUrgeScore(makeEval(0, 0))).toBe(0);
    });

    it('should handle maximum inputs with max penalty', () => {
        // raw = 1.0, penalty = 0.5 => 0.5
        const score = computeUrgeScore(makeEval(1, 1), MAX_RELUCTANCE_PENALTY);
        expect(score).toBeCloseTo(0.5, 5);
    });
});

// ═══════════════════════════════════════════════════════════
//  computeEffectiveThreshold()
// ═══════════════════════════════════════════════════════════

describe('computeEffectiveThreshold()', () => {
    it('should return BASE_THRESHOLD with no adjustment', () => {
        expect(computeEffectiveThreshold(0)).toBeCloseTo(BASE_THRESHOLD, 5);
    });

    it('should increase threshold with positive adjustment', () => {
        const threshold = computeEffectiveThreshold(0.2);
        expect(threshold).toBeCloseTo(BASE_THRESHOLD + 0.2, 5);
    });

    it('should decrease threshold with negative adjustment', () => {
        const threshold = computeEffectiveThreshold(-0.2);
        expect(threshold).toBeCloseTo(BASE_THRESHOLD - 0.2, 5);
    });

    it('should clamp upper bound to 0.75', () => {
        const threshold = computeEffectiveThreshold(0.5);
        expect(threshold).toBe(0.75);
    });

    it('should clamp lower bound to 0.15', () => {
        const threshold = computeEffectiveThreshold(-0.5);
        expect(threshold).toBe(0.15);
    });

    it('should default adjustment to 0', () => {
        expect(computeEffectiveThreshold()).toBeCloseTo(BASE_THRESHOLD, 5);
    });
});

// ═══════════════════════════════════════════════════════════
//  decideAction()
// ═══════════════════════════════════════════════════════════

describe('decideAction()', () => {
    it('should return send when score >= threshold', () => {
        expect(decideAction(0.6, 0.45)).toBe('send');
        expect(decideAction(0.45, 0.45)).toBe('send'); // boundary
    });

    it('should return digest when score >= DIGEST_THRESHOLD but < threshold', () => {
        expect(decideAction(0.35, 0.45)).toBe('digest');
        expect(decideAction(0.25, 0.45)).toBe('digest'); // boundary
    });

    it('should return discard when score < DIGEST_THRESHOLD', () => {
        expect(decideAction(0.1, 0.45)).toBe('discard');
        expect(decideAction(0.24, 0.45)).toBe('discard');
    });
});

// ═══════════════════════════════════════════════════════════
//  applyBehaviorSignal()
// ═══════════════════════════════════════════════════════════

describe('applyBehaviorSignal()', () => {
    const baseState = (): FeedbackState => ({
        thresholdAdjustment: 0,
        reluctancePenalty: 0.1,
        lastSignalAt: 0,
        signalHistory: [],
    });

    it('should decrease adjustment and reset penalty on active_chat', () => {
        const result = applyBehaviorSignal(baseState(), { type: 'active_chat', timestamp: 1000 });
        expect(result.thresholdAdjustment).toBeCloseTo(-0.05, 5);
        expect(result.reluctancePenalty).toBe(0); // fully reset
        expect(result.lastSignalAt).toBe(1000);
    });

    it('should decrease adjustment and penalty on message_replied', () => {
        const result = applyBehaviorSignal(baseState(), { type: 'message_replied', timestamp: 1000 });
        expect(result.thresholdAdjustment).toBeCloseTo(-0.02, 5);
        expect(result.reluctancePenalty).toBeCloseTo(0.05, 5); // 0.1 - 0.05
    });

    it('should apply fast-reply bonus on message_replied with short response time', () => {
        const result = applyBehaviorSignal(baseState(), {
            type: 'message_replied',
            timestamp: 1000,
            responseTimeMs: 30_000,
        });
        expect(result.thresholdAdjustment).toBeCloseTo(-0.04, 5); // -0.02 - 0.02
    });

    it('should slightly increase on message_read', () => {
        const result = applyBehaviorSignal(baseState(), { type: 'message_read', timestamp: 1000 });
        expect(result.thresholdAdjustment).toBeCloseTo(0.01, 5);
        expect(result.reluctancePenalty).toBeCloseTo(0.13, 5);
    });

    it('should increase more on message_ignored', () => {
        const result = applyBehaviorSignal(baseState(), { type: 'message_ignored', timestamp: 1000 });
        expect(result.thresholdAdjustment).toBeCloseTo(0.03, 5);
        expect(result.reluctancePenalty).toBeCloseTo(0.18, 5);
    });

    it('should increase significantly on busy_signal', () => {
        const result = applyBehaviorSignal(baseState(), { type: 'busy_signal', timestamp: 1000 });
        expect(result.thresholdAdjustment).toBeCloseTo(0.06, 5);
        expect(result.reluctancePenalty).toBeCloseTo(0.25, 5);
    });

    it('should not exceed MAX_THRESHOLD_ADJUSTMENT', () => {
        let state = baseState();
        // Repeatedly apply busy_signal to push to upper bound
        for (let i = 0; i < 20; i++) {
            state = applyBehaviorSignal(state, { type: 'busy_signal', timestamp: i });
        }
        expect(state.thresholdAdjustment).toBeLessThanOrEqual(MAX_THRESHOLD_ADJUSTMENT);
    });

    it('should not go below -MAX_THRESHOLD_ADJUSTMENT', () => {
        let state = baseState();
        for (let i = 0; i < 20; i++) {
            state = applyBehaviorSignal(state, { type: 'active_chat', timestamp: i });
        }
        expect(state.thresholdAdjustment).toBeGreaterThanOrEqual(-MAX_THRESHOLD_ADJUSTMENT);
    });

    it('should not let penalty go below 0', () => {
        let state = baseState();
        for (let i = 0; i < 10; i++) {
            state = applyBehaviorSignal(state, { type: 'active_chat', timestamp: i });
        }
        expect(state.reluctancePenalty).toBeGreaterThanOrEqual(0);
    });

    it('should not let penalty exceed MAX_RELUCTANCE_PENALTY', () => {
        let state = baseState();
        for (let i = 0; i < 20; i++) {
            state = applyBehaviorSignal(state, { type: 'busy_signal', timestamp: i });
        }
        expect(state.reluctancePenalty).toBeLessThanOrEqual(MAX_RELUCTANCE_PENALTY);
    });

    it('should limit signal history to SIGNAL_HISTORY_SIZE', () => {
        let state: FeedbackState = {
            thresholdAdjustment: 0,
            reluctancePenalty: 0,
            lastSignalAt: 0,
            signalHistory: [],
        };
        // Add more signals than the history size
        for (let i = 0; i < 25; i++) {
            state = applyBehaviorSignal(state, { type: 'message_read', timestamp: i });
        }
        expect(state.signalHistory.length).toBe(20); // SIGNAL_HISTORY_SIZE
    });

    it('should return immutable state (not modify original)', () => {
        const original = baseState();
        const result = applyBehaviorSignal(original, { type: 'message_replied', timestamp: 1000 });
        expect(result).not.toBe(original);
        expect(original.thresholdAdjustment).toBe(0); // unchanged
    });
});

// ═══════════════════════════════════════════════════════════
//  decayFeedbackState()
// ═══════════════════════════════════════════════════════════

describe('decayFeedbackState()', () => {
    const stateWithValues = (): FeedbackState => ({
        thresholdAdjustment: 0.3,
        reluctancePenalty: 0.5,
        lastSignalAt: Date.now() - 5 * 60 * 60 * 1000, // 5 hours ago
        signalHistory: [
            { type: 'message_replied', timestamp: Date.now() - 1 * 60 * 60 * 1000 },
            { type: 'message_read', timestamp: Date.now() - 3 * 60 * 60 * 1000 },
            { type: 'busy_signal', timestamp: Date.now() - 10 * 24 * 60 * 60 * 1000 }, // 10 days old
        ],
    });

    it('should return same state when hoursSinceLastSignal <= 0', () => {
        const state = stateWithValues();
        const result = decayFeedbackState(state, 0);
        expect(result).toBe(state);
    });

    it('should reduce thresholdAdjustment with exponential decay', () => {
        const result = decayFeedbackState(stateWithValues(), 5);
        const factor = Math.exp(-0.1 * 5);
        expect(result.thresholdAdjustment).toBeCloseTo(0.3 * factor, 5);
    });

    it('should reduce reluctancePenalty with exponential decay', () => {
        const result = decayFeedbackState(stateWithValues(), 5);
        const factor = Math.exp(-0.1 * 5);
        expect(result.reluctancePenalty).toBeCloseTo(0.5 * factor, 5);
    });

    it('should remove signals older than SIGNAL_MAX_AGE_MS (7 days)', () => {
        const result = decayFeedbackState(stateWithValues(), 5);
        // The 10-day-old signal should be filtered out
        expect(result.signalHistory.length).toBe(2);
        expect(result.signalHistory.every(s => s.timestamp > Date.now() - SIGNAL_MAX_AGE_MS)).toBe(true);
    });

    it('should keep recent signals', () => {
        const result = decayFeedbackState(stateWithValues(), 5);
        expect(result.signalHistory.some(s => s.type === 'message_replied')).toBe(true);
        expect(result.signalHistory.some(s => s.type === 'message_read')).toBe(true);
    });

    it('should not modify signalHistory when all signals are recent', () => {
        const state: FeedbackState = {
            thresholdAdjustment: 0.1,
            reluctancePenalty: 0.1,
            lastSignalAt: Date.now(),
            signalHistory: [
                { type: 'message_replied', timestamp: Date.now() - 1000 },
                { type: 'message_read', timestamp: Date.now() - 2000 },
            ],
        };
        const result = decayFeedbackState(state, 1);
        expect(result.signalHistory.length).toBe(2);
    });
});

// ═══════════════════════════════════════════════════════════
//  filterThought()
// ═══════════════════════════════════════════════════════════

describe('filterThought()', () => {
    const baseEval = (): ThoughtEvaluation => ({
        relevanceScore: 0.7,
        timeSensitivity: 0.5,
        sourceType: 'thought_chain',
    });

    const baseFeedback = (): FeedbackState => ({
        thresholdAdjustment: 0,
        reluctancePenalty: 0,
        lastSignalAt: 0,
        signalHistory: [],
    });

    it('should block during quiet hours', () => {
        const result = filterThought(baseEval(), baseFeedback(), 4);
        expect(result.decision).toBe('blocked');
        expect(result.blockedBy).toContain('quiet_hours');
    });

    it('should allow during non-quiet hours with high score', () => {
        const result = filterThought(baseEval(), baseFeedback(), 12);
        expect(result.decision).toBe('send');
    });

    it('should digest when score is between DIGEST_THRESHOLD and threshold', () => {
        // Lower relevance to get a lower score
        const eval_low = (): ThoughtEvaluation => ({
            relevanceScore: 0.3,
            timeSensitivity: 0.2,
            sourceType: 'thought_chain',
        });
        const result = filterThought(eval_low(), baseFeedback(), 12);
        // score = 0.3*0.6 + 0.2*0.4 = 0.18 + 0.08 = 0.26
        // threshold = 0.45, digest = 0.25 => 0.26 >= 0.25 => digest
        expect(result.decision).toBe('digest');
    });

    it('should discard when score is below DIGEST_THRESHOLD', () => {
        const eval_veryLow = (): ThoughtEvaluation => ({
            relevanceScore: 0.1,
            timeSensitivity: 0.1,
            sourceType: 'thought_chain',
        });
        const result = filterThought(eval_veryLow(), baseFeedback(), 12);
        expect(result.decision).toBe('discard');
    });

    it('should include reasons in the result', () => {
        const result = filterThought(baseEval(), baseFeedback(), 12);
        expect(result.reasons.length).toBeGreaterThan(0);
    });

    it('should not have blockedBy when not blocked', () => {
        const result = filterThought(baseEval(), baseFeedback(), 12);
        expect(result.blockedBy).toBeUndefined();
    });

    it('should use current hour when not provided', () => {
        // Just verify it doesn't throw
        const result = filterThought(baseEval(), baseFeedback());
        expect(result.decision).toBeDefined();
    });

    it('should respect timezone offset', () => {
        // UTC 0 + offset 3 = 3 (quiet) => blocked
        const result = filterThought(baseEval(), baseFeedback(), 0, 3);
        expect(result.decision).toBe('blocked');
    });

    it('should factor in reluctance penalty for scoring', () => {
        const feedbackWithPenalty = (): FeedbackState => ({
            thresholdAdjustment: 0,
            reluctancePenalty: 0.3,
            lastSignalAt: 0,
            signalHistory: [],
        });
        const result = filterThought(baseEval(), feedbackWithPenalty(), 12);
        // score = 0.7*0.6 + 0.5*0.4 - 0.3 = 0.42 + 0.20 - 0.3 = 0.32
        expect(result.score).toBeCloseTo(0.32, 2);
    });

    it('should factor in threshold adjustment', () => {
        const feedbackWithAdj = (): FeedbackState => ({
            thresholdAdjustment: 0.1,
            reluctancePenalty: 0,
            lastSignalAt: 0,
            signalHistory: [],
        });
        const result = filterThought(baseEval(), feedbackWithAdj(), 12);
        // threshold = 0.45 + 0.1 = 0.55
        expect(result.threshold).toBeCloseTo(0.55, 5);
    });
});
