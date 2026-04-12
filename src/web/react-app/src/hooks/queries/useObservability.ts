/**
 * Observability React Query Hooks
 *
 * Yerel metrics endpoint'lerinden veri çeker.
 */

import { useQuery } from '@tanstack/react-query';
import {
  getObservabilitySummary,
  getRecentTraces,
  getProviderStats,
  getErrorStats,
  getTraceDetail,
} from '@/services/observabilityService';

export const observabilityKeys = {
  all: ['observability'] as const,
  summary: () => [...observabilityKeys.all, 'summary'] as const,
  traces: (limit: number) => [...observabilityKeys.all, 'traces', limit] as const,
  traceDetail: (traceId: string) => [...observabilityKeys.all, 'trace', traceId] as const,
  providerStats: () => [...observabilityKeys.all, 'provider-stats'] as const,
  errorStats: () => [...observabilityKeys.all, 'error-stats'] as const,
};

export function useObservabilitySummary(enabled: boolean = true) {
  return useQuery({
    queryKey: observabilityKeys.summary(),
    queryFn: getObservabilitySummary,
    enabled,
    staleTime: 60_000,
  });
}

export function useRecentTraces(limit: number = 50) {
  return useQuery({
    queryKey: observabilityKeys.traces(limit),
    queryFn: () => getRecentTraces(limit),
    staleTime: 30_000,
  });
}

export function useProviderStats() {
  return useQuery({
    queryKey: observabilityKeys.providerStats(),
    queryFn: () => getProviderStats(7),
    staleTime: 120_000,
  });
}

export function useErrorStats() {
  return useQuery({
    queryKey: observabilityKeys.errorStats(),
    queryFn: getErrorStats,
    staleTime: 120_000,
  });
}

export function useTraceDetail(traceId: string | null) {
  return useQuery({
    queryKey: observabilityKeys.traceDetail(traceId || ''),
    queryFn: () => getTraceDetail(traceId!),
    enabled: !!traceId,
  });
}
