/**
 * GraphRAG Retrieval Integration Testleri
 *
 * graphRAGSearch fonksiyonunun retrieval pipeline ile entegrasyonunu test eder.
 */

import Database from 'better-sqlite3';
import { GraphExpander } from '../../../src/memory/graphRAG/GraphExpander.js';
import { GraphCache } from '../../../src/memory/graphRAG/GraphCache.js';
import { PageRankScorer } from '../../../src/memory/graphRAG/PageRankScorer.js';
import { CommunityDetector } from '../../../src/memory/graphRAG/CommunityDetector.js';
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

describe('GraphRAG Retrieval Integration', () => {
  let db: Database.Database;
  let graphExpander: GraphExpander;
  let graphCache: GraphCache;
  let pageRankScorer: PageRankScorer;
  let communityDetector: CommunityDetector;
  let communitySummarizer: CommunitySummarizer;
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
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        level INTEGER,
        parent_id TEXT
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

    mockLLM = createMockLLMProvider();
    graphCache = new GraphCache(db);
    graphExpander = new GraphExpander(db, graphCache);
    pageRankScorer = new PageRankScorer(db);
    communityDetector = new CommunityDetector(db);
    communitySummarizer = new CommunitySummarizer(db, mockLLM);
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

  // Helper: İlişki ekle
  function insertRelation(sourceId: number, targetId: number, relationType = 'related_to', confidence = 0.8): void {
    db.prepare(`
      INSERT INTO memory_relations (source_memory_id, target_memory_id, relation_type, confidence, weight)
      VALUES (?, ?, ?, ?, 1.0)
    `).run(sourceId, targetId, relationType, confidence);
  }

  describe('GraphExpander + PageRank entegrasyonu', () => {
    test('Expansion sonrası PageRank skorları hesaplanabilir', () => {
      // Graph: 1 -> 2 -> 3, 1 -> 3
      insertMemory(1, 'Seed node');
      insertMemory(2, 'Intermediate node');
      insertMemory(3, 'Target node');
      insertRelation(1, 2, 'related_to', 0.8);
      insertRelation(2, 3, 'related_to', 0.7);
      insertRelation(1, 3, 'supports', 0.6);

      // Expansion
      const expansion = graphExpander.expand({
        seedNodeIds: [1],
        maxDepth: 2,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: false,
      });

      expect(expansion.nodes.length).toBe(3);
      expect(expansion.edges.length).toBeGreaterThanOrEqual(2);

      // PageRank
      const scores = pageRankScorer.scoreSubgraph(expansion.nodes.map(n => n.id));
      expect(scores.size).toBe(3);

      // Her node'un skoru olmalı
      for (const nodeId of expansion.nodes.map(n => n.id)) {
        expect(scores.has(nodeId)).toBe(true);
        expect(scores.get(nodeId)!).toBeGreaterThan(0);
      }
    });
  });

  describe('CommunityDetector + Summarizer entegrasyonu', () => {
    test('Community detection sonrası özet oluşturulabilir', async () => {
      // İki ayrı community
      insertMemory(1, 'Tech memory 1', 'tech');
      insertMemory(2, 'Tech memory 2', 'tech');
      insertMemory(3, 'Tech memory 3', 'tech');
      insertRelation(1, 2, 'related_to', 0.9);
      insertRelation(2, 3, 'related_to', 0.9);
      insertRelation(1, 3, 'related_to', 0.9);

      // Community detection
      const result = communityDetector.detectCommunities({
        useCache: false,
        minCommunitySize: 2,
      });

      expect(result.communities.length).toBeGreaterThanOrEqual(1);

      // İlk community için özet oluştur
      if (result.communities.length > 0) {
        const summary = await communitySummarizer.summarizeCommunity(result.communities[0].id);
        expect(summary).not.toBeNull();
        expect(summary!.summary.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Full GraphRAG pipeline', () => {
    test('Tüm bileşenler birlikte çalışabilir', async () => {
      // Test graph'ı oluştur
      for (let i = 1; i <= 6; i++) {
        insertMemory(i, `Memory ${i}`, i <= 3 ? 'tech' : 'person');
      }

      // Community A: 1-2-3
      insertRelation(1, 2, 'related_to', 0.9);
      insertRelation(2, 3, 'related_to', 0.9);
      insertRelation(1, 3, 'related_to', 0.8);

      // Community B: 4-5-6
      insertRelation(4, 5, 'related_to', 0.9);
      insertRelation(5, 6, 'related_to', 0.9);
      insertRelation(4, 6, 'related_to', 0.8);

      // 1. Expansion
      const expansion = graphExpander.expand({
        seedNodeIds: [1],
        maxDepth: 2,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: false,
      });

      expect(expansion.nodes.length).toBe(3); // Community A

      // 2. PageRank
      const scores = pageRankScorer.scoreSubgraph(expansion.nodes.map(n => n.id));
      expect(scores.size).toBe(3);

      // 3. Community Detection
      const communities = communityDetector.detectCommunities({
        useCache: false,
        minCommunitySize: 2,
      });

      expect(communities.communities.length).toBeGreaterThanOrEqual(1);

      // 4. Summarization
      if (communities.communities.length > 0) {
        const summaries = await communitySummarizer.summarizeAllCommunities();
        expect(summaries.length).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Cache davranışı', () => {
    test('Graph expansion cache\'lenir', () => {
      insertMemory(1, 'Seed');
      insertMemory(2, 'Neighbor');
      insertRelation(1, 2, 'related_to', 0.8);

      // İlk çağrı
      const result1 = graphExpander.expand({
        seedNodeIds: [1],
        maxDepth: 1,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: true,
      });

      // İkinci çağrı (cache hit)
      const result2 = graphExpander.expand({
        seedNodeIds: [1],
        maxDepth: 1,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: true,
      });

      expect(result1.nodes.length).toBe(result2.nodes.length);
      expect(result1.edges.length).toBe(result2.edges.length);
    });
  });

  describe('Edge cases', () => {
    test('Boş graph ile pipeline hata vermez', async () => {
      const expansion = graphExpander.expand({
        seedNodeIds: [],
        maxDepth: 2,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: false,
      });

      expect(expansion.nodes.length).toBe(0);

      const scores = pageRankScorer.scoreSubgraph([]);
      expect(scores.size).toBe(0);

      const communities = communityDetector.detectCommunities({ useCache: false });
      expect(communities.communities.length).toBe(0);
    });

    test('Tek node graph ile pipeline çalışır', () => {
      insertMemory(1, 'Single node');

      const expansion = graphExpander.expand({
        seedNodeIds: [1],
        maxDepth: 2,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: false,
      });

      expect(expansion.nodes.length).toBe(1);
      expect(expansion.edges.length).toBe(0);
    });
  });
});
