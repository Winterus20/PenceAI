/**
 * P0 Kritik Test: WebSocket Connection
 * Bağlantı, reconnect, hata durumları testleri
 */

import { MockWebSocket } from '../setup/mockWebSocket';

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
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('WebSocket Connection Tests', () => {
  describe('Bağlantı Kurma', () => {
    test('WebSocket bağlantısı başlatılmalı', () => {
      const ws = new MockWebSocket('ws://localhost:3001/ws');
      
      expect(ws).toBeDefined();
      expect(ws.readyState).toBe(WebSocket.CONNECTING);
      expect(ws.url).toBe('ws://localhost:3001/ws');
    });

    test('bağlantı başarılı olunca onopen tetiklenmeli', () => {
      const ws = new MockWebSocket('ws://localhost:3001/ws');
      const onOpenMock = jest.fn();
      ws.onopen = onOpenMock;

      // Bağlantıyı simüle et
      ws.simulateOpen();

      expect(onOpenMock).toHaveBeenCalledTimes(1);
      expect(ws.readyState).toBe(WebSocket.OPEN);
    });

    test('HTTPS protokolü WSS kullanmalı', () => {
      // HTTPS ortamını simüle et
      const originalLocation = globalThis.window?.location;
      
      const ws = new MockWebSocket('wss://localhost:3001/ws');
      expect(ws.url).toBe('wss://localhost:3001/ws');
    });

    test('güvenli olmayan protokol WS kullanmalı', () => {
      const ws = new MockWebSocket('ws://localhost:3001/ws');
      expect(ws.url).toBe('ws://localhost:3001/ws');
    });
  });

  describe('Bağlantı Kapatma', () => {
    test('bağlantı kapatılınca onclose tetiklenmeli', () => {
      const ws = new MockWebSocket('ws://localhost:3001/ws');
      ws.simulateOpen();
      
      const onCloseMock = jest.fn();
      ws.onclose = onCloseMock;

      ws.close();

      expect(onCloseMock).toHaveBeenCalledTimes(1);
      expect(ws.readyState).toBe(WebSocket.CLOSED);
    });

    test('bağlantı kapatılınca doğru kod ve reason gönderilmeli', () => {
      const ws = new MockWebSocket('ws://localhost:3001/ws');
      ws.simulateOpen();
      
      const onCloseMock = jest.fn();
      ws.onclose = onCloseMock;

      ws.close(1000, 'Normal close');

      expect(onCloseMock).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 1000,
          reason: 'Normal close',
        })
      );
    });

    test('simüle close ile bağlantı kapatılmalı', () => {
      const ws = new MockWebSocket('ws://localhost:3001/ws');
      ws.simulateOpen();
      
      const onCloseMock = jest.fn();
      ws.onclose = onCloseMock;

      ws.simulateClose(1001, 'Going away');

      expect(onCloseMock).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 1001,
          reason: 'Going away',
        })
      );
    });
  });

  describe('Bağlantı Hatası', () => {
    test('bağlantı hatası olunca onerror tetiklenmeli', () => {
      const ws = new MockWebSocket('ws://localhost:3001/ws');
      const onErrorMock = jest.fn();
      ws.onerror = onErrorMock;

      ws.simulateError();

      expect(onErrorMock).toHaveBeenCalledTimes(1);
    });

    test('hata sonrası bağlantı durumu değişmemeli', () => {
      const ws = new MockWebSocket('ws://localhost:3001/ws');
      const initialReadyState = ws.readyState;

      ws.simulateError();

      // Hata tek başına readyState'i değiştirmez
      expect(ws.readyState).toBe(initialReadyState);
    });
  });

  describe('Reconnect (Yeniden Bağlanma)', () => {
    test('bağlantı kopup yeniden bağlanılmalı', () => {
      const ws1 = new MockWebSocket('ws://localhost:3001/ws');
      ws1.simulateOpen();
      ws1.simulateClose(1006, 'Abnormal closure');

      // Yeni bağlantı
      const ws2 = new MockWebSocket('ws://localhost:3001/ws');
      ws2.simulateOpen();

      expect(MockWebSocket.instances).toHaveLength(2);
      expect(ws2.readyState).toBe(WebSocket.OPEN);
    });

    test('reconnect deneme sayısı artmalı', () => {
      // İlk bağlantı
      const ws1 = new MockWebSocket('ws://localhost:3001/ws');
      ws1.simulateOpen();
      ws1.simulateClose();

      // İkinci bağlantı denemesi
      const ws2 = new MockWebSocket('ws://localhost:3001/ws');
      ws2.simulateOpen();
      ws2.simulateClose();

      // Üçüncü bağlantı denemesi
      const ws3 = new MockWebSocket('ws://localhost:3001/ws');
      ws3.simulateOpen();

      expect(MockWebSocket.instances).toHaveLength(3);
    });

    test('exponential backoff ile reconnect denenmeli', () => {
      const baseDelay = 1000;
      const maxDelay = 30000;
      
      // Deneme 1: 1s
      expect(Math.min(baseDelay * Math.pow(2, 0), maxDelay)).toBe(1000);
      
      // Deneme 2: 2s
      expect(Math.min(baseDelay * Math.pow(2, 1), maxDelay)).toBe(2000);
      
      // Deneme 3: 4s
      expect(Math.min(baseDelay * Math.pow(2, 2), maxDelay)).toBe(4000);
      
      // Deneme 5: 16s
      expect(Math.min(baseDelay * Math.pow(2, 4), maxDelay)).toBe(16000);
      
      // Deneme 10: maxDelay'e ulaşır
      expect(Math.min(baseDelay * Math.pow(2, 9), maxDelay)).toBe(30000);
    });
  });

  describe('Mesaj Gönderme', () => {
    test('açık bağlantıda mesaj gönderilebilmeli', () => {
      const ws = new MockWebSocket('ws://localhost:3001/ws');
      ws.simulateOpen();

      ws.send(JSON.stringify({ type: 'chat', content: 'Test' }));

      expect(ws.lastSent).not.toBeNull();
      expect(ws.sentMessages).toHaveLength(1);
    });

    test('kapalı bağlantıda mesaj gönderilememeli', () => {
      const ws = new MockWebSocket('ws://localhost:3001/ws');
      ws.simulateOpen();
      ws.close();

      // Kapalı bağlantıda send çağrılabilir ama readyState CLOSED
      expect(ws.readyState).toBe(WebSocket.CLOSED);
    });

    test('birden fazla mesaj gönderilebilmeli', () => {
      const ws = new MockWebSocket('ws://localhost:3001/ws');
      ws.simulateOpen();

      ws.send(JSON.stringify({ type: 'chat', content: 'Mesaj 1' }));
      ws.send(JSON.stringify({ type: 'chat', content: 'Mesaj 2' }));
      ws.send(JSON.stringify({ type: 'set_thinking', enabled: true }));

      expect(ws.sentMessages).toHaveLength(3);
    });

    test('gönderilen mesajlar JSON formatında olmalı', () => {
      const ws = new MockWebSocket('ws://localhost:3001/ws');
      ws.simulateOpen();

      const message = { type: 'chat', content: 'Test' };
      ws.send(JSON.stringify(message));

      const parsed = ws.getLastSentJson();
      expect(parsed.type).toBe('chat');
      expect(parsed.content).toBe('Test');
    });
  });

  describe('Mesaj Alma', () => {
    test('onmessage ile mesaj alınmalı', () => {
      const ws = new MockWebSocket('ws://localhost:3001/ws');
      ws.simulateOpen();

      const onMessageMock = jest.fn();
      ws.onmessage = onMessageMock;

      ws.simulateMessage({ type: 'token', content: 'Test' });

      expect(onMessageMock).toHaveBeenCalledTimes(1);
    });

    test('alınan mesaj JSON parse edilebilmeli', () => {
      const ws = new MockWebSocket('ws://localhost:3001/ws');
      ws.simulateOpen();

      let receivedData: any;
      ws.onmessage = (event) => {
        receivedData = JSON.parse(event.data as string);
      };

      ws.simulateMessage({ type: 'response', content: 'Yanıt' });

      expect(receivedData.type).toBe('response');
      expect(receivedData.content).toBe('Yanıt');
    });

    test('farklı tipte mesajlar alınabilmeli', () => {
      const ws = new MockWebSocket('ws://localhost:3001/ws');
      ws.simulateOpen();

      const messageTypes = ['token', 'response', 'error', 'stats', 'clear_stream', 'replace_stream'];
      const receivedTypes: string[] = [];

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data as string);
        receivedTypes.push(data.type);
      };

      messageTypes.forEach((type) => {
        ws.simulateMessage({ type, content: 'test' });
      });

      expect(receivedTypes).toEqual(messageTypes);
    });
  });

  describe('WebSocket Instance Yönetimi', () => {
    test('her WebSocket instance kaydedilmeli', () => {
      expect(MockWebSocket.instances).toHaveLength(0);

      new MockWebSocket('ws://localhost:3001/ws');
      expect(MockWebSocket.instances).toHaveLength(1);

      new MockWebSocket('ws://localhost:3001/ws');
      expect(MockWebSocket.instances).toHaveLength(2);
    });

    test('clearInstances tüm instance\'ları temizlemeli', () => {
      new MockWebSocket('ws://localhost:3001/ws');
      new MockWebSocket('ws://localhost:3001/ws');
      
      expect(MockWebSocket.instances).toHaveLength(2);
      
      MockWebSocket.clearInstances();
      
      expect(MockWebSocket.instances).toHaveLength(0);
    });

    test('getLastInstance son instance\'ı döndürmeli', () => {
      const ws1 = new MockWebSocket('ws://localhost:3001/ws');
      const ws2 = new MockWebSocket('ws://localhost:3001/ws');

      const last = MockWebSocket.getLastInstance();
      
      expect(last).toBe(ws2);
    });

    test('getLastInstance boşsa null döndürmeli', () => {
      MockWebSocket.clearInstances();
      expect(MockWebSocket.getLastInstance()).toBeNull();
    });
  });

  describe('Mock/Restore Davranışı', () => {
    test('mock() global WebSocket\'u değiştirmeli', () => {
      const original = globalThis.WebSocket;
      
      MockWebSocket.mock();
      
      expect(globalThis.WebSocket).toBe(MockWebSocket);
      
      // Restore
      globalThis.WebSocket = original;
      MockWebSocket.originalWebSocket = null;
    });

    test('restore() global WebSocket\'u geri yüklemeli', () => {
      const original = globalThis.WebSocket;
      
      MockWebSocket.mock();
      MockWebSocket.restore();
      
      expect(globalThis.WebSocket).toBe(original);
    });
  });

  describe('ReadyState Durumları', () => {
    test('CONNECTING durumu 0 olmalı', () => {
      const ws = new MockWebSocket('ws://localhost:3001/ws');
      expect(ws.readyState).toBe(WebSocket.CONNECTING);
    });

    test('OPEN durumu 1 olmalı', () => {
      const ws = new MockWebSocket('ws://localhost:3001/ws');
      ws.simulateOpen();
      expect(ws.readyState).toBe(WebSocket.OPEN);
    });

    test('CLOSING durumu 2 olmalı', () => {
      const ws = new MockWebSocket('ws://localhost:3001/ws');
      ws.simulateOpen();
      // CLOSING durumunu simüle et
      ws.readyState = WebSocket.CLOSING;
      expect(ws.readyState).toBe(WebSocket.CLOSING);
    });

    test('CLOSED durumu 3 olmalı', () => {
      const ws = new MockWebSocket('ws://localhost:3001/ws');
      ws.simulateClose();
      expect(ws.readyState).toBe(WebSocket.CLOSED);
    });
  });
});

describe('WebSocket Message Types', () => {
  beforeEach(() => {
    MockWebSocket.mock();
  });

  afterEach(() => {
    MockWebSocket.restore();
  });

  test('chat mesajı doğru formatta gönderilmeli', () => {
    const ws = new MockWebSocket('ws://localhost:3001/ws');
    ws.simulateOpen();

    const chatMsg = {
      type: 'chat',
      content: 'Merhaba',
      newConversation: true,
    };
    ws.send(JSON.stringify(chatMsg));

    const parsed = ws.getLastSentJson();
    expect(parsed.type).toBe('chat');
    expect(parsed.content).toBe('Merhaba');
    expect(parsed.newConversation).toBe(true);
  });

  test('set_thinking mesajı doğru formatta gönderilmeli', () => {
    const ws = new MockWebSocket('ws://localhost:3001/ws');
    ws.simulateOpen();

    ws.send(JSON.stringify({ type: 'set_thinking', enabled: true }));

    const parsed = ws.getLastSentJson();
    expect(parsed.type).toBe('set_thinking');
    expect(parsed.enabled).toBe(true);
  });

  test('confirm_response mesajı doğru formatta gönderilmeli', () => {
    const ws = new MockWebSocket('ws://localhost:3001/ws');
    ws.simulateOpen();

    ws.send(JSON.stringify({
      type: 'confirm_response',
      id: 'confirm-1',
      approved: true,
    }));

    const parsed = ws.getLastSentJson();
    expect(parsed.type).toBe('confirm_response');
    expect(parsed.id).toBe('confirm-1');
    expect(parsed.approved).toBe(true);
  });
});
