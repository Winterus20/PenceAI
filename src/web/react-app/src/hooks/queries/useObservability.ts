/**
 * Observability React Query Hooks
 *
 * Yerel metrics endpoint'lerinden veri çeker.
 */

import { useQuery } from '@tanstack/react-query';
import {
  getProviderStats,
  getErrorStats,
} from '@/services/observabilityService';

export const observabilityKeys = {
  all: ['observability'] as const,
  providerStats: () => [...observabilityKeys.all, 'provider-stats'] as const,
  errorStats: () => [...observabilityKeys.all, 'error-stats'] as const,
};

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

