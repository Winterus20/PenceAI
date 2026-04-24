import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { CONVERSATIONS_QUERY_KEY } from '@/hooks/queries/useConversations';

/**
 * Toplu konuşma silme mutation hook'u
 * Başarılı silme sonrası conversations listesini invalidates eder
 */
export function useBulkDeleteConversations() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids: string[]) =>
      api.delete<{ ids: string[] }, unknown>('/conversations', { ids }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [CONVERSATIONS_QUERY_KEY] });
    },
  });
}
