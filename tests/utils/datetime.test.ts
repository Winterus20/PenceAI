/**
 * Datetime Utility Tests
 *
 * normalizeSqliteDate, daysSince ve formatRelativeTime birim testleri.
 */

import { normalizeSqliteDate, daysSince, formatRelativeTime } from '../../src/utils/datetime.js';

describe('Datetime Utilities', () => {
  describe('normalizeSqliteDate()', () => {
    it('should convert SQLite format (YYYY-MM-DD HH:MM:SS) to ISO 8601', () => {
      const result = normalizeSqliteDate('2024-04-11 14:30:00');
      expect(result).toBe('2024-04-11T14:30:00Z');
    });

    it('should handle SQLite format with milliseconds', () => {
      const result = normalizeSqliteDate('2024-04-11 14:30:00.123');
      expect(result).toBe('2024-04-11T14:30:00.123Z');
    });

    it('should return unchanged if already ends with Z', () => {
      const result = normalizeSqliteDate('2024-04-11T14:30:00Z');
      expect(result).toBe('2024-04-11T14:30:00Z');
    });

    it('should handle ISO 8601 without Z suffix', () => {
      const result = normalizeSqliteDate('2024-04-11T14:30:00');
      expect(result).toBe('2024-04-11T14:30:00Z');
    });

    it('should handle slash-separated format (YYYY/MM/DD HH:MM:SS)', () => {
      const result = normalizeSqliteDate('2024/04/11 14:30:00');
      expect(result).toBe('2024-04-11T14:30:00Z');
    });

    it('should handle valid ISO 8601 strings via fallback', () => {
      const result = normalizeSqliteDate('2024-04-11');
      expect(result).toMatch(/2024-04-11T00:00:00\.?0*Z/);
    });

    it('should throw Error for completely invalid format', () => {
      expect(() => normalizeSqliteDate('not-a-date')).toThrow();
    });

    it('should throw Error for empty string', () => {
      expect(() => normalizeSqliteDate('')).toThrow();
    });

    it('should throw descriptive error message', () => {
      expect(() => normalizeSqliteDate('!!!not-a-date!!!')).toThrow('Geçersiz tarih formatı');
    });
  });

  describe('daysSince()', () => {
    const FIXED_NOW = new Date('2024-04-15T00:00:00Z').getTime();

    it('should return 0 for null input', () => {
      expect(daysSince(null, FIXED_NOW)).toBe(0);
    });

    it('should return 0 for undefined input', () => {
      expect(daysSince(undefined, FIXED_NOW)).toBe(0);
    });

    it('should return 0 for empty string', () => {
      expect(daysSince('', FIXED_NOW)).toBe(0);
    });

    it('should calculate days between two dates', () => {
      // 2024-04-01 to 2024-04-15 = 14 days
      const result = daysSince('2024-04-01 00:00:00', FIXED_NOW);
      expect(result).toBe(14);
    });

    it('should return 0 for future dates (negative result clamped)', () => {
      const result = daysSince('2025-01-01 00:00:00', FIXED_NOW);
      expect(result).toBe(0);
    });

    it('should return 0 for invalid date strings (NaN protection)', () => {
      const result = daysSince('invalid-date-string', FIXED_NOW);
      expect(result).toBe(0);
    });

    it('should return 0 for completely malformed input', () => {
      const result = daysSince('xyz-abc', FIXED_NOW);
      expect(result).toBe(0);
    });

    it('should handle ISO 8601 format', () => {
      const result = daysSince('2024-04-10T12:00:00Z', FIXED_NOW);
      expect(result).toBeGreaterThanOrEqual(4);
      expect(result).toBeLessThanOrEqual(5);
    });

    it('should use Date.now() as default when nowMs not provided', () => {
      // Should not throw and return a non-negative number
      const result = daysSince('2020-01-01 00:00:00');
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  describe('formatRelativeTime()', () => {
    const FIXED_NOW = new Date('2024-04-15T12:00:00Z').getTime();

    it('should return "az önce" for recent times (< 60s)', () => {
      const result = formatRelativeTime(new Date(FIXED_NOW - 30 * 1000), FIXED_NOW);
      expect(result).toBe('az önce');
    });

    it('should return minutes for times < 60 minutes', () => {
      const result = formatRelativeTime(new Date(FIXED_NOW - 15 * 60 * 1000), FIXED_NOW);
      expect(result).toBe('15 dakika önce');
    });

    it('should return hours for times < 24 hours', () => {
      const result = formatRelativeTime(new Date(FIXED_NOW - 5 * 60 * 60 * 1000), FIXED_NOW);
      expect(result).toBe('5 saat önce');
    });

    it('should return days for times < 30 days', () => {
      const result = formatRelativeTime(new Date(FIXED_NOW - 10 * 24 * 60 * 60 * 1000), FIXED_NOW);
      expect(result).toBe('10 gün önce');
    });

    it('should return months for times < 1 year', () => {
      const result = formatRelativeTime(new Date(FIXED_NOW - 90 * 24 * 60 * 60 * 1000), FIXED_NOW);
      expect(result).toBe('3 ay önce');
    });

    it('should return years for times >= 1 year', () => {
      const result = formatRelativeTime(new Date(FIXED_NOW - 400 * 24 * 60 * 60 * 1000), FIXED_NOW);
      expect(result).toBe('1 yıl önce');
    });

    it('should accept date string input', () => {
      const result = formatRelativeTime('2024-04-15T11:55:00Z', FIXED_NOW);
      expect(result).toBe('5 dakika önce');
    });

    it('should accept SQLite format string', () => {
      const result = formatRelativeTime('2024-04-15 11:30:00', FIXED_NOW);
      expect(result).toBe('30 dakika önce');
    });

    it('should throw for invalid date string', () => {
      expect(() => formatRelativeTime('not-a-valid-date', FIXED_NOW)).toThrow();
    });

    it('should handle boundary: exactly 60 seconds', () => {
      const result = formatRelativeTime(new Date(FIXED_NOW - 60 * 1000), FIXED_NOW);
      expect(result).toBe('1 dakika önce');
    });

    it('should handle boundary: exactly 60 minutes', () => {
      const result = formatRelativeTime(new Date(FIXED_NOW - 60 * 60 * 1000), FIXED_NOW);
      expect(result).toBe('1 saat önce');
    });

    it('should handle boundary: exactly 24 hours', () => {
      const result = formatRelativeTime(new Date(FIXED_NOW - 24 * 60 * 60 * 1000), FIXED_NOW);
      expect(result).toBe('1 gün önce');
    });
  });
});
