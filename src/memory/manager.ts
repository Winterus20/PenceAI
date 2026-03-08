import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import { PenceDatabase } from './database.js';
import type { ConversationContext, ConversationMessage, ChannelType } from '../router/types.js';
import { type EmbeddingProvider, createEmbeddingProvider } from './embeddings.js';
import { getConfig } from '../gateway/config.js';
import { logger } from '../utils/logger.js';
import type { TaskQueue } from '../autonomous/queue.js';
import { TaskPriority } from '../autonomous/queue.js';
import { daysSince } from '../utils/datetime.js';

// Çıkarılan modüller
import { computeRetention, computeNextReview } from './ebbinghaus.js';
import {
    applyRetentionToRrfWithExplain,
    buildConversationTranscript,
    computeInitialReviewSchedule,
    computeReviewPriority,
    deriveMemoryWriteMetadata,
    rrfFusion,
    selectConversationAwareSupplementalMemories,
} from './contextUtils.js';
import { MemoryRetrievalOrchestrator } from './retrievalOrchestrator.js';
import { decideMemoryMerge, decideReconsolidationPilot, normalizeMemoryWriteInput } from './shortTermPhase.js';
import {
    escapeFtsQuery,
    inferMemoryType,
    CONVERSATION_TIMEOUT_MS, DEFAULT_USER_ID, DEFAULT_USER_NAME,
    type ConversationRow, type MessageRow, type MemoryRow,
    type MessageSearchRow, type RecentConversationRow,
    type GraphAwareSearchResult,
    type MemoryWriteMetadata,
    type ReconsolidationDecision,
} from './types.js';
import { MemoryGraphManager } from './graph.js';

// Re-export: dış modüllerin mevcut import'ları kırılmasın
export type { GraphNode, GraphEdge, MemoryGraph, GraphAwareSearchResult } from './types.js';


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

/**
 * Bellek yöneticisi — konuşma geçmişi ve uzun vadeli bellek.
 */
export class MemoryManager {
    private db: Database.Database;
    private embeddingProvider: EmbeddingProvider | null = null;
    private memoryLocks: Map<string, Promise<void>> = new Map();
    private graph: MemoryGraphManager;

    private getMemoryLockScope(category: string): string {
        const normalized = category.trim().toLowerCase();
        if (normalized === 'preference' || normalized === 'general' || normalized === 'user_fact' || normalized === 'profile') {
            return 'durable_profile';
        }
        return `category:${normalized || 'general'}`;
    }
    private retrievalOrchestrator: MemoryRetrievalOrchestrator;
    private lastRetrievalDebug: Map<string, unknown> = new Map();
    private lastMemoryWriteDebug: unknown = null;

    // Ebbinghaus — BackgroundWorker entegrasyonu
    private taskQueue: TaskQueue | null = null;

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
        this.graph = new MemoryGraphManager(this.db, this.embeddingProvider);
        this.retrievalOrchestrator = new MemoryRetrievalOrchestrator({
            graphAwareSearch: (query, limit, maxDepth) => this.graphAwareSearch(query, limit, maxDepth),
            getRecentConversationSummaries: (limit) => this.getRecentConversationSummaries(limit),
            getMemoriesDueForReview: (limit) => this.getMemoriesDueForReview(limit),
            getFollowUpCandidates: (days, limit) => this.getFollowUpCandidates(days, limit),
            getRecentMessages: (hours, limit, excludeConversationId) => this.getRecentMessages(hours, limit, excludeConversationId),
            getUserMemories: (limit) => this.getUserMemories(limit),
            getMemoryNeighborsBatch: (memoryIds, limitPerNode) => this.graph.getMemoryNeighborsBatch(memoryIds, limitPerNode),
            prioritizeConversationMemories: (memories, recentMessages, activeConversationId, limit) => this.prioritizeConversationMemories(memories, recentMessages, activeConversationId, limit),
            recordDebug: (payload) => this.recordRetrievalDebug('promptContextBundle', payload),
        });
    }

    /**
     * TaskQueue referansını ayarlar.
     * Gateway başlatıldıktan sonra çağrılır — Ebbinghaus güncellemeleri BackgroundWorker'ın boş zamanına ertelenir.
     */
    setTaskQueue(queue: TaskQueue): void {
        this.taskQueue = queue;
        logger.info('[Memory] ⚙️ TaskQueue bağlandı — Ebbinghaus güncellemeleri arka plana yönlendirilecek.');
    }

    // ========== Konuşma Yönetimi ==========

    /**
     * Yeni konuşma oluşturur veya mevcut konuşmayı döndürür.
     * 2 saatten uzun süredir sessiz kalan konuşmalar yerine yenisi başlatılır.
     * Timeout tetiklendiğinde previousConversationId ile eski konuşma ID'si döndürülür.
     */
    getOrCreateConversation(
        channelType: ChannelType,
        channelId: string,
        userName?: string
    ): { conversationId: string; previousConversationId?: string } {
        const resolvedUserName = userName || DEFAULT_USER_NAME;
        // Son aktif konuşmayı bul
        const existing = this.db.prepare(`
      SELECT id, updated_at FROM conversations
      WHERE channel_type = ? AND channel_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(channelType, channelId) as { id: string; updated_at: string } | undefined;

        if (existing) {
            // SQLite CURRENT_TIMESTAMP is always UTC but may lack 'Z' or 'T'.
            // Normalize to ISO 8601 before parsing to avoid local-timezone pitfalls.
            const raw = existing.updated_at;
            const dateStr = raw.includes('T')
                ? (raw.endsWith('Z') ? raw : raw + 'Z')
                : raw.replace(' ', 'T') + 'Z';
            const lastUpdate = new Date(dateStr).getTime();
            const now = Date.now();

            // Timeout kontrolü — 2 saatten eskiyse yeni konuşma başlat
            if (now - lastUpdate < CONVERSATION_TIMEOUT_MS) {
                this.db.prepare(`UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(existing.id);
                return { conversationId: existing.id };
            }
        }

        // Yeni oluştur
        const id = uuidv4();
        this.db.prepare(`
      INSERT INTO conversations (id, channel_type, channel_id, user_id, user_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, channelType, channelId, DEFAULT_USER_ID, resolvedUserName);

        return {
            conversationId: id,
            previousConversationId: existing?.id,
        };
    }

    /**
     * Runtime'ın bir kullanıcı turu için ihtiyaç duyduğu konuşma başlangıç adımlarını tekleştirir.
     * Konuşma bulma/açma, kullanıcı mesajını ekleme, ilk başlık atama ve history çekme burada yapılır.
     */
    beginConversationTurn(
        channelType: ChannelType,
        channelId: string,
        userName: string | undefined,
        message: ConversationMessage,
        historyLimit: number = 100,
    ): ConversationTurnBundle {
        const { conversationId, previousConversationId } = this.getOrCreateConversation(
            channelType,
            channelId,
            userName,
        );

        this.addMessage(conversationId, message);

        const history = this.getConversationHistory(conversationId, historyLimit);
        const userMessages = history.filter(entry => entry.role === 'user');
        if (userMessages.length === 1) {
            const title = message.content.substring(0, 80).replace(/\n/g, ' ');
            this.updateConversationTitle(conversationId, title);
        }

        return {
            conversationId,
            previousConversationId,
            history,
        };
    }

    /**
     * Konuşmaya mesaj ekler.
     */
    addMessage(conversationId: string, message: ConversationMessage): void {
        const result = this.db.prepare(`
      INSERT INTO messages (conversation_id, role, content, tool_calls, tool_results, attachments)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
            conversationId,
            message.role,
            message.content,
            message.toolCalls ? JSON.stringify(message.toolCalls) : null,
            message.toolResults ? JSON.stringify(message.toolResults) : null,
            message.attachments && message.attachments.length > 0 ? JSON.stringify(message.attachments) : null
        );

        // Konuşma updated_at güncelle
        this.db.prepare(`UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(conversationId);

        // Embedding hesapla — user/assistant, anlamlı uzunlukta içerikler
        if ((message.role === 'user' || message.role === 'assistant') && message.content.length > 20) {
            const msgId = Number(result.lastInsertRowid);
            this.computeAndStoreMessageEmbedding(msgId, message.content).catch(err => {
                logger.warn({ err: err }, `[Memory] Mesaj embedding başarısız (id=${msgId}):`);
            });
        }
    }

    /**
     * Konuşma geçmişini döndürür — son N mesajı kronolojik sırada.
     */
    getConversationHistory(conversationId: string, limit: number = 50): ConversationMessage[] {
        // Son N mesajı al, sonra kronolojik sıraya koy
        const rows = this.db.prepare(`
      SELECT * FROM (
        SELECT id, role, content, tool_calls, tool_results, attachments, created_at
        FROM messages
        WHERE conversation_id = ?
        ORDER BY id DESC
        LIMIT ?
      ) ORDER BY id ASC
    `).all(conversationId, limit) as MessageRow[];

        return rows.map(row => ({
            role: row.role as ConversationMessage['role'],
            content: row.content,
            timestamp: new Date(row.created_at.endsWith('Z') ? row.created_at : row.created_at.replace(' ', 'T') + 'Z'),
            toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
            toolResults: row.tool_results ? JSON.parse(row.tool_results) : undefined,
            attachments: row.attachments ? JSON.parse(row.attachments) : undefined,
        }));
    }

    /**
     * Tam konuşma bağlamını oluşturur.
     */
    getConversationContext(conversationId: string): ConversationContext | null {
        const conv = this.db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(conversationId) as ConversationRow | undefined;
        if (!conv) return null;

        const history = this.getConversationHistory(conversationId);

        return {
            conversationId: conv.id,
            channelType: conv.channel_type as ChannelType,
            channelId: conv.channel_id,
            userId: conv.user_id,
            userName: conv.user_name,
            history,
        };
    }

    /**
     * Son konuşmaları listeler (başlık ve mesaj sayısı ile).
     * LEFT JOIN + GROUP BY ile — correlated subquery yerine tek tarama.
     */
    getRecentConversations(limit: number = 20): RecentConversationRow[] {
        // OPT-4: message_count artık trigger ile sürdürülüyor, correlated subquery kaldırıldı.
        // OPT F-18: SELECT * yerine sadece gerekli sütunları çek (summary gibi uzun text'ler atlanır).
        return this.db.prepare(`
      SELECT
        c.id, c.title, c.channel_type, c.channel_id, c.user_id, c.user_name,
        c.created_at, c.updated_at, c.message_count, c.is_summarized,
        (SELECT content FROM messages WHERE conversation_id = c.id AND role = 'user' ORDER BY id ASC LIMIT 1) as first_message
      FROM conversations c
      ORDER BY c.updated_at DESC
      LIMIT ?
    `).all(limit) as RecentConversationRow[];
    }

    /**
     * Konuşma başlığını günceller.
     */
    updateConversationTitle(conversationId: string, title: string): void {
        this.db.prepare(`UPDATE conversations SET title = ? WHERE id = ?`).run(title, conversationId);
    }

    /**
     * Konuşmanın özetini kaydeder ve is_summarized bayrağını ayarlar.
     */
    updateConversationSummary(conversationId: string, summary: string): void {
        this.db.prepare(`
            UPDATE conversations
            SET summary = ?, is_summarized = 1, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(summary, conversationId);
    }

    /**
     * Özetlenmiş son N konuşmayı döndürür.
     * Sistem promptuna konuşma geçmişi bağlamı olarak enjekte edilir.
     */
    getRecentConversationSummaries(limit: number = 5): Array<{ id: string; title: string; summary: string; updated_at: string }> {
        return this.db.prepare(`
            SELECT id, title, summary, updated_at
            FROM conversations
            WHERE is_summarized = 1 AND summary != ''
            ORDER BY updated_at DESC
            LIMIT ?
        `).all(limit) as Array<{ id: string; title: string; summary: string; updated_at: string }>;
    }

    /**
     * Konuşmayı LLM tüketimi için normalize eder.
     * Runtime, history + userName + düzleştirilmiş transcript'i tek niyet tabanlı çağrı ile alır.
     */
    getConversationTranscriptBundle(conversationId: string, limit: number = 100): ConversationTranscriptBundle | null {
        const conv = this.db.prepare(`
            SELECT user_name
            FROM conversations
            WHERE id = ?
        `).get(conversationId) as Pick<ConversationRow, 'user_name'> | undefined;

        if (!conv) {
            return null;
        }

        const history = this.getConversationHistory(conversationId, limit);
        return buildConversationTranscript(history, conv.user_name);
    }

    /**
     * Agent prompt'u için gerekli memory-side bağlamı tek facade çağrısında toplar.
     * Böylece runtime, memory sorgu/fallback detaylarına daha az bağımlı kalır.
     */
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

    // ========== Uzun Vadeli Bellek ==========

    /**
     * Yeni bellek kaydı ekler veya mevcut benzer kaydı günceller (semantik dedup).
     * Önce embedding benzerliği kontrol edilir (cosine > 0.85 = aynı bellek).
     * Embedding yoksa FTS fallback kullanılır.
     * Mutex ile korunur — eşzamanlı çağrılar seri hale getirilir (#18).
     * @returns {{ id: number, isUpdate: boolean }} — eklenen/güncellenen kaydın ID'si ve güncelleme durumu
     */
    async addMemory(
        content: string,
        category: string = 'general',
        importance: number = 5,
        mergeFn?: (oldContent: string, newContent: string) => Promise<string>,
        metadata?: MemoryWriteMetadata,
    ): Promise<{ id: number; isUpdate: boolean }> {
        const normalized = normalizeMemoryWriteInput(content, category, importance);
        if (!normalized.accepted) {
            logger.info({ reasons: normalized.reasons }, '[Memory] Admission policy memory write reddedildi');
            return { id: -1, isUpdate: false };
        }

        if (normalized.reasons.length > 0) {
            logger.debug({ reasons: normalized.reasons, category: normalized.category }, '[Memory] Admission policy normalize uygulandı');
        }

        const resolvedMetadata = deriveMemoryWriteMetadata(normalized.category, metadata);
        const inferredMemoryType = inferMemoryType(normalized.content, normalized.category, {
            source: resolvedMetadata.source,
            conversationId: resolvedMetadata.conversationId,
            memoryType: metadata?.memoryType,
        });

        // Merge'e hassas kategorilerde aynı anda gelen benzer ama farklı cümleleri de seri hale getir.
        const contentLockKey = crypto.createHash('sha256').update(normalized.content).digest('hex');
        const scopeLockKey = this.getMemoryLockScope(normalized.category);
        const lockKey = `${scopeLockKey}:${contentLockKey}`;

        let releaseLock: () => void;
        const lockAcquired = new Promise<void>(resolve => { releaseLock = resolve; });
        const previousLock = this.memoryLocks.get(scopeLockKey) || Promise.resolve();
        this.memoryLocks.set(scopeLockKey, lockAcquired);
        await previousLock;

        logger.debug({
            category: normalized.category,
            scopeLockKey,
            contentLockKey,
            metadata: resolvedMetadata,
            memoryType: inferredMemoryType,
        }, '[Memory] addMemory lock acquired');

        try {
            return await this._addMemoryInternal(normalized.content, normalized.category, normalized.importance, inferredMemoryType.memoryType, mergeFn, resolvedMetadata);
        } finally {
            releaseLock!();
            // Bellek sızıntısını önle — kilit serbest bırakıldığında Map'ten temizle
            if (this.memoryLocks.get(scopeLockKey) === lockAcquired) {
                this.memoryLocks.delete(scopeLockKey);
            }
            logger.debug({ category: normalized.category, scopeLockKey, contentLockKey, lockKey }, '[Memory] addMemory lock released');
        }
    }

    private async _addMemoryInternal(
        content: string,
        category: string,
        importance: number,
        memoryType: 'episodic' | 'semantic',
        mergeFn?: (oldContent: string, newContent: string) => Promise<string>,
        metadata?: ReturnType<typeof deriveMemoryWriteMetadata>,
    ): Promise<{ id: number; isUpdate: boolean }> {
        const writeContextBase = {
            category,
            memoryType,
            confidence: metadata?.confidence ?? null,
            source: metadata?.source ?? null,
            reconsolidationHint: 'write_merge' as const,
        };

        // 1. Semantik dedup: embedding benzerliği ile kontrol et
        if (this.embeddingProvider) {
            try {
                const [newEmbedding] = await this.embeddingProvider.embed([content]);

                // Kategoriden bağımsız vektör araması; sqlite-vec KNN, lower distance is closer 
                // vec_distance_cosine calculates cosine distance (1 - cosine similarity). 
                // Sim > 0.85 -> distance < 0.15
                const queryArrayBuffer = Buffer.from(new Float32Array(newEmbedding).buffer);

                let bestMatch: { id: number; similarity: number; content: string } | null = null;

                const existingNearest = this.db.prepare(`
                    SELECT 
                        m.id, 
                        m.content, 
                        (1 - vec_distance_cosine(e.embedding, ?)) as similarity
                    FROM memory_embeddings e
                    JOIN memories m ON m.id = e.rowid
                    WHERE m.is_archived = 0
                    ORDER BY vec_distance_cosine(e.embedding, ?) ASC
                    LIMIT 1
                `).get(queryArrayBuffer, queryArrayBuffer) as { id: number; content: string; similarity: number } | undefined;

                if (existingNearest) {
                    bestMatch = existingNearest;
                }

                // Benzerlik > 0.80 ise güncelle (aynı/benzer bilgi veya alt küme)
                if (bestMatch && bestMatch.similarity >= 0.80) {
                    const mergeDecision = decideMemoryMerge({
                        category,
                        existingContent: bestMatch.content,
                        incomingContent: content,
                        semanticSimilarity: bestMatch.similarity,
                    });
                    const reconsolidation = decideReconsolidationPilot({
                        memoryType,
                        category,
                        existingContent: bestMatch.content,
                        incomingContent: content,
                        confidence: metadata?.confidence,
                        semanticSimilarity: bestMatch.similarity,
                    });

                    this.recordMemoryWriteDebug({
                        phase: 'semantic_dedup',
                        candidateId: bestMatch.id,
                        similarity: bestMatch.similarity,
                        mergeDecision,
                        reconsolidation,
                        ...writeContextBase,
                    });

                    if (mergeDecision.shouldMerge && reconsolidation.action === 'update') {
                        const betterContent = reconsolidation.candidateContent
                            ?? await this.resolveMergedContent(bestMatch.content, content, mergeFn, mergeDecision.preferredContent, '[Memory] Semantic dedup merge');

                        this.db.prepare(`
                        UPDATE memories
                        SET content = ?,
                            importance = MAX(importance, ?),
                            max_importance = MAX(COALESCE(max_importance, importance), ?),
                            access_count = access_count + 1,
                            last_accessed = CURRENT_TIMESTAMP,
                            updated_at = CURRENT_TIMESTAMP,
                            confidence = MAX(COALESCE(confidence, 0.0), ?),
                            provenance_source = COALESCE(provenance_source, ?),
                            provenance_conversation_id = COALESCE(provenance_conversation_id, ?),
                            provenance_message_id = COALESCE(provenance_message_id, ?),
                            review_profile = COALESCE(review_profile, ?),
                            memory_type = COALESCE(memory_type, ?)
                        WHERE id = ?
                        `).run(
                            betterContent,
                            importance,
                            importance,
                            metadata?.confidence ?? 0.7,
                            metadata?.source ?? null,
                            metadata?.conversationId ?? null,
                            metadata?.messageId ?? null,
                            metadata?.reviewProfile ?? 'standard',
                            memoryType,
                            bestMatch.id,
                        );

                        await this.computeAndStoreEmbedding(bestMatch.id, betterContent).catch(err => {
                            logger.warn({ err: err }, `[Memory] Semantik dedup embedding güncelleme başarısız (id=${bestMatch.id}):`);
                        });

                        logger.info(`[Memory] 🔗 Semantik dedup + reconsolidation: "${content.substring(0, 40)}..." → mevcut #${bestMatch.id} (sim=${bestMatch.similarity.toFixed(2)}, reason=${mergeDecision.reason}, action=${reconsolidation.action})`);
                        this.graph.autoCreateProximityRelations(bestMatch.id);
                        return { id: bestMatch.id, isUpdate: true };
                    }

                    if (mergeDecision.shouldMerge && reconsolidation.reason === 'exact_match_no_rewrite') {
                        this.db.prepare(`
                        UPDATE memories
                        SET importance = MAX(importance, ?),
                            max_importance = MAX(COALESCE(max_importance, importance), ?),
                            access_count = access_count + 1,
                            last_accessed = CURRENT_TIMESTAMP,
                            updated_at = CURRENT_TIMESTAMP,
                            confidence = MAX(COALESCE(confidence, 0.0), ?),
                            review_profile = COALESCE(review_profile, ?),
                            memory_type = COALESCE(memory_type, ?)
                        WHERE id = ?
                        `).run(
                            importance,
                            importance,
                            metadata?.confidence ?? 0.7,
                            metadata?.reviewProfile ?? 'standard',
                            memoryType,
                            bestMatch.id,
                        );
                        return { id: bestMatch.id, isUpdate: false };
                    }

                    logger.debug({ memoryId: bestMatch.id, reason: mergeDecision.reason, similarity: bestMatch.similarity, reconsolidation }, '[Memory] Semantik dedup merge atlandı');
                }
            } catch (err) {
                logger.warn({ err: err }, '[Memory] Semantik dedup başarısız, FTS fallback:');
            }
        }

        // 2. FTS fallback dedup (embedding yoksa veya başarısızsa)
        // İçerik çok uzunsa dev FTS sorgusu oluşmasını önlemek için ilk 15 kelimeyle sınırla
        const contentWords = content.split(/\s+/).slice(0, 15).join(' ');
        const ftsQuery = escapeFtsQuery(contentWords, true);
        if (ftsQuery) {
            try {
                const existing = this.db.prepare(`
                    SELECT m.id, m.content FROM memories m
                    JOIN memories_fts fts ON m.id = fts.rowid
                    WHERE memories_fts MATCH ? AND m.is_archived = 0
                    ORDER BY rank
                    LIMIT 1
                `).get(ftsQuery) as { id: number; content: string } | undefined;

                if (existing) {
                    // Jaccard benzerlik kontrolü — FTS yanlış pozitif verebilir
                    // Ek olarak "kapsama (containment)" kontrolü: eğer yeni bilgi mevcut bilginin alt kümesiyse
                    const tokenize = (t: string) => new Set(t.toLowerCase().split(/\s+/).filter(w => w.length > 2));
                    const setA = tokenize(content);
                    const setB = tokenize(existing.content);
                    const intersectionCount = [...setA].filter(x => setB.has(x)).length;
                    const unionSize = setA.size + setB.size - intersectionCount;
                    const jaccardSim = unionSize > 0 ? intersectionCount / unionSize : 0;

                    // Kapsama kontrolü: A, B'nin içinde tamamen (veya büyük oranda) yer alıyorsa
                    // Örn: "Yaş: 21" (A) vs "Kullanıcı 21 yaşında" (B)
                    const containmentRatio = setA.size > 0 ? intersectionCount / setA.size : 0;
                    const isContained = containmentRatio >= 0.80; // setA'nın kelimelerinin %80'i setB'de varsa

                    if (jaccardSim >= 0.5 || isContained) {
                        const mergeDecision = decideMemoryMerge({
                            category,
                            existingContent: existing.content,
                            incomingContent: content,
                            jaccardSimilarity: jaccardSim,
                            containmentRatio,
                        });
                        const reconsolidation = decideReconsolidationPilot({
                            memoryType,
                            category,
                            existingContent: existing.content,
                            incomingContent: content,
                            confidence: metadata?.confidence,
                            jaccardSimilarity: jaccardSim,
                            containmentRatio,
                        });

                        this.recordMemoryWriteDebug({
                            phase: 'fts_dedup',
                            candidateId: existing.id,
                            jaccardSimilarity: jaccardSim,
                            containmentRatio,
                            mergeDecision,
                            reconsolidation,
                            ...writeContextBase,
                        });

                        if (mergeDecision.shouldMerge && reconsolidation.action === 'update') {
                            const betterContent = reconsolidation.candidateContent
                                ?? await this.resolveMergedContent(existing.content, content, mergeFn, mergeDecision.preferredContent, '[Memory] FTS dedup merge');

                            this.db.prepare(`
                            UPDATE memories
                            SET content = ?,
                                importance = MAX(importance, ?),
                                max_importance = MAX(COALESCE(max_importance, importance), ?),
                                access_count = access_count + 1,
                                last_accessed = CURRENT_TIMESTAMP,
                                updated_at = CURRENT_TIMESTAMP,
                                confidence = MAX(COALESCE(confidence, 0.0), ?),
                                provenance_source = COALESCE(provenance_source, ?),
                                provenance_conversation_id = COALESCE(provenance_conversation_id, ?),
                                provenance_message_id = COALESCE(provenance_message_id, ?),
                                review_profile = COALESCE(review_profile, ?),
                                memory_type = COALESCE(memory_type, ?)
                            WHERE id = ?
                            `).run(
                                betterContent,
                                importance,
                                importance,
                                metadata?.confidence ?? 0.7,
                                metadata?.source ?? null,
                                metadata?.conversationId ?? null,
                                metadata?.messageId ?? null,
                                metadata?.reviewProfile ?? 'standard',
                                memoryType,
                                existing.id,
                            );

                            try {
                                await this.computeAndStoreEmbedding(existing.id, betterContent);
                                this.graph.autoCreateProximityRelations(existing.id);
                            } catch (err) {
                                logger.warn({ err: err }, `[Memory] FTS dedup embedding güncelleme başarısız (id=${existing.id}):`);
                            }

                            logger.debug({ memoryId: existing.id, reason: mergeDecision.reason, jaccardSim, containmentRatio, reconsolidation }, '[Memory] FTS dedup merge uygulandı');
                            return { id: existing.id, isUpdate: true };
                        }

                        if (mergeDecision.shouldMerge && reconsolidation.reason === 'exact_match_no_rewrite') {
                            this.db.prepare(`
                            UPDATE memories
                            SET importance = MAX(importance, ?),
                                max_importance = MAX(COALESCE(max_importance, importance), ?),
                                access_count = access_count + 1,
                                last_accessed = CURRENT_TIMESTAMP,
                                updated_at = CURRENT_TIMESTAMP,
                                confidence = MAX(COALESCE(confidence, 0.0), ?),
                                review_profile = COALESCE(review_profile, ?),
                                memory_type = COALESCE(memory_type, ?)
                            WHERE id = ?
                            `).run(
                                importance,
                                importance,
                                metadata?.confidence ?? 0.7,
                                metadata?.reviewProfile ?? 'standard',
                                memoryType,
                                existing.id,
                            );
                            return { id: existing.id, isUpdate: false };
                        }
                    }
                    logger.info(`[Memory] FTS eşleşmesi atlandı (jaccard=${jaccardSim.toFixed(2)}, contained=${isContained}): "${content.substring(0, 40)}..."`);
                }
            } catch (err) {
                logger.warn({ err: err }, '[Memory] FTS dedup sorgusu başarısız:');
            }
        }

        this.recordMemoryWriteDebug({
            phase: 'insert_new_memory',
            mergeCandidateFound: false,
            reconsolidation: {
                pilotActive: true,
                eligible: false,
                action: 'append',
                reason: 'no_safe_update_candidate',
                safetyReasons: ['append_first_fallback'],
                preferredContent: 'incoming',
                candidateContent: content,
            } satisfies ReconsolidationDecision,
            ...writeContextBase,
        });

        // 3. Yeni kayıt
        const reviewSchedule = computeInitialReviewSchedule(importance, category, metadata?.reviewProfile);
        const initialStability = reviewSchedule.initialStability;
        const initialNextReview = computeNextReview(initialStability);

        const result = this.db.prepare(`
            INSERT INTO memories (
                user_id, content, category, importance, max_importance, last_accessed,
                stability, retrievability, next_review_at, review_count,
                provenance_source, provenance_conversation_id, provenance_message_id,
                confidence, review_profile, memory_type
            )
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 1.0, ?, 0, ?, ?, ?, ?, ?, ?)
        `).run(
            DEFAULT_USER_ID,
            content,
            category,
            importance,
            importance,
            initialStability,
            initialNextReview,
            metadata?.source ?? null,
            metadata?.conversationId ?? null,
            metadata?.messageId ?? null,
            metadata?.confidence ?? 0.7,
            reviewSchedule.profile,
            memoryType,
        );

        const newId = Number(result.lastInsertRowid);

        // Embedding'i senkron olarak hesapla — async fire-and-forget yapılırsa
        // hemen ardından gelen benzer bir addMemory çağrısı semantik dedup'u kaçırabilir (race condition).
        try {
            await this.computeAndStoreEmbedding(newId, content);
            this.graph.autoCreateProximityRelations(newId);
        } catch (err) {
            logger.warn({ err: err }, `[Memory] Embedding hesaplama başarısız (id=${newId}):`);
        }

        return { id: newId, isUpdate: false };
    }

    /**
     * Belleklerde tam metin arama yapar (iç kullanım — stability güncellemesi yapmaz).
     * hybridSearch gibi metotlar bunu kullanır, böylece Ebbinghaus ağırlıklandırması
     * erişim öncesi değerlerle çalışabilir.
     */
    private _searchMemoriesRaw(query: string, limit: number = 10): MemoryRow[] {
        const ftsQuery = escapeFtsQuery(query);
        if (!ftsQuery) return [];

        return this.db.prepare(`
            SELECT m.* FROM memories m
            JOIN memories_fts fts ON m.id = fts.rowid
            WHERE memories_fts MATCH ? AND m.is_archived = 0
            ORDER BY bm25(memories_fts)
            LIMIT ?
        `).all(ftsQuery, limit) as MemoryRow[];
    }

    /**
     * Belleklerde tam metin arama yapar.
     * Doğrudan kullanıcıya sunulacak aramalar için.
     * Ebbinghaus stability güncellemesi BackgroundWorker'a ertelenir (kullanıcı uyurken yapılır).
     */
    searchMemories(query: string, limit: number = 10): MemoryRow[] {
        const rows = this._searchMemoriesRaw(query, limit);
        // Stability güncellemeyi BackgroundWorker'a ertele — ana thread'i bloklamaz
        this._enqueueEbbinghausToWorker(rows.map(r => r.id));
        return rows;
    }

    /**
     * Erişilen bellek ID'lerini TaskQueue'ın arka plan worker'ına gönderir.
     * Worker boşta olduğunda toplu UPDATE çalıştırır.
     * TaskQueue yoksa (test ortamı vb.) sessizce atlanır.
     */
    private _enqueueEbbinghausToWorker(memoryIds: number[]): void {
        if (!this.taskQueue || memoryIds.length === 0) return;

        this.taskQueue.enqueue({
            id: `ebbinghaus_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            type: 'ebbinghaus_update',
            priority: TaskPriority.P4_LOW,
            payload: { memoryIds },
            addedAt: Date.now(),
        });
    }

    /**
     * BackgroundWorker tarafından çağrılır — biriken Ebbinghaus güncellemelerini DB'ye yazar.
     * Eşzamanlı arama trafiğinden tamamen izole, kullanıcı boştayken çalışır.
     */
    executeEbbinghausUpdates(memoryIds: number[]): void {
        const uniqueIds = [...new Set(memoryIds)];
        if (uniqueIds.length === 0) return;

        const placeholders = uniqueIds.map(() => '?').join(',');

        const transaction = this.db.transaction(() => {
            const rows = this.db.prepare(
                `SELECT * FROM memories WHERE id IN (${placeholders}) AND is_archived = 0`
            ).all(...uniqueIds) as MemoryRow[];

            for (const row of rows) {
                this.graph.updateStabilityOnAccess(row);
            }
        });

        try {
            transaction();
            logger.debug(`[Memory] 🔄 Ebbinghaus worker flush: ${uniqueIds.length} bellek güncellendi`);
        } catch (err) {
            logger.warn({ err: err }, '[Memory] Ebbinghaus worker flush hatası:');
        }
    }

    /**
     * Kullanıcının belleklerini önem ve kullanım skoruna göre döndürür.
     * Scoring: importance * 2 + access_count
     */
    getUserMemories(limit: number = 50): MemoryRow[] {
        return this.db.prepare(`
            SELECT * FROM memories
            WHERE is_archived = 0
            ORDER BY (importance * 2 + access_count) DESC, updated_at DESC
            LIMIT ?
        `).all(limit) as MemoryRow[];
    }

    /**
     * Son N saat içindeki kullanıcı mesajlarını döndürür (tüm konuşmalardan).
     * Günlük bağlam oluşturmak için kullanılır — bellekte saklanmayan kısa vadeli bilgiler.
     */
    getRecentMessages(hours: number = 48, limit: number = 30, excludeConversationId?: string): Array<{ role: string; content: string; created_at: string; conversation_title: string }> {
        if (excludeConversationId) {
            return this.db.prepare(`
                SELECT m.role, m.content, m.created_at, COALESCE(c.title, '') as conversation_title
                FROM messages m
                JOIN conversations c ON c.id = m.conversation_id
                WHERE m.role IN ('user', 'assistant')
                  AND m.created_at >= datetime('now', '-' || ? || ' hours')
                  AND m.conversation_id != ?
                ORDER BY m.created_at DESC
                LIMIT ?
            `).all(hours, excludeConversationId, limit) as Array<{ role: string; content: string; created_at: string; conversation_title: string }>;
        }
        return this.db.prepare(`
            SELECT m.role, m.content, m.created_at, COALESCE(c.title, '') as conversation_title
            FROM messages m
            JOIN conversations c ON c.id = m.conversation_id
            WHERE m.role IN ('user', 'assistant')
              AND m.created_at >= datetime('now', '-' || ? || ' hours')
            ORDER BY m.created_at DESC
            LIMIT ?
        `).all(hours, limit) as Array<{ role: string; content: string; created_at: string; conversation_title: string }>;
    }

    /**
     * Mesajlarda tam metin arama yapar.
     */
    searchMessages(query: string, limit: number = 20): MessageRow[] {
        const ftsQuery = escapeFtsQuery(query);
        if (!ftsQuery) return [];

        return this.db.prepare(`
      SELECT m.* FROM messages m
      JOIN messages_fts fts ON m.id = fts.rowid
      WHERE messages_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit) as MessageRow[];
    }

    // ========== Semantik Benzerlik Araması ==========

    /**
     * Tek bir metnin embedding'ini hesaplayıp memory_embeddings tablosuna kaydeder.
     */
    /**
     * OPT F-13: Jenerik embedding hesaplama ve kaydetme — tablo adı parametre olarak alınır.
     * sqlite-vec sanal tablosu OR REPLACE desteklemez → DELETE + INSERT.
     */
    private async _computeAndStoreEmbeddingGeneric(
        id: number,
        content: string,
        table: 'memory_embeddings' | 'message_embeddings'
    ): Promise<void> {
        if (!this.embeddingProvider) return;

        try {
            const [embedding] = await this.embeddingProvider.embed([content]);
            const idBig = BigInt(id);
            const buf = Buffer.from(new Float32Array(embedding).buffer);

            this.db.transaction(() => {
                this.db.prepare(`DELETE FROM ${table} WHERE rowid = CAST(? AS INTEGER)`).run(idBig);
                this.db.prepare(`INSERT INTO ${table} (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)`).run(idBig, buf);
            })();
        } catch (err) {
            logger.warn({ err: err }, `[Memory] Embedding kayıt hatası (${table}, id=${id}):`);
        }
    }

    private async computeAndStoreEmbedding(memoryId: number, content: string): Promise<void> {
        return this._computeAndStoreEmbeddingGeneric(memoryId, content, 'memory_embeddings');
    }

    private async computeAndStoreMessageEmbedding(messageId: number, content: string): Promise<void> {
        return this._computeAndStoreEmbeddingGeneric(messageId, content, 'message_embeddings');
    }

    /**
     * Semantik benzerlik araması — sorgu metnini embed eder,
     * sqlite-vec ile cosine similarity hesaplar.
     */
    async semanticSearch(query: string, limit: number = 10): Promise<(MemoryRow & { similarity: number })[]> {
        if (!this.embeddingProvider) return [];

        try {
            // Sorguyu embed et
            const [queryEmbedding] = await this.embeddingProvider.embed([query]);
            const queryArrayBuffer = Buffer.from(new Float32Array(queryEmbedding).buffer);

            const threshold = getConfig().semanticSearchThreshold;
            const results = this.db.prepare(`
                WITH matched AS (
                    SELECT rowid, vec_distance_cosine(embedding, ?) as distance
                    FROM memory_embeddings
                    WHERE embedding MATCH ? AND k = 50
                )
                SELECT 
                    m.*, 
                    (1 - w.distance) as similarity
                FROM matched w
                JOIN memories m ON m.id = w.rowid
                WHERE m.is_archived = 0 
                  AND (1 - w.distance) >= ?
                ORDER BY w.distance ASC
                LIMIT ?
            `).all(queryArrayBuffer, queryArrayBuffer, threshold, limit) as (MemoryRow & { similarity: number })[];

            this._enqueueEbbinghausToWorker(results.map(r => r.id));
            return results;
        } catch (err) {
            logger.warn({ err: err }, '[Memory] Semantik arama hatası:');
            return [];
        }
    }

    /**
     * Hibrit arama — FTS (kelime eşleşmesi) + Semantik (anlam benzerliği) sonuçlarını birleştirir.
     * Reciprocal Rank Fusion (RRF) ile sıralama yapar.
     * Sonuçlar Ebbinghaus retrievability değeriyle ağırlıklandırılır.
     */
    async hybridSearch(query: string, limit: number = 10): Promise<MemoryRow[]> {
        // 1. FTS arama (raw — stability güncellenmez, Ebbinghaus ağırlıklandırması doğru çalışsın)
        const ftsResults = this._searchMemoriesRaw(query, limit);

        // 2. Semantik arama
        const semanticResults = await this.semanticSearch(query, limit);

        if (semanticResults.length === 0) {
            this.recordRetrievalDebug('hybridSearch', { query, limit, strategy: 'fts_only', ftsCount: ftsResults.length, semanticCount: 0, resultIds: ftsResults.map(item => item.id) });
            return ftsResults;
        }
        if (ftsResults.length === 0) {
            this.recordRetrievalDebug('hybridSearch', { query, limit, strategy: 'semantic_only', ftsCount: 0, semanticCount: semanticResults.length, resultIds: semanticResults.map(item => item.id) });
            return semanticResults;
        }

        // 3. OPT F-02: Jenerik RRF fusion ile birleştir
        const fusedResults = rrfFusion(
            ftsResults, semanticResults,
            (m) => m.id, (m) => m, limit,
        );

        const retained = applyRetentionToRrfWithExplain(fusedResults.scoreEntries, limit);
        const merged = retained.results;
        const explainById = new Map(retained.explain.map(entry => [entry.id, entry]));

        this.recordRetrievalDebug('hybridSearch', {
            query,
            limit,
            strategy: 'hybrid_rrf',
            ftsCount: ftsResults.length,
            semanticCount: semanticResults.length,
            explain: (fusedResults.explain ?? []).map(entry => ({
                ...entry,
                retentionWeight: explainById.get(entry.id)?.retentionWeight,
                finalScore: explainById.get(entry.id)?.finalScore,
            })),
            resultIds: merged.map(item => item.id),
        });

        this._enqueueEbbinghausToWorker(merged.map(m => m.id));
        return merged;
    }

    // ========== Mesajlarda Semantik & Hibrit Arama ==========

    /**
     * Mesajlarda semantik benzerlik araması — sorgu metnini embed eder,
     * sqlite-vec ile cosine similarity hesaplar ve konuşma bilgisiyle zenginleştirir.
     */
    async semanticSearchMessages(query: string, limit: number = 10): Promise<MessageSearchRow[]> {
        if (!this.embeddingProvider) return [];

        try {
            const [queryEmbedding] = await this.embeddingProvider.embed([query]);
            const queryBuf = Buffer.from(new Float32Array(queryEmbedding).buffer);

            const results = this.db.prepare(`
                WITH matched AS (
                    SELECT rowid, vec_distance_cosine(embedding, ?) as distance
                    FROM message_embeddings
                    WHERE embedding MATCH ? AND k = 50
                )
                SELECT
                    m.*,
                    (1 - w.distance) as similarity,
                    COALESCE(c.title, '') as conversation_title,
                    c.channel_type
                FROM matched w
                JOIN messages m ON m.id = w.rowid
                JOIN conversations c ON c.id = m.conversation_id
                WHERE m.role IN ('user', 'assistant')
                  AND w.distance <= 0.75
                ORDER BY w.distance ASC
                LIMIT ?
            `).all(queryBuf, queryBuf, limit) as MessageSearchRow[];

            return results;
        } catch (err) {
            logger.warn({ err: err }, '[Memory] Mesaj semantik arama hatası:');
            return [];
        }
    }

    /**
     * Mesajlarda hibrit arama — FTS (kelime eşleşmesi) + Semantik (anlam benzerliği).
     * Reciprocal Rank Fusion (RRF) ile sıralama yapar.
     */
    async hybridSearchMessages(query: string, limit: number = 10): Promise<MessageSearchRow[]> {
        // 1. FTS arama — konuşma bilgisiyle join
        const ftsQuery = escapeFtsQuery(query);
        const ftsResults: MessageSearchRow[] = ftsQuery ? (this.db.prepare(`
            SELECT m.*, 0.0 as similarity, COALESCE(c.title, '') as conversation_title, c.channel_type
            FROM messages m
            JOIN messages_fts fts ON m.id = fts.rowid
            JOIN conversations c ON c.id = m.conversation_id
            WHERE messages_fts MATCH ?
            ORDER BY rank
            LIMIT ?
        `).all(ftsQuery, limit) as MessageSearchRow[]) : [];

        // 2. Semantik arama
        const semanticResults = await this.semanticSearchMessages(query, limit);

        if (semanticResults.length === 0) {
            this.recordRetrievalDebug('hybridSearchMessages', { query, limit, strategy: 'fts_only', ftsCount: ftsResults.length, semanticCount: 0, resultIds: ftsResults.map(item => item.id) });
            return ftsResults;
        }
        if (ftsResults.length === 0) {
            this.recordRetrievalDebug('hybridSearchMessages', { query, limit, strategy: 'semantic_only', ftsCount: 0, semanticCount: semanticResults.length, resultIds: semanticResults.map(item => item.id) });
            return semanticResults;
        }

        // 3. OPT F-02: Jenerik RRF fusion
        const fused = rrfFusion(
            ftsResults, semanticResults,
            (m) => m.id, (m) => m, limit,
        );
        this.recordRetrievalDebug('hybridSearchMessages', {
            query,
            limit,
            strategy: 'hybrid_rrf',
            ftsCount: ftsResults.length,
            semanticCount: semanticResults.length,
            explain: fused.explain ?? [],
            resultIds: fused.results.map(item => item.id),
        });
        return fused.results;
    }

    /**
     * OPT F-14: Jenerik batch embedding backfill — tablo adı ve sorgu parametre olarak alınır.
     */
    private async _ensureEmbeddingsGeneric(
        findMissingSql: string,
        table: 'memory_embeddings' | 'message_embeddings',
        label: string,
    ): Promise<number> {
        if (!this.embeddingProvider) return 0;

        const missing = this.db.prepare(findMissingSql).all() as Array<{ id: number; content: string }>;
        if (missing.length === 0) return 0;

        logger.info(`[Memory] ${missing.length} ${label} için embedding hesaplanıyor...`);

        const batchSize = 50;
        let processed = 0;

        for (let i = 0; i < missing.length; i += batchSize) {
            const batch = missing.slice(i, i + batchSize);
            try {
                const texts = batch.map(m => m.content);
                const embeddings = await this.embeddingProvider!.embed(texts);

                // sqlite-vec sanal tablosu OR REPLACE desteklemez → DELETE + INSERT
                const deleteStmt = this.db.prepare(`DELETE FROM ${table} WHERE rowid = CAST(? AS INTEGER)`);
                const insertStmt = this.db.prepare(`INSERT INTO ${table} (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)`);

                const insertMany = this.db.transaction((items: Array<{ id: number; embedding: number[] }>) => {
                    for (const item of items) {
                        const idBig = BigInt(item.id);
                        deleteStmt.run(idBig);
                        insertStmt.run(idBig, Buffer.from(new Float32Array(item.embedding).buffer));
                    }
                });

                insertMany(batch.map((m, idx) => ({ id: Number(m.id), embedding: embeddings[idx] })));
                processed += batch.length;
                logger.info(`[Memory]   → ${processed}/${missing.length} ${label} embedding hesaplandı`);
            } catch (err) {
                logger.error({ err: err }, `[Memory] Batch ${label} embedding hatası (${i}-${i + batch.length}):`);
            }
        }

        return processed;
    }

    /**
     * Embedding'i hesaplanmamış bellekleri bulur ve batch olarak hesaplar.
     */
    async ensureAllEmbeddings(): Promise<number> {
        return this._ensureEmbeddingsGeneric(
            `SELECT m.id, m.content FROM memories m
             LEFT JOIN memory_embeddings me ON m.id = me.rowid
             WHERE me.rowid IS NULL`,
            'memory_embeddings',
            'bellek',
        );
    }

    /**
     * Embedding'i hesaplanmamış mesajları bulur ve batch olarak hesaplar.
     */
    async ensureAllMessageEmbeddings(): Promise<number> {
        return this._ensureEmbeddingsGeneric(
            `SELECT m.id, m.content FROM messages m
             LEFT JOIN message_embeddings me ON m.id = me.rowid
             WHERE me.rowid IS NULL
               AND m.role IN ('user', 'assistant')
               AND LENGTH(m.content) > 20`,
            'message_embeddings',
            'mesaj',
        );
    }

    /**
     * Bellek kaydını siler.
     */
    deleteMemory(memoryId: number): boolean {
        const result = this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(memoryId);
        if (result.changes > 0) {
            // Orphan embedding kaydını da temizle
            try {
                this.db.prepare(`DELETE FROM memory_embeddings WHERE rowid = CAST(? AS INTEGER)`).run(BigInt(memoryId));
            } catch (err) {
                logger.warn({ err: err }, `[Memory] Embedding silme başarısız (id=${memoryId}):`);
            }
            // Graph verilerini temizle
            this.graph.cleanupMemoryGraph(memoryId);
        }
        return result.changes > 0;
    }

    /**
     * Bellek kaydını günceller.
     */
    async editMemory(memoryId: number, content: string, category: string, importance: number): Promise<boolean> {
        try {
            const oldMemory = this.db.prepare(`SELECT content as old_content FROM memories WHERE id = ?`).get(memoryId) as { old_content: string } | undefined;
            if (!oldMemory) return false;

            const result = this.db.prepare(`
                UPDATE memories
                SET content = ?, category = ?, importance = ?,
                    max_importance = MAX(COALESCE(max_importance, ?), ?),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(content, category, importance, importance, importance, memoryId);

            if (result.changes > 0) {
                // Sadece içerik değiştiyse embedding'i güncelle
                if (oldMemory.old_content !== content) {
                    try {
                        await this.computeAndStoreEmbedding(memoryId, content);
                    } catch (err) {
                        // Embedding güncelleme başarısız — stale embedding'i sil ki sonraki
                        // semantik aramalarda yanlış sonuç dönmesin.
                        try {
                            this.db.prepare(`DELETE FROM memory_embeddings WHERE rowid = ?`).run(memoryId);
                        } catch { /* vec0 satırı zaten olmayabilir */ }
                        logger.warn({ err: err }, `[Memory] Embedding güncelleme başarısız, stale embedding silindi (id=${memoryId}):`);
                    }
                }
                return true;
            }
            return false;
        } catch (err) {
            logger.error({ err: err }, `[Memory] Bellek güncellenemedi (id=${memoryId}):`);
            return false;
        }
    }

    /**
     * Ebbinghaus Forgetting Curve tabanlı bellek decay.
     * Tüm aktif bellekler için güncel R(t) hesaplanır:
     *   R < 0.1  → arşivle (hafıza büyük ölçüde unutulmuş)
     *   0.1 ≤ R < 0.5 → importance'ı 1 düşür (zayıflıyor)
     * retrievability sütunu güncellenir.
     */
    decayMemories(): { decayed: number; archived: number } {
        const activeMemories = this.db.prepare(`
            SELECT id, importance, stability, COALESCE(last_accessed, created_at) as last_accessed
            FROM memories
            WHERE is_archived = 0
        `).all() as Array<{ id: number; importance: number; stability: number | null; last_accessed: string | null }>;

        let decayed = 0;
        let archived = 0;
        const nowMs = Date.now();

        const archiveStmt = this.db.prepare(`
            UPDATE memories SET is_archived = 1, retrievability = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `);
        const weakenStmt = this.db.prepare(`
            UPDATE memories
            SET importance = MAX(1, importance - 1), retrievability = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        const updateRetStmt = this.db.prepare(`
            UPDATE memories SET retrievability = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `);
        const fixNullStabilityStmt = this.db.prepare(`
            UPDATE memories SET stability = ?, next_review_at = ? WHERE id = ? AND stability IS NULL
        `);

        const runDecay = this.db.transaction(() => {
            for (const mem of activeMemories) {
                const stability = mem.stability ?? (mem.importance * 2.0);

                // Null stability'yi DB'ye yaz (çifte ceza önleme — tek seferlik backfill)
                if (mem.stability === null) {
                    fixNullStabilityStmt.run(stability, computeNextReview(stability), mem.id);
                }

                // OPT F-07: daysSince yard\u0131mc\u0131s\u0131 ile tarih normalizasyonu
                const dSince = daysSince(mem.last_accessed, nowMs);

                const R = computeRetention(stability, dSince);

                if (R < 0.1) {
                    archiveStmt.run(R, mem.id);
                    archived++;
                } else if (R < 0.5) {
                    weakenStmt.run(R, mem.id);
                    decayed++;
                } else {
                    // Sadece retrievability güncelle
                    updateRetStmt.run(R, mem.id);
                }
            }
        });

        runDecay();

        logger.info(`[Memory] 📉 Ebbinghaus decay: ${decayed} zayıfladı, ${archived} arşivlendi (${activeMemories.length} bellek işlendi)`);
        return { decayed, archived };
    }

    /**
     * Review zamanı gelmiş bellekleri döndürür.
     * next_review_at <= şu an, retrievability'ye göre öncelik sıralanır (en düşük önce).
     * Sistem promptuna enjekte edilir; bu enjeksiyon stability'yi tetiklemez.
     */
    getMemoriesDueForReview(limit: number = 5): MemoryRow[] {
        const nowSec = Math.floor(Date.now() / 1000);
        const dueMemories = this.db.prepare(`
            SELECT * FROM memories
            WHERE is_archived = 0
              AND next_review_at IS NOT NULL
              AND next_review_at <= ?
            LIMIT ?
        `).all(nowSec, Math.max(limit * 3, limit)) as MemoryRow[];

        return dueMemories
            .sort((a, b) => computeReviewPriority(b, nowSec) - computeReviewPriority(a, nowSec))
            .slice(0, limit);
    }

    /**
     * Yakın geçmişteki (varsayılan: son 14 gün) "event" veya "project" kategorisindeki bellekleri döndürür.
     * Bu bilgiler asistanın yeni bir sohbete proaktif olarak (inisiyatif alıp konuyu açarak) başlaması için kullanılır.
     */
    getFollowUpCandidates(days: number = 14, limit: number = 3): MemoryRow[] {
        return this.db.prepare(`
            SELECT * FROM memories
            WHERE is_archived = 0
              AND category IN ('event', 'project')
              AND updated_at >= datetime('now', '-' || ? || ' days')
            ORDER BY updated_at DESC
            LIMIT ?
        `).all(days, limit) as MemoryRow[];
    }

    /**
     * Konuşmayı siler.
     * @returns silme başarılıysa true, konuşma bulunamadıysa false
     */
    deleteConversation(conversationId: string): boolean {
        // Önce silinecek mesajların ID'lerini al → message_embeddings temizliği için
        const msgIds = this.db.prepare(
            `SELECT id FROM messages WHERE conversation_id = ?`
        ).all(conversationId) as Array<{ id: number }>;

        // Orphan message embedding'lerini temizle
        if (msgIds.length > 0) {
            try {
                const deleteEmbStmt = this.db.prepare(`DELETE FROM message_embeddings WHERE rowid = CAST(? AS INTEGER)`);
                const cleanupEmbeddings = this.db.transaction((ids: Array<{ id: number }>) => {
                    for (const { id } of ids) {
                        deleteEmbStmt.run(BigInt(id));
                    }
                });
                cleanupEmbeddings(msgIds);
            } catch (err) {
                logger.warn({ err: err }, `[Memory] Mesaj embedding temizleme başarısız (conv=${conversationId}):`);
            }
        }

        const { changes: deletedMsgs } = this.db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).run(conversationId);
        const { changes: deletedConvs } = this.db.prepare(`DELETE FROM conversations WHERE id = ?`).run(conversationId);

        if (deletedMsgs > 0 || deletedConvs > 0) {
            logger.info(`[Memory] Silindi: ${deletedMsgs} mesaj, ${deletedConvs} konuşma (conv=${conversationId})`);
        }

        return deletedConvs > 0;
    }


    /**
     * İstatistikleri döndürür. Her çağrıda DB'den güncel değerleri okur.
     */
    getStats(): { conversations: number; messages: number; memories: number } {
        // OPT F-06: 3 ayrı COUNT sorgusu yerine tek sorgu
        const row = this.db.prepare(`
            SELECT
                (SELECT COUNT(*) FROM conversations) as conversations,
                (SELECT COUNT(*) FROM messages) as messages,
                (SELECT COUNT(*) FROM memories WHERE is_archived = 0) as memories
        `).get() as { conversations: number; messages: number; memories: number };
        return row;
    }

    // ========== Memory Graph Delegasyonları ==========

    /** Entity extraction + ilişki kurma (graph.ts'e delege). */
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

    /** 1-hop komşuları döndürür. */
    getMemoryNeighbors(memoryId: number, limit: number = 10) {
        return this.graph.getMemoryNeighbors(memoryId, limit);
    }

    /**
     * Birden fazla belleğin 1-hop komşularını tek sorguda döndürür.
     */
    getMemoryNeighborsBatch(memoryIds: number[], limitPerNode: number = 10) {
        return this.graph.getMemoryNeighborsBatch(memoryIds, limitPerNode);
    }

    /** Bellek entity'lerini döndürür. */
    getMemoryEntities(memoryId: number) {
        return this.graph.getMemoryEntities(memoryId);
    }

    /** Tüm bellek graph'ını döndürür (frontend görselleştirme). */
    getMemoryGraph() {
        return this.graph.getMemoryGraph();
    }

    /**
     * Graph-aware hibrit arama — standart hibrit arama sonuçlarının
     * 1-hop komşularını da dahil eder.
     *
     * Archival Fallback: Aktif sonuçlar kalite eşiğinin altındaysa
     * arşivlenen belleklerde de arar ve düşük importance ile yeniden aktif eder (re-learning).
     *
     * Stability Reinforcement: Context'e giren tüm aktif bellekler için
     * updateStabilityOnAccess çağrılır — Ebbinghaus spaced repetition.
     */
    async graphAwareSearch(query: string, limit: number = 10, maxDepth: number = 2): Promise<GraphAwareSearchResult> {
        const QUALITY_MIN_RESULTS = 3;
        const ARCHIVAL_LIMIT = 5;

        // 1. Standart hibrit arama
        const directResults = await this.hybridSearch(query, Math.min(limit, 7));

        if (directResults.length === 0) {
            // Aktif bellekte hiç sonuç yok — arşive bak
            const archivalResults = await this.archivalSearch(query, ARCHIVAL_LIMIT);
            if (archivalResults.length > 0) {
                this.dearchiveMemories(archivalResults);
            }
            this.recordRetrievalDebug('graphAwareSearch', { query, limit, maxDepth, directCount: 0, neighborCount: 0, archivalCount: archivalResults.length, expandedFromIds: [], activeIds: [], archivalIds: archivalResults.map(item => item.id) });
            return { active: [], archival: archivalResults };
        }

        // 2. Her sonucun komşularını topla (Çok Sekmeli / Multi-hop BFS)
        const resultIds = new Set(directResults.map(m => m.id));
        const neighborMemories: MemoryRow[] = [];
        const expandedMemoryIds = new Set<number>();

        let currentWave = directResults.slice(0, 5);
        for (let depth = 0; depth < maxDepth; depth++) {
            const nextWave: MemoryRow[] = [];
            // OPT F-01: Batch komşu sorgusu — N+1 yerine tek sorgu
            const waveIds = currentWave.map(m => m.id);
            const batchNeighbors = this.graph.getMemoryNeighborsBatch(waveIds, 3);
            for (const mem of currentWave) {
                const neighbors = batchNeighbors.get(mem.id) || [];
                for (const n of neighbors) {
                    if (!resultIds.has(n.id) && n.confidence >= 0.4) {
                        resultIds.add(n.id);
                        neighborMemories.push(n);
                        expandedMemoryIds.add(mem.id);
                        nextWave.push(n);
                    }
                }
            }
            currentWave = nextWave.slice(0, 5); // Context patlamasını önle
        }

        // 3. İlişki güçlendirme artık Ebbinghaus worker'a bırakılıyor (adım 5).
        //    Daha önce burada yapılan reinforceRelationsOnAccess çağrısı,
        //    updateStabilityOnAccess → reinforceConnectedMemories ile TEKRAR çalışıyordu (double boost bug).

        // 4. Birleştir: direkt sonuçlar önce, komşular sonra
        const combined = [...directResults, ...neighborMemories].slice(0, limit);

        // 5. Ebbinghaus Reinforcement — context'e giren bellekler için TaskQueue'ya ertele
        this._enqueueEbbinghausToWorker(combined.map(m => m.id));

        // 6. Archival Fallback — aktif sonuç kalitesi düşükse arşive bak
        let archivalResults: MemoryRow[] = [];
        if (directResults.length < QUALITY_MIN_RESULTS) {
            archivalResults = await this.archivalSearch(query, ARCHIVAL_LIMIT);
            if (archivalResults.length > 0) {
                this.dearchiveMemories(archivalResults);
            }
        }

        this.recordRetrievalDebug('graphAwareSearch', {
            query,
            limit,
            maxDepth,
            directCount: directResults.length,
            neighborCount: neighborMemories.length,
            archivalCount: archivalResults.length,
            expandedFromIds: [...expandedMemoryIds],
            activeIds: combined.map(item => item.id),
            archivalIds: archivalResults.map(item => item.id),
        });

        return { active: combined, archival: archivalResults };
    }

    // ========== Archival Memory Search ==========

    /**
     * Arşivlenen belleklerde FTS tam metin araması (iç kullanım).
     */
    private _searchMemoriesRawArchival(query: string, limit: number = 5): MemoryRow[] {
        const ftsQuery = escapeFtsQuery(query);
        if (!ftsQuery) return [];

        return this.db.prepare(`
            SELECT m.* FROM memories m
            JOIN memories_fts fts ON m.id = fts.rowid
            WHERE memories_fts MATCH ? AND m.is_archived = 1
            ORDER BY bm25(memories_fts)
            LIMIT ?
        `).all(ftsQuery, limit) as MemoryRow[];
    }

    /**
     * Arşivlenen belleklerde semantik benzerlik araması.
     */
    private async semanticSearchArchival(query: string, limit: number = 5): Promise<(MemoryRow & { similarity: number })[]> {
        if (!this.embeddingProvider) return [];

        try {
            const [queryEmbedding] = await this.embeddingProvider.embed([query]);
            const queryArrayBuffer = Buffer.from(new Float32Array(queryEmbedding).buffer);

            return this.db.prepare(`
                WITH matched AS (
                    SELECT rowid, vec_distance_cosine(embedding, ?) as distance
                    FROM memory_embeddings
                    WHERE embedding MATCH ? AND k = 50
                )
                SELECT
                    m.*,
                    (1 - w.distance) as similarity
                FROM matched w
                JOIN memories m ON m.id = w.rowid
                WHERE m.is_archived = 1 
                  AND w.distance <= 0.4
                ORDER BY w.distance ASC
                LIMIT ?
            `).all(queryArrayBuffer, queryArrayBuffer, limit) as (MemoryRow & { similarity: number })[];
        } catch (err) {
            logger.warn({ err: err }, '[Memory] Archival semantik arama hatası:');
            return [];
        }
    }

    /**
     * Arşivlenen belleklerde hibrit arama — FTS + Semantik + RRF.
     * Aktif hybridSearch ile aynı mantık, is_archived = 1 filtresi ile.
     */
    private async archivalSearch(query: string, limit: number = 5): Promise<MemoryRow[]> {
        const ftsResults = this._searchMemoriesRawArchival(query, limit);
        const semanticResults = await this.semanticSearchArchival(query, limit);

        if (semanticResults.length === 0) return ftsResults;
        if (ftsResults.length === 0) return semanticResults;

        // OPT F-02: Jenerik RRF fusion
        return rrfFusion(
            ftsResults, semanticResults,
            (m) => m.id, (m) => m, limit,
        ).results;
    }

    /**
     * Arşivden geri getirme (De-archive) + Re-learning mekanizması.
     * importance = 1 (en düşük), stability = 2.0 (kırılgan), graph ilişkileri yeniden oluşturulur.
     * max_importance korunur — importance artışı bununla cap'lenir.
     */
    private dearchiveMemories(memories: MemoryRow[]): void {
        const RE_LEARN_STABILITY = 2.0;
        const RE_LEARN_IMPORTANCE = 1;
        const nextReview = computeNextReview(RE_LEARN_STABILITY);

        const dearchiveStmt = this.db.prepare(`
            UPDATE memories
            SET is_archived = 0,
                importance = ?,
                stability = ?,
                retrievability = 1.0,
                next_review_at = ?,
                review_count = 0,
                last_accessed = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);

        const runDearchive = this.db.transaction(() => {
            for (const mem of memories) {
                dearchiveStmt.run(RE_LEARN_IMPORTANCE, RE_LEARN_STABILITY, nextReview, mem.id);
            }
        });

        runDearchive();

        // Graph ilişkilerini yeniden oluştur (eski ilişkiler decay ile silinmiş olabilir)
        for (const mem of memories) {
            this.graph.autoCreateProximityRelations(mem.id);
        }

        logger.info(`[Memory] 📦 ${memories.length} bellek arşivden geri getirildi (importance=${RE_LEARN_IMPORTANCE}, stability=${RE_LEARN_STABILITY})`);
    }

    getRetrievalDebugSnapshot(flow: 'hybridSearch' | 'hybridSearchMessages' | 'graphAwareSearch' | 'promptContextBundle'): unknown {
        return this.lastRetrievalDebug.get(flow) ?? null;
    }

    getLastMemoryWriteDebugSnapshot(): unknown {
        return this.lastMemoryWriteDebug;
    }

    private recordRetrievalDebug(flow: 'hybridSearch' | 'hybridSearchMessages' | 'graphAwareSearch' | 'promptContextBundle', payload: unknown): void {
        this.lastRetrievalDebug.set(flow, {
            capturedAt: new Date().toISOString(),
            ...((payload && typeof payload === 'object') ? payload as Record<string, unknown> : { payload }),
        });
        logger.debug({ flow, payload: this.lastRetrievalDebug.get(flow) }, '[Memory] Retrieval debug snapshot updated');
    }

    private recordMemoryWriteDebug(payload: unknown): void {
        this.lastMemoryWriteDebug = {
            capturedAt: new Date().toISOString(),
            ...((payload && typeof payload === 'object') ? payload as Record<string, unknown> : { payload }),
        };
        logger.debug({ payload: this.lastMemoryWriteDebug }, '[Memory] Memory write debug snapshot updated');
    }

    private prioritizeConversationMemories(
        memories: MemoryRow[],
        recentMessages: Array<{ role: string; content: string; created_at: string; conversation_title: string }>,
        activeConversationId: string,
        limit: number,
    ): MemoryRow[] {
        return selectConversationAwareSupplementalMemories({
            query: recentMessages.slice(-1)[0]?.content ?? '',
            activeConversationId,
            recentMessages,
            relevantMemories: [],
            fallbackMemories: memories,
            limit,
        });
    }

    private async resolveMergedContent(
        existingContent: string,
        incomingContent: string,
        mergeFn: ((oldContent: string, newContent: string) => Promise<string>) | undefined,
        preferredContent: 'existing' | 'incoming' | 'longer',
        logLabel: string,
    ): Promise<string> {
        if (mergeFn) {
            try {
                return await mergeFn(existingContent, incomingContent);
            } catch (err) {
                logger.warn({ err: err }, `${logLabel} failed, falling back to preference.`);
            }
        }

        if (preferredContent === 'existing') return existingContent;
        if (preferredContent === 'incoming') return incomingContent;
        return incomingContent.length >= existingContent.length ? incomingContent : existingContent;
    }

    /** İlişki decay (graph.ts'e delege). */
    decayRelationships() {
        return this.graph.decayRelationships();
    }

    /** İlişkisiz belleklere proximity ilişki backfill (graph.ts'e delege). */
    async ensureAllMemoryGraphRelations() {
        return this.graph.ensureAllMemoryGraphRelations();
    }

    // ========== Ayarlar (Key-Value Settings) ==========

    /**
     * Bir ayar değerini okur.
     */
    getSetting(key: string): string | null {
        const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
        return row ? row.value : null;
    }

    /**
     * Bir ayar değerini yazar (upsert).
     */
    setSetting(key: string, value: string): void {
        this.db.prepare(`
            INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
        `).run(key, value);
    }

    /**
     * Bir ayarı siler.
     */
    deleteSetting(key: string): boolean {
        const result = this.db.prepare(`DELETE FROM settings WHERE key = ?`).run(key);
        return result.changes > 0;
    }

    /**
     * Hassas dizin listesini döndürür.
     * DB'de kayıt yoksa config'teki varsayılan listeyi kullanır.
     */
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

    /**
     * Hassas dizin listesini kaydeder.
     */
    setSensitivePaths(paths: string[]): void {
        this.setSetting('sensitive_paths', JSON.stringify(paths));
    }
}
