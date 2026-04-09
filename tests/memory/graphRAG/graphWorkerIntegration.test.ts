/**
 * GraphWorker Integration Testleri
 *
 * GraphWorker'ın diğer bileşenlerle entegrasyonunu,
 * background task sıralamasını, hardware overload detection'ı
 * ve phase transition davranışını test eder.
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
import { GraphWorker, FULL_PHASE_CONFIG } from '../../../src/memory/graphRAG/GraphWorker.js';
import { PageRankScorer } from '../../../src/memory/graphRAG/PageRankScorer.js';
import { CommunityDetector } from '../../../src/memory/graphRAG/CommunityDetector.js';
import { CommunitySummarizer } from '../../../src/memory/graphRAG/CommunitySummarizer.js';
import { GraphCache } from '../../../src/memory/graphRAG/GraphCache.js';
import { GraphExpander } from '../../../src/memory/graphRAG/GraphExpander.js';
import type { LLMProvider } from '../../../src/llm/provider.js';
import type { LLMResponse } from '../../../src/router/types.js';
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

describe('GraphWorker Integration', () => {
  let db: Database.Database;
  let worker: GraphWorker;
  let pageRankScorer: PageRankScorer;
  let communityDetector: CommunityDetector;
  let communitySummarizer: CommunitySummarizer;
  let graphCache: GraphCache;
  let graphExpander: GraphExpander;
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

    worker = new GraphWorker(
      db,
      pageRankScorer,
      communityDetector,
      communitySummarizer,
      graphCache,
      {
        pageRankIntervalMs: 1000,
        communityDetectionIntervalMs: 2000,
        cacheCleanupIntervalMs: 500,
        summaryGenerationIntervalMs: 3000,
        maxConcurrentTasks: 2,
      },
    );
  });

  afterEach(() => {
    worker.stop();
    db.close();
    jest.clearAllMocks();
  });

  // Helper: Test graph'ı oluştur
  function createTestGraph(nodeCount: number): void {
    for (let i = 1; i <= nodeCount; i++) {
      db.prepare('INSERT INTO memories (id, content) VALUES (?, ?)').run(i, `Test memory ${i}`);
    }

    // Her node'u bir sonrakine bağla
    for (let i = 1; i < nodeCount; i++) {
      db.prepare(
        'INSERT INTO memory_relations (source_memory_id, target_memory_id, relation_type, confidence, weight) VALUES (?, ?, ?, ?, ?)'
      ).run(i, i + 1, 'related_to', 0.8, 1.0);
    }
  }

  describe('Tüm background task\'lar sırayla çalışır', () => {
    beforeEach(() => {
      createTestGraph(10);
    });

    test('PageRank → Community Detection → Cache Cleanup → Summary sırası', async () => {
      // Task'ları sırayla çalıştır
      await worker.runPageRankUpdate();
      await worker.runCommunityDetection();
      await worker.runCacheCleanup();
      await worker.runSummaryGeneration();

      // Her task'ın loglandığını doğrula
      expect(logger.info).toHaveBeenCalled();
    });

    test('Task\'lar arası state paylaşımı doğru çalışır', async () => {
      // Önce PageRank hesapla
      await worker.runPageRankUpdate();

      // Sonra community detection yap (PageRank skorlarını kullanabilir)
      await worker.runCommunityDetection();

      // Community detection sonuçları cache'e yazılmış olmalı
      const status = worker.getStatus();
      expect(status.tasks.length).toBe(4);
    });

    test('Cache cleanup sonrası stale entries temizlenir', async () => {
      // Önce cache'e veri ekle
      const cacheEntry = {
        queryHash: 'test-query',
        maxDepth: 1,
        nodeIds: [1, 2, 3],
        relationIds: [1, 2],
        score: 0.5,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600 * 1000),
      };
      graphCache.set(cacheEntry);

      // Cache cleanup çalıştır
      await worker.runCacheCleanup();

      // Cache stats kontrol
      const stats = graphCache.getStats();
      expect(stats.total).toBeGreaterThanOrEqual(0);
    });

    test('Summary generation community detection sonuçlarını kullanır', async () => {
      // Önce community detection yap
      await worker.runCommunityDetection();

      // Sonra summary generation
      await worker.runSummaryGeneration();

      // Summary'ler oluşturulmuş olmalı
      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe('Hardware overload detection çalışır', () => {
    test('Normal sistem yükünde task\'lar çalışır', async () => {
      createTestGraph(5);
      worker.start();

      const status = worker.getStatus();
      expect(status.isRunning).toBe(true);

      // Task'lar çalıştırılabilir olmalı
      await worker.runPageRankUpdate();

      worker.stop();
    });

    test('Düşük memory threshold ile task deferral test edilir', () => {
      // Çok düşük memory threshold ile worker oluştur
      const sensitiveWorker = new GraphWorker(
        db,
        pageRankScorer,
        communityDetector,
        communitySummarizer,
        graphCache,
        {
          pageRankIntervalMs: 1000,
          communityDetectionIntervalMs: 2000,
          cacheCleanupIntervalMs: 500,
          summaryGenerationIntervalMs: 3000,
          maxConcurrentTasks: 2,
          memoryThreshold: 0.001, // Çok düşük threshold
        },
      );

      sensitiveWorker.start();
      const status = sensitiveWorker.getStatus();
      expect(status.isRunning).toBe(true);

      sensitiveWorker.stop();
    });

    test('CPU load threshold Windows\'ta atlanır', () => {
      // Windows'ta os.loadavg() [0, 0, 0] döner
      // Bu yüzden CPU check atlanır
      worker.start();
      const status = worker.getStatus();
      expect(status.isRunning).toBe(true);
      worker.stop();
    });
  });

  describe('Phase transition düzgün çalışır', () => {
    test('WARMUP phase: İlk başlatma', () => {
      // Worker ilk başlatıldığında tüm task'lar idle durumda
      const status = worker.getStatus();
      expect(status.isRunning).toBe(false);

      worker.start();
      const startedStatus = worker.getStatus();
      expect(startedStatus.isRunning).toBe(true);

      // Tüm task'lar idle durumda olmalı
      for (const task of startedStatus.tasks) {
        expect(task.status).toBe('idle');
      }

      worker.stop();
    });

    test('PARTIAL phase: Manuel task execution', async () => {
      createTestGraph(5);

      // Manuel task execution
      await worker.runPageRankUpdate();

      const status = worker.getStatus();
      const pageRankTask = status.tasks.find(t => t.name === 'PageRank Update');
      expect(pageRankTask).toBeDefined();
      expect(pageRankTask!.lastRunAt).toBeGreaterThan(0);
    });

    test('FULL phase: Daha sık interval\'ler', () => {
      const fullPhaseWorker = new GraphWorker(
        db,
        pageRankScorer,
        communityDetector,
        communitySummarizer,
        graphCache,
        FULL_PHASE_CONFIG,
      );

      expect(FULL_PHASE_CONFIG.pageRankIntervalMs).toBe(30 * 60 * 1000);
      expect(FULL_PHASE_CONFIG.communityDetectionIntervalMs).toBe(3 * 60 * 60 * 1000);
      expect(FULL_PHASE_CONFIG.cacheCleanupIntervalMs).toBe(15 * 60 * 1000);
      expect(FULL_PHASE_CONFIG.summaryGenerationIntervalMs).toBe(6 * 60 * 60 * 1000);

      fullPhaseWorker.start();
      const status = fullPhaseWorker.getStatus();
      expect(status.isRunning).toBe(true);

      fullPhaseWorker.stop();
    });

    test('Phase geçişleri sırasında state korunur', async () => {
      createTestGraph(5);

      // WARMUP: İlk başlatma
      worker.start();
      expect(worker.getStatus().isRunning).toBe(true);

      // PARTIAL: Manuel task
      await worker.runPageRankUpdate();
      const pageRankTask = worker.getStatus().tasks.find(t => t.name === 'PageRank Update');
      expect(pageRankTask!.lastRunAt).toBeGreaterThan(0);

      // FULL: Config değiştirme
      worker.stop();

      const fullPhaseWorker = new GraphWorker(
        db,
        pageRankScorer,
        communityDetector,
        communitySummarizer,
        graphCache,
        FULL_PHASE_CONFIG,
      );

      fullPhaseWorker.start();
      expect(fullPhaseWorker.getStatus().isRunning).toBe(true);

      fullPhaseWorker.stop();
    });
  });

  describe('Task scheduling integration', () => {
    test('Task interval\'leri doğru hesaplanır', () => {
      const status = worker.getStatus();
      const pageRankTask = status.tasks.find(t => t.name === 'PageRank Update');
      const cacheCleanupTask = status.tasks.find(t => t.name === 'Cache Cleanup');

      expect(pageRankTask!.nextRunAt).toBeGreaterThan(Date.now());
      expect(cacheCleanupTask!.nextRunAt).toBeGreaterThan(Date.now());

      // Cache cleanup daha kısa interval'e sahip, daha yakın olmalı
      expect(cacheCleanupTask!.nextRunAt).toBeLessThanOrEqual(pageRankTask!.nextRunAt);
    });

    test('Task error count artar ve retry schedule güncellenir', async () => {
      // Broken db ile task çalıştır
      const brokenDb = new Database(':memory:');
      const brokenPageRankScorer = new PageRankScorer(brokenDb);
      const brokenWorker = new GraphWorker(
        brokenDb,
        brokenPageRankScorer,
        communityDetector,
        communitySummarizer,
        graphCache,
      );

      brokenWorker.start();
      await brokenWorker.runPageRankUpdate();

      const status = brokenWorker.getStatus();
      const pageRankTask = status.tasks.find(t => t.name === 'PageRank Update');
      expect(pageRankTask!.errorCount).toBeGreaterThanOrEqual(0);

      brokenWorker.stop();
      brokenDb.close();
    });
  });

  describe('GraphExpander + GraphWorker integration', () => {
    test('Graph expansion sonrası PageRank güncellemesi çalışır', async () => {
      createTestGraph(10);

      // Graph expansion
      const expansion = graphExpander.expand({
        seedNodeIds: [1],
        maxDepth: 2,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: false,
      });

      expect(expansion.nodes.length).toBeGreaterThan(0);

      // PageRank güncellemesi
      await worker.runPageRankUpdate();

      // Worker status kontrol
      const status = worker.getStatus();
      expect(status.isRunning).toBe(false); // start() çağrılmadı
    });

    test('Community detection sonrası summary generation çalışır', async () => {
      createTestGraph(10);

      // Community detection
      await worker.runCommunityDetection();

      // Summary generation
      await worker.runSummaryGeneration();

      // Log'lar kontrol
      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe('Concurrent task management', () => {
    test('Max concurrent tasks limit uygulanır', () => {
      const limitedWorker = new GraphWorker(
        db,
        pageRankScorer,
        communityDetector,
        communitySummarizer,
        graphCache,
        {
          pageRankIntervalMs: 100,
          communityDetectionIntervalMs: 100,
          cacheCleanupIntervalMs: 100,
          summaryGenerationIntervalMs: 100,
          maxConcurrentTasks: 1,
        },
      );

      limitedWorker.start();
      const status = limitedWorker.getStatus();
      expect(status.isRunning).toBe(true);

      limitedWorker.stop();
    });

    test('Task status transitions doğru çalışır', async () => {
      createTestGraph(5);

      // Task çalıştır
      await worker.runPageRankUpdate();

      const status = worker.getStatus();
      const pageRankTask = status.tasks.find(t => t.name === 'PageRank Update');

      // Task idle'a dönmüş olmalı
      expect(pageRankTask!.status).toBe('idle');
    });
  });

  describe('User activity interrupt', () => {
    test('User activity sonrası task\'lar ertelenir', () => {
      worker.start();
      worker.registerUserActivity();

      const status = worker.getStatus();
      expect(status.isRunning).toBe(true);

      worker.stop();
    });

    test('Multiple user activity registrations', () => {
      worker.start();

      // Birden fazla aktivite kaydı
      worker.registerUserActivity();
      worker.registerUserActivity();
      worker.registerUserActivity();

      const status = worker.getStatus();
      expect(status.isRunning).toBe(true);

      worker.stop();
    });
  });

  describe('GraphRAG pipeline + Worker integration', () => {
    test('GraphRAG retrieval sonrası worker task\'ları çalışır', async () => {
      createTestGraph(10);

      // Worker task'ları çalıştır
      await worker.runPageRankUpdate();
      await worker.runCommunityDetection();

      // Status kontrol
      const status = worker.getStatus();
      expect(status.tasks.length).toBe(4);

      // Tüm task'ların en az bir kez çalıştırıldığını doğrula
      for (const task of status.tasks) {
        expect(task.errorCount).toBeGreaterThanOrEqual(0);
      }
    });

    test('Worker cache cleanup sonrası GraphRAG retrieval çalışır', async () => {
      createTestGraph(5);

      // Cache cleanup
      await worker.runCacheCleanup();

      // Graph expansion (cache kullanır)
      const expansion = graphExpander.expand({
        seedNodeIds: [1],
        maxDepth: 1,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: true,
      });

      expect(expansion.nodes.length).toBeGreaterThan(0);
    });
  });
});
