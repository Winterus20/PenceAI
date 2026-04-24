import { useQuery } from '@tanstack/react-query';
import { conversationService } from '@/services/conversationService';

export const CONVERSATIONS_QUERY_KEY = 'conversations';

/**
 * Tüm konuşmaları listeleyen React Query hook'u
 * 1 dakika staleTime ile cache'lenir
 */
export function useConversationsQuery() {
  return useQuery({
    queryKey: [CONVERSATIONS_QUERY_KEY],
    queryFn: () => conversationService.getAll(),
    staleTime: 1000 * 60 * 1, // 1 dakika
    refetchOnWindowFocus: false,
  });
}

/**
 * Belirli bir konuşmanın mesajlarını çeken React Query hook'u
 * conversationId null ise query devre dışı kalır
 * 5 dakika staleTime ile cache'lenir
 */
export function useConversationQuery(conversationId: string | null) {
  return useQuery({
    queryKey: [CONVERSATIONS_QUERY_KEY, conversationId, 'messages'],
    queryFn: () => conversationService.getMessages(conversationId!),
    enabled: !!conversationId,
    staleTime: 1000 * 60 * 5, // 5 dakika
    refetchOnWindowFocus: false,
  });
}

export function useBranchesQuery(conversationId: string | null) {
  return useQuery({
    queryKey: [CONVERSATIONS_QUERY_KEY, conversationId, 'branches'],
    queryFn: () => conversationService.getBranches(conversationId!),
    enabled: !!conversationId,
    staleTime: 1000 * 60 * 2,
    refetchOnWindowFocus: false,
  });
}

export function useBranchInfoQuery(conversationId: string | null) {
  return useQuery({
    queryKey: [CONVERSATIONS_QUERY_KEY, conversationId, 'branch-info'],
    queryFn: () => conversationService.getBranchInfo(conversationId!),
    enabled: !!conversationId,
    staleTime: 1000 * 60 * 2,
    refetchOnWindowFocus: false,
  });
}
