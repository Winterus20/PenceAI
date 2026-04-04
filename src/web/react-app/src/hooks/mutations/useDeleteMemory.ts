import { useMutation, useQueryClient } from '@tanstack/react-query';
import { memoryService } from '@/services/memoryService';
import { MEMORIES_QUERY_KEY } from '@/hooks/queries/useMemories';

export function useDeleteMemory() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: number) => memoryService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [MEMORIES_QUERY_KEY] });
    },
  });
}
