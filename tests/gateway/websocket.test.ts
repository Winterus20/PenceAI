import { describe, test, expect, afterEach, jest } from '@jest/globals';
import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import { resolveIncomingUserName } from '../../src/gateway/userName.js';
import {
  setupWebSocket,
  resolveWebUserName,
  WS_CONFIG,
} from '../../src/gateway/websocket.js';
import { _clearWakeupLocksForTests } from '../../src/gateway/wakeupLock.js';
import { globalEventBus } from '../../src/utils/eventBus.js';
import type { MemoryManager } from '../../src/memory/manager.js';
import type { AgentRuntime } from '../../src/agent/runtime.js';

jest.mock('../../src/utils/logRingBuffer.js', () => ({
  logRingBuffer: new EventEmitter(),
}));

describe('resolveIncomingUserName', () => {
  test('prefers explicit websocket userName when provided', () => {
    expect(resolveIncomingUserName('Yiğit', 'Ayar Adı')).toBe('Yiğit');
  });

  test('falls back to configured default user name when websocket payload omits it', () => {
    expect(resolveIncomingUserName(undefined, 'Ayşe')).toBe('Ayşe');
    expect(resolveIncomingUserName('   ', 'Ayşe')).toBe('Ayşe');
  });

  test('falls back to generic user name when both payload and config are empty', () => {
    expect(resolveIncomingUserName(undefined, '   ')).toBe('Kullanıcı');
  });
});

describe('resolveWebUserName', () => {
  test('delegates to resolveIncomingUserName with config default', () => {
    expect(resolveWebUserName('Ali')).toBe('Ali');
    expect(resolveWebUserName(undefined)).toBeTruthy();
  });
});

describe('WS_CONFIG', () => {
  test('exports expected websocket limits', () => {
    expect(WS_CONFIG.confirmationTimeoutMs).toBe(300000);
    expect(WS_CONFIG.maxMessageLength).toBe(50000);
  });
});

describe('setupWebSocket agent_wakeup + wakeup lock', () => {
  let wss: WebSocketServer;

  afterEach(() => {
    _clearWakeupLocksForTests();
    globalEventBus.removeAllListeners('agent_wakeup');
    globalEventBus.removeAllListeners('spontaneous_message');
    globalEventBus.removeAllListeners('prompt_human_request');
    if (wss) {
      wss.close();
    }
  });

  test('serializes concurrent agent_wakeup handlers for the same conversation', async () => {
    const executionOrder: string[] = [];
    const mockAgent = {
      processMessage: jest.fn().mockImplementation(async () => {
        const label = executionOrder.length === 0 ? 'first-start' : 'second-start';
        executionOrder.push(label);
        await new Promise((r) => setTimeout(r, 40));
        executionOrder.push(`${label}-done`);
        return { response: 'ok', conversationId: 'conv-ws-1' };
      }),
    } as unknown as AgentRuntime;

    const mockMemory = {
      getConversationContext: () => null,
    } as unknown as MemoryManager;

    wss = new WebSocketServer({ noServer: true });
    setupWebSocket(wss, {
      memory: mockMemory,
      agent: mockAgent,
      semanticRouter: {} as never,
      autonomousWorker: { registerUserActivity: jest.fn() } as never,
      broadcastStats: jest.fn(),
    });

    globalEventBus.emit('agent_wakeup', {
      conversationId: 'conv-ws-1',
      reason: 'Görev 1',
      timerId: 'timer-1',
      timerType: 'cron',
      cronExpression: '*/5 * * * *',
    });
    globalEventBus.emit('agent_wakeup', {
      conversationId: 'conv-ws-1',
      reason: 'Görev 2',
      timerId: 'timer-2',
      timerType: 'cron',
      cronExpression: '*/10 * * * *',
    });

    await new Promise((r) => setTimeout(r, 200));

    expect(mockAgent.processMessage).toHaveBeenCalledTimes(2);
    expect(executionOrder).toEqual([
      'first-start',
      'first-start-done',
      'second-start',
      'second-start-done',
    ]);
  });
});
