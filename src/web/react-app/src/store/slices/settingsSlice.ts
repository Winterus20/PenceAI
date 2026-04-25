import type { StateCreator } from 'zustand';
import type { AgentState, SettingsSlice } from '../types';
import { api } from '../../lib/api-client';

export const createSettingsSlice: StateCreator<
  AgentState,
  [['zustand/persist', unknown]],
  [],
  SettingsSlice
> = (set) => ({
  userName: '',
  sensitivePaths: [],
  channels: [],
  selectedChannel: null,
  feedbacks: {},
  defaultLLMProvider: '',
  defaultLLMModel: '',

  setUserName: (name) => set({ userName: name }),
  
  setSensitivePaths: (paths) => set({ sensitivePaths: paths }),
  addSensitivePath: (path) => set((state) => ({
    sensitivePaths: state.sensitivePaths.includes(path) ? state.sensitivePaths : [...state.sensitivePaths, path],
  })),
  removeSensitivePath: (path) => set((state) => ({
    sensitivePaths: state.sensitivePaths.filter((p) => p !== path),
  })),
  
  setChannels: (channels) => set({ channels }),
  setSelectedChannel: (id) => set({ selectedChannel: id }),
  fetchChannels: async () => {
    try {
      const rawChannels = await api.get('/channels');
      // Backend getChannelStatus() returns { type, name, connected } — transform to frontend Channel shape
      const channels = (Array.isArray(rawChannels) ? rawChannels : []).map((ch: unknown) => {
        const c = ch as Record<string, unknown>;
        return {
          id: String(c.id || c.type || String(c.name).toLowerCase().replace(/\s+/g, '-')),
          name: String(c.name ?? ''),
          type: String(c.type ?? ''),
          connected: Boolean(c.connected),
          messageCount: typeof c.messageCount === 'number' ? c.messageCount : 0,
          lastActivity: String(c.lastActivity ?? ''),
        };
      });
      set({ channels });
    } catch (error) {
      console.error('Kanallar alınamadı:', error);
      set({ channels: [] });
    }
  },
  
  sendFeedback: async (messageId, conversationId, type, comment) => {
    try {
      await api.post('/feedback', {
        messageId,
        conversationId,
        type,
        comment,
      });

      set((state) => ({
        feedbacks: {
          ...state.feedbacks,
          [messageId]: { messageId, type, comment },
        },
        toast: {
          message: type === 'positive' 
            ? 'Teşekkürler! Geri bildiriminiz kaydedildi.' 
            : 'Geri bildiriminiz kaydedildi. Daha iyi olmamız için teşekkürler!',
          type: 'success',
          isVisible: true,
        },
      }));

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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [messageId]: _removed, ...rest } = state.feedbacks;
      return { feedbacks: rest };
    }
    return {
      feedbacks: {
        ...state.feedbacks,
        [messageId]: feedback,
      },
    };
  }),

  setDefaultLLMProvider: (provider) => set({ defaultLLMProvider: provider }),
  setDefaultLLMModel: (model) => set({ defaultLLMModel: model }),
});
