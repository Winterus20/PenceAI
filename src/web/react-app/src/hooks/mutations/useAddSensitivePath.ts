import { useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsService } from '@/services/settingsService';
import { SENSITIVE_PATHS_QUERY_KEY } from '@/hooks/queries/useSensitivePaths';

export function useAddSensitivePath() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (path: string) => settingsService.addSensitivePath(path),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SENSITIVE_PATHS_QUERY_KEY] });
    },
  });
}
