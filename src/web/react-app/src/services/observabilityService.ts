/**
 * Observability API Service
 *
 * Yerel metrics endpoint'leri ile iletişim kurar.
 */

import { api } from '@/lib/api-client';

export interface MetricsEntry {
  conversationId: string;
  messageId?: string;
  timestamp: string;
  performance: {
    total: number;
    retrieval: number;
    graphRAG: number;
    llmCalls: Array<{ key: string; ms: number }>;
    agentic: Record<string, number>;
    tools: number;
    toolCalls: number;
  };
  cost: {
    total: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
  };
  context: {
    historyTokens: number;
    userMessageTokens: number;
    systemPromptTokens: number;
  };
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

export interface ObservabilitySummaryResponse {
  success: boolean;
  metrics: {
    tracesToday: number;
    tracesLast7Days: number;
    totalCostToday: number;
    totalCostLast7Days: number;
    avgLatency: number;
    totalTokensToday: number;
    totalTokensLast7Days: number;
  };
}

export interface TracesResponse {
  success: boolean;
  traces: Array<{
    id: string;
    name: string;
    timestamp: string;
    latency: number;
    cost: number;
    totalTokens: number;
    observations: Array<{
      name: string;
      model?: string;
      tokens: number;
      cost: number;
      level: string;
    }>;
  }>;
}


export interface ProviderStatsResponse {
  success: boolean;
  providerStats: Record<string, {
    count: number;
    totalTokens: number;
    totalCost: number;
    avgLatency: number;
  }>;
}

export interface ErrorStatsResponse {
  success: boolean;
  totalTraces: number;
  errorTraces: number;
  errorRate: number;
}

export async function getAllMetrics(limit: number = 100): Promise<{ success: boolean; metrics: MetricsEntry[] }> {
  return api.get('/metrics/all', { query: { limit } });
}

export async function getConversationMetrics(conversationId: string): Promise<{ success: boolean; metrics: MetricsEntry[] }> {
  return api.get(`/metrics/${conversationId}`);
}

export async function getMetricsSummary(days: number = 1): Promise<{ success: boolean } & AggregatedMetrics> {
  return api.get('/metrics/summary', { query: { days } });
}

export async function getProviderStats(days: number = 7): Promise<ProviderStatsResponse> {
  return api.get('/metrics/provider-stats', { query: { days } });
}

export async function getErrorStats(): Promise<ErrorStatsResponse> {
  return api.get('/metrics/error-stats');
}

// Backward compatibility - eski ObservabilityDialog için wrapper'lar
export async function getObservabilitySummary(): Promise<ObservabilitySummaryResponse> {
  try {
    const summary = await getMetricsSummary(1);
    const summary7d = await getMetricsSummary(7);

    return {
      success: true,
      metrics: {
        tracesToday: summary.totalQueries,
        tracesLast7Days: summary7d.totalQueries,
        totalCostToday: summary.totalCost,
        totalCostLast7Days: summary7d.totalCost,
        avgLatency: summary.avgResponseTime,
        totalTokensToday: summary.totalTokens,
        totalTokensLast7Days: summary7d.totalTokens,
      }
    };
  } catch (error: any) {
    return {
      success: false,
      metrics: {
        tracesToday: 0,
        tracesLast7Days: 0,
        totalCostToday: 0,
        totalCostLast7Days: 0,
        avgLatency: 0,
        totalTokensToday: 0,
        totalTokensLast7Days: 0,
      }
    };
  }
}

export async function getRecentTraces(limit: number = 50): Promise<TracesResponse> {
  const response = await getAllMetrics(limit);

  return {
    success: response.success,
    traces: response.metrics.map((m, idx) => ({
      id: m.messageId || `trace-${idx}`,
      name: `Query #${idx + 1}`,
      timestamp: m.timestamp,
      latency: m.performance.total,
      cost: m.cost.total,
      totalTokens: m.cost.totalTokens,
      observations: m.performance.llmCalls.map((call) => ({
        name: call.key,
        model: call.key,
        tokens: 0,
        cost: 0,
        level: 'DEFAULT'
      }))
    }))
  };
}

