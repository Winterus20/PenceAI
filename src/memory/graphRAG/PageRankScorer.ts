/**
 * PageRankScorer — Graph node'larının önem skorlarını hesaplar.
 * 
 * Sparse graph için power iteration algoritması kullanır.
 * PageRank: Bir node'un skoru, ona bağlı diğer node'ların skorlarına bağlıdır.
 * 
 * Algoritma:
 *   1. Başlangıç: Her node'a eşit score (1/N)
 *   2. Her iterasyon:
 *      score[node] = (1-d)/N + d * Σ(score[neighbor] / out_degree[neighbor])
 *   3. Convergence: max|score_new - score_old| < threshold
 */

import type Database from 'better-sqlite3';
import type { PageRankOptions } from '../types.js';
import { logger } from '../../utils/logger.js';

/** Default ayarlar */
const DEFAULT_DAMPING_FACTOR = 0.85;
const DEFAULT_MAX_ITERATIONS = 20;
const DEFAULT_CONVERGENCE_THRESHOLD = 0.001;

/**
 * Graph adjacency list yapısı (sparse matrix representation)
 */
interface AdjacencyList {
  // node -> [outgoing neighbors]
  outgoing: Map<number, number[]>;
  // node -> [incoming neighbors]
  incoming: Map<number, number[]>;
  // Tüm node ID'leri
  allNodes: Set<number>;
}

export class PageRankScorer {
  constructor(private db: Database.Database) {}

  /**
   * Tüm graph için PageRank hesaplar.
   * 
   * @param options - PageRank ayarları
   * @returns nodeId -> score map
   */
  computePageRank(options?: Partial<PageRankOptions>): Map<number, number> {
    const opts = this.normalizeOptions(options);

    // Graph'i yükle
    const graph = this.loadFullGraph();
    if (graph.allNodes.size === 0) {
      logger.warn('[PageRankScorer] Empty graph, returning empty scores');
      return new Map();
    }

    return this.computePageRankOnGraph(graph, opts);
  }

  /**
   * Belirli node'lar için alt graph'te PageRank hesaplar.
   * Önce kalıcı skorları kontrol eder, stale ise yeniden hesaplar.
   *
   * @param nodeIds - Skorlanacak node ID'leri
   * @param options - PageRank ayarları
   * @returns nodeId -> score map
   */
  scoreSubgraph(nodeIds: number[], options?: Partial<PageRankOptions>): Map<number, number> {
    const opts = this.normalizeOptions(options);

    if (nodeIds.length === 0) {
      logger.warn('[PageRankScorer] Empty node list, returning empty scores');
      return new Map();
    }

    // Önce kalıcı skorları kontrol et
    const persistedScores = this.loadPersistedScores(nodeIds);
    if (persistedScores.size === nodeIds.length) {
      logger.debug(`[PageRankScorer] Using persisted scores for ${nodeIds.length} nodes`);
      return persistedScores;
    }

    // Stale veya eksik skorlar - yeniden hesapla
    logger.debug(
      `[PageRankScorer] Persisted scores stale/missing (${persistedScores.size}/${nodeIds.length}), recomputing`,
    );

    // Alt graph'i yükle
    const graph = this.loadSubgraph(nodeIds);
    if (graph.allNodes.size === 0) {
      logger.warn('[PageRankScorer] Empty subgraph, returning empty scores');
      return new Map();
    }

    return this.computePageRankOnGraph(graph, opts);
  }

  /**
   * Score'u relation weight ile birleştirir.
   * 
   * @param nodeIds - Skorlanacak node ID'leri
   * @returns nodeId -> weighted score map
   */
  computeWeightedScore(nodeIds: number[]): Map<number, number> {
    if (nodeIds.length === 0) return new Map();

    // Önce normal PageRank hesapla
    const pageRankScores = this.scoreSubgraph(nodeIds);

    // Weight bilgilerini yükle
    const weights = this.loadNodeWeights(nodeIds);

    // Weighted score: pageRank * avg_weight
    const weightedScores = new Map<number, number>();
    for (const nodeId of nodeIds) {
      const pr = pageRankScores.get(nodeId) ?? 0;
      const avgWeight = weights.get(nodeId) ?? 1.0;
      weightedScores.set(nodeId, pr * avgWeight);
    }

    return weightedScores;
  }

  /**
   * PageRank hesaplama çekirdeği.
   * Power iteration algoritması.
   */
  private computePageRankOnGraph(
    graph: AdjacencyList,
    options: PageRankOptions
  ): Map<number, number> {
    const N = graph.allNodes.size;
    const { dampingFactor, maxIterations, convergenceThreshold } = options;

    // Başlangıç: Her node'a eşit score
    const scores = new Map<number, number>();
    for (const nodeId of graph.allNodes) {
      scores.set(nodeId, 1 / N);
    }

    // Dangling node katkısını önceden hesapla (iterasyonlar arasında değişmez)
    const danglingNodeCount = this.countDanglingNodes(graph);
    const danglingContribution = danglingNodeCount > 0
      ? (danglingNodeCount / N) * (1 / N)
      : 0;

    // Power iteration
    let iteration = 0;
    let maxDiff = Infinity;

    while (iteration < maxIterations && maxDiff > convergenceThreshold) {
      const newScores = new Map<number, number>();
      maxDiff = 0;

      for (const nodeId of graph.allNodes) {
        // Dangling node'lar (outgoing bağlantısı olmayan) skorunu eşit dağıt
        const outDegree = graph.outgoing.get(nodeId)?.length ?? 0;
        const currentScore = scores.get(nodeId) ?? 0;

        // Incoming node'lardan gelen katkı
        let incomingContribution = 0;
        const incomingNeighbors = graph.incoming.get(nodeId) ?? [];
        for (const neighborId of incomingNeighbors) {
          const neighborOutDegree = graph.outgoing.get(neighborId)?.length ?? 0;
          if (neighborOutDegree > 0) {
            const neighborScore = scores.get(neighborId) ?? 0;
            incomingContribution += neighborScore / neighborOutDegree;
          }
        }

        // PageRank formülü
        const newScore = (1 - dampingFactor) / N
          + dampingFactor * (incomingContribution + danglingContribution);

        newScores.set(nodeId, newScore);

        // Convergence kontrolü
        const diff = Math.abs(newScore - currentScore);
        if (diff > maxDiff) {
          maxDiff = diff;
        }
      }

      // Scores güncelle
      for (const [nodeId, score] of newScores) {
        scores.set(nodeId, score);
      }

      iteration++;
    }

    logger.debug(`[PageRankScorer] Converged after ${iteration} iterations, maxDiff: ${maxDiff.toFixed(6)}`);

    // last_scored_at kolonunu güncelle
    this.updateLastScoredAt(Array.from(graph.allNodes));

    // PageRank skorlarını kalıcı olarak kaydet
    this.savePageRankScores(scores);

    return scores;
  }

  /**
   * Tüm graph'i veritabanından yükler.
   */
  private loadFullGraph(): AdjacencyList {
    const graph: AdjacencyList = {
      outgoing: new Map(),
      incoming: new Map(),
      allNodes: new Set(),
    };

    try {
      const rows = this.db.prepare(`
        SELECT source_memory_id, target_memory_id, confidence
        FROM memory_relations
        WHERE confidence >= 0.1
      `).all() as Array<{
        source_memory_id: number;
        target_memory_id: number;
        confidence: number;
      }>;

      for (const row of rows) {
        const source = row.source_memory_id;
        const target = row.target_memory_id;

        graph.allNodes.add(source);
        graph.allNodes.add(target);

        // Outgoing
        if (!graph.outgoing.has(source)) {
          graph.outgoing.set(source, []);
        }
        graph.outgoing.get(source)!.push(target);

        // Incoming
        if (!graph.incoming.has(target)) {
          graph.incoming.set(target, []);
        }
        graph.incoming.get(target)!.push(source);
      }
    } catch (err) {
      logger.warn({ err }, '[PageRankScorer] loadFullGraph hatası:');
    }

    return graph;
  }

  /**
   * Belirli node'ların alt graph'ini yükler.
   */
  private loadSubgraph(nodeIds: number[]): AdjacencyList {
    const graph: AdjacencyList = {
      outgoing: new Map(),
      incoming: new Map(),
      allNodes: new Set(nodeIds),
    };

    if (nodeIds.length === 0) return graph;

    const placeholders = nodeIds.map(() => '?').join(',');

    try {
      const rows = this.db.prepare(`
        SELECT source_memory_id, target_memory_id, confidence
        FROM memory_relations
        WHERE confidence >= 0.1
          AND source_memory_id IN (${placeholders})
          AND target_memory_id IN (${placeholders})
      `).all(...nodeIds, ...nodeIds) as Array<{
        source_memory_id: number;
        target_memory_id: number;
        confidence: number;
      }>;

      for (const row of rows) {
        const source = row.source_memory_id;
        const target = row.target_memory_id;

        // Outgoing
        if (!graph.outgoing.has(source)) {
          graph.outgoing.set(source, []);
        }
        graph.outgoing.get(source)!.push(target);

        // Incoming
        if (!graph.incoming.has(target)) {
          graph.incoming.set(target, []);
        }
        graph.incoming.get(target)!.push(source);
      }
    } catch (err) {
      logger.warn({ err }, '[PageRankScorer] loadSubgraph hatası:');
    }

    return graph;
  }

  /**
   * Node'ların ortalama relation weight'lerini yükler.
   */
  private loadNodeWeights(nodeIds: number[]): Map<number, number> {
    const weights = new Map<number, number>();

    if (nodeIds.length === 0) return weights;

    const placeholders = nodeIds.map(() => '?').join(',');

    try {
      const rows = this.db.prepare(`
        SELECT
          m.id,
          AVG(COALESCE(mr.weight, 1.0)) as avg_weight
        FROM memories m
        LEFT JOIN memory_relations mr ON (
          mr.source_memory_id = m.id OR mr.target_memory_id = m.id
        )
        WHERE m.id IN (${placeholders})
        GROUP BY m.id
      `).all(...nodeIds) as Array<{ id: number; avg_weight: number | null }>;

      for (const row of rows) {
        weights.set(row.id, row.avg_weight ?? 1.0);
      }
    } catch (err) {
      logger.warn({ err }, '[PageRankScorer] loadNodeWeights hatası:');
    }

    return weights;
  }

  /**
   * Dangling node (outgoing bağlantısı olmayan) sayısını hesaplar.
   */
  private countDanglingNodes(graph: AdjacencyList): number {
    let count = 0;
    for (const nodeId of graph.allNodes) {
      const outDegree = graph.outgoing.get(nodeId)?.length ?? 0;
      if (outDegree === 0) {
        count++;
      }
    }
    return count;
  }

  /**
   * last_scored_at kolonunu günceller.
   */
  private updateLastScoredAt(nodeIds: number[]): void {
    if (nodeIds.length === 0) return;

    try {
      // Batch update: Her node için ayrı query yerine transaction
      const updateStmt = this.db.prepare(`
        UPDATE memory_relations SET last_scored_at = CURRENT_TIMESTAMP
        WHERE source_memory_id = ? OR target_memory_id = ?
      `);

      const runUpdate = this.db.transaction((ids: number[]) => {
        for (const id of ids) {
          updateStmt.run(id, id);
        }
      });

      runUpdate(nodeIds);
    } catch (err) {
      logger.warn({ err }, '[PageRankScorer] updateLastScoredAt hatası:');
    }
  }

  /**
   * PageRank skorlarını kalıcı olarak kaydeder.
   *
   * @param scores - nodeId -> score map
   */
  private savePageRankScores(scores: Map<number, number>): void {
    if (scores.size === 0) return;

    try {
      const updateStmt = this.db.prepare(`
        UPDATE memory_relations
        SET page_rank_score = ?,
            last_pagerank_update = CURRENT_TIMESTAMP
        WHERE source_memory_id = ? OR target_memory_id = ?
      `);

      const runUpdate = this.db.transaction(() => {
        for (const [nodeId, score] of scores) {
          updateStmt.run(score, nodeId, nodeId);
        }
      });

      runUpdate();
      logger.debug(`[PageRankScorer] Saved scores for ${scores.size} nodes`);
    } catch (err) {
      logger.warn({ err }, '[PageRankScorer] savePageRankScores hatası:');
    }
  }

  /**
   * Kalıcı PageRank skorlarını yükler (son 1 saat içinde güncellenmiş).
   *
   * @param nodeIds - Yüklenecek node ID'leri
   * @returns nodeId -> score map
   */
  private loadPersistedScores(nodeIds: number[]): Map<number, number> {
    const scores = new Map<number, number>();
    if (nodeIds.length === 0) return scores;

    try {
      const placeholders = nodeIds.map(() => '?').join(',');
      const rows = this.db.prepare(`
        SELECT DISTINCT
          m.id,
          COALESCE(MAX(mr.page_rank_score), 0) as score
        FROM memories m
        LEFT JOIN memory_relations mr ON (
          mr.source_memory_id = m.id OR mr.target_memory_id = m.id
        )
        WHERE m.id IN (${placeholders})
          AND mr.last_pagerank_update > datetime('now', '-1 hour')
        GROUP BY m.id
      `).all(...nodeIds) as Array<{ id: number; score: number }>;

      for (const row of rows) {
        scores.set(row.id, row.score);
      }
    } catch (err) {
      logger.warn({ err }, '[PageRankScorer] loadPersistedScores hatası:');
    }

    return scores;
  }

  /**
   * Seçenekleri normalize eder.
   */
  private normalizeOptions(options?: Partial<PageRankOptions>): PageRankOptions {
    return {
      dampingFactor: options?.dampingFactor ?? DEFAULT_DAMPING_FACTOR,
      maxIterations: options?.maxIterations ?? DEFAULT_MAX_ITERATIONS,
      convergenceThreshold: options?.convergenceThreshold ?? DEFAULT_CONVERGENCE_THRESHOLD,
    };
  }
}
