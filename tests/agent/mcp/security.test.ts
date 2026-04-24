/**
 * MCP Security — Unit Tests
 */

import { RateLimiter, OutputSanitizer, ToolCallValidator, MCPSecurityManager } from '../../../src/agent/mcp/security.js';

describe('MCP Security', () => {
  describe('RateLimiter', () => {
    test('should allow requests within limit', () => {
      const limiter = new RateLimiter(5, 60000);
      for (let i = 0; i < 5; i++) {
        expect(limiter.check('test-key')).toBe(true);
      }
    });

    test('should block requests exceeding limit', () => {
      const limiter = new RateLimiter(3, 60000);
      limiter.check('test-key');
      limiter.check('test-key');
      limiter.check('test-key');
      expect(limiter.check('test-key')).toBe(false);
    });

    test('should reset for specific key', () => {
      const limiter = new RateLimiter(2, 60000);
      limiter.check('key1');
      limiter.check('key1');
      expect(limiter.check('key1')).toBe(false);
      
      limiter.reset('key1');
      expect(limiter.check('key1')).toBe(true);
    });

    test('should reset all keys', () => {
      const limiter = new RateLimiter(1, 60000);
      limiter.check('key1');
      limiter.check('key2');
      expect(limiter.check('key1')).toBe(false);
      expect(limiter.check('key2')).toBe(false);
      
      limiter.reset();
      expect(limiter.check('key1')).toBe(true);
      expect(limiter.check('key2')).toBe(true);
    });
  });

  describe('OutputSanitizer', () => {
    test('should not modify safe output', () => {
      const sanitizer = new OutputSanitizer();
      const output = 'Hello, world!';
      expect(sanitizer.sanitize(output)).toBe('Hello, world!');
    });

    test('should mask API keys', () => {
      const sanitizer = new OutputSanitizer();
      const output = 'api_key: sk-1234567890abcdef1234567890abcdef';
      const sanitized = sanitizer.sanitize(output);
      expect(sanitized).toContain('[REDACTED');
    });

    test('should mask AWS access keys', () => {
      const sanitizer = new OutputSanitizer();
      const output = 'Found key: AKIAIOSFODNN7EXAMPLE';
      const sanitized = sanitizer.sanitize(output);
      expect(sanitized).toContain('[REDACTED');
    });

    test('should mask private keys', () => {
      const sanitizer = new OutputSanitizer();
      const output = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----';
      const sanitized = sanitizer.sanitize(output);
      expect(sanitized).toContain('[REDACTED');
    });

    test('should mask passwords in URLs', () => {
      const sanitizer = new OutputSanitizer();
      const output = 'Connection: postgres://user:secret123@localhost:5432/db';
      const sanitized = sanitizer.sanitize(output);
      expect(sanitized).toContain('://***:***@');
    });

    test('should mask JWT tokens', () => {
      const sanitizer = new OutputSanitizer();
      const output = 'Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      const sanitized = sanitizer.sanitize(output);
      expect(sanitized).toContain('[REDACTED');
    });

    test('should truncate long output', () => {
      const sanitizer = new OutputSanitizer(100);
      const longOutput = 'A'.repeat(200);
      const sanitized = sanitizer.sanitize(longOutput);
      expect(sanitized.length).toBeLessThanOrEqual(125); // 100 + truncation suffix ('\n\n... [Çıktı kırpıldı]' = 22 chars)
      expect(sanitized).toContain('... [Çıktı kırpıldı]');
    });
  });

  describe('ToolCallValidator', () => {
    test('should validate safe arguments', () => {
      const validator = new ToolCallValidator();
      const result = validator.validateArgs('readFile', { path: '/tmp/test.txt' });
      expect(result.valid).toBe(true);
    });

    test('should reject oversized arguments', () => {
      const validator = new ToolCallValidator({ maxArgSize: 100 });
      const largeArgs = { data: 'A'.repeat(200) };
      const result = validator.validateArgs('writeFile', largeArgs);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('çok büyük');
    });

    test('should reject deeply nested arguments', () => {
      const validator = new ToolCallValidator({ maxDepth: 3 });
      const deepArgs = { a: { b: { c: { d: 'deep' } } } };
      const result = validator.validateArgs('test', deepArgs);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('depth');
    });

    test('should reject path traversal patterns', () => {
      const validator = new ToolCallValidator();
      const result = validator.validateArgs('readFile', { path: '../../../etc/passwd' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('pattern');
    });

    test('should reject null byte injection', () => {
      const validator = new ToolCallValidator();
      const result = validator.validateArgs('readFile', { path: '/tmp/test\x00.txt' });
      expect(result.valid).toBe(false);
    });

    test('should accept valid complex_arguments', () => {
      const validator = new ToolCallValidator();
      const result = validator.validateArgs('searchMemory', {
        query: 'test query',
        limit: 10,
        filters: { category: 'fact' },
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('MCPSecurityManager', () => {
    test('should return singleton instance', () => {
      MCPSecurityManager.resetInstance();
      const instance1 = MCPSecurityManager.getInstance();
      const instance2 = MCPSecurityManager.getInstance();
      expect(instance1).toBe(instance2);
    });

    test('should have all security components', () => {
      MCPSecurityManager.resetInstance();
      const manager = MCPSecurityManager.getInstance();
      expect(manager.rateLimiter).toBeDefined();
      expect(manager.sanitizer).toBeDefined();
      expect(manager.validator).toBeDefined();
    });
  });
});