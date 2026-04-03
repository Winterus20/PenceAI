import { useState, useCallback, useEffect } from 'react';
import hotToast from 'react-hot-toast';
import { useAgentStore } from '../store/agentStore';

const STORAGE_KEYS = {
  pinnedConversations: 'pencePinned',
};

/**
 * Konuşma yönetimi için custom hook
 * Konuşma listesi yükleme, silme, pinleme ve aktif konuşma yönetimi
 */
export function useConversations() {
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

  // Konuşmaları yükle
  const loadConversations = useCallback(async () => {
    try {
      const response = await fetch('/api/conversations');
      const data = await response.json();
      setConversations(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Konuşmalar alınamadı:', error);
      hotToast.error('Konuşmalar yüklenirken bir hata oluştu');
    }
  }, [setConversations]);

  // İlk yükleme
  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  // Belirli bir konuşmayı yükle - mesajları döndürür
  const loadConversation = useCallback(
    async (conversationId: string) => {
      try {
        const response = await fetch(`/api/conversations/${conversationId}/messages`);
        const data = await response.json();
        setActiveConversationId(conversationId);
        return Array.isArray(data) ? data : [];
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
        await fetch(`/api/conversations/${conversationId}`, { method: 'DELETE' });
        removeConversation(conversationId);
        if (conversationId === activeConversationId) {
          clearMessages();
          setActiveConversationId(null);
        }
        await loadConversations();
        return true;
      } catch (error) {
        console.error('Konuşma silinemedi:', error);
        hotToast.error('Konuşma silinirken bir hata oluştu');
        return false;
      }
    },
    [activeConversationId, removeConversation, clearMessages, setActiveConversationId, loadConversations]
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
