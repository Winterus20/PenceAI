/**
 * Transport Security Tests
 *
 * MCP default-deny env allowlist and config env validation
 */

import { describe, test, expect, beforeEach, afterAll } from '@jest/globals';
import {
  createTransport,
  sanitizeMcpChildProcessEnv,
  validateMcpServerConfigEnv,
} from '../../../src/agent/mcp/transport.js';
import { reloadConfig } from '../../../src/gateway/config.js';

describe('Transport Security', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    delete process.env.MCP_ALLOWED_ENV_VARS;
    reloadConfig();
  });

  afterAll(() => {
    process.env = originalEnv;
    reloadConfig();
  });

  describe('MCP child process env allowlist (default-deny via mcpAllowedEnvVars)', () => {
    test('only allowlisted vars are passed to child process', () => {
      process.env.OPENAI_API_KEY = 'sk-test123';
      process.env.CUSTOM_APP_FLAG = 'enabled';
      process.env.PATH = '/usr/bin';
      process.env.HOME = '/home/user';
      process.env.LANG = 'en_US.UTF-8';

      const sanitized = sanitizeMcpChildProcessEnv();

      expect(sanitized.PATH).toBe('/usr/bin');
      expect(sanitized.HOME).toBe('/home/user');
      expect(sanitized.LANG).toBe('en_US.UTF-8');
      expect(sanitized.OPENAI_API_KEY).toBeUndefined();
      expect(sanitized.CUSTOM_APP_FLAG).toBeUndefined();
    });

    test('MCP_SERVERS and API keys are blocked from child process', () => {
      process.env.MCP_SERVERS = JSON.stringify([{ name: 'test' }]);
      process.env.GITHUB_TOKEN = 'ghp_test123';
      process.env.PATH = '/usr/bin';

      const sanitized = sanitizeMcpChildProcessEnv();

      expect(sanitized.MCP_SERVERS).toBeUndefined();
      expect(sanitized.GITHUB_TOKEN).toBeUndefined();
      expect(sanitized.PATH).toBe('/usr/bin');
    });

    test('Windows allowlist vars are included when set', () => {
      process.env.USERPROFILE = 'C:\\Users\\test';
      process.env.APPDATA = 'C:\\Users\\test\\AppData';
      process.env.TEMP = 'C:\\Temp';
      process.env.SYSTEMROOT = 'C:\\Windows';
      process.env.COMSPEC = 'cmd.exe';
      process.env.PATHEXT = '.EXE;.CMD';
      process.env.OPENAI_API_KEY = 'sk-secret';

      const sanitized = sanitizeMcpChildProcessEnv();

      expect(sanitized.USERPROFILE).toBe('C:\\Users\\test');
      expect(sanitized.APPDATA).toBe('C:\\Users\\test\\AppData');
      expect(sanitized.TEMP).toBe('C:\\Temp');
      expect(sanitized.SYSTEMROOT).toBe('C:\\Windows');
      expect(sanitized.COMSPEC).toBe('cmd.exe');
      expect(sanitized.PATHEXT).toBe('.EXE;.CMD');
      expect(sanitized.OPENAI_API_KEY).toBeUndefined();
    });

    test('respects MCP_ALLOWED_ENV_VARS override', () => {
      process.env.MCP_ALLOWED_ENV_VARS = 'CUSTOM_APP_FLAG,PATH';
      reloadConfig();
      process.env.CUSTOM_APP_FLAG = 'enabled';
      process.env.HOME = '/home/user';

      const sanitized = sanitizeMcpChildProcessEnv();

      expect(sanitized.CUSTOM_APP_FLAG).toBe('enabled');
      expect(sanitized.HOME).toBeUndefined();
    });
  });

  describe('MCP config env validation (validateMcpServerConfigEnv)', () => {
    test('rejects shell meta characters in env values', () => {
      const shellChars = [';', '|', '&', '$', '`', '\\'];

      for (const char of shellChars) {
        expect(() => validateMcpServerConfigEnv({ CUSTOM: `test${char}value` })).toThrow();
      }
    });

    test('accepts safe env values', () => {
      expect(() => validateMcpServerConfigEnv({
        FOO: 'simple-value',
        BAR: '/path/to/something',
      })).not.toThrow();
    });

    test('blocks critical system env keys like PATH and HOME', () => {
      expect(() => validateMcpServerConfigEnv({ PATH: '/usr/bin' })).toThrow('blocked');
      expect(() => validateMcpServerConfigEnv({ HOME: '/home/user' })).toThrow('blocked');
    });

    test('rejects env values exceeding max length', () => {
      const longValue = 'a'.repeat(10001);
      expect(() => validateMcpServerConfigEnv({ LONG: longValue })).toThrow();
    });
  });

  describe('command allowlist (createTransport)', () => {
    test('rejects commands outside stdio allowlist', async () => {
      await expect(createTransport({
        name: 'bad-server',
        command: 'bash',
        args: ['-c', 'echo hi'],
      })).rejects.toThrow('Tanınmayan komut');
    });
  });
});
