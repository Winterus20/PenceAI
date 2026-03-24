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
import type { AddMemoryResult, DecayResult, MemoryStats } from './types.js';

export class MemoryStore {
  private memoryLocks: Map<string, Promise<void>> = new Map();
  private lastMemoryWriteDebug: unknown = null;

  constructor(
    private db: Database.Database,
    private embeddingProvider: EmbeddingProvider | null,
    private taskQueue: TaskQueue | null,
    private graphManager: {
      autoCreateProximityRelations: (memoryId: number) => void;
      updateStabilityOnAccess: (memory: MemoryRow) => void;
      cleanupMemoryGraph: (memoryId: number) => void;
    }
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
      memoryType: inferredMemoryType.memoryType,
    }, '[Memory] addMemory lock acquired');

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
    metadata?: ReturnType<typeof deriveMemoryWriteMetadata>
  ): Promise<AddMemoryResult> {
    const rolloutState = metadata?.rolloutState ?? 'commit';
    const writeTraceId = metadata?.writeTraceId ?? crypto.randomUUID();
    const writeBehaviorDiscoveryTrace: BehaviorDiscoveryTrace = {
      enabled: rolloutState !== 'disabled',
      domain: 'write',
      state: rolloutState === 'disabled' ? 'disabled' : rolloutState === 'shadow' ? 'shadow' : 'observe',
      liveEffectAllowed: false,
      observedSignals: [
        `write_rollout:${rolloutState}`,
        `memory_type:${memoryType}`,
        `category:${category}`,
      ],
      candidates: [],
      shadowComparison: null,
      guardrails: [
        'behavior_discovery:write_telemetry_only',
        'behavior_discovery:no_destructive_live_effect',
        'behavior_discovery:default_write_path_preserved',
      ],
    };
    const writeContextBase = {
      category,
      memoryType,
      confidence: metadata?.confidence ?? null,
      source: metadata?.source ?? null,
      conversationId: metadata?.conversationId ?? null,
      messageId: metadata?.messageId ?? null,
      reviewProfile: metadata?.reviewProfile ?? null,
      reconsolidationHint: 'write_merge' as const,
      rolloutState,
      writeTraceId,
      behaviorDiscovery: writeBehaviorDiscoveryTrace,
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
            proposal: {
              mode: reconsolidation.proposalMode,
              candidateContentPreview: reconsolidation.candidateContent?.slice(0, 160) ?? null,
              commitEligible: reconsolidation.commitEligible,
              shadowEligible: reconsolidation.shadowEligible,
            },
            ...writeContextBase,
          });

          if (mergeDecision.shouldMerge) {
            if (reconsolidation.action === 'update' || reconsolidation.action === 'append') {
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
                logger.warn({ err: err }, `[Memory] Semantik dedup embedding güncelleme başarısız (id=${bestMatch!.id}):`);
              });

              logger.info(`[Memory] 🔗 Semantik dedup + reconsolidation: "${content.substring(0, 40)}..." → mevcut #${bestMatch.id} (sim=${bestMatch.similarity.toFixed(2)}, reason=${mergeDecision.reason}, action=${reconsolidation.action})`);
              this.graphManager.autoCreateProximityRelations(bestMatch.id);
              return { id: bestMatch.id, isUpdate: true };
            } else {
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
              this.recordMemoryWriteDebug({
                phase: 'semantic_dedup_skip_update',
                candidateId: bestMatch.id,
                similarity: bestMatch.similarity,
                mergeDecision,
                reconsolidation,
                committed: false,
                outcome: 'touch_existing_memory',
                storedMemoryId: bestMatch.id,
                ...writeContextBase,
              });
              logger.info(`[Memory] Semantik dedup atlandı ama metadata güncellendi: "${content.substring(0, 40)}..." → mevcut #${bestMatch.id} (reason=${reconsolidation.reason})`);
              return { id: bestMatch.id, isUpdate: false };
            }
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
              proposal: {
                mode: reconsolidation.proposalMode,
                candidateContentPreview: reconsolidation.candidateContent?.slice(0, 160) ?? null,
                commitEligible: reconsolidation.commitEligible,
                shadowEligible: reconsolidation.shadowEligible,
              },
              ...writeContextBase,
            });

            if (mergeDecision.shouldMerge) {
              if (reconsolidation.action === 'update' || reconsolidation.action === 'append') {
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
                  this.graphManager.autoCreateProximityRelations(existing.id);
                } catch (err) {
                  logger.warn({ err: err }, `[Memory] FTS dedup embedding güncelleme başarısız (id=${existing.id}):`);
                }

                logger.info(`[Memory] 🔗 FTS dedup + reconsolidation: "${content.substring(0, 40)}..." → mevcut #${existing.id} (jaccard=${jaccardSim.toFixed(2)}, reason=${mergeDecision.reason}, action=${reconsolidation.action})`);
                return { id: existing.id, isUpdate: true };
              } else {
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
                this.recordMemoryWriteDebug({
                  phase: 'fts_dedup_skip_update',
                  candidateId: existing.id,
                  jaccardSimilarity: jaccardSim,
                  containmentRatio,
                  mergeDecision,
                  reconsolidation,
                  committed: false,
                  outcome: 'touch_existing_memory',
                  storedMemoryId: existing.id,
                  ...writeContextBase,
                });
                logger.info(`[Memory] FTS dedup atlandı ama metadata güncellendi: "${content.substring(0, 40)}..." → mevcut #${existing.id} (reason=${reconsolidation.reason})`);
                return { id: existing.id, isUpdate: false };
              }
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
        proposalMode: 'proposal_append',
        commitEligible: false,
        shadowEligible: true,
        guardrails: {
          confidenceFloor: 0.78,
          strictContainmentFloor: 0.92,
          structuredVarianceSimilarityFloor: 0.95,
          highSimilaritySemanticFloor: 0.93,
          highSimilarityJaccardFloor: 0.85,
          appendSemanticFloor: 0.86,
          appendJaccardFloor: 0.72,
          observedConfidence: metadata?.confidence ?? null,
          semanticSimilarity: 0,
          jaccardSimilarity: 0,
          containmentRatio: 0,
          structuredVariance: false,
          incomingAddsNewInformation: true,
        },
      } satisfies ReconsolidationDecision,
      proposal: {
        mode: 'proposal_append',
        candidateContentPreview: content.slice(0, 160),
        commitEligible: false,
        shadowEligible: true,
      },
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
      this.graphManager.autoCreateProximityRelations(newId);
    } catch (err) {
      logger.warn({ err: err }, `[Memory] Embedding hesaplama başarısız (id=${newId}):`);
    }

    this.recordMemoryWriteDebug({
      phase: 'insert_new_memory_committed',
      mergeCandidateFound: false,
      committed: true,
      outcome: 'insert_new_memory',
      storedMemoryId: newId,
      ...writeContextBase,
    });

    return { id: newId, isUpdate: false };
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
      this.graphManager.cleanupMemoryGraph(memoryId);
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
   * R < 0.1 → arşivle (hafıza büyük ölçüde unutulmuş)
   * 0.1 ≤ R < 0.5 → importance'ı 1 düşür (zayıflıyor)
   * retrievability sütunu güncellenir.
   */
  decayMemories(): DecayResult {
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

        // OPT F-07: daysSince yardımcısı ile tarih normalizasyonu
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
        this.graphManager.updateStabilityOnAccess(row);
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
   * Erişilen bellek ID'lerini TaskQueue'ın arka plan worker'ına gönderir.
   * Worker boşta olduğunda toplu UPDATE çalıştırır.
   * TaskQueue yoksa (test ortamı vb.) sessizce atlanır.
   */
  enqueueEbbinghausToWorker(memoryIds: number[]): void {
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
   * İstatistikleri döndürür. Her çağrıda DB'den güncel değerleri okur.
   */
  getStats(): MemoryStats {
    // OPT F-06: 3 ayrı COUNT sorgusu yerine tek sorgu
    const row = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM conversations) as conversations,
        (SELECT COUNT(*) FROM messages) as messages,
        (SELECT COUNT(*) FROM memories WHERE is_archived = 0) as memories
    `).get() as { conversations: number; messages: number; memories: number };
    return row;
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

  // ========== Embedding Hesaplama ==========

  private async computeAndStoreEmbedding(memoryId: number, content: string): Promise<void> {
    if (!this.embeddingProvider) return;

    try {
      const [embedding] = await this.embeddingProvider.embed([content]);
      const idBig = BigInt(memoryId);
      const buf = Buffer.from(new Float32Array(embedding).buffer);

      this.db.transaction(() => {
        this.db.prepare(`DELETE FROM memory_embeddings WHERE rowid = CAST(? AS INTEGER)`).run(idBig);
        this.db.prepare(`INSERT INTO memory_embeddings (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)`).run(idBig, buf);
      })();
    } catch (err) {
      logger.warn({ err: err }, `[Memory] Embedding kayıt hatası (memory_embeddings, id=${memoryId}):`);
    }
  }

  // ========== Debug ==========

  getLastMemoryWriteDebugSnapshot(): unknown {
    return this.lastMemoryWriteDebug;
  }

  private recordMemoryWriteDebug(payload: unknown): void {
    this.lastMemoryWriteDebug = {
      capturedAt: new Date().toISOString(),
      ...((payload && typeof payload === 'object') ? payload as Record<string, unknown> : { payload }),
    };
    logger.debug({ payload: this.lastMemoryWriteDebug }, '[Memory] Memory write debug snapshot updated');
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
}
