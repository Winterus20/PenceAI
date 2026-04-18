import type { StateCreator } from 'zustand';
import type { AgentState, UISlice } from '../types';

export const createUISlice: StateCreator<
  AgentState,
  [['zustand/persist', unknown]],
  [],
  UISlice
> = (set) => ({
  activeView: 'chat',
  confirmRequest: null,
  theme: 'dark',
  lightbox: { imageUrl: null, imageAlt: '' },
  toast: { message: '', type: 'info', isVisible: false },
  canvasArtifact: null,
  isCommandPaletteOpen: false,

  setActiveView: (view) => set({ activeView: view }),
  setConfirmRequest: (request) => set({ confirmRequest: request }),
  
  setTheme: (theme) => set({ theme }),
  toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
  
  openLightbox: (url, alt = '') => set({ lightbox: { imageUrl: url, imageAlt: alt } }),
  closeLightbox: () => set({ lightbox: { imageUrl: null, imageAlt: '' } }),
  
  showToast: (message, type = 'info') => set({
    toast: { message, type, isVisible: true },
  }),
  hideToast: () => set({
    toast: { message: '', type: 'info', isVisible: false },
  }),
  setCanvasArtifact: (artifact) => set({ canvasArtifact: artifact }),
  toggleCommandPalette: () => set((state) => ({ isCommandPaletteOpen: !state.isCommandPaletteOpen })),
});

