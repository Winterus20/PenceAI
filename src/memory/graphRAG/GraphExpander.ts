/**
 * GraphExpander — Multi-hop BFS traversal.
 * 
 * GraphRAG-style çok atlamalı graf genişletme yapar.
 * Seed node'lardan başlayarak BFS ile komşuları keşfeder.
 * Döngü dedeksiyonu, batch query optimizasyonu ve cache desteği içerir.
 */

import type Database from 'better-sqlite3';
import type {
  GraphExpansionResult,
  GraphExpansionOptions,
  MemoryRow,
  MemoryRelationRow,
  NeighborResult,
} from '../types.js';
import type { GraphCache} from './GraphCache.js';
import { computeQueryHash, evaluateBeforePromote } from './GraphCache.js';
import { logger } from '../../utils/logger.js';

/** Default ayarlar */
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_NODES = 50;
const FULL_PHASE_MAX_NODES = 100; // FULL phase için artırılmış limit
const DEFAULT_MIN_CONFIDENCE = 0.3;
const DEFAULT_USE_CACHE = true;

/** Timeout: 5 saniye (FULL phase'te 8 saniye) */
const TRAVERSAL_TIMEOUT_MS = 5000;
const FULL_PHASE_TIMEOUT_MS = 8000;

export class GraphExpander {
  constructor(
    private db: Database.Database,
    private cache: GraphCache
  ) {}

  /**
   * Ana fonksiyon: BFS ile multi-hop traversal.
   * 
   * @param options - Genişletme seçenekleri
   * @returns GraphExpansionResult - Genişletilmiş node'lar ve edge'ler
   */
  expand(options: Partial<GraphExpansionOptions> & { isFullPhase?: boolean }): GraphExpansionResult {
    const startTime = Date.now();
    const isFullPhase = options.isFullPhase ?? false;
    const timeoutMs = isFullPhase ? FULL_PHASE_TIMEOUT_MS : TRAVERSAL_TIMEOUT_MS;
    const opts = this.normalizeOptions(options);

    // Cache kontrolü
    if (opts.useCache) {
      const queryHash = computeQueryHash(opts);
      const cached = this.cache.get(queryHash, opts.maxDepth);
      if (cached) {
        logger.debug(`[GraphExpander] Cache hit for hash: ${queryHash.substring(0, 32)}...`);
        return this.buildResultFromCache(cached);
      }
    }

    // BFS traversal
    const visited = new Set<number>(opts.seedNodeIds);
    const allNodes = new Map<number, MemoryRow>();
    const allEdges: MemoryRelationRow[] = [];
    const hopDistances = new Map<number, number>();

    // Seed node'ları yükle
    this.loadSeedNodes(opts.seedNodeIds, allNodes);

    // Seed node'ların hop distance'ı 0
    for (const id of opts.seedNodeIds) {
      hopDistances.set(id, 0);
    }

    let currentLayer = [...opts.seedNodeIds];
    let maxHopReached = false;

    for (let hop = 1; hop <= opts.maxDepth; hop++) {
      // Timeout kontrolü
      if (Date.now() - startTime > timeoutMs) {
        logger.warn('[GraphExpander] Traversal timeout — sonuçlar kısmi döndürülüyor');
        break;
      }

      // maxNodes kontrolü
      if (allNodes.size >= opts.maxNodes) {
        maxHopReached = true;
        logger.debug(`[GraphExpander] maxNodes limit reached (${opts.maxNodes}) at hop ${hop}`);
        break;
      }

      // Batch query ile tüm komşuları getir
      const neighbors = this.getNeighbors(currentLayer, opts.minConfidence, opts.relationTypes);

      if (neighbors.length === 0) {
        logger.debug(`[GraphExpander] No neighbors found at hop ${hop}`);
        break;
      }

      // ── Batch loading: N+1 önleme ──
      // Önce ziyaret edilmemiş komşuları filtrele, ID'leri topla
      const unvisitedNeighbors = neighbors.filter(n => !visited.has(n.neighborId));

      // maxNodes limitine kadar al
      const allowed = unvisitedNeighbors.slice(
        0,
        Math.max(0, opts.maxNodes - allNodes.size),
      );
      if (allowed.length < unvisitedNeighbors.length) {
        maxHopReached = true;
      }

      // Tüm node ve edge ID'lerini tek seferde topla → batch sorgu
      const nodeIds = allowed.map(n => n.neighborId);
      const edgeIds = allowed.map(n => n.relationId);

      const nodeBatch = this.loadNodesBatch(nodeIds);
      const edgeBatch = this.loadEdgesBatch(edgeIds);

      const nextLayer: number[] = [];

      for (const neighbor of allowed) {
        visited.add(neighbor.neighborId);
        hopDistances.set(neighbor.neighborId, hop);

        // Batch'ten O(1) erişimle node'u al
        const node = nodeBatch.get(neighbor.neighborId) ?? null;
        if (node) {
          allNodes.set(neighbor.neighborId, node);
        }

        // Batch'ten O(1) erişimle edge'i al
        const edge = edgeBatch.get(neighbor.relationId) ?? null;
        if (edge) {
          allEdges.push(edge);
        }

        nextLayer.push(neighbor.neighborId);
      }

      currentLayer = nextLayer;

      if (currentLayer.length === 0) break;
    }

    const result: GraphExpansionResult = {
      nodes: Array.from(allNodes.values()),
      edges: allEdges,
      hopDistances,
      maxHopReached,
    };

    // Cache'e kaydet (Evaluation Gate uygulayarak)
    if (opts.useCache) {
      const evaluation = evaluateBeforePromote(result, isFullPhase);
      
      if (!evaluation.passed) {
        logger.debug(
          { failedChecks: evaluation.failedChecks }, 
          `[GraphExpander] Değerlendirme Kapısı başarısız, önbelleğe kaydedilmedi (nodes: ${result.nodes.length})`
        );
      } else {
        const queryHash = computeQueryHash(opts);
        const cacheEntry = {
          queryHash,
          maxDepth: opts.maxDepth,
          nodeIds: Array.from(allNodes.keys()),
          relationIds: allEdges.map(e => e.id),
          score: this.computeResultScore(result),
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 3600 * 1000), // 1 saat TTL
        };
        this.cache.set(cacheEntry);
      }
    }

    const elapsed = Date.now() - startTime;
    logger.debug(`[GraphExpander] Expansion completed in ${elapsed}ms: ${allNodes.size} nodes, ${allEdges.length} edges`);

    return result;
  }

  /**
   * Batch query optimizasyonu: Tek SQL ile tüm komşuları getir.
   * Her node için ayrı SQL yerine, tüm node'lar için tek query.
   */
  private getNeighbors(
    nodeIds: number[],
    minConfidence: number,
    relationTypes?: string[]
  ): NeighborResult[] {
    if (nodeIds.length === 0) return [];

    const placeholders = nodeIds.map(() => '?').join(',');

    let relationTypeFilter = '';
    // Query'de 4 kez placeholders kullanılıyor (source IN, target NOT IN, target IN, source NOT IN)
    // + 1 kez minConfidence
    // + opsiyonel relationTypes
    const allParams: (number | string)[] = [
      minConfidence,
      ...nodeIds,  // source IN
      ...nodeIds,  // target NOT IN
      ...nodeIds,  // target IN
      ...nodeIds,  // source NOT IN
    ];

    if (relationTypes && relationTypes.length > 0) {
      const typePlaceholders = relationTypes.map(() => '?').join(',');
      relationTypeFilter = `AND mr.relation_type IN (${typePlaceholders})`;
      allParams.push(...relationTypes);
    }

    try {
      const rows = this.db.prepare(`
        SELECT
          mr.source_memory_id as source_id,
          mr.target_memory_id as target_id,
          mr.id as relation_id,
          mr.relation_type,
          mr.confidence,
          COALESCE(mr.weight, 1.0) as weight
        FROM memory_relations mr
        WHERE mr.confidence >= ?
          AND (
            (mr.source_memory_id IN (${placeholders}) AND mr.target_memory_id NOT IN (${placeholders}))
            OR
            (mr.target_memory_id IN (${placeholders}) AND mr.source_memory_id NOT IN (${placeholders}))
          )
          ${relationTypeFilter}
        ORDER BY mr.confidence DESC
      `).all(...allParams) as Array<{
        source_id: number;
        target_id: number;
        relation_id: number;
        relation_type: string;
        confidence: number;
        weight: number;
      }>;

      const results: NeighborResult[] = [];
      const seen = new Set<number>();

      for (const row of rows) {
        // Her neighbor'ı sadece bir kez ekle
        if (!seen.has(row.target_id)) {
          seen.add(row.target_id);
          results.push({
            nodeId: row.source_id,
            neighborId: row.target_id,
            relationId: row.relation_id,
            relationType: row.relation_type,
            confidence: row.confidence,
            weight: row.weight,
          });
        }
      }

      return results;
    } catch (err) {
      logger.warn({ err }, '[GraphExpander] getNeighbors SQL hatası:');
      return [];
    }
  }

  /**
   * Seed node'larını veritabanından yükler.
   */
  private loadSeedNodes(ids: number[], result: Map<number, MemoryRow>): void {
    if (ids.length === 0) return;

    const placeholders = ids.map(() => '?').join(',');
    try {
      const rows = this.db.prepare(`
        SELECT * FROM memories WHERE id IN (${placeholders}) AND is_archived = 0
      `).all(...ids) as MemoryRow[];

      for (const row of rows) {
        result.set(row.id, row);
      }
    } catch (err) {
      logger.warn({ err }, '[GraphExpander] loadSeedNodes hatası:');
    }
  }

  /**
   * Birden fazla node'u tek bir batch sorgusuyla yükler (N+1 çözümü).
   *
   * Her ID için ayrı SELECT yerine, tüm ID'ler için tek WHERE id IN (?, ?, ...)
   * sorgusu atar. Dönen Map ile O(1) erişim sağlar.
   */
  private loadNodesBatch(ids: number[]): Map<number, MemoryRow> {
    const result = new Map<number, MemoryRow>();
    if (ids.length === 0) return result;

    const placeholders = ids.map(() => '?').join(',');
    try {
      const rows = this.db.prepare(`
        SELECT * FROM memories WHERE id IN (${placeholders}) AND is_archived = 0
      `).all(...ids) as MemoryRow[];

      for (const row of rows) {
        result.set(row.id, row);
      }
    } catch (err) {
      logger.warn({ err }, '[GraphExpander] loadNodesBatch hatası:');
    }
    return result;
  }

  /**
   * Birden fazla edge'i tek bir batch sorgusuyla yükler (N+1 çözümü).
   */
  private loadEdgesBatch(ids: number[]): Map<number, MemoryRelationRow> {
    const result = new Map<number, MemoryRelationRow>();
    if (ids.length === 0) return result;

    const placeholders = ids.map(() => '?').join(',');
    try {
      const rows = this.db.prepare(`
        SELECT * FROM memory_relations WHERE id IN (${placeholders})
      `).all(...ids) as MemoryRelationRow[];

      for (const row of rows) {
        result.set(row.id, row);
      }
    } catch (err) {
      logger.warn({ err }, '[GraphExpander] loadEdgesBatch hatası:');
    }
    return result;
  }

  /**
   * Cache entry'den sonuç oluşturur.
   */
  private buildResultFromCache(cached: { nodeIds: number[]; relationIds: number[] }): GraphExpansionResult {
    const nodes: MemoryRow[] = [];
    const edges: MemoryRelationRow[] = [];
    const hopDistances = new Map<number, number>();

    // Node'ları yükle
    if (cached.nodeIds.length > 0) {
      const placeholders = cached.nodeIds.map(() => '?').join(',');
      try {
        const rows = this.db.prepare(`
          SELECT * FROM memories WHERE id IN (${placeholders}) AND is_archived = 0
        `).all(...cached.nodeIds) as MemoryRow[];
        for (const row of rows) {
          nodes.push(row);
          hopDistances.set(row.id, 0); // Cache'den gelen node'ların hop distance'ı bilinmiyor
        }
      } catch (err) {
        logger.warn({ err }, '[GraphExpander] Cache node yükleme hatası:');
      }
    }

    // Edge'leri yükle
    if (cached.relationIds.length > 0) {
      const placeholders = cached.relationIds.map(() => '?').join(',');
      try {
        const rows = this.db.prepare(`
          SELECT * FROM memory_relations WHERE id IN (${placeholders})
        `).all(...cached.relationIds) as MemoryRelationRow[];
        edges.push(...rows);
      } catch (err) {
        logger.warn({ err }, '[GraphExpander] Cache edge yükleme hatası:');
      }
    }

    return {
      nodes,
      edges,
      hopDistances,
      maxHopReached: false,
    };
  }

  /**
   * Sonucun skorunu hesaplar (cache için).
   */
  private computeResultScore(result: GraphExpansionResult): number {
    if (result.nodes.length === 0) return 0;
    // Basit skor: node sayısı * ortalama edge confidence
    const avgConfidence = result.edges.length > 0
      ? result.edges.reduce((sum, e) => sum + e.confidence, 0) / result.edges.length
      : 0.5;
    return result.nodes.length * avgConfidence;
  }

  /**
   * Seçenekleri normalize eder (default değerler ile).
   */
  private normalizeOptions(options: Partial<GraphExpansionOptions> & { isFullPhase?: boolean }): GraphExpansionOptions {
    const isFullPhase = options.isFullPhase ?? false;
    return {
      seedNodeIds: options.seedNodeIds ?? [],
      maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
      maxNodes: options.maxNodes ?? (isFullPhase ? FULL_PHASE_MAX_NODES : DEFAULT_MAX_NODES),
      relationTypes: options.relationTypes,
      minConfidence: options.minConfidence ?? DEFAULT_MIN_CONFIDENCE,
      useCache: options.useCache ?? DEFAULT_USE_CACHE,
    };
  }

  // ========== DRIFT Search ==========

  /**
   * DRIFT Search: Dinamik, sorgu-odaklı graf genişleme.
   * 
   * Sabit maxHops yerine, her adımda bulunan düğümlerin sorguyla
   * alakasını ölçerek sadece umut vadeden yönlere derinleşir.
   * "Bu bağlam yeterli mi?" kontrolü ile erken çıkış yapar.
   * 
   * @param query - Kullanıcının sorusu (keyword eşleşmesi için)
   * @param options - Genişletme seçenekleri
   * @returns GraphExpansionResult
   */
  expandDrift(
    query: string,
    options: Partial<GraphExpansionOptions> & { isFullPhase?: boolean },
  ): GraphExpansionResult {
    const startTime = Date.now();
    const isFullPhase = options.isFullPhase ?? false;
    const timeoutMs = isFullPhase ? FULL_PHASE_TIMEOUT_MS : TRAVERSAL_TIMEOUT_MS;
    const opts = this.normalizeOptions(options);
    const maxDriftDepth = Math.min(opts.maxDepth + 1, 5); // DRIFT biraz daha derin olabilir

    // Sorgu kelimelerini hazırla (keyword matching için)
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

    const visited = new Set<number>(opts.seedNodeIds);
    const allNodes = new Map<number, MemoryRow>();
    const allEdges: MemoryRelationRow[] = [];
    const hopDistances = new Map<number, number>();

    // Seed node'ları yükle
    this.loadSeedNodes(opts.seedNodeIds, allNodes);
    for (const id of opts.seedNodeIds) {
      hopDistances.set(id, 0);
    }

    let currentLayer = [...opts.seedNodeIds];
    let maxHopReached = false;
    let sufficientContext = false;

    for (let hop = 1; hop <= maxDriftDepth; hop++) {
      // Timeout kontrolü
      if (Date.now() - startTime > timeoutMs) {
        logger.warn('[GraphExpander:DRIFT] Traversal timeout');
        break;
      }

      // maxNodes kontrolü
      if (allNodes.size >= opts.maxNodes) {
        maxHopReached = true;
        break;
      }

      // Early-exit: Yeterli bağlam bulundu mu?
      if (sufficientContext) {
        logger.debug(`[GraphExpander:DRIFT] Sufficient context at hop ${hop - 1}, early exit`);
        break;
      }

      // Komşuları getir
      const neighbors = this.getNeighbors(currentLayer, opts.minConfidence, opts.relationTypes);
      if (neighbors.length === 0) break;

      // ── Batch loading: N+1 önleme ──
      // Önce ziyaret edilmemiş komşuları filtrele, tüm node ID'lerini tek seferde yükle
      const unvisited = neighbors.filter(n => !visited.has(n.neighborId));
      const unvisitedNodeIds = unvisited.map(n => n.neighborId);
      const nodeBatch = this.loadNodesBatch(unvisitedNodeIds);

      // 🔧 DRIFT: Her komşuyu query relevance'a göre skorla
      type ScoredNeighbor = typeof neighbors[number] & { relevanceScore: number };
      const scoredNeighbors: ScoredNeighbor[] = unvisited
        .map(n => {
          const node = nodeBatch.get(n.neighborId);
          let relevanceScore = n.confidence * n.weight;

          // Keyword eşleşme bonusu
          if (node) {
            const content = node.content.toLowerCase();
            for (const word of queryWords) {
              if (content.includes(word)) relevanceScore += 0.3;
            }
            // Kategori eşleşme bonusu
            if (node.category) {
              const catLower = node.category.toLowerCase();
              for (const word of queryWords) {
                if (catLower.includes(word)) relevanceScore += 0.2;
              }
            }
          }

          return { ...n, relevanceScore };
        })
        .sort((a, b) => b.relevanceScore - a.relevanceScore);

      // Sadece en alakalı komşuları seç (pruning)
      const topNeighbors = scoredNeighbors.slice(0, Math.max(3, Math.ceil(scoredNeighbors.length * 0.3)));

      // Seçilen top neighbor'ların edge'lerini batch yükle
      const topEdgeIds = topNeighbors.map(n => n.relationId);
      const edgeBatch = this.loadEdgesBatch(topEdgeIds);

      const nextLayer: number[] = [];
      let highRelevanceCount = 0;

      for (const neighbor of topNeighbors) {
        if (allNodes.size >= opts.maxNodes) {
          maxHopReached = true;
          break;
        }

        visited.add(neighbor.neighborId);
        hopDistances.set(neighbor.neighborId, hop);

        // Batch'ten O(1) erişimle node'u al
        const node = nodeBatch.get(neighbor.neighborId) ?? null;
        if (node) {
          allNodes.set(neighbor.neighborId, node);
          if (neighbor.relevanceScore > 0.5) highRelevanceCount++;
        }

        // Batch'ten O(1) erişimle edge'i al
        const edge = edgeBatch.get(neighbor.relationId) ?? null;
        if (edge) {
          allEdges.push(edge);
        }

        nextLayer.push(neighbor.neighborId);
      }

      currentLayer = nextLayer;
      if (currentLayer.length === 0) break;

      // Yeterli bağlam kontrolü: Yüksek alakalı düğüm oranı düşükse dur
      if (hop >= 2 && highRelevanceCount === 0) {
        sufficientContext = true; // Bir sonraki iterasyonda erken çık
      }
    }

    const result: GraphExpansionResult = {
      nodes: Array.from(allNodes.values()),
      edges: allEdges,
      hopDistances,
      maxHopReached,
    };

    const elapsed = Date.now() - startTime;
    logger.debug(`[GraphExpander:DRIFT] Completed in ${elapsed}ms: ${allNodes.size} nodes, ${allEdges.length} edges (query-guided)`);

    return result;
  }
}
