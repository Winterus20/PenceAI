import { useMutation, useQueryClient } from '@tanstack/react-query';
import { memoryService, type MemoryItem } from '@/services/memoryService';
import { MEMORIES_QUERY_KEY } from '@/hooks/queries/useMemories';

export function useUpdateMemory() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<MemoryItem> }) => 
      memoryService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [MEMORIES_QUERY_KEY] });
    },
  });
}
