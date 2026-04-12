/**
 * MemoryManager - Facade Pattern
 * 
 * Bu dosya, bölünmüş modülleri (ConversationManager, MemoryStore, RetrievalService)
 * tek bir MemoryManager sınıfı altında birleştirir.
 * 
 * Backward Compatibility: Mevcut import'lar çalışmaya devam eder.
 * 
 * Kullanım:
 * ```typescript
 * import { MemoryManager } from './memory/manager.js';
 * // veya
 * import { MemoryManager } from './memory/manager/index.js';
 * ```
 */

import type Database from 'better-sqlite3';
import { PenceDatabase } from '../database.js';
import type { ConversationMessage, ChannelType } from '../../router/types.js';
import { createEmbeddingProvider, type EmbeddingProvider } from '../embeddings.js';
import { getConfig } from '../../gateway/config.js';
import { logger } from '../../utils/logger.js';
import type { TaskQueue } from '../../autonomous/queue.js';
import { MemoryGraphManager } from '../graph.js';
import { MemoryRetrievalOrchestrator } from '../retrievalOrchestrator.js';
import type { LLMProvider } from '../../llm/provider.js';
import { GraphRAGEngine } from '../graphRAG/GraphRAGEngine.js';
import {
  type MemoryRow,
  type MessageRow,
  type MessageSearchRow,
  type RecentConversationRow,
  type GraphAwareSearchResult,
  type MemoryWriteMetadata,
  type ConversationRow,
  type FeedbackRow,
  type FeedbackInput,
  DEFAULT_USER_NAME,
} from '../types.js';

// Spreading Activation tipleri (re-export from service)
import type {
  SpreadingActivationConfig,
  SpreadingActivationResult,
} from './SpreadingActivationService.js';

// Alt modüller
import { ConversationManager } from './ConversationManager.js';
import { MemoryStore } from './MemoryStore.js';
import { RetrievalService, type RetrievalDeps } from './RetrievalService.js';
import { TokenUsageService } from './TokenUsageService.js';
import { FeedbackService } from './FeedbackService.js';
import { SpreadingActivationService } from './SpreadingActivationService.js';
import { selectConversationAwareSupplementalMemories } from '../contextUtils.js';

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
} from './types.js';

// Re-export types from parent
export type {
  GraphNode,
  GraphEdge,
  MemoryGraph,
  GraphAwareSearchResult,
} from '../types.js';

/**
 * Bellek yöneticisi — konuşma geçmişi ve uzun vadeli bellek.
 * 
 * Facade Pattern: Tüm işlemleri alt modüllere delege eder.
 */
export class MemoryManager {
  private db: Database.Database;
  private embeddingProvider: EmbeddingProvider | null = null;
  private graph: MemoryGraphManager;
  private taskQueue: TaskQueue | null = null;
  private graphRAGEngine: GraphRAGEngine | null = null;

  // Alt modüller
  private conversationManager: ConversationManager;
  private memoryStore: MemoryStore;
  private retrievalService: RetrievalService;
  private retrievalOrchestrator: MemoryRetrievalOrchestrator;
  private tokenUsageService: TokenUsageService;
  private feedbackService: FeedbackService;
  private spreadingActivationService: SpreadingActivationService;

  constructor(penceDb: PenceDatabase) {
    this.db = penceDb.getDb();
    try {
      this.embeddingProvider = createEmbeddingProvider();
      if (this.embeddingProvider) {
        logger.info(`[Memory] Embedding provider aktif: ${this.embeddingProvider.name}`);
      }
    } catch (err) {
      logger.warn({ err: err }, '[Memory] Embedding provider başlatılamadı:');
      this.embeddingProvider = null;
    }

    // Graph Manager
    this.graph = new MemoryGraphManager(this.db, this.embeddingProvider);

    // Conversation Manager
    this.conversationManager = new ConversationManager(this.db);

    // Memory Store
    this.memoryStore = new MemoryStore(
      this.db,
      this.embeddingProvider,
      this.taskQueue,
      this.graph
    );

    // Retrieval Service
    const retrievalDeps: RetrievalDeps = {
      db: this.db,
      embeddingProvider: this.embeddingProvider,
      taskQueue: this.taskQueue,
      graphManager: this.graph,
      enqueueEbbinghausToWorker: (ids) => this.memoryStore.enqueueEbbinghausToWorker(ids),
      getRecentConversationSummaries: (limit) => this.conversationManager.getRecentConversationSummaries(limit),
      getMemoriesDueForReview: (limit) => this.getMemoriesDueForReview(limit),
      getFollowUpCandidates: (days, limit) => this.getFollowUpCandidates(days, limit),
      getRecentMessages: (hours, limit, excludeId) => this.getRecentMessages(hours, limit, excludeId),
      getUserMemories: (limit) => this.getUserMemories(limit),
      prioritizeConversationMemories: (memories, recentMsgs, activeId, limit) =>
        this.prioritizeConversationMemories(memories, recentMsgs, activeId, limit),
    };
    this.retrievalService = new RetrievalService(retrievalDeps);

    // Çıkarılmış servisler
    this.tokenUsageService = new TokenUsageService(this.db);
    this.feedbackService = new FeedbackService(this.db);
    this.spreadingActivationService = new SpreadingActivationService(this.graph);

    // Retrieval Orchestrator (graphRAGEngine setGraphRAGEngine ile sonradan set edilir)
    this.retrievalOrchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: (query, limit, maxDepth) => this.graphAwareSearch(query, limit, maxDepth),
      getRecentConversationSummaries: (limit) => this.conversationManager.getRecentConversationSummaries(limit),
      getMemoriesDueForReview: (limit) => this.getMemoriesDueForReview(limit),
      getFollowUpCandidates: (days, limit) => this.getFollowUpCandidates(days, limit),
      getRecentMessages: (hours, limit, excludeConversationId) => this.getRecentMessages(hours, limit, excludeConversationId),
      getUserMemories: (limit) => this.getUserMemories(limit),
      getMemoryNeighborsBatch: (memoryIds, limitPerNode) => this.graph.getMemoryNeighborsBatch(memoryIds, limitPerNode),
      getSpreadingActivationConfig: () => this.spreadingActivationService.getOrchestratorConfig() as any,
      getBehaviorDiscoveryConfig: () => ({ retrieval: { state: 'shadow' } }),
      prioritizeConversationMemories: (memories, recentMessages, activeConversationId, limit) =>
        this.prioritizeConversationMemories(memories, recentMessages, activeConversationId, limit),
      recordDebug: (payload) => this.recordRetrievalDebug('promptContextBundle', payload),
      graphRAGEngine: () => this.graphRAGEngine ?? undefined,
    });
  }

  /**
   * GraphRAG engine'i set eder (Agent runtime tarafından çağrılır).
   */
  setGraphRAGEngine(engine: GraphRAGEngine): void {
    this.graphRAGEngine = engine;
    logger.info('[Memory] GraphRAG engine connected');
  }

  /**
   * Confidence threshold'ı yapılandır (Agent runtime tarafından çağrılır).
   */
  setConfidenceThreshold(threshold?: number): void {
    const config = getConfig();
    const finalThreshold = threshold ?? config.agenticRAGDecisionConfidence ?? 0.6;
    this.retrievalOrchestrator.setConfidenceThreshold(finalThreshold);
    logger.info(`[Memory] Confidence threshold configured (${finalThreshold})`);
  }

  /**
   * TaskQueue referansını ayarlar.
   */
  setTaskQueue(queue: TaskQueue): void {
    this.taskQueue = queue;
    this.memoryStore.setTaskQueue(queue);
    logger.info('[Memory] ⚙️ TaskQueue bağlandı — Ebbinghaus güncellemeleri arka plana yönlendirilecek.');
  }

  /**
   * Ham veritabanı instance'ını döndürür.
   * Gateway routes gibi harici katmanların doğrudan DB erişimi gerektirdiği durumlar için.
   */
  getDatabase(): Database.Database {
    return this.db;
  }

  // ========== Konuşma Yönetimi (ConversationManager'a delege) ==========

  getOrCreateConversation(
    channelType: ChannelType,
    channelId: string,
    userName?: string
  ): { conversationId: string; previousConversationId?: string } {
    return this.conversationManager.getOrCreateConversation(channelType, channelId, userName);
  }

  beginConversationTurn(
    channelType: ChannelType,
    channelId: string,
    userName: string | undefined,
    message: ConversationMessage,
    historyLimit?: number
  ): import('./types.js').ConversationTurnBundle {
    return this.conversationManager.beginConversationTurn(
      channelType,
      channelId,
      userName,
      message,
      historyLimit ?? 100,
      (msgId, content) => this.computeAndStoreMessageEmbedding(msgId, content)
    );
  }

  addMessage(conversationId: string, message: ConversationMessage): void {
    this.conversationManager.addMessage(
      conversationId,
      message,
      (msgId, content) => this.computeAndStoreMessageEmbedding(msgId, content)
    );
  }

  getConversationHistory(conversationId: string, limit?: number): ConversationMessage[] {
    return this.conversationManager.getConversationHistory(conversationId, limit);
  }

  getConversationContext(conversationId: string): import('../../router/types.js').ConversationContext | null {
    return this.conversationManager.getConversationContext(conversationId);
  }

  getRecentConversations(limit?: number): RecentConversationRow[] {
    return this.conversationManager.getRecentConversations(limit);
  }

  updateConversationTitle(conversationId: string, title: string, isCustom: boolean = false): void {
    this.conversationManager.updateConversationTitle(conversationId, title, isCustom);
  }

  updateConversationSummary(conversationId: string, summary: string): void {
    this.conversationManager.updateConversationSummary(conversationId, summary);
  }

  getRecentConversationSummaries(limit?: number): Array<{ id: string; title: string; summary: string; updated_at: string }> {
    return this.conversationManager.getRecentConversationSummaries(limit);
  }

  getConversationTranscriptBundle(conversationId: string, limit?: number): import('./types.js').ConversationTranscriptBundle | null {
    return this.conversationManager.getConversationTranscriptBundle(conversationId, limit);
  }

  deleteConversation(conversationId: string): boolean {
    return this.conversationManager.deleteConversation(conversationId);
  }

  deleteConversations(conversationIds: string[]): { deletedCount: number, results: { id: string, deleted: boolean }[] } {
    return this.conversationManager.deleteConversations(conversationIds);
  }

  // ========== Uzun Vadeli Bellek (MemoryStore'a delege) ==========

  async addMemory(
    content: string,
    category?: string,
    importance?: number,
    mergeFn?: (oldContent: string, newContent: string) => Promise<string>,
    metadata?: MemoryWriteMetadata
  ): Promise<{ id: number; isUpdate: boolean }> {
    return this.memoryStore.addMemory(content, category, importance, mergeFn, metadata);
  }

  deleteMemory(memoryId: number): boolean {
    return this.memoryStore.deleteMemory(memoryId);
  }

  async editMemory(memoryId: number, content: string, category: string, importance: number): Promise<boolean> {
    return this.memoryStore.editMemory(memoryId, content, category, importance);
  }

  decayMemories(): { decayed: number; archived: number } {
    return this.memoryStore.decayMemories();
  }

  executeEbbinghausUpdates(memoryIds: number[]): void {
    this.memoryStore.executeEbbinghausUpdates(memoryIds);
  }

  getStats(): { conversations: number; messages: number; memories: number } {
    return this.memoryStore.getStats();
  }

  // ========== Ayarlar (MemoryStore'a delege) ==========

  getSetting(key: string): string | null {
    return this.memoryStore.getSetting(key);
  }

  setSetting(key: string, value: string): void {
    this.memoryStore.setSetting(key, value);
  }

  deleteSetting(key: string): boolean {
    return this.memoryStore.deleteSetting(key);
  }

  getSensitivePaths(): string[] {
    const raw = this.getSetting('sensitive_paths');
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {
        return [];
      }
    }
    // İlk kez — config'ten varsayılanları yükle ve DB'ye kaydet
    const defaults: string[] = getConfig().sensitivePaths || [];
    this.setSetting('sensitive_paths', JSON.stringify(defaults));
    return defaults;
  }

  setSensitivePaths(paths: string[]): void {
    this.setSetting('sensitive_paths', JSON.stringify(paths));
  }

  // ========== Arama (RetrievalService'e delege) ==========

  searchMemories(query: string, limit?: number): MemoryRow[] {
    return this.retrievalService.searchMemories(query, limit);
  }

  async semanticSearch(query: string, limit?: number): Promise<(MemoryRow & { similarity: number })[]> {
    return this.retrievalService.semanticSearch(query, limit);
  }

  async hybridSearch(query: string, limit?: number): Promise<MemoryRow[]> {
    return this.retrievalService.hybridSearch(query, limit);
  }

  searchMessages(query: string, limit?: number): MessageRow[] {
    return this.retrievalService.searchMessages(query, limit);
  }

  async semanticSearchMessages(query: string, limit?: number): Promise<MessageSearchRow[]> {
    return this.retrievalService.semanticSearchMessages(query, limit);
  }

  async hybridSearchMessages(query: string, limit?: number): Promise<MessageSearchRow[]> {
    return this.retrievalService.hybridSearchMessages(query, limit);
  }

  async graphAwareSearch(query: string, limit?: number, maxDepth?: number): Promise<GraphAwareSearchResult> {
    return this.retrievalService.graphAwareSearch(query, limit, maxDepth);
  }

  getMemoriesDueForReview(limit?: number): MemoryRow[] {
    return this.retrievalService.getMemoriesDueForReview(limit);
  }

  getFollowUpCandidates(days?: number, limit?: number): MemoryRow[] {
    return this.retrievalService.getFollowUpCandidates(days, limit);
  }

  getUserMemories(limit?: number): MemoryRow[] {
    return this.retrievalService.getUserMemories(limit);
  }

  // ========== Autonomous Engine Helpers ==========

  getAutonomousSeedMemories(limit: number, excludedSeedId?: number, cooldownMinutes?: number): MemoryRow[] {
    return this.retrievalService.getAutonomousSeedMemories(limit, excludedSeedId, cooldownMinutes);
  }

  getAutonomousGraphWalkNeighbors(seedId: number, confidenceThreshold?: number, limit?: number): Array<MemoryRow & { relation_description?: string, relation_confidence?: number }> {
    return this.retrievalService.getAutonomousGraphWalkNeighbors(seedId, confidenceThreshold, limit);
  }

  getRecentMessages(hours?: number, limit?: number, excludeConversationId?: string): Array<{ role: string; content: string; created_at: string; conversation_title: string }> {
    return this.retrievalService.getRecentMessages(hours, limit, excludeConversationId);
  }

  async ensureAllEmbeddings(): Promise<number> {
    return this.retrievalService.ensureAllEmbeddings();
  }

  async ensureAllMessageEmbeddings(): Promise<number> {
    return this.retrievalService.ensureAllMessageEmbeddings();
  }

  // ========== Prompt Context Bundle ==========

  async getPromptContextBundle(
    query: string,
    activeConversationId: string,
    options?: {
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
  ): Promise<{
    relevantMemories: MemoryRow[];
    archivalMemories: MemoryRow[];
    supplementalMemories: MemoryRow[];
    conversationSummaries: Array<{ id: string; title: string; summary: string; updated_at: string }>;
    reviewMemories: MemoryRow[];
    followUpCandidates: MemoryRow[];
    recentMessages: Array<{ role: string; content: string; created_at: string; conversation_title: string }>;
  }> {
    return this.retrievalOrchestrator.getPromptContextBundle({
      query,
      activeConversationId,
      options,
    });
  }

  // ========== Memory Graph Delegasyonları ==========

  async processMemoryGraph(
    memoryId: number,
    content: string,
    extractFn?: (content: string, existingEntities: string[]) => Promise<{
      entities: Array<{ name: string; type: string }>;
      relations: Array<{ targetMemoryId: number; relationType: string; confidence: number; description: string }>;
    }>
  ): Promise<void> {
    return this.graph.processMemoryGraph(memoryId, content, extractFn);
  }

  getMemoryNeighbors(memoryId: number, limit?: number) {
    return this.graph.getMemoryNeighbors(memoryId, limit);
  }

  getMemoryNeighborsBatch(memoryIds: number[], limitPerNode?: number) {
    return this.graph.getMemoryNeighborsBatch(memoryIds, limitPerNode);
  }

  getMemoryEntities(memoryId: number) {
    return this.graph.getMemoryEntities(memoryId);
  }

  getMemoryGraph() {
    return this.graph.getMemoryGraph();
  }

  decayRelationships() {
    return this.graph.decayRelationships();
  }

  async ensureAllMemoryGraphRelations() {
    return this.graph.ensureAllMemoryGraphRelations();
  }

  // ========== Debug ==========

  getRetrievalDebugSnapshot(flow: 'hybridSearch' | 'hybridSearchMessages' | 'graphAwareSearch' | 'promptContextBundle'): unknown {
    return this.retrievalService.getRetrievalDebugSnapshot(flow);
  }

  getLastMemoryWriteDebugSnapshot(): unknown {
    return this.memoryStore.getLastMemoryWriteDebugSnapshot();
  }

  // ========== Private Helper Methods ==========

  private async computeAndStoreMessageEmbedding(messageId: number, content: string): Promise<void> {
    if (!this.embeddingProvider) return;

    try {
      const [embedding] = await this.embeddingProvider.embed([content]);
      const idBig = BigInt(messageId);
      const buf = Buffer.from(new Float32Array(embedding).buffer);

      this.db.transaction(() => {
        this.db.prepare(`DELETE FROM message_embeddings WHERE rowid = CAST(? AS INTEGER)`).run(idBig);
        this.db.prepare(`INSERT INTO message_embeddings (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)`).run(idBig, buf);
      })();
    } catch (err) {
      logger.warn({ err: err }, `[Memory] Mesaj embedding kayıt hatası (id=${messageId}):`);
    }
  }

  private recordRetrievalDebug(flow: 'hybridSearch' | 'hybridSearchMessages' | 'graphAwareSearch' | 'promptContextBundle', payload: unknown): void {
    // RetrievalService'e delege edilecek - burada sadece orchestrator için kullanılıyor
    logger.debug({ flow, payload }, '[Memory] Retrieval debug recorded');

    // Agentic RAG özetini info seviyesinde logla (gözle görülebilir olsun)
    if (flow === 'promptContextBundle' && typeof payload === 'object' && payload !== null) {
      const p = payload as Record<string, unknown>;
      const agentic = p.agenticRAG as Record<string, unknown> | undefined;
      if (agentic) {
        const decision = agentic.decision as Record<string, unknown> | null;
        const critique = agentic.critique as Record<string, unknown> | null;
        const multiHop = agentic.multiHop as Record<string, unknown> | null;
        const timings = agentic.timings as Record<string, number> | undefined;

        const parts: string[] = [`[Agentic RAG] enabled=${agentic.enabled}`];
        if (decision) {
          parts.push(`decision=${decision.needsRetrieval ? 'RETRIEVE' : 'NO_RETRIEVE'} (conf=${Number(decision.confidence).toFixed(2)})`);
        }
        if (critique) {
          parts.push(`critique=kept:${critique.keptCount}/filtered:${critique.filteredCount} (completeness=${Number(critique.overallCompleteness).toFixed(2)})`);
        }
        if (multiHop) {
          parts.push(`multiHop=${multiHop.hops ? (multiHop.hops as unknown[]).length : 0} hops, total=${multiHop.totalMemories} memories, calls=${multiHop.totalRetrievalCalls}`);
        }
        if (timings && Object.keys(timings).length > 0) {
          const timingStr = Object.entries(timings).map(([k, v]) => `${k}=${v}ms`).join(', ');
          parts.push(`⏱️ ${timingStr}`);
        }

        logger.info({ msg: parts.join(' | ') });
      }
    }
  }

  private prioritizeConversationMemories(
    memories: MemoryRow[],
    recentMessages: Array<{ role: string; content: string; created_at: string; conversation_title: string }>,
    activeConversationId: string,
    limit: number
  ): MemoryRow[] {
    // Import moved to top of file for ESM compatibility
    return selectConversationAwareSupplementalMemories({
      query: recentMessages.slice(-1)[0]?.content ?? '',
      activeConversationId,
      recentMessages,
      relevantMemories: [],
      fallbackMemories: memories,
      limit,
    });
  }

  // ========== Feedback Yönetimi (FeedbackService'e delege) ==========

  saveFeedback(input: FeedbackInput): FeedbackRow {
    return this.feedbackService.saveFeedback(input);
  }

  getFeedbacks(conversationId: string): FeedbackRow[] {
    return this.feedbackService.getFeedbacks(conversationId);
  }

  getFeedbackByMessageId(messageId: string): FeedbackRow | null {
    return this.feedbackService.getFeedbackByMessageId(messageId);
  }

  // ========== Spreading Activation (SpreadingActivationService'e delege) ==========

  getSpreadingActivationConfig(): Partial<SpreadingActivationConfig> {
    return this.spreadingActivationService.getConfig();
  }

  computeSpreadingActivation(
    seedNodeIds: number[],
    config?: Partial<SpreadingActivationConfig>
  ): SpreadingActivationResult {
    return this.spreadingActivationService.compute(seedNodeIds, config);
  }

  // ========== Token Usage (TokenUsageService'e delege) ==========

  saveTokenUsage(record: {
    provider: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }): void {
    this.tokenUsageService.saveTokenUsage(record);
  }

  getTokenUsageStats(period: string = 'week'): {
    totalTokens: number;
    totalCost: number;
    providerBreakdown: Record<string, { tokens: number; cost: number }>;
  } {
    return this.tokenUsageService.getTokenUsageStats(period);
  }

  getDailyUsage(period: string = 'week'): Array<{ date: string; tokens: number; cost: number }> {
    return this.tokenUsageService.getDailyUsage(period);
  }
}

// Default export
export default MemoryManager;
