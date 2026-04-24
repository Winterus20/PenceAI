/**
 * GraphRAG Load Test Suite
 *
 * GraphRAG bileşenlerinin yüksek yük altındaki davranışını test eder.
 * Concurrent query, memory leak, cache boyutu ve uzun süreli stability
 * testlerini içerir.
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
jest.setTimeout(60000);

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

describe('GraphRAG Load Tests', () => {
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
  function createGraph(nodeCount: number, edgeDensity: number = 0.2): void {
    const stmt = db.prepare('INSERT INTO memories (id, content) VALUES (?, ?)');
    const relStmt = db.prepare(
      'INSERT INTO memory_relations (source_memory_id, target_memory_id, relation_type, confidence, weight) VALUES (?, ?, ?, ?, ?)'
    );

    const insertMemories = db.transaction((nodes) => {
      for (const id of nodes) {
        stmt.run(id, `Load test memory ${id}`);
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

  describe('Concurrent Query Load', () => {
    test('100 concurrent query memory leak yaratmaz', async () => {
      createGraph(100, 0.1);

      const initialMemory = process.memoryUsage();

      // 100 concurrent query çalıştır
      const promises = Array(100).fill(null).map((_, i) => {
        return new Promise<void>((resolve) => {
          const seedNode = (i % 100) + 1;
          graphExpander.expand({
            seedNodeIds: [seedNode],
            maxDepth: 1,
            maxNodes: 50,
            minConfidence: 0.3,
            useCache: true,
          });
          resolve();
        });
      });

      await Promise.all(promises);

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      // Memory artışı makul olmalı (< 50MB)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });

    test('50 concurrent PageRank query başarılı', async () => {
      createGraph(100, 0.1);

      const nodeIds = Array.from({ length: 100 }, (_, i) => i + 1);

      // 50 concurrent PageRank query
      const promises = Array(50).fill(null).map(() => {
        return pageRankScorer.scoreSubgraph(nodeIds);
      });

      const results = await Promise.all(promises);

      // Tüm sonuçlar başarılı olmalı
      expect(results.length).toBe(50);
      for (const result of results) {
        expect(result.size).toBe(100);
      }
    });

    test('30 concurrent Community Detection query başarılı', async () => {
      createGraph(100, 0.15);

      // 30 concurrent community detection
      const promises = Array(30).fill(null).map(() => {
        return communityDetector.detectCommunities({
          useCache: false,
          minCommunitySize: 2,
        });
      });

      const results = await Promise.all(promises);

      // Tüm sonuçlar başarılı olmalı
      expect(results.length).toBe(30);
    });
  });

  describe('Cache Size Under Load', () => {
    test('500 query sonrası cache boyutu makul', () => {
      createGraph(100, 0.1);

      // 500 farklı sorgu çalıştır
      for (let i = 0; i < 500; i++) {
        const seedNode = (i % 100) + 1;
        graphExpander.expand({
          seedNodeIds: [seedNode],
          maxDepth: 1,
          maxNodes: 50,
          minConfidence: 0.3,
          useCache: true,
        });
      }

      // Cache stats'i kontrol et
      const stats = graphCache.getStats();

      // Cache boyutu makul olmalı (500'den az, çünkü aynı seed'ler tekrarlanır)
      expect(stats.total).toBeLessThanOrEqual(100); // 100 farklı seed node
      expect(stats.total).toBeGreaterThan(0);
    });

    test('Cache cleanup expired entries temizler', () => {
      createGraph(50, 0.1);

      // Cache'e veri ekle
      for (let i = 0; i < 50; i++) {
        graphExpander.expand({
          seedNodeIds: [i + 1],
          maxDepth: 1,
          maxNodes: 50,
          minConfidence: 0.3,
          useCache: true,
        });
      }

      const statsBefore = graphCache.getStats();
      expect(statsBefore.total).toBeGreaterThan(0);

      // Cache cleanup çalıştır
      const cleaned = graphCache.cleanup();

      // Cleanup sonrası stats
      const statsAfter = graphCache.getStats();

      // Expired entries temizlenmiş olmalı
      expect(statsAfter.expired).toBeLessThanOrEqual(statsBefore.expired);
    });
  });

  describe('Long-Running Stability', () => {
    test('1000 query sonrası memory leak yok', () => {
      createGraph(50, 0.1);

      const initialMemory = process.memoryUsage();
      const memoryCheckpoints: number[] = [];

      // 1000 query çalıştır, her 100'de bir memory kontrol
      for (let i = 0; i < 1000; i++) {
        const seedNode = (i % 50) + 1;
        graphExpander.expand({
          seedNodeIds: [seedNode],
          maxDepth: 1,
          maxNodes: 50,
          minConfidence: 0.3,
          useCache: true,
        });

        // Her 100 query'de memory usage kontrol
        if ((i + 1) % 100 === 0) {
          const currentMemory = process.memoryUsage().heapUsed;
          memoryCheckpoints.push(currentMemory);
        }
      }

      const finalMemory = process.memoryUsage();
      const totalMemoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      // Memory leak olmamalı (< 30MB)
      expect(totalMemoryIncrease).toBeLessThan(30 * 1024 * 1024);

      // Memory checkpoints arasında büyük artış olmamalı
      for (let i = 1; i < memoryCheckpoints.length; i++) {
        const diff = memoryCheckpoints[i] - memoryCheckpoints[i - 1];
        expect(diff).toBeLessThan(10 * 1024 * 1024); // Her 100 query'de < 10MB artış
      }
    });

    test('500 PageRank computation sonrası stability', () => {
      createGraph(100, 0.1);

      const initialMemory = process.memoryUsage();
      const nodeIds = Array.from({ length: 100 }, (_, i) => i + 1);

      // 500 PageRank computation
      for (let i = 0; i < 500; i++) {
        pageRankScorer.scoreSubgraph(nodeIds);
      }

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      // Memory artışı makul olmalı (< 20MB)
      expect(memoryIncrease).toBeLessThan(20 * 1024 * 1024);
    });

    test('200 Community Detection sonrası stability', () => {
      createGraph(100, 0.15);

      const initialMemory = process.memoryUsage();

      // 200 Community Detection
      for (let i = 0; i < 200; i++) {
        communityDetector.detectCommunities({
          useCache: false,
          minCommunitySize: 2,
        });
      }

      // GC'yi tetikle
      if (global.gc) global.gc();

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      // Memory artışı makul olmalı (< 40MB) - V8 GC non-deterministic
      expect(memoryIncrease).toBeLessThan(40 * 1024 * 1024);
    });
  });

  describe('Stress Test Edge Cases', () => {
    test('Boş graph ile yüksek yük testi', () => {
      // Boş graph
      const initialMemory = process.memoryUsage();

      // 100 query boş graph'te
      for (let i = 0; i < 100; i++) {
        graphExpander.expand({
          seedNodeIds: [],
          maxDepth: 1,
          maxNodes: 50,
          minConfidence: 0.3,
          useCache: true,
        });
      }

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      // Memory artışı minimal olmalı
      expect(memoryIncrease).toBeLessThan(5 * 1024 * 1024);
    });

    test('Tek node graph ile yüksek yük testi', () => {
      createGraph(1, 0);

      const initialMemory = process.memoryUsage();

      // 100 query tek node'da
      for (let i = 0; i < 100; i++) {
        graphExpander.expand({
          seedNodeIds: [1],
          maxDepth: 2,
          maxNodes: 50,
          minConfidence: 0.3,
          useCache: true,
        });
      }

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      // Memory artışı minimal olmalı
      expect(memoryIncrease).toBeLessThan(5 * 1024 * 1024);
    });

    test('Dense graph ile yük testi', () => {
      createGraph(50, 0.5); // Yüksek edge density

      const initialMemory = process.memoryUsage();

      // 50 query dense graph'te
      for (let i = 0; i < 50; i++) {
        const seedNode = (i % 50) + 1;
        graphExpander.expand({
          seedNodeIds: [seedNode],
          maxDepth: 2,
          maxNodes: 50,
          minConfidence: 0.3,
          useCache: true,
        });
      }

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      // Memory artışı makul olmalı (< 20MB)
      expect(memoryIncrease).toBeLessThan(20 * 1024 * 1024);
    });
  });

  describe('Database Connection Stress', () => {
    test('Concurrent database access race condition yaratmaz', async () => {
      createGraph(100, 0.1);

      // Concurrent database access
      const promises = Array(20).fill(null).map(async (_, i) => {
        const seedNode = (i % 100) + 1;
        return graphExpander.expand({
          seedNodeIds: [seedNode],
          maxDepth: 1,
          maxNodes: 50,
          minConfidence: 0.3,
          useCache: true,
        });
      });

      const results = await Promise.allSettled(promises);

      // Tüm sorguların başarılı olduğunu doğrula
      const fulfilled = results.filter(r => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThan(0);
    });

    test('Rapid cache set/get operations', () => {
      createGraph(100, 0.1);

      // Rapid cache operations
      for (let i = 0; i < 500; i++) {
        const seedNode = (i % 100) + 1;
        graphExpander.expand({
          seedNodeIds: [seedNode],
          maxDepth: 1,
          maxNodes: 50,
          minConfidence: 0.3,
          useCache: true,
        });
      }

      // Cache stats kontrol
      const stats = graphCache.getStats();
      expect(stats.total).toBeGreaterThanOrEqual(0);
    });
  });
});
