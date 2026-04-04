/**
 * GraphRAGEngine — GraphRAG Engine Orchestrator.
 * 
 * Tüm GraphRAG bileşenlerini koordine eden ana orchestrator.
 * Retrieval pipeline'dan çağrılır ve tüm GraphRAG işlemlerini yönetir.
 * 
 * Çalışma Mantığı:
 * 1. Query al
 * 2. Standard hybrid search yap (baseline)
 * 3. Graph expansion yap (seed nodes = initial results)
 * 4. PageRank scoring uygula
 * 5. Community detection yap (eğer cache'te yoksa)
 * 6. Community özetleri getir/oluştur
 * 7. Token budget kontrolü → TokenPruner ile prune et
 * 8. RRF fusion ile final ranking
 * 9. Result döndür
 * 
 * Hata Yönetimi:
 * - Her phase'de timeout kontrolü
 * - Herhangi bir phase başarısız olursa → fallback to standard search
 * - Hata detayını result'a ekle
 */

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';
import type { MemoryRow } from '../types.js';
import type { GraphExpander } from './GraphExpander.js';
import type { PageRankScorer } from './PageRankScorer.js';
import type { CommunityDetector } from './CommunityDetector.js';
import type { CommunitySummarizer, CommunitySummary } from './CommunitySummarizer.js';
import type { GraphCache } from './GraphCache.js';
import { TokenPruner, type TokenBudget, type PruningResult } from './TokenPruner.js';

/** GraphRAG konfigürasyonu */
export interface GraphRAGConfig {
  maxHops: number;              // Default: 2
  maxExpandedNodes: number;     // Default: 50
  minConfidence: number;        // Default: 0.3
  usePageRank: boolean;         // Default: true
  useCommunities: boolean;      // Default: true
  useCache: boolean;            // Default: true
  tokenBudget: number;          // Default: 32000 (128K'nin %25'i)
  communitySummaryBudget: number; // Default: 8000
  timeoutMs: number;            // Default: 5000
  fallbackToStandardSearch: boolean; // Default: true
}

/** Graph context bilgisi */
export interface GraphContext {
  expandedNodeIds: number[];
  edgeCount: number;
  maxHopReached: boolean;
  communityCount: number;
  pageRankApplied: boolean;
}

/** Arama meta verisi */
export interface SearchMetadata {
  duration: number;
  cacheHit: boolean;
  tokenUsage: number;
  fallbackUsed: boolean;
  phase: 'expansion' | 'scoring' | 'community' | 'summary' | 'fusion';
}

/** GraphRAG sonucu */
export interface GraphRAGResult {
  success: boolean;
  memories: MemoryRow[];
  communitySummaries: CommunitySummary[];
  graphContext: GraphContext;
  searchMetadata: SearchMetadata;
  error?: string;
}

/** Internal: Expansion sonucu */
interface ExpansionResult {
  nodes: MemoryRow[];
  edges: Array<{ id: number; source: number; target: number; type: string; confidence: number }>;
  hopDistances: Map<number, number>;
  maxHopReached: boolean;
  cacheHit: boolean;
}

/** Internal: Scoring sonucu */
interface ScoringResult {
  scores: Map<number, number>;
}

/** Internal: Community sonucu */
interface CommunityResult {
  communities: Array<{ id: string; memberNodeIds: number[]; modularityScore: number }>;
  cacheHit: boolean;
}

/** Internal: Summary sonucu */
interface SummaryResult {
  summaries: CommunitySummary[];
}

/** Internal: Tüm sonuçlar */
interface AllResults {
  initialResults: MemoryRow[];
  expansion: ExpansionResult;
  scoring: ScoringResult;
  community: CommunityResult;
  summary: SummaryResult;
}

/** Default konfigürasyon */
const DEFAULT_CONFIG: GraphRAGConfig = {
  maxHops: 2,
  maxExpandedNodes: 50,
  minConfidence: 0.3,
  usePageRank: true,
  useCommunities: true,
  useCache: true,
  tokenBudget: 32000,
  communitySummaryBudget: 8000,
  timeoutMs: 5000,
  fallbackToStandardSearch: true,
};

/** Feature flag */
let GRAPH_RAG_ENABLED = true;

/**
 * Token budget dağılımını hesapla.
 */
function computeTokenBudget(config: GraphRAGConfig): TokenBudget {
  const total = config.tokenBudget;
  const summaryBudget = config.communitySummaryBudget;
  const remaining = total - summaryBudget;
  const graphContextBudget = Math.floor(remaining * 0.25);
  const memoryBudget = remaining - graphContextBudget;

  return {
    total,
    memories: memoryBudget,
    communitySummaries: summaryBudget,
    graphContext: graphContextBudget,
  };
}

export class GraphRAGEngine {
  private config: GraphRAGConfig;
  private tokenPruner: TokenPruner;

  constructor(
    private db: Database.Database,
    private expander: GraphExpander,
    private pageRankScorer: PageRankScorer,
    private communityDetector: CommunityDetector,
    private communitySummarizer: CommunitySummarizer,
    private graphCache: GraphCache,
    private hybridSearchFn: (query: string, limit: number) => Promise<MemoryRow[]>,
    config?: Partial<GraphRAGConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tokenPruner = new TokenPruner({
      budget: computeTokenBudget(this.config),
    });
  }

  /**
   * Feature flag kontrolü.
   */
  static isEnabled(): boolean {
    return GRAPH_RAG_ENABLED;
  }

  static setEnabled(enabled: boolean): void {
    GRAPH_RAG_ENABLED = enabled;
    logger.info(`[GraphRAGEngine] GraphRAG ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Ana fonksiyon: GraphRAG retrieval.
   * 
   * @param query - Arama sorgusu
   * @param options - Opsiyonel konfigürasyon
   * @returns GraphRAGResult
   */
  async retrieve(query: string, options?: Partial<GraphRAGConfig>): Promise<GraphRAGResult> {
    const startTime = Date.now();
    const config = { ...this.config, ...options };

    // Feature flag kontrolü
    if (!GRAPH_RAG_ENABLED) {
      return this.fallbackToStandard(query, config, startTime, true);
    }

    try {
      // Phase 1: Standard hybrid search (baseline)
      const initialResults = await this.runWithTimeout(
        () => this.hybridSearchFn(query, config.maxExpandedNodes),
        config.timeoutMs,
        'initial_search',
      );

      if (initialResults.length === 0) {
        return this.buildEmptyResult(startTime, false);
      }

      // Phase 2: Graph expansion
      const expansion = await this.runExpansion(initialResults, config, startTime);
      if (!expansion.success) {
        return expansion.fallback ?? this.fallbackToStandard(query, config, startTime, false);
      }

      // Phase 3: PageRank scoring
      const scoring = await this.runScoring(expansion.result, config, startTime);
      if (!scoring.success) {
        return scoring.fallback ?? this.fallbackToStandard(query, config, startTime, false);
      }

      // Phase 4: Community detection
      const community = await this.runCommunityDetection(scoring.result, expansion.result, config, startTime);
      if (!community.success) {
        // Community detection başarısız olsa bile devam et
        logger.warn('[GraphRAGEngine] Community detection failed, continuing without communities');
      }

      // Phase 5: Summary generation
      const summary = await this.runSummarization(community.result, config, startTime);
      if (!summary.success) {
        logger.warn('[GraphRAGEngine] Summary generation failed, continuing without summaries');
      }

      // Phase 6: Token pruning ve fusion
      const fusionResult = await this.runFusion(
        {
          initialResults,
          expansion: expansion.result,
          scoring: scoring.result,
          community: community.result ?? { communities: [], cacheHit: false },
          summary: summary.result ?? { summaries: [] },
        },
        config,
        startTime,
      );

      return fusionResult;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error({ err }, '[GraphRAGEngine] Retrieval failed:');

      if (config.fallbackToStandardSearch) {
        return this.fallbackToStandard(query, config, startTime, false);
      }

      return {
        success: false,
        memories: [],
        communitySummaries: [],
        graphContext: {
          expandedNodeIds: [],
          edgeCount: 0,
          maxHopReached: false,
          communityCount: 0,
          pageRankApplied: false,
        },
        searchMetadata: {
          duration: Date.now() - startTime,
          cacheHit: false,
          tokenUsage: 0,
          fallbackUsed: true,
          phase: 'expansion',
        },
        error: errorMessage,
      };
    }
  }

  /**
   * Health check.
   */
  async healthCheck(): Promise<{
    expander: boolean;
    pageRank: boolean;
    communities: boolean;
    cache: boolean;
    overall: boolean;
  }> {
    const checks = {
      expander: false,
      pageRank: false,
      communities: false,
      cache: false,
      overall: false,
    };

    try {
      // Expander check
      const testExpansion = this.expander.expand({ seedNodeIds: [], maxDepth: 1, maxNodes: 1, minConfidence: 0, useCache: false });
      checks.expander = true;

      // PageRank check
      const testScores = this.pageRankScorer.computePageRank({ maxIterations: 1 });
      checks.pageRank = true;

      // Communities check
      const testCommunities = this.communityDetector.detectCommunities({ minCommunitySize: 1, maxCommunities: 1, useCache: false });
      checks.communities = true;

      // Cache check
      const cacheStats = this.graphCache.getStats();
      checks.cache = cacheStats.total >= 0; // Her zaman true (tablo varsa)

      checks.overall = checks.expander && checks.pageRank && checks.communities && checks.cache;
    } catch {
      checks.overall = false;
    }

    return checks;
  }

  /**
   * Phase 1: Graph expansion.
   */
  private async runExpansion(
    initialResults: MemoryRow[],
    config: GraphRAGConfig,
    startTime: number,
  ): Promise<{ success: boolean; result: ExpansionResult; fallback?: GraphRAGResult }> {
    try {
      await this.checkTimeout(startTime, config.timeoutMs, 'expansion');

      const seedNodeIds = initialResults.map(m => m.id);
      const expansion = this.expander.expand({
        seedNodeIds,
        maxDepth: config.maxHops,
        maxNodes: config.maxExpandedNodes,
        minConfidence: config.minConfidence,
        useCache: config.useCache,
      });

      return {
        success: true,
        result: {
          nodes: expansion.nodes,
          edges: expansion.edges.map(e => ({
            id: e.id,
            source: e.source_memory_id,
            target: e.target_memory_id,
            type: e.relation_type,
            confidence: e.confidence,
          })),
          hopDistances: expansion.hopDistances,
          maxHopReached: expansion.maxHopReached,
          cacheHit: false,
        },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.warn({ err }, '[GraphRAGEngine] Expansion phase failed:');

      if (config.fallbackToStandardSearch) {
        return {
          success: false,
          result: { nodes: [], edges: [], hopDistances: new Map(), maxHopReached: false, cacheHit: false },
          fallback: this.fallbackToStandardResult(initialResults, startTime, 'expansion', errorMessage),
        };
      }

      // Fallback disabled - return error result instead of throwing
      return {
        success: false,
        result: { nodes: [], edges: [], hopDistances: new Map(), maxHopReached: false, cacheHit: false },
        fallback: {
          success: false,
          memories: [],
          communitySummaries: [],
          graphContext: {
            expandedNodeIds: [],
            edgeCount: 0,
            maxHopReached: false,
            communityCount: 0,
            pageRankApplied: false,
          },
          searchMetadata: {
            duration: Date.now() - startTime,
            cacheHit: false,
            tokenUsage: 0,
            fallbackUsed: false,
            phase: 'expansion',
          },
          error: errorMessage,
        },
      };
    }
  }

  /**
   * Phase 2: PageRank scoring.
   */
  private async runScoring(
    expansion: ExpansionResult,
    config: GraphRAGConfig,
    startTime: number,
  ): Promise<{ success: boolean; result: ScoringResult; fallback?: GraphRAGResult }> {
    if (!config.usePageRank) {
      return {
        success: true,
        result: { scores: new Map() },
      };
    }

    try {
      await this.checkTimeout(startTime, config.timeoutMs, 'scoring');

      const expandedNodeIds = expansion.nodes.map(n => n.id);
      if (expandedNodeIds.length === 0) {
        return { success: true, result: { scores: new Map() } };
      }

      const scores = this.pageRankScorer.scoreSubgraph(expandedNodeIds);

      return {
        success: true,
        result: { scores },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.warn({ err }, '[GraphRAGEngine] Scoring phase failed:');

      if (config.fallbackToStandardSearch) {
        return {
          success: false,
          result: { scores: new Map() },
          fallback: this.fallbackToStandardResult([], startTime, 'scoring', errorMessage),
        };
      }

      // Fallback disabled - return error result
      return {
        success: false,
        result: { scores: new Map() },
        fallback: {
          success: false,
          memories: [],
          communitySummaries: [],
          graphContext: {
            expandedNodeIds: [],
            edgeCount: 0,
            maxHopReached: false,
            communityCount: 0,
            pageRankApplied: false,
          },
          searchMetadata: {
            duration: Date.now() - startTime,
            cacheHit: false,
            tokenUsage: 0,
            fallbackUsed: false,
            phase: 'scoring',
          },
          error: errorMessage,
        },
      };
    }
  }

  /**
   * Phase 3: Community detection.
   */
  private async runCommunityDetection(
    scoring: ScoringResult,
    expansion: ExpansionResult,
    config: GraphRAGConfig,
    startTime: number,
  ): Promise<{ success: boolean; result: CommunityResult }> {
    if (!config.useCommunities) {
      return {
        success: true,
        result: { communities: [], cacheHit: false },
      };
    }

    try {
      await this.checkTimeout(startTime, config.timeoutMs, 'community');

      const expandedNodeIds = expansion.nodes.map(n => n.id);
      if (expandedNodeIds.length === 0) {
        return { success: true, result: { communities: [], cacheHit: false } };
      }

      const detectionResult = this.communityDetector.detectLocalCommunity(expandedNodeIds, config.maxHops);

      return {
        success: true,
        result: {
          communities: detectionResult.map(c => ({
            id: c.id,
            memberNodeIds: c.memberNodeIds,
            modularityScore: c.modularityScore,
          })),
          cacheHit: false,
        },
      };
    } catch (err) {
      logger.warn({ err }, '[GraphRAGEngine] Community detection phase failed:');
      return {
        success: false,
        result: { communities: [], cacheHit: false },
      };
    }
  }

  /**
   * Phase 4: Summary generation.
   */
  private async runSummarization(
    community: CommunityResult,
    config: GraphRAGConfig,
    startTime: number,
  ): Promise<{ success: boolean; result: SummaryResult }> {
    if (!config.useCommunities || community.communities.length === 0) {
      return {
        success: true,
        result: { summaries: [] },
      };
    }

    try {
      await this.checkTimeout(startTime, config.timeoutMs, 'summary');

      const summaries: CommunitySummary[] = [];
      
      // İlk 3 community için summary getir/oluştur
      for (const comm of community.communities.slice(0, 3)) {
        const existingSummary = this.communitySummarizer.getSummary(comm.id);
        if (existingSummary) {
          summaries.push(existingSummary);
        }
      }

      return {
        success: true,
        result: { summaries },
      };
    } catch (err) {
      logger.warn({ err }, '[GraphRAGEngine] Summarization phase failed:');
      return {
        success: false,
        result: { summaries: [] },
      };
    }
  }

  /**
   * Phase 5: Token pruning ve fusion.
   */
  private async runFusion(
    results: AllResults,
    config: GraphRAGConfig,
    startTime: number,
  ): Promise<GraphRAGResult> {
    await this.checkTimeout(startTime, config.timeoutMs, 'fusion');

    // Token pruning
    const pruningResult = this.tokenPruner.prune(
      results.expansion.nodes,
      results.summary.summaries,
    );

    // RRF fusion ile final ranking
    const finalMemories = this.rrfFusion(
      results.initialResults,
      pruningResult.prunedMemories,
      results.scoring.scores,
      config.maxExpandedNodes,
    );

    const elapsed = Date.now() - startTime;

    return {
      success: true,
      memories: finalMemories,
      communitySummaries: pruningResult.prunedSummaries,
      graphContext: {
        expandedNodeIds: results.expansion.nodes.map(n => n.id),
        edgeCount: results.expansion.edges.length,
        maxHopReached: results.expansion.maxHopReached,
        communityCount: results.community.communities.length,
        pageRankApplied: config.usePageRank,
      },
      searchMetadata: {
        duration: elapsed,
        cacheHit: results.expansion.cacheHit,
        tokenUsage: pruningResult.totalTokens,
        fallbackUsed: false,
        phase: 'fusion',
      },
    };
  }

  /**
   * RRF fusion ile final ranking.
   */
  private rrfFusion(
    initialResults: MemoryRow[],
    expandedNodes: MemoryRow[],
    scores: Map<number, number>,
    maxResults: number,
  ): MemoryRow[] {
    const K = 60; // RRF constant
    const allNodes = new Map<number, { node: MemoryRow; rrfScore: number }>();

    // Initial results için RRF score
    for (let rank = 0; rank < initialResults.length; rank++) {
      const node = initialResults[rank];
      const rrfScore = 1 / (K + rank + 1);
      allNodes.set(node.id, { node, rrfScore });
    }

    // Expanded nodes için RRF score
    const sortedExpanded = [...expandedNodes].sort((a, b) => {
      const scoreA = scores.get(a.id) ?? 0;
      const scoreB = scores.get(b.id) ?? 0;
      return scoreB - scoreA;
    });

    for (let rank = 0; rank < sortedExpanded.length; rank++) {
      const node = sortedExpanded[rank];
      const pageRankScore = scores.get(node.id) ?? 0;
      const rrfScore = 1 / (K + rank + 1) + pageRankScore;

      const existing = allNodes.get(node.id);
      if (existing) {
        existing.rrfScore += rrfScore;
      } else {
        allNodes.set(node.id, { node, rrfScore });
      }
    }

    // Final ranking
    return Array.from(allNodes.values())
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, maxResults)
      .map(item => item.node);
  }

  /**
   * Fallback to standard search.
   */
  private async fallbackToStandard(
    query: string,
    config: GraphRAGConfig,
    startTime: number,
    flagDisabled: boolean,
  ): Promise<GraphRAGResult> {
    try {
      const standardResults = await this.hybridSearchFn(query, config.maxExpandedNodes);
      const elapsed = Date.now() - startTime;

      return {
        success: true,
        memories: standardResults,
        communitySummaries: [],
        graphContext: {
          expandedNodeIds: [],
          edgeCount: 0,
          maxHopReached: false,
          communityCount: 0,
          pageRankApplied: false,
        },
        searchMetadata: {
          duration: elapsed,
          cacheHit: false,
          tokenUsage: 0,
          fallbackUsed: true,
          phase: 'expansion',
        },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error({ err }, '[GraphRAGEngine] Fallback search failed:');

      return {
        success: false,
        memories: [],
        communitySummaries: [],
        graphContext: {
          expandedNodeIds: [],
          edgeCount: 0,
          maxHopReached: false,
          communityCount: 0,
          pageRankApplied: false,
        },
        searchMetadata: {
          duration: Date.now() - startTime,
          cacheHit: false,
          tokenUsage: 0,
          fallbackUsed: true,
          phase: 'expansion',
        },
        error: errorMessage,
      };
    }
  }

  /**
   * Fallback result builder.
   */
  private fallbackToStandardResult(
    initialResults: MemoryRow[],
    startTime: number,
    phase: SearchMetadata['phase'],
    error: string,
  ): GraphRAGResult {
    return {
      success: true,
      memories: initialResults,
      communitySummaries: [],
      graphContext: {
        expandedNodeIds: [],
        edgeCount: 0,
        maxHopReached: false,
        communityCount: 0,
        pageRankApplied: false,
      },
      searchMetadata: {
        duration: Date.now() - startTime,
        cacheHit: false,
        tokenUsage: 0,
        fallbackUsed: true,
        phase,
      },
      error,
    };
  }

  /**
   * Empty result builder.
   */
  private buildEmptyResult(startTime: number, cacheHit: boolean): GraphRAGResult {
    return {
      success: true,
      memories: [],
      communitySummaries: [],
      graphContext: {
        expandedNodeIds: [],
        edgeCount: 0,
        maxHopReached: false,
        communityCount: 0,
        pageRankApplied: false,
      },
      searchMetadata: {
        duration: Date.now() - startTime,
        cacheHit,
        tokenUsage: 0,
        fallbackUsed: false,
        phase: 'expansion',
      },
    };
  }

  /**
   * Timeout kontrolü.
   */
  private async checkTimeout(startTime: number, timeoutMs: number, phase: string): Promise<void> {
    const elapsed = Date.now() - startTime;
    if (elapsed > timeoutMs) {
      throw new Error(`GraphRAG ${phase} timeout after ${elapsed}ms (limit: ${timeoutMs}ms)`);
    }
  }

  /**
   * Timeout ile async çalıştırma.
   */
  private async runWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    phase: string,
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${phase} timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    return Promise.race([fn(), timeoutPromise]);
  }
}
