/**
 * Metrics React Query Hooks
 *
 * Yerel metrics endpoint'lerinden veri çeker.
 */

import { useQuery } from '@tanstack/react-query';
import { getAllMetrics, getMetricsSummary } from '@/services/observabilityService';

export const metricsKeys = {
  all: ['metrics'] as const,
  list: (limit: number) => [...metricsKeys.all, 'list', limit] as const,
  summary: (days: number) => [...metricsKeys.all, 'summary', days] as const,
};

export function useAllMetrics(limit: number = 100) {
  return useQuery({
    queryKey: metricsKeys.list(limit),
    queryFn: () => getAllMetrics(limit),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

export function useMetricsSummary(days: number = 1) {
  return useQuery({
    queryKey: metricsKeys.summary(days),
    queryFn: () => getMetricsSummary(days),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
