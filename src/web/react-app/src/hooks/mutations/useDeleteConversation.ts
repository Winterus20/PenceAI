import { useMutation, useQueryClient } from '@tanstack/react-query';
import { conversationService } from '@/services/conversationService';
import { CONVERSATIONS_QUERY_KEY } from '@/hooks/queries/useConversations';

/**
 * Tekil konuşma silme mutation hook'u
 * Başarılı silme sonrası conversations listesini invalidates eder
 */
export function useDeleteConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => conversationService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [CONVERSATIONS_QUERY_KEY] });
    },
  });
}
