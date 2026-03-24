import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface AttachmentItem {
  fileName: string;
  mimeType: string;
  size?: number;
  data?: string;
  previewUrl?: string | null;
}

export interface ToolCallItem {
  name: string;
  arguments?: unknown;
  status: 'running' | 'success' | 'error';
  result?: string | null;
  isError?: boolean;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  avatar?: string;
  attachments?: AttachmentItem[];
  toolCalls?: ToolCallItem[];
  thinking?: string[];
  pending?: boolean;
}

export interface ConversationItem {
  id: string;
  title?: string;
  user_name?: string;
  created_at?: string;
  updated_at?: string;
  message_count?: number;
}

export interface StatsState {
  conversations: number;
  messages: number;
  memories: number;
}

export interface ConfirmRequest {
  id: string;
  toolName: string;
  path?: string;
  operation?: string;
  description?: string;
}

export type ActiveView = 'chat' | 'channels' | 'memory' | 'settings';
export type Theme = 'light' | 'dark';

// Kanal yapısı
export interface Channel {
  id: string;
  name: string;
  type: string;
  connected: boolean;
  messageCount?: number;
  lastActivity?: string;
}

// Toplu silme onayı için dialog state
export interface BulkDeleteConfirmState {
  isOpen: boolean;
  count: number;
  onConfirm: () => void;
}

// Mesaj düzenleme state
export interface EditingMessageState {
  messageId: string | null;
  content: string;
}

// Lightbox state
export interface LightboxState {
  imageUrl: string | null;
  imageAlt: string;
}

// Feedback state
export interface FeedbackState {
  messageId: string;
  type: 'positive' | 'negative';
  comment?: string;
}

// Toast state
export interface ToastState {
  message: string;
  type: 'success' | 'error' | 'info';
  isVisible: boolean;
}

export interface AgentState {
  isConnected: boolean;
  isReceiving: boolean;
  currentThinking: string;
  messages: Message[];
  activeMemories: unknown[];
  graphData: unknown;
  conversations: ConversationItem[];
  activeConversationId: string | null;
  activeView: ActiveView;
  stats: StatsState;
  confirmRequest: ConfirmRequest | null;
  userName: string;
  // Tema state
  theme: Theme;
  // Toplu seçim state'leri
  selectedConversationIds: string[];
  bulkDeleteConfirm: BulkDeleteConfirmState | null;
  // Mesaj düzenleme state
  editingMessage: EditingMessageState;
  // Lightbox state
  lightbox: LightboxState;
  // Hassas dizinler state
  sensitivePaths: string[];
  // Kanallar state
  channels: Channel[];
  selectedChannel: string | null;
  // Feedback state
  feedbacks: Record<string, FeedbackState>;
  // Toast state
  toast: ToastState;
  setConnected: (status: boolean) => void;
  setReceiving: (status: boolean) => void;
  setThinking: (text: string) => void;
  addMessage: (msg: Message) => void;
  setMessages: (messages: Message[]) => void;
  patchMessage: (id: string, patch: Partial<Message>) => void;
  appendToMessage: (id: string, content: string) => void;
  updateLastMessage: (content: string) => void;
  setMemories: (memories: unknown[]) => void;
  setGraph: (graph: unknown) => void;
  setConversations: (conversations: ConversationItem[]) => void;
  removeConversation: (id: string) => void;
  updateConversationTitle: (id: string, title: string) => void;
  setActiveConversationId: (id: string | null) => void;
  setActiveView: (view: ActiveView) => void;
  setStats: (stats: Partial<StatsState>) => void;
  setConfirmRequest: (request: ConfirmRequest | null) => void;
  clearMessages: () => void;
  appendThinking: (text: string) => void;
  setUserName: (name: string) => void;
  // Tema action'ları
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  // Toplu seçim action'ları
  toggleConversationSelection: (id: string) => void;
  clearConversationSelection: () => void;
  setBulkDeleteConfirm: (state: BulkDeleteConfirmState | null) => void;
  removeSelectedConversations: (ids: string[]) => void;
  // Mesaj düzenleme action'ları
  setEditingMessage: (state: EditingMessageState) => void;
  clearEditingMessage: () => void;
  updateMessageContent: (messageId: string, content: string) => void;
  removeMessagesAfter: (messageId: string) => void;
  // Lightbox action'ları
  openLightbox: (url: string, alt?: string) => void;
  closeLightbox: () => void;
  // Hassas dizinler action'ları
  setSensitivePaths: (paths: string[]) => void;
  addSensitivePath: (path: string) => void;
  removeSensitivePath: (path: string) => void;
  // Kanallar action'ları
  setChannels: (channels: Channel[]) => void;
  setSelectedChannel: (id: string | null) => void;
  fetchChannels: () => Promise<void>;
  // Feedback action'ları
  sendFeedback: (messageId: string, conversationId: string, type: 'positive' | 'negative', comment?: string) => Promise<void>;
  setFeedback: (messageId: string, feedback: FeedbackState | null) => void;
  // Toast action'ları
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  hideToast: () => void;
}

export const useAgentStore = create<AgentState>()(
  persist(
    (set) => ({
    isConnected: false,
    isReceiving: false,
    currentThinking: '',
    messages: [],
    activeMemories: [],
    graphData: { nodes: [], links: [] },
    conversations: [],
    activeConversationId: null,
    activeView: 'chat',
    stats: { conversations: 0, messages: 0, memories: 0 },
    confirmRequest: null,
    userName: '',
    // Tema state
    theme: 'dark',
    // Toplu seçim state'leri
    selectedConversationIds: [],
    bulkDeleteConfirm: null,
    // Mesaj düzenleme state
    editingMessage: { messageId: null, content: '' },
    // Lightbox state
    lightbox: { imageUrl: null, imageAlt: '' },
    // Hassas dizinler state
    sensitivePaths: [],
    // Kanallar state
    channels: [],
    selectedChannel: null,
    // Feedback state
    feedbacks: {},
    // Toast state
    toast: { message: '', type: 'info', isVisible: false },
  
    setConnected: (status) => set({ isConnected: status }),
      setReceiving: (status) => set({ isReceiving: status }),
      setThinking: (text) => set({ currentThinking: text }),
    
      addMessage: (msg) => set((state) => ({
        messages: [...state.messages, msg]
      })),
    
      setMessages: (messages) => set({ messages }),
    
      patchMessage: (id, patch) => set((state) => ({
        messages: state.messages.map((message) =>
          message.id === id ? { ...message, ...patch } : message
        )
      })),
    
      appendToMessage: (id, content) => set((state) => ({
        messages: state.messages.map((message) =>
          message.id === id
            ? { ...message, content: `${message.content}${content}` }
            : message
        )
      })),
    
      updateLastMessage: (content) => set((state) => {
        if (state.messages.length === 0) return state;
        const newMessages = [...state.messages];
        newMessages[newMessages.length - 1] = {
          ...newMessages[newMessages.length - 1],
          content: newMessages[newMessages.length - 1].content + content
        };
        return { messages: newMessages };
      }),
    
      setMemories: (memories) => set({ activeMemories: memories }),
    
      setGraph: (graph) => set({ graphData: graph }),
    
      setConversations: (conversations) => set({ conversations }),
    
      removeConversation: (id) => set((state) => ({
        conversations: state.conversations.filter((conversation) => conversation.id !== id),
        activeConversationId: state.activeConversationId === id ? null : state.activeConversationId,
      })),
  
      updateConversationTitle: (id, title) => set((state) => ({
        conversations: state.conversations.map((conversation) =>
          conversation.id === id ? { ...conversation, title } : conversation
        ),
      })),
  
      setActiveConversationId: (id) => set({ activeConversationId: id }),
    
      setActiveView: (view) => set({ activeView: view }),
    
      setStats: (stats) => set((state) => ({
        stats: { ...state.stats, ...stats }
      })),
    
      setConfirmRequest: (request) => set({ confirmRequest: request }),
    
      clearMessages: () => set({ messages: [], currentThinking: '' }),
    
      appendThinking: (text) => set((state) => ({
        currentThinking: state.currentThinking + text
      })),
    
      setUserName: (name) => set({ userName: name }),
    
      // Tema action'ları
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
    
      // Toplu seçim action'ları
      toggleConversationSelection: (id) => set((state) => ({
        selectedConversationIds: state.selectedConversationIds.includes(id)
          ? state.selectedConversationIds.filter((selectedId) => selectedId !== id)
          : [...state.selectedConversationIds, id],
      })),
  
      clearConversationSelection: () => set({ selectedConversationIds: [] }),
  
      setBulkDeleteConfirm: (state) => set({ bulkDeleteConfirm: state }),
  
      removeSelectedConversations: (ids) => set((state) => ({
        conversations: state.conversations.filter((conversation) => !ids.includes(conversation.id)),
        selectedConversationIds: [],
        activeConversationId: ids.includes(state.activeConversationId || '') ? null : state.activeConversationId,
      })),
  
      // Mesaj düzenleme action'ları
      setEditingMessage: (state) => set({ editingMessage: state }),
      clearEditingMessage: () => set({ editingMessage: { messageId: null, content: '' } }),
      updateMessageContent: (messageId, content) => set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === messageId ? { ...msg, content } : msg
        ),
      })),
      removeMessagesAfter: (messageId) => set((state) => {
        const messageIndex = state.messages.findIndex((msg) => msg.id === messageId);
        if (messageIndex === -1) return state;
        return {
          messages: state.messages.slice(0, messageIndex + 1),
        };
      }),
    
      // Lightbox action'ları
      openLightbox: (url, alt = '') => set({ lightbox: { imageUrl: url, imageAlt: alt } }),
      closeLightbox: () => set({ lightbox: { imageUrl: null, imageAlt: '' } }),
    
      // Hassas dizinler action'ları
      setSensitivePaths: (paths) => set({ sensitivePaths: paths }),
      addSensitivePath: (path) => set((state) => ({
        sensitivePaths: state.sensitivePaths.includes(path) ? state.sensitivePaths : [...state.sensitivePaths, path],
      })),
      removeSensitivePath: (path) => set((state) => ({
      sensitivePaths: state.sensitivePaths.filter((p) => p !== path),
      })),
    
      // Kanallar action'ları
      setChannels: (channels) => set({ channels }),
      setSelectedChannel: (id) => set({ selectedChannel: id }),
      fetchChannels: async () => {
        try {
          const response = await fetch('/api/channels');
          const channels = await response.json();
          set({ channels: Array.isArray(channels) ? channels : [] });
        } catch (error) {
          console.error('Kanallar alınamadı:', error);
          set({ channels: [] });
        }
      },
    
      // Feedback action'ları
      sendFeedback: async (messageId, conversationId, type, comment) => {
        try {
          const response = await fetch('/api/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messageId,
              conversationId,
              type,
              comment,
            }),
          });
    
          if (!response.ok) {
            throw new Error('Feedback gönderilemedi');
          }
    
          // Feedback'i state'e kaydet
          set((state) => ({
            feedbacks: {
              ...state.feedbacks,
              [messageId]: { messageId, type, comment },
            },
          }));
    
          // Başarı toast'u göster
          set({
            toast: {
              message: type === 'positive' ? 'Teşekkürler! Geri bildiriminiz kaydedildi.' : 'Geri bildiriminiz kaydedildi. Daha iyi olmamız için teşekkürler!',
              type: 'success',
              isVisible: true,
            },
          });
    
          // Toast'ı 3 saniye sonra gizle
          setTimeout(() => {
            set({ toast: { message: '', type: 'info', isVisible: false } });
          }, 3000);
        } catch (error) {
          console.error('Feedback hatası:', error);
          set({
            toast: {
              message: 'Geri bildirim gönderilemedi. Lütfen tekrar deneyin.',
              type: 'error',
              isVisible: true,
            },
          });
          setTimeout(() => {
            set({ toast: { message: '', type: 'info', isVisible: false } });
          }, 3000);
        }
      },
    
      setFeedback: (messageId, feedback) => set((state) => {
        if (feedback === null) {
          const { [messageId]: _, ...rest } = state.feedbacks;
          return { feedbacks: rest };
        }
        return {
          feedbacks: {
            ...state.feedbacks,
            [messageId]: feedback,
          },
        };
      }),
    
      // Toast action'ları
      showToast: (message, type = 'info') => set({
        toast: { message, type, isVisible: true },
      }),
    
      hideToast: () => set({
        toast: { message: '', type: 'info', isVisible: false },
      }),
    }),
    {
      name: 'pence-agent-store',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // Sadece kalıcı verileri sakla
      partialize: (state) => ({
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
        userName: state.userName,
        stats: state.stats,
        theme: state.theme,
        sensitivePaths: state.sensitivePaths,
      }),
    }
  )
);
