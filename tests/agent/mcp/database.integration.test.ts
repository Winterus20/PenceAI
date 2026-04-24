/**
 * Database Persistence — Integration Tests
 * 
 * Tests MCP server CRUD operations with in-memory SQLite.
 */
import Database from 'better-sqlite3';
import { sampleServerConfig } from './fixtures/integrationFixtures.js';

// Mock mcpService database functions
function createTestDB(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE mcp_servers (
      name TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      command TEXT NOT NULL,
      args TEXT NOT NULL DEFAULT '[]',
      env TEXT NOT NULL DEFAULT '{}',
      cwd TEXT,
      timeout INTEGER NOT NULL DEFAULT 30000,
      status TEXT NOT NULL DEFAULT 'inactive',
      version TEXT NOT NULL DEFAULT '1.0.0',
      source TEXT NOT NULL DEFAULT 'manual',
      source_url TEXT,
      installed_at TEXT,
      last_activated TEXT,
      last_error TEXT,
      tool_count INTEGER DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}'
    )
  `);
  return db;
}

describe('Database Integration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDB();
  });

  afterEach(() => {
    db.close();
  });

  test('insert and retrieve server', () => {
    const stmt = db.prepare(`
      INSERT INTO mcp_servers (name, command, args, env, timeout, source, version, installed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const now = new Date().toISOString();
    stmt.run(
      sampleServerConfig.name,
      sampleServerConfig.command,
      JSON.stringify(sampleServerConfig.args),
      JSON.stringify(sampleServerConfig.env),
      sampleServerConfig.timeout,
      'manual',
      '1.0.0',
      now
    );
    
    const row = db.prepare('SELECT * FROM mcp_servers WHERE name = ?').get(sampleServerConfig.name) as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.name).toBe(sampleServerConfig.name);
    expect(row.command).toBe(sampleServerConfig.command);
  });

  test('update server status', () => {
    // Insert first
    db.prepare(`
      INSERT INTO mcp_servers (name, command, args, env, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(sampleServerConfig.name, sampleServerConfig.command, '[]', '{}', 'inactive');
    
    // Update status
    db.prepare('UPDATE mcp_servers SET status = ?, last_activated = ? WHERE name = ?')
      .run('active', new Date().toISOString(), sampleServerConfig.name);
    
    const row = db.prepare('SELECT * FROM mcp_servers WHERE name = ?').get(sampleServerConfig.name) as Record<string, unknown>;
    expect(row.status).toBe('active');
  });

  test('delete server', () => {
    // Insert first
    db.prepare(`
      INSERT INTO mcp_servers (name, command, args, env)
      VALUES (?, ?, ?, ?)
    `).run(sampleServerConfig.name, sampleServerConfig.command, '[]', '{}');
    
    // Delete
    db.prepare('DELETE FROM mcp_servers WHERE name = ?').run(sampleServerConfig.name);
    
    const row = db.prepare('SELECT * FROM mcp_servers WHERE name = ?').get(sampleServerConfig.name) as Record<string, unknown> | undefined;
    expect(row).toBeUndefined();
  });

  test('list all servers', () => {
    // Insert multiple servers
    db.prepare(`
      INSERT INTO mcp_servers (name, command, args, env)
      VALUES (?, ?, ?, ?)
    `).run('server-1', 'npx', '[]', '{}');
    
    db.prepare(`
      INSERT INTO mcp_servers (name, command, args, env)
      VALUES (?, ?, ?, ?)
    `).run('server-2', 'node', '[]', '{}');
    
    const rows = db.prepare('SELECT * FROM mcp_servers').all() as Array<Record<string, unknown>>;
    expect(rows.length).toBe(2);
    expect(rows.map((r: Record<string, unknown>) => r.name)).toContain('server-1');
    expect(rows.map((r: Record<string, unknown>) => r.name)).toContain('server-2');
  });

  test('server with default values', () => {
    db.prepare(`
      INSERT INTO mcp_servers (name, command)
      VALUES (?, ?)
    `).run('default-server', 'npx');
    
    const row = db.prepare('SELECT * FROM mcp_servers WHERE name = ?').get('default-server') as Record<string, unknown>;
    expect(row.status).toBe('inactive');
    expect(row.version).toBe('1.0.0');
    expect(row.source).toBe('manual');
    expect(row.timeout).toBe(30000);
    expect(row.tool_count).toBe(0);
  });

  test('update tool count', () => {
    db.prepare(`
      INSERT INTO mcp_servers (name, command)
      VALUES (?, ?)
    `).run('tool-server', 'npx');
    
    db.prepare('UPDATE mcp_servers SET tool_count = ? WHERE name = ?')
      .run(5, 'tool-server');
    
    const row = db.prepare('SELECT * FROM mcp_servers WHERE name = ?').get('tool-server') as Record<string, unknown>;
    expect(row.tool_count).toBe(5);
  });
});
