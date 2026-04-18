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
import type { GraphRAGFeatureFlag } from './config.js';
import { TokenPruner, type TokenBudget, type PruningResult } from './TokenPruner.js';
import { defaultMonitor } from './monitoring.js';
import { GlobalSearchEngine, type GlobalSearchResult } from './GlobalSearchEngine.js';

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
  
  // Configurable constants
  rrfKConstant: number;         // Default: 60 (RRF fusion constant)
  memoryImportanceWeight: number; // Default: 0.5
  memoryAccessCountWeight: number; // Default: 0.3
  memoryConfidenceWeight: number; // Default: 0.2

  // Global Search
  searchMode: 'local' | 'global' | 'auto'; // Default: 'auto'
  globalSearchTopK: number;     // Default: 5
  globalSearchLevel: number;    // Default: 1
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
  /** Global search sonucu (sadece global modda dolu) */
  globalSearchResult?: GlobalSearchResult;
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
  rrfKConstant: 60,
  memoryImportanceWeight: 0.5,
  memoryAccessCountWeight: 0.3,
  memoryConfidenceWeight: 0.2,
  searchMode: 'auto',
  globalSearchTopK: 5,
  globalSearchLevel: 1,
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
  private globalSearchEngine: GlobalSearchEngine;

  constructor(
    private db: Database.Database,
    private expander: GraphExpander,
    private pageRankScorer: PageRankScorer,
    private communityDetector: CommunityDetector,
    private communitySummarizer: CommunitySummarizer,
    private graphCache: GraphCache,
    private hybridSearchFn: (query: string, limit: number) => Promise<MemoryRow[]>,
    private llmProvider: import('../../llm/provider.js').LLMProvider,
    config?: Partial<GraphRAGConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tokenPruner = new TokenPruner({
      budget: computeTokenBudget(this.config),
      memoryWeights: {
        importance: this.config.memoryImportanceWeight,
        accessCount: this.config.memoryAccessCountWeight,
        confidence: this.config.memoryConfidenceWeight,
      },
    });
    this.globalSearchEngine = new GlobalSearchEngine(db, llmProvider, communityDetector);
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
    const phaseTimings: Record<string, number> = {};

    // Feature flag kontrolü
    if (!GRAPH_RAG_ENABLED) {
      return this.fallbackToStandard(query, config, startTime, true);
    }

    // ========== Search Mode Routing ==========
    const resolvedMode = config.searchMode === 'auto'
      ? this.classifySearchMode(query)
      : config.searchMode;

    if (resolvedMode === 'global') {
      logger.info(`[GraphRAGEngine] 🌐 Routing to GLOBAL search for query: "${query.substring(0, 80)}..."`);
      return this.executeGlobalSearch(query, config, startTime);
    }

    logger.info(`[GraphRAGEngine] 🔍 Routing to LOCAL search for query: "${query.substring(0, 80)}..."`);

    try {
      // Phase 1: Standard hybrid search (baseline)
      const phase1Start = Date.now();
      const initialResults = await this.runWithTimeout(
        () => this.hybridSearchFn(query, config.maxExpandedNodes),
        config.timeoutMs,
        'initial_search',
      );
      phaseTimings.initial_search = Date.now() - phase1Start;
      logger.info(`[GraphRAGEngine] ⏱️ Phase 1 (initial_search): ${phaseTimings.initial_search}ms (${initialResults.length} results)`);

      if (initialResults.length === 0) {
        return this.buildEmptyResult(startTime, false);
      }

      // Phase 2: Graph expansion
      const phase2Start = Date.now();
      const expansion = await this.runExpansion(initialResults, config, startTime);
      phaseTimings.expansion = Date.now() - phase2Start;
      logger.info(`[GraphRAGEngine] ⏱️ Phase 2 (expansion): ${phaseTimings.expansion}ms (success: ${expansion.success})`);
      if (!expansion.success) {
        return expansion.fallback ?? this.fallbackToStandard(query, config, startTime, false);
      }

      // Phase 3: PageRank scoring
      const phase3Start = Date.now();
      const scoring = await this.runScoring(expansion.result, config, startTime);
      phaseTimings.scoring = Date.now() - phase3Start;
      logger.info(`[GraphRAGEngine] ⏱️ Phase 3 (scoring): ${phaseTimings.scoring}ms (success: ${scoring.success})`);
      if (!scoring.success) {
        return scoring.fallback ?? this.fallbackToStandard(query, config, startTime, false);
      }

      // Phase 4: Community detection
      const phase4Start = Date.now();
      const community = await this.runCommunityDetection(scoring.result, expansion.result, config, startTime);
      phaseTimings.community = Date.now() - phase4Start;
      logger.info(`[GraphRAGEngine] ⏱️ Phase 4 (community): ${phaseTimings.community}ms (success: ${community.success})`);
      if (!community.success) {
        // Community detection başarısız olsa bile devam et
        logger.warn('[GraphRAGEngine] Community detection failed, continuing without communities');
      }

      // Phase 5: Summary generation
      const phase5Start = Date.now();
      const summary = await this.runSummarization(community.result, config, startTime);
      phaseTimings.summary = Date.now() - phase5Start;
      logger.info(`[GraphRAGEngine] ⏱️ Phase 5 (summary): ${phaseTimings.summary}ms (success: ${summary.success})`);
      if (!summary.success) {
        logger.warn('[GraphRAGEngine] Summary generation failed, continuing without summaries');
      }

      // Phase 6: Token pruning ve fusion
      const phase6Start = Date.now();
      const fusionResult = await this.runFusion(
        query,
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
      phaseTimings.fusion = Date.now() - phase6Start;
      logger.info(`[GraphRAGEngine] ⏱️ Phase 6 (fusion): ${phaseTimings.fusion}ms`);

      // Toplam süre logu
      const totalDuration = Date.now() - startTime;
      logger.info(`[GraphRAGEngine] ⏱️ TOTAL GraphRAG retrieval: ${totalDuration}ms | Breakdown: ${JSON.stringify(phaseTimings)}`);

      // ✅ Monitoring kaydı
      defaultMonitor.recordQuery(
        totalDuration,
        fusionResult.searchMetadata.tokenUsage,
        true, // success
        fusionResult.searchMetadata.cacheHit,
        true, // usedGraphRAG
      );

      return fusionResult;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error({ err }, '[GraphRAGEngine] Retrieval failed:');

      // ✅ Error monitoring kaydı
      defaultMonitor.recordQuery(
        Date.now() - startTime,
        0,
        false, // success
        false, // cacheHit
        true, // usedGraphRAG
      );
      defaultMonitor.recordError(errorMessage);

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
        let summary = this.communitySummarizer.getSummary(comm.id);

        // On-demand generation: Cache'de yoksa oluştur
        if (!summary) {
          logger.debug(
            `[GraphRAGEngine] Summary not cached for community ${comm.id}, generating on-demand`,
          );
          summary = await this.communitySummarizer.summarizeCommunity(comm.id);
        }

        if (summary) {
          summaries.push(summary);
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
    query: string,
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

    // RRF fusion ile final ranking (configurable K constant)
    const finalMemories = this.rrfFusion(
      query,
      results.initialResults,
      pruningResult.prunedMemories,
      results.scoring.scores,
      config.maxExpandedNodes,
      config.rrfKConstant,
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
    query: string,
    initialResults: MemoryRow[],
    expandedNodes: MemoryRow[],
    scores: Map<number, number>,
    maxResults: number,
    rrfK: number = 60, // Configurable RRF constant
  ): MemoryRow[] {
    const K = rrfK; // RRF constant (default: 60)
    const allNodes = new Map<number, { node: MemoryRow; rrfScore: number }>();

    // Initial results için RRF score
    for (let rank = 0; rank < initialResults.length; rank++) {
      const node = initialResults[rank];
      const rrfScore = 1 / (K + rank + 1);
      const phraseScore = this.calculatePhraseBonus(query, node.content);
      allNodes.set(node.id, { node, rrfScore: rrfScore + phraseScore });
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
      const rrfScore = 1 / (K + rank + 1);
      let weightedScore = rrfScore * (0.5 + pageRankScore * 0.5);
      
      const phraseScore = this.calculatePhraseBonus(query, node.content);
      weightedScore += phraseScore;

      const existing = allNodes.get(node.id);
      if (existing) {
        existing.rrfScore += weightedScore;
      } else {
        allNodes.set(node.id, { node, rrfScore: weightedScore });
      }
    }

    // Final ranking
    return Array.from(allNodes.values())
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, maxResults)
      .map(item => item.node);
  }

  /**
   * Deterministik sıralama iyileştirmesi için RAGOps phrase bonus fonksiyonu.
   * Eğer sorgunun kalıp kelimeleri aranan metinde yan yanaysa RRF skoruna anında güçlü bir bonus verir.
   */
  private calculatePhraseBonus(query: string, chunkText: string): number {
    const queryWords = query.toLowerCase().trim().split(/\s+/).filter(w => w.length > 2);
    if (queryWords.length < 2) return 0;

    const lowerChunk = chunkText.toLowerCase();
    let bonus = 0;

    // 2-gram bonus
    for (let i = 0; i < queryWords.length - 1; i++) {
      const bigram = `${queryWords[i]} ${queryWords[i + 1]}`;
      if (lowerChunk.includes(bigram)) {
        bonus += 0.05;
      }
    }

    // 3-gram bonus
    for (let i = 0; i < queryWords.length - 2; i++) {
      const trigram = `${queryWords[i]} ${queryWords[i + 1]} ${queryWords[i + 2]}`;
      if (lowerChunk.includes(trigram)) {
        bonus += 0.10;
      }
    }

    // Max 0.20 bonus limit
    return Math.min(bonus, 0.20);
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

  // ========== Global Search Integration ==========

  /**
   * Sorguyu 'local' vs 'global' olarak sınıflandır.
   * Basit heuristic: Geniş, analitik sorular → global; spesifik sorular → local.
   */
  private classifySearchMode(query: string): 'local' | 'global' {
    const q = query.toLowerCase();

    // Global arama tetikleyicileri
    const globalPatterns = [
      /\b(genel|tüm|bütün|hepsi|toplam|ana|mak?ro)\b/,
      /\b(özetle|listele|sırala|analiz|değerlendir)\b/,
      /\b(temalar?|konular?|projeler?|ilgi\s*alan)\b/,
      /\b(gidişat|trend|genel\s*(durum|bakış|resim))\b/,
      /\b(kaç\s*tane|toplam\s*kaç)\b/,
      /\b(overall|summary|overview|trends?|themes?)\b/,
      /\b(everything|all\s*(of|my)|entire)\b/,
    ];

    // Global pattern eşleşmesi
    let globalScore = 0;
    for (const pattern of globalPatterns) {
      if (pattern.test(q)) globalScore++;
    }

    // Eğer 2+ global tetikleyici varsa veya soru çok genişse…
    if (globalScore >= 2 || (globalScore >= 1 && q.length > 80)) {
      return 'global';
    }

    return 'local';
  }

  /**
   * Global Search'i çalıştırıp GraphRAGResult formatına çevirir.
   */
  private async executeGlobalSearch(
    query: string,
    config: GraphRAGConfig,
    startTime: number,
  ): Promise<GraphRAGResult> {
    try {
      const globalResult = await this.globalSearchEngine.globalSearch(query, {
        level: config.globalSearchLevel,
        topK: config.globalSearchTopK,
      });

      const duration = Date.now() - startTime;

      // Monitoring
      defaultMonitor.recordQuery(duration, 0, globalResult.success, false, true);

      return {
        success: globalResult.success,
        memories: [],
        communitySummaries: globalResult.usedSummaries,
        graphContext: {
          expandedNodeIds: [],
          edgeCount: 0,
          maxHopReached: false,
          communityCount: globalResult.metadata.filteredCommunities,
          pageRankApplied: false,
        },
        searchMetadata: {
          duration,
          cacheHit: false,
          tokenUsage: 0,
          fallbackUsed: false,
          phase: 'fusion',
        },
        globalSearchResult: globalResult,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({ err }, '[GraphRAGEngine] Global search failed, falling back to local:');

      // Global başarısız olursa local'e düş
      return this.fallbackToStandard(query, config, startTime, true);
    }
  }
}
