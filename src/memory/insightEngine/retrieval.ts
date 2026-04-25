/**
 * Insight retrieval — sorguya göre dinamik insight seçimi
 */

import type Database from 'better-sqlite3';
import type { Insight, InsightQueryResult } from './types.js';
import { logger } from '../../utils/logger.js';

export class InsightRetrieval {
  constructor(private db: Database.Database) { }

  /**
   * Kullanıcı sorgusuna göre alakalı insight'ları döndür.
   * FTS + keyword matching ile çalışır.
   */
  async getRelevantInsights(query: string, minConfidence: number = 0.5, limit: number = 5): Promise<InsightQueryResult[]> {
    const keywords = this.extractKeywords(query);

    if (keywords.length === 0) {
      return [];
    }

    // FTS ile arama
    const ftsQuery = keywords.map(k => `"${k}"`).join(' OR ');
    const rows = this.db.prepare(`
      SELECT i.*
      FROM insights i
      WHERE i.status = 'active'
        AND i.confidence >= ?
        AND (
          i.id IN (SELECT rowid FROM insights_fts WHERE insights_fts MATCH ?)
          OR EXISTS (
            SELECT 1 FROM memories m
            JOIN memories_fts ON m.id = memories_fts.rowid
            WHERE m.id IN (SELECT value FROM json_each(i.source_memory_ids))
              AND memories_fts MATCH ?
          )
        )
      ORDER BY i.confidence DESC
      LIMIT ?
    `).all(
      minConfidence,
      ftsQuery,
      ftsQuery,
      limit,
    ) as Array<Record<string, unknown>>;

    const results: InsightQueryResult[] = [];

    for (const row of rows) {
      const insight = this.rowToInsight(row);
      const relevance = this.computeRelevance(insight, query, keywords);
      results.push({ insight, relevance });
    }

    // Relevance'a göre sırala
    results.sort((a, b) => b.relevance - a.relevance);

    if (results.length > 0) {
      logger.info(`[InsightEngine] ${results.length} insight retrieval sonucu (query: "${query.substring(0, 40)}...")`);
    }

    return results;
  }

  /**
   * Yüksek confidence'lı insight'ları sistem prompt'una eklemek için.
   */
  async getHighConfidenceInsights(threshold: number = 0.8, limit: number = 10): Promise<Insight[]> {
    const rows = this.db.prepare(`
      SELECT * FROM insights
      WHERE status = 'active' AND confidence >= ?
      ORDER BY confidence DESC, updated_at DESC
      LIMIT ?
    `).all(threshold, limit) as Array<Record<string, unknown>>;

    return rows.map(r => this.rowToInsight(r));
  }

  private extractKeywords(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2)
      .filter(w => !this.isStopWord(w));
  }

  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'bir', 've', 'bu', 'ile', 'için', 'çok', 'ama', 'ya', 'da', 'de', 'ki', 'mi',
      'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use',
    ]);
    return stopWords.has(word);
  }

  private computeRelevance(insight: Insight, query: string, keywords: string[]): number {
    const desc = insight.description.toLowerCase();
    let keywordMatches = 0;
    for (const kw of keywords) {
      if (desc.includes(kw)) keywordMatches++;
    }
    const keywordScore = keywords.length > 0 ? keywordMatches / keywords.length : 0;

    // Confidence'ın da etkisi var
    return keywordScore * 0.6 + insight.confidence * 0.4;
  }

  private rowToInsight(row: Record<string, unknown>): Insight {
    return {
      id: row.id as number,
      userId: row.user_id as string,
      type: row.type as Insight['type'],
      description: row.description as string,
      confidence: row.confidence as number,
      hitCount: row.hit_count as number,
      firstSeen: row.first_seen as string,
      lastSeen: row.last_seen as string,
      sourceMemoryIds: JSON.parse((row.source_memory_ids as string) || '[]'),
      sessionIds: JSON.parse((row.session_ids as string) || '[]'),
      status: row.status as Insight['status'],
      ttlDays: row.ttl_days as number,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}
