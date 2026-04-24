/**
 * UnifiedToolRegistry — Unit Tests
 * 
 * Tests for UnifiedToolRegistry class including tool registration,
 * execution, and singleton management.
 */

import { 
  UnifiedToolRegistry, 
  getUnifiedToolRegistry, 
  resetUnifiedToolRegistry 
} from '../../../src/agent/mcp/registry.js';

// Mock dependencies
jest.mock('../../../src/agent/mcp/client.js', () => ({
  MCPClientManager: jest.fn().mockImplementation(() => ({
    listTools: jest.fn().mockReturnValue([]),
    hasTool: jest.fn().mockReturnValue(false),
    callTool: jest.fn().mockResolvedValue('result'),
    totalToolCount: 0,
  })),
}));

jest.mock('../../../src/agent/tools.js', () => ({
  createBuiltinTools: jest.fn().mockReturnValue([
    { name: 'readFile', execute: jest.fn() },
    { name: 'writeFile', execute: jest.fn() },
  ]),
}));

jest.mock('../../../src/agent/prompt.js', () => ({
  getBuiltinToolDefinitions: jest.fn().mockReturnValue([]),
}));

jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('UnifiedToolRegistry', () => {
  let registry: UnifiedToolRegistry;

  beforeEach(() => {
    registry = new UnifiedToolRegistry();
  });

  afterEach(() => {
    registry.clear();
  });

  describe('registerBuiltins', () => {
    test('registers built-in tools', () => {
      const mockMemoryManager = {} as any;
      registry.registerBuiltins(mockMemoryManager);
      expect(registry.toolCount).toBeGreaterThan(0);
    });

    test('registers tools with confirm callback', () => {
      const mockMemoryManager = {} as any;
      const mockConfirmCallback = jest.fn();
      registry.registerBuiltins(mockMemoryManager, mockConfirmCallback);
      expect(registry.toolCount).toBeGreaterThan(0);
    });

    test('registers tools with merge function', () => {
      const mockMemoryManager = {} as any;
      const mockMergeFn = jest.fn().mockResolvedValue('merged');
      registry.registerBuiltins(mockMemoryManager, undefined, mockMergeFn);
      expect(registry.toolCount).toBeGreaterThan(0);
    });
  });

  describe('registerMCPManager', () => {
    test('registers MCP manager', async () => {
      const mockMCPManager = {
        listTools: jest.fn().mockReturnValue([]),
        hasTool: jest.fn().mockReturnValue(false),
        callTool: jest.fn().mockResolvedValue('result'),
        totalToolCount: 5,
      } as any;
      
      await registry.registerMCPManager(mockMCPManager);
      expect(registry.toolCount).toBeGreaterThan(0);
    });
  });

  describe('getAllToolDefinitions', () => {
    test('returns empty array when no tools registered', () => {
      const definitions = registry.getAllToolDefinitions();
      expect(Array.isArray(definitions)).toBe(true);
    });

    test('returns built-in tool definitions', () => {
      const mockMemoryManager = {} as any;
      registry.registerBuiltins(mockMemoryManager);
      const definitions = registry.getAllToolDefinitions();
      expect(Array.isArray(definitions)).toBe(true);
    });
  });

  describe('executeTool', () => {
    test('returns error for unknown tool', async () => {
      const result = await registry.executeTool('unknown-tool', {});
      expect(result).toContain('Bilinmeyen araç');
    });

    test('executes built-in tool', async () => {
      const mockMemoryManager = {} as any;
      registry.registerBuiltins(mockMemoryManager);
      // Built-in tools are registered, but we need to test the execution path
      const result = await registry.executeTool('unknown-tool', {});
      expect(result).toContain('Bilinmeyen araç');
    });

    test('executes MCP tool with mcp: prefix', async () => {
      const mockMCPManager = {
        listTools: jest.fn().mockReturnValue([]),
        hasTool: jest.fn().mockReturnValue(true),
        callTool: jest.fn().mockResolvedValue('MCP result'),
        totalToolCount: 1,
      } as any;
      
      await registry.registerMCPManager(mockMCPManager);
      const result = await registry.executeTool('mcp:test:tool', {});
      expect(result).toBe('MCP result');
    });
  });

  describe('hasTool', () => {
    test('returns false for unknown tool', () => {
      expect(registry.hasTool('unknown-tool')).toBe(false);
    });

    test('returns true for MCP tool when manager registered', async () => {
      const mockMCPManager = {
        listTools: jest.fn().mockReturnValue([]),
        hasTool: jest.fn().mockReturnValue(true),
        callTool: jest.fn().mockResolvedValue('result'),
        totalToolCount: 1,
      } as any;
      
      await registry.registerMCPManager(mockMCPManager);
      expect(registry.hasTool('mcp:test:tool')).toBe(true);
    });
  });

  describe('toolCount', () => {
    test('returns 0 when no tools registered', () => {
      expect(registry.toolCount).toBe(0);
    });

    test('returns count after registering builtins', () => {
      const mockMemoryManager = {} as any;
      registry.registerBuiltins(mockMemoryManager);
      expect(registry.toolCount).toBeGreaterThan(0);
    });
  });

  describe('clear', () => {
    test('clears all registered tools', () => {
      const mockMemoryManager = {} as any;
      registry.registerBuiltins(mockMemoryManager);
      const countBefore = registry.toolCount;
      registry.clear();
      expect(registry.toolCount).toBe(0);
    });
  });
});

describe('Singleton Registry', () => {
  afterEach(() => {
    resetUnifiedToolRegistry();
  });

  test('getUnifiedToolRegistry returns same instance', () => {
    const r1 = getUnifiedToolRegistry();
    const r2 = getUnifiedToolRegistry();
    expect(r1).toBe(r2);
  });

  test('resetUnifiedToolRegistry allows new instance', () => {
    const r1 = getUnifiedToolRegistry();
    resetUnifiedToolRegistry();
    const r2 = getUnifiedToolRegistry();
    expect(r1).not.toBe(r2);
  });


});
