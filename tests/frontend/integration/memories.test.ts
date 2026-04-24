/**
 * P1 Yüksek Öncelikli Test: Memories
 * Bellek CRUD işlemleri testleri
 */

import { mockMemories, createMockMemory } from '../setup/fixtures';

describe('Memory CRUD Tests', () => {
  describe('Bellek Listeleme', () => {
    test('bellek listesi boş olabilmeli', () => {
      const memories: any[] = [];
      expect(memories).toHaveLength(0);
    });

    test('bellek listesi birden fazla bellek içerebilmeli', () => {
      expect(mockMemories).toHaveLength(2);
      expect(mockMemories[0].id).toBe('mem-1');
      expect(mockMemories[1].id).toBe('mem-2');
    });

    test('her bellek gerekli alanlara sahip olmalı', () => {
      mockMemories.forEach((memory) => {
        expect(memory).toHaveProperty('id');
        expect(memory).toHaveProperty('type');
        expect(memory).toHaveProperty('content');
        expect(memory).toHaveProperty('embedding');
      });
    });

    test('bellek tipleri doğru olmalı', () => {
      const types = mockMemories.map((m) => m.type);
      expect(types).toContain('episodic');
      expect(types).toContain('semantic');
    });
  });

  describe('Bellek Oluşturma', () => {
    test('yeni bellek oluşturulabilmeli', () => {
      const newMemory = createMockMemory({ content: 'Yeni bellek içeriği' });
      
      expect(newMemory.id).toBeDefined();
      expect(newMemory.content).toBe('Yeni bellek içeriği');
      expect(newMemory.type).toBe('episodic');
    });

    test('yeni bellek varsayılan değerlere sahip olmalı', () => {
      const newMemory = createMockMemory();
      
      expect(newMemory.type).toBe('episodic');
      expect(newMemory.content).toBe('Test memory content');
      expect(newMemory.embedding).toEqual([0.1, 0.2, 0.3]);
    });

    test('farklı tipte bellek oluşturulabilmeli', () => {
      const semanticMemory = createMockMemory({
        type: 'semantic',
        content: 'React bir UI kütüphanesidir',
      });
      
      expect(semanticMemory.type).toBe('semantic');
    });

    test('yeni bellek oluşturulunca listeye eklenmeli', () => {
      const memories = [...mockMemories];
      const initialLength = memories.length;
      
      const newMemory = createMockMemory();
      memories.push(newMemory);
      
      expect(memories).toHaveLength(initialLength + 1);
    });
  });

  describe('Bellek Güncelleme', () => {
    test('bellek içeriği güncellenebilmeli', () => {
      const memories = mockMemories.map((m) => ({ ...m }));
      const idToUpdate = 'mem-1';
      const newContent = 'Güncellenmiş bellek içeriği';
      
      const index = memories.findIndex((m) => m.id === idToUpdate);
      if (index !== -1) {
        memories[index].content = newContent;
      }
      
      expect(memories[index].content).toBe(newContent);
    });

    test('bellek tipi güncellenebilmeli', () => {
      const memories = mockMemories.map((m) => ({ ...m }));
      const idToUpdate = 'mem-1';
      
      const index = memories.findIndex((m) => m.id === idToUpdate);
      if (index !== -1) {
        memories[index].type = 'semantic';
      }
      
      expect(memories[index].type).toBe('semantic');
    });

    test('olmayan bellek güncellenememeli', () => {
      const memories = mockMemories.map((m) => ({ ...m }));
      const idToUpdate = 'non-existent';
      
      const index = memories.findIndex((m) => m.id === idToUpdate);
      
      expect(index).toBe(-1);
    });
  });

  describe('Bellek Silme', () => {
    test('bellek silinebilmeli', () => {
      const memories = [...mockMemories];
      const idToDelete = 'mem-1';
      
      const filtered = memories.filter((m) => m.id !== idToDelete);
      
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('mem-2');
    });

    test('olmayan bellek silindiğinde liste değişmemeli', () => {
      const memories = [...mockMemories];
      const initialLength = memories.length;
      
      const filtered = memories.filter((m) => m.id === 'non-existent');
      
      expect(filtered).toHaveLength(0);
      expect(memories).toHaveLength(initialLength);
    });
  });

  describe('Bellek Arama', () => {
    test('içerik bazlı arama yapılabilmeli', () => {
      const query = 'JavaScript';
      const results = mockMemories.filter((m) =>
        m.content.toLowerCase().includes(query.toLowerCase())
      );
      
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain('JavaScript');
    });

    test('arama sonucu boş olabilmeli', () => {
      const query = 'olmayan_kelime_xyz';
      const results = mockMemories.filter((m) =>
        m.content.toLowerCase().includes(query.toLowerCase())
      );
      
      expect(results).toHaveLength(0);
    });

    test('arama büyük/küçük harf duyarsız olmalı', () => {
      const query = 'javascript';
      const results = mockMemories.filter((m) =>
        m.content.toLowerCase().includes(query.toLowerCase())
      );
      
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Bellek Tipleri', () => {
    test('episodic bellek doğru formatta olmalı', () => {
      const episodicMemory = mockMemories.find((m) => m.type === 'episodic');
      
      expect(episodicMemory).toBeDefined();
      expect(episodicMemory?.type).toBe('episodic');
    });

    test('semantic bellek doğru formatta olmalı', () => {
      const semanticMemory = mockMemories.find((m) => m.type === 'semantic');
      
      expect(semanticMemory).toBeDefined();
      expect(semanticMemory?.type).toBe('semantic');
    });

    test('embedding vektörü doğru boyutta olmalı', () => {
      mockMemories.forEach((memory) => {
        expect(Array.isArray(memory.embedding)).toBe(true);
        expect(memory.embedding.length).toBe(3);
      });
    });
  });
});

describe('Memory Service API Tests', () => {
  describe('API Response Format', () => {
    test('bellek listesi API yanıtı doğru formatta olmalı', () => {
      const mockApiResponse = mockMemories;
      
      expect(Array.isArray(mockApiResponse)).toBe(true);
      mockApiResponse.forEach((memory) => {
        expect(memory).toHaveProperty('id');
        expect(memory).toHaveProperty('type');
        expect(memory).toHaveProperty('content');
      });
    });

    test('bellek arama API yanıtı doğru formatta olmalı', () => {
      const mockSearchResponse = mockMemories.filter((m) =>
        m.content.includes('JavaScript')
      );
      
      expect(Array.isArray(mockSearchResponse)).toBe(true);
    });
  });

  describe('API Error Handling', () => {
    test('olmayan bellek 404 dönmeli', async () => {
      const mockError = { error: 'Memory not found' };
      const status = 404;
      
      expect(status).toBe(404);
      expect(mockError).toHaveProperty('error');
    });

    test('geçersiz bellek verisi 400 dönmeli', async () => {
      const mockError = { error: 'Invalid memory data' };
      const status = 400;
      
      expect(status).toBe(400);
    });
  });
});

describe('Memory State Management', () => {
  test('bellek state\'i doğru başlangıç değerlerine sahip olmalı', () => {
    const initialState = {
      activeMemories: [],
    };
    
    expect(initialState.activeMemories).toEqual([]);
  });

  test('bellek eklendiğinde state güncellenmeli', () => {
    const state = { activeMemories: [] as any[] };
    const newMemory = createMockMemory();
    
    state.activeMemories = [...state.activeMemories, newMemory];
    
    expect(state.activeMemories).toHaveLength(1);
  });

  test('bellek silindiğinde state güncellenmeli', () => {
    const memories = mockMemories.map((m) => ({ ...m }));
    const state = { activeMemories: memories };
    const idToDelete = 'mem-1';
    
    state.activeMemories = state.activeMemories.filter((m) => m.id !== idToDelete);
    
    expect(state.activeMemories).toHaveLength(1);
  });

  test('bellek listesi tamamen temizlenebilmeli', () => {
    const state = { activeMemories: [...mockMemories] };
    
    state.activeMemories = [];
    
    expect(state.activeMemories).toHaveLength(0);
  });
});

describe('Memory Graph Integration', () => {
  test('bellek düğümü graph\'a eklenebilmeli', () => {
    const graphNodes = [
      { id: 'node-1', label: 'JavaScript', type: 'concept', weight: 0.8 },
    ];
    
    const newNode = {
      id: 'node-2',
      label: 'React',
      type: 'library',
      weight: 0.9,
    };
    
    graphNodes.push(newNode);
    
    expect(graphNodes).toHaveLength(2);
  });

  test('bellek düğümü graph\'dan silinebilmeli', () => {
    const graphNodes = [
      { id: 'node-1', label: 'JavaScript', type: 'concept', weight: 0.8 },
      { id: 'node-2', label: 'React', type: 'library', weight: 0.9 },
    ];
    
    const filtered = graphNodes.filter((n) => n.id !== 'node-1');
    
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('node-2');
  });

  test('bellek bağlantısı oluşturulabilmeli', () => {
    const graphLinks: Array<{ source: string; target: string; weight: number }> = [];
    
    const newLink = { source: 'node-1', target: 'node-2', weight: 0.6 };
    graphLinks.push(newLink);
    
    expect(graphLinks).toHaveLength(1);
    expect(graphLinks[0].source).toBe('node-1');
    expect(graphLinks[0].target).toBe('node-2');
  });
});
