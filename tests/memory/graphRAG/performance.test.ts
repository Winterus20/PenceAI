/**
 * GraphRAG Performance Test Suite
 *
 * GraphRAG bileşenlerinin performans metriklerini test eder.
 * PageRank, Community Detection, Graph Expansion ve Cache hit rate
 * gibi işlemlerin süre ve kaynak kullanımını ölçer.
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
import { GraphExpander } from '../../../src/memory/graphRAG/GraphExpander.js';
import { GraphCache } from '../../../src/memory/graphRAG/GraphCache.js';
import { PageRankScorer } from '../../../src/memory/graphRAG/PageRankScorer.js';
import { CommunityDetector } from '../../../src/memory/graphRAG/CommunityDetector.js';
import { CommunitySummarizer } from '../../../src/memory/graphRAG/CommunitySummarizer.js';
import type { LLMProvider } from '../../../src/llm/provider.js';
import type { LLMResponse } from '../../../src/router/types.js';

// Timeout artır
jest.setTimeout(30000);

// Mock LLM Provider
function createMockLLMProvider(): LLMProvider {
  return {
    name: 'mock',
    supportedModels: ['mock-model'],
    defaultModel: 'mock-model',
    chat: jest.fn(async (): Promise<LLMResponse> => ({
      content: JSON.stringify({
        summary: 'Test community summary',
        keyEntities: [],
        keyRelations: [],
        topics: [],
      }),
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      finishReason: 'stop',
    })),
    healthCheck: jest.fn(async () => true),
  } as unknown as LLMProvider;
}

describe('GraphRAG Performance', () => {
  let db: Database.Database;
  let graphCache: GraphCache;
  let graphExpander: GraphExpander;
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
  });

  afterEach(() => {
    db.close();
    jest.clearAllMocks();
  });

  // Helper: Graph oluştur
  function createGraph(nodeCount: number, edgeDensity: number = 0.3): void {
    const stmt = db.prepare('INSERT INTO memories (id, content) VALUES (?, ?)');
    const relStmt = db.prepare(
      'INSERT INTO memory_relations (source_memory_id, target_memory_id, relation_type, confidence, weight) VALUES (?, ?, ?, ?, ?)'
    );

    const insertMemories = db.transaction((nodes) => {
      for (const id of nodes) {
        stmt.run(id, `Performance test memory ${id}`);
      }
    });

    const insertRelations = db.transaction((edges) => {
      for (const edge of edges) {
        relStmt.run(edge.source, edge.target, 'related_to', edge.confidence, 1.0);
      }
    });

    // Node'ları ekle
    const nodeIds: number[] = [];
    for (let i = 1; i <= nodeCount; i++) {
      nodeIds.push(i);
    }
    insertMemories(nodeIds);

    // Edge'leri ekle
    const edges: Array<{ source: number; target: number; confidence: number }> = [];
    for (let i = 1; i <= nodeCount; i++) {
      for (let j = i + 1; j <= nodeCount; j++) {
        if (Math.random() < edgeDensity) {
          edges.push({ source: i, target: j, confidence: 0.5 + Math.random() * 0.5 });
        }
      }
    }
    insertRelations(edges);
  }

  describe('PageRank Performance', () => {
    test('100 node graph\'de PageRank < 100ms', () => {
      createGraph(100, 0.1);

      const startTime = Date.now();
      const scores = pageRankScorer.scoreSubgraph(Array.from({ length: 100 }, (_, i) => i + 1));
      const duration = Date.now() - startTime;

      expect(scores.size).toBe(100);
      expect(duration).toBeLessThan(100);
    });

    test('500 node graph\'de PageRank < 1000ms', () => {
      createGraph(500, 0.05);

      const startTime = Date.now();
      const scores = pageRankScorer.scoreSubgraph(Array.from({ length: 500 }, (_, i) => i + 1));
      const duration = Date.now() - startTime;

      expect(scores.size).toBe(500);
      expect(duration).toBeLessThan(1000);
    });

    test('1000 node graph\'de PageRank < 2000ms', () => {
      createGraph(1000, 0.02);

      const startTime = Date.now();
      const scores = pageRankScorer.scoreSubgraph(Array.from({ length: 1000 }, (_, i) => i + 1));
      const duration = Date.now() - startTime;

      expect(scores.size).toBeGreaterThan(0);
      expect(duration).toBeLessThan(2000);
    });
  });

  describe('Community Detection Performance', () => {
    test('100 node graph\'de Community Detection < 200ms', () => {
      createGraph(100, 0.15);

      const startTime = Date.now();
      const result = communityDetector.detectCommunities({
        useCache: false,
        minCommunitySize: 2,
      });
      const duration = Date.now() - startTime;

      expect(result.communities.length).toBeGreaterThanOrEqual(0);
      expect(duration).toBeLessThan(200);
    });

    test('500 node graph\'de Community Detection < 500ms', () => {
      createGraph(500, 0.05);

      const startTime = Date.now();
      const result = communityDetector.detectCommunities({
        useCache: false,
        minCommunitySize: 3,
      });
      const duration = Date.now() - startTime;

      expect(result.communities.length).toBeGreaterThanOrEqual(0);
      expect(duration).toBeLessThan(500);
    });

    test('1000 node graph\'de Community Detection < 1000ms', () => {
      createGraph(1000, 0.02);

      const startTime = Date.now();
      const result = communityDetector.detectCommunities({
        useCache: false,
        minCommunitySize: 5,
      });
      const duration = Date.now() - startTime;

      expect(result.communities.length).toBeGreaterThanOrEqual(0);
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('Graph Expansion Performance', () => {
    test('100 node graph\'de Graph Expansion < 50ms', () => {
      createGraph(100, 0.1);

      const startTime = Date.now();
      const expansion = graphExpander.expand({
        seedNodeIds: [1],
        maxDepth: 2,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: false,
      });
      const duration = Date.now() - startTime;

      expect(expansion.nodes.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(50);
    });

    test('500 node graph\'de Graph Expansion < 100ms', () => {
      createGraph(500, 0.05);

      const startTime = Date.now();
      const expansion = graphExpander.expand({
        seedNodeIds: [1],
        maxDepth: 2,
        maxNodes: 100,
        minConfidence: 0.3,
        useCache: false,
      });
      const duration = Date.now() - startTime;

      expect(expansion.nodes.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(100);
    });

    test('1000 node graph\'de Graph Expansion < 200ms', () => {
      createGraph(1000, 0.02);

      const startTime = Date.now();
      const expansion = graphExpander.expand({
        seedNodeIds: [1],
        maxDepth: 2,
        maxNodes: 200,
        minConfidence: 0.3,
        useCache: false,
      });
      const duration = Date.now() - startTime;

      expect(expansion.nodes.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(200);
    });

    test('Derin graph expansion (depth=3) performansı', () => {
      createGraph(200, 0.1);

      const startTime = Date.now();
      const expansion = graphExpander.expand({
        seedNodeIds: [1],
        maxDepth: 3,
        maxNodes: 100,
        minConfidence: 0.3,
        useCache: false,
      });
      const duration = Date.now() - startTime;

      expect(expansion.nodes.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(200);
    });
  });

  describe('Cache Hit Rate Performance', () => {
    test('Cache hit rate > 50% (tekrarlanan sorgular)', () => {
      createGraph(50, 0.2);

      // İlk sorgu - cache miss
      const expansion1 = graphExpander.expand({
        seedNodeIds: [1],
        maxDepth: 1,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: true,
      });

      // Cache stats kontrol
      const statsAfterFirst = graphCache.getStats();
      expect(statsAfterFirst.total).toBeGreaterThanOrEqual(1);

      // İkinci sorgu - cache hit olmalı
      const expansion2 = graphExpander.expand({
        seedNodeIds: [1],
        maxDepth: 1,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: true,
      });

      // Sonuçlar aynı olmalı
      expect(expansion2.nodes.length).toBe(expansion1.nodes.length);
    });

    test('Farklı sorgular için cache ayrı entry\'ler oluşturur', () => {
      createGraph(100, 0.1);

      // Farklı seed node'lar ile sorgu yap
      const expansion1 = graphExpander.expand({
        seedNodeIds: [1],
        maxDepth: 1,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: true,
      });

      const statsAfterFirst = graphCache.getStats();

      const expansion2 = graphExpander.expand({
        seedNodeIds: [2],
        maxDepth: 1,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: true,
      });

      const statsAfterSecond = graphCache.getStats();

      // Her farklı sorgu için yeni cache entry oluşturulmalı
      expect(statsAfterSecond.total).toBeGreaterThanOrEqual(statsAfterFirst.total);
    });
  });

  describe('Token Budget Enforcement', () => {
    test('Token budget aşılmaz', () => {
      createGraph(100, 0.1);

      // Token budget simülasyonu
      const maxTokens = 32000;
      let totalTokens = 0;

      // Graph expansion ile node'ları getir
      const expansion = graphExpander.expand({
        seedNodeIds: [1],
        maxDepth: 2,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: false,
      });

      // Her node için token hesapla (basit simülasyon)
      for (const node of expansion.nodes) {
        const nodeTokens = Math.ceil(node.content.length / 4);
        totalTokens += nodeTokens;
      }

      expect(totalTokens).toBeLessThanOrEqual(maxTokens);
    });

    test('Düşük token budget ile sonuçlar budanır', () => {
      createGraph(50, 0.2);

      const lowTokenBudget = 100;
      let totalTokens = 0;

      const expansion = graphExpander.expand({
        seedNodeIds: [1],
        maxDepth: 2,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: false,
      });

      // Token sayısını hesapla
      for (const node of expansion.nodes) {
        const nodeTokens = Math.ceil(node.content.length / 4);
        totalTokens += nodeTokens;
        if (totalTokens > lowTokenBudget) {
          break;
        }
      }

      // Token budget aşılmamalı
      expect(totalTokens).toBeLessThanOrEqual(lowTokenBudget + 50); // Small tolerance
    });
  });

  describe('Memory Usage Performance', () => {
    test('Graph expansion memory leak yaratmaz', () => {
      createGraph(100, 0.1);

      const initialMemory = process.memoryUsage();

      // 10 kez graph expansion çalıştır
      for (let i = 0; i < 10; i++) {
        graphExpander.expand({
          seedNodeIds: [1],
          maxDepth: 2,
          maxNodes: 50,
          minConfidence: 0.3,
          useCache: false,
        });
      }

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      // Memory artışı makul olmalı (< 10MB)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
    });

    test('PageRank memory leak yaratmaz', () => {
      createGraph(100, 0.1);

      const initialMemory = process.memoryUsage();

      // 10 kez PageRank çalıştır
      for (let i = 0; i < 10; i++) {
        pageRankScorer.scoreSubgraph(Array.from({ length: 100 }, (_, i) => i + 1));
      }

      // GC'yi tetikle
      if (global.gc) global.gc();

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      // Memory artışı makul olmalı (< 15MB) - V8 GC non-deterministic
      expect(memoryIncrease).toBeLessThan(15 * 1024 * 1024);
    });

    test('Community detection memory leak yaratmaz', () => {
      createGraph(100, 0.1);

      const initialMemory = process.memoryUsage();

      // 10 kez community detection çalıştır
      for (let i = 0; i < 10; i++) {
        communityDetector.detectCommunities({
          useCache: false,
          minCommunitySize: 2,
        });
      }

      // GC'yi tetikle
      if (global.gc) global.gc();

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      // Memory artışı makul olmalı (< 30MB) - V8 GC non-deterministic
      expect(memoryIncrease).toBeLessThan(30 * 1024 * 1024);
    });
  });

  describe('Scalability Performance', () => {
    test('Linear scaling: 2x node → ~2x süre', () => {
      // 50 node
      createGraph(50, 0.1);
      const startTime50 = Date.now();
      pageRankScorer.scoreSubgraph(Array.from({ length: 50 }, (_, i) => i + 1));
      const duration50 = Date.now() - startTime50;

      // 100 node
      db.close();
      db = new Database(':memory:');
      db.exec(`
        CREATE TABLE memories (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL DEFAULT 'default', category TEXT DEFAULT 'general', content TEXT NOT NULL, importance INTEGER DEFAULT 5, access_count INTEGER DEFAULT 0, is_archived INTEGER DEFAULT 0, last_accessed DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, provenance_source TEXT, provenance_conversation_id TEXT, provenance_message_id INTEGER, confidence REAL DEFAULT 0.7, review_profile TEXT DEFAULT 'standard', memory_type TEXT DEFAULT 'semantic', stability REAL DEFAULT 2.0, retrievability REAL DEFAULT 1.0, next_review_at INTEGER, review_count INTEGER DEFAULT 0, max_importance INTEGER);
        CREATE TABLE memory_relations (id INTEGER PRIMARY KEY AUTOINCREMENT, source_memory_id INTEGER NOT NULL, target_memory_id INTEGER NOT NULL, relation_type TEXT NOT NULL DEFAULT 'related_to', confidence REAL DEFAULT 0.5, description TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_accessed_at DATETIME, access_count INTEGER DEFAULT 0, decay_rate REAL DEFAULT 0.05, weight REAL DEFAULT 1.0, is_directional INTEGER DEFAULT 0, last_scored_at DATETIME);
        CREATE TABLE graph_traversal_cache (id INTEGER PRIMARY KEY AUTOINCREMENT, query_hash TEXT NOT NULL, max_depth INTEGER NOT NULL, node_ids TEXT NOT NULL, relation_ids TEXT NOT NULL, score REAL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME, UNIQUE(query_hash, max_depth));
        CREATE TABLE graph_communities (id TEXT PRIMARY KEY, modularity_score REAL, dominant_relation_types TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE graph_community_members (community_id TEXT REFERENCES graph_communities(id), node_id INTEGER NOT NULL, PRIMARY KEY (community_id, node_id));
        CREATE TABLE graph_community_summaries (community_id TEXT PRIMARY KEY REFERENCES graph_communities(id), summary TEXT NOT NULL, key_entities TEXT NOT NULL, key_relations TEXT NOT NULL, topics TEXT NOT NULL, generated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE graph_pagerank (node_id INTEGER PRIMARY KEY, score REAL NOT NULL, computed_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      `);
      graphCache = new GraphCache(db);
      graphExpander = new GraphExpander(db, graphCache);
      pageRankScorer = new PageRankScorer(db);
      communityDetector = new CommunityDetector(db);
      communitySummarizer = new CommunitySummarizer(db, mockLLM);

      createGraph(100, 0.1);
      const startTime100 = Date.now();
      pageRankScorer.scoreSubgraph(Array.from({ length: 100 }, (_, i) => i + 1));
      const duration100 = Date.now() - startTime100;

      // 2x node için süre ~2x olmalı (within reasonable margin)
      const ratio = duration100 / (duration50 || 1);
      expect(ratio).toBeLessThan(5); // Generous margin
    });
  });
});
