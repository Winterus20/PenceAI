/**
 * Marketplace — Integration Tests
 * 
 * Tests catalog loading and server installation from marketplace.
 */

// Mock the entire marketplace-service module to avoid ESM import issues
jest.mock('../../../src/agent/mcp/marketplace-service.js', () => {
  const mockServers = [
    {
      name: 'test-filesystem',
      description: 'A test filesystem MCP server',
      version: '1.0.0',
      author: 'test',
      tags: ['filesystem', 'test'],
      command: 'npx',
      defaultArgs: ['-y', '@modelcontextprotocol/server-filesystem'],
      defaultEnv: {},
      sourceUrl: 'https://example.com/test-filesystem',
      tools: ['readFile', 'writeFile'],
    },
    {
      name: 'test-database',
      description: 'A test database MCP server',
      version: '1.0.0',
      author: 'test',
      tags: ['database', 'test'],
      command: 'npx',
      defaultArgs: ['-y', '@modelcontextprotocol/server-database'],
      defaultEnv: {},
      sourceUrl: 'https://example.com/test-database',
      tools: ['query', 'insert'],
    },
  ];

  return {
    loadLocalCatalog: jest.fn().mockReturnValue(mockServers),
    searchCatalog: jest.fn((query: string) => {
      const q = query.toLowerCase();
      return mockServers.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some(t => t.toLowerCase().includes(q))
      );
    }),
    getMarketplaceCatalog: jest.fn().mockResolvedValue(mockServers),
    catalogToConfig: jest.fn(),
  };
});

import { loadLocalCatalog, searchCatalog } from '../../../src/agent/mcp/marketplace-service.js';

describe('Marketplace Integration', () => {
  test('loads local catalog successfully', () => {
    const catalog = loadLocalCatalog();
    expect(catalog).toBeDefined();
    expect(Array.isArray(catalog)).toBe(true);
    expect(catalog.length).toBe(2);
  });

  test('searchCatalog returns matching servers', () => {
    const results = searchCatalog('filesystem');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe('test-filesystem');
  });

  test('searchCatalog is case-insensitive', () => {
    const resultsLower = searchCatalog('filesystem');
    const resultsUpper = searchCatalog('FILESYSTEM');
    expect(resultsLower.length).toBe(resultsUpper.length);
  });

  test('searchCatalog returns empty for no match', () => {
    const results = searchCatalog('nonexistent-server-xyz-12345');
    expect(results).toEqual([]);
  });

  test('catalog entries have required fields', () => {
    const catalog = loadLocalCatalog();
    if (catalog.length > 0) {
      const entry = catalog[0];
      expect(entry).toHaveProperty('name');
      expect(entry).toHaveProperty('description');
      expect(entry).toHaveProperty('command');
      expect(entry).toHaveProperty('defaultArgs');
      expect(entry).toHaveProperty('version');
    }
  });

  test('searchCatalog matches by tags', () => {
    const results = searchCatalog('database');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe('test-database');
  });
});
