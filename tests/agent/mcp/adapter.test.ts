/**
 * MCP Tool Adapter — Unit Tests
 * 
 * Tests for createMCPToolAdapter and convertMCPToolsToExecutors functions.
 */

import { createMCPToolAdapter, convertMCPToolsToExecutors } from '../../../src/agent/mcp/adapter.js';

// Mock logger
jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('MCP Tool Adapter', () => {
  describe('createMCPToolAdapter', () => {
    test('creates a tool executor with correct name', () => {
      const mockMCPManager = {
        callTool: jest.fn().mockResolvedValue('result'),
      } as any;

      const executor = createMCPToolAdapter(mockMCPManager, 'test-server', 'test-tool', 'A test tool');
      
      expect(executor.name).toBe('mcp:test-server:test-tool');
    });

    test('executor calls underlying tool', async () => {
      const mockCallTool = jest.fn().mockResolvedValue('tool result');
      const mockMCPManager = {
        callTool: mockCallTool,
      } as any;

      const executor = createMCPToolAdapter(mockMCPManager, 'test-server', 'test-tool', 'A test tool');
      
      const result = await executor.execute({ arg1: 'value' });
      
      expect(mockCallTool).toHaveBeenCalledWith('mcp:test-server:test-tool', { arg1: 'value' });
      expect(result).toBe('tool result');
    });

    test('executor handles errors gracefully', async () => {
      const mockCallTool = jest.fn().mockRejectedValue(new Error('tool error'));
      const mockMCPManager = {
        callTool: mockCallTool,
      } as any;

      const executor = createMCPToolAdapter(mockMCPManager, 'test-server', 'test-tool', 'A test tool');
      
      const result = await executor.execute({});
      
      expect(result).toContain('Hata');
      expect(result).toContain('mcp:test-server:test-tool');
    });

    test('executor handles non-Error objects', async () => {
      const mockCallTool = jest.fn().mockRejectedValue('string error');
      const mockMCPManager = {
        callTool: mockCallTool,
      } as any;

      const executor = createMCPToolAdapter(mockMCPManager, 'test-server', 'test-tool', 'A test tool');
      
      const result = await executor.execute({});
      
      expect(result).toContain('Hata');
    });
  });

  describe('convertMCPToolsToExecutors', () => {
    test('converts MCP tools to executors', () => {
      const mockMCPManager = {
        listTools: jest.fn().mockReturnValue([
          {
            name: 'mcp:test-server:tool1',
            description: 'Tool 1',
            mcpServerName: 'test-server',
          },
          {
            name: 'mcp:test-server:tool2',
            description: 'Tool 2',
            mcpServerName: 'test-server',
          },
        ]),
        callTool: jest.fn().mockResolvedValue('result'),
      } as any;

      const executors = convertMCPToolsToExecutors(mockMCPManager);
      
      expect(executors).toHaveLength(2);
      expect(executors[0].name).toBe('mcp:test-server:tool1');
      expect(executors[1].name).toBe('mcp:test-server:tool2');
    });

    test('returns empty array when no tools', () => {
      const mockMCPManager = {
        listTools: jest.fn().mockReturnValue([]),
      } as any;

      const executors = convertMCPToolsToExecutors(mockMCPManager);
      
      expect(executors).toHaveLength(0);
    });

    test('skips tools without mcpServerName', () => {
      const mockMCPManager = {
        listTools: jest.fn().mockReturnValue([
          {
            name: 'tool-without-server',
            description: 'No server',
          },
        ]),
      } as any;

      const executors = convertMCPToolsToExecutors(mockMCPManager);
      
      expect(executors).toHaveLength(0);
    });

    test('warns on tools without expected prefix', () => {
      const { logger } = require('../../../src/utils/logger.js');
      
      const mockMCPManager = {
        listTools: jest.fn().mockReturnValue([
          {
            name: 'wrong-prefix:tool',
            description: 'Wrong prefix',
            mcpServerName: 'test-server',
          },
        ]),
      } as any;

      convertMCPToolsToExecutors(mockMCPManager);
      
      expect(logger.warn).toHaveBeenCalled();
    });

    test('converted executors work correctly', async () => {
      const mockCallTool = jest.fn().mockResolvedValue('executed');
      const mockMCPManager = {
        listTools: jest.fn().mockReturnValue([
          {
            name: 'mcp:server:mytool',
            description: 'My Tool',
            mcpServerName: 'server',
          },
        ]),
        callTool: mockCallTool,
      } as any;

      const executors = convertMCPToolsToExecutors(mockMCPManager);
      
      expect(executors).toHaveLength(1);
      const result = await executors[0].execute({ param: 'value' });
      
      expect(mockCallTool).toHaveBeenCalledWith('mcp:server:mytool', { param: 'value' });
      expect(result).toBe('executed');
    });
  });
});
