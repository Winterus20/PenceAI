import type { StateCreator } from 'zustand';
import type { AgentState, ChatSlice } from '../types';

export const createChatSlice: StateCreator<
  AgentState,
  [['zustand/persist', unknown]],
  [],
  ChatSlice
> = (set) => ({
  isConnected: false,
  isReceiving: false,
  currentThinking: '',
  messages: [],
  activeMemories: [],
  graphData: { nodes: [], links: [] },
  conversations: [],
  activeConversationId: null,
  stats: { conversations: 0, messages: 0, memories: 0 },
  selectedConversationIds: [],
  bulkDeleteConfirm: null,
  editingMessage: { messageId: null, content: '' },

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

  setStats: (stats) => set((state) => ({
    stats: { ...state.stats, ...stats }
  })),

  clearMessages: () => set({ messages: [], currentThinking: '' }),

  appendThinking: (text) => set((state) => ({
    currentThinking: state.currentThinking + text
  })),

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
});
