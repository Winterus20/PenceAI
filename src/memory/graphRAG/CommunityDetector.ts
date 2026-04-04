/**
 * CommunityDetector — Graph Community Detection.
 * 
 * Graph'taki node'ları topluluklara ayırır. Bu, ilgili bellekleri gruplamak
 * ve özetlemek için kullanılır.
 * 
 * Algoritma: Greedy Modularity Optimization (basitleştirilmiş Louvain)
 * 
 * Algoritma Adımları:
 * 1. Başlangıç: Her node kendi community'si
 * 2. Her iterasyon:
 *    a. Her node için komşu community'lere katılma kazancını hesapla
 *    b. En yüksek kazançlı move'u uygula
 *    c. Kazanç yoksa dur
 * 3. Convergence: Modularity artışı < threshold
 */

import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger.js';
import type { MemoryRow, MemoryRelationRow } from '../types.js';

/** Community detection seçenekleri */
export interface CommunityDetectionOptions {
  minCommunitySize: number;    // Default: 3
  maxCommunities: number;      // Default: 20
  resolution: number;          // Default: 1.0 (daha yüksek = daha küçük community'ler)
  useCache: boolean;           // Default: true
}

/** Bir topluluk */
export interface Community {
  id: string;
  memberNodeIds: number[];
  modularityScore: number;
  dominantRelationTypes: string[];
  createdAt: Date;
}

/** Community detection sonucu */
export interface CommunityDetectionResult {
  communities: Community[];
  totalNodes: number;
  totalEdges: number;
  elapsedMs: number;
  cacheHit: boolean;
}

/** Veritabanı community satırı */
interface CommunityRow {
  id: string;
  modularity_score: number | null;
  dominant_relation_types: string;
  created_at: string;
  updated_at: string;
}

/** Veritabanı community member satırı */
interface CommunityMemberRow {
  community_id: string;
  node_id: number;
}

/** Edge bilgisi (weighted) */
interface WeightedEdge {
  source: number;
  target: number;
  weight: number;
  relationType: string;
}

/** Default ayarlar */
const DEFAULT_MIN_COMMUNITY_SIZE = 3;
const DEFAULT_MAX_COMMUNITIES = 20;
const DEFAULT_RESOLUTION = 1.0;
const DEFAULT_USE_CACHE = true;
const CONVERGENCE_THRESHOLD = 0.001;
const MAX_ITERATIONS = 50;
const COMMUNITY_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 saat

/** Community cache entry */
interface CommunityCacheEntry {
  communities: Community[];
  totalNodes: number;
  totalEdges: number;
  cachedAt: number;
}

export class CommunityDetector {
  private cache: CommunityCacheEntry | null = null;
  private cacheTimestamp: number = 0;

  constructor(private db: Database.Database) {}

  /**
   * Ana fonksiyon: Tüm graph için community detection.
   * 
   * @param options - Community detection seçenekleri
   * @returns CommunityDetectionResult
   */
  detectCommunities(options?: Partial<CommunityDetectionOptions>): CommunityDetectionResult {
    const startTime = Date.now();
    const opts = this.normalizeOptions(options);

    // Cache kontrolü
    if (opts.useCache && this.isCacheValid()) {
      logger.debug('[CommunityDetector] Cache hit — cached communities returned');
      return {
        communities: this.cache!.communities,
        totalNodes: this.cache!.totalNodes,
        totalEdges: this.cache!.totalEdges,
        elapsedMs: 0,
        cacheHit: true,
      };
    }

    // Graph'i yükle
    const { nodes, edges, totalWeight } = this.loadGraph();
    if (nodes.length === 0) {
      logger.warn('[CommunityDetector] Empty graph, returning empty communities');
      return { communities: [], totalNodes: 0, totalEdges: 0, elapsedMs: Date.now() - startTime, cacheHit: false };
    }

    // Büyük graph'lerde sampling yap (performans için)
    const sampledNodes = nodes.length > 500 ? this.sampleNodes(nodes, 500) : nodes;
    const sampledNodeIds = new Set(sampledNodes.map(n => n.id));
    const sampledEdges = edges.filter(e => sampledNodeIds.has(e.source) && sampledNodeIds.has(e.target));

    logger.info(`[CommunityDetector] Running community detection on ${sampledNodes.length} nodes, ${sampledEdges.length} edges`);

    // Greedy Modularity Optimization
    const communities = this.greedyModularityOptimization(sampledNodes, sampledEdges, totalWeight, opts);

    // Küçük community'leri filtrele
    const filteredCommunities = this.filterSmallCommunities(communities, opts.minCommunitySize);

    // En büyük maxCommunities kadar community'yi al
    const sortedCommunities = filteredCommunities
      .sort((a, b) => b.modularityScore - a.modularityScore)
      .slice(0, opts.maxCommunities);

    // Dominant relation tiplerini hesapla
    for (const community of sortedCommunities) {
      community.dominantRelationTypes = this.computeDominantRelationTypes(community, edges);
    }

    // Community'leri veritabanına kaydet
    this.saveCommunities(sortedCommunities);

    // Cache'e kaydet
    this.cache = {
      communities: sortedCommunities,
      totalNodes: nodes.length,
      totalEdges: edges.length,
      cachedAt: Date.now(),
    };
    this.cacheTimestamp = Date.now();

    const elapsed = Date.now() - startTime;
    logger.info(`[CommunityDetector] Detection completed in ${elapsed}ms: ${sortedCommunities.length} communities found`);

    return {
      communities: sortedCommunities,
      totalNodes: nodes.length,
      totalEdges: edges.length,
      elapsedMs: elapsed,
      cacheHit: false,
    };
  }

  /**
   * Belirli node'lar için local community detection.
   * Seed node'ların komşuluk graph'inde community detection yapar.
   * 
   * @param seedNodeIds - Başlangıç node ID'leri
   * @param maxDepth - Maksimum komşuluk derinliği
   * @returns Community[]
   */
  detectLocalCommunity(seedNodeIds: number[], maxDepth: number = 2): Community[] {
    if (seedNodeIds.length === 0) return [];

    // Seed node'ların komşuluk graph'ini yükle
    const { nodes, edges, totalWeight } = this.loadLocalGraph(seedNodeIds, maxDepth);
    if (nodes.length === 0) return [];

    const opts = this.normalizeOptions({});

    // Local community detection
    const communities = this.greedyModularityOptimization(nodes, edges, totalWeight, opts);
    const filteredCommunities = this.filterSmallCommunities(communities, opts.minCommunitySize);

    // Dominant relation tiplerini hesapla
    for (const community of filteredCommunities) {
      community.dominantRelationTypes = this.computeDominantRelationTypes(community, edges);
    }

    return filteredCommunities.sort((a, b) => b.modularityScore - a.modularityScore);
  }

  /**
   * Belirli bir node'un ait olduğu community'leri getir.
   * 
   * @param nodeId - Node ID
   * @returns Community[]
   */
  getNodeCommunities(nodeId: number): Community[] {
    try {
      const communityIds = this.db.prepare(`
        SELECT community_id FROM graph_community_members WHERE node_id = ?
      `).all(nodeId) as CommunityMemberRow[];

      if (communityIds.length === 0) return [];

      const idList = communityIds.map(c => c.community_id);
      const placeholders = idList.map(() => '?').join(',');

      const communities = this.db.prepare(`
        SELECT id, modularity_score, dominant_relation_types, created_at, updated_at
        FROM graph_communities
        WHERE id IN (${placeholders})
      `).all(...idList) as CommunityRow[];

      const result: Community[] = [];
      for (const row of communities) {
        const members = this.db.prepare(`
          SELECT node_id FROM graph_community_members WHERE community_id = ?
        `).all(row.id) as CommunityMemberRow[];

        result.push({
          id: row.id,
          memberNodeIds: members.map(m => m.node_id),
          modularityScore: row.modularity_score ?? 0,
          dominantRelationTypes: row.dominant_relation_types
            ? JSON.parse(row.dominant_relation_types)
            : [],
          createdAt: new Date(row.created_at),
        });
      }

      return result;
    } catch (err) {
      logger.warn({ err }, '[CommunityDetector] getNodeCommunities hatası:');
      return [];
    }
  }

  /**
   * Community'leri veritabanına kaydet.
   */
  private saveCommunities(communities: Community[]): void {
    if (communities.length === 0) return;

    try {
      // Önce eski community'leri temizle
      this.db.exec('DELETE FROM graph_community_members');
      this.db.exec('DELETE FROM graph_communities');

      const insertCommunity = this.db.prepare(`
        INSERT INTO graph_communities (id, modularity_score, dominant_relation_types, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      const insertMember = this.db.prepare(`
        INSERT INTO graph_community_members (community_id, node_id) VALUES (?, ?)
      `);

      const runSave = this.db.transaction(() => {
        for (const community of communities) {
          const now = community.createdAt.toISOString().replace('T', ' ').substring(0, 19);
          insertCommunity.run(
            community.id,
            community.modularityScore,
            JSON.stringify(community.dominantRelationTypes),
            now,
            now,
          );

          for (const nodeId of community.memberNodeIds) {
            insertMember.run(community.id, nodeId);
          }
        }
      });

      runSave();
      logger.debug(`[CommunityDetector] ${communities.length} communities saved to database`);
    } catch (err) {
      logger.warn({ err }, '[CommunityDetector] saveCommunities hatası:');
    }
  }

  /**
   * Cache'den community'leri yükle.
   */
  private loadCachedCommunities(): Community[] | null {
    try {
      const communities = this.db.prepare(`
        SELECT id, modularity_score, dominant_relation_types, created_at, updated_at
        FROM graph_communities
        WHERE updated_at >= datetime('now', '-6 hours')
        ORDER BY modularity_score DESC
      `).all() as CommunityRow[];

      if (communities.length === 0) return null;

      const result: Community[] = [];
      for (const row of communities) {
        const members = this.db.prepare(`
          SELECT node_id FROM graph_community_members WHERE community_id = ?
        `).all(row.id) as CommunityMemberRow[];

        result.push({
          id: row.id,
          memberNodeIds: members.map(m => m.node_id),
          modularityScore: row.modularity_score ?? 0,
          dominantRelationTypes: row.dominant_relation_types
            ? JSON.parse(row.dominant_relation_types)
            : [],
          createdAt: new Date(row.created_at),
        });
      }

      return result;
    } catch (err) {
      logger.warn({ err }, '[CommunityDetector] loadCachedCommunities hatası:');
      return null;
    }
  }

  /**
   * Cache geçerli mi kontrol et.
   */
  private isCacheValid(): boolean {
    if (!this.cache || this.cacheTimestamp === 0) {
      // DB'den yükle
      const cached = this.loadCachedCommunities();
      if (cached && cached.length > 0) {
        this.cache = {
          communities: cached,
          totalNodes: cached.reduce((sum, c) => sum + c.memberNodeIds.length, 0),
          totalEdges: 0, // Bilinmiyor
          cachedAt: Date.now(),
        };
        this.cacheTimestamp = Date.now();
        return true;
      }
      return false;
    }

    return Date.now() - this.cacheTimestamp < COMMUNITY_CACHE_TTL_MS;
  }

  /**
   * Modularity hesaplama.
   * Q = (1/2m) * Σ[A_ij - γ * (k_i * k_j / 2m)] * δ(c_i, c_j)
   */
  computeModularity(community: Community, edges: WeightedEdge[], totalWeight: number): number {
    if (community.memberNodeIds.length === 0 || totalWeight === 0) return 0;

    const memberSet = new Set(community.memberNodeIds);
    const gamma = 1.0; // Resolution parametresi
    let modularity = 0;

    // Node degree'lerini hesapla
    const degrees = new Map<number, number>();
    for (const edge of edges) {
      degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + edge.weight);
      degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + edge.weight);
    }

    // Community içi edge'leri topla
    for (const edge of edges) {
      if (memberSet.has(edge.source) && memberSet.has(edge.target)) {
        const ki = degrees.get(edge.source) ?? 0;
        const kj = degrees.get(edge.target) ?? 0;
        modularity += edge.weight - gamma * (ki * kj) / (2 * totalWeight);
      }
    }

    return modularity / (2 * totalWeight);
  }

  /**
   * Greedy Modularity Optimization algoritması.
   */
  private greedyModularityOptimization(
    nodes: MemoryRow[],
    edges: WeightedEdge[],
    totalWeight: number,
    options: CommunityDetectionOptions,
  ): Community[] {
    if (nodes.length === 0) return [];

    // Başlangıç: Her node kendi community'si
    const nodeToCommunity = new Map<number, string>();
    const communities = new Map<string, number[]>();

    for (const node of nodes) {
      const communityId = `comm_${node.id}`;
      nodeToCommunity.set(node.id, communityId);
      communities.set(communityId, [node.id]);
    }

    // Node degree'lerini hesapla
    const degrees = new Map<number, number>();
    for (const edge of edges) {
      degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + edge.weight);
      degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + edge.weight);
    }

    // Adjacency list oluştur
    const adjacency = new Map<number, Map<number, number>>();
    for (const edge of edges) {
      if (!adjacency.has(edge.source)) {
        adjacency.set(edge.source, new Map());
      }
      if (!adjacency.has(edge.target)) {
        adjacency.set(edge.target, new Map());
      }
      adjacency.get(edge.source)!.set(edge.target, edge.weight);
      adjacency.get(edge.target)!.set(edge.source, edge.weight);
    }

    let iteration = 0;
    let prevModularity = -Infinity;

    while (iteration < MAX_ITERATIONS) {
      let moved = false;

      // Her node için komşu community'lere katılma kazancını hesapla
      for (const node of nodes) {
        const currentCommunity = nodeToCommunity.get(node.id)!;
        const neighbors = adjacency.get(node.id);
        if (!neighbors || neighbors.size === 0) continue;

        // Her komşu community için delta modularity hesapla
        const communityGains = new Map<string, number>();

        for (const [neighborId] of neighbors) {
          const neighborCommunity = nodeToCommunity.get(neighborId)!;
          if (neighborCommunity === currentCommunity) continue;

          if (!communityGains.has(neighborCommunity)) {
            communityGains.set(neighborCommunity, 0);
          }

          // ΔQ = [k_i,in + 2 * w_ij] / 2m - γ * [Σ_tot + k_i] * k_i / (2m)²
          const weight = neighbors.get(neighborId) ?? 0;
          const ki = degrees.get(node.id) ?? 0;
          const gain = weight / totalWeight - (ki * ki) / (4 * totalWeight * totalWeight);
          communityGains.set(neighborCommunity, communityGains.get(neighborCommunity)! + gain);
        }

        // En yüksek kazançlı community'yi bul
        let bestGain = 0;
        let bestCommunity = currentCommunity;

        for (const [commId, gain] of communityGains) {
          if (gain > bestGain) {
            bestGain = gain;
            bestCommunity = commId;
          }
        }

        // Move uygula
        if (bestCommunity !== currentCommunity) {
          // Eski community'den çıkar
          const oldMembers = communities.get(currentCommunity)!;
          const idx = oldMembers.indexOf(node.id);
          if (idx !== -1) oldMembers.splice(idx, 1);

          // Yeni community'ye ekle
          if (!communities.has(bestCommunity)) {
            communities.set(bestCommunity, []);
          }
          communities.get(bestCommunity)!.push(node.id);
          nodeToCommunity.set(node.id, bestCommunity);
          moved = true;
        }
      }

      // Convergence kontrolü
      const currentModularity = this.computeGlobalModularity(communities, edges, totalWeight);
      const modularityGain = currentModularity - prevModularity;

      if (!moved || modularityGain < CONVERGENCE_THRESHOLD) {
        logger.debug(`[CommunityDetector] Converged after ${iteration + 1} iterations, Q=${currentModularity.toFixed(4)}`);
        break;
      }

      prevModularity = currentModularity;
      iteration++;
    }

    // Community objelerini oluştur
    const result: Community[] = [];
    for (const [commId, memberIds] of communities) {
      if (memberIds.length === 0) continue;

      const community: Community = {
        id: uuidv4(),
        memberNodeIds: memberIds,
        modularityScore: 0,
        dominantRelationTypes: [],
        createdAt: new Date(),
      };

      // Community modularity skorunu hesapla
      community.modularityScore = this.computeModularity(community, edges, totalWeight);
      result.push(community);
    }

    return result;
  }

  /**
   * Global modularity hesaplama.
   */
  private computeGlobalModularity(
    communities: Map<string, number[]>,
    edges: WeightedEdge[],
    totalWeight: number,
  ): number {
    if (totalWeight === 0) return 0;

    const nodeToCommunity = new Map<number, string>();
    for (const [commId, members] of communities) {
      for (const nodeId of members) {
        nodeToCommunity.set(nodeId, commId);
      }
    }

    let modularity = 0;
    const degrees = new Map<number, number>();

    for (const edge of edges) {
      degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + edge.weight);
      degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + edge.weight);
    }

    for (const edge of edges) {
      const ci = nodeToCommunity.get(edge.source);
      const cj = nodeToCommunity.get(edge.target);
      if (ci === cj) {
        const ki = degrees.get(edge.source) ?? 0;
        const kj = degrees.get(edge.target) ?? 0;
        modularity += edge.weight - (ki * kj) / (2 * totalWeight);
      }
    }

    return modularity / (2 * totalWeight);
  }

  /**
   * Küçük community'leri filtrele.
   */
  private filterSmallCommunities(communities: Community[], minSize: number): Community[] {
    return communities.filter(c => c.memberNodeIds.length >= minSize);
  }

  /**
   * Dominant relation tiplerini hesapla.
   */
  private computeDominantRelationTypes(community: Community, edges: WeightedEdge[]): string[] {
    const memberSet = new Set(community.memberNodeIds);
    const typeCounts = new Map<string, number>();

    for (const edge of edges) {
      if (memberSet.has(edge.source) && memberSet.has(edge.target)) {
        typeCounts.set(edge.relationType, (typeCounts.get(edge.relationType) ?? 0) + 1);
      }
    }

    return Array.from(typeCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type]) => type);
  }

  /**
   * Graph'i veritabanından yükle.
   */
  private loadGraph(): { nodes: MemoryRow[]; edges: WeightedEdge[]; totalWeight: number } {
    const nodes = this.db.prepare(`
      SELECT * FROM memories WHERE is_archived = 0
    `).all() as MemoryRow[];

    const nodeIds = new Set(nodes.map(n => n.id));
    const edges = this.db.prepare(`
      SELECT source_memory_id, target_memory_id, COALESCE(weight, 1.0) as weight, relation_type
      FROM memory_relations
      WHERE confidence >= 0.1
    `).all() as Array<{
      source_memory_id: number;
      target_memory_id: number;
      weight: number;
      relation_type: string;
    }>;

    const weightedEdges: WeightedEdge[] = [];
    let totalWeight = 0;

    for (const edge of edges) {
      if (nodeIds.has(edge.source_memory_id) && nodeIds.has(edge.target_memory_id)) {
        weightedEdges.push({
          source: edge.source_memory_id,
          target: edge.target_memory_id,
          weight: edge.weight,
          relationType: edge.relation_type,
        });
        totalWeight += edge.weight;
      }
    }

    return { nodes, edges: weightedEdges, totalWeight };
  }

  /**
   * Local graph'i yükle (seed node'ların komşuluğu).
   */
  private loadLocalGraph(
    seedNodeIds: number[],
    maxDepth: number,
  ): { nodes: MemoryRow[]; edges: WeightedEdge[]; totalWeight: number } {
    const visited = new Set<number>(seedNodeIds);
    let currentLayer = [...seedNodeIds];

    // BFS ile komşuları bul
    for (let depth = 0; depth < maxDepth; depth++) {
      if (currentLayer.length === 0) break;

      const placeholders = currentLayer.map(() => '?').join(',');
      const neighbors = this.db.prepare(`
        SELECT DISTINCT
          CASE
            WHEN mr.source_memory_id IN (${placeholders}) THEN mr.target_memory_id
            ELSE mr.source_memory_id
          END as neighbor_id
        FROM memory_relations mr
        WHERE mr.confidence >= 0.1
          AND (mr.source_memory_id IN (${placeholders}) OR mr.target_memory_id IN (${placeholders}))
      `).all(...currentLayer, ...currentLayer, ...currentLayer) as Array<{ neighbor_id: number }>;

      const nextLayer: number[] = [];
      for (const n of neighbors) {
        if (!visited.has(n.neighbor_id)) {
          visited.add(n.neighbor_id);
          nextLayer.push(n.neighbor_id);
        }
      }
      currentLayer = nextLayer;
    }

    // Node'ları yükle
    const allNodeIds = Array.from(visited);
    const nodePlaceholders = allNodeIds.map(() => '?').join(',');
    const nodes = this.db.prepare(`
      SELECT * FROM memories WHERE id IN (${nodePlaceholders}) AND is_archived = 0
    `).all(...allNodeIds) as MemoryRow[];

    // Edge'leri yükle
    const edges = this.db.prepare(`
      SELECT source_memory_id, target_memory_id, COALESCE(weight, 1.0) as weight, relation_type
      FROM memory_relations
      WHERE confidence >= 0.1
        AND source_memory_id IN (${nodePlaceholders})
        AND target_memory_id IN (${nodePlaceholders})
    `).all(...allNodeIds, ...allNodeIds) as Array<{
      source_memory_id: number;
      target_memory_id: number;
      weight: number;
      relation_type: string;
    }>;

    const weightedEdges: WeightedEdge[] = edges.map(e => ({
      source: e.source_memory_id,
      target: e.target_memory_id,
      weight: e.weight,
      relationType: e.relation_type,
    }));

    const totalWeight = weightedEdges.reduce((sum, e) => sum + e.weight, 0);

    return { nodes, edges: weightedEdges, totalWeight };
  }

  /**
   * Büyük graph'lerde random sampling yap.
   */
  private sampleNodes(nodes: MemoryRow[], maxNodes: number): MemoryRow[] {
    if (nodes.length <= maxNodes) return nodes;

    // Önemli node'ları (yüksek importance, yüksek access_count) öncelikli al
    const sorted = [...nodes].sort((a, b) => {
      const scoreA = (a.importance ?? 5) * 2 + (a.access_count ?? 0);
      const scoreB = (b.importance ?? 5) * 2 + (b.access_count ?? 0);
      return scoreB - scoreA;
    });

    // İlk %50'yi önemli node'lardan, geri kalanı random al
    const importantCount = Math.floor(maxNodes * 0.5);
    const randomCount = maxNodes - importantCount;

    const important = sorted.slice(0, importantCount);
    const remaining = sorted.slice(importantCount);

    // Random sampling
    const shuffled = remaining.sort(() => Math.random() - 0.5);
    const random = shuffled.slice(0, randomCount);

    return [...important, ...random];
  }

  /**
   * Seçenekleri normalize et.
   */
  private normalizeOptions(options?: Partial<CommunityDetectionOptions>): CommunityDetectionOptions {
    return {
      minCommunitySize: options?.minCommunitySize ?? DEFAULT_MIN_COMMUNITY_SIZE,
      maxCommunities: options?.maxCommunities ?? DEFAULT_MAX_COMMUNITIES,
      resolution: options?.resolution ?? DEFAULT_RESOLUTION,
      useCache: options?.useCache ?? DEFAULT_USE_CACHE,
    };
  }
}
