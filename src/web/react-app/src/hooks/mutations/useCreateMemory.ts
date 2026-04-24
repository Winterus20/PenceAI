import { useMutation, useQueryClient } from '@tanstack/react-query';
import { memoryService, type MemoryItem } from '@/services/memoryService';
import { MEMORIES_QUERY_KEY } from '@/hooks/queries/useMemories';

export function useCreateMemory() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: Omit<MemoryItem, 'id' | 'created_at'>) => memoryService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [MEMORIES_QUERY_KEY] });
    },
  });
}
