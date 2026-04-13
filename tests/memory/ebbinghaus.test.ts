import {
    computeRetention,
    computeNextReview,
    computeNewStability,
    daysSinceAccess,
    RETENTION_THRESHOLD,
    REVIEW_SCHEDULE_FACTOR,
} from '../../src/memory/ebbinghaus.js';

describe('ebbinghaus constants', () => {
    test('RETENTION_THRESHOLD should be 0.7', () => {
        expect(RETENTION_THRESHOLD).toBe(0.7);
    });

    test('REVIEW_SCHEDULE_FACTOR should equal -ln(0.7)', () => {
        const expected = -Math.log(0.7);
        expect(REVIEW_SCHEDULE_FACTOR).toBeCloseTo(expected, 10);
        expect(REVIEW_SCHEDULE_FACTOR).toBeCloseTo(0.3567, 4);
    });
});

describe('computeRetention', () => {
    test('should return e^(-t/S) for valid inputs', () => {
        // R(1/10) = e^(-0.1) ≈ 0.9048
        const result = computeRetention(10, 1);
        expect(result).toBeCloseTo(Math.exp(-0.1), 5);
    });

    test('should return 1 when daysSince is 0', () => {
        expect(computeRetention(5, 0)).toBeCloseTo(1.0, 10);
    });

    test('should return ~0.7 when daysSince = S * 0.3567', () => {
        const stability = 10;
        const daysSince = stability * REVIEW_SCHEDULE_FACTOR;
        const result = computeRetention(stability, daysSince);
        expect(result).toBeCloseTo(RETENTION_THRESHOLD, 5);
    });

    test('should approach 0 as daysSince increases', () => {
        const result = computeRetention(5, 100);
        expect(result).toBeLessThan(0.001);
    });

    test('should return 0 when stability is 0', () => {
        expect(computeRetention(0, 5)).toBe(0);
    });

    test('should return 0 when stability is negative', () => {
        expect(computeRetention(-3, 5)).toBe(0);
    });

    test('should handle large stability values', () => {
        const result = computeRetention(1000, 1);
        expect(result).toBeCloseTo(Math.exp(-0.001), 5);
    });
});

describe('computeNextReview', () => {
    test('should return a future timestamp', () => {
        const now = Math.floor(Date.now() / 1000);
        const result = computeNextReview(10);
        expect(result).toBeGreaterThan(now);
    });

    test('should schedule review at S * 0.3567 days from now', () => {
        const stability = 7; // 7 days
        const now = Math.floor(Date.now() / 1000);
        const result = computeNextReview(stability);
        const expectedOffset = Math.round(stability * REVIEW_SCHEDULE_FACTOR * 86400);
        expect(result).toBeCloseTo(now + expectedOffset, 0);
    });

    test('should return 0 offset when stability is 0', () => {
        const now = Math.floor(Date.now() / 1000);
        const result = computeNextReview(0);
        // With stability=0, daysUntilReview=0, so result should be approximately now
        expect(result).toBeGreaterThanOrEqual(now);
        expect(result).toBeLessThan(now + 60); // within 1 minute
    });
});

describe('computeNewStability', () => {
    test('should increase stability with high retention', () => {
        // S_new = 5 * (1 + 0.9 * 1.0) = 9.5
        const result = computeNewStability(5, 1.0);
        expect(result).toBeCloseTo(9.5, 10);
    });

    test('should increase stability moderately with R=0.7', () => {
        // S_new = 10 * (1 + 0.9 * 0.7) = 10 * 1.63 = 16.3
        const result = computeNewStability(10, 0.7);
        expect(result).toBeCloseTo(16.3, 5);
    });

    test('should not change stability when retention is 0', () => {
        // S_new = 8 * (1 + 0) = 8
        const result = computeNewStability(8, 0);
        expect(result).toBeCloseTo(8, 10);
    });

    test('should handle retention of 0.5', () => {
        // S_new = 4 * (1 + 0.9 * 0.5) = 4 * 1.45 = 5.8
        const result = computeNewStability(4, 0.5);
        expect(result).toBeCloseTo(5.8, 10);
    });
});

describe('daysSinceAccess', () => {
    test('should return 0 for null input', () => {
        expect(daysSinceAccess(null)).toBe(0);
    });

    test('should return 0 for empty string', () => {
        expect(daysSinceAccess('')).toBe(0);
    });

    test('should handle SQLite format "YYYY-MM-DD HH:MM:SS"', () => {
        const now = new Date();
        const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
        const dateStr = twoDaysAgo.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
        // We can't test exact value due to time drift, but it should be around 2
        const result = daysSinceAccess(dateStr);
        expect(result).toBeGreaterThanOrEqual(1.9);
        expect(result).toBeLessThan(2.1);
    });

    test('should handle ISO format with Z suffix', () => {
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const dateStr = oneDayAgo.toISOString();
        const result = daysSinceAccess(dateStr);
        expect(result).toBeGreaterThanOrEqual(0.9);
        expect(result).toBeLessThan(1.1);
    });

    test('should never return negative values', () => {
        const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        expect(daysSinceAccess(futureDate)).toBe(0);
    });
});
