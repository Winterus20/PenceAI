/**
 * MemoryManager modülü için paylaşılan tipler.
 * Bu dosya ConversationManager, MemoryStore ve RetrievalService arasında
 * paylaşılan tüm tip tanımlarını içerir.
 */

import type Database from 'better-sqlite3';
import type { ConversationMessage, ChannelType } from '../../router/types.js';
import type { EmbeddingProvider } from '../embeddings.js';
import type { TaskQueue } from '../../autonomous/queue.js';
import type {
  ConversationRow,
  MessageRow,
  MemoryRow,
  MessageSearchRow,
  RecentConversationRow,
  ConversationBranchInfo,
  ForkConversationResponse,
  GraphAwareSearchResult,
  MemoryWriteMetadata,
} from '../types.js';

// ========== Konuşma Tipleri ==========

export interface ConversationTurnBundle {
  conversationId: string;
  previousConversationId?: string;
  history: ConversationMessage[];
}

export interface ConversationTranscriptBundle {
  history: ConversationMessage[];
  conversationText: string;
  userName: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  summary: string;
  updated_at: string;
}

// ========== Bellek Tipleri ==========

export interface AddMemoryResult {
  id: number;
  isUpdate: boolean;
}

export interface DecayResult {
  decayed: number;
  archived: number;
}

export interface MemoryStats {
  conversations: number;
  messages: number;
  memories: number;
}

// ========== Arama Tipleri ==========

export interface RecentMessage {
  role: string;
  content: string;
  created_at: string;
  conversation_title: string;
}

export interface PromptContextBundle {
  relevantMemories: MemoryRow[];
  archivalMemories: MemoryRow[];
  supplementalMemories: MemoryRow[];
  conversationSummaries: ConversationSummary[];
  telescopicSummaries?: Array<{ id: number; summary: string; level: number; created_at: string; end_msg_id: number }>;
  reviewMemories: MemoryRow[];
  followUpCandidates: MemoryRow[];
  recentMessages: RecentMessage[];
  graphRAG?: {
    memories: MemoryRow[];
    communitySummaries: Array<{ communityId: string; summary: string }>;
    graphContext: Record<string, unknown>;
  } | null;
  insights?: Array<{ id: number; description: string; confidence: number; type: string }>;
}

export interface PromptContextOptions {
  searchLimit?: number;
  summaryLimit?: number;
  reviewLimit?: number;
  followUpDays?: number;
  followUpLimit?: number;
  relevantMemoryLimit?: number;
  fallbackMemoryLimit?: number;
  recentHours?: number;
  recentMessagesLimit?: number;
}

// ========== Graph Manager Interface ==========

export interface GraphManagerInterface {
  autoCreateProximityRelations(memoryId: number): void;
  updateStabilityOnAccess(memory: MemoryRow): void;
  cleanupMemoryGraph(memoryId: number): void;
}

// ========== Bağımlılık Tipleri ==========

export interface MemoryManagerDeps {
  db: Database.Database;
  embeddingProvider: EmbeddingProvider | null;
  taskQueue: TaskQueue | null;
}

// ========== Re-exports ==========

export type {
  ConversationRow,
  MessageRow,
  MemoryRow,
  MessageSearchRow,
  RecentConversationRow,
  ConversationBranchInfo,
  ForkConversationResponse,
  GraphAwareSearchResult,
  MemoryWriteMetadata,
};

export type { ConversationMessage, ChannelType } from '../../router/types.js';
export type { EmbeddingProvider } from '../embeddings.js';
export type { TaskQueue } from '../../autonomous/queue.js';
