/**
 * MemoryStore - Bellek saklama ve silme işlemleri.
 * 
 * Sorumluluklar:
 * - Bellek kaydı ekleme (semantik dedup ile)
 * - Bellek silme ve güncelleme
 * - Ebbinghaus decay mekanizması
 * - Ayarlar (key-value settings)
 */

import crypto from 'crypto';
import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';
import { TaskPriority } from '../../autonomous/queue.js';
import { daysSince } from '../../utils/datetime.js';
import {
  computeRetention,
  computeNextReview,
} from '../ebbinghaus.js';
import {
  computeInitialReviewSchedule,
  deriveMemoryWriteMetadata,
} from '../contextUtils.js';
import {
  escapeFtsQuery,
  inferMemoryType,
  DEFAULT_USER_ID,
  type MemoryRow,
  type BehaviorDiscoveryTrace,
  type MemoryWriteMetadata,
  type ReconsolidationDecision,
} from '../types.js';
import { decideMemoryMerge, decideReconsolidationPilot, normalizeMemoryWriteInput } from '../shortTermPhase.js';
import type { EmbeddingProvider } from '../embeddings.js';
import type { TaskQueue } from '../../autonomous/queue.js';
import type { AddMemoryResult, DecayResult, MemoryStats, GraphManagerInterface } from './types.js';
import { ProvenanceTracker } from '../wiki/provenance.js';
import { getConfig } from '../../gateway/config.js';
import type { ContradictionCandidate } from '../wiki/types.js';

export class MemoryStore {
  private memoryLocks: Map<string, Promise<void>> = new Map();
  private lastMemoryWriteDebug: unknown = null;

  constructor(
    private db: Database.Database,
    private embeddingProvider: EmbeddingProvider | null,
    private taskQueue: TaskQueue | null,
    private graphManager: GraphManagerInterface
  ) {}

  /**
   * TaskQueue referansını ayarlar.
   */
  setTaskQueue(queue: TaskQueue): void {
    this.taskQueue = queue;
    logger.info('[Memory] ⚙️ TaskQueue bağlandı — Ebbinghaus güncellemeleri arka plana yönlendirilecek.');
  }

  private getMemoryLockScope(category: string): string {
    const normalized = category.trim().toLowerCase();
    if (normalized === 'preference' || normalized === 'general' || normalized === 'user_fact' || normalized === 'profile') {
      return 'durable_profile';
    }
    return `category:${normalized || 'general'}`;
  }

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
    metadata?: MemoryWriteMetadata
  ): Promise<AddMemoryResult> {
    const normalized = normalizeMemoryWriteInput(content, category, importance);
    if (!normalized.accepted) {
      logger.info({ reasons: normalized.reasons }, '[Memory] Admission policy memory write reddedildi');
      return { id: -1, isUpdate: false };
    }

    const resolvedMetadata = deriveMemoryWriteMetadata(normalized.category, metadata);
    const inferredMemoryType = inferMemoryType(normalized.content, normalized.category, {
      source: resolvedMetadata.source,
      conversationId: resolvedMetadata.conversationId,
      memoryType: metadata?.memoryType,
    });

    const scopeLockKey = this.getMemoryLockScope(normalized.category);

    let releaseLock: () => void;
    const lockAcquired = new Promise<void>(resolve => { releaseLock = resolve; });
    const previousLock = this.memoryLocks.get(scopeLockKey) || Promise.resolve();
    this.memoryLocks.set(scopeLockKey, lockAcquired);
    await previousLock;

    try {
      return await this._addMemoryInternal(
        normalized.content,
        normalized.category,
        normalized.importance,
        inferredMemoryType.memoryType,
        mergeFn,
        resolvedMetadata
      );
    } finally {
      releaseLock!();
      if (this.memoryLocks.get(scopeLockKey) === lockAcquired) {
        this.memoryLocks.delete(scopeLockKey);
      }
    }
  }

  private async _addMemoryInternal(
    content: string,
    category: string,
    importance: number,
    memoryType: 'episodic' | 'semantic',
    mergeFn?: (oldContent: string, newContent: string) => Promise<string>,
    metadata?: ReturnType<typeof deriveMemoryWriteMetadata>
  ): Promise<AddMemoryResult> {
    const rolloutState = metadata?.rolloutState ?? 'commit';
    const writeTraceId = metadata?.writeTraceId ?? crypto.randomUUID();
    const writeBehaviorDiscoveryTrace: BehaviorDiscoveryTrace = {
      enabled: rolloutState !== 'disabled',
      domain: 'write',
      state: rolloutState === 'disabled' ? 'disabled' : rolloutState === 'shadow' ? 'shadow' : 'observe',
      liveEffectAllowed: false,
      observedSignals: [`write_rollout:${rolloutState}`, `memory_type:${memoryType}`, `category:${category}`],
      candidates: [],
      shadowComparison: null,
      guardrails: ['behavior_discovery:write_telemetry_only', 'behavior_discovery:no_destructive_live_effect', 'behavior_discovery:default_write_path_preserved'],
    };
    const writeContextBase = {
      category, memoryType, confidence: metadata?.confidence ?? null, source: metadata?.source ?? null,
      conversationId: metadata?.conversationId ?? null, messageId: metadata?.messageId ?? null,
      reviewProfile: metadata?.reviewProfile ?? null, reconsolidationHint: 'write_merge' as const,
      rolloutState, writeTraceId, behaviorDiscovery: writeBehaviorDiscoveryTrace,
    };

    // 1. Semantik dedup
    if (this.embeddingProvider) {
      try {
        const [newEmbedding] = await this.embeddingProvider.embed([content]);
        const queryArrayBuffer = Buffer.from(new Float32Array(newEmbedding ?? []).buffer);

        const bestMatch = this.db.prepare(`
          SELECT m.id, m.content, (1 - vec_distance_cosine(e.embedding, ?)) as similarity
          FROM memory_embeddings e
          JOIN memories m ON m.id = e.rowid
          WHERE m.is_archived = 0
          ORDER BY vec_distance_cosine(e.embedding, ?) ASC
          LIMIT 1
        `).get(queryArrayBuffer, queryArrayBuffer) as { id: number; content: string; similarity: number } | undefined;

        if (bestMatch && bestMatch.similarity >= 0.80) {
          const mergeDecision = decideMemoryMerge({
            category, existingContent: bestMatch.content, incomingContent: content, semanticSimilarity: bestMatch.similarity,
          });
          const reconsolidation = decideReconsolidationPilot({
            memoryType, category, existingContent: bestMatch.content, incomingContent: content,
            confidence: metadata?.confidence,
 semanticSimilarity: bestMatch.similarity,
          });

          this.recordMemoryWriteDebug({
            phase: 'semantic_dedup', candidateId: bestMatch.id, similarity: bestMatch.similarity,
            mergeDecision, reconsolidation,
            proposal: {
              mode: reconsolidation.proposalMode, candidateContentPreview: reconsolidation.candidateContent?.slice(0, 160) ?? null,
              commitEligible: reconsolidation.commitEligible, shadowEligible: reconsolidation.shadowEligible,
            },
            ...writeContextBase,
          });

          if (reconsolidation.action === 'insert_new') {
            logger.debug({ memoryId: bestMatch.id, reason: reconsolidation.reason }, '[Memory] Semantik dedup: yeni kayıt olarak devam ediliyor');
          } else if (mergeDecision.shouldMerge) {
            if (reconsolidation.action === 'update' || reconsolidation.action === 'append') {
              const betterContent = reconsolidation.candidateContent
                ?? await this.resolveMergedContent(bestMatch.content, content, mergeFn, mergeDecision.preferredContent, '[Memory] Semantic dedup merge');

              if (getConfig().enableProvenanceTracking) {
                const tracker = new ProvenanceTracker({ db: this.db });
                tracker.storeRevision(bestMatch.id, { content: bestMatch.content, category, importance });
              }

              this.db.prepare(`
                UPDATE memories
                SET content = ?, importance = MAX(importance, ?),
                  max_importance = MAX(COALESCE(max_importance, importance), ?),
                  access_count = access_count + 1, last_accessed = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
                  confidence = MAX(COALESCE(confidence, 0.0), ?), provenance_source = COALESCE(provenance_source, ?),
                  provenance_conversation_id = COALESCE(provenance_conversation_id, ?), provenance_message_id = COALESCE(provenance_message_id, ?),
                  review_profile = COALESCE(review_profile, ?), memory_type = COALESCE(memory_type, ?)
                WHERE id = ?
              `).run(
                betterContent, importance, importance, metadata?.confidence ?? 0.7, metadata?.source ?? null,
                metadata?.conversationId ?? null, metadata?.messageId ?? null, metadata?.reviewProfile ?? 'standard',
                memoryType, bestMatch.id,
              );

              // İçerik değiştiyse embedding'i yeniden hesapla (gereksiz API çağrısını önle)
              if (betterContent !== bestMatch.content) {
                await this.computeAndStoreEmbedding(bestMatch.id, betterContent);
              }
              logger.info(`[Memory] 🔗 Semantik dedup: "${content.substring(0, 40)}..." → mevcut #${bestMatch.id}`);
              this.graphManager.autoCreateProximityRelations(bestMatch.id);
              return { id: bestMatch.id, isUpdate: true };
            } else {
              this.db.prepare(`
                UPDATE memories
                SET importance = MAX(importance, ?), max_importance = MAX(COALESCE(max_importance, importance), ?),
                  access_count = access_count + 1, last_accessed = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
                  confidence = MAX(COALESCE(confidence, 0.0), ?), review_profile = COALESCE(review_profile, ?),
                  memory_type = COALESCE(memory_type, ?)
                WHERE id = ?
              `).run(importance, importance, metadata?.confidence ?? 0.7, metadata?.reviewProfile ?? 'standard', memoryType, bestMatch.id);
              return { id: bestMatch.id, isUpdate: false };
            }
          }
        }
      } catch (err) {
        logger.warn({ err: err }, '[Memory] Semantik dedup başarısız, FTS fallback:');
      }
    }

    // 2. FTS fallback dedup — daha fazla kelime kullanarak daha iyi eşleşme
    const contentWords = content.split(/\s+/).slice(0, 50).join(' ');
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
          const tokenize = (t: string) => new Set(t.toLowerCase().split(/\s+/).filter(w => w.length > 2));
          const setA = tokenize(content);
          const setB = tokenize(existing.content);
          const intersectionCount = [...setA].filter(x => setB.has(x)).length;
          const unionSize = setA.size + setB.size - intersectionCount;
          const jaccardSim = unionSize > 0 ? intersectionCount / unionSize : 0;
          const containmentRatio = setA.size > 0 ? intersectionCount / setA.size : 0;

          if (jaccardSim >= 0.5 || containmentRatio >= 0.8) {
            const mergeDecision = decideMemoryMerge({
              category, existingContent: existing.content, incomingContent: content, jaccardSimilarity: jaccardSim, containmentRatio,
            });
            const reconsolidation = decideReconsolidationPilot({
              memoryType, category, existingContent: existing.content, incomingContent: content,
              confidence: metadata?.confidence,
 jaccardSimilarity: jaccardSim, containmentRatio,
            });

            if (reconsolidation.action !== 'insert_new' && mergeDecision.shouldMerge) {
              if (reconsolidation.action === 'update' || reconsolidation.action === 'append') {
                const betterContent = reconsolidation.candidateContent
                  ?? await this.resolveMergedContent(existing.content, content, mergeFn, mergeDecision.preferredContent, '[Memory] FTS dedup merge');

                if (getConfig().enableProvenanceTracking) {
                  const tracker = new ProvenanceTracker({ db: this.db });
                  tracker.storeRevision(existing.id, { content: existing.content, category, importance });
                }

                this.db.prepare(`
                  UPDATE memories
                  SET content = ?, importance = MAX(importance, ?), updated_at = CURRENT_TIMESTAMP
                  WHERE id = ?
                `).run(betterContent, importance, existing.id);

                await this.computeAndStoreEmbedding(existing.id, betterContent);
                return { id: existing.id, isUpdate: true };
              } else {
                return { id: existing.id, isUpdate: false };
              }
            }
          }
        }
      } catch (err) {
        logger.warn({ err: err }, '[Memory] FTS dedup sorgusu başarısız:');
      }
    }

    // 3. Yeni kayıt
    const reviewSchedule = computeInitialReviewSchedule(importance, category, metadata?.reviewProfile);
    const result = this.db.prepare(`
      INSERT INTO memories (
        user_id, content, category, importance, max_importance, last_accessed,
        stability, retrievability, next_review_at, review_count,
        provenance_source, provenance_conversation_id, provenance_message_id,
        confidence, review_profile, memory_type
      )
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 1.0, ?, 0, ?, ?, ?, ?, ?, ?)
    `).run(
      DEFAULT_USER_ID, content, category, importance, importance,
      reviewSchedule.initialStability, computeNextReview(reviewSchedule.initialStability),
      metadata?.source ?? null, metadata?.conversationId ?? null, metadata?.messageId ?? null,
      metadata?.confidence ?? 0.7, reviewSchedule.profile, memoryType
    );

    const newId = Number(result.lastInsertRowid);
    await this.computeAndStoreEmbedding(newId, content);
    this.graphManager.autoCreateProximityRelations(newId);

    return { id: newId, isUpdate: false };
  }

  /**
   * Bellek kaydını siler.
   */
  deleteMemory(memoryId: number): boolean {
    const result = this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(memoryId);
    if (result.changes > 0) {
      try {
        this.db.prepare(`DELETE FROM memory_embeddings WHERE rowid = CAST(? AS INTEGER)`).run(BigInt(memoryId));
      } catch (err) {
        logger.warn({ err: err }, `[Memory] Embedding silme başarısız (id=${memoryId}):`);
      }
      this.graphManager.cleanupMemoryGraph(memoryId);
    }
    return result.changes > 0;
  }

  /**
   * Bellek kaydını günceller. Güncelleme öncesi provenance snapshot kaydeder.
   */
  async editMemory(memoryId: number, content: string, category?: string, importance?: number): Promise<boolean> {
    try {
      const oldMemory = this.db.prepare(
        `SELECT content, category, importance FROM memories WHERE id = ?`
      ).get(memoryId) as { content: string; category: string; importance: number } | undefined;
      if (!oldMemory) return false;

      const finalCategory = category ?? oldMemory.category;
      const finalImportance = importance ?? oldMemory.importance;

      if (getConfig().enableProvenanceTracking) {
        const tracker = new ProvenanceTracker({ db: this.db });
        tracker.storeRevision(memoryId, { content: oldMemory.content, category: oldMemory.category, importance: oldMemory.importance });
      }

      const result = this.db.prepare(`
        UPDATE memories
        SET content = ?, category = ?, importance = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(content, finalCategory, finalImportance, memoryId);

      if (result.changes > 0) {
        if (oldMemory.content !== content) {
          await this.computeAndStoreEmbedding(memoryId, content);
        }
        return true;
      }
      return false;
    } catch (err) {
      logger.error({ err: err }, `[Memory] Bellek güncellenemedi (id=${memoryId}):`);
      return false;
    }
  }

  getOpenContradictions(): ContradictionCandidate[] {
    const rows = this.db.prepare(
      `SELECT id, memory_a_id, memory_b_id, detection_type, status, confidence, description, detected_at, resolved_at, resolution_notes
       FROM memory_contradictions WHERE status = 'open' ORDER BY confidence DESC`
    ).all() as any[];
    return rows.map(r => ({
      id: r.id, memoryAId: r.memory_a_id, memoryBId: r.memory_b_id, detectionType: r.detection_type,
      status: r.status, confidence: r.confidence, description: r.description,
      detectedAt: r.detected_at, resolvedAt: r.resolved_at, resolutionNotes: r.resolution_notes ?? '',
    }));
  }

  resolveContradiction(id: number, resolutionNotes: string): boolean {
    const result = this.db.prepare(
      `UPDATE memory_contradictions SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, resolution_notes = ? WHERE id = ?`
    ).run(resolutionNotes, id);
    return result.changes > 0;
  }

  markFalsePositive(id: number): boolean {
    const result = this.db.prepare(`UPDATE memory_contradictions SET status = 'false_positive', resolved_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  private static readonly DECAY_BATCH_SIZE = 500;

  decayMemories(): DecayResult {
    const activeMemories = this.db.prepare(`
      SELECT id, importance, stability, COALESCE(last_accessed, created_at) as last_accessed
      FROM memories WHERE is_archived = 0
    `).all() as Array<{ id: number; importance: number; stability: number | null; last_accessed: string }>;

    let decayed = 0;
    let archived = 0;
    const nowMs = Date.now();

    const toArchive: Array<{ id: number; R: number }> = [];
    const toDecay: Array<{ id: number; R: number }> = [];
    const toUpdateRetrievability: Array<{ id: number; R: number }> = [];

    for (const mem of activeMemories) {
      const stability = mem.stability ?? (mem.importance * 2.0);
      const R = computeRetention(stability, daysSince(mem.last_accessed, nowMs));
      if (R < 0.1) {
        toArchive.push({ id: mem.id, R });
        archived++;
      } else if (R < 0.5) {
        toDecay.push({ id: mem.id, R });
        decayed++;
      } else {
        toUpdateRetrievability.push({ id: mem.id, R });
      }
    }

    this.db.transaction(() => {
      this.batchDecayUpdates(toArchive, 'archive');
      this.batchDecayUpdates(toDecay, 'decay');
      this.batchDecayUpdates(toUpdateRetrievability, 'retrievability');
    })();

    return { decayed, archived };
  }

  private batchDecayUpdates(
    items: Array<{ id: number; R: number }>,
    mode: 'archive' | 'decay' | 'retrievability',
  ): void {
    if (items.length === 0) return;

    const chunkSize = MemoryStore.DECAY_BATCH_SIZE;
    for (let offset = 0; offset < items.length; offset += chunkSize) {
      const chunk = items.slice(offset, offset + chunkSize);
      const caseClauses = chunk.map(() => 'WHEN ? THEN ?').join(' ');
      const ids = chunk.map(item => item.id);
      const caseParams = chunk.flatMap(item => [item.id, item.R]);
      const idPlaceholders = ids.map(() => '?').join(',');

      if (mode === 'archive') {
        this.db.prepare(`
          UPDATE memories
          SET is_archived = 1,
              retrievability = CASE id ${caseClauses} END,
              updated_at = CURRENT_TIMESTAMP
          WHERE id IN (${idPlaceholders})
        `).run(...caseParams, ...ids);
      } else if (mode === 'decay') {
        this.db.prepare(`
          UPDATE memories
          SET importance = MAX(1, importance - 1),
              retrievability = CASE id ${caseClauses} END,
              updated_at = CURRENT_TIMESTAMP
          WHERE id IN (${idPlaceholders})
        `).run(...caseParams, ...ids);
      } else {
        this.db.prepare(`
          UPDATE memories
          SET retrievability = CASE id ${caseClauses} END,
              updated_at = CURRENT_TIMESTAMP
          WHERE id IN (${idPlaceholders})
        `).run(...caseParams, ...ids);
      }
    }
  }

  executeEbbinghausUpdates(memoryIds: number[]): void {
    const uniqueIds = [...new Set(memoryIds)];
    if (uniqueIds.length === 0) return;
    this.db.transaction(() => {
      const rows = this.db.prepare(`SELECT * FROM memories WHERE id IN (${uniqueIds.map(() => '?').join(',')}) AND is_archived = 0`).all(...uniqueIds) as MemoryRow[];
      for (const row of rows) {
        this.graphManager.updateStabilityOnAccess(row);
      }
    })();
  }

  enqueueEbbinghausToWorker(memoryIds: number[]): void {
    if (!this.taskQueue || memoryIds.length === 0) return;
    this.taskQueue.enqueue({
      id: `ebbinghaus_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      type: 'ebbinghaus_update', priority: TaskPriority.P4_LOW, payload: { memoryIds }, addedAt: Date.now(),
    });
  }

  getStats(): MemoryStats {
    const row = this.db.prepare(`SELECT (SELECT COUNT(*) FROM conversations) as conversations, (SELECT COUNT(*) FROM messages) as messages, (SELECT COUNT(*) FROM memories WHERE is_archived = 0) as memories`).get() as any;
    return row;
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as any;
    return row ? row.value : null;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`).run(key, value);
  }

  deleteSetting(key: string): boolean {
    const result = this.db.prepare(`DELETE FROM settings WHERE key = ?`).run(key);
    return result.changes > 0;
  }

  private async computeAndStoreEmbedding(memoryId: number, content: string): Promise<void> {
    if (!this.embeddingProvider) return;
    try {
      const [embedding] = await this.embeddingProvider.embed([content]);
      // Boş veya geçersiz embedding kontrolü — sqlite-vec boyut uyumsuzluğu hatasını önler
      if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
        logger.debug(`[Memory] Boş embedding döndü (id=${memoryId}), kaydedilmedi.`);
        return;
      }
      const buf = Buffer.from(new Float32Array(embedding).buffer);
      this.db.transaction(() => {
        this.db.prepare(`DELETE FROM memory_embeddings WHERE rowid = CAST(? AS INTEGER)`).run(BigInt(memoryId));
        this.db.prepare(`INSERT INTO memory_embeddings (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)`).run(BigInt(memoryId), buf);
      })();
    } catch (err) {
      logger.warn({ err: err }, `[Memory] Embedding kayıt hatası (id=${memoryId}):`);
    }
  }

  getLastMemoryWriteDebugSnapshot(): unknown { return this.lastMemoryWriteDebug; }

  private recordMemoryWriteDebug(payload: unknown): void {
    this.lastMemoryWriteDebug = { capturedAt: new Date().toISOString(), ...((payload && typeof payload === 'object') ? payload as any : { payload }) };
  }

  private async resolveMergedContent(existingContent: string, incomingContent: string, mergeFn: any, preferredContent: string, logLabel: string): Promise<string> {
    if (mergeFn) {
      try {
        return await mergeFn(existingContent, incomingContent);
      } catch (err) {
        logger.warn({ err, logLabel }, '[Memory] Merge function failed, using fallback content');
      }
    }
    if (preferredContent === 'existing') return existingContent;
    if (preferredContent === 'incoming') return incomingContent;
    return incomingContent.length >= existingContent.length ? incomingContent : existingContent;
  }
}
