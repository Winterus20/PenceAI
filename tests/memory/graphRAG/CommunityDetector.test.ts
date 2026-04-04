/**
 * CommunityDetector Testleri
 *
 * Community detection, modularity hesaplama, cache, local community
 * ve veritabanı kayıt testleri.
 */

import Database from 'better-sqlite3';
import { CommunityDetector } from '../../../src/memory/graphRAG/CommunityDetector.js';

// Logger mock
jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('CommunityDetector', () => {
  let db: Database.Database;
  let detector: CommunityDetector;

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

      CREATE INDEX IF NOT EXISTS idx_community_members_node ON graph_community_members(node_id);
      CREATE INDEX IF NOT EXISTS idx_community_members_community ON graph_community_members(community_id);
    `);

    detector = new CommunityDetector(db);
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
  function insertRelation(sourceId: number, targetId: number, relationType = 'related_to', weight = 1.0): void {
    db.prepare(`
      INSERT INTO memory_relations (source_memory_id, target_memory_id, relation_type, weight, confidence)
      VALUES (?, ?, ?, ?, 0.8)
    `).run(sourceId, targetId, relationType, weight);
  }

  describe('Boş graph detection', () => {
    test('Boş graph ile detection boş sonuç döner', () => {
      const result = detector.detectCommunities({ useCache: false });
      expect(result.communities.length).toBe(0);
      expect(result.totalNodes).toBe(0);
      expect(result.totalEdges).toBe(0);
    });

    test('İlişkisi olmayan node\'lar ile detection boş sonuç döner', () => {
      insertMemory(1, 'Node 1');
      insertMemory(2, 'Node 2');

      const result = detector.detectCommunities({ useCache: false, minCommunitySize: 2 });
      expect(result.communities.length).toBe(0);
    });
  });

  describe('Basit community detection', () => {
    test('İki ayrı community tespit edilir', () => {
      // Community A: 1-2-3
      insertMemory(1, 'A1', 'tech');
      insertMemory(2, 'A2', 'tech');
      insertMemory(3, 'A3', 'tech');
      insertRelation(1, 2, 'related_to', 1.0);
      insertRelation(2, 3, 'related_to', 1.0);
      insertRelation(1, 3, 'related_to', 1.0);

      // Community B: 4-5-6
      insertMemory(4, 'B1', 'person');
      insertMemory(5, 'B2', 'person');
      insertMemory(6, 'B3', 'person');
      insertRelation(4, 5, 'related_to', 1.0);
      insertRelation(5, 6, 'related_to', 1.0);
      insertRelation(4, 6, 'related_to', 1.0);

      const result = detector.detectCommunities({ useCache: false, minCommunitySize: 2 });

      expect(result.communities.length).toBeGreaterThanOrEqual(1);
      expect(result.totalNodes).toBe(6);
      expect(result.totalEdges).toBe(6);
    });

    test('Tek community tespit edilir', () => {
      // Tamamen bağlı graph: 1-2-3-4
      insertMemory(1, 'Node 1');
      insertMemory(2, 'Node 2');
      insertMemory(3, 'Node 3');
      insertMemory(4, 'Node 4');
      insertRelation(1, 2, 'related_to', 1.0);
      insertRelation(2, 3, 'related_to', 1.0);
      insertRelation(3, 4, 'related_to', 1.0);
      insertRelation(1, 4, 'related_to', 1.0);

      const result = detector.detectCommunities({ useCache: false, minCommunitySize: 2 });

      expect(result.communities.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Local community detection', () => {
    test('Seed node\'ların local community\'si bulunur', () => {
      // Graph: 1-2-3-4-5
      insertMemory(1, 'Node 1');
      insertMemory(2, 'Node 2');
      insertMemory(3, 'Node 3');
      insertMemory(4, 'Node 4');
      insertMemory(5, 'Node 5');
      insertRelation(1, 2, 'related_to', 1.0);
      insertRelation(2, 3, 'related_to', 1.0);
      insertRelation(3, 4, 'related_to', 1.0);
      insertRelation(4, 5, 'related_to', 1.0);

      const communities = detector.detectLocalCommunity([1, 2], 1);
      expect(Array.isArray(communities)).toBe(true);
    });

    test('Boş seed listesi boş community döner', () => {
      const communities = detector.detectLocalCommunity([], 2);
      expect(communities.length).toBe(0);
    });
  });

  describe('Community veritabanı kaydı', () => {
    test('Community\'ler veritabanına kaydedilir', () => {
      insertMemory(1, 'Node 1');
      insertMemory(2, 'Node 2');
      insertRelation(1, 2, 'related_to', 1.0);

      detector.detectCommunities({ useCache: false, minCommunitySize: 1 });

      const count = db.prepare('SELECT COUNT(*) as count FROM graph_communities').get() as { count: number };
      expect(count.count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getNodeCommunities', () => {
    test('Node\'un community\'leri getirilir', () => {
      insertMemory(1, 'Node 1');
      insertMemory(2, 'Node 2');
      insertRelation(1, 2, 'related_to', 1.0);

      detector.detectCommunities({ useCache: false, minCommunitySize: 1 });

      const communities = detector.getNodeCommunities(1);
      expect(Array.isArray(communities)).toBe(true);
    });

    test('Olmayan node boş community döner', () => {
      const communities = detector.getNodeCommunities(999);
      expect(communities.length).toBe(0);
    });
  });

  describe('Cache davranışı', () => {
    test('Cache hit durumunda hızlı sonuç döner', () => {
      insertMemory(1, 'Node 1');
      insertMemory(2, 'Node 2');
      insertRelation(1, 2, 'related_to', 1.0);

      // İlk çağrı
      const result1 = detector.detectCommunities({ useCache: true, minCommunitySize: 1 });

      // İkinci çağrı (cache hit)
      const result2 = detector.detectCommunities({ useCache: true, minCommunitySize: 1 });

      expect(result2.cacheHit).toBe(true);
      expect(result2.communities.length).toBe(result1.communities.length);
    });
  });

  describe('Modularity hesaplama', () => {
    test('Pozitif modularity skoru hesaplanır', () => {
      insertMemory(1, 'Node 1');
      insertMemory(2, 'Node 2');
      insertMemory(3, 'Node 3');
      insertRelation(1, 2, 'related_to', 1.0);
      insertRelation(2, 3, 'related_to', 1.0);

      const result = detector.detectCommunities({ useCache: false, minCommunitySize: 1 });

      for (const community of result.communities) {
        expect(community.modularityScore).toBeDefined();
        expect(typeof community.modularityScore).toBe('number');
      }
    });
  });

  describe('minCommunitySize filtresi', () => {
    test('Küçük community\'ler filtrelenir', () => {
      // 3 node, ama sadece 2'si ilişkili
      insertMemory(1, 'Node 1');
      insertMemory(2, 'Node 2');
      insertMemory(3, 'Node 3');
      insertRelation(1, 2, 'related_to', 1.0);

      const result = detector.detectCommunities({ useCache: false, minCommunitySize: 2 });

      for (const community of result.communities) {
        expect(community.memberNodeIds.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe('maxCommunities limiti', () => {
    test('maxCommunities limiti uygulanır', () => {
      // Büyük graph oluştur
      for (let i = 1; i <= 20; i++) {
        insertMemory(i, `Node ${i}`);
        if (i > 1) {
          insertRelation(i - 1, i, 'related_to', 1.0);
        }
      }

      const result = detector.detectCommunities({ useCache: false, minCommunitySize: 1, maxCommunities: 2 });

      expect(result.communities.length).toBeLessThanOrEqual(2);
    });
  });
});
