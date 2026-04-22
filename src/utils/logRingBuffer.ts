import { EventEmitter } from 'events';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  msg: string;
  traceId?: string;
  [key: string]: unknown;
}

const MAX_SIZE = 1000;

/**
 * In-memory ring buffer for recent logs.
 * Oldest entries are evicted when capacity is exceeded.
 * Emits 'log' event for live consumers (e.g. WebSocket broadcast).
 */
export class LogRingBuffer extends EventEmitter {
  private buffer: LogEntry[] = [];

  addLog(entry: LogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length > MAX_SIZE) {
      this.buffer.shift();
    }
    this.emit('log', entry);
  }

  getLogs(limit = MAX_SIZE): LogEntry[] {
    return this.buffer.slice(-Math.min(limit, MAX_SIZE));
  }

  getRecent(count = 100): LogEntry[] {
    return this.buffer.slice(-Math.min(count, MAX_SIZE));
  }

  clear(): void {
    this.buffer = [];
  }

  get size(): number {
    return this.buffer.length;
  }
}

export const logRingBuffer = new LogRingBuffer();
