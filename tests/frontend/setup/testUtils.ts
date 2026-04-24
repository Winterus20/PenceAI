/**
 * Ortak Test Utility Fonksiyonları
 * Frontend testleri için yardımcı fonksiyonlar
 */

import { useAgentStore } from '../../src/web/react-app/src/store/agentStore';

/**
 * Zustand store'u test modunda sıfırla
 * Persist'i devre dışı bırakır ve store'u temizler
 */
export function resetAgentStore() {
  const store = useAgentStore.getState();
  
  // Store'u varsayılan değerlere sıfırla
  useAgentStore.setState({
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
    userName: '',
    sensitivePaths: [],
    channels: [],
    selectedChannel: null,
    feedbacks: {},
    theme: 'dark',
    onboardingCompleted: true,
    memoryGraphPhase: 'disabled',
  });
}

/**
 * Store'a mock konuşmaları yükle
 */
export function loadMockConversations(conversations: any[]) {
  useAgentStore.setState({ conversations });
}

/**
 * Store'a mock mesajları yükle
 */
export function loadMockMessages(messages: any[]) {
  useAgentStore.setState({ messages });
}

/**
 * Aktif konuşmayı ayarla
 */
export function setActiveConversation(id: string | null) {
  useAgentStore.setState({ activeConversationId: id });
}

/**
 * Bağlantı durumunu ayarla
 */
export function setConnectionStatus(connected: boolean) {
  useAgentStore.setState({ isConnected: connected });
}

/**
 * Test için bekleme fonksiyonu
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Async işlem tamamlanana kadar bekle
 */
export async function waitFor(condition: () => boolean, timeoutMs: number = 5000, intervalMs: number = 50): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (condition()) {
      return;
    }
    await wait(intervalMs);
  }
  throw new Error(`waitFor timeout after ${timeoutMs}ms`);
}

/**
 * Mock fetch implementasyonu
 */
export function createMockFetch(responses: Record<string, { ok?: boolean; json?: any; text?: string; status?: number }>) {
  return jest.fn(async (url: string, options?: RequestInit) => {
    const response = responses[url];
    if (!response) {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' }),
        text: async () => 'Not found',
      };
    }

    return {
      ok: response.ok !== false,
      status: response.status || 200,
      json: async () => response.json,
      text: async () => response.text || JSON.stringify(response.json),
    };
  });
}

/**
 * Console error/warn mesajlarını bastır
 */
export function suppressConsole() {
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalLog = console.log;

  console.error = jest.fn();
  console.warn = jest.fn();
  console.log = jest.fn();

  return () => {
    console.error = originalError;
    console.warn = originalWarn;
    console.log = originalLog;
  };
}

/**
 * Toast mesajlarını mock'la
 */
export function mockToast() {
  const mockToast = {
    success: jest.fn(),
    error: jest.fn(),
    loading: jest.fn(),
    dismiss: jest.fn(),
  };

  jest.doMock('react-hot-toast', () => mockToast);
  return mockToast;
}

/**
 * Event dispatch simülasyonu
 */
export function dispatchEvent(event: Event) {
  window.dispatchEvent(event);
}

/**
 * ResizeObserver mock'u
 */
export function mockResizeObserver() {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

/**
 * IntersectionObserver mock'u
 */
export function mockIntersectionObserver() {
  global.IntersectionObserver = class IntersectionObserver {
    root: Element | null = null;
    rootMargin: string = '';
    thresholds: ReadonlyArray<number> = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  };
}

/**
 * crypto.randomUUID mock'u
 */
export function mockCryptoRandomUUID() {
  let uuidCounter = 0;
  global.crypto.randomUUID = () => `mock-uuid-${++uuidCounter}`;
  return () => {
    uuidCounter = 0;
  };
}

/**
 * Test için fake timer başlat
 */
export function setupFakeTimers() {
  jest.useFakeTimers();
}

/**
 * Fake timer'ları temizle
 */
export function teardownFakeTimers() {
  jest.useRealTimers();
}

/**
 * Message oluştur helper
 */
export function createTestMessage(overrides: Partial<any> = {}) {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    role: 'user',
    content: 'Test message',
    timestamp: new Date().toISOString(),
    pending: false,
    ...overrides,
  };
}

/**
 * Conversation oluştur helper
 */
export function createTestConversation(overrides: Partial<any> = {}) {
  return {
    id: `conv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    title: 'Test Conversation',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Memory oluştur helper
 */
export function createTestMemory(overrides: Partial<any> = {}) {
  return {
    id: Date.now(),
    type: 'episodic',
    content: 'Test memory content',
    importance: 0.5,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}
