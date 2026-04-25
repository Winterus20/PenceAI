/**
 * Insight storage — DB CRUD işlemleri
 */

import type Database from 'better-sqlite3';
import type { Insight, InsightRow, DetectedPattern, InsightStatus } from './types.js';
import { computeConfidence, computeFrequency, computeRecency, computeConsistency, computeUserAffirmation, computeCrossSession, computeDynamicTTL } from './confidence.js';
import type { InsightEngineConfig } from './types.js';
import { DEFAULT_CONFIG } from './confidence.js';
import { logger } from '../../utils/logger.js';

export class InsightStorage {
  constructor(
    private db: Database.Database,
    private config: InsightEngineConfig = DEFAULT_CONFIG,
  ) { }

  private rowToInsight(row: InsightRow): Insight {
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type,
      description: row.description,
      confidence: row.confidence,
      hitCount: row.hit_count,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      sourceMemoryIds: JSON.parse(row.source_memory_ids || '[]'),
      sessionIds: JSON.parse(row.session_ids || '[]'),
      status: row.status,
      ttlDays: row.ttl_days,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Tüm aktif insight'ları getir.
   */
  getActiveInsights(userId: string = 'default'): Insight[] {
    const rows = this.db.prepare(`
      SELECT * FROM insights
      WHERE user_id = ? AND status = 'active'
      ORDER BY confidence DESC, updated_at DESC
    `).all(userId) as InsightRow[];
    return rows.map(r => this.rowToInsight(r));
  }

  /**
   * ID ile insight getir.
   */
  getInsightById(id: number): Insight | null {
    const row = this.db.prepare('SELECT * FROM insights WHERE id = ?').get(id) as InsightRow | undefined;
    return row ? this.rowToInsight(row) : null;
  }

  /**
   * Açıklamaya göre insight ara (benzer pattern var mı?).
   */
  findInsightByDescription(description: string, userId: string = 'default'): Insight | null {
    const row = this.db.prepare(`
      SELECT * FROM insights
      WHERE user_id = ? AND description = ? AND status = 'active'
      LIMIT 1
    `).get(userId, description) as InsightRow | undefined;
    return row ? this.rowToInsight(row) : null;
  }

  /**
   * Yeni insight ekle veya mevcut insight'ı güncelle.
   */
  upsertInsight(pattern: DetectedPattern, userId: string = 'default'): Insight {
    const existing = this.findInsightByDescription(pattern.description, userId);

    if (existing) {
      return this.updateInsightFromPattern(existing, pattern);
    }

    return this.insertInsight(pattern, userId);
  }

  private insertInsight(pattern: DetectedPattern, userId: string): Insight {
    const dim = this.buildConfidenceDimensions(pattern);
    const confidence = computeConfidence(dim, this.config);
    const ttlDays = computeDynamicTTL(confidence, this.config);

    const result = this.db.prepare(`
      INSERT INTO insights (user_id, type, description, confidence, hit_count, first_seen, last_seen, source_memory_ids, session_ids, status, ttl_days)
      VALUES (?, ?, ?, ?, ?, datetime(?, 'unixepoch'), datetime(?, 'unixepoch'), ?, ?, 'active', ?)
    `).run(
      userId,
      pattern.type,
      pattern.description,
      confidence,
      pattern.hitCount,
      Math.floor(pattern.firstSeen / 1000),
      Math.floor(pattern.lastSeen / 1000),
      JSON.stringify(pattern.sourceMemoryIds),
      JSON.stringify(pattern.sessionIds),
      ttlDays,
    );

    const id = Number(result.lastInsertRowid);
    logger.info(`[InsightEngine] Yeni insight oluşturuldu (id=${id}, conf=${confidence.toFixed(2)}, type=${pattern.type})`);

    return this.getInsightById(id)!;
  }

  private updateInsightFromPattern(existing: Insight, pattern: DetectedPattern): Insight {
    const newHitCount = existing.hitCount + pattern.hitCount;
    const newLastSeen = Math.max(new Date(existing.lastSeen).getTime(), pattern.lastSeen);
    const mergedSessionIds = [...new Set([...existing.sessionIds, ...pattern.sessionIds])];
    const mergedSourceMemoryIds = [...new Set([...existing.sourceMemoryIds, ...pattern.sourceMemoryIds])];

    const dim = this.buildConfidenceDimensions({
      ...pattern,
      hitCount: newHitCount,
      lastSeen: newLastSeen,
      sessionIds: mergedSessionIds,
    });
    const confidence = computeConfidence(dim, this.config);
    const ttlDays = computeDynamicTTL(confidence, this.config);

    this.db.prepare(`
      UPDATE insights
      SET confidence = ?, hit_count = ?, last_seen = datetime(?, 'unixepoch'), updated_at = CURRENT_TIMESTAMP, ttl_days = ?, session_ids = ?, source_memory_ids = ?
      WHERE id = ?
    `).run(confidence, newHitCount, Math.floor(newLastSeen / 1000), ttlDays, JSON.stringify(mergedSessionIds), JSON.stringify(mergedSourceMemoryIds), existing.id);

    logger.info(`[InsightEngine] Insight güncellendi (id=${existing.id}, conf=${confidence.toFixed(2)}, hits=${newHitCount})`);
    return this.getInsightById(existing.id)!;
  }

  /**
   * Insight durumunu güncelle (active/suppressed/pruned).
   */
  updateStatus(id: number, status: InsightStatus): boolean {
    const result = this.db.prepare(`
      UPDATE insights SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(status, id);
    return result.changes > 0;
  }

  /**
   * Insight açıklamasını düzenle (kullanıcı tarafından).
   */
  updateDescription(id: number, description: string): boolean {
    const result = this.db.prepare(`
      UPDATE insights SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(description, id);
    return result.changes > 0;
  }

  /**
   * Confidence bazlı auto-prune.
   * TTL aşılmış veya çok düşük confidence'lı insight'ları pruned yap.
   */
  pruneInsights(): { pruned: number; suppressed: number } {
    const now = Math.floor(Date.now() / 1000);

    // TTL aşılmış insight'ları prune et
    const ttlPruned = this.db.prepare(`
      UPDATE insights
      SET status = 'pruned', updated_at = CURRENT_TIMESTAMP
      WHERE status = 'active'
        AND datetime(first_seen, '+' || ttl_days || ' days') < datetime(?, 'unixepoch')
    `).run(now);

    // Çok düşük confidence'lı insight'ları suppress et
    const suppressed = this.db.prepare(`
      UPDATE insights
      SET status = 'suppressed', updated_at = CURRENT_TIMESTAMP
      WHERE status = 'active' AND confidence < ?
    `).run(this.config.thresholds.low);

    return {
      pruned: ttlPruned.changes,
      suppressed: suppressed.changes,
    };
  }

  /**
   * Kullanıcı feedback'ini insight'a bağla ve confidence'ı güncelle.
   */
  applyFeedback(insightId: number, isPositive: boolean): void {
    const insight = this.getInsightById(insightId);
    if (!insight) return;

    // Feedback'i approximation olarak kaydet — gerçek implementation'da ayrı bir feedback tablosu tutulabilir
    const delta = isPositive ? 0.1 : -0.15;
    const newConfidence = Math.max(0, Math.min(1, insight.confidence + delta));

    this.db.prepare(`
      UPDATE insights SET confidence = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(newConfidence, insightId);

    logger.info(`[InsightEngine] Feedback uygulandı (id=${insightId}, positive=${isPositive}, newConf=${newConfidence.toFixed(2)})`);
  }

  private buildConfidenceDimensions(pattern: DetectedPattern): {
    frequency: number;
    recency: number;
    consistency: number;
    userAffirmation: number;
    crossSession: number;
  } {
    return {
      frequency: computeFrequency(pattern.hitCount),
      recency: computeRecency(pattern.lastSeen),
      consistency: 1.0, // Pattern detection sırasında çelişki bilgisi yok
      userAffirmation: 0.5, // Başlangıç nötr
      crossSession: computeCrossSession(new Set(pattern.sessionIds).size),
    };
  }
}
