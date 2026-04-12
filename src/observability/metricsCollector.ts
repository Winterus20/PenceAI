/**
 * Metrics Collector — Yerel Observability Sistemi
 *
 * LLM çağrılarını, performance metriklerini ve maliyetleri
 * SQLite veritabanında toplar ve sorgular.
 */

import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';

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
      throw new Error('[MetricsCollector] Database not initialized. Call setDatabase() first.');
    }
    return this.db;
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
      logger.error({ err: error }, '[MetricsCollector] Failed to get conversation metrics');
      return [];
    }
  }

  /**
   * Tüm metrics'leri getir (limit ile)
   */
  getAllMetrics(limit: number = 100): MessageMetrics[] {
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
      logger.error({ err: error }, '[MetricsCollector] Failed to get all metrics');
      return [];
    }
  }

  /**
   * Aggrege metrics özeti - son N gün
   */
  getAggregatedMetrics(days: number = 1): AggregatedMetrics {
    try {
      const db = this.getDb();
      const rows = db.prepare(`
        SELECT * FROM metrics
        WHERE timestamp >= datetime('now', '-' || ? || ' days')
        ORDER BY timestamp DESC
      `).all(days) as Array<Record<string, unknown>>;

      const metrics: MessageMetrics[] = rows.map(row => ({
        conversationId: row.conversation_id as string,
        messageId: row.message_id as string | undefined,
        timestamp: row.timestamp as string,
        performance: JSON.parse(row.performance_json as string),
        cost: JSON.parse(row.cost_json as string),
        context: JSON.parse((row.context_json as string) || '{}')
      }));

      return this.aggregate(metrics);
    } catch (error: unknown) {
      logger.error({ err: error }, '[MetricsCollector] Failed to get aggregated metrics');
      return this.emptyAggregatedMetrics();
    }
  }

  /**
   * Provider bazlı istatistikler
   */
  getProviderStats(days: number = 7): Record<string, { count: number; totalTokens: number; totalCost: number; avgLatency: number }> {
    try {
      const db = this.getDb();
      const rows = db.prepare(`
        SELECT performance_json FROM metrics
        WHERE timestamp >= datetime('now', '-' || ? || ' days')
      `).all(days) as Array<Record<string, unknown>>;

      const providerStats: Record<string, { count: number; totalTokens: number; totalCost: number; totalTime: number }> = {};

      for (const row of rows) {
        const perf = JSON.parse(row.performance_json as string) as PerformanceMetrics;
        for (const llmCall of perf.llmCalls || []) {
          if (!providerStats[llmCall.key]) {
            providerStats[llmCall.key] = { count: 0, totalTokens: 0, totalCost: 0, totalTime: 0 };
          }
          providerStats[llmCall.key].count += 1;
          providerStats[llmCall.key].totalTime += llmCall.ms;
        }
      }

      // Ortalama latency ekle
      const result: Record<string, { count: number; totalTokens: number; totalCost: number; avgLatency: number }> = {};
      for (const [key, stats] of Object.entries(providerStats)) {
        result[key] = {
          count: stats.count,
          totalTokens: stats.totalTokens,
          totalCost: stats.totalCost,
          avgLatency: stats.count > 0 ? stats.totalTime / stats.count : 0
        };
      }

      return result;
    } catch (error: unknown) {
      logger.error({ err: error }, '[MetricsCollector] Failed to get provider stats');
      return {};
    }
  }

  /**
   * Hata istatistikleri (şimdilik basit)
   */
  getErrorStats(): { totalTraces: number; errorTraces: number; errorRate: number } {
    // Şimdilik basit - gelecekte error logging eklenebilir
    return { totalTraces: 0, errorTraces: 0, errorRate: 0 };
  }

  /**
   * Metrics'leri aggregate et
   */
  private aggregate(metrics: MessageMetrics[]): AggregatedMetrics {
    const totalQueries = metrics.length;
    const totalTokens = metrics.reduce((sum, m) => sum + (m.cost.totalTokens || 0), 0);
    const totalCost = metrics.reduce((sum, m) => sum + (m.cost.total || 0), 0);
    const totalTime = metrics.reduce((sum, m) => sum + (m.performance.total || 0), 0);

    const avgResponseTime = totalQueries > 0 ? totalTime / totalQueries : 0;
    const avgTokensPerQuery = totalQueries > 0 ? totalTokens / totalQueries : 0;
    const costPerToken = totalTokens > 0 ? totalCost / totalTokens : 0;

    const retrievalTime = metrics.reduce((sum, m) => sum + (m.performance.retrieval || 0), 0);
    const graphRAGTime = metrics.reduce((sum, m) => sum + (m.performance.graphRAG || 0), 0);
    const toolTime = metrics.reduce((sum, m) => sum + (m.performance.tools || 0), 0);

    // Provider breakdown
    const byProvider: Record<string, { calls: number; tokens: number; cost: number; totalTime: number }> = {};
    for (const m of metrics) {
      for (const call of m.performance.llmCalls || []) {
        if (!byProvider[call.key]) {
          byProvider[call.key] = { calls: 0, tokens: 0, cost: 0, totalTime: 0 };
        }
        byProvider[call.key].calls += 1;
        byProvider[call.key].totalTime += call.ms;
      }
    }

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
      toolTime
    };
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
