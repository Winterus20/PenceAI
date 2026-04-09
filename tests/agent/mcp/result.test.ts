/**
 * Result Pattern — Unit Tests
 * 
 * Tests for the Result pattern utility functions including
 * success, error, isSuccess, isError, unwrap, unwrapOr, and tryAsync.
 */

import { 
  success, 
  error, 
  isSuccess, 
  isError, 
  unwrap, 
  unwrapOr, 
  tryAsync 
} from '../../../src/agent/mcp/result.js';

describe('Result Pattern', () => {
  describe('success', () => {
    test('creates success result with value', () => {
      const result = success(42);
      expect(result.success).toBe(true);
      expect(result.data).toBe(42);
    });

    test('creates success result with object', () => {
      const data = { name: 'test', value: 123 };
      const result = success(data);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(data);
    });

    test('creates success result with null', () => {
      const result = success(null);
      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });

    test('creates success result with undefined', () => {
      const result = success(undefined);
      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });
  });

  describe('error', () => {
    test('creates error result with Error', () => {
      const err = new Error('test error');
      const result = error(err);
      expect(result.success).toBe(false);
      expect(result.error).toBe(err);
    });

    test('creates error result with custom error type', () => {
      const customError = { code: 500, message: 'Internal Error' };
      const result = error(customError);
      expect(result.success).toBe(false);
      expect(result.error).toEqual(customError);
    });
  });

  describe('isSuccess/isError', () => {
    test('isSuccess returns true for success', () => {
      expect(isSuccess(success(42))).toBe(true);
    });

    test('isSuccess returns false for error', () => {
      expect(isSuccess(error(new Error()))).toBe(false);
    });

    test('isError returns true for error', () => {
      expect(isError(error(new Error()))).toBe(true);
    });

    test('isError returns false for success', () => {
      expect(isError(success(42))).toBe(false);
    });
  });

  describe('unwrap', () => {
    test('unwraps success value', () => {
      expect(unwrap(success(42))).toBe(42);
    });

    test('unwraps success object', () => {
      const data = { key: 'value' };
      expect(unwrap(success(data))).toEqual(data);
    });

    test('throws on error', () => {
      const err = new Error('test error');
      expect(() => unwrap(error(err))).toThrow(err);
    });

    test('throws original error message', () => {
      const err = new Error('specific error message');
      expect(() => unwrap(error(err))).toThrow('specific error message');
    });
  });

  describe('unwrapOr', () => {
    test('returns value on success', () => {
      expect(unwrapOr(success(42), 0)).toBe(42);
    });

    test('returns default on error', () => {
      expect(unwrapOr(error(new Error()), 0)).toBe(0);
    });

    test('returns default object on error', () => {
      const defaultValue = { fallback: true };
      expect(unwrapOr(error(new Error()), defaultValue)).toEqual(defaultValue);
    });

    test('returns null default on error', () => {
      expect(unwrapOr(error(new Error()), null)).toBeNull();
    });
  });

  describe('tryAsync', () => {
    test('wraps successful async operation', async () => {
      const result = await tryAsync(() => Promise.resolve(42));
      expect(isSuccess(result)).toBe(true);
      expect(unwrap(result)).toBe(42);
    });

    test('wraps thrown Error', async () => {
      const result = await tryAsync(() => Promise.reject(new Error('fail')));
      expect(isError(result)).toBe(true);
    });

    test('wraps thrown non-Error', async () => {
      const result = await tryAsync(() => Promise.reject('string error'));
      expect(isError(result)).toBe(true);
    });

    test('handles async function that returns object', async () => {
      const data = { async: true };
      const result = await tryAsync(() => Promise.resolve(data));
      expect(isSuccess(result)).toBe(true);
      expect(unwrap(result)).toEqual(data);
    });

    test('handles sync throw in async function', async () => {
      const result = await tryAsync(async () => {
        throw new Error('sync throw in async');
      });
      expect(isError(result)).toBe(true);
    });
  });
});
