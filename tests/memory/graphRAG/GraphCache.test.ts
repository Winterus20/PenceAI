/**
 * GraphCache Testleri
 * 
 * Cache set/get, TTL expiration, cleanup ve hash collision testleri.
 */

import Database from 'better-sqlite3';
import { GraphCache, computeQueryHash } from '../../../src/memory/graphRAG/GraphCache.js';
import type { GraphCacheEntry, GraphExpansionOptions } from '../../../src/memory/types.js';

// Logger mock - import.meta.url sorununu önler
jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('GraphCache', () => {
  let db: Database.Database;
  let cache: GraphCache;

  beforeEach(() => {
    // In-memory SQLite test veritabanı
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS graph_traversal_cache (
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
      CREATE INDEX IF NOT EXISTS idx_graph_cache_hash ON graph_traversal_cache(query_hash);
      CREATE INDEX IF NOT EXISTS idx_graph_cache_expires ON graph_traversal_cache(expires_at);
    `);
    cache = new GraphCache(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('computeQueryHash', () => {
    test('Aynı parametreler aynı hash üretir', () => {
      const options1: GraphExpansionOptions = {
        seedNodeIds: [1, 2, 3],
        maxDepth: 2,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: true,
      };
      const options2: GraphExpansionOptions = {
        seedNodeIds: [3, 1, 2], // Sıralama farklı
        maxDepth: 2,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: true,
      };

      const hash1 = computeQueryHash(options1);
      const hash2 = computeQueryHash(options2);

      expect(hash1).toBe(hash2);
    });

    test('Farklı parametreler farklı hash üretir', () => {
      const options1: GraphExpansionOptions = {
        seedNodeIds: [1, 2],
        maxDepth: 2,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: true,
      };
      const options2: GraphExpansionOptions = {
        seedNodeIds: [1, 2],
        maxDepth: 3, // Farklı depth
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: true,
      };

      const hash1 = computeQueryHash(options1);
      const hash2 = computeQueryHash(options2);

      expect(hash1).not.toBe(hash2);
    });

    test('Relation types sıralaması hash etkilemez', () => {
      const options1: GraphExpansionOptions = {
        seedNodeIds: [1],
        maxDepth: 2,
        maxNodes: 50,
        relationTypes: ['related_to', 'supports'],
        minConfidence: 0.3,
        useCache: true,
      };
      const options2: GraphExpansionOptions = {
        seedNodeIds: [1],
        maxDepth: 2,
        maxNodes: 50,
        relationTypes: ['supports', 'related_to'], // Sıralama farklı
        minConfidence: 0.3,
        useCache: true,
      };

      const hash1 = computeQueryHash(options1);
      const hash2 = computeQueryHash(options2);

      expect(hash1).toBe(hash2);
    });
  });

  describe('set ve get', () => {
    test('Cache entry set ve get doğru çalışır', () => {
      const entry: GraphCacheEntry = {
        queryHash: 'test-hash-123',
        maxDepth: 2,
        nodeIds: [1, 2, 3],
        relationIds: [10, 20],
        score: 4.5,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600 * 1000), // 1 saat sonra
      };

      cache.set(entry);
      const retrieved = cache.get('test-hash-123', 2);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.queryHash).toBe('test-hash-123');
      expect(retrieved!.maxDepth).toBe(2);
      expect(retrieved!.nodeIds).toEqual([1, 2, 3]);
      expect(retrieved!.relationIds).toEqual([10, 20]);
      expect(retrieved!.score).toBe(4.5);
    });

    test('Mevcut entry güncellenir (UPSERT)', () => {
      const entry1: GraphCacheEntry = {
        queryHash: 'test-hash',
        maxDepth: 2,
        nodeIds: [1, 2],
        relationIds: [10],
        score: 1.0,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600 * 1000),
      };
      cache.set(entry1);

      const entry2: GraphCacheEntry = {
        queryHash: 'test-hash',
        maxDepth: 2,
        nodeIds: [1, 2, 3, 4], // Daha fazla node
        relationIds: [10, 20, 30],
        score: 3.0,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600 * 1000),
      };
      cache.set(entry2);

      const retrieved = cache.get('test-hash', 2);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.nodeIds).toEqual([1, 2, 3, 4]);
      expect(retrieved!.score).toBe(3.0);
    });

    test('Olmayan entry null döner', () => {
      const retrieved = cache.get('nonexistent-hash', 2);
      expect(retrieved).toBeNull();
    });
  });

  describe('TTL expiration', () => {
    test('Süresi dolmuş entry null döner', () => {
      // Doğrudan SQLite datetime formatı kullan (UTC)
      const pastDate = '2020-01-01 00:00:00';
      const entry: GraphCacheEntry = {
        queryHash: 'expired-hash',
        maxDepth: 2,
        nodeIds: [1, 2],
        relationIds: [10],
        score: 1.0,
        createdAt: new Date(pastDate + 'Z'),
        expiresAt: new Date(pastDate + 'Z'),
      };

      cache.set(entry);
      const retrieved = cache.get('expired-hash', 2);

      expect(retrieved).toBeNull();
    });

    test('Süresi dolmamış entry döner', () => {
      const futureDate = '2030-01-01 00:00:00';
      const entry: GraphCacheEntry = {
        queryHash: 'valid-hash',
        maxDepth: 2,
        nodeIds: [1, 2],
        relationIds: [10],
        score: 1.0,
        createdAt: new Date(),
        expiresAt: new Date(futureDate + 'Z'),
      };

      cache.set(entry);
      const retrieved = cache.get('valid-hash', 2);

      expect(retrieved).not.toBeNull();
    });
  });

  describe('cleanup', () => {
    test('Süresi dolmuş entryler temizlenir', () => {
      const pastDate = '2020-01-01 00:00:00';
      const futureDate = '2030-01-01 00:00:00';

      // Süresi dolmuş entry
      cache.set({
        queryHash: 'expired-1',
        maxDepth: 1,
        nodeIds: [1],
        relationIds: [1],
        score: 1.0,
        createdAt: new Date(pastDate + 'Z'),
        expiresAt: new Date(pastDate + 'Z'),
      });

      cache.set({
        queryHash: 'expired-2',
        maxDepth: 2,
        nodeIds: [2],
        relationIds: [2],
        score: 2.0,
        createdAt: new Date(pastDate + 'Z'),
        expiresAt: new Date(pastDate + 'Z'),
      });

      // Süresi dolmamış entry
      cache.set({
        queryHash: 'valid-1',
        maxDepth: 1,
        nodeIds: [3],
        relationIds: [3],
        score: 3.0,
        createdAt: new Date(),
        expiresAt: new Date(futureDate + 'Z'),
      });

      const cleaned = cache.cleanup();

      expect(cleaned).toBe(2);
      expect(cache.get('expired-1', 1)).toBeNull();
      expect(cache.get('expired-2', 2)).toBeNull();
      expect(cache.get('valid-1', 1)).not.toBeNull();
    });

    test('Temizlenecek entry yoksa 0 döner', () => {
      cache.set({
        queryHash: 'valid-1',
        maxDepth: 1,
        nodeIds: [1],
        relationIds: [1],
        score: 1.0,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600 * 1000),
      });

      const cleaned = cache.cleanup();
      expect(cleaned).toBe(0);
    });
  });

  describe('invalidate', () => {
    test('Belirli hash entry silinir', () => {
      cache.set({
        queryHash: 'to-invalidate',
        maxDepth: 2,
        nodeIds: [1, 2],
        relationIds: [10],
        score: 1.0,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600 * 1000),
      });

      const invalidated = cache.invalidate('to-invalidate');
      expect(invalidated).toBe(1);
      expect(cache.get('to-invalidate', 2)).toBeNull();
    });

    test('Olmayan hash invalidation 0 döner', () => {
      const invalidated = cache.invalidate('nonexistent');
      expect(invalidated).toBe(0);
    });
  });

  describe('clearAll', () => {
    test('Tüm cache temizlenir', () => {
      cache.set({
        queryHash: 'hash-1',
        maxDepth: 1,
        nodeIds: [1],
        relationIds: [1],
        score: 1.0,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600 * 1000),
      });
      cache.set({
        queryHash: 'hash-2',
        maxDepth: 2,
        nodeIds: [2],
        relationIds: [2],
        score: 2.0,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600 * 1000),
      });

      const cleared = cache.clearAll();
      expect(cleared).toBe(2);
      expect(cache.getStats().total).toBe(0);
    });
  });

  describe('getStats', () => {
    test('Cache istatistikleri doğru hesaplanır', () => {
      const pastDate = '2020-01-01 00:00:00';
      const futureDate = '2030-01-01 00:00:00';

      // 2 geçerli entry
      cache.set({
        queryHash: 'valid-1',
        maxDepth: 1,
        nodeIds: [1],
        relationIds: [1],
        score: 1.0,
        createdAt: new Date(),
        expiresAt: new Date(futureDate + 'Z'),
      });
      cache.set({
        queryHash: 'valid-2',
        maxDepth: 2,
        nodeIds: [2],
        relationIds: [2],
        score: 2.0,
        createdAt: new Date(),
        expiresAt: new Date(futureDate + 'Z'),
      });

      // 1 süresi dolmuş entry
      cache.set({
        queryHash: 'expired-1',
        maxDepth: 1,
        nodeIds: [3],
        relationIds: [3],
        score: 3.0,
        createdAt: new Date(pastDate + 'Z'),
        expiresAt: new Date(pastDate + 'Z'),
      });

      const stats = cache.getStats();

      expect(stats.total).toBe(3);
      expect(stats.expired).toBe(1);
      expect(stats.active).toBe(2);
    });

    test('Boş cache istatistikleri', () => {
      const stats = cache.getStats();
      expect(stats.total).toBe(0);
      expect(stats.expired).toBe(0);
      expect(stats.active).toBe(0);
    });
  });
});
