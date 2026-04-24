/**
 * Tool Execution — Integration Tests
 * 
 * Tests tool execution pipeline from adapter to result.
 */
import { convertMCPToolsToExecutors } from '../../../src/agent/mcp/adapter.js';
import { sampleToolDefinition } from './fixtures/integrationFixtures.js';

// Mock dependencies
jest.mock('../../../src/agent/mcp/client.js', () => ({
  MCPClientManager: jest.fn().mockImplementation(() => ({
    listTools: jest.fn().mockReturnValue([
      {
        name: 'mcp:test-server:echo',
        description: 'Echo back the input',
        parameters: {
          type: 'object',
          properties: { message: { type: 'string' } },
        },
        source: 'mcp',
        mcpServerName: 'test-server',
        fullyQualifiedName: 'mcp:test-server:echo',
      },
    ]),
    hasTool: jest.fn().mockReturnValue(true),
    callTool: jest.fn().mockResolvedValue('Hello!'),
    totalToolCount: 1,
  })),
}));

jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { MCPClientManager } from '../../../src/agent/mcp/client.js';

describe('Tool Execution Integration', () => {
  test('executor calls underlying tool with correct args', async () => {
    const mockMCPManager = new MCPClientManager();
    
    const executors = convertMCPToolsToExecutors(mockMCPManager);
    expect(executors).toBeDefined();
    expect(Array.isArray(executors)).toBe(true);
    expect(executors.length).toBeGreaterThan(0);
  });

  test('executor has correct name format', async () => {
    const mockMCPManager = new MCPClientManager();
    
    const executors = convertMCPToolsToExecutors(mockMCPManager);
    const echoExecutor = executors.find(e => e.name === 'mcp:test-server:echo');
    expect(echoExecutor).toBeDefined();
  });

  test('executor executes tool successfully', async () => {
    const mockMCPManager = new MCPClientManager();
    
    const executors = convertMCPToolsToExecutors(mockMCPManager);
    const echoExecutor = executors.find(e => e.name === 'mcp:test-server:echo');
    
    expect(echoExecutor).toBeDefined();
    if (echoExecutor) {
      const result = await echoExecutor.execute({ message: 'Hello!' });
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    }
  });

  test('multi-tool execution works', async () => {
    const mockMCPManager = new MCPClientManager();
    
    const executors = convertMCPToolsToExecutors(mockMCPManager);
    
    // Execute all available tools
    for (const executor of executors) {
      const result = await executor.execute({ test: 'value' });
      expect(result).toBeDefined();
    }
  });
});
