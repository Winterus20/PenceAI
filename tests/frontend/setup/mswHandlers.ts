/**
 * MSW (Mock Service Worker) REST Endpoint Handler'ları
 * Frontend testleri için sahte REST API yanıtları
 */

import { http, HttpResponse } from 'msw';

// Mock veri setleri
let mockConversations = [
  { id: 'conv-1', title: 'Test Conversation 1', createdAt: '2024-01-01T00:00:00Z' },
  { id: 'conv-2', title: 'Test Conversation 2', createdAt: '2024-01-02T00:00:00Z' },
];

let mockMessages: Array<{
  id: string;
  role: string;
  content: string;
  conversationId?: string;
  createdAt: string;
}> = [
  { id: 'msg-1', role: 'user', content: 'Merhaba!', conversationId: 'conv-1', createdAt: '2024-01-01T00:01:00Z' },
  { id: 'msg-2', role: 'assistant', content: 'Merhaba! Size nasıl yardımcı olabilirim?', conversationId: 'conv-1', createdAt: '2024-01-01T00:01:01Z' },
];

let mockMemories = [
  { id: 1, type: 'episodic', content: 'Kullanıcı JavaScript sever', importance: 0.8, createdAt: '2024-01-01T00:00:00Z' },
  { id: 2, type: 'semantic', content: 'React bir UI kütüphanesidir', importance: 0.6, createdAt: '2024-01-02T00:00:00Z' },
];

let mockSettings = {
  defaultLLMProvider: 'openai',
  defaultLLMModel: 'gpt-4',
  defaultUserName: 'Test User',
  openaiApiKey: 'sk-test-key',
  anthropicApiKey: '',
  minimaxApiKey: '',
  githubToken: '',
  groqApiKey: '',
  mistralApiKey: '',
  nvidiaApiKey: '',
  ollamaBaseUrl: 'http://localhost:11434',
  systemPrompt: 'You are a helpful assistant.',
  allowShellExecution: false,
  braveSearchApiKey: '',
  embeddingProvider: 'openai',
  embeddingModel: 'text-embedding-3-small',
  autonomousStepLimit: 5,
  memoryDecayThreshold: 30,
  semanticSearchThreshold: 0.7,
  logLevel: 'info',
  temperature: 0.7,
  maxTokens: 4096,
};

let mockSensitivePaths = ['/api/keys', '/api/settings'];

let mockChannels = [
  { id: 'channel-1', name: 'General', description: 'General channel' },
  { id: 'channel-2', name: 'Development', description: 'Dev discussions' },
];

let mockStats = {
  conversations: 2,
  messages: 10,
  memories: 5,
};

// Handlers
export const handlers = [
  // Health check
  http.get('/api/health', () => {
    return HttpResponse.json({ status: 'ok' });
  }),

  // Konuşmalar - Liste
  http.get('/api/conversations', () => {
    return HttpResponse.json(mockConversations);
  }),

  // Konuşma - Detay
  http.get('/api/conversations/:id', ({ params }) => {
    const { id } = params;
    const conversation = mockConversations.find((c) => c.id === id);
    if (!conversation) {
      return HttpResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    const messages = mockMessages.filter((m) => m.conversationId === id);
    return HttpResponse.json({ ...conversation, messages });
  }),

  // Konuşma - Mesajlar
  http.get('/api/conversations/:id/messages', ({ params }) => {
    const { id } = params;
    const messages = mockMessages.filter((m) => m.conversationId === id);
    return HttpResponse.json(messages);
  }),

  // Konuşma - Sil
  http.delete('/api/conversations/:id', ({ params }) => {
    const { id } = params;
    mockConversations = mockConversations.filter((c) => c.id !== id);
    mockMessages = mockMessages.filter((m) => m.conversationId !== id);
    return new HttpResponse(null, { status: 204 });
  }),

  // Konuşma - Başlık güncelle
  http.patch('/api/conversations/:id', async ({ params, request }) => {
    const { id } = params;
    const body = await request.json() as Record<string, unknown>;
    const index = mockConversations.findIndex((c) => c.id === id);
    if (index === -1) {
      return HttpResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    mockConversations[index] = { ...mockConversations[index], ...body };
    return HttpResponse.json(mockConversations[index]);
  }),

  // Bellekler - Liste
  http.get('/api/memories', () => {
    return HttpResponse.json(mockMemories);
  }),

  // Bellekler - Arama
  http.get('/api/memories/search', ({ request }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('q') || '';
    const results = mockMemories.filter((m) =>
      m.content.toLowerCase().includes(query.toLowerCase())
    );
    return HttpResponse.json(results);
  }),

  // Bellek - Oluştur
  http.post('/api/memories', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    const newMemory = {
      id: mockMemories.length + 1,
      type: 'episodic',
      importance: 0.5,
      createdAt: new Date().toISOString(),
      ...body,
    };
    mockMemories.push(newMemory);
    return HttpResponse.json(newMemory, { status: 201 });
  }),

  // Bellek - Güncelle
  http.put('/api/memories/:id', async ({ params, request }) => {
    const { id } = params;
    const body = await request.json() as Record<string, unknown>;
    const index = mockMemories.findIndex((m) => m.id === Number(id));
    if (index === -1) {
      return HttpResponse.json({ error: 'Memory not found' }, { status: 404 });
    }
    mockMemories[index] = { ...mockMemories[index], ...body };
    return HttpResponse.json(mockMemories[index]);
  }),

  // Bellek - Sil
  http.delete('/api/memories/:id', ({ params }) => {
    const { id } = params;
    mockMemories = mockMemories.filter((m) => m.id !== Number(id));
    return new HttpResponse(null, { status: 204 });
  }),

  // Ayarlar - Get
  http.get('/api/settings', () => {
    return HttpResponse.json(mockSettings);
  }),

  // Ayarlar - Save
  http.post('/api/settings', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    mockSettings = { ...mockSettings, ...body };
    return HttpResponse.json({ success: true });
  }),

  // Hassas Dizinler - Get
  http.get('/api/settings/sensitive-paths', () => {
    return HttpResponse.json(mockSensitivePaths);
  }),

  // Hassas Dizin - Ekle
  http.post('/api/settings/sensitive-paths', async ({ request }) => {
    const body = await request.json() as { path: string };
    if (!mockSensitivePaths.includes(body.path)) {
      mockSensitivePaths.push(body.path);
    }
    return HttpResponse.json(mockSensitivePaths);
  }),

  // Hassas Dizin - Sil
  http.delete('/api/settings/sensitive-paths', async ({ request }) => {
    const body = await request.json() as { path: string };
    mockSensitivePaths = mockSensitivePaths.filter((p) => p !== body.path);
    return HttpResponse.json(mockSensitivePaths);
  }),

  // LLM Providers
  http.get('/api/llm/providers', () => {
    return HttpResponse.json([
      { name: 'openai', models: ['gpt-4', 'gpt-3.5-turbo'] },
      { name: 'anthropic', models: ['claude-3-opus', 'claude-3-sonnet'] },
      { name: 'ollama', models: ['llama3', 'mistral'] },
    ]);
  }),

  // Kanallar
  http.get('/api/channels', () => {
    return HttpResponse.json(mockChannels);
  }),

  // İstatistikler
  http.get('/api/stats', () => {
    return HttpResponse.json(mockStats);
  }),

  // Feedback
  http.post('/api/feedback', async () => {
    return HttpResponse.json({ success: true });
  }),

  // Dosya yükleme
  http.post('/api/upload', async () => {
    return HttpResponse.json({
      success: true,
      file: {
        name: 'test.txt',
        size: 1024,
        mimeType: 'text/plain',
      },
    });
  }),

  // Graph verisi
  http.get('/api/memory/graph', () => {
    return HttpResponse.json({
      nodes: [
        { id: 'node-1', label: 'JavaScript', type: 'concept', weight: 0.8 },
        { id: 'node-2', label: 'React', type: 'library', weight: 0.9 },
      ],
      links: [
        { source: 'node-1', target: 'node-2', weight: 0.6 },
      ],
    });
  }),
];

// Test verilerini sıfırlama fonksiyonu
export function resetMockData() {
  mockConversations = [
    { id: 'conv-1', title: 'Test Conversation 1', createdAt: '2024-01-01T00:00:00Z' },
    { id: 'conv-2', title: 'Test Conversation 2', createdAt: '2024-01-02T00:00:00Z' },
  ];

  mockMessages = [
    { id: 'msg-1', role: 'user', content: 'Merhaba!', conversationId: 'conv-1', createdAt: '2024-01-01T00:01:00Z' },
    { id: 'msg-2', role: 'assistant', content: 'Merhaba! Size nasıl yardımcı olabilirim?', conversationId: 'conv-1', createdAt: '2024-01-01T00:01:01Z' },
  ];

  mockMemories = [
    { id: 1, type: 'episodic', content: 'Kullanıcı JavaScript sever', importance: 0.8, createdAt: '2024-01-01T00:00:00Z' },
    { id: 2, type: 'semantic', content: 'React bir UI kütüphanesidir', importance: 0.6, createdAt: '2024-01-02T00:00:00Z' },
  ];

  mockSettings = {
    defaultLLMProvider: 'openai',
    defaultLLMModel: 'gpt-4',
    defaultUserName: 'Test User',
    openaiApiKey: 'sk-test-key',
    anthropicApiKey: '',
    minimaxApiKey: '',
    githubToken: '',
    groqApiKey: '',
    mistralApiKey: '',
    nvidiaApiKey: '',
    ollamaBaseUrl: 'http://localhost:11434',
    systemPrompt: 'You are a helpful assistant.',
    allowShellExecution: false,
    braveSearchApiKey: '',
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
    autonomousStepLimit: 5,
    memoryDecayThreshold: 30,
    semanticSearchThreshold: 0.7,
    logLevel: 'info',
    temperature: 0.7,
    maxTokens: 4096,
  };

  mockSensitivePaths = ['/api/keys', '/api/settings'];
  mockChannels = [
    { id: 'channel-1', name: 'General', description: 'General channel' },
    { id: 'channel-2', name: 'Development', description: 'Dev discussions' },
  ];
  mockStats = { conversations: 2, messages: 10, memories: 5 };
}
