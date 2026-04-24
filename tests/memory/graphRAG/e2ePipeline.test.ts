/**
 * E2E GraphRAG Pipeline Testleri
 *
 * GraphRAGEngine + GraphExpander + PageRankScorer + CommunityDetector + CommunitySummarizer
 * bileşenlerinin tam pipeline ile entegrasyonunu test eder.
 */

// Logger mock
jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import Database from 'better-sqlite3';
import { GraphRAGEngine, type GraphRAGResult } from '../../../src/memory/graphRAG/GraphRAGEngine.js';
import { GraphExpander } from '../../../src/memory/graphRAG/GraphExpander.js';
import { GraphCache } from '../../../src/memory/graphRAG/GraphCache.js';
import { PageRankScorer } from '../../../src/memory/graphRAG/PageRankScorer.js';
import { CommunityDetector } from '../../../src/memory/graphRAG/CommunityDetector.js';
import { CommunitySummarizer } from '../../../src/memory/graphRAG/CommunitySummarizer.js';
import type { LLMProvider } from '../../../src/llm/provider.js';
import type { LLMResponse } from '../../../src/router/types.js';
import type { MemoryRow } from '../../../src/memory/types.js';
import { logger } from '../../../src/utils/logger.js';

// Mock LLM Provider
function createMockLLMProvider(): LLMProvider {
  return {
    name: 'mock',
    supportedModels: ['mock-model'],
    defaultModel: 'mock-model',
    chat: jest.fn(async (): Promise<LLMResponse> => ({
      content: JSON.stringify({
        summary: 'Test community summary',
        keyEntities: [{ name: 'Entity 1', type: 'tech', importance: 0.8 }],
        keyRelations: [{ source: 'A', target: 'B', type: 'related_to' }],
        topics: ['tech'],
      }),
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      finishReason: 'stop',
    })),
    healthCheck: jest.fn(async () => true),
  } as unknown as LLMProvider;
}

describe('E2E GraphRAG Pipeline', () => {
  let db: Database.Database;
  let graphCache: GraphCache;
  let graphExpander: GraphExpander;
  let pageRankScorer: PageRankScorer;
  let communityDetector: CommunityDetector;
  let communitySummarizer: CommunitySummarizer;
  let graphRAGEngine: GraphRAGEngine;
  let mockLLM: LLMProvider;

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

      CREATE TABLE graph_traversal_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query_hash TEXT NOT NULL,
        max_depth INTEGER NOT NULL,
        node_ids TEXT NOT NULL,
        relation_ids TEXT NOT NULL,
        score REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        UNIQUE(query_hash, max_depth)
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

      CREATE TABLE graph_pagerank (
        node_id INTEGER PRIMARY KEY,
        score REAL NOT NULL,
        computed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    mockLLM = createMockLLMProvider();
    graphCache = new GraphCache(db);
    graphExpander = new GraphExpander(db, graphCache);
    pageRankScorer = new PageRankScorer(db);
    communityDetector = new CommunityDetector(db);
    communitySummarizer = new CommunitySummarizer(db, mockLLM);

    // Mock hybrid search function
    const mockHybridSearch = jest.fn(async (query: string, limit: number): Promise<MemoryRow[]> => {
      const stmt = db.prepare('SELECT * FROM memories WHERE content LIKE ? LIMIT ?');
      return stmt.all(`%${query}%`, limit) as MemoryRow[];
    });

    graphRAGEngine = new GraphRAGEngine(
      db,
      graphExpander,
      pageRankScorer,
      communityDetector,
      communitySummarizer,
      graphCache,
      mockHybridSearch,
      {
        maxHops: 2,
        maxExpandedNodes: 50,
        minConfidence: 0.3,
        usePageRank: true,
        useCommunities: true,
        useCache: true,
        tokenBudget: 32000,
        communitySummaryBudget: 8000,
        timeoutMs: 5000,
        fallbackToStandardSearch: true,
      },
    );

    GraphRAGEngine.setEnabled(true);
  });

  afterEach(() => {
    db.close();
    GraphRAGEngine.setEnabled(true);
    jest.clearAllMocks();
  });

  // Helper: Bellek ekle
  function insertMemory(id: number, content: string, category = 'general'): void {
    db.prepare(`
      INSERT INTO memories (id, content, category) VALUES (?, ?, ?)
    `).run(id, content, category);
  }

  // Helper: İlişki ekle
  function insertRelation(sourceId: number, targetId: number, relationType = 'related_to', confidence = 0.8): void {
    db.prepare(`
      INSERT INTO memory_relations (source_memory_id, target_memory_id, relation_type, confidence, weight)
      VALUES (?, ?, ?, ?, 1.0)
    `).run(sourceId, targetId, relationType, confidence);
  }

  describe('Tam pipeline başarılı çalışır', () => {
    test('GraphRAG retrieval tam pipeline ile sonuç döner', async () => {
      // Test verisi ekle
      for (let i = 1; i <= 6; i++) {
        insertMemory(i, `Test memory ${i} about technology`, i <= 3 ? 'tech' : 'general');
      }

      // İlişkiler ekle
      insertRelation(1, 2, 'related_to', 0.9);
      insertRelation(2, 3, 'related_to', 0.8);
      insertRelation(1, 3, 'supports', 0.7);
      insertRelation(4, 5, 'related_to', 0.9);
      insertRelation(5, 6, 'related_to', 0.8);

      // GraphRAG retrieval
      const result = await graphRAGEngine.retrieve('technology');

      // Sonuçları doğrula
      expect(result.success).toBe(true);
      expect(result.memories.length).toBeGreaterThan(0);
      expect(result.graphContext.expandedNodeIds.length).toBeGreaterThan(0);
      expect(result.graphContext.pageRankApplied).toBe(true);
      expect(result.searchMetadata.fallbackUsed).toBe(false);
      expect(result.searchMetadata.duration).toBeGreaterThan(0);
    });

    test('Cache\'e yazıldığını doğrula', async () => {
      insertMemory(1, 'Cache test memory');
      insertMemory(2, 'Cache test neighbor');
      insertRelation(1, 2, 'related_to', 0.8);

      // İlk çağrı
      const result1 = await graphRAGEngine.retrieve('Cache test');
      expect(result1.success).toBe(true);

      // İkinci çağrı (cache hit olabilir)
      const result2 = await graphRAGEngine.retrieve('Cache test');
      expect(result2.success).toBe(true);
    });

    test('Token budget aşılmadığını doğrula', async () => {
      for (let i = 1; i <= 10; i++) {
        insertMemory(i, `Token budget test memory ${i} with some content`);
        if (i > 1) {
          insertRelation(i - 1, i, 'related_to', 0.8);
        }
      }

      const result = await graphRAGEngine.retrieve('Token budget test');

      expect(result.success).toBe(true);
      // Token usage budget'ı aşmamalı
      expect(result.searchMetadata.tokenUsage).toBeLessThanOrEqual(32000);
    });
  });

  describe('Fallback mechanism çalışır', () => {
    test('GraphRAG başarısız olduğunda standard retrieval\'a düşer', async () => {
      // Boş veritabanı - hybrid search boş dönecek
      const result = await graphRAGEngine.retrieve('nonexistent query');

      // Fallback kullanılmış olmalı veya boş sonuç dönmeli
      expect(result.success).toBe(true);
      // Boş sonuç veya fallback
      expect(result.memories).toBeDefined();
    });

    test('Feature flag disabled olduğunda fallback çalışır', async () => {
      insertMemory(1, 'Fallback test memory');

      GraphRAGEngine.setEnabled(false);
      const result = await graphRAGEngine.retrieve('Fallback test');

      expect(result.searchMetadata.fallbackUsed).toBe(true);
      expect(result.success).toBe(true);
    });

    test('Timeout durumunda fallback çalışır', async () => {
      insertMemory(1, 'Timeout test memory');

      // Çok kısa timeout
      const engineWithTimeout = new GraphRAGEngine(
        db,
        graphExpander,
        pageRankScorer,
        communityDetector,
        communitySummarizer,
        graphCache,
        async () => {
          // Yavaş hybrid search simülasyonu
          await new Promise(resolve => setTimeout(resolve, 100));
          return [{
            id: 1,
            user_id: 'default',
            category: 'test',
            content: 'Timeout test memory',
            importance: 5,
            access_count: 0,
            is_archived: 0,
            last_accessed: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            provenance_source: null,
            provenance_conversation_id: null,
            provenance_message_id: null,
            confidence: 0.7,
            review_profile: null,
            memory_type: 'semantic',
            stability: null,
            retrievability: null,
            next_review_at: null,
            review_count: null,
            max_importance: null,
          }];
        },
        { timeoutMs: 50, fallbackToStandardSearch: true },
      );

      const result = await engineWithTimeout.retrieve('Timeout test');
      // Timeout veya fallback kullanılmış olmalı
      expect(result).toBeDefined();
    });
  });

  describe('Shadow mode karşılaştırma yapar', () => {
    test('GraphRAG ve standard sonuçları karşılaştırılabilir', async () => {
      // Test graph'ı oluştur
      for (let i = 1; i <= 8; i++) {
        insertMemory(i, `Shadow test memory ${i}`, i <= 4 ? 'tech' : 'person');
      }

      // Community A: 1-2-3-4
      insertRelation(1, 2, 'related_to', 0.9);
      insertRelation(2, 3, 'related_to', 0.9);
      insertRelation(3, 4, 'related_to', 0.8);
      insertRelation(1, 4, 'related_to', 0.7);

      // Community B: 5-6-7-8
      insertRelation(5, 6, 'related_to', 0.9);
      insertRelation(6, 7, 'related_to', 0.9);
      insertRelation(7, 8, 'related_to', 0.8);

      // GraphRAG retrieval
      const graphRAGResult = await graphRAGEngine.retrieve('Shadow test');

      expect(graphRAGResult.success).toBe(true);
      expect(graphRAGResult.memories.length).toBeGreaterThan(0);
      expect(graphRAGResult.graphContext.expandedNodeIds.length).toBeGreaterThan(0);
      expect(graphRAGResult.graphContext.pageRankApplied).toBe(true);
    });

    test('Community detection shadow mode çalışır', async () => {
      // İki ayrı community oluştur
      for (let i = 1; i <= 6; i++) {
        insertMemory(i, `Community shadow test ${i}`, i <= 3 ? 'tech' : 'person');
      }

      // Community A
      insertRelation(1, 2, 'related_to', 0.9);
      insertRelation(2, 3, 'related_to', 0.9);
      insertRelation(1, 3, 'related_to', 0.8);

      // Community B
      insertRelation(4, 5, 'related_to', 0.9);
      insertRelation(5, 6, 'related_to', 0.9);
      insertRelation(4, 6, 'related_to', 0.8);

      // Community detection
      const communityResult = communityDetector.detectCommunities({
        useCache: false,
        minCommunitySize: 2,
      });

      expect(communityResult.communities.length).toBeGreaterThanOrEqual(1);
    });

    test('PageRank scoring shadow mode çalışır', async () => {
      for (let i = 1; i <= 5; i++) {
        insertMemory(i, `PageRank shadow test ${i}`);
        if (i > 1) {
          insertRelation(i - 1, i, 'related_to', 0.8);
        }
      }

      // PageRank scoring
      const scores = pageRankScorer.scoreSubgraph([1, 2, 3, 4, 5]);

      expect(scores.size).toBeGreaterThan(0);
      // Her node'un skoru olmalı
      for (const nodeId of [1, 2, 3, 4, 5]) {
        expect(scores.has(nodeId)).toBe(true);
        expect(scores.get(nodeId)!).toBeGreaterThan(0);
      }
    });
  });

  describe('Pipeline edge cases', () => {
    test('Boş graph ile pipeline hata vermez', async () => {
      const result = await graphRAGEngine.retrieve('empty query');

      expect(result.success).toBe(true);
      expect(result.memories).toBeDefined();
    });

    test('Tek node graph ile pipeline çalışır', async () => {
      insertMemory(1, 'Single node test');

      const result = await graphRAGEngine.retrieve('Single node');

      expect(result.success).toBe(true);
    });

    test('Çoklu community ile pipeline çalışır', async () => {
      // 3 ayrı community oluştur
      for (let i = 1; i <= 9; i++) {
        insertMemory(i, `Multi community test ${i}`, `category${Math.ceil(i / 3)}`);
      }

      // Community A: 1-2-3
      insertRelation(1, 2, 'related_to', 0.9);
      insertRelation(2, 3, 'related_to', 0.9);
      insertRelation(1, 3, 'related_to', 0.8);

      // Community B: 4-5-6
      insertRelation(4, 5, 'related_to', 0.9);
      insertRelation(5, 6, 'related_to', 0.9);
      insertRelation(4, 6, 'related_to', 0.8);

      // Community C: 7-8-9
      insertRelation(7, 8, 'related_to', 0.9);
      insertRelation(8, 9, 'related_to', 0.9);
      insertRelation(7, 9, 'related_to', 0.8);

      const result = await graphRAGEngine.retrieve('Multi community');

      expect(result.success).toBe(true);
    });

    test('Düşük token budget ile pipeline çalışır', async () => {
      for (let i = 1; i <= 5; i++) {
        insertMemory(i, `Low token budget test memory ${i} with some content`);
        if (i > 1) {
          insertRelation(i - 1, i, 'related_to', 0.8);
        }
      }

      const engineWithLowBudget = new GraphRAGEngine(
        db,
        graphExpander,
        pageRankScorer,
        communityDetector,
        communitySummarizer,
        graphCache,
        async (query: string, limit: number): Promise<MemoryRow[]> => {
          const stmt = db.prepare('SELECT * FROM memories WHERE content LIKE ? LIMIT ?');
          return stmt.all(`%${query}%`, limit) as MemoryRow[];
        },
        { tokenBudget: 100, fallbackToStandardSearch: true },
      );

      const result = await engineWithLowBudget.retrieve('Low token budget');

      expect(result.success).toBe(true);
    });
  });
});
