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


