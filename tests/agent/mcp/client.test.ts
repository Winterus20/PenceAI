/**
 * MCPClientManager — Unit Tests
 * 
 * Tests for MCPClientManager class including initialization,
 * server management, tool listing, and shutdown.
 */

import { MCPClientManager } from '../../../src/agent/mcp/client.js';
import type { MCPServerConfig } from '../../../src/agent/mcp/types.js';

// Mock @modelcontextprotocol/sdk
jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    listTools: jest.fn().mockResolvedValue({ tools: [] }),
    callTool: jest.fn().mockResolvedValue({ content: [] }),
  })),
}));

jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Mock transport module
jest.mock('../../../src/agent/mcp/transport.js', () => ({
  createTransport: jest.fn().mockResolvedValue({
    transport: {
      connect: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    },
  }),
  connectClient: jest.fn().mockResolvedValue(undefined),
  disconnectClient: jest.fn().mockResolvedValue(undefined),
}));

// Mock logger
jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('MCPClientManager', () => {
  let manager: MCPClientManager;

  beforeEach(() => {
    manager = new MCPClientManager();
  });

  afterEach(async () => {
    if (manager.isInitialized) {
      await manager.shutdown();
    }
  });

  describe('initialize', () => {
    test('initializes with empty config array', async () => {
      const count = await manager.initialize([]);
      expect(count).toBe(0);
      expect(manager.isInitialized).toBe(false);
    });

    test('returns 0 when no server configs provided', async () => {
      const count = await manager.initialize([]);
      expect(count).toBe(0);
    });

    test('returns existing server count when already initialized', async () => {
      await manager.initialize([]);
      const count = await manager.initialize([]);
      expect(count).toBe(0);
    });
  });

  describe('getServerStatus', () => {
    test('returns null for unknown server', () => {
      expect(manager.getServerStatus('unknown')).toBeNull();
    });
  });

  describe('getAllServerStatuses', () => {
    test('returns empty array when no servers', () => {
      expect(manager.getAllServerStatuses()).toEqual([]);
    });
  });

  describe('listTools', () => {
    test('returns empty array when no servers connected', () => {
      expect(manager.listTools()).toEqual([]);
    });
  });

  describe('getServerTools', () => {
    test('returns empty array for unknown server', () => {
      expect(manager.getServerTools('unknown')).toEqual([]);
    });
  });

  describe('hasTool', () => {
    test('returns false for invalid tool name format', () => {
      expect(manager.hasTool('invalid-tool')).toBe(false);
    });

    test('returns false for non-mcp prefixed tool', () => {
      expect(manager.hasTool('some-tool')).toBe(false);
    });

    test('returns false for unknown server', () => {
      expect(manager.hasTool('mcp:unknown:tool')).toBe(false);
    });
  });

  describe('callTool', () => {
    test('throws on invalid tool name format', async () => {
      await expect(manager.callTool('invalid-tool', {})).rejects.toThrow(
        'Invalid tool name format: invalid-tool. Expected: mcp:{server}:{tool}'
      );
    });

    test('throws on non-mcp prefixed tool name', async () => {
      await expect(manager.callTool('some-tool', {})).rejects.toThrow(
        'Invalid tool name format: some-tool. Expected: mcp:{server}:{tool}'
      );
    });

    test('throws on unknown server', async () => {
      await expect(manager.callTool('mcp:unknown:tool', {})).rejects.toThrow(
        'MCP server "unknown" not found'
      );
    });
  });

  describe('connectedServerCount', () => {
    test('returns 0 when no servers', () => {
      expect(manager.connectedServerCount).toBe(0);
    });
  });

  describe('totalToolCount', () => {
    test('returns 0 when no servers', () => {
      expect(manager.totalToolCount).toBe(0);
    });
  });

  describe('shutdown', () => {
    test('shutdown on non-initialized does not throw', async () => {
      await expect(manager.shutdown()).resolves.not.toThrow();
    });
  });

  describe('onEvent/offEvent', () => {
    test('registers and removes event callback', () => {
      const callback = jest.fn();
      manager.onEvent(callback);
      manager.offEvent(callback);
      // No error means success
      expect(true).toBe(true);
    });
  });
});
