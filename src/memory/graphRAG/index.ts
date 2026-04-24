/**
 * GraphRAG modülü — Export barrel.
 *
 * GraphRAG Faz 1, Faz 2, Faz 3 ve Faz 4 (FULL) bileşenlerini dışa aktarır.
 */

// Faz 1 & 2 exports
export { GraphCache, computeQueryHash } from './GraphCache.js';
export { GraphExpander } from './GraphExpander.js';
export { PageRankScorer } from './PageRankScorer.js';
export { CommunityDetector } from './CommunityDetector.js';
export { CommunitySummarizer } from './CommunitySummarizer.js';
export { GraphWorker, FULL_PHASE_CONFIG } from './GraphWorker.js';

// Faz 3 exports
export { GraphRAGEngine } from './GraphRAGEngine.js';
export { GlobalSearchEngine } from './GlobalSearchEngine.js';
export { TokenPruner } from './TokenPruner.js';
export { BehaviorDiscoveryShadow } from './BehaviorDiscoveryShadow.js';
export { GraphRAGConfigManager, DEFAULT_GRAPH_RAG_CONFIG } from './config.js';

// Faz 4 (FULL) exports
export { GraphRAGRollbackManager, RollbackReason } from './rollback.js';
export { GraphRAGMonitor, AlertSeverity, defaultMonitor } from './monitoring.js';

// Types
export type {
  GraphExpansionResult,
  GraphExpansionOptions,
  PageRankOptions,
  GraphCacheEntry,
  NeighborResult,
} from '../types.js';

export type {
  Community,
  CommunityDetectionOptions,
  CommunityDetectionResult,
} from './CommunityDetector.js';

export type {
  CommunitySummary,
  SummarizationOptions,
} from './CommunitySummarizer.js';

export type {
  GraphWorkerConfig,
} from './GraphWorker.js';

// Faz 3 types
export type {
  GraphRAGConfig,
  GraphContext,
  SearchMetadata,
  GraphRAGResult,
} from './GraphRAGEngine.js';

export type {
  GlobalSearchResult,
  GlobalSearchOptions,
} from './GlobalSearchEngine.js';

export type {
  TokenBudget,
  PruningOptions,
  PruningResult,
  MemoryPriorityWeights,
} from './TokenPruner.js';

export type {
  BehaviorDiscoveryConfig,
  RetrievalComparison,
  BehaviorDiscoveryMetrics,
} from './BehaviorDiscoveryShadow.js';

export type {
  GraphRAGFeatureFlag,
} from './config.js';

// Faz 4 (FULL) types
export type {
  RollbackEvent,
} from './rollback.js';

export type {
  Alert,
  GraphRAGMetrics,
  AlertThresholds,
} from './monitoring.js';
