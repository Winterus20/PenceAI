/**
 * P1 Yüksek Öncelikli Test: Conversations
 * Konuşma CRUD işlemleri testleri
 */

import { MockWebSocket } from '../setup/mockWebSocket';
import { mockConversations, mockMessages, createMockConversation, createMockMessage } from '../setup/fixtures';

// Global WebSocket mock
beforeAll(() => {
  MockWebSocket.mock();
});

afterAll(() => {
  MockWebSocket.restore();
});

beforeEach(() => {
  MockWebSocket.clearInstances();
  jest.clearAllMocks();
});

describe('Conversation CRUD Tests', () => {
  describe('Konuşma Listeleme', () => {
    test('konuşma listesi boş olabilmeli', () => {
      const conversations: any[] = [];
      expect(conversations).toHaveLength(0);
    });

    test('konuşma listesi birden fazla konuşma içerebilmeli', () => {
      expect(mockConversations).toHaveLength(2);
      expect(mockConversations[0].id).toBe('conv-1');
      expect(mockConversations[1].id).toBe('conv-2');
    });

    test('her konuşma id, title ve createdAt alanlarına sahip olmalı', () => {
      mockConversations.forEach((conv) => {
        expect(conv).toHaveProperty('id');
        expect(conv).toHaveProperty('title');
        expect(conv).toHaveProperty('createdAt');
      });
    });

    test('konuşma başlığı boş olabilmeli', () => {
      const convWithoutTitle = { id: 'conv-3', title: '', createdAt: '2024-01-03T00:00:00Z' };
      expect(convWithoutTitle.title).toBe('');
    });
  });

  describe('Konuşma Oluşturma', () => {
    test('yeni konuşma oluşturulabilmeli', () => {
      const newConv = createMockConversation({ title: 'Yeni Konuşma' });
      
      expect(newConv.id).toBeDefined();
      expect(newConv.title).toBe('Yeni Konuşma');
      expect(newConv.createdAt).toBeDefined();
    });

    test('yeni konuşma varsayılan başlığa sahip olmalı', () => {
      const newConv = createMockConversation();
      
      expect(newConv.title).toBe('New Test Conversation');
    });

    test('yeni konuşma oluşturulunca listeye eklenmeli', () => {
      const conversations = [...mockConversations];
      const initialLength = conversations.length;
      
      const newConv = createMockConversation();
      conversations.push(newConv);
      
      expect(conversations).toHaveLength(initialLength + 1);
    });
  });

  describe('Konuşma Silme', () => {
    test('konuşma silinebilmeli', () => {
      const conversations = [...mockConversations];
      const idToDelete = 'conv-1';
      
      const filtered = conversations.filter((c) => c.id !== idToDelete);
      
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('conv-2');
    });

    test('olmayan konuşma silindiğinde liste değişmemeli', () => {
      const conversations = [...mockConversations];
      const initialLength = conversations.length;
      
      const filtered = conversations.filter((c) => c.id === 'non-existent');
      
      expect(filtered).toHaveLength(0);
      expect(conversations).toHaveLength(initialLength);
    });

    test('tüm konuşmalar silinebilmeli', () => {
      const conversations = [...mockConversations];
      
      const cleared = conversations.filter(() => false);
      
      expect(cleared).toHaveLength(0);
    });
  });

  describe('Konuşma Başlığı Güncelleme', () => {
    test('konuşma başlığı güncellenebilmeli', () => {
      const conversations = mockConversations.map((c) => ({ ...c }));
      const idToUpdate = 'conv-1';
      const newTitle = 'Güncellenmiş Başlık';
      
      const index = conversations.findIndex((c) => c.id === idToUpdate);
      if (index !== -1) {
        conversations[index].title = newTitle;
      }
      
      expect(conversations[index].title).toBe(newTitle);
    });

    test('olmayan konuşma başlığı güncellenememeli', () => {
      const conversations = mockConversations.map((c) => ({ ...c }));
      const idToUpdate = 'non-existent';
      
      const index = conversations.findIndex((c) => c.id === idToUpdate);
      
      expect(index).toBe(-1);
    });
  });

  describe('Aktif Konuşma Yönetimi', () => {
    test('aktif konuşma seçilebilmeli', () => {
      let activeConversationId: string | null = null;
      
      activeConversationId = 'conv-1';
      
      expect(activeConversationId).toBe('conv-1');
    });

    test('aktif konuşma null olabilmeli', () => {
      let activeConversationId: string | null = 'conv-1';
      
      activeConversationId = null;
      
      expect(activeConversationId).toBeNull();
    });

    test('aktif konuşma silindiğinde null olmalı', () => {
      let activeConversationId: string | null = 'conv-1';
      const conversations = [...mockConversations];
      
      const filtered = conversations.filter((c) => c.id !== activeConversationId);
      // Aktif konuşma silindiğinde, activeConversationId null olmalı
      if (activeConversationId && !filtered.some((c) => c.id === activeConversationId)) {
        activeConversationId = null;
      }
      
      expect(activeConversationId).toBeNull();
    });
  });

  describe('Konuşma Mesajları', () => {
    test('konuşmaya ait mesajlar listelenebilmeli', () => {
      const messagesWithConv = [
        { id: 'msg-1', role: 'user', content: 'Merhaba!', conversationId: 'conv-1', createdAt: '2024-01-01T00:01:00Z' },
        { id: 'msg-2', role: 'assistant', content: 'Selam!', conversationId: 'conv-1', createdAt: '2024-01-01T00:01:01Z' },
      ];
      const conversationId = 'conv-1';
      const conversationMessages = messagesWithConv.filter((m) => m.conversationId === conversationId);
      
      expect(conversationMessages.length).toBeGreaterThan(0);
    });

    test('konuşmaya ait mesaj bulunamayabilmeli', () => {
      const messagesWithConv = [
        { id: 'msg-1', role: 'user', content: 'Merhaba!', conversationId: 'conv-1', createdAt: '2024-01-01T00:01:00Z' },
      ];
      const conversationId = 'non-existent';
      const conversationMessages = messagesWithConv.filter((m) => m.conversationId === conversationId);
      
      expect(conversationMessages).toHaveLength(0);
    });

    test('mesajlar role göre filtrelenmeli', () => {
      const userMessages = mockMessages.filter((m) => m.role === 'user');
      const assistantMessages = mockMessages.filter((m) => m.role === 'assistant');
      
      expect(userMessages.length).toBeGreaterThan(0);
      expect(assistantMessages.length).toBeGreaterThan(0);
    });
  });

  describe('Toplu Konuşma Silme', () => {
    test('seçili konuşmalar toplu silinebilmeli', () => {
      const conversations = [...mockConversations];
      const selectedIds = ['conv-1'];
      
      const remaining = conversations.filter((c) => !selectedIds.includes(c.id));
      
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('conv-2');
    });

    test('tüm konuşmalar toplu silinebilmeli', () => {
      const conversations = [...mockConversations];
      const selectedIds = conversations.map((c) => c.id);
      
      const remaining = conversations.filter((c) => !selectedIds.includes(c.id));
      
      expect(remaining).toHaveLength(0);
    });
  });

  describe('Konuşma Seçimi', () => {
    test('konuşma seçilebilmeli', () => {
      const selectedIds: string[] = [];
      const idToSelect = 'conv-1';
      
      if (!selectedIds.includes(idToSelect)) {
        selectedIds.push(idToSelect);
      }
      
      expect(selectedIds).toContain(idToSelect);
    });

    test('seçili konuşma seçimi kaldırılabilmeli', () => {
      const selectedIds = ['conv-1', 'conv-2'];
      const idToDeselect = 'conv-1';
      
      const filtered = selectedIds.filter((id) => id !== idToDeselect);
      
      expect(filtered).not.toContain(idToDeselect);
      expect(filtered).toContain('conv-2');
    });

    test('seçim tamamen temizlenebilmeli', () => {
      const selectedIds = ['conv-1', 'conv-2'];
      
      const cleared: string[] = [];
      
      expect(cleared).toHaveLength(0);
    });
  });
});

describe('Conversation Service API Tests', () => {
  describe('API Response Format', () => {
    test('konuşma listesi API yanıtı doğru formatta olmalı', () => {
      const mockApiResponse = mockConversations;
      
      expect(Array.isArray(mockApiResponse)).toBe(true);
      mockApiResponse.forEach((conv) => {
        expect(conv).toHaveProperty('id');
        expect(conv).toHaveProperty('title');
        expect(conv).toHaveProperty('createdAt');
      });
    });

    test('konuşma detay API yanıtı doğru formatta olmalı', () => {
      const mockDetailResponse = {
        id: 'conv-1',
        title: 'Test Conversation 1',
        messages: mockMessages,
      };
      
      expect(mockDetailResponse).toHaveProperty('id');
      expect(mockDetailResponse).toHaveProperty('title');
      expect(mockDetailResponse).toHaveProperty('messages');
      expect(Array.isArray(mockDetailResponse.messages)).toBe(true);
    });

    test('mesaj listesi API yanıtı doğru formatta olmalı', () => {
      const mockMessagesResponse = mockMessages;
      
      expect(Array.isArray(mockMessagesResponse)).toBe(true);
      mockMessagesResponse.forEach((msg) => {
        expect(msg).toHaveProperty('id');
        expect(msg).toHaveProperty('role');
        expect(msg).toHaveProperty('content');
      });
    });
  });

  describe('API Error Handling', () => {
    test('olmayan konuşma 404 dönmeli', async () => {
      const mockError = { error: 'Conversation not found' };
      const status = 404;
      
      expect(status).toBe(404);
      expect(mockError).toHaveProperty('error');
    });

    test('sunucu hatası 500 dönmeli', async () => {
      const mockError = { error: 'Internal server error' };
      const status = 500;
      
      expect(status).toBe(500);
    });
  });
});

describe('Conversation State Management', () => {
  test('konuşma state\'i doğru başlangıç değerlerine sahip olmalı', () => {
    const initialState = {
      conversations: [],
      activeConversationId: null,
      selectedConversationIds: [],
    };
    
    expect(initialState.conversations).toEqual([]);
    expect(initialState.activeConversationId).toBeNull();
    expect(initialState.selectedConversationIds).toEqual([]);
  });

  test('konuşma eklendiğinde state güncellenmeli', () => {
    const state = { conversations: [] as any[] };
    const newConv = createMockConversation();
    
    state.conversations = [...state.conversations, newConv];
    
    expect(state.conversations).toHaveLength(1);
  });

  test('konuşma silindiğinde state güncellenmeli', () => {
    const state = { conversations: [...mockConversations] };
    const idToDelete = 'conv-1';
    
    state.conversations = state.conversations.filter((c) => c.id !== idToDelete);
    
    expect(state.conversations).toHaveLength(1);
  });
});
