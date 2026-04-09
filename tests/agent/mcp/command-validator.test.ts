import { validateRegistryCommand, sanitizeRegistryUrl, ALLOWED_COMMANDS } from '../../../src/agent/mcp/command-validator.js';

describe('Command Validator', () => {
  describe('validateRegistryCommand', () => {
    test('allows npx', () => {
      expect(validateRegistryCommand('npx')).toBe('npx');
    });
    
    test('allows node', () => {
      expect(validateRegistryCommand('node')).toBe('node');
    });
    
    test('allows python', () => {
      expect(validateRegistryCommand('python')).toBe('python');
    });
    
    test('allows python3', () => {
      expect(validateRegistryCommand('python3')).toBe('python3');
    });
    
    test('allows curl', () => {
      expect(validateRegistryCommand('curl')).toBe('curl');
    });
    
    test('blocks bash', () => {
      expect(() => validateRegistryCommand('bash')).toThrow();
    });
    
    test('blocks rm', () => {
      expect(() => validateRegistryCommand('rm')).toThrow();
    });
    
    test('blocks eval', () => {
      expect(() => validateRegistryCommand('eval')).toThrow();
    });
    
    test('blocks empty string', () => {
      expect(() => validateRegistryCommand('')).toThrow();
    });
    
    test('blocks number input', () => {
      expect(() => validateRegistryCommand(123)).toThrow();
    });
  });

  describe('sanitizeRegistryUrl', () => {
    test('allows valid https URL', () => {
      expect(sanitizeRegistryUrl('https://api.example.com')).toBe('https://api.example.com');
    });
    
    test('allows valid http URL', () => {
      expect(sanitizeRegistryUrl('http://localhost:3000/api')).toBe('http://localhost:3000/api');
    });
    
    test('allows URL with query params', () => {
      expect(sanitizeRegistryUrl('https://api.example.com/v1?foo=bar')).toBe('https://api.example.com/v1?foo=bar');
    });
    
    test('blocks URL with semicolon injection', () => {
      expect(() => sanitizeRegistryUrl('https://evil.com/hook; rm -rf /')).toThrow();
    });
    
    test('blocks URL with pipe injection', () => {
      expect(() => sanitizeRegistryUrl('https://evil.com/hook|cat /etc/passwd')).toThrow();
    });
    
    test('blocks URL with $() injection', () => {
      expect(() => sanitizeRegistryUrl('https://evil.com/$(whoami)')).toThrow();
    });
    
    test('blocks URL with backtick injection', () => {
      expect(() => sanitizeRegistryUrl('https://evil.com/`id`')).toThrow();
    });
    
    test('blocks non-http URL', () => {
      expect(() => sanitizeRegistryUrl('file:///etc/passwd')).toThrow();
    });
    
    test('blocks ftp URL', () => {
      expect(() => sanitizeRegistryUrl('ftp://example.com/file')).toThrow();
    });
    
    test('blocks URL with backslash', () => {
      expect(() => sanitizeRegistryUrl('https://evil.com\\bad')).toThrow();
    });
    
    test('blocks invalid URL format', () => {
      expect(() => sanitizeRegistryUrl('not-a-url')).toThrow();
    });
    
    test('blocks URL that is too long', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2048);
      expect(() => sanitizeRegistryUrl(longUrl)).toThrow();
    });
  });
});
