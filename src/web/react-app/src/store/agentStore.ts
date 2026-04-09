import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AgentState } from './types';
import { createChatSlice } from './slices/chatSlice';
import { createUISlice } from './slices/uiSlice';
import { createSettingsSlice } from './slices/settingsSlice';

// Type re-exports for backwards compatibility with existing components
// This allows us to refactor internally without breaking the rest of the application
export type { 
  AttachmentItem, ToolCallItem, Message, ConversationItem, StatsState, 
  ConfirmRequest, ActiveView, Theme, Channel, BulkDeleteConfirmState, 
  EditingMessageState, LightboxState, FeedbackState, ToastState, AgentState 
} from './types';

export const useAgentStore = create<AgentState>()(
  persist(
    (set, get, api) => ({
      ...createChatSlice(set, get, api),
      ...createUISlice(set, get, api),
      ...createSettingsSlice(set, get, api),
    }),
    {
      name: 'pence-agent-store-v2', // Changed name to force a clear state (user requested reset)
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
        userName: state.userName,
        stats: state.stats,
        theme: state.theme,
        sensitivePaths: state.sensitivePaths,
        // LLM ayarlarını da kaydet - sayfa yenilendiğinde korunması için
        defaultLLMProvider: state.defaultLLMProvider,
        defaultLLMModel: state.defaultLLMModel,
      }),
    }
  )
);
