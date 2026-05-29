/**
 * Agent runtime & ReAct loop tests
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ReActLoop } from '../../src/agent/reactLoop.js';
import { AgentRuntime } from '../../src/agent/runtime.js';
import { ToolManager } from '../../src/agent/toolManager.js';
import { MetricsTracker } from '../../src/agent/metricsTracker.js';
import { CompactEngine } from '../../src/agent/compactEngine.js';
import { LLMProvider } from '../../src/llm/provider.js';
import type { LLMMessage, LLMResponse, UnifiedMessage } from '../../src/router/types.js';
import type { MemoryManager } from '../../src/memory/manager.js';

jest.mock('../../src/agent/mcp/config.js', () => ({
  isMCPEnabled: jest.fn().mockReturnValue(false),
}));

jest.mock('../../src/agent/mcp/registry.js', () => ({
  getUnifiedToolRegistry: jest.fn().mockReturnValue({
    getAllToolDefinitions: jest.fn().mockReturnValue([]),
    registerBuiltins: jest.fn(),
    executeTool: jest.fn(),
  }),
}));

jest.mock('../../src/agent/mcp/hooks.js', () => ({
  getHookRegistry: jest.fn().mockReturnValue({
    executePhase: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock('../../src/agent/tools.js', () => ({
  createBuiltinTools: jest.fn().mockReturnValue([
    { name: 'readFile', execute: jest.fn<() => Promise<string>>().mockResolvedValue('file content') },
  ]),
}));

jest.mock('../../src/agent/prompt.js', () => ({
  getBuiltinToolDefinitions: jest.fn().mockReturnValue([
    { name: 'readFile', description: 'Read a file', parameters: { type: 'object', properties: {} } },
  ]),
  BASE_SYSTEM_PROMPT: 'test system prompt',
  buildSystemPrompt: jest.fn().mockReturnValue('mock system prompt'),
}));

class MockLLMProvider extends LLMProvider {
  readonly name = 'mock-runtime-llm';
  readonly supportedModels = ['mock-model'];
  private responses: LLMResponse[];
  callCount = 0;

  constructor(responses: LLMResponse[]) {
    super();
    this.responses = responses;
  }

  get supportsNativeToolCalling(): boolean {
    return true;
  }

  async chat(_messages: LLMMessage[]): Promise<LLMResponse> {
    this.callCount += 1;
    const idx = Math.min(this.callCount - 1, this.responses.length - 1);
    return this.responses[idx] ?? { content: 'fallback response' };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

function createMockMemory(): MemoryManager {
  return {
    beginConversationTurn: jest.fn().mockReturnValue({
      conversationId: 'conv-test-1',
      previousConversationId: undefined,
      history: [],
    }),
    getPromptContextBundle: jest.fn().mockResolvedValue({
      relevantMemories: [],
      archivalMemories: [],
      supplementalMemories: [],
      conversationSummaries: [],
      telescopicSummaries: [],
      reviewMemories: [],
      followUpCandidates: [],
      recentMessages: [],
    }),
    addMessage: jest.fn(),
    saveTokenUsage: jest.fn(),
    getSensitivePaths: () => [],
  } as unknown as MemoryManager;
}

describe('ReActLoop', () => {
  let toolManager: ToolManager;
  let metricsTracker: MetricsTracker;
  let mockMemory: MemoryManager;

  beforeEach(() => {
    toolManager = new ToolManager(false);
    metricsTracker = new MetricsTracker();
    mockMemory = {
      addMessage: jest.fn(),
      saveTokenUsage: jest.fn(),
    } as unknown as MemoryManager;

    jest.spyOn(toolManager, 'getEffectiveToolDefinitions').mockReturnValue([
      {
        name: 'readFile',
        description: 'Read a file',
        parameters: { type: 'object', properties: {} },
      },
    ]);

    jest.spyOn(toolManager, 'executeToolsWithEvents').mockResolvedValue([
      { id: 'tc-1', name: 'readFile', result: 'file contents' },
    ]);
  });

  it('stops after maxIterations when LLM keeps requesting tools', async () => {
    const alwaysToolCall: LLMResponse = {
      content: '',
      toolCalls: [{ id: 'tc-1', name: 'readFile', arguments: { path: '/tmp/x' } }],
    };
    const llm = new MockLLMProvider([alwaysToolCall, alwaysToolCall, alwaysToolCall]);

    const compactEngine = {
      compactIfNeeded: jest.fn().mockResolvedValue({
        wasCompacted: false,
        messages: [],
        originalTokens: 0,
        compactedTokens: 0,
        messagesCompacted: 0,
        summaryLength: 0,
        durationMs: 0,
        preservedFiles: [],
        boundaryId: '',
      }),
    } as unknown as CompactEngine;

    const loop = new ReActLoop();
    const result = await loop.execute({
      llm,
      toolManager,
      metricsTracker,
      memory: mockMemory,
      conversationId: 'conv-1',
      finalSystemPrompt: 'system',
      llmMessages: [{ role: 'user', content: 'read file' }],
      maxIterations: 2,
      isToolingDisabled: false,
      isFirstMessage: false,
      contextTokenInfo: { systemPromptTokens: 10, userMsgTokens: 5, pastHistoryTokens: 0 },
      compactEngine,
      compactThreshold: 0,
    });

    expect(result.iterations).toBe(2);
    expect(llm.callCount).toBe(2);
    expect(result.uiContent).toContain('Maksimum araç iterasyon sayısına ulaşıldı');
    expect(toolManager.executeToolsWithEvents).toHaveBeenCalledTimes(2);
  });

  it('returns final content when LLM responds without tool calls', async () => {
    const llm = new MockLLMProvider([{ content: 'Merhaba, yardımcı olabilirim.' }]);
    const compactEngine = {
      compactIfNeeded: jest.fn(),
    } as unknown as CompactEngine;

    const loop = new ReActLoop();
    const result = await loop.execute({
      llm,
      toolManager,
      metricsTracker,
      memory: mockMemory,
      conversationId: 'conv-2',
      finalSystemPrompt: 'system',
      llmMessages: [{ role: 'user', content: 'selam' }],
      maxIterations: 5,
      isToolingDisabled: false,
      isFirstMessage: true,
      contextTokenInfo: { systemPromptTokens: 10, userMsgTokens: 5, pastHistoryTokens: 0 },
      compactEngine,
      compactThreshold: 0,
    });

    expect(result.iterations).toBe(1);
    expect(result.uiContent).toBe('Merhaba, yardımcı olabilirim.');
    expect(toolManager.executeToolsWithEvents).not.toHaveBeenCalled();
  });
});

describe('AgentRuntime', () => {
  it('processMessage smoke test returns LLM response with mocked dependencies', async () => {
    const llm = new MockLLMProvider([{ content: 'Smoke test yanıtı' }]);
    const memory = createMockMemory();
    const runtime = new AgentRuntime(llm, memory);

    const message: UnifiedMessage = {
      id: 'msg-1',
      channelType: 'web',
      channelId: 'web-default',
      senderId: 'user-1',
      senderName: 'Test User',
      content: 'Merhaba',
      attachments: [],
      timestamp: new Date(),
    };

    const result = await runtime.processMessage(message);

    expect(result.conversationId).toBe('conv-test-1');
    expect(result.response).toBe('Smoke test yanıtı');
    expect(memory.beginConversationTurn).toHaveBeenCalled();
    expect(memory.getPromptContextBundle).toHaveBeenCalled();
    expect(memory.addMessage).toHaveBeenCalled();
  });

  it('returns empty response for background context messages without calling LLM', async () => {
    const llm = new MockLLMProvider([{ content: 'should not appear' }]);
    const memory = createMockMemory();
    const runtime = new AgentRuntime(llm, memory);

    const message: UnifiedMessage = {
      id: 'msg-bg',
      channelType: 'web',
      channelId: 'web-default',
      senderId: 'system',
      senderName: 'System',
      content: 'background info',
      attachments: [],
      timestamp: new Date(),
      metadata: { isBackgroundContext: true },
    };

    const result = await runtime.processMessage(message);

    expect(result.response).toBe('');
    expect(llm.callCount).toBe(0);
  });
});
