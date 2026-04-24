import { useQuery } from '@tanstack/react-query';
import { memoryService } from '@/services/memoryService';

export const MEMORIES_QUERY_KEY = 'memories';

interface UseMemoriesOptions {
  searchQuery?: string;
  category?: string;
  enabled?: boolean;
}

export function useMemories({ searchQuery, category, enabled = true }: UseMemoriesOptions = {}) {
  return useQuery({
    queryKey: [MEMORIES_QUERY_KEY, searchQuery, category],
    queryFn: () => {
      if (searchQuery && searchQuery.trim().length >= 2) {
        return memoryService.search(searchQuery.trim());
      }
      return memoryService.getAll();
    },
    enabled,
    select: (data) => {
      let result = data;
      if (category && category !== 'all') {
        result = result.filter((m) => (m.category || 'general') === category);
      }
      return result;
    },
    staleTime: 1000 * 60 * 2, // 2 dakika
  });
}
