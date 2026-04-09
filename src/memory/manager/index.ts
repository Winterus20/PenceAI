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
import { calculateCost } from '../../utils/costCalculator.js';
import type { TaskQueue } from '../../autonomous/queue.js';
import { MemoryGraphManager } from '../graph.js';
import { MemoryRetrievalOrchestrator } from '../retrievalOrchestrator.js';
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

// Spreading Activation tipleri
interface SpreadingActivationConfig {
  decayFactor: number;
  maxIterations: number;
  minActivation: number;
  relationTypeWeights: Record<string, number>;
}

interface SpreadingActivationResult {
  nodeActivations: Map<number, number>;
  iterations: number;
  converged: boolean;
}

// Alt modüller
import { ConversationManager } from './ConversationManager.js';
import { MemoryStore } from './MemoryStore.js';
import { RetrievalService, type RetrievalDeps } from './RetrievalService.js';
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

    // Retrieval Orchestrator (graphRAGEngine setGraphRAGEngine ile sonradan set edilir)
    this.retrievalOrchestrator = new MemoryRetrievalOrchestrator({
      graphAwareSearch: (query, limit, maxDepth) => this.graphAwareSearch(query, limit, maxDepth),
      getRecentConversationSummaries: (limit) => this.conversationManager.getRecentConversationSummaries(limit),
      getMemoriesDueForReview: (limit) => this.getMemoriesDueForReview(limit),
      getFollowUpCandidates: (days, limit) => this.getFollowUpCandidates(days, limit),
      getRecentMessages: (hours, limit, excludeConversationId) => this.getRecentMessages(hours, limit, excludeConversationId),
      getUserMemories: (limit) => this.getUserMemories(limit),
      getMemoryNeighborsBatch: (memoryIds, limitPerNode) => this.graph.getMemoryNeighborsBatch(memoryIds, limitPerNode),
      getSpreadingActivationConfig: () => this.getSpreadingActivationConfigForOrchestrator(),
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

  // ========== Feedback Yönetimi ==========

  /**
   * Kullanıcı feedback'ini kaydeder.
   */
  saveFeedback(input: FeedbackInput): FeedbackRow {
    const stmt = this.db.prepare(`
      INSERT INTO feedback (message_id, conversation_id, type, comment, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      input.messageId,
      input.conversationId,
      input.type,
      input.comment || null,
      input.timestamp
    );

    return {
      id: Number(result.lastInsertRowid),
      message_id: input.messageId,
      conversation_id: input.conversationId,
      type: input.type,
      comment: input.comment || null,
      created_at: input.timestamp,
    };
  }

  /**
   * Bir konuşmaya ait tüm feedback'leri getirir.
   */
  getFeedbacks(conversationId: string): FeedbackRow[] {
    const stmt = this.db.prepare(`
      SELECT id, message_id, conversation_id, type, comment, created_at
      FROM feedback
      WHERE conversation_id = ?
      ORDER BY created_at DESC
    `);
    return stmt.all(conversationId) as FeedbackRow[];
  }

  /**
   * Bir mesaja ait feedback'i getirir.
   */
  getFeedbackByMessageId(messageId: string): FeedbackRow | null {
    const stmt = this.db.prepare(`
      SELECT id, message_id, conversation_id, type, comment, created_at
      FROM feedback
      WHERE message_id = ?
      LIMIT 1
    `);
    return stmt.get(messageId) as FeedbackRow | null;
  }

  // ========== Spreading Activation ==========

  /**
   * Spreading Activation config döndürür.
   * RetrievalOrchestrator ile uyumlu olması için Partial config döner.
   */
  getSpreadingActivationConfig(): Partial<SpreadingActivationConfig> {
    return {
      decayFactor: 0.85,
      maxIterations: 10,
      minActivation: 0.01,
      relationTypeWeights: {
        'related_to': 1.0,
        'part_of': 0.9,
        'caused_by': 0.8,
        'associated_with': 0.7,
        'shared_entity': 0.6,
        'default': 0.5,
      },
    };
  }

  /**
   * RetrievalOrchestrator için spreading activation config döndürür.
   * RetrievalSpreadingActivationConfig formatında config sağlar.
   */
  private getSpreadingActivationConfigForOrchestrator(): Partial<import('../retrievalOrchestrator.js').RetrievalSpreadingActivationConfig> {
    return {
      enabled: true,
      rolloutState: 'soft',
      seedLimit: 5,
      neighborsPerSeed: 10,
      maxCandidates: 15,
      maxHopDepth: 2,
      seedConfidenceFloor: 0.65,
      seedScoreFloor: 1.0,
      candidateConfidenceFloor: 0.6,
      relationConfidenceFloor: 0.5,
      minEffectiveBonus: 0.02,
      hopDecay: 0.7,
      activationScale: 0.08,
      maxCandidateBonus: 0.15,
    };
  }

  /**
   * Klasik iterative spreading activation algoritması.
   *
   * Seed node'lardan başlayarak graph üzerinde activation yayar.
   * Her iterasyonda komşulara activation aktarılır, decay uygulanır.
   * Convergence sağlanana veya maxIterations'a ulaşılana kadar devam eder.
   *
   * @param seedNodeIds - Başlangıç node ID'leri
   * @param config - Opsiyonel konfigürasyon override'ları
   * @returns Activation sonuçları (nodeActivations, iterations, converged)
   */
  computeSpreadingActivation(
    seedNodeIds: number[],
    config?: Partial<SpreadingActivationConfig>
  ): SpreadingActivationResult {
    const cfg = this.buildSpreadingActivationConfig(config);
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
      const neighbors = this.getMemoryNeighborsBatch(activeNodeIds, 20);

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

    logger.debug({
      seedCount: seedNodeIds.length,
      resultCount: currentActivations.size,
      iterations,
      converged,
    }, '[Memory] Spreading activation completed');

    return {
      nodeActivations: currentActivations,
      iterations,
      converged,
    };
  }

  /**
   * Spreading Activation config oluşturur.
   */
  private buildSpreadingActivationConfig(overrides?: Partial<SpreadingActivationConfig>): SpreadingActivationConfig {
    return {
      decayFactor: 0.85,
      maxIterations: 10,
      minActivation: 0.01,
      relationTypeWeights: {
        'related_to': 1.0,
        'part_of': 0.9,
        'caused_by': 0.8,
        'associated_with': 0.7,
        'shared_entity': 0.6,
        'default': 0.5,
      },
      ...overrides,
    };
  }

  // ============================================
  // Token Usage Tracking
  // ============================================

  /**
   * Yeni token usage kaydı ekler.
   */
  saveTokenUsage(record: {
    provider: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }): void {
    const cost = calculateCost(record.provider, record.model, record.promptTokens, record.completionTokens);
    this.db.prepare(`
      INSERT INTO token_usage (provider, model, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(record.provider, record.model, record.promptTokens, record.completionTokens, record.totalTokens, cost);
  }

  /**
   * Toplam kullanım istatistiğini döndürür.
   * @param period - 'day', 'week', 'month', 'all'
   */
  getTokenUsageStats(period: string = 'week'): {
    totalTokens: number;
    totalCost: number;
    providerBreakdown: Record<string, { tokens: number; cost: number }>;
  } {
    const now = Math.floor(Date.now() / 1000);
    let periodSeconds: number;
    switch (period) {
      case 'day': periodSeconds = 86400; break;
      case 'week': periodSeconds = 604800; break;
      case 'month': periodSeconds = 2592000; break;
      default: periodSeconds = 0;
    }

    const whereClause = periodSeconds > 0 ? `WHERE created_at >= datetime(${now} - ${periodSeconds}, 'unixepoch')` : '';

    const totalRow = this.db.prepare(`
      SELECT
        COALESCE(SUM(total_tokens), 0) as totalTokens,
        COALESCE(SUM(estimated_cost_usd), 0) as totalCost
      FROM token_usage ${whereClause}
    `).get() as { totalTokens: number; totalCost: number };

    const providerRows = this.db.prepare(`
      SELECT
        provider,
        SUM(total_tokens) as tokens,
        SUM(estimated_cost_usd) as cost
      FROM token_usage ${whereClause}
      GROUP BY provider
      ORDER BY tokens DESC
    `).all() as Array<{ provider: string; tokens: number; cost: number }>;

    const providerBreakdown: Record<string, { tokens: number; cost: number }> = {};
    for (const row of providerRows) {
      providerBreakdown[row.provider] = { tokens: row.tokens, cost: row.cost };
    }

    return {
      totalTokens: totalRow.totalTokens,
      totalCost: totalRow.totalCost,
      providerBreakdown,
    };
  }

  /**
   * Günlük kullanım serisini döndürür.
   * @param period - 'day', 'week', 'month', 'all'
   */
  getDailyUsage(period: string = 'week'): Array<{ date: string; tokens: number; cost: number }> {
    const now = Math.floor(Date.now() / 1000);
    let periodSeconds: number;
    switch (period) {
      case 'day': periodSeconds = 86400; break;
      case 'week': periodSeconds = 604800; break;
      case 'month': periodSeconds = 2592000; break;
      default: periodSeconds = 0;
    }

    const whereClause = periodSeconds > 0 ? `WHERE created_at >= datetime(${now} - ${periodSeconds}, 'unixepoch')` : '';

    const rows = this.db.prepare(`
      SELECT
        DATE(created_at) as date,
        SUM(total_tokens) as tokens,
        SUM(estimated_cost_usd) as cost
      FROM token_usage ${whereClause}
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `).all() as Array<{ date: string; tokens: number; cost: number }>;

    return rows.map(r => ({ date: r.date, tokens: r.tokens, cost: r.cost }));
  }
}

// Default export
export default MemoryManager;
