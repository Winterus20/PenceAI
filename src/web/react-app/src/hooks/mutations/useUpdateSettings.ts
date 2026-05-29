import { useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsService, type AppConfig } from '@/services/settingsService';
import { SETTINGS_QUERY_KEY } from '@/hooks/queries/useSettings';
import { LLM_PROVIDERS_QUERY_KEY } from '@/hooks/queries/useLLMProviders';

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: Partial<AppConfig>) => settingsService.update(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SETTINGS_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: [LLM_PROVIDERS_QUERY_KEY] });
    },
  });
}
