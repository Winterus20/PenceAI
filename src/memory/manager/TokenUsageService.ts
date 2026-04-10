/**
 * TokenUsageService - LLM token kullanımı takibi.
 * 
 * Sorumluluklar:
 * - Token kullanım kaydı ekleme
 * - Dönemsel istatistik hesaplama
 * - Günlük kullanım serisi oluşturma
 */

import type Database from 'better-sqlite3';
import { calculateCost } from '../../utils/costCalculator.js';

export interface TokenUsageRecord {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TokenUsageStats {
  totalTokens: number;
  totalCost: number;
  providerBreakdown: Record<string, { tokens: number; cost: number }>;
}

export interface DailyUsageEntry {
  date: string;
  tokens: number;
  cost: number;
}

export class TokenUsageService {
  constructor(private db: Database.Database) {}

  /**
   * Yeni token usage kaydı ekler.
   */
  saveTokenUsage(record: TokenUsageRecord): void {
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
  getTokenUsageStats(period: string = 'week'): TokenUsageStats {
    const whereClause = this.buildPeriodWhereClause(period);

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
  getDailyUsage(period: string = 'week'): DailyUsageEntry[] {
    const whereClause = this.buildPeriodWhereClause(period);

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

  /**
   * Period parametresine göre WHERE clause oluşturur.
   */
  private buildPeriodWhereClause(period: string): string {
    const now = Math.floor(Date.now() / 1000);
    let periodSeconds: number;
    switch (period) {
      case 'day': periodSeconds = 86400; break;
      case 'week': periodSeconds = 604800; break;
      case 'month': periodSeconds = 2592000; break;
      default: periodSeconds = 0;
    }
    return periodSeconds > 0 ? `WHERE created_at >= datetime(${now} - ${periodSeconds}, 'unixepoch')` : '';
  }
}
