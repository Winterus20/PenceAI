/**
 * Observability React Query Hooks
 *
 * Observability verilerini React Query ile yönetir.
 */

import { useQuery } from '@tanstack/react-query';
import {
  getObservabilitySummary,
  getRecentTraces,
  getTraceDetail,
  getProviderStats,
  getErrorStats,
} from '@/services/observabilityService';

// Query keys
export const observabilityKeys = {
  all: ['observability'] as const,
  summary: () => [...observabilityKeys.all, 'summary'] as const,
  traces: (limit: number, offset: number) => [...observabilityKeys.all, 'traces', { limit, offset }] as const,
  traceDetail: (traceId: string) => [...observabilityKeys.all, 'trace', traceId] as const,
  providerStats: () => [...observabilityKeys.all, 'provider-stats'] as const,
  errorStats: () => [...observabilityKeys.all, 'error-stats'] as const,
};

/**
 * Özet metrikleri getir
 */
export function useObservabilitySummary(enabled: boolean = true) {
  return useQuery({
    queryKey: observabilityKeys.summary(),
    queryFn: getObservabilitySummary,
    staleTime: 30_000, // 30 saniye cache
    refetchOnWindowFocus: false,
    enabled,
  });
}

/**
 * Son trace'leri getir
 */
export function useRecentTraces(limit: number = 20, offset: number = 0, enabled: boolean = true) {
  return useQuery({
    queryKey: observabilityKeys.traces(limit, offset),
    queryFn: () => getRecentTraces(limit, offset),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled,
  });
}

/**
 * Tekil trace detayını getir
 */
export function useTraceDetail(traceId: string | null, enabled: boolean = true) {
  return useQuery({
    queryKey: observabilityKeys.traceDetail(traceId || ''),
    queryFn: () => getTraceDetail(traceId!),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: enabled && !!traceId,
  });
}

/**
 * Provider bazlı istatistikleri getir
 */
export function useProviderStats(enabled: boolean = true) {
  return useQuery({
    queryKey: observabilityKeys.providerStats(),
    queryFn: getProviderStats,
    staleTime: 60_000, // 1 dakika cache (daha az değişen veri)
    refetchOnWindowFocus: false,
    enabled,
  });
}

/**
 * Hata istatistiklerini getir
 */
export function useErrorStats(enabled: boolean = true) {
  return useQuery({
    queryKey: observabilityKeys.errorStats(),
    queryFn: getErrorStats,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled,
  });
}
