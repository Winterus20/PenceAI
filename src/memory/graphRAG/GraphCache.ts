/**
 * GraphCache — Graph traversal sonuçlarını cache'ler.
 * 
 * Tekrarlayan graph traversal'ları cache'leyerek performansı artırır.
 * TTL (Time-To-Live) mekanizması ile süresi dolmuş entry'leri temizler.
 */

import type Database from 'better-sqlite3';
import type { GraphCacheEntry, GraphExpansionOptions, GraphExpansionResult } from '../types.js';
import { logger } from '../../utils/logger.js';

/**
 * Değerlendirme Kapısı (Evaluation Gate) Sonucu
 */
export interface EvaluationGateResult {
  passed: boolean;
  checks: {
    emptyRetrieval: boolean;
    confidenceThreshold: boolean;
    nodeCountValid: boolean;
  };
  failedChecks: string[];
}

/**
 * Önbelleğe almadan önce (Before Promotion) GraphExpansionResult'ı değerlendirir.
 * RAGOps Deterministic RAG prensibi: Kalitesiz genişletmeleri önbelleğe alıp sistemi zehirleme.
 */
export function evaluateBeforePromote(
  result: GraphExpansionResult,
  isFullPhase: boolean = false
): EvaluationGateResult {
  let avgConfidence = 0;
  if (result.edges.length > 0) {
    avgConfidence = result.edges.reduce((sum, e) => sum + e.confidence, 0) / result.edges.length;
  }

  const checks = {
    emptyRetrieval: result.nodes.length > 0,
    confidenceThreshold: result.edges.length === 0 || avgConfidence >= 0.25,
    nodeCountValid: result.nodes.length >= (isFullPhase ? 3 : 1),
  };

  const failedChecks = Object.entries(checks)
    .filter(([_, passed]) => !passed)
    .map(([name]) => name);

  return {
    passed: failedChecks.length === 0,
    checks,
    failedChecks,
  };
}

/** Default TTL: 1 saat (FULL phase'te 2 saat) */
const DEFAULT_TTL_SECONDS = 3600;
const FULL_PHASE_TTL_SECONDS = 7200; // 2 saat

/**
 * Query hash oluştur (seed nodes + depth + options)
 * Deterministik hash: Aynı parametreler her zaman aynı hash'i üretir.
 */
export function computeQueryHash(options: GraphExpansionOptions): string {
  const sortedIds = [...options.seedNodeIds].sort((a, b) => a - b);
  const parts = [
    `nodes:${sortedIds.join(',')}`,
    `depth:${options.maxDepth}`,
    `maxNodes:${options.maxNodes}`,
    `minConf:${options.minConfidence}`,
    `relTypes:${(options.relationTypes || []).sort().join(',')}`,
  ];
  return parts.join('|');
}

export class GraphCache {
  constructor(private db: Database.Database) {}

  /**
   * Cache'den getir.
   * Süresi dolmuş entry'leri null döner.
   */
  get(queryHash: string, maxDepth: number): GraphCacheEntry | null {
    try {
      const row = this.db.prepare(`
        SELECT query_hash, max_depth, node_ids, relation_ids, score, created_at, expires_at
        FROM graph_traversal_cache
        WHERE query_hash = ? AND max_depth = ? AND expires_at > CURRENT_TIMESTAMP
      `).get(queryHash, maxDepth) as {
        query_hash: string;
        max_depth: number;
        node_ids: string;
        relation_ids: string;
        score: number | null;
        created_at: string;
        expires_at: string;
      } | undefined;

      if (!row) return null;

      return {
        queryHash: row.query_hash,
        maxDepth: row.max_depth,
        nodeIds: JSON.parse(row.node_ids) as number[],
        relationIds: JSON.parse(row.relation_ids) as number[],
        score: row.score ?? 0,
        createdAt: new Date(row.created_at),
        expiresAt: new Date(row.expires_at),
      };
    } catch (err) {
      logger.warn({ err }, '[GraphCache] Cache get hatası:');
      return null;
    }
  }

  /**
   * Cache'e kaydet.
   * Mevcut entry varsa günceller (UPSERT).
   */
  set(entry: GraphCacheEntry, ttlSeconds: number = DEFAULT_TTL_SECONDS, isFullPhase: boolean = false): void {
    const effectiveTtl = isFullPhase ? FULL_PHASE_TTL_SECONDS : ttlSeconds;
    try {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + effectiveTtl * 1000);
      const createdAtStr = now.toISOString().replace('T', ' ').substring(0, 19);
      const expiresAtStr = expiresAt.toISOString().replace('T', ' ').substring(0, 19);

      this.db.prepare(`
        INSERT INTO graph_traversal_cache (query_hash, max_depth, node_ids, relation_ids, score, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(query_hash, max_depth) DO UPDATE SET
          node_ids = excluded.node_ids,
          relation_ids = excluded.relation_ids,
          score = excluded.score,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at
      `).run(
        entry.queryHash,
        entry.maxDepth,
        JSON.stringify(entry.nodeIds),
        JSON.stringify(entry.relationIds),
        entry.score,
        createdAtStr,
        expiresAtStr,
      );
    } catch (err) {
      logger.warn({ err }, '[GraphCache] Cache set hatası:');
    }
  }

  /**
   * Cache'den sil (graph güncellendiğinde invalidation için).
   */
  invalidate(queryHash: string): number {
    try {
      const result = this.db.prepare(`
        DELETE FROM graph_traversal_cache WHERE query_hash = ?
      `).run(queryHash);
      return result.changes;
    } catch (err) {
      logger.warn({ err }, '[GraphCache] Cache invalidate hatası:');
      return 0;
    }
  }

  /**
   * Süresi dolmuş entry'leri temizler.
   * @returns Silinen entry sayısı
   */
  cleanup(): number {
    try {
      const result = this.db.prepare(`
        DELETE FROM graph_traversal_cache WHERE expires_at <= CURRENT_TIMESTAMP
      `).run();
      if (result.changes > 0) {
        logger.info(`[GraphCache] 🧹 ${result.changes} süresi dolmuş cache entry temizlendi`);
      }
      return result.changes;
    } catch (err) {
      logger.warn({ err }, '[GraphCache] Cache cleanup hatası:');
      return 0;
    }
  }

  /**
   * Tüm cache'i temizler (test veya reset için).
   */
  clearAll(): number {
    try {
      const result = this.db.prepare(`DELETE FROM graph_traversal_cache`).run();
      return result.changes;
    } catch (err) {
      logger.warn({ err }, '[GraphCache] Cache clear hatası:');
      return 0;
    }
  }

  /**
   * Cache istatistikleri (debug için).
   */
  getStats(): { total: number; expired: number; active: number } {
    try {
      const total = this.db.prepare(`SELECT COUNT(*) as count FROM graph_traversal_cache`).get() as { count: number };
      const expired = this.db.prepare(`SELECT COUNT(*) as count FROM graph_traversal_cache WHERE expires_at <= CURRENT_TIMESTAMP`).get() as { count: number };
      return {
        total: total.count,
        expired: expired.count,
        active: total.count - expired.count,
      };
    } catch {
      return { total: 0, expired: 0, active: 0 };
    }
  }
}
