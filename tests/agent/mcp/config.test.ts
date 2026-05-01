/**
 * MCP Config — Unit Tests
 */

import { parseMCPConfig, isMCPEnabled, getMCPServerConfig, getAllMCPServerConfigs } from '../../../src/agent/mcp/config.js';
import { reloadConfig } from '../../../src/gateway/config.js';

describe('MCP Config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    reloadConfig();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    reloadConfig();
  });

  describe('isMCPEnabled', () => {
    test('should return false when ENABLE_MCP is not set', () => {
      delete process.env.ENABLE_MCP;
      reloadConfig();
      expect(isMCPEnabled()).toBe(false);
    });

    test('should return true when ENABLE_MCP is "true"', () => {
      process.env.ENABLE_MCP = 'true';
      reloadConfig();
      expect(isMCPEnabled()).toBe(true);
    });

    test('should return true when ENABLE_MCP is "TRUE" (case insensitive)', () => {
      process.env.ENABLE_MCP = 'TRUE';
      reloadConfig();
      expect(isMCPEnabled()).toBe(true);
    });

    test('should return false when ENABLE_MCP is "false"', () => {
      process.env.ENABLE_MCP = 'false';
      reloadConfig();
      expect(isMCPEnabled()).toBe(false);
    });
  });

  describe('parseMCPConfig', () => {
    test('should return disabled config when ENABLE_MCP is false', () => {
      process.env.ENABLE_MCP = 'false';
      reloadConfig();
      const config = parseMCPConfig();
      expect(config.enabled).toBe(false);
      expect(config.servers).toEqual([]);
    });

    test('should parse valid server config', () => {
      process.env.ENABLE_MCP = 'true';
      process.env.MCP_SERVERS = JSON.stringify([
        {
          name: 'filesystem',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        },
      ]);
      reloadConfig();

      const config = parseMCPConfig();
      expect(config.enabled).toBe(true);
      expect(config.servers).toHaveLength(1);
      expect(config.servers[0].name).toBe('filesystem');
      expect(config.servers[0].command).toBe('npx');
    });

    test('should reject invalid server name', () => {
      process.env.ENABLE_MCP = 'true';
      process.env.MCP_SERVERS = JSON.stringify([
        {
          name: 'invalid server name!',
          command: 'npx',
          args: [],
        },
      ]);
      reloadConfig();

      const config = parseMCPConfig();
      expect(config.servers).toHaveLength(0);
    });

    test('should reject dangerous command', () => {
      process.env.ENABLE_MCP = 'true';
      process.env.MCP_SERVERS = JSON.stringify([
        {
          name: 'evil-server',
          command: 'rm',
          args: ['-rf', '/'],
        },
      ]);
      reloadConfig();

      const config = parseMCPConfig();
      expect(config.servers).toHaveLength(0);
    });

    test('should accept safe commands (npx, node, python)', () => {
      process.env.ENABLE_MCP = 'true';
      process.env.MCP_SERVERS = JSON.stringify([
        { name: 'server1', command: 'npx', args: [] },
        { name: 'server2', command: 'node', args: ['script.js'] },
        { name: 'server3', command: 'python', args: ['script.py'] },
      ]);
      reloadConfig();

      const config = parseMCPConfig();
      expect(config.servers).toHaveLength(3);
    });

    test('should use default runtime options when not set', () => {
      process.env.ENABLE_MCP = 'true';
      process.env.MCP_SERVERS = '[]';
      reloadConfig();

      const config = parseMCPConfig();
      expect(config.runtimeOptions.defaultTimeout).toBe(30000);
      expect(config.runtimeOptions.maxConcurrentCalls).toBe(5);
      expect(config.runtimeOptions.enableLogging).toBe(true);
    });

    test('should override runtime options when set', () => {
      process.env.ENABLE_MCP = 'true';
      process.env.MCP_SERVERS = '[]';
      process.env.MCP_TIMEOUT = '60000';
      process.env.MCP_MAX_CONCURRENT = '10';
      reloadConfig();

      const config = parseMCPConfig();
      expect(config.runtimeOptions.defaultTimeout).toBe(60000);
      expect(config.runtimeOptions.maxConcurrentCalls).toBe(10);
    });
  });

  describe('getMCPServerConfig', () => {
    test('should return null for non-existent server', () => {
      process.env.ENABLE_MCP = 'true';
      process.env.MCP_SERVERS = JSON.stringify([
        { name: 'filesystem', command: 'npx', args: [] },
      ]);
      reloadConfig();

      const config = getMCPServerConfig('non-existent');
      expect(config).toBeNull();
    });

    test('should return config for existing server', () => {
      process.env.ENABLE_MCP = 'true';
      process.env.MCP_SERVERS = JSON.stringify([
        { name: 'filesystem', command: 'npx', args: ['/tmp'] },
      ]);
      reloadConfig();

      const config = getMCPServerConfig('filesystem');
      expect(config).not.toBeNull();
      expect(config?.name).toBe('filesystem');
    });
  });

  describe('getAllMCPServerConfigs', () => {
    test('should return empty array when no servers configured', () => {
      process.env.ENABLE_MCP = 'true';
      process.env.MCP_SERVERS = '[]';
      reloadConfig();

      const configs = getAllMCPServerConfigs();
      expect(configs).toEqual([]);
    });

    test('should return all server configs', () => {
      process.env.ENABLE_MCP = 'true';
      process.env.MCP_SERVERS = JSON.stringify([
        { name: 'server1', command: 'npx', args: [] },
        { name: 'server2', command: 'node', args: [] },
      ]);
      reloadConfig();

      const configs = getAllMCPServerConfigs();
      expect(configs).toHaveLength(2);
    });
  });
});
