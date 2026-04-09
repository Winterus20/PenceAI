/**
 * MCP Event Bus — Modüller arası loose coupling için typed event emitter.
 * Hem lifecycle event'leri hem de runtime event'leri tek bir bus'ta.
 * Circular dependency'leri kırar.
 */
import { EventEmitter } from 'events';

export interface MCPEvents {
  // Lifecycle events (marketplace / install / uninstall)
  'server:activated': { name: string; toolCount: number };
  'server:deactivated': { name: string };
  'server:installed': { name: string };
  'server:uninstalled': { name: string };
  // Runtime events (connection / tool calls)
  'server:connected': { name: string; toolCount: number; transportType?: 'stdio' | 'sse' };
  'server:disconnected': { name: string };
  'server:error': { name: string; error: string };
  'tool:call_start': { serverName: string; toolName: string; arguments?: Record<string, unknown> };
  'tool:call_end': { serverName: string; toolName: string; result?: string };
  'tool:call_error': { serverName: string; toolName: string; error: string };
  // Discovery
  'tools:discovered': { serverName: string; tools: string[] };
  // Generic error
  'error': { serverName: string; error: string };
}

export type MCPEventType = keyof MCPEvents;
export type MCPEventPayload<T extends MCPEventType> = MCPEvents[T];

export class MCPEventBus extends EventEmitter {
  emit<T extends MCPEventType>(event: T, payload: MCPEventPayload<T>): boolean {
    return super.emit(event, payload);
  }

  on<T extends MCPEventType>(event: T, listener: (payload: MCPEventPayload<T>) => void): this {
    return super.on(event, listener);
  }

  once<T extends MCPEventType>(event: T, listener: (payload: MCPEventPayload<T>) => void): this {
    return super.once(event, listener);
  }

  off<T extends MCPEventType>(event: T, listener: (payload: MCPEventPayload<T>) => void): this {
    return super.off(event, listener);
  }
}

// Singleton event bus
let _eventBus: MCPEventBus | null = null;

export function getMCPEventBus(): MCPEventBus {
  if (!_eventBus) {
    _eventBus = new MCPEventBus();
  }
  return _eventBus;
}

export function resetMCPEventBus(): void {
  if (_eventBus) {
    _eventBus.removeAllListeners();
    _eventBus = null;
  }
}
