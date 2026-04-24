import { useQuery } from '@tanstack/react-query';
import { settingsService } from '@/services/settingsService';

export const SENSITIVE_PATHS_QUERY_KEY = 'sensitive-paths';

export function useSensitivePaths() {
  return useQuery({
    queryKey: [SENSITIVE_PATHS_QUERY_KEY],
    queryFn: () => settingsService.getSensitivePaths(),
    staleTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
  });
}
