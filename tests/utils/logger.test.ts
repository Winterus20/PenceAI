/**
 * Logger Utility Tests
 *
 * Logger async context propagation ve temel fonksiyon birim testleri.
 */

import { asyncLocalStorage, runWithTraceId, flush, logger } from '../../src/utils/logger.js';

describe('Logger Utilities', () => {
  describe('runWithTraceId()', () => {
    it('should propagate traceId to logger mixin', () => {
      const customTraceId = 'test-trace-id-12345';

      runWithTraceId(() => {
        const context = asyncLocalStorage.getStore();
        expect(context).toBeDefined();
        expect(context?.traceId).toBe(customTraceId);
      }, customTraceId);
    });

    it('should generate uuid when traceId not provided', () => {
      runWithTraceId(() => {
        const context = asyncLocalStorage.getStore();
        expect(context).toBeDefined();
        expect(context?.traceId).toBeDefined();
        expect(typeof context?.traceId).toBe('string');
        expect(context?.traceId.length).toBeGreaterThan(0);
      });
    });

    it('should return the action return value', () => {
      const result = runWithTraceId(() => {
        return 'test-return-value';
      });
      expect(result).toBe('test-return-value');
    });

    it('should isolate context between nested calls', () => {
      const outerTraceId = 'outer-trace-id';
      const innerTraceId = 'inner-trace-id';

      runWithTraceId(() => {
        const outerContext = asyncLocalStorage.getStore();
        expect(outerContext?.traceId).toBe(outerTraceId);

        runWithTraceId(() => {
          const innerContext = asyncLocalStorage.getStore();
          expect(innerContext?.traceId).toBe(innerTraceId);
        }, innerTraceId);

        // Outer context should still aynı outerTraceId
        const afterInnerContext = asyncLocalStorage.getStore();
        expect(afterInnerContext?.traceId).toBe(outerTraceId);
      }, outerTraceId);
    });

    it('should not leak context outside runWithTraceId', () => {
      const outsideContext = asyncLocalStorage.getStore();
      expect(outsideContext).toBeUndefined();
    });
  });

  describe('flush()', () => {
    it('should not throw when called', () => {
      expect(() => flush()).not.toThrow();
    });
  });

  describe('logger instance', () => {
    it('should be created successfully', () => {
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });

    it('should log without throwing', () => {
      expect(() => {
        logger.info('Test log message');
        logger.warn({ test: 'data' }, 'Test warn message');
        logger.error({ err: new Error('test') }, 'Test error message');
      }).not.toThrow();
    });
  });
});
