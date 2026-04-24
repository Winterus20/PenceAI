import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface UsageStatsResponse {
  period: string;
  totalTokens: number;
  totalCost: number;
  providerBreakdown: Record<string, { tokens: number; cost: number }>;
  dailyUsage: Array<{ date: string; tokens: number; cost: number }>;
}

/**
 * Token kullanım istatistiklerini çeken hook.
 * @param period - 'day', 'week', 'month', 'all'
 */
export function useUsageStats(period: string = 'week') {
  return useQuery<UsageStatsResponse>({
    queryKey: ['usage-stats', period],
    queryFn: () => api.get<UsageStatsResponse>('/usage/stats', { query: { period } }),
    refetchInterval: 60000, // Her dakika güncelle
    staleTime: 30000, // 30 saniye taze kabul et
  });
}
