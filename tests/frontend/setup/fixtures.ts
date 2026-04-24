/**
 * Test Fixture'ları
 * Mock kullanıcı, konuşma, mesaj, bellek ve ayar verileri
 */

// Mock kullanıcı
export const mockUser = { id: 'user-1', name: 'Test User' };

// Mock konuşmalar
export const mockConversations = [
  { id: 'conv-1', title: 'Test Conversation 1', createdAt: '2024-01-01T00:00:00Z' },
  { id: 'conv-2', title: 'Test Conversation 2', createdAt: '2024-01-02T00:00:00Z' },
];

// Mock mesajlar
export const mockMessages = [
  { id: 'msg-1', role: 'user', content: 'Merhaba!', createdAt: '2024-01-01T00:01:00Z' },
  { id: 'msg-2', role: 'assistant', content: 'Merhaba! Size nasıl yardımcı olabilirim?', createdAt: '2024-01-01T00:01:01Z' },
];

// Mock bellekler
export const mockMemories = [
  { id: 'mem-1', type: 'episodic', content: 'Kullanıcı JavaScript sever', embedding: [0.1, 0.2, 0.3] },
  { id: 'mem-2', type: 'semantic', content: 'React bir UI kütüphanesidir', embedding: [0.4, 0.5, 0.6] },
];

// Mock ayarlar
export const mockSettings = {
  llmProvider: 'openai',
  model: 'gpt-4',
  temperature: 0.7,
  maxTokens: 4096,
  thinkingMode: true,
};

// Mock istatistikler
export const mockStats = {
  conversations: 2,
  messages: 10,
  memories: 5,
};

// Mock graph düğümleri
export const mockGraphNodes = [
  { id: 'node-1', label: 'JavaScript', type: 'concept', weight: 0.8 },
  { id: 'node-2', label: 'React', type: 'library', weight: 0.9 },
  { id: 'node-3', label: 'TypeScript', type: 'language', weight: 0.7 },
];

// Mock graph bağlantıları
export const mockGraphLinks = [
  { source: 'node-1', target: 'node-2', weight: 0.6 },
  { source: 'node-1', target: 'node-3', weight: 0.8 },
  { source: 'node-2', target: 'node-3', weight: 0.5 },
];

// Mock tool call
export const mockToolCall = {
  name: 'read_file',
  arguments: { path: '/test/file.txt' },
  status: 'running' as const,
  result: null,
  isError: false,
};

// Mock onay isteği
export const mockConfirmRequest = {
  type: 'confirm_request',
  id: 'confirm-1',
  toolName: 'execute_command',
  path: '/test',
  operation: 'execute',
  description: 'Run test command',
};

// Mock kanal
export const mockChannels = [
  { id: 'channel-1', name: 'General', description: 'General channel' },
  { id: 'channel-2', name: 'Development', description: 'Dev discussions' },
];

// Mock dosya eki
export const mockAttachment = {
  fileName: 'test.txt',
  mimeType: 'text/plain',
  size: 1024,
  data: 'base64encodeddata',
};

// Mock LLM provider
export const mockProviders = [
  { name: 'openai', models: ['gpt-4', 'gpt-3.5-turbo'] },
  { name: 'anthropic', models: ['claude-3-opus', 'claude-3-sonnet'] },
  { name: 'ollama', models: ['llama3', 'mistral'] },
];

// Helper: Yeni konuşma oluştur
export function createMockConversation(overrides: Partial<typeof mockConversations[0]> = {}) {
  return {
    id: `conv-${Date.now()}`,
    title: 'New Test Conversation',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// Helper: Yeni mesaj oluştur
export function createMockMessage(overrides: Partial<typeof mockMessages[0]> = {}) {
  return {
    id: `msg-${Date.now()}`,
    role: 'user',
    content: 'Test message',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// Helper: Yeni bellek oluştur
export function createMockMemory(overrides: Partial<typeof mockMemories[0]> = {}) {
  return {
    id: `mem-${Date.now()}`,
    type: 'episodic',
    content: 'Test memory content',
    embedding: [0.1, 0.2, 0.3],
    ...overrides,
  };
}
