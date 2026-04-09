/**
 * MCP Server Lifecycle — Integration Tests
 * 
 * Tests the full server lifecycle:
 * install → initialize → activate → discover tools → call tool → deactivate → uninstall
 */
import { MCPClientManager } from '../../../src/agent/mcp/client.js';
import { sampleServerConfig, createIsolatedEnv } from './fixtures/integrationFixtures.js';

// Mock transport to avoid spawning real processes
jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    stderr: { on: jest.fn() },
  })),
}));

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    listTools: jest.fn().mockResolvedValue({
      tools: [
        {
          name: 'echo',
          description: 'Echo back the input',
          inputSchema: {
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
          },
        },
      ],
    }),
    callTool: jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Hello!' }],
    }),
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

describe('MCP Server Lifecycle Integration', () => {
  let manager: MCPClientManager;
  let env: ReturnType<typeof createIsolatedEnv>;

  beforeEach(() => {
    manager = new MCPClientManager();
    env = createIsolatedEnv();
  });

  afterEach(async () => {
    if (manager.isInitialized) {
      await manager.shutdown();
    }
    env.cleanup();
  });

  test('full lifecycle: initialize → activate → discover → call → deactivate', async () => {
    // Step 1: Initialize
    const serverCount = await manager.initialize([sampleServerConfig]);
    expect(serverCount).toBe(1);
    expect(manager.isInitialized).toBe(true);

    // Step 2: Verify server is registered
    const serverNames = manager.getAllServerStatuses().map((s: { name: string }) => s.name);
    expect(serverNames).toContain('test-server');

    // Step 3: Discover tools
    const tools = manager.getServerTools('test-server');
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0].name).toBe('mcp:test-server:echo');

    // Step 4: Check tool exists
    expect(manager.hasTool('mcp:test-server:echo')).toBe(true);

    // Step 5: Call tool
    const result = await manager.callTool('mcp:test-server:echo', { message: 'Hello!' });
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');

    // Step 6: Shutdown
    await manager.shutdown();
    expect(manager.isInitialized).toBe(false);
    expect(manager.getAllServerStatuses()).toEqual([]);
  });

  test('re-initialization shuts down first', async () => {
    await manager.initialize([sampleServerConfig]);
    expect(manager.isInitialized).toBe(true);
    
    // Re-initialize should shutdown first
    await manager.initialize([sampleServerConfig]);
    expect(manager.isInitialized).toBe(true);
  });

  test('callTool throws on unknown tool', async () => {
    await manager.initialize([sampleServerConfig]);
    await expect(manager.callTool('mcp:unknown:tool', {})).rejects.toThrow();
  });

  test('listTools returns all tools from all servers', async () => {
    await manager.initialize([sampleServerConfig]);
    const allTools = manager.listTools();
    expect(allTools.length).toBeGreaterThan(0);
    expect(allTools.some((t: { name: string }) => t.name === 'mcp:test-server:echo')).toBe(true);
  });

  test('getServerTools returns empty for unknown server', async () => {
    await manager.initialize([sampleServerConfig]);
    const tools = manager.getServerTools('unknown-server');
    expect(tools).toEqual([]);
  });

  test('initialize with empty config returns 0', async () => {
    const count = await manager.initialize([]);
    expect(count).toBe(0);
    expect(manager.isInitialized).toBe(false);
  });

  test('getServerStatus returns null for unknown server', () => {
    expect(manager.getServerStatus('unknown')).toBeNull();
  });
});
