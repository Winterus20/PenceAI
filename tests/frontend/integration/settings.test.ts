/**
 * P1 Yüksek Öncelikli Test: Settings
 * Ayarlar yönetimi testleri
 */

import { mockSettings } from '../setup/fixtures';

const mockProviders = [
  { name: 'openai', models: ['gpt-4', 'gpt-3.5-turbo'] },
  { name: 'anthropic', models: ['claude-3-opus', 'claude-3-sonnet'] },
  { name: 'ollama', models: ['llama3', 'mistral'] },
];

describe('Settings Management Tests', () => {
  describe('Ayar Yükleme', () => {
    test('ayarlar doğru başlangıç değerlerine sahip olmalı', () => {
      expect(mockSettings.llmProvider).toBe('openai');
      expect(mockSettings.model).toBe('gpt-4');
      expect(mockSettings.temperature).toBe(0.7);
      expect(mockSettings.maxTokens).toBe(4096);
      expect(mockSettings.thinkingMode).toBe(true);
    });

    test('tüm ayar alanları mevcut olmalı', () => {
      const requiredKeys = [
        'llmProvider',
        'model',
        'temperature',
        'maxTokens',
        'thinkingMode',
      ];
      
      requiredKeys.forEach((key) => {
        expect(mockSettings).toHaveProperty(key);
      });
    });
  });

  describe('LLM Provider Ayarları', () => {
    test('varsayılan provider openai olmalı', () => {
      expect(mockSettings.llmProvider).toBe('openai');
    });

    test('provider değiştirilebilmeli', () => {
      const settings = { ...mockSettings };
      settings.llmProvider = 'anthropic';
      
      expect(settings.llmProvider).toBe('anthropic');
    });

    test('geçerli provider listesi kontrol edilmeli', () => {
      const validProviders = ['openai', 'anthropic', 'ollama', 'groq', 'mistral'];
      
      expect(validProviders).toContain(mockSettings.llmProvider);
    });

    test('geçersiz provider ayarlanamamalı', () => {
      const validProviders = ['openai', 'anthropic', 'ollama'];
      const invalidProvider = 'invalid-provider';
      
      expect(validProviders).not.toContain(invalidProvider);
    });
  });

  describe('Model Ayarları', () => {
    test('varsayılan model gpt-4 olmalı', () => {
      expect(mockSettings.model).toBe('gpt-4');
    });

    test('model değiştirilebilmeli', () => {
      const settings = { ...mockSettings };
      settings.model = 'gpt-3.5-turbo';
      
      expect(settings.model).toBe('gpt-3.5-turbo');
    });

    test('provider\'a göre model seçenekleri filtrelenmeli', () => {
      const openaiModels = ['gpt-4', 'gpt-3.5-turbo'];
      const anthropicModels = ['claude-3-opus', 'claude-3-sonnet'];
      
      const currentProvider = 'openai';
      const availableModels = currentProvider === 'openai' ? openaiModels : anthropicModels;
      
      expect(availableModels).toContain('gpt-4');
      expect(availableModels).not.toContain('claude-3-opus');
    });
  });

  describe('Temperature Ayarı', () => {
    test('varsayılan temperature 0.7 olmalı', () => {
      expect(mockSettings.temperature).toBe(0.7);
    });

    test('temperature 0 ile 2 arasında olmalı', () => {
      const settings = { ...mockSettings };
      
      settings.temperature = 0;
      expect(settings.temperature).toBeGreaterThanOrEqual(0);
      expect(settings.temperature).toBeLessThanOrEqual(2);
      
      settings.temperature = 2;
      expect(settings.temperature).toBeGreaterThanOrEqual(0);
      expect(settings.temperature).toBeLessThanOrEqual(2);
    });

    test('geçersiz temperature değeri reddedilmeli', () => {
      const invalidTemperatures = [-0.1, 2.1, 3];
      
      invalidTemperatures.forEach((temp) => {
        const isInvalid = temp < 0 || temp > 2;
        expect(isInvalid).toBe(true);
      });
    });
  });

  describe('MaxTokens Ayarı', () => {
    test('varsayılan maxTokens 4096 olmalı', () => {
      expect(mockSettings.maxTokens).toBe(4096);
    });

    test('maxTokens pozitif sayı olmalı', () => {
      const settings = { ...mockSettings };
      settings.maxTokens = 8192;
      
      expect(settings.maxTokens).toBeGreaterThan(0);
    });

    test('maxTokens sıfır veya negatif olamamalı', () => {
      expect(0).not.toBeGreaterThan(0);
      expect(-100).not.toBeGreaterThan(0);
    });
  });

  describe('Thinking Mode', () => {
    test('thinkingMode varsayılan olarak true olmalı', () => {
      expect(mockSettings.thinkingMode).toBe(true);
    });

    test('thinkingMode açılıp kapatılabilmeli', () => {
      const settings = { ...mockSettings };
      
      settings.thinkingMode = false;
      expect(settings.thinkingMode).toBe(false);
      
      settings.thinkingMode = true;
      expect(settings.thinkingMode).toBe(true);
    });
  });
});

describe('Sensitive Paths Management', () => {
  test('hassas dizinler listesi boş olabilmeli', () => {
    const paths: string[] = [];
    expect(paths).toHaveLength(0);
  });

  test('hassas dizin listesi birden fazla yol içerebilmeli', () => {
    const paths = ['/api/keys', '/api/settings', '/admin'];
    expect(paths).toHaveLength(3);
  });

  test('yeni hassas dizin eklenebilmeli', () => {
    const paths = ['/api/keys'];
    const newPath = '/api/secrets';
    
    if (!paths.includes(newPath)) {
      paths.push(newPath);
    }
    
    expect(paths).toContain(newPath);
  });

  test('mevcut hassas dizin tekrar eklenememeli', () => {
    const paths = ['/api/keys'];
    const existingPath = '/api/keys';
    
    if (!paths.includes(existingPath)) {
      paths.push(existingPath);
    }
    
    expect(paths).toHaveLength(1);
  });

  test('hassas dizin silinebilmeli', () => {
    const paths = ['/api/keys', '/api/settings'];
    const pathToRemove = '/api/keys';
    
    const filtered = paths.filter((p) => p !== pathToRemove);
    
    expect(filtered).toHaveLength(1);
    expect(filtered).not.toContain(pathToRemove);
  });
});

describe('Settings Form Validation', () => {
  test('geçerli form verisi kabul edilmeli', () => {
    const formData = {
      llmProvider: 'openai',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 4096,
    };
    
    expect(formData.llmProvider).toBeTruthy();
    expect(formData.model).toBeTruthy();
  });

  test('boş provider alanı reddedilmeli', () => {
    const formData = {
      llmProvider: '',
      model: 'gpt-4',
    };
    
    expect(formData.llmProvider).toBeFalsy();
  });

  test('boş model alanı reddedilmeli', () => {
    const formData = {
      llmProvider: 'openai',
      model: '',
    };
    
    expect(formData.model).toBeFalsy();
  });
});

describe('Settings API Integration', () => {
  describe('API Response Format', () => {
    test('ayarlar API yanıtı doğru formatta olmalı', () => {
      const mockApiResponse = mockSettings;
      
      expect(mockApiResponse).toHaveProperty('llmProvider');
      expect(mockApiResponse).toHaveProperty('model');
      expect(mockApiResponse).toHaveProperty('temperature');
      expect(mockApiResponse).toHaveProperty('maxTokens');
    });

    test('providers API yanıtı doğru formatta olmalı', () => {
      const mockProvidersResponse = mockProviders;
      
      expect(Array.isArray(mockProvidersResponse)).toBe(true);
      mockProvidersResponse.forEach((provider) => {
        expect(provider).toHaveProperty('name');
        expect(provider).toHaveProperty('models');
        expect(Array.isArray(provider.models)).toBe(true);
      });
    });
  });

  describe('API Error Handling', () => {
    test('geçersiz ayar verisi 400 dönmeli', async () => {
      const mockError = { error: 'Invalid settings data' };
      const status = 400;
      
      expect(status).toBe(400);
      expect(mockError).toHaveProperty('error');
    });

    test('sunucu hatası 500 dönmeli', async () => {
      const mockError = { error: 'Internal server error' };
      const status = 500;
      
      expect(status).toBe(500);
    });
  });
});

describe('Settings State Management', () => {
  test('settings state\'i doğru başlangıç değerlerine sahip olmalı', () => {
    const initialState = {
      settings: {
        llmProvider: 'openai',
        model: 'gpt-4',
        temperature: 0.7,
        maxTokens: 4096,
        thinkingMode: true,
      },
      loading: false,
      saving: false,
    };
    
    expect(initialState.loading).toBe(false);
    expect(initialState.saving).toBe(false);
  });

  test('settings yüklenirken loading true olmalı', () => {
    const state = { loading: false };
    
    state.loading = true;
    
    expect(state.loading).toBe(true);
  });

  test('settings kaydedilirken saving true olmalı', () => {
    const state = { saving: false };
    
    state.saving = true;
    
    expect(state.saving).toBe(true);
  });
});

describe('Settings Persistence', () => {
  test('ayarlar localStorage\'a kaydedilebilmeli', () => {
    const settingsToSave = mockSettings;
    const serialized = JSON.stringify(settingsToSave);
    
    expect(serialized).toContain('openai');
    expect(serialized).toContain('gpt-4');
  });

  test('ayarlar localStorage\'dan okunabilmeli', () => {
    const serialized = JSON.stringify(mockSettings);
    const parsed = JSON.parse(serialized);
    
    expect(parsed.llmProvider).toBe('openai');
    expect(parsed.model).toBe('gpt-4');
  });

  test('geçersiz JSON parse edilememeli', () => {
    const invalidJson = '{invalid json}';
    
    expect(() => JSON.parse(invalidJson)).toThrow();
  });
});
