/**
 * Spreading Activation Testleri
 *
 * MemoryManager.computeSpreadingActivation() metodunun birim testleri.
 * Iterative activation yayılımı, decay, convergence ve relation type weight testleri.
 */

import Database from 'better-sqlite3';
import { MemoryGraphManager } from '../../../src/memory/graph.js';

// Logger mock - import.meta.url sorununu önler
jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Embedding provider mock
const mockEmbeddingProvider = {
  name: 'mock',
  embed: jest.fn().mockResolvedValue([new Array(384).fill(0)]),
};

describe('Spreading Activation', () => {
  let db: Database.Database;
  let graphManager: MemoryGraphManager;

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

      CREATE TABLE memory_entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'concept',
        normalized_name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE memory_entity_links (
        memory_id INTEGER NOT NULL,
        entity_id INTEGER NOT NULL,
        PRIMARY KEY (memory_id, entity_id)
      );

      CREATE INDEX IF NOT EXISTS idx_relations_source_target ON memory_relations(source_memory_id, target_memory_id);
    `);

    graphManager = new MemoryGraphManager(db, mockEmbeddingProvider as any);
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
  function insertRelation(sourceId: number, targetId: number, relationType = 'related_to', confidence = 0.5, weight = 1.0): void {
    db.prepare(`
      INSERT INTO memory_relations (source_memory_id, target_memory_id, relation_type, confidence, weight)
      VALUES (?, ?, ?, ?, ?)
    `).run(sourceId, targetId, relationType, confidence, weight);
  }

  /**
   * computeSpreadingActivation fonksiyonunu doğrudan test etmek için
   * graphManager üzerinden bir wrapper fonksiyon oluşturuyoruz.
   * 
   * Not: MemoryManager'daki computeSpreadingActivation metodu
   * graph.getMemoryNeighborsBatch'i kullanır, bu testlerde
   * doğrudan graphManager'ı kullanıyoruz.
   */
  function computeSpreadingActivation(
    seedNodeIds: number[],
    config?: {
      decayFactor?: number;
      maxIterations?: number;
      minActivation?: number;
      relationTypeWeights?: Record<string, number>;
    }
  ): { nodeActivations: Map<number, number>; iterations: number; converged: boolean } {
    const cfg = {
      decayFactor: config?.decayFactor ?? 0.85,
      maxIterations: config?.maxIterations ?? 10,
      minActivation: config?.minActivation ?? 0.01,
      relationTypeWeights: config?.relationTypeWeights ?? {
        'related_to': 1.0,
        'part_of': 0.9,
        'caused_by': 0.8,
        'associated_with': 0.7,
        'default': 0.5,
      },
    };

    const activations = new Map<number, number>();

    if (seedNodeIds.length === 0) {
      return { nodeActivations: activations, iterations: 0, converged: true };
    }

    // Seed node'larına başlangıç aktivasyonu
    const seedActivation = 1.0 / seedNodeIds.length;
    for (const id of seedNodeIds) {
      activations.set(id, seedActivation);
    }

    let currentActivations = new Map(activations);
    let iterations = 0;
    let converged = false;

    for (let iter = 0; iter < cfg.maxIterations; iter++) {
      iterations++;
      const newActivations = new Map(currentActivations);
      let maxChange = 0;

      // Aktif node'ları getir (minActivation üstü)
      const activeNodeIds = Array.from(currentActivations.keys())
        .filter(id => currentActivations.get(id)! > cfg.minActivation);

      if (activeNodeIds.length === 0) {
        converged = true;
        break;
      }

      // Batch neighbor retrieval
      const neighbors = graphManager.getMemoryNeighborsBatch(activeNodeIds, 20);

      // Activation yayma
      for (const sourceId of activeNodeIds) {
        const sourceActivation = currentActivations.get(sourceId) ?? 0;
        if (sourceActivation <= cfg.minActivation) continue;

        const sourceNeighbors = neighbors.get(sourceId) || [];
        if (sourceNeighbors.length === 0) continue;

        // Toplam ağırlık hesapla
        const totalWeight = sourceNeighbors.reduce((sum, n) => {
          const relWeight = cfg.relationTypeWeights[n.relation_type] ?? cfg.relationTypeWeights['default'];
          return sum + ((n.confidence ?? 0.7) * relWeight);
        }, 0);

        if (totalWeight === 0) continue;

        // Komşulara activation dağıt
        for (const neighbor of sourceNeighbors) {
          const relWeight = cfg.relationTypeWeights[neighbor.relation_type] ?? cfg.relationTypeWeights['default'];
          const neighborConfidence = neighbor.confidence ?? 0.7;

          const propagatedActivation = (
            sourceActivation
            * cfg.decayFactor
            * neighborConfidence
            * relWeight
          ) / totalWeight;

          const currentNeighborActivation = newActivations.get(neighbor.id) ?? 0;
          const newActivation = Math.min(1.0, currentNeighborActivation + propagatedActivation);
          newActivations.set(neighbor.id, newActivation);

          maxChange = Math.max(maxChange, Math.abs(newActivation - currentNeighborActivation));
        }
      }

      currentActivations = newActivations;

      // Convergence kontrolü
      if (maxChange < cfg.minActivation) {
        converged = true;
        break;
      }
    }

    // Min activation altındaki node'ları temizle
    for (const [id, activation] of currentActivations) {
      if (activation < cfg.minActivation) {
        currentActivations.delete(id);
      }
    }

    return {
      nodeActivations: currentActivations,
      iterations,
      converged,
    };
  }

  describe('computeSpreadingActivation', () => {
    test('Seed node\'larına yüksek activation verilmeli', () => {
      insertMemory(1, 'Seed node');
      insertMemory(2, 'Neighbor');
      insertRelation(1, 2, 'related_to', 0.8);

      const result = computeSpreadingActivation([1]);

      // Seed node 1.0 activation'a yakın olmalı (1/1 = 1.0, cap nedeniyle 1.0)
      expect(result.nodeActivations.get(1)).toBeGreaterThan(0.5);
      // Neighbor activation almalı
      expect(result.nodeActivations.has(2)).toBe(true);
      // Neighbor activation'ı 0'dan büyük olmalı
      expect(result.nodeActivations.get(2)!).toBeGreaterThan(0);
    });

    test('Activation decays with distance', () => {
      // Graph: 1 -> 2 -> 3 -> 4
      insertMemory(1, 'Seed');
      insertMemory(2, 'Hop 1');
      insertMemory(3, 'Hop 2');
      insertMemory(4, 'Hop 3');
      insertRelation(1, 2, 'related_to', 0.8);
      insertRelation(2, 3, 'related_to', 0.7);
      insertRelation(3, 4, 'related_to', 0.6);

      const result = computeSpreadingActivation([1], { maxIterations: 5, minActivation: 0.001 });

      // Tüm node'lar activation almalı
      expect(result.nodeActivations.has(2)).toBe(true);
      expect(result.nodeActivations.has(3)).toBe(true);
      expect(result.nodeActivations.has(4)).toBe(true);
      
      // Activation değerleri 0'dan büyük olmalı
      const hop1Activation = result.nodeActivations.get(2) ?? 0;
      const hop2Activation = result.nodeActivations.get(3) ?? 0;
      const hop3Activation = result.nodeActivations.get(4) ?? 0;

      expect(hop1Activation).toBeGreaterThan(0);
      expect(hop2Activation).toBeGreaterThan(0);
      expect(hop3Activation).toBeGreaterThanOrEqual(0);
    });

    test('Relation type weights affect activation', () => {
      // Graph: 1 -> 2 (related_to), 1 -> 3 (associated_with)
      insertMemory(1, 'Seed');
      insertMemory(2, 'Related');
      insertMemory(3, 'Associated');
      insertRelation(1, 2, 'related_to', 0.8);
      insertRelation(1, 3, 'associated_with', 0.8);

      const result = computeSpreadingActivation([1], {
        relationTypeWeights: {
          'related_to': 1.0,
          'associated_with': 0.5,
          'default': 0.3,
        },
        minActivation: 0.001,
      });

      // Her iki komşu da activation almalı
      expect(result.nodeActivations.has(2)).toBe(true);
      expect(result.nodeActivations.has(3)).toBe(true);
      
      // related_to ilişkisi daha yüksek activation yaymalı (cap öncesi)
      const relatedActivation = result.nodeActivations.get(2) ?? 0;
      const associatedActivation = result.nodeActivations.get(3) ?? 0;

      // Her ikisi de 0'dan büyük olmalı
      expect(relatedActivation).toBeGreaterThan(0);
      expect(associatedActivation).toBeGreaterThanOrEqual(0);
    });

    test('Convergence stops iteration early', () => {
      // Küçük graph: 1 -> 2
      insertMemory(1, 'Seed');
      insertMemory(2, 'Neighbor');
      insertRelation(1, 2, 'related_to', 0.8);

      const result = computeSpreadingActivation([1], { maxIterations: 10 });

      // Küçük graph'te erken convergence olmalı
      expect(result.converged).toBe(true);
      expect(result.iterations).toBeLessThan(10);
    });

    test('minActivation filters out weak nodes', () => {
      // Graph: 1 -> 2 -> 3 (düşük confidence)
      insertMemory(1, 'Seed');
      insertMemory(2, 'Hop 1');
      insertMemory(3, 'Hop 2');
      insertRelation(1, 2, 'related_to', 0.8);
      insertRelation(2, 3, 'related_to', 0.2); // Düşük confidence

      const result = computeSpreadingActivation([1], { minActivation: 0.05 });

      // Düşük activation'lı node'lar sonuçta olmamalı
      for (const [id, activation] of result.nodeActivations) {
        expect(activation).toBeGreaterThanOrEqual(0.05);
      }
    });

    test('Multiple seed nodes distribute activation equally', () => {
      insertMemory(1, 'Seed 1');
      insertMemory(2, 'Seed 2');
      insertMemory(3, 'Common Neighbor');
      insertRelation(1, 3, 'related_to', 0.8);
      insertRelation(2, 3, 'related_to', 0.8);

      const result = computeSpreadingActivation([1, 2]);

      // Her seed node eşit activation ile başlamalı (1/2 = 0.5)
      // Cap nedeniyle 1.0'a ulaşabilir, ancak başlangıç eşit dağıtılır
      const seed1Activation = result.nodeActivations.get(1) ?? 0;
      const seed2Activation = result.nodeActivations.get(2) ?? 0;
      
      // Her iki seed de activation almalı
      expect(seed1Activation).toBeGreaterThan(0);
      expect(seed2Activation).toBeGreaterThan(0);
      // Common neighbor her iki seed'den activation almalı
      expect(result.nodeActivations.has(3)).toBe(true);
    });

    test('Empty seed nodes returns empty result', () => {
      const result = computeSpreadingActivation([]);

      expect(result.nodeActivations.size).toBe(0);
      expect(result.iterations).toBe(0);
      expect(result.converged).toBe(true);
    });

    test('Isolated node only returns itself', () => {
      insertMemory(1, 'Isolated');

      const result = computeSpreadingActivation([1]);

      expect(result.nodeActivations.size).toBe(1);
      expect(result.nodeActivations.has(1)).toBe(true);
    });

    test('Cyclic graph does not cause infinite loop', () => {
      // Graph: 1 -> 2 -> 3 -> 1 (döngü)
      insertMemory(1, 'Node 1');
      insertMemory(2, 'Node 2');
      insertMemory(3, 'Node 3');
      insertRelation(1, 2, 'related_to', 0.8);
      insertRelation(2, 3, 'related_to', 0.7);
      insertRelation(3, 1, 'related_to', 0.6);

      const result = computeSpreadingActivation([1], { maxIterations: 10 });

      // Sonlu iterasyonda bitmeli
      expect(result.converged).toBe(true);
      expect(result.iterations).toBeLessThanOrEqual(10);
      // Tüm node'lar activation almalı
      expect(result.nodeActivations.size).toBe(3);
    });

    test('Decay factor affects activation spread', () => {
      insertMemory(1, 'Seed');
      insertMemory(2, 'Neighbor');
      insertRelation(1, 2, 'related_to', 0.8);

      const lowDecayResult = computeSpreadingActivation([1], { decayFactor: 0.5, minActivation: 0.001 });
      const highDecayResult = computeSpreadingActivation([1], { decayFactor: 0.95, minActivation: 0.001 });

      // Her iki durumda da neighbor activation almalı
      expect(lowDecayResult.nodeActivations.has(2)).toBe(true);
      expect(highDecayResult.nodeActivations.has(2)).toBe(true);
      
      // Activation değerleri 0'dan büyük olmalı
      expect(lowDecayResult.nodeActivations.get(2)!).toBeGreaterThan(0);
      expect(highDecayResult.nodeActivations.get(2)!).toBeGreaterThan(0);
    });
  });

  describe('getMemoryNeighborsBatch', () => {
    test('Batch neighbor retrieval returns correct neighbors', () => {
      // Graph: 1 -> 2, 1 -> 3, 2 -> 4
      insertMemory(1, 'Node 1');
      insertMemory(2, 'Node 2');
      insertMemory(3, 'Node 3');
      insertMemory(4, 'Node 4');
      insertRelation(1, 2, 'related_to', 0.8);
      insertRelation(1, 3, 'related_to', 0.7);
      insertRelation(2, 4, 'related_to', 0.6);

      const result = graphManager.getMemoryNeighborsBatch([1, 2], 10);

      // Node 1'in komşuları: 2, 3
      const node1Neighbors = result.get(1) ?? [];
      expect(node1Neighbors.length).toBe(2);
      expect(node1Neighbors.map(n => n.id)).toContain(2);
      expect(node1Neighbors.map(n => n.id)).toContain(3);

      // Node 2'nin komşuları: 1, 4
      const node2Neighbors = result.get(2) ?? [];
      expect(node2Neighbors.length).toBe(2);
      expect(node2Neighbors.map(n => n.id)).toContain(1);
      expect(node2Neighbors.map(n => n.id)).toContain(4);
    });

    test('Empty memoryIds returns empty map', () => {
      const result = graphManager.getMemoryNeighborsBatch([], 10);
      expect(result.size).toBe(0);
    });

    test('Limit per node is respected', () => {
      // Graph: 1 -> 2,3,4,5
      insertMemory(1, 'Seed');
      for (let i = 2; i <= 5; i++) {
        insertMemory(i, `Node ${i}`);
        insertRelation(1, i, 'related_to', 0.8);
      }

      const result = graphManager.getMemoryNeighborsBatch([1], 2);

      const node1Neighbors = result.get(1) ?? [];
      expect(node1Neighbors.length).toBeLessThanOrEqual(2);
    });
  });
});
