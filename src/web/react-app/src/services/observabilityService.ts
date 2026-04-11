/**
 * Observability API Service
 *
 * Observability endpoint'leri ile iletişim kurar.
 */

import { api } from '@/lib/api-client';

export interface ObservationSummary {
  name: string;
  model: string;
  latency: number;
  cost: number;
  tokens: number;
  level: 'DEFAULT' | 'DEBUG' | 'WARNING' | 'ERROR';
}

export interface Trace {
  id: string;
  name: string;
  timestamp: string;
  latency: number;
  cost: number;
  totalTokens: number;
  observations: ObservationSummary[];
}

export interface TraceDetail {
  id: string;
  name: string;
  timestamp: string;
  latency: number;
  cost: number;
  totalTokens: number;
  usage: {
    input: number;
    output: number;
    total: number;
    unit: string;
  };
  input: unknown;
  output: unknown;
  metadata: Record<string, unknown>;
  userId: string;
  sessionId: string;
  tags: string[];
  observations: Array<{
    id: string;
    type: 'span' | 'generation' | 'event';
    name: string;
    startTime: string;
    endTime: string;
    latency: number;
    model: string;
    usage: { input: number; output: number; total: number; unit: string };
    cost: number;
    level: string;
    statusMessage: string;
    input: unknown;
    output: unknown;
    tokens?: number;
  }>;
}

export interface ObservabilityMetrics {
  tracesToday: number;
  tracesLast7Days: number;
  totalCostToday: number;
  totalCostLast7Days: number;
  avgLatency: number;
  totalTokensToday: number;
  totalTokensLast7Days: number;
}

export interface ObservabilitySummaryResponse {
  success: boolean;
  metrics: ObservabilityMetrics;
  totalTraces: number;
}

export interface TracesResponse {
  success: boolean;
  traces: Trace[];
  total: number;
  limit: number;
  offset: number;
}

export interface TraceDetailResponse {
  success: boolean;
  trace: TraceDetail;
}

export interface ProviderStats {
  count: number;
  totalCost: number;
  totalTokens: number;
  avgLatency: number;
}

export interface ProviderStatsResponse {
  success: boolean;
  providerStats: Record<string, ProviderStats>;
}

export interface ErrorStats {
  totalTraces: number;
  errorTraces: number;
  warningTraces: number;
  errorRate: number;
  errorsByType: Record<string, number>;
}

export interface ErrorStatsResponse {
  success: boolean;
  errorStats: ErrorStats;
}

/**
 * Özet metrikleri getir
 */
export async function getObservabilitySummary(): Promise<ObservabilitySummaryResponse> {
  return api.get<ObservabilitySummaryResponse>('/observability/summary');
}

/**
 * Son trace'leri getir
 */
export async function getRecentTraces(limit: number = 20, offset: number = 0): Promise<TracesResponse> {
  return api.get<TracesResponse>('/observability/traces', {
    query: { limit, offset },
  });
}

/**
 * Tekil trace detayını getir
 */
export async function getTraceDetail(traceId: string): Promise<TraceDetailResponse> {
  return api.get<TraceDetailResponse>(`/observability/traces/${traceId}`);
}

/**
 * Provider bazlı istatistikleri getir
 */
export async function getProviderStats(): Promise<ProviderStatsResponse> {
  return api.get<ProviderStatsResponse>('/observability/provider-stats');
}

/**
 * Hata istatistiklerini getir
 */
export async function getErrorStats(): Promise<ErrorStatsResponse> {
  return api.get<ErrorStatsResponse>('/observability/error-stats');
}
