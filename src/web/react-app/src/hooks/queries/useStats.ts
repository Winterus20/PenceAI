import { useQuery } from '@tanstack/react-query';
import { statsService, type StatsState } from '@/services/statsService';

export const STATS_QUERY_KEY = 'stats';

export function useStatsQuery() {
  return useQuery({
    queryKey: [STATS_QUERY_KEY],
    queryFn: () => statsService.get(),
    staleTime: 1000 * 60 * 1, // 1 dakika
    refetchInterval: 30000, // 30 saniyede bir otomatik yenile
    refetchOnWindowFocus: false,
  });
}

export type { StatsState };
