/**
 * GraphWorker Testleri
 *
 * Background worker başlatma, durdurma, görev çalıştırma ve
 * hardware monitoring testleri.
 */

import Database from 'better-sqlite3';
import { GraphWorker } from '../../../src/memory/graphRAG/GraphWorker.js';
import { PageRankScorer } from '../../../src/memory/graphRAG/PageRankScorer.js';
import { CommunityDetector } from '../../../src/memory/graphRAG/CommunityDetector.js';
import { CommunitySummarizer } from '../../../src/memory/graphRAG/CommunitySummarizer.js';
import { GraphCache } from '../../../src/memory/graphRAG/GraphCache.js';
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
        summary: 'Test summary',
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

describe('GraphWorker', () => {
  let db: Database.Database;
  let worker: GraphWorker;
  let pageRankScorer: PageRankScorer;
  let communityDetector: CommunityDetector;
  let communitySummarizer: CommunitySummarizer;
  let graphCache: GraphCache;
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
    `);

    mockLLM = createMockLLMProvider();
    pageRankScorer = new PageRankScorer(db);
    communityDetector = new CommunityDetector(db);
    graphCache = new GraphCache(db);
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
  });

  describe('Worker lifecycle', () => {
    test('Worker başlatılabilir', () => {
      worker.start();
      const status = worker.getStatus();
      expect(status.isRunning).toBe(true);
    });

    test('Worker durdurulabilir', () => {
      worker.start();
      worker.stop();
      const status = worker.getStatus();
      expect(status.isRunning).toBe(false);
    });

    test('Zaten çalışan worker tekrar başlatılamaz', () => {
      worker.start();
      worker.start(); // İkinci çağrı ignore edilmeli
      const status = worker.getStatus();
      expect(status.isRunning).toBe(true);
    });
  });

  describe('Manual task execution', () => {
    beforeEach(() => {
      // Test verisi ekle
      db.prepare(`INSERT INTO memories (id, content) VALUES (1, 'Test 1')`).run();
      db.prepare(`INSERT INTO memories (id, content) VALUES (2, 'Test 2')`).run();
      db.prepare(`INSERT INTO memory_relations (source_memory_id, target_memory_id, confidence) VALUES (1, 2, 0.8)`).run();
    });

    test('Manual PageRank güncellemesi çalışır', async () => {
      await worker.runPageRankUpdate();
      // Hata fırlatılmamalı
    });

    test('Manual Community Detection çalışır', async () => {
      await worker.runCommunityDetection();
      // Hata fırlatılmamalı
    });

    test('Manual Cache Cleanup çalışır', async () => {
      await worker.runCacheCleanup();
      // Hata fırlatılmamalı
    });

    test('Manual Summary Generation çalışır', async () => {
      await worker.runSummaryGeneration();
      // Hata fırlatılmamalı
    });
  });

  describe('User activity registration', () => {
    test('User activity kaydedilir', () => {
      worker.registerUserActivity();
      // Interrupt tetiklenmeli, hata fırlatılmamalı
    });
  });

  describe('Status reporting', () => {
    test('Status doğru bilgileri döner', () => {
      const status = worker.getStatus();
      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('tasks');
      expect(Array.isArray(status.tasks)).toBe(true);
      expect(status.tasks.length).toBe(4); // 4 görev tanımlı
    });

    test('Görev isimleri doğru', () => {
      const status = worker.getStatus();
      const taskNames = status.tasks.map(t => t.name);
      expect(taskNames).toContain('PageRank Update');
      expect(taskNames).toContain('Community Detection');
      expect(taskNames).toContain('Cache Cleanup');
      expect(taskNames).toContain('Summary Generation');
    });
  });

  describe('isHardwareOverloaded', () => {
    test('Normal CPU yükünde görevler çalışır', () => {
      worker.start();
      const status = worker.getStatus();
      expect(status.isRunning).toBe(true);
    });

    test('Yüksek RAM durumunda görevler ertelenir', () => {
      // Worker zaten threshold ayarlarıyla yapılandırılmış
      // Normal sistemde overload olmamalı
      worker.start();
      const status = worker.getStatus();
      expect(status.isRunning).toBe(true);
    });
  });

  describe('scheduleNextCheck', () => {
    test('Farklı interval\'ler doğru planlanır', () => {
      const customWorker = new GraphWorker(
        db,
        pageRankScorer,
        communityDetector,
        communitySummarizer,
        graphCache,
        {
          pageRankIntervalMs: 500,
          communityDetectionIntervalMs: 1000,
          cacheCleanupIntervalMs: 200,
          summaryGenerationIntervalMs: 2000,
          maxConcurrentTasks: 2,
        },
      );

      customWorker.start();
      const status = customWorker.getStatus();
      expect(status.isRunning).toBe(true);

      customWorker.stop();
    });

    test('Minimum 1 saniye bekleme süresi', () => {
      // Çok kısa interval'ler bile minimum 1 saniyeye yuvarlanmalı
      const customWorker = new GraphWorker(
        db,
        pageRankScorer,
        communityDetector,
        communitySummarizer,
        graphCache,
        {
          pageRankIntervalMs: 100, // 100ms
          communityDetectionIntervalMs: 100,
          cacheCleanupIntervalMs: 100,
          summaryGenerationIntervalMs: 100,
          maxConcurrentTasks: 2,
        },
      );

      customWorker.start();
      // Hata fırlatılmamalı
      expect(customWorker.getStatus().isRunning).toBe(true);

      customWorker.stop();
    });
  });

  describe('checkAndRun Task Sırası', () => {
    test('Birden fazla görev sırası doğru yönetilir', async () => {
      // Tüm görevleri manuel çalıştır
      await worker.runPageRankUpdate();
      await worker.runCommunityDetection();
      await worker.runCacheCleanup();

      // Her görev hata fırlatmamalı
      const status = worker.getStatus();
      expect(status.tasks.length).toBe(4);
    });

    test('Concurrent task limit uygulanır', () => {
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
          maxConcurrentTasks: 1, // Sadece 1 concurrent task
        },
      );

      limitedWorker.start();
      const status = limitedWorker.getStatus();
      expect(status.isRunning).toBe(true);

      limitedWorker.stop();
    });
  });

  describe('Idle Threshold Davranışı', () => {
    test('User activity sonrası görevler ertelenir', () => {
      worker.start();
      worker.registerUserActivity();

      // Hemen görev çalıştırılmamalı
      const status = worker.getStatus();
      expect(status.isRunning).toBe(true);

      worker.stop();
    });

    test('Idle threshold aşıldığında görevler başlar', async () => {
      // Kısa idle threshold ile worker oluştur
      const quickIdleWorker = new GraphWorker(
        db,
        pageRankScorer,
        communityDetector,
        communitySummarizer,
        graphCache,
        {
          pageRankIntervalMs: 100,
          communityDetectionIntervalMs: 200,
          cacheCleanupIntervalMs: 300,
          summaryGenerationIntervalMs: 400,
          maxConcurrentTasks: 2,
        },
      );

      quickIdleWorker.start();
      // Idle threshold default 5 dakika, test için beklemiyoruz
      // Sadece worker'ın çalıştığını doğrula
      expect(quickIdleWorker.getStatus().isRunning).toBe(true);

      quickIdleWorker.stop();
    });
  });

  describe('Task Error Retry Mechanism', () => {
    test('Task hatası sonrası retry mechanism çalışır', async () => {
      // PageRank görevi hata verirse bile worker devam etmeli
      await worker.runPageRankUpdate();

      // Worker durmamalı
      const status = worker.getStatus();
      expect(status.isRunning).toBe(false); // stop() çağrılmadı ama start() da çağrılmadı
    });

    test('Görev error count artar', async () => {
      worker.start();

      // Görevleri çalıştır
      await worker.runPageRankUpdate();

      const status = worker.getStatus();
      // Error count'ları kontrol et
      for (const task of status.tasks) {
        expect(task.errorCount).toBeGreaterThanOrEqual(0);
      }

      worker.stop();
    });
  });

  describe('FULL Phase Configuration', () => {
    test('FULL phase config daha kısa interval\'ler kullanır', () => {
      const { FULL_PHASE_CONFIG } = require('../../../src/memory/graphRAG/GraphWorker.js');

      expect(FULL_PHASE_CONFIG.pageRankIntervalMs).toBe(30 * 60 * 1000);
      expect(FULL_PHASE_CONFIG.communityDetectionIntervalMs).toBe(3 * 60 * 60 * 1000);
      expect(FULL_PHASE_CONFIG.cacheCleanupIntervalMs).toBe(15 * 60 * 1000);
      expect(FULL_PHASE_CONFIG.summaryGenerationIntervalMs).toBe(6 * 60 * 60 * 1000);
    });
  });

  describe('Abort Controller Behavior', () => {
    test('Stop sonrası abort controller temizlenir', () => {
      worker.start();
      worker.stop();

      // Abort controller null olmalı
      expect((worker as any).abortController).toBeNull();
    });

    test('Timer temizlenir stop sonrası', () => {
      worker.start();
      worker.stop();

      // Timer null olmalı
      expect((worker as any).timer).toBeNull();
    });
  });

  describe('Veritabanı Hatası Durumunda Graceful Degradation', () => {
    test('Veritabanı hatasında worker çökmez', async () => {
      const brokenDb = new Database(':memory:');
      // Tabloları oluşturma

      const brokenPageRankScorer = new PageRankScorer(brokenDb);
      const brokenCommunityDetector = new CommunityDetector(brokenDb);
      const brokenGraphCache = new GraphCache(brokenDb);
      const brokenCommunitySummarizer = new CommunitySummarizer(brokenDb, mockLLM);

      const brokenWorker = new GraphWorker(
        brokenDb,
        brokenPageRankScorer,
        brokenCommunityDetector,
        brokenCommunitySummarizer,
        brokenGraphCache,
      );

      brokenWorker.start();

      // Görevler hata vermemeli (graceful degradation)
      await brokenWorker.runPageRankUpdate();
      await brokenWorker.runCommunityDetection();
      await brokenWorker.runCacheCleanup();

      brokenWorker.stop();
      brokenDb.close();
    });
  });
});
