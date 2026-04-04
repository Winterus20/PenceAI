import { useQuery } from '@tanstack/react-query';
import { settingsService } from '@/services/settingsService';

export const LLM_PROVIDERS_QUERY_KEY = 'llm-providers';

export function useLLMProviders() {
  return useQuery({
    queryKey: [LLM_PROVIDERS_QUERY_KEY],
    queryFn: () => settingsService.getLLMProviders(),
    staleTime: 1000 * 60 * 30, // 30 dakika - provider listesi nadir değişir
    refetchOnWindowFocus: false,
  });
}
