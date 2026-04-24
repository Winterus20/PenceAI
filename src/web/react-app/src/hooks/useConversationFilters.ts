import { useState, useCallback } from 'react';
import type { ConversationItem } from '../store/agentStore';

export type SortOrder = 'newest' | 'oldest' | 'messages';

export interface UseConversationFiltersReturn {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  sortOrder: SortOrder;
  setSortOrder: (order: SortOrder) => void;
  filterConversations: (conversations: ConversationItem[]) => ConversationItem[];
}

/**
 * Konuşma filtreleme ve sıralama için custom hook
 * Arama sorgusu ve sıralama düzeni yönetimi
 */
export function useConversationFilters(): UseConversationFiltersReturn {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');

  /**
   * Konuşmaları filtrele ve sırala
   */
  const filterConversations = useCallback(
    (conversations: ConversationItem[]): ConversationItem[] => {
      // Arama filtresi
      let filtered = conversations;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        filtered = filtered.filter(
          (c) =>
            c.title?.toLowerCase().includes(query) ||
            c.user_name?.toLowerCase().includes(query)
        );
      }

      // Sıralama
      const sorted = [...filtered].sort((a, b) => {
        switch (sortOrder) {
          case 'newest':
            return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
          case 'oldest':
            return new Date(a.updated_at || 0).getTime() - new Date(b.updated_at || 0).getTime();
          case 'messages':
            return (b.message_count || 0) - (a.message_count || 0);
          default:
            return 0;
        }
      });

      return sorted;
    },
    [searchQuery, sortOrder]
  );

  return {
    searchQuery,
    setSearchQuery,
    sortOrder,
    setSortOrder,
    filterConversations,
  };
}
