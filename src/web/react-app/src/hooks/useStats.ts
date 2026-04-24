import { useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAgentStore } from '@/store/agentStore';
import { useStatsQuery, STATS_QUERY_KEY, type StatsState } from '@/hooks/queries/useStats';

export function useStats() {
  const queryClient = useQueryClient();
  const stats = useAgentStore((state) => state.stats);
  const setStats = useAgentStore((state) => state.setStats);

  // React Query'den stats'ı çek
  const { data: queryStats } = useStatsQuery();

  // Query'den gelen stats'ı Zustand ile senkronize et
  useEffect(() => {
    if (queryStats) {
      setStats(queryStats);
    }
  }, [queryStats, setStats]);

  // WebSocket'ten gelen stats güncellemesi için
  const updateStatsFromWebSocket = useCallback((newStats: Record<string, unknown>) => {
    const typedStats = newStats as unknown as StatsState;
    setStats(typedStats);
    // Cache'i de güncelle
    queryClient.setQueryData([STATS_QUERY_KEY], typedStats);
  }, [queryClient, setStats]);

  return {
    stats,
    updateStatsFromWebSocket,
  };
}
