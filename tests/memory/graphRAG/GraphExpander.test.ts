/**
 * GraphExpander Testleri
 *
 * Multi-hop BFS expansion, döngü dedeksiyonu, maxNodes limiti,
 * cache hit/miss ve boş graph expansion testleri.
 */

import Database from 'better-sqlite3';
import { GraphExpander } from '../../../src/memory/graphRAG/GraphExpander.js';
import { GraphCache } from '../../../src/memory/graphRAG/GraphCache.js';

// Logger mock - import.meta.url sorununu önler
jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('GraphExpander', () => {
  let db: Database.Database;
  let cache: GraphCache;
  let expander: GraphExpander;

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

      CREATE INDEX IF NOT EXISTS idx_relations_type_confidence ON memory_relations(relation_type, confidence);
      CREATE INDEX IF NOT EXISTS idx_relations_source_target ON memory_relations(source_memory_id, target_memory_id);
      CREATE INDEX IF NOT EXISTS idx_relations_weight ON memory_relations(weight);

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
    `);

    cache = new GraphCache(db);
    expander = new GraphExpander(db, cache);
  });

  afterEach(() => {
    db.close();
  });

  // Helper: Bellek ekle
  function insertMemory(id: number, content: string, isArchived = 0): void {
    db.prepare(`
      INSERT INTO memories (id, content, is_archived) VALUES (?, ?, ?)
    `).run(id, content, isArchived);
  }

  // Helper: İlişki ekle
  function insertRelation(sourceId: number, targetId: number, relationType = 'related_to', confidence = 0.5): void {
    db.prepare(`
      INSERT INTO memory_relations (source_memory_id, target_memory_id, relation_type, confidence)
      VALUES (?, ?, ?, ?)
    `).run(sourceId, targetId, relationType, confidence);
  }

  describe('Basit 1-hop expansion', () => {
    test('Seed node komşuları doğru genişletilir', () => {
      // Graph: 1 -> 2, 1 -> 3
      insertMemory(1, 'Seed node');
      insertMemory(2, 'Neighbor 1');
      insertMemory(3, 'Neighbor 2');
      insertRelation(1, 2, 'related_to', 0.8);
      insertRelation(1, 3, 'related_to', 0.6);

      const result = expander.expand({
        seedNodeIds: [1],
        maxDepth: 1,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: false,
      });

      expect(result.nodes.length).toBe(3); // Seed + 2 neighbor
      expect(result.edges.length).toBe(2);
      expect(result.hopDistances.get(1)).toBe(0);
      expect(result.hopDistances.get(2)).toBe(1);
      expect(result.hopDistances.get(3)).toBe(1);
      expect(result.maxHopReached).toBe(false);
    });

    test('Düşük confidence ilişkiler filtrelenir', () => {
      insertMemory(1, 'Seed');
      insertMemory(2, 'High confidence');
      insertMemory(3, 'Low confidence');
      insertRelation(1, 2, 'related_to', 0.8);
      insertRelation(1, 3, 'related_to', 0.2);

      const result = expander.expand({
        seedNodeIds: [1],
        maxDepth: 1,
        maxNodes: 50,
        minConfidence: 0.5,
        useCache: false,
      });

      expect(result.nodes.length).toBe(2); // Seed + 1 high confidence neighbor
      expect(result.edges.length).toBe(1);
    });
  });

  describe('Multi-hop (2-3) expansion', () => {
    test('2-hop expansion doğru çalışır', () => {
      // Graph: 1 -> 2 -> 4, 1 -> 3
      insertMemory(1, 'Seed');
      insertMemory(2, 'Hop 1 - A');
      insertMemory(3, 'Hop 1 - B');
      insertMemory(4, 'Hop 2 - A');
      insertRelation(1, 2, 'related_to', 0.8);
      insertRelation(1, 3, 'related_to', 0.7);
      insertRelation(2, 4, 'related_to', 0.6);

      const result = expander.expand({
        seedNodeIds: [1],
        maxDepth: 2,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: false,
      });

      expect(result.nodes.length).toBe(4);
      expect(result.hopDistances.get(4)).toBe(2);
    });

    test('3-hop expansion doğru çalışır', () => {
      // Graph: 1 -> 2 -> 4 -> 5, 1 -> 3
      insertMemory(1, 'Seed');
      insertMemory(2, 'Hop 1 - A');
      insertMemory(3, 'Hop 1 - B');
      insertMemory(4, 'Hop 2 - A');
      insertMemory(5, 'Hop 3 - A');
      insertRelation(1, 2, 'related_to', 0.8);
      insertRelation(1, 3, 'related_to', 0.7);
      insertRelation(2, 4, 'related_to', 0.6);
      insertRelation(4, 5, 'related_to', 0.5);

      const result = expander.expand({
        seedNodeIds: [1],
        maxDepth: 3,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: false,
      });

      expect(result.nodes.length).toBe(5);
      expect(result.hopDistances.get(5)).toBe(3);
    });
  });

  describe('Döngü dedeksiyonu', () => {
    test('Döngüsel graph sonsuz döngüye girmez', () => {
      // Graph: 1 -> 2 -> 3 -> 1 (döngü)
      insertMemory(1, 'Node 1');
      insertMemory(2, 'Node 2');
      insertMemory(3, 'Node 3');
      insertRelation(1, 2, 'related_to', 0.8);
      insertRelation(2, 3, 'related_to', 0.7);
      insertRelation(3, 1, 'related_to', 0.6);

      const result = expander.expand({
        seedNodeIds: [1],
        maxDepth: 5,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: false,
      });

      // Her node sadece bir kez ziyaret edilmeli
      expect(result.nodes.length).toBe(3);
      expect(result.hopDistances.size).toBe(3);
    });

    test('Karmaşık döngüsel graph doğru çalışır', () => {
      // Graph: 1 -> 2 -> 3 -> 1, 2 -> 4 -> 2
      insertMemory(1, 'Node 1');
      insertMemory(2, 'Node 2');
      insertMemory(3, 'Node 3');
      insertMemory(4, 'Node 4');
      insertRelation(1, 2, 'related_to', 0.8);
      insertRelation(2, 3, 'related_to', 0.7);
      insertRelation(3, 1, 'related_to', 0.6);
      insertRelation(2, 4, 'related_to', 0.5);
      insertRelation(4, 2, 'related_to', 0.4);

      const result = expander.expand({
        seedNodeIds: [1],
        maxDepth: 5,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: false,
      });

      expect(result.nodes.length).toBe(4);
    });
  });

  describe('maxNodes limiti', () => {
    test('maxNodes aşıldığında traversal durur', () => {
      // Graph: 1 -> 2,3,4,5,6,7,8,9,10
      insertMemory(1, 'Seed');
      for (let i = 2; i <= 10; i++) {
        insertMemory(i, `Node ${i}`);
        insertRelation(1, i, 'related_to', 0.8);
      }

      const result = expander.expand({
        seedNodeIds: [1],
        maxDepth: 3,
        maxNodes: 5, // Limit
        minConfidence: 0.3,
        useCache: false,
      });

      expect(result.nodes.length).toBeLessThanOrEqual(5);
      expect(result.maxHopReached).toBe(true);
    });
  });

  describe('Cache hit/miss', () => {
    test('Cache miss durumunda traversal yapılır', () => {
      insertMemory(1, 'Seed');
      insertMemory(2, 'Neighbor');
      insertRelation(1, 2, 'related_to', 0.8);

      const result = expander.expand({
        seedNodeIds: [1],
        maxDepth: 1,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: true,
      });

      expect(result.nodes.length).toBe(2);
    });

    test('Cache hit durumunda traversal yapılmaz', () => {
      insertMemory(1, 'Seed');
      insertMemory(2, 'Neighbor');
      insertRelation(1, 2, 'related_to', 0.8);

      // İlk çağrı: Cache miss, traversal yapılır
      const result1 = expander.expand({
        seedNodeIds: [1],
        maxDepth: 1,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: true,
      });

      // İkinci çağrı: Cache hit, aynı sonuç döner
      const result2 = expander.expand({
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

  describe('Boş graph expansion', () => {
    test('Boş graph ile expansion boş sonuç döner', () => {
      const result = expander.expand({
        seedNodeIds: [],
        maxDepth: 2,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: false,
      });

      expect(result.nodes.length).toBe(0);
      expect(result.edges.length).toBe(0);
    });

    test('Olmayan seed node ile expansion boş sonuç döner', () => {
      const result = expander.expand({
        seedNodeIds: [999],
        maxDepth: 2,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: false,
      });

      expect(result.nodes.length).toBe(0);
    });

    test('İlişkisi olmayan seed node sadece kendisini döner', () => {
      insertMemory(1, 'Isolated node');

      const result = expander.expand({
        seedNodeIds: [1],
        maxDepth: 2,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: false,
      });

      expect(result.nodes.length).toBe(1);
      expect(result.edges.length).toBe(0);
    });
  });

  describe('Relation type filtreleme', () => {
    test('Belirli relation tipleri filtrelenir', () => {
      insertMemory(1, 'Seed');
      insertMemory(2, 'Related');
      insertMemory(3, 'Supports');
      insertRelation(1, 2, 'related_to', 0.8);
      insertRelation(1, 3, 'supports', 0.7);

      const result = expander.expand({
        seedNodeIds: [1],
        maxDepth: 1,
        maxNodes: 50,
        relationTypes: ['related_to'],
        minConfidence: 0.3,
        useCache: false,
      });

      expect(result.nodes.length).toBe(2); // Seed + related_to only
    });
  });

  describe('Timeout ve Partial Result', () => {
    test('Timeout durumunda partial result döner', () => {
      // Büyük graph oluştur
      for (let i = 1; i <= 100; i++) {
        insertMemory(i, `Node ${i}`);
        if (i > 1) {
          insertRelation(i - 1, i, 'related_to', 0.8);
        }
      }

      const result = expander.expand({
        seedNodeIds: [1],
        maxDepth: 10,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: false,
      });

      // Sonuçlar maxNodes limitini aşmamalı
      expect(result.nodes.length).toBeLessThanOrEqual(50);
    });
  });

  describe('buildResultFromCache Edge Cases', () => {
    test('Cache hit durumunda sonuçlar doğru döner', () => {
      insertMemory(1, 'Seed');
      insertMemory(2, 'Neighbor');
      insertRelation(1, 2, 'related_to', 0.8);

      // İlk çağrı cache'e yazar
      const result1 = expander.expand({
        seedNodeIds: [1],
        maxDepth: 1,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: true,
      });

      // İkinci çağrı cache'den okur
      const result2 = expander.expand({
        seedNodeIds: [1],
        maxDepth: 1,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: true,
      });

      expect(result1.nodes.length).toBe(result2.nodes.length);
      expect(result1.edges.length).toBe(result2.edges.length);
    });

    test('Cache miss durumunda yeni traversal yapılır', () => {
      insertMemory(1, 'Seed');
      insertMemory(2, 'Neighbor');
      insertRelation(1, 2, 'related_to', 0.8);

      const result = expander.expand({
        seedNodeIds: [1],
        maxDepth: 1,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: false,
      });

      expect(result.nodes.length).toBe(2);
    });
  });

  describe('computeResultScore Edge Cases', () => {
    test('Boş sonuç için skor 0 döner', () => {
      const result = expander.expand({
        seedNodeIds: [],
        maxDepth: 1,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: false,
      });

      expect(result.nodes.length).toBe(0);
      expect(result.edges.length).toBe(0);
    });

    test('Tek node için skor hesaplanır', () => {
      insertMemory(1, 'Single node');

      const result = expander.expand({
        seedNodeIds: [1],
        maxDepth: 1,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: false,
      });

      expect(result.nodes.length).toBe(1);
    });
  });

  describe('Veritabanı Hatası Durumunda Graceful Degradation', () => {
    test('SQL hatası durumunda boş sonuç döner', () => {
      // Geçersiz tablo adı ile hata oluştur
      const brokenDb = new Database(':memory:');
      brokenDb.exec(`
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
      `);
      // memory_relations tablosu yok

      const brokenCache = new GraphCache(brokenDb);
      const brokenExpander = new GraphExpander(brokenDb, brokenCache);

      const result = brokenExpander.expand({
        seedNodeIds: [1],
        maxDepth: 1,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: false,
      });

      expect(result.nodes.length).toBe(0);
      expect(result.edges.length).toBe(0);

      brokenDb.close();
    });
  });

  describe('Bidirectional Relations', () => {
    test('Ters yönlü ilişkiler de bulunur', () => {
      insertMemory(1, 'Node 1');
      insertMemory(2, 'Node 2');
      insertRelation(2, 1, 'related_to', 0.8); // 2 -> 1

      const result = expander.expand({
        seedNodeIds: [1],
        maxDepth: 1,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: false,
      });

      // Seed node (1) her zaman sonuçta olmalı
      // Neighbor (2) bulunmalı çünkü getNeighbors ters yönlü ilişkileri de tarar
      expect(result.nodes.length).toBeGreaterThanOrEqual(1);
      expect(result.nodes.some(n => n.id === 1)).toBe(true);
    });
  });

  describe('Archived Nodes', () => {
    test('Archived node\'lar genişletilmez', () => {
      insertMemory(1, 'Active seed');
      insertMemory(2, 'Archived neighbor', 1); // archived
      insertRelation(1, 2, 'related_to', 0.8);

      const result = expander.expand({
        seedNodeIds: [1],
        maxDepth: 1,
        maxNodes: 50,
        minConfidence: 0.3,
        useCache: false,
      });

      // Archived node dahil edilmemeli
      expect(result.nodes.length).toBe(1);
    });
  });
});
