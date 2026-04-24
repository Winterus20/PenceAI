/**
 * Mock WebSocket Sınıfı
 * WebSocket bağlantılarını test etmek için mock implementasyon
 */

export class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static originalWebSocket: typeof WebSocket | null = null;

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState: number = WebSocket.CONNECTING;

  readonly CONNECTING = WebSocket.CONNECTING;
  readonly OPEN = WebSocket.OPEN;
  readonly CLOSING = WebSocket.CLOSING;
  readonly CLOSED = WebSocket.CLOSED;

  lastSent: string | null = null;
  sentMessages: string[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.lastSent = data;
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string) {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.({
      code: code || 1000,
      reason: reason || 'Test close',
      wasClean: true,
    } as CloseEvent);
  }

  // Test tarafından tetiklenen metodlar
  simulateOpen() {
    this.readyState = WebSocket.OPEN;
    this.onopen?.({} as Event);
  }

  simulateMessage(data: any) {
    const messageData = typeof data === 'string' ? data : JSON.stringify(data);
    this.onmessage?.({ data: messageData } as MessageEvent);
  }

  simulateClose(code?: number, reason?: string) {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.({
      code: code || 1000,
      reason: reason || '',
      wasClean: true,
    } as CloseEvent);
  }

  simulateError() {
    this.onerror?.({} as Event);
  }

  // Gönderilen mesajı parse et
  getLastSentJson(): any {
    if (!this.lastSent) {
      throw new Error('No message was sent');
    }
    return JSON.parse(this.lastSent);
  }

  // Tüm gönderilen mesajları parse et
  getAllSentJson(): any[] {
    return this.sentMessages.map((msg) => JSON.parse(msg));
  }

  // Son gönderilen mesajın tipini kontrol et
  lastSentType(): string | null {
    try {
      const json = this.getLastSentJson();
      return json.type || null;
    } catch {
      return null;
    }
  }

  // Statik metodlar
  static clearInstances() {
    MockWebSocket.instances = [];
  }

  static getLastInstance(): MockWebSocket | null {
    if (MockWebSocket.instances.length === 0) {
      return null;
    }
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }

  static mock() {
    MockWebSocket.originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  }

  static restore() {
    if (MockWebSocket.originalWebSocket) {
      globalThis.WebSocket = MockWebSocket.originalWebSocket;
      MockWebSocket.originalWebSocket = null;
    }
    MockWebSocket.clearInstances();
  }
}

// WebSocket event tipleri
export interface WsChatMessage {
  type: 'chat';
  content: string;
  attachments?: Array<{
    fileName: string;
    mimeType: string;
    size: number;
    data: string;
  }>;
  conversationId?: string;
  newConversation?: boolean;
}

export interface WsSetThinkingMessage {
  type: 'set_thinking';
  enabled: boolean;
}

export interface WsConfirmResponseMessage {
  type: 'confirm_response';
  id: string;
  approved: boolean;
}

export type WsOutgoingMessage = WsChatMessage | WsSetThinkingMessage | WsConfirmResponseMessage;

// WebSocket gelen mesaj tipleri
export interface WsTokenMessage {
  type: 'token';
  content: string;
}

export interface WsResponseMessage {
  type: 'response';
  content: string;
  conversationId?: string;
}

export interface WsAgentEventMessage {
  type: 'agent_event';
  eventType: string;
  data: Record<string, unknown>;
}

export interface WsClearStreamMessage {
  type: 'clear_stream';
}

export interface WsReplaceStreamMessage {
  type: 'replace_stream';
  content: string;
}

export interface WsErrorMessage {
  type: 'error';
  message: string;
}

export interface WsStatsMessage {
  type: 'stats';
  stats: Record<string, unknown>;
}

export interface WsConfirmRequestMessage {
  type: 'confirm_request';
  id: string;
  toolName: string;
  path: string;
  operation: string;
  description: string;
}

export interface WsToolUseMessage {
  type: 'tool_use';
}

export type WsIncomingMessage =
  | WsTokenMessage
  | WsResponseMessage
  | WsAgentEventMessage
  | WsClearStreamMessage
  | WsReplaceStreamMessage
  | WsErrorMessage
  | WsStatsMessage
  | WsConfirmRequestMessage
  | WsToolUseMessage;
