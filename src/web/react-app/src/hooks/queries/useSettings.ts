import { useQuery } from '@tanstack/react-query';
import { settingsService } from '@/services/settingsService';

export const SETTINGS_QUERY_KEY = 'settings';

export function useSettings() {
  return useQuery({
    queryKey: [SETTINGS_QUERY_KEY],
    queryFn: () => settingsService.get(),
    staleTime: 1000 * 60 * 10, // 10 dakika - settings nadir değişir
    refetchOnWindowFocus: false,
  });
}
