import { useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import hotToast from 'react-hot-toast';
import { useAgentStore } from '../store/agentStore';
import { conversationService } from '@/services/conversationService';
import { CONVERSATIONS_QUERY_KEY } from '@/hooks/queries/useConversations';

const STORAGE_KEYS = {
  pinnedConversations: 'pencePinned',
};

/**
 * Konuşma yönetimi için custom hook
 * React Query ile veri yönetimi, Zustand ile UI state yönetimi
 * Backward compatible - aynı interface'i sağlar
 */
export function useConversations() {
  const queryClient = useQueryClient();
  const {
    conversations,
    activeConversationId,
    setConversations,
    setActiveConversationId,
    removeConversation,
    clearMessages,
  } = useAgentStore();

  // Pinlenmiş konuşmalar (localStorage'dan yüklenir)
  const [pinnedConversations, setPinnedConversations] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      return JSON.parse(window.localStorage.getItem(STORAGE_KEYS.pinnedConversations) || '[]');
    } catch {
      return [];
    }
  });

  // Pinlenmiş konuşmaları localStorage'a kaydet
  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.pinnedConversations, JSON.stringify(pinnedConversations));
  }, [pinnedConversations]);

  // React Query ile conversations'ı çek
  const { data: fetchedConversations = [] } = useQuery({
    queryKey: [CONVERSATIONS_QUERY_KEY],
    queryFn: () => conversationService.getAll(),
    staleTime: 1000 * 60 * 1, // 1 dakika
    refetchOnWindowFocus: false,
  });

  // Zustand store'u React Query'den gelen verilerle senkronize et
  useEffect(() => {
    if (fetchedConversations.length > 0) {
      setConversations(fetchedConversations);
    }
  }, [fetchedConversations, setConversations]);

  // Konuşmaları yükle (React Query cache'inden veya fetch'ten)
  const loadConversations = useCallback(async () => {
    try {
      return await queryClient.fetchQuery({
        queryKey: [CONVERSATIONS_QUERY_KEY],
        queryFn: () => conversationService.getAll(),
      });
    } catch (error) {
      console.error('Konuşmalar alınamadı:', error);
      hotToast.error('Konuşmalar yüklenirken bir hata oluştu');
      return [];
    }
  }, [queryClient]);

  // Belirli bir konuşmayı yükle - mesajları döndürür
  const loadConversation = useCallback(
    async (conversationId: string) => {
      try {
        const messages = await conversationService.getMessages(conversationId);
        setActiveConversationId(conversationId);
        return Array.isArray(messages) ? messages : [];
      } catch (error) {
        console.error('Konuşma yüklenemedi:', error);
        hotToast.error('Konuşma yüklenirken bir hata oluştu');
        return [];
      }
    },
    [setActiveConversationId]
  );

  // Konuşma sil
  const deleteConversation = useCallback(
    async (conversationId: string) => {
      if (!window.confirm('Bu sohbet silinsin mi?')) return false;

      try {
        await conversationService.delete(conversationId);
        removeConversation(conversationId);
        if (conversationId === activeConversationId) {
          clearMessages();
          setActiveConversationId(null);
        }
        // React Query cache'ini invalid et
        queryClient.invalidateQueries({ queryKey: [CONVERSATIONS_QUERY_KEY] });
        return true;
      } catch (error) {
        console.error('Konuşma silinemedi:', error);
        hotToast.error('Konuşma silinirken bir hata oluştu');
        return false;
      }
    },
    [activeConversationId, removeConversation, clearMessages, setActiveConversationId, queryClient]
  );

  // Pin toggle
  const togglePinned = useCallback((conversationId: string) => {
    setPinnedConversations((current) =>
      current.includes(conversationId)
        ? current.filter((id) => id !== conversationId)
        : [conversationId, ...current]
    );
  }, []);

  // Yeni sohbet başlat
  const handleNewChat = useCallback(() => {
    clearMessages();
    setActiveConversationId(null);
  }, [clearMessages, setActiveConversationId]);

  return {
    // State
    conversations,
    activeConversationId,
    pinnedConversations,
    // Actions
    loadConversations,
    loadConversation,
    deleteConversation,
    togglePinned,
    handleNewChat,
    setActiveConversationId,
  };
}
