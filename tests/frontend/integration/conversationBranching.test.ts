/**
 * Conversation Branching Integration Tests
 * 
 * Tests the forkConversation, getChildBranches, getConversationBranchInfo,
 * deleteConversation, and memoryController API endpoints.
 * Uses a real in-memory SQLite database (not mocked).
 */

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import http from 'http';
import { ConversationManager } from '../../../src/memory/manager/ConversationManager.js';
import { createMemoryController } from '../../../src/gateway/controllers/memoryController.js';
import type { MemoryManager } from '../../../src/memory/manager.js';
import type { MessageRouter } from '../../../src/router/index.js';
import express from 'express';

// ── Test Database Setup ──────────────────────────────────────────────────────

const EMBEDDING_DIM = 1536;

function createTestDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  sqliteVec.load(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      channel_type TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT DEFAULT '',
      title TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      is_summarized INTEGER DEFAULT 0,
      is_title_custom INTEGER DEFAULT 0,
      message_count INTEGER DEFAULT 0,
      parent_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
      branch_point_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
      display_order TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
      content TEXT NOT NULL DEFAULT '',
      tool_calls TEXT,
      tool_results TEXT,
      attachments TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      content TEXT NOT NULL,
      importance INTEGER DEFAULT 5,
      access_count INTEGER DEFAULT 0,
      is_archived INTEGER DEFAULT 0,
      last_accessed DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      provenance_source TEXT,
      provenance_conversation_id TEXT,
      provenance_message_id INTEGER,
      confidence REAL DEFAULT 0.7,
      review_profile TEXT DEFAULT 'standard',
      memory_type TEXT DEFAULT 'semantic' CHECK(memory_type IN ('episodic', 'semantic')),
      stability REAL DEFAULT 2.0,
      retrievability REAL DEFAULT 1.0,
      next_review_at INTEGER,
      review_count INTEGER DEFAULT 0,
      max_importance INTEGER
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_embeddings USING vec0(
      embedding float[${EMBEDDING_DIM}]
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS message_embeddings USING vec0(
      embedding float[${EMBEDDING_DIM}]
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content, category, content=memories, content_rowid=id
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content, content=messages, content_rowid=id
    );

    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content, category) VALUES (new.id, new.content, new.category);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, category) VALUES('delete', old.id, old.content, old.category);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, category) VALUES('delete', old.id, old.content, old.category);
      INSERT INTO memories_fts(rowid, content, category) VALUES (new.id, new.content, new.category);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
      INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
    END;

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('positive', 'negative')),
      comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      message_id TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      performance_json TEXT NOT NULL,
      cost_json TEXT NOT NULL,
      context_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conv_role_id ON messages(conversation_id, role, id);
    CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
    CREATE INDEX IF NOT EXISTS idx_memories_archived ON memories(is_archived);
    CREATE INDEX IF NOT EXISTS idx_conversations_channel ON conversations(channel_type, channel_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_conversation ON feedback(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_message ON feedback(message_id);
    CREATE INDEX IF NOT EXISTS idx_token_usage_created_at ON token_usage(created_at);
    CREATE INDEX IF NOT EXISTS idx_token_usage_provider ON token_usage(provider);
    CREATE INDEX IF NOT EXISTS idx_metrics_conversation ON metrics(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp);
    CREATE INDEX IF NOT EXISTS idx_metrics_message ON metrics(message_id);
  `);

  return db;
}

function seedConversation(
  db: Database.Database,
  id: string,
  overrides: Record<string, unknown> = {}
): void {
  db.prepare(`
    INSERT INTO conversations (id, channel_type, channel_id, user_id, user_name, title, display_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    (overrides.channel_type as string) || 'web',
    (overrides.channel_id as string) || 'test-channel',
    (overrides.user_id as string) || 'default',
    (overrides.user_name as string) || 'TestUser',
    (overrides.title as string) || 'Test Conversation',
    (overrides.display_order as string) || null
  );
}

function seedMessage(
  db: Database.Database,
  conversationId: string,
  role: string,
  content: string
): number {
  const result = db.prepare(`
    INSERT INTO messages (conversation_id, role, content)
    VALUES (?, ?, ?)
  `).run(conversationId, role, content);
  return Number(result.lastInsertRowid);
}

function seedMessageWithEmbedding(
  db: Database.Database,
  conversationId: string,
  role: string,
  content: string,
  embedding: number[]
): number {
  const msgResult = db.prepare(`
    INSERT INTO messages (conversation_id, role, content)
    VALUES (?, ?, ?)
  `).run(conversationId, role, content);
  const msgId = Number(msgResult.lastInsertRowid);

  const buf = Buffer.from(new Float32Array(embedding).buffer);
  db.prepare(
    `INSERT INTO message_embeddings (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)`
  ).run(BigInt(msgId), buf);

  return msgId;
}

// ── Mock Router for API Controller ───────────────────────────────────────────

function createMockRouter(): MessageRouter {
  return {
    getChannelStatus: jest.fn(() => []),
  } as unknown as MessageRouter;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ConversationManager: forkConversation', () => {
  let db: Database.Database;
  let cm: ConversationManager;

  beforeEach(() => {
    db = createTestDatabase();
    cm = new ConversationManager(db);
  });

  afterEach(() => {
    db.close();
  });

  test('creates a new conversation with correct parent_conversation_id', () => {
    const parentId = 'parent-conv-1';
    seedConversation(db, parentId, { title: 'Parent' });
    const msg1 = seedMessage(db, parentId, 'user', 'Hello');
    const msg2 = seedMessage(db, parentId, 'assistant', 'Hi there');

    const result = cm.forkConversation(parentId, msg2);

    expect(result.conversationId).toBeDefined();
    expect(result.conversationId).not.toBe(parentId);

    const child = db.prepare(
      `SELECT parent_conversation_id FROM conversations WHERE id = ?`
    ).get(result.conversationId) as { parent_conversation_id: string };
    expect(child.parent_conversation_id).toBe(parentId);
  });

  test('copies messages up to forkFromMessageId', () => {
    const parentId = 'parent-conv-2';
    seedConversation(db, parentId);
    const msg1 = seedMessage(db, parentId, 'user', 'Message 1');
    const msg2 = seedMessage(db, parentId, 'assistant', 'Message 2');
    const msg3 = seedMessage(db, parentId, 'user', 'Message 3');

    const result = cm.forkConversation(parentId, msg2);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].content).toBe('Message 1');
    expect(result.messages[1].content).toBe('Message 2');

    const childMsgs = db.prepare(
      `SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?`
    ).get(result.conversationId) as { count: number };
    expect(childMsgs.count).toBe(2);
  });

  test('sets display_order correctly (parent.0001 format)', () => {
    const parentId = 'parent-conv-3';
    seedConversation(db, parentId, { display_order: '0001' });
    const msg1 = seedMessage(db, parentId, 'user', 'Hello');

    const result = cm.forkConversation(parentId, msg1);

    const child = db.prepare(
      `SELECT display_order FROM conversations WHERE id = ?`
    ).get(result.conversationId) as { display_order: string };
    expect(child.display_order).toBe('0001.0001');
  });

  test('copies embeddings from original messages', () => {
    const parentId = 'parent-conv-4';
    seedConversation(db, parentId);
    const embedding = Array.from({ length: EMBEDDING_DIM }, (_, i) => i * 0.001);
    const msg1 = seedMessageWithEmbedding(db, parentId, 'user', 'This is a meaningful message with enough characters for embedding', embedding);

    const result = cm.forkConversation(parentId, msg1);
    const childMsgId = result.messages[0].id;

    const origEmb = db.prepare(
      `SELECT embedding FROM message_embeddings WHERE rowid = CAST(? AS INTEGER)`
    ).get(BigInt(msg1)) as { embedding: Buffer } | undefined;
    const childEmb = db.prepare(
      `SELECT embedding FROM message_embeddings WHERE rowid = CAST(? AS INTEGER)`
    ).get(BigInt(childMsgId)) as { embedding: Buffer } | undefined;

    expect(origEmb).toBeDefined();
    expect(childEmb).toBeDefined();
    if (origEmb && childEmb) {
      expect(childEmb.embedding.equals(origEmb.embedding)).toBe(true);
    }
  });

  test('sets title to empty string', () => {
    const parentId = 'parent-conv-5';
    seedConversation(db, parentId, { title: 'Original Title' });
    const msg1 = seedMessage(db, parentId, 'user', 'Hello');

    const result = cm.forkConversation(parentId, msg1);

    const child = db.prepare(
      `SELECT title FROM conversations WHERE id = ?`
    ).get(result.conversationId) as { title: string };
    expect(child.title).toBe('');
  });

  test('throws when conversation not found', () => {
    expect(() => cm.forkConversation('non-existent', 1)).toThrow(
      'Conversation not found: non-existent'
    );
  });

  test('throws when message not found in conversation', () => {
    const parentId = 'parent-conv-6';
    seedConversation(db, parentId);
    const msg1 = seedMessage(db, parentId, 'user', 'Hello');

    const otherConvId = 'other-conv';
    seedConversation(db, otherConvId);
    const otherMsg = seedMessage(db, otherConvId, 'user', 'Other message');

    expect(() => cm.forkConversation(parentId, otherMsg)).toThrow(
      `Message not found: ${otherMsg}`
    );
  });

  test('multiple forks from same message increment child number correctly', () => {
    const parentId = 'parent-conv-7';
    seedConversation(db, parentId, { display_order: '0005' });
    const msg1 = seedMessage(db, parentId, 'user', 'Hello');

    const fork1 = cm.forkConversation(parentId, msg1);
    const fork2 = cm.forkConversation(parentId, msg1);
    const fork3 = cm.forkConversation(parentId, msg1);

    const orders = [fork1, fork2, fork3].map(f => {
      const row = db.prepare(
        `SELECT display_order FROM conversations WHERE id = ?`
      ).get(f.conversationId) as { display_order: string };
      return row.display_order;
    });

    expect(orders).toContain('0005.0001');
    expect(orders).toContain('0005.0002');
    expect(orders).toContain('0005.0003');
  });

  test('forking from a branch (nested fork) creates correct hierarchical display_order', () => {
    const rootId = 'root-conv';
    seedConversation(db, rootId, { display_order: '0001' });
    const rootMsg = seedMessage(db, rootId, 'user', 'Root message');

    const branch1 = cm.forkConversation(rootId, rootMsg);

    const branch1Msg = seedMessage(db, branch1.conversationId, 'user', 'Branch 1 message');

    const nestedFork = cm.forkConversation(branch1.conversationId, branch1Msg);

    const nestedOrder = db.prepare(
      `SELECT display_order FROM conversations WHERE id = ?`
    ).get(nestedFork.conversationId) as { display_order: string };

    expect(nestedOrder.display_order).toBe('0001.0001.0001');
  });

  test('copies channel_type, channel_id, user_id, user_name from parent', () => {
    const parentId = 'parent-conv-8';
    seedConversation(db, parentId, {
      channel_type: 'discord',
      channel_id: 'discord-ch-1',
      user_id: 'user-123',
      user_name: 'Alice',
    });
    const msg1 = seedMessage(db, parentId, 'user', 'Hello');

    const result = cm.forkConversation(parentId, msg1);

    const child = db.prepare(
      `SELECT channel_type, channel_id, user_id, user_name FROM conversations WHERE id = ?`
    ).get(result.conversationId) as {
      channel_type: string;
      channel_id: string;
      user_id: string;
      user_name: string;
    };
    expect(child.channel_type).toBe('discord');
    expect(child.channel_id).toBe('discord-ch-1');
    expect(child.user_id).toBe('user-123');
    expect(child.user_name).toBe('Alice');
  });

  test('fork from first message only copies that single message', () => {
    const parentId = 'parent-conv-9';
    seedConversation(db, parentId);
    const msg1 = seedMessage(db, parentId, 'user', 'First');
    seedMessage(db, parentId, 'assistant', 'Second');
    seedMessage(db, parentId, 'user', 'Third');

    const result = cm.forkConversation(parentId, msg1);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('First');
  });
});

describe('ConversationManager: getChildBranches', () => {
  let db: Database.Database;
  let cm: ConversationManager;

  beforeEach(() => {
    db = createTestDatabase();
    cm = new ConversationManager(db);
  });

  afterEach(() => {
    db.close();
  });

  test('returns empty array when no branches exist', () => {
    const convId = 'conv-no-branches';
    seedConversation(db, convId);

    const branches = cm.getChildBranches(convId);
    expect(branches).toEqual([]);
  });

  test('returns correct branches when branches exist', () => {
    const parentId = 'parent-with-branches';
    seedConversation(db, parentId, { display_order: '0010' });
    const msg1 = seedMessage(db, parentId, 'user', 'Hello');

    const fork1 = cm.forkConversation(parentId, msg1);
    const fork2 = cm.forkConversation(parentId, msg1);

    const branches = cm.getChildBranches(parentId);
    expect(branches).toHaveLength(2);

    const branchIds = branches.map(b => b.id);
    expect(branchIds).toContain(fork1.conversationId);
    expect(branchIds).toContain(fork2.conversationId);
  });

  test('orders branches by display_order', () => {
    const parentId = 'parent-order-test';
    seedConversation(db, parentId, { display_order: '0020' });
    const msg1 = seedMessage(db, parentId, 'user', 'Hello');

    const fork1 = cm.forkConversation(parentId, msg1);
    const fork2 = cm.forkConversation(parentId, msg1);
    const fork3 = cm.forkConversation(parentId, msg1);

    const branches = cm.getChildBranches(parentId);
    expect(branches).toHaveLength(3);
    expect(branches[0].display_order).toBe('0020.0001');
    expect(branches[1].display_order).toBe('0020.0002');
    expect(branches[2].display_order).toBe('0020.0003');
  });

  test('branch info includes branch_point_message_id', () => {
    const parentId = 'parent-bp-test';
    seedConversation(db, parentId, { display_order: '0030' });
    const msg1 = seedMessage(db, parentId, 'user', 'Hello');
    const msg2 = seedMessage(db, parentId, 'assistant', 'Hi');

    const fork = cm.forkConversation(parentId, msg2);

    const branches = cm.getChildBranches(parentId);
    expect(branches).toHaveLength(1);
    expect(branches[0].branch_point_message_id).toBe(msg2);
  });
});

describe('ConversationManager: getConversationBranchInfo', () => {
  let db: Database.Database;
  let cm: ConversationManager;

  beforeEach(() => {
    db = createTestDatabase();
    cm = new ConversationManager(db);
  });

  afterEach(() => {
    db.close();
  });

  test('returns isBranch=false, hasChildren=false for root conversation with no children', () => {
    const convId = 'root-no-children';
    seedConversation(db, convId);

    const info = cm.getConversationBranchInfo(convId);
    expect(info.isBranch).toBe(false);
    expect(info.hasChildren).toBe(false);
    expect(info.parentConversationId).toBeNull();
    expect(info.branchPointMessageId).toBeNull();
  });

  test('returns isBranch=true, parentConversationId set for a branch', () => {
    const parentId = 'parent-for-info';
    seedConversation(db, parentId, { display_order: '0040' });
    const msg1 = seedMessage(db, parentId, 'user', 'Hello');

    const fork = cm.forkConversation(parentId, msg1);

    const info = cm.getConversationBranchInfo(fork.conversationId);
    expect(info.isBranch).toBe(true);
    expect(info.parentConversationId).toBe(parentId);
    expect(info.branchPointMessageId).toBe(msg1);
  });

  test('returns hasChildren=true when conversation has child branches', () => {
    const parentId = 'parent-with-children';
    seedConversation(db, parentId, { display_order: '0050' });
    const msg1 = seedMessage(db, parentId, 'user', 'Hello');

    cm.forkConversation(parentId, msg1);

    const info = cm.getConversationBranchInfo(parentId);
    expect(info.hasChildren).toBe(true);
    expect(info.isBranch).toBe(false);
  });

  test('returns isBranch=true and hasChildren=true for a branch that was further forked', () => {
    const rootId = 'root-nested';
    seedConversation(db, rootId, { display_order: '0060' });
    const rootMsg = seedMessage(db, rootId, 'user', 'Root');

    const branch = cm.forkConversation(rootId, rootMsg);
    const branchMsg = seedMessage(db, branch.conversationId, 'user', 'Branch msg');
    cm.forkConversation(branch.conversationId, branchMsg);

    const info = cm.getConversationBranchInfo(branch.conversationId);
    expect(info.isBranch).toBe(true);
    expect(info.hasChildren).toBe(true);
    expect(info.parentConversationId).toBe(rootId);
  });

  test('throws when conversation not found', () => {
    expect(() => cm.getConversationBranchInfo('non-existent')).toThrow(
      'Conversation not found: non-existent'
    );
  });
});

describe('ConversationManager: deleteConversation', () => {
  let db: Database.Database;
  let cm: ConversationManager;

  beforeEach(() => {
    db = createTestDatabase();
    cm = new ConversationManager(db);
  });

  afterEach(() => {
    db.close();
  });

  test('deleteBranches=true recursively deletes all child branches', () => {
    const parentId = 'parent-delete-all';
    seedConversation(db, parentId, { display_order: '0070' });
    const msg1 = seedMessage(db, parentId, 'user', 'Hello');

    const fork1 = cm.forkConversation(parentId, msg1);
    const fork2 = cm.forkConversation(parentId, msg1);

    const fork1Msg = seedMessage(db, fork1.conversationId, 'user', 'Fork 1 msg');
    cm.forkConversation(fork1.conversationId, fork1Msg);

    const result = cm.deleteConversation(parentId, true);
    expect(result).toBe(true);

    const parentExists = db.prepare(
      `SELECT COUNT(*) as count FROM conversations WHERE id = ?`
    ).get(parentId) as { count: number };
    expect(parentExists.count).toBe(0);

    const fork1Exists = db.prepare(
      `SELECT COUNT(*) as count FROM conversations WHERE id = ?`
    ).get(fork1.conversationId) as { count: number };
    expect(fork1Exists.count).toBe(0);

    const fork2Exists = db.prepare(
      `SELECT COUNT(*) as count FROM conversations WHERE id = ?`
    ).get(fork2.conversationId) as { count: number };
    expect(fork2Exists.count).toBe(0);
  });

  test('deleteBranches=false orphans children (sets parent_conversation_id=NULL)', () => {
    const parentId = 'parent-orphan';
    seedConversation(db, parentId, { display_order: '0080' });
    const msg1 = seedMessage(db, parentId, 'user', 'Hello');

    const fork1 = cm.forkConversation(parentId, msg1);
    const fork2 = cm.forkConversation(parentId, msg1);

    const result = cm.deleteConversation(parentId, false);
    expect(result).toBe(true);

    const fork1Row = db.prepare(
      `SELECT parent_conversation_id FROM conversations WHERE id = ?`
    ).get(fork1.conversationId) as { parent_conversation_id: string | null };
    expect(fork1Row.parent_conversation_id).toBeNull();

    const fork2Row = db.prepare(
      `SELECT parent_conversation_id FROM conversations WHERE id = ?`
    ).get(fork2.conversationId) as { parent_conversation_id: string | null };
    expect(fork2Row.parent_conversation_id).toBeNull();

    const parentExists = db.prepare(
      `SELECT COUNT(*) as count FROM conversations WHERE id = ?`
    ).get(parentId) as { count: number };
    expect(parentExists.count).toBe(0);
  });

  test('works correctly when conversation has no children', () => {
    const convId = 'conv-no-children-delete';
    seedConversation(db, convId);
    seedMessage(db, convId, 'user', 'Hello');

    const result = cm.deleteConversation(convId, false);
    expect(result).toBe(true);

    const exists = db.prepare(
      `SELECT COUNT(*) as count FROM conversations WHERE id = ?`
    ).get(convId) as { count: number };
    expect(exists.count).toBe(0);
  });

  test('returns false when conversation does not exist', () => {
    const result = cm.deleteConversation('non-existent', false);
    expect(result).toBe(false);
  });

  test('deletes messages associated with the conversation', () => {
    const convId = 'conv-delete-msgs';
    seedConversation(db, convId);
    seedMessage(db, convId, 'user', 'Msg 1');
    seedMessage(db, convId, 'assistant', 'Msg 2');

    cm.deleteConversation(convId, false);

    const msgCount = db.prepare(
      `SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?`
    ).get(convId) as { count: number };
    expect(msgCount.count).toBe(0);
  });

  test('deep nested delete with deleteBranches=true removes all descendants', () => {
    const rootId = 'root-deep-delete';
    seedConversation(db, rootId, { display_order: '0090' });
    const rootMsg = seedMessage(db, rootId, 'user', 'Root');

    const branch1 = cm.forkConversation(rootId, rootMsg);
    const branch1Msg = seedMessage(db, branch1.conversationId, 'user', 'B1');
    const branch2 = cm.forkConversation(branch1.conversationId, branch1Msg);

    const branch2Msg = seedMessage(db, branch2.conversationId, 'user', 'B2');
    const branch3 = cm.forkConversation(branch2.conversationId, branch2Msg);

    const result = cm.deleteConversation(rootId, true);
    expect(result).toBe(true);

    const allConvs = db.prepare(
      `SELECT COUNT(*) as count FROM conversations`
    ).get() as { count: number };
    expect(allConvs.count).toBe(0);
  });
});

describe('memoryController API endpoints', () => {
  let db: Database.Database;
  let cm: ConversationManager;
  let server: http.Server;
  let baseUrl: string;

  function createMockMemoryManager(): MemoryManager {
    return {
      getRecentConversations: () => [],
      getConversationHistory: (id: string, limit?: number) =>
        cm.getConversationHistory(id, limit),
      forkConversation: (id: string, msgId: number) =>
        cm.forkConversation(id, msgId),
      getChildBranches: (id: string) => cm.getChildBranches(id),
      getConversationBranchInfo: (id: string) => {
        try {
          return cm.getConversationBranchInfo(id);
        } catch {
          throw new Error(`Conversation not found: ${id}`);
        }
      },
      deleteConversation: (id: string, deleteBranches?: boolean) =>
        cm.deleteConversation(id, deleteBranches),
      getDatabase: () => db,
      getStats: () => ({ conversations: 0, messages: 0, memories: 0 }),
      updateConversationTitle: () => {},
      deleteConversations: () => ({ deletedCount: 0, results: [] }),
      getSensitivePaths: () => [],
      setSensitivePaths: () => {},
      getSetting: () => null,
      setSetting: () => {},
    } as unknown as MemoryManager;
  }

  async function apiGet(path: string): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      http.get(url.toString(), (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: data });
          }
        });
      }).on('error', reject);
    });
  }

  async function apiPost(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
    const payload = JSON.stringify(body);
    const url = new URL(path, baseUrl);
    return new Promise((resolve, reject) => {
      const req = http.request(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: data });
          }
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  async function apiDelete(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
    const payload = JSON.stringify(body);
    const url = new URL(path, baseUrl);
    return new Promise((resolve, reject) => {
      const req = http.request(url.toString(), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: data });
          }
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  beforeEach(() => {
    db = createTestDatabase();
    cm = new ConversationManager(db);

    const mockMemory = createMockMemoryManager();
    const mockRouter = createMockRouter();
    const broadcastStats = jest.fn();

    const app = express();
    app.use(express.json());
    app.use('/api', createMemoryController(mockMemory, mockRouter, broadcastStats));

    server = app.listen(0);
    const address = server.address() as import('net').AddressInfo;
    baseUrl = `http://localhost:${address.port}`;
  });

  afterEach(() => {
    server.close();
    db.close();
  });

  describe('POST /api/conversations/:id/fork', () => {
    test('returns 200 with conversationId and messages', async () => {
      const parentId = 'api-fork-parent';
      seedConversation(db, parentId);
      const msg1 = seedMessage(db, parentId, 'user', 'Hello');
      const msg2 = seedMessage(db, parentId, 'assistant', 'Hi');

      const res = await apiPost(`/api/conversations/${parentId}/fork`, { forkFromMessageId: msg2 });

      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)).toHaveProperty('conversationId');
      expect((res.body as Record<string, unknown>)).toHaveProperty('messages');
      expect(Array.isArray((res.body as Record<string, unknown>).messages)).toBe(true);
      expect((res.body as Record<string, unknown>).messages).toHaveLength(2);
    });

    test('returns 400 when forkFromMessageId missing', async () => {
      const res = await apiPost('/api/conversations/some-id/fork', {});

      expect(res.status).toBe(400);
      expect((res.body as Record<string, unknown>)).toHaveProperty('error');
    });

    test('returns 400 when forkFromMessageId is not a number', async () => {
      const res = await apiPost('/api/conversations/some-id/fork', { forkFromMessageId: 'not-a-number' });

      expect(res.status).toBe(400);
    });

    test('returns 404 when conversation not found', async () => {
      const res = await apiPost('/api/conversations/non-existent/fork', { forkFromMessageId: 1 });

      expect(res.status).toBe(404);
      expect((res.body as Record<string, unknown>)).toHaveProperty('error');
    });
  });

  describe('GET /api/conversations/:id/branches', () => {
    test('returns 200 with branch list', async () => {
      const parentId = 'api-branches-parent';
      seedConversation(db, parentId, { display_order: '0100' });
      const msg1 = seedMessage(db, parentId, 'user', 'Hello');
      cm.forkConversation(parentId, msg1);
      cm.forkConversation(parentId, msg1);

      const res = await apiGet(`/api/conversations/${parentId}/branches`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect((res.body as unknown[])).toHaveLength(2);
    });

    test('returns empty array when no branches', async () => {
      const convId = 'api-no-branches';
      seedConversation(db, convId);

      const res = await apiGet(`/api/conversations/${convId}/branches`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('GET /api/conversations/:id/branch-info', () => {
    test('returns 200 with branch info for root conversation', async () => {
      const convId = 'api-branch-info-root';
      seedConversation(db, convId);

      const res = await apiGet(`/api/conversations/${convId}/branch-info`);

      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)).toHaveProperty('isBranch');
      expect((res.body as Record<string, unknown>)).toHaveProperty('hasChildren');
      expect((res.body as Record<string, unknown>).isBranch).toBe(false);
      expect((res.body as Record<string, unknown>).hasChildren).toBe(false);
    });

    test('returns 200 with branch info for a branch', async () => {
      const parentId = 'api-branch-info-parent';
      seedConversation(db, parentId, { display_order: '0110' });
      const msg1 = seedMessage(db, parentId, 'user', 'Hello');
      const fork = cm.forkConversation(parentId, msg1);

      const res = await apiGet(`/api/conversations/${fork.conversationId}/branch-info`);

      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>).isBranch).toBe(true);
      expect((res.body as Record<string, unknown>).parentConversationId).toBe(parentId);
    });

    test('returns 200 with hasChildren=true when conversation has children', async () => {
      const parentId = 'api-branch-info-children';
      seedConversation(db, parentId, { display_order: '0120' });
      const msg1 = seedMessage(db, parentId, 'user', 'Hello');
      cm.forkConversation(parentId, msg1);

      const res = await apiGet(`/api/conversations/${parentId}/branch-info`);

      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>).hasChildren).toBe(true);
    });

    test('returns 404 when conversation not found', async () => {
      const res = await apiGet('/api/conversations/non-existent/branch-info');

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/conversations/:id', () => {
    test('returns 409 when has children and deleteBranches not set', async () => {
      const parentId = 'api-delete-409';
      seedConversation(db, parentId, { display_order: '0130' });
      const msg1 = seedMessage(db, parentId, 'user', 'Hello');
      cm.forkConversation(parentId, msg1);

      const res = await apiDelete(`/api/conversations/${parentId}`, {});

      expect(res.status).toBe(409);
      expect((res.body as Record<string, unknown>)).toHaveProperty('error');
      expect((res.body as Record<string, unknown>).hasChildren).toBe(true);
      expect((res.body as Record<string, unknown>)).toHaveProperty('branches');
    });

    test('returns 200 when deleteBranches=true with children', async () => {
      const parentId = 'api-delete-200-children';
      seedConversation(db, parentId, { display_order: '0140' });
      const msg1 = seedMessage(db, parentId, 'user', 'Hello');
      cm.forkConversation(parentId, msg1);

      const res = await apiDelete(`/api/conversations/${parentId}`, { deleteBranches: true });

      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>).success).toBe(true);
    });

    test('returns 200 when deleting conversation with no children', async () => {
      const convId = 'api-delete-no-children';
      seedConversation(db, convId);
      seedMessage(db, convId, 'user', 'Hello');

      const res = await apiDelete(`/api/conversations/${convId}`, {});

      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>).success).toBe(true);
    });

    test('returns 404 when conversation not found (getConversationBranchInfo throws)', async () => {
      const res = await apiDelete('/api/conversations/non-existent', { deleteBranches: true });

      expect(res.status).toBe(404);
    });
  });
});
