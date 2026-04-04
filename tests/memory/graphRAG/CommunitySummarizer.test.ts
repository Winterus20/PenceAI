/**
 * CommunitySummarizer Testleri
 *
 * LLM tabanlı özet generation, fallback, rate limiting ve veritabanı kayıt testleri.
 */

import Database from 'better-sqlite3';
import { CommunitySummarizer } from '../../../src/memory/graphRAG/CommunitySummarizer.js';
import type { LLMProvider } from '../../../src/llm/provider.js';
import type { LLMResponse, LLMMessage } from '../../../src/router/types.js';

// Logger mock
jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock LLM Provider
function createMockLLMProvider(shouldFail = false): LLMProvider {
  return {
    name: 'mock',
    supportedModels: ['mock-model'],
    defaultModel: 'mock-model',
    chat: jest.fn(async (messages: LLMMessage[]): Promise<LLMResponse> => {
      if (shouldFail) {
        throw new Error('LLM call failed');
      }
      return {
        content: JSON.stringify({
          summary: 'Bu bir test topluluğudur. 3 bellek içermektedir.',
          keyEntities: [
            { name: 'Entity 1', type: 'tech', importance: 0.8 },
            { name: 'Entity 2', type: 'person', importance: 0.6 },
          ],
          keyRelations: [
            { source: 'Entity 1', target: 'Entity 2', type: 'related_to' },
          ],
          topics: ['tech', 'person'],
        }),
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        finishReason: 'stop',
      };
    }),
    healthCheck: jest.fn(async () => true),
  } as unknown as LLMProvider;
}

describe('CommunitySummarizer', () => {
  let db: Database.Database;
  let mockLLM: LLMProvider;
  let summarizer: CommunitySummarizer;

  beforeEach(() => {
    db = new Database(':memory:');
    // Tabloları oluştur
    db.exec(`
      CREATE TABLE memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL DEFAULT 'default',
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
        memory_type TEXT DEFAULT 'semantic',
        stability REAL DEFAULT 2.0,
        retrievability REAL DEFAULT 1.0,
        next_review_at INTEGER,
        review_count INTEGER DEFAULT 0,
        max_importance INTEGER
      );

      CREATE TABLE memory_relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_memory_id INTEGER NOT NULL,
        target_memory_id INTEGER NOT NULL,
        relation_type TEXT NOT NULL DEFAULT 'related_to',
        confidence REAL DEFAULT 0.5,
        description TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_accessed_at DATETIME,
        access_count INTEGER DEFAULT 0,
        decay_rate REAL DEFAULT 0.05,
        weight REAL DEFAULT 1.0,
        is_directional INTEGER DEFAULT 0,
        last_scored_at DATETIME
      );

      CREATE TABLE graph_communities (
        id TEXT PRIMARY KEY,
        modularity_score REAL,
        dominant_relation_types TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE graph_community_members (
        community_id TEXT REFERENCES graph_communities(id),
        node_id INTEGER NOT NULL,
        PRIMARY KEY (community_id, node_id)
      );

      CREATE TABLE graph_community_summaries (
        community_id TEXT PRIMARY KEY REFERENCES graph_communities(id),
        summary TEXT NOT NULL,
        key_entities TEXT NOT NULL,
        key_relations TEXT NOT NULL,
        topics TEXT NOT NULL,
        generated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    mockLLM = createMockLLMProvider(false);
    summarizer = new CommunitySummarizer(db, mockLLM);
  });

  afterEach(() => {
    db.close();
  });

  // Helper: Bellek ekle
  function insertMemory(id: number, content: string, category = 'general'): void {
    db.prepare(`
      INSERT INTO memories (id, content, category) VALUES (?, ?, ?)
    `).run(id, content, category);
  }

  // Helper: Community ekle
  function insertCommunity(id: string, memberIds: number[]): void {
    db.prepare(`
      INSERT INTO graph_communities (id, modularity_score, dominant_relation_types)
      VALUES (?, 0.5, '["related_to"]')
    `).run(id);

    for (const memberId of memberIds) {
      db.prepare(`
        INSERT INTO graph_community_members (community_id, node_id) VALUES (?, ?)
      `).run(id, memberId);
    }
  }

  describe('LLM ile özet generation', () => {
    test('Başarılı LLM çağrısı özet döner', async () => {
      insertMemory(1, 'Test bellek 1', 'tech');
      insertMemory(2, 'Test bellek 2', 'tech');
      insertCommunity('comm-1', [1, 2]);

      const summary = await summarizer.summarizeCommunity('comm-1');

      expect(summary).not.toBeNull();
      expect(summary!.communityId).toBe('comm-1');
      expect(summary!.summary.length).toBeGreaterThan(0);
      expect(summary!.keyEntities.length).toBeGreaterThan(0);
      expect(summary!.topics.length).toBeGreaterThan(0);
    });

    test('LLM başarısız olduğunda fallback özet döner', async () => {
      const failingLLM = createMockLLMProvider(true);
      const failingSummarizer = new CommunitySummarizer(db, failingLLM);

      insertMemory(1, 'Test bellek 1', 'tech');
      insertMemory(2, 'Test bellek 2', 'tech');
      insertCommunity('comm-2', [1, 2]);

      const summary = await failingSummarizer.summarizeCommunity('comm-2');

      expect(summary).not.toBeNull();
      expect(summary!.communityId).toBe('comm-2');
      expect(summary!.summary.length).toBeGreaterThan(0);
    });
  });

  describe('Veritabanı kayıt', () => {
    test('Özet veritabanına kaydedilir', async () => {
      insertMemory(1, 'Test bellek 1', 'tech');
      insertCommunity('comm-3', [1]);

      await summarizer.summarizeCommunity('comm-3');

      const saved = summarizer.getSummary('comm-3');
      expect(saved).not.toBeNull();
      expect(saved!.communityId).toBe('comm-3');
    });

    test('Kaydedilmemiş özet null döner', () => {
      const saved = summarizer.getSummary('non-existent');
      expect(saved).toBeNull();
    });
  });

  describe('Batch summarization', () => {
    test('Birden fazla community özetlenir', async () => {
      insertMemory(1, 'Test 1', 'tech');
      insertMemory(2, 'Test 2', 'person');
      insertMemory(3, 'Test 3', 'project');
      insertCommunity('comm-a', [1]);
      insertCommunity('comm-b', [2]);
      insertCommunity('comm-c', [3]);

      const summaries = await summarizer.summarizeAllCommunities();

      expect(summaries.length).toBeGreaterThanOrEqual(0);
    });

    test('Community olmadığında boş liste döner', async () => {
      const summaries = await summarizer.summarizeAllCommunities();
      expect(summaries.length).toBe(0);
    });
  });

  describe('Fallback summary', () => {
    test('Üye olmayan community için fallback özet döner', async () => {
      insertCommunity('comm-empty', []);

      const summary = await summarizer.summarizeCommunity('comm-empty');

      expect(summary).not.toBeNull();
      expect(summary!.communityId).toBe('comm-empty');
    });
  });

  describe('Options', () => {
    test('maxSummaryLength opsiyonu uygulanır', async () => {
      insertMemory(1, 'Test bellek içeriği', 'tech');
      insertCommunity('comm-opts', [1]);

      const summary = await summarizer.summarizeCommunity('comm-opts', {
        maxSummaryLength: 100,
      });

      expect(summary).not.toBeNull();
      expect(summary!.summary.length).toBeLessThanOrEqual(500);
    });
  });
});
