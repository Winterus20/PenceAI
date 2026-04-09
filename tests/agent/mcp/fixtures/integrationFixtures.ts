/**
 * Integration Test Fixtures
 * 
 * Test utilities, sample data, and helper functions for MCP integration tests.
 */
import os from 'os';
import path from 'path';
import fs from 'fs';
import { MCPServerConfig } from '../../../../src/agent/mcp/types.js';

/**
 * Creates an isolated test directory
 */
export function createTestDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
  return dir;
}

/**
 * Cleanup test directory
 */
export function cleanupTestDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Creates isolated env for test
 */
export function createIsolatedEnv() {
  const testDir = createTestDir();
  const envFile = path.join(testDir, '.env');
  fs.writeFileSync(envFile, '');
  
  return {
    testDir,
    envFile,
    cleanup: () => cleanupTestDir(testDir),
  };
}

/**
 * Sample MCP server config for testing
 */
export const sampleServerConfig: MCPServerConfig = {
  name: 'test-server',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-everything'],
  env: {
    NODE_ENV: 'test',
  },
  timeout: 30000,
};

/**
 * Sample marketplace catalog entry
 */
export const sampleCatalogEntry = {
  name: 'sample-server',
  description: 'A sample MCP server for testing',
  command: 'npx',
  defaultArgs: ['-y', '@modelcontextprotocol/server-everything'],
  defaultEnv: { NODE_ENV: 'test' },
  source: 'marketplace',
  sourceUrl: 'https://example.com/sample-server',
  version: '1.0.0',
};

/**
 * Sample tool definition
 */
export const sampleToolDefinition = {
  name: 'echo',
  description: 'Echo back the input',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Message to echo' },
    },
    required: ['message'],
  },
};
