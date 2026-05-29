/**
 * Auth defaults & otonom onay — güvenlik regresyon testleri
 */

import dotenv from 'dotenv';
import { reloadConfig, getConfig } from '../../src/gateway/config.js';
import { isDashboardRequestAuthorized } from '../../src/gateway/bootstrap.js';
import { createScopedAutoConfirmCallback } from '../../src/agent/autonomousConfirm.js';

describe('Auth Defaults & Production Security', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.spyOn(dotenv, 'config').mockImplementation(() => ({ parsed: {} } as dotenv.DotenvConfigOutput));
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    reloadConfig();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
    reloadConfig();
  });

  describe('host default', () => {
    test('defaults to 127.0.0.1 when HOST is unset', () => {
      delete process.env.HOST;
      reloadConfig();
      expect(getConfig().host).toBe('127.0.0.1');
    });
  });

  describe('isDashboardRequestAuthorized', () => {
    test('allows requests when no password is configured', () => {
      expect(isDashboardRequestAuthorized(undefined, undefined, undefined)).toBe(true);
    });

    test('rejects when password is set but auth is missing', () => {
      expect(isDashboardRequestAuthorized('secret', undefined, undefined)).toBe(false);
    });

    test('accepts valid Basic auth password', () => {
      const token = Buffer.from(':secret').toString('base64');
      expect(isDashboardRequestAuthorized('secret', `Basic ${token}`, undefined)).toBe(true);
    });

    test('accepts valid WebSocket protocol auth', () => {
      expect(isDashboardRequestAuthorized('secret', undefined, 'auth-secret')).toBe(true);
    });
  });

  describe('production config validation', () => {
    test('rejects production startup without dashboard password', () => {
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);

      process.env.NODE_ENV = 'production';
      delete process.env.DASHBOARD_PASSWORD;

      expect(() => reloadConfig()).toThrow('process.exit');
      exitSpy.mockRestore();
    });

    test('rejects production password shorter than 12 characters', () => {
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);

      process.env.NODE_ENV = 'production';
      process.env.DASHBOARD_PASSWORD = 'short';

      expect(() => reloadConfig()).toThrow('process.exit');
      exitSpy.mockRestore();
    });

    test('accepts production with strong dashboard password', () => {
      process.env.NODE_ENV = 'production';
      process.env.DASHBOARD_PASSWORD = 'strong-password-123';
      reloadConfig();
      expect(getConfig().dashboardPassword).toBe('strong-password-123');
    });
  });

  describe('allowLocalhostWsBypass default', () => {
    test('defaults to true in test/development', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.ALLOW_LOCALHOST_WS_BYPASS;
      reloadConfig();
      expect(getConfig().allowLocalhostWsBypass).toBe(true);
    });

    test('defaults to false in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.DASHBOARD_PASSWORD = 'strong-password-123';
      delete process.env.ALLOW_LOCALHOST_WS_BYPASS;
      reloadConfig();
      expect(getConfig().allowLocalhostWsBypass).toBe(false);
    });
  });
});

describe('Scoped Autonomous Confirm Callback', () => {
  test('approves whitelisted read-only tools', async () => {
    const callback = createScopedAutoConfirmCallback(['readFile', 'searchMemory']);
    await expect(callback({
      toolName: 'readFile',
      path: '/tmp/x',
      operation: 'write',
      description: 'test',
    })).resolves.toBe(true);
  });

  test('rejects write and shell tools not in whitelist', async () => {
    const callback = createScopedAutoConfirmCallback(['readFile']);
    await expect(callback({
      toolName: 'writeFile',
      path: '/tmp/x',
      operation: 'write',
      description: 'test',
    })).resolves.toBe(false);

    await expect(callback({
      toolName: 'executeShell',
      path: '/',
      operation: 'execute',
      description: 'test',
    })).resolves.toBe(false);
  });

  test('rejects MCP tools unless explicitly whitelisted', async () => {
    const callback = createScopedAutoConfirmCallback(['readFile']);
    await expect(callback({
      toolName: 'mcp:filesystem:write_file',
      path: '/tmp/x',
      operation: 'write',
      description: 'test',
    })).resolves.toBe(false);
  });
});
