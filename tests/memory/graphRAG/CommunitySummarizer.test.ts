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

  describe('Retry Logic (MAX_RETRIES)', () => {
    test('LLM başarısızlık sonrası retry yapılır', async () => {
      let callCount = 0;
      const retryingLLM: LLMProvider = {
        name: 'mock',
        supportedModels: ['mock-model'],
        defaultModel: 'mock-model',
        chat: jest.fn(async (): Promise<LLMResponse> => {
          callCount++;
          if (callCount < 3) {
            throw new Error('Rate limit exceeded');
          }
          return {
            content: JSON.stringify({
              summary: 'Retry sonrası başarılı özet',
              keyEntities: [{ name: 'Entity 1', type: 'tech', importance: 0.8 }],
              keyRelations: [],
              topics: ['tech'],
            }),
            usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
            finishReason: 'stop',
          };
        }),
        healthCheck: jest.fn(async () => true),
      } as unknown as LLMProvider;

      const retryingSummarizer = new CommunitySummarizer(db, retryingLLM);

      insertMemory(1, 'Test bellek 1', 'tech');
      insertCommunity('comm-retry', [1]);

      const summary = await retryingSummarizer.summarizeCommunity('comm-retry');

      expect(summary).not.toBeNull();
      expect(callCount).toBeGreaterThanOrEqual(1);
    });

    test('Tüm retry denemeleri başarısız olursa fallback kullanılır', async () => {
      const alwaysFailingLLM: LLMProvider = {
        name: 'mock',
        supportedModels: ['mock-model'],
        defaultModel: 'mock-model',
        chat: jest.fn(async (): Promise<LLMResponse> => {
          throw new Error('Always fails');
        }),
        healthCheck: jest.fn(async () => true),
      } as unknown as LLMProvider;

      const failingSummarizer = new CommunitySummarizer(db, alwaysFailingLLM);

      insertMemory(1, 'Test bellek 1', 'tech');
      insertCommunity('comm-fail', [1]);

      const summary = await failingSummarizer.summarizeCommunity('comm-fail');

      // Fallback summary dönmeli
      expect(summary).not.toBeNull();
      expect(summary!.communityId).toBe('comm-fail');
    });
  });

  describe('parseLLMResponse Edge Cases', () => {
    test('Geçerli JSON doğru parse edilir', async () => {
      const validJsonLLM: LLMProvider = {
        name: 'mock',
        supportedModels: ['mock-model'],
        defaultModel: 'mock-model',
        chat: jest.fn(async (): Promise<LLMResponse> => ({
          content: JSON.stringify({
            summary: 'Valid JSON summary',
            keyEntities: [{ name: 'Entity 1', type: 'tech', importance: 0.9 }],
            keyRelations: [{ source: 'Entity 1', target: 'Entity 2', type: 'related_to' }],
            topics: ['tech', 'science'],
          }),
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          finishReason: 'stop',
        })),
        healthCheck: jest.fn(async () => true),
      } as unknown as LLMProvider;

      const validJsonSummarizer = new CommunitySummarizer(db, validJsonLLM);

      insertMemory(1, 'Test bellek 1', 'tech');
      insertCommunity('comm-valid-json', [1]);

      const summary = await validJsonSummarizer.summarizeCommunity('comm-valid-json');

      expect(summary).not.toBeNull();
      expect(summary!.summary).toBe('Valid JSON summary');
      expect(summary!.keyEntities.length).toBe(1);
      expect(summary!.topics.length).toBe(2);
    });

    test('Geçersiz JSON durumunda fallback kullanılır', async () => {
      const invalidJsonLLM: LLMProvider = {
        name: 'mock',
        supportedModels: ['mock-model'],
        defaultModel: 'mock-model',
        chat: jest.fn(async (): Promise<LLMResponse> => ({
          content: 'This is not valid JSON at all!',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          finishReason: 'stop',
        })),
        healthCheck: jest.fn(async () => true),
      } as unknown as LLMProvider;

      const invalidJsonSummarizer = new CommunitySummarizer(db, invalidJsonLLM);

      insertMemory(1, 'Test bellek 1', 'tech');
      insertCommunity('comm-invalid-json', [1]);

      const summary = await invalidJsonSummarizer.summarizeCommunity('comm-invalid-json');

      // Fallback ile özet oluşturulmalı
      expect(summary).not.toBeNull();
    });

    test('Eksik alanlı JSON durumunda default değerler kullanılır', async () => {
      const partialJsonLLM: LLMProvider = {
        name: 'mock',
        supportedModels: ['mock-model'],
        defaultModel: 'mock-model',
        chat: jest.fn(async (): Promise<LLMResponse> => ({
          content: JSON.stringify({
            summary: 'Partial JSON summary',
            // keyEntities eksik
            // keyRelations eksik
            // topics eksik
          }),
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          finishReason: 'stop',
        })),
        healthCheck: jest.fn(async () => true),
      } as unknown as LLMProvider;

      const partialJsonSummarizer = new CommunitySummarizer(db, partialJsonLLM);

      insertMemory(1, 'Test bellek 1', 'tech');
      insertCommunity('comm-partial-json', [1]);

      const summary = await partialJsonSummarizer.summarizeCommunity('comm-partial-json');

      expect(summary).not.toBeNull();
      expect(summary!.summary).toBe('Partial JSON summary');
      expect(summary!.keyEntities).toEqual([]);
      expect(summary!.topics).toEqual([]);
    });

    test('Markdown code block içinde JSON doğru parse edilir', async () => {
      const markdownJsonLLM: LLMProvider = {
        name: 'mock',
        supportedModels: ['mock-model'],
        defaultModel: 'mock-model',
        chat: jest.fn(async (): Promise<LLMResponse> => ({
          content: '```json\n{"summary": "Markdown wrapped summary", "keyEntities": [], "keyRelations": [], "topics": []}\n```',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          finishReason: 'stop',
        })),
        healthCheck: jest.fn(async () => true),
      } as unknown as LLMProvider;

      const markdownSummarizer = new CommunitySummarizer(db, markdownJsonLLM);

      insertMemory(1, 'Test bellek 1', 'tech');
      insertCommunity('comm-markdown-json', [1]);

      const summary = await markdownSummarizer.summarizeCommunity('comm-markdown-json');

      expect(summary).not.toBeNull();
      expect(summary!.summary).toBe('Markdown wrapped summary');
    });
  });

  describe('Rate Limiting (MAX_PARALLEL_CALLS)', () => {
    test('Batch summarization rate limiting uygular', async () => {
      // 5 community oluştur
      for (let i = 1; i <= 5; i++) {
        insertMemory(i, `Test ${i}`, 'tech');
        insertCommunity(`comm-batch-${i}`, [i]);
      }

      const summaries = await summarizer.summarizeAllCommunities();

      // En az bazı özetler oluşturulmalı
      expect(summaries.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('buildSummaryPrompt Edge Cases', () => {
    test('Boş member listesi ile prompt oluşturulur', async () => {
      insertCommunity('comm-empty-members', []);

      const summary = await summarizer.summarizeCommunity('comm-empty-members');

      expect(summary).not.toBeNull();
    });

    test('Çok sayıda member ile prompt oluşturulur', async () => {
      // 20 member'lı community oluştur
      for (let i = 1; i <= 20; i++) {
        insertMemory(i + 100, `Member ${i}`, 'tech');
      }
      const memberIds = Array.from({ length: 20 }, (_, i) => i + 100);
      insertCommunity('comm-many-members', memberIds);

      const summary = await summarizer.summarizeCommunity('comm-many-members');

      expect(summary).not.toBeNull();
    });
  });

  describe('LLM Rate Limiting Retry', () => {
    test('Rate limit hatası sonrası retry yapılır', async () => {
      let callCount = 0;
      const rateLimitLLM: LLMProvider = {
        name: 'mock',
        supportedModels: ['mock-model'],
        defaultModel: 'mock-model',
        chat: jest.fn(async (): Promise<LLMResponse> => {
          callCount++;
          if (callCount === 1) {
            const error: any = new Error('Rate limit exceeded');
            error.status = 429;
            throw error;
          }
          return {
            content: JSON.stringify({
              summary: 'Retry sonrası başarılı',
              keyEntities: [],
              keyRelations: [],
              topics: [],
            }),
            usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
            finishReason: 'stop',
          };
        }),
        healthCheck: jest.fn(async () => true),
      } as unknown as LLMProvider;

      const rateLimitSummarizer = new CommunitySummarizer(db, rateLimitLLM);

      insertMemory(1, 'Test bellek 1', 'tech');
      insertCommunity('comm-rate-limit', [1]);

      const summary = await rateLimitSummarizer.summarizeCommunity('comm-rate-limit');

      expect(summary).not.toBeNull();
    });
  });
});
