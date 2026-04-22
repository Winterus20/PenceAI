/**
 * Metrics Collector — Yerel Observability Sistemi
 *
 * LLM çağrılarını, performance metriklerini ve maliyetleri
 * SQLite veritabanında toplar ve sorgular.
 */

import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';
import { DatabaseError } from '../errors/DatabaseError.js';

export interface LLMCallMetric {
  key: string;
  ms: number;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
}

export interface PerformanceMetrics {
  total: number;
  retrieval: number;
  graphRAG: number;
  llmCalls: LLMCallMetric[];
  agentic: Record<string, number>;
  tools: number;
  toolCalls: number;
}

export interface CostMetrics {
  total: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
}

export interface ContextMetrics {
  historyTokens: number;
  userMessageTokens: number;
  systemPromptTokens: number;
}

export interface MessageMetrics {
  conversationId: string;
  messageId?: string;
  timestamp: string;
  performance: PerformanceMetrics;
  cost: CostMetrics;
  context: ContextMetrics;
}

export interface AggregatedMetrics {
  totalQueries: number;
  totalTokens: number;
  totalCost: number;
  avgResponseTime: number;
  avgTokensPerQuery: number;
  costPerToken: number;
  byProvider: Record<string, { calls: number; tokens: number; cost: number; totalTime: number }>;
  retrievalTime: number;
  graphRAGTime: number;
  toolTime: number;
}

class MetricsCollector {
  private db: Database.Database | null = null;

  /**
   * SQLite veritabanı bağlantısını ayarla
   */
  setDatabase(db: Database.Database): void {
    this.db = db;
  }

  private getDb(): Database.Database {
    if (!this.db) {
      throw new DatabaseError('[MetricsCollector] Database not initialized. Call setDatabase() first.');
    }
    return this.db;
  }

  /** DB hazır mı kontrol et */
  private isDbReady(): boolean {
    return this.db !== null;
  }

  /**
   * Mesaj metrics'ini SQLite'a kaydet
   */
  async recordMetrics(metrics: MessageMetrics): Promise<void> {
    try {
      const db = this.getDb();
      const stmt = db.prepare(`
        INSERT INTO metrics (conversation_id, message_id, timestamp, performance_json, cost_json, context_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        metrics.conversationId,
        metrics.messageId || null,
        metrics.timestamp || new Date().toISOString(),
        JSON.stringify(metrics.performance),
        JSON.stringify(metrics.cost),
        JSON.stringify(metrics.context)
      );

      logger.debug({
        conversationId: metrics.conversationId,
        totalCost: metrics.cost.total,
        totalTokens: metrics.cost.totalTokens
      }, '[MetricsCollector] Metrics recorded');
    } catch (error: unknown) {
      logger.error({ err: error }, '[MetricsCollector] Failed to record metrics');
    }
  }

  /**
   * Belirli bir conversation'ın metrics'lerini getir
   */
  getConversationMetrics(conversationId: string): MessageMetrics[] {
    if (!this.isDbReady()) {
      logger.warn('[MetricsCollector] getConversationMetrics called before database initialized, returning empty');
      return [];
    }
    try {
      const db = this.getDb();
      const rows = db.prepare(`
        SELECT * FROM metrics
        WHERE conversation_id = ?
        ORDER BY timestamp DESC
      `).all(conversationId) as Array<Record<string, unknown>>;

      return rows.map(row => ({
        conversationId: row.conversation_id as string,
        messageId: row.message_id as string | undefined,
        timestamp: row.timestamp as string,
        performance: JSON.parse(row.performance_json as string),
        cost: JSON.parse(row.cost_json as string),
        context: JSON.parse((row.context_json as string) || '{}')
      }));
    } catch (error: unknown) {
      logger.error({ err: error, conversationId }, '[MetricsCollector] Failed to get conversation metrics');
      return [];
    }
  }

  /**
   * Tüm metrics'leri getir (limit ile)
   */
  getAllMetrics(limit: number = 100): MessageMetrics[] {
    if (!this.isDbReady()) {
      logger.warn('[MetricsCollector] getAllMetrics called before database initialized, returning empty');
      return [];
    }
    try {
      const db = this.getDb();
      const rows = db.prepare(`
        SELECT * FROM metrics
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(limit) as Array<Record<string, unknown>>;

      return rows.map(row => ({
        conversationId: row.conversation_id as string,
        messageId: row.message_id as string | undefined,
        timestamp: row.timestamp as string,
        performance: JSON.parse(row.performance_json as string),
        cost: JSON.parse(row.cost_json as string),
        context: JSON.parse((row.context_json as string) || '{}')
      }));
    } catch (error: unknown) {
      logger.error({ err: error, limit }, '[MetricsCollector] Failed to get all metrics');
      throw error;
    }
  }

  /**
   * Aggrege metrics özeti - son N gün
   * SQL SUM/AVG/COUNT ile aggregation — binlerce satır yerine tek satır döner.
   */
  getAggregatedMetrics(days: number = 1): AggregatedMetrics {
    if (!this.isDbReady()) {
      logger.warn('[MetricsCollector] getAggregatedMetrics called before database initialized, returning empty');
      return this.emptyAggregatedMetrics();
    }
    try {
      const db = this.getDb();

      // Ana aggregation — tüm hesaplama SQL'de, JS'e tek satır döner
      const row = db.prepare(`
        SELECT
          COUNT(*)                                              as totalQueries,
          COALESCE(SUM(json_extract(cost_json, '$.totalTokens')), 0)  as totalTokens,
          COALESCE(SUM(json_extract(cost_json, '$.total')), 0)        as totalCost,
          COALESCE(SUM(json_extract(performance_json, '$.total')), 0) as totalTime,
          COALESCE(SUM(json_extract(performance_json, '$.retrieval')), 0) as retrievalTime,
          COALESCE(SUM(json_extract(performance_json, '$.graphRAG')), 0)  as graphRAGTime,
          COALESCE(SUM(json_extract(performance_json, '$.tools')), 0)     as toolTime
        FROM metrics
        WHERE timestamp >= datetime('now', '-' || ? || ' days')
      `).get(days) as Record<string, unknown>;

      const totalQueries = (row.totalQueries as number) ?? 0;
      const totalTokens = (row.totalTokens as number) ?? 0;
      const totalCost = (row.totalCost as number) ?? 0;
      const totalTime = (row.totalTime as number) ?? 0;
      const retrievalTime = (row.retrievalTime as number) ?? 0;
      const graphRAGTime = (row.graphRAGTime as number) ?? 0;
      const toolTime = (row.toolTime as number) ?? 0;

      const avgResponseTime = totalQueries > 0 ? totalTime / totalQueries : 0;
      const avgTokensPerQuery = totalQueries > 0 ? totalTokens / totalQueries : 0;
      const costPerToken = totalTokens > 0 ? totalCost / totalTokens : 0;

      // Provider breakdown — json_each ile llmCalls array'ini SQL'de aç
      const byProvider = this.getProviderBreakdown(days);

      return {
        totalQueries,
        totalTokens,
        totalCost,
        avgResponseTime,
        avgTokensPerQuery,
        costPerToken,
        byProvider,
        retrievalTime,
        graphRAGTime,
        toolTime,
      };
    } catch (error: unknown) {
      logger.error({ err: error, days }, '[MetricsCollector] Failed to get aggregated metrics');
      throw error;
    }
  }

  /**
   * Provider bazlı istatistikler — SQL json_each ile aggregation
   */
  getProviderStats(days: number = 7): Record<string, { count: number; totalTokens: number; totalCost: number; avgLatency: number }> {
    if (!this.isDbReady()) {
      logger.warn('[MetricsCollector] getProviderStats called before database initialized, returning empty');
      return {};
    }
    try {
      const providerBreakdown = this.getProviderBreakdown(days);

      const result: Record<string, { count: number; totalTokens: number; totalCost: number; avgLatency: number }> = {};
      for (const [key, stats] of Object.entries(providerBreakdown)) {
        result[key] = {
          count: stats.calls,
          totalTokens: stats.tokens,
          totalCost: stats.cost,
          avgLatency: stats.calls > 0 ? stats.totalTime / stats.calls : 0,
        };
      }

      return result;
    } catch (error: unknown) {
      logger.error({ err: error, days }, '[MetricsCollector] Failed to get provider stats');
      throw error;
    }
  }

  /**
   * SQL json_each ile provider breakdown — llmCalls array'ini SQL'de açar.
   * Hem getAggregatedMetrics hem getProviderStats tarafından kullanılır.
   */
  private getProviderBreakdown(days: number): Record<string, { calls: number; tokens: number; cost: number; totalTime: number }> {
    const db = this.getDb();

    const providerRows = db.prepare(`
      SELECT
        json_extract(j.value, '$.key')                       as provider_key,
        COUNT(*)                                              as calls,
        COALESCE(SUM(json_extract(j.value, '$.ms')), 0)     as totalTime
      FROM (
        SELECT performance_json
        FROM metrics
        WHERE timestamp >= datetime('now', '-' || ? || ' days')
          AND json_type(performance_json, '$.llmCalls') = 'array'
      ) sub
      CROSS JOIN json_each(json_extract(sub.performance_json, '$.llmCalls')) j
      GROUP BY json_extract(j.value, '$.key')
    `).all(days) as Array<Record<string, unknown>>;

    const byProvider: Record<string, { calls: number; tokens: number; cost: number; totalTime: number }> = {};
    for (const row of providerRows) {
      const key = row.provider_key as string;
      byProvider[key] = {
        calls: (row.calls as number) ?? 0,
        tokens: 0,
        cost: 0,
        totalTime: (row.totalTime as number) ?? 0,
      };
    }

    return byProvider;
  }

  /**
   * Hata istatistikleri (şimdilik basit)
   */
  getErrorStats(): { totalTraces: number; errorTraces: number; errorRate: number } {
    // Şimdilik basit - gelecekte error logging eklenebilir
    return { totalTraces: 0, errorTraces: 0, errorRate: 0 };
  }

  private emptyAggregatedMetrics(): AggregatedMetrics {
    return {
      totalQueries: 0,
      totalTokens: 0,
      totalCost: 0,
      avgResponseTime: 0,
      avgTokensPerQuery: 0,
      costPerToken: 0,
      byProvider: {},
      retrievalTime: 0,
      graphRAGTime: 0,
      toolTime: 0
    };
  }
}

export const metricsCollector = new MetricsCollector();
