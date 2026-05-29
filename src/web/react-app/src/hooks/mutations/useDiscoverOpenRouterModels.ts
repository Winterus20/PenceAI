import { useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsService } from '@/services/settingsService';
import { LLM_PROVIDERS_QUERY_KEY } from '@/hooks/queries/useLLMProviders';

export function useDiscoverOpenRouterModels() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data?: { apiKey?: string }) => settingsService.discoverOpenRouterModels(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [LLM_PROVIDERS_QUERY_KEY] });
    },
  });
}
