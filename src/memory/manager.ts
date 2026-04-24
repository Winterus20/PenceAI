/**
 * MemoryManager - Backward Compatibility Entry Point
 * 
 * Bu dosya sadece yeni modül yapısından re-export yapar.
 * Gerçek implementasyon src/memory/manager/ klasöründedir.
 * 
 * Mevcut import'lar çalışmaya devam eder:
 * ```typescript
 * import { MemoryManager } from './memory/manager.js';
 * ```
 * 
 * Yeni import'lar da desteklenir:
 * ```typescript
 * import { MemoryManager } from './memory/manager/index.js';
 * import { ConversationManager } from './memory/manager/ConversationManager.js';
 * import { MemoryStore } from './memory/manager/MemoryStore.js';
 * import { RetrievalService } from './memory/manager/RetrievalService.js';
 * ```
 */

// Ana sınıf
export { MemoryManager, default as MemoryManagerDefault } from './manager/index.js';

// Tip exports
export type {
  ConversationTurnBundle,
  ConversationTranscriptBundle,
  ConversationSummary,
  AddMemoryResult,
  DecayResult,
  MemoryStats,
  RecentMessage,
  PromptContextBundle,
  PromptContextOptions,
} from './manager/types.js';

// Re-export types from parent
export type {
  GraphNode,
  GraphEdge,
  MemoryGraph,
  GraphAwareSearchResult,
} from './types.js';
