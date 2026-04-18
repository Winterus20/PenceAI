import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { MetricsTracker } from '../../src/agent/metricsTracker.js';
import type { AgentEvent } from '../../src/agent/runtime.js';

jest.mock('../../src/observability/metricsCollector.js', () => ({
    metricsCollector: {
        recordMetrics: jest.fn().mockResolvedValue(undefined),
    },
}));

jest.mock('../../src/utils/index.js', () => ({
    calculateCost: jest.fn((_provider: string, _model: string, promptTokens: number, completionTokens: number) => {
        return (promptTokens * 0.00001) + (completionTokens * 0.00003);
    }),
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    },
}));

import { metricsCollector } from '../../src/observability/metricsCollector.js';
import { calculateCost } from '../../src/utils/index.js';

describe('MetricsTracker', () => {
    let tracker: MetricsTracker;

    beforeEach(() => {
        tracker = new MetricsTracker();
        jest.clearAllMocks();
    });

    describe('reset()', () => {
        it('creates a fresh session with the given start time', () => {
            const startTime = 1000000;
            tracker.reset(startTime);

            const event = tracker.buildMetricsEvent('conv-1');
            expect(event.data.conversationId).toBe('conv-1');

            tracker.recordPerf('llm_call_1', 500);
            tracker.recordLlmCall('openai', 'gpt-4o', 100, 50, 500);

            tracker.reset(2000000);
            const newEvent = tracker.buildMetricsEvent('conv-2');
            const perf = newEvent.data.performance as Record<string, unknown>;
            expect(perf.tools).toBe(0);
            expect(perf.toolCalls).toBe(0);
            const cost = newEvent.data.cost as Record<string, unknown>;
            expect(cost.total).toBe(0);
        });
    });

    describe('recordPerf()', () => {
        it('records timing entries that appear in buildMetricsEvent performance', () => {
            tracker.reset(1000);
            tracker.recordPerf('retrieval', 150);
            tracker.recordPerf('llm_call_1', 300);

            const event = tracker.buildMetricsEvent('conv-1');
            const perf = event.data.performance as Record<string, unknown>;
            expect(perf.retrieval).toBe(150);
            const llmCalls = perf.llmCalls as Array<{ key: string; ms: number }>;
            expect(llmCalls).toEqual(expect.arrayContaining([
                expect.objectContaining({ key: 'llm_call_1', ms: 300 }),
            ]));
        });
    });

    describe('setContextTokens()', () => {
        it('sets context token counts that appear in buildMetricsEvent', () => {
            tracker.reset(1000);
            tracker.setContextTokens({ systemPrompt: 500, userMsg: 100, pastHistory: 2000 });

            const event = tracker.buildMetricsEvent('conv-1');
            const ctx = event.data.context as Record<string, unknown>;
            expect(ctx.systemPromptTokens).toBe(500);
            expect(ctx.userMessageTokens).toBe(100);
            expect(ctx.historyTokens).toBe(2000);
        });
    });

    describe('recordLlmCall()', () => {
        it('records tokens and calculates cost using calculateCost', () => {
            tracker.reset(1000);
            const callCost = tracker.recordLlmCall('openai', 'gpt-4o', 1000, 500, 800);

            expect(callCost).toBeGreaterThan(0);
            expect(calculateCost).toHaveBeenCalledWith('openai', 'gpt-4o', 1000, 500);

            const event = tracker.buildMetricsEvent('conv-1');
            const cost = event.data.cost as Record<string, unknown>;
            expect(cost.promptTokens).toBe(1000);
            expect(cost.completionTokens).toBe(500);
            expect(cost.total).toBe(callCost);
            expect(cost.totalTokens).toBe(1500);
        });

        it('accumulates across multiple calls', () => {
            tracker.reset(1000);
            const cost1 = tracker.recordLlmCall('openai', 'gpt-4o', 100, 50, 500);
            const cost2 = tracker.recordLlmCall('openai', 'gpt-4o', 200, 100, 600);

            const event = tracker.buildMetricsEvent('conv-1');
            const cost = event.data.cost as Record<string, unknown>;
            expect(cost.promptTokens).toBe(300);
            expect(cost.completionTokens).toBe(150);
            expect(cost.total).toBeCloseTo(cost1 + cost2, 6);
            expect(cost.totalTokens).toBe(450);
            const breakdown = cost.breakdown as string[];
            expect(breakdown).toHaveLength(2);
        });
    });

    describe('addToolTime() and incrementToolCallCount()', () => {
        it('tracks tool execution time and call count', () => {
            tracker.reset(1000);
            const count1 = tracker.incrementToolCallCount();
            expect(count1).toBe(1);
            tracker.addToolTime(150);
            const count2 = tracker.incrementToolCallCount();
            expect(count2).toBe(2);
            tracker.addToolTime(250);

            const event = tracker.buildMetricsEvent('conv-1');
            const perf = event.data.performance as Record<string, unknown>;
            expect(perf.tools).toBe(400);
            expect(perf.toolCalls).toBe(2);
        });
    });

    describe('buildMetricsEvent()', () => {
        it('returns a proper AgentEvent with type metrics', () => {
            tracker.reset(1000);
            tracker.recordPerf('retrieval', 100);
            tracker.recordLlmCall('openai', 'gpt-4o', 50, 25, 200);
            tracker.setContextTokens({ systemPrompt: 300, userMsg: 50, pastHistory: 1000 });

            const event: AgentEvent = tracker.buildMetricsEvent('test-conv-id');

            expect(event.type).toBe('metrics');
            expect(event.data.conversationId).toBe('test-conv-id');
            expect(event.data.messageId).toMatch(/^msg_\d+_[a-z0-9]+$/);
            expect(event.data.performance).toBeDefined();
            expect(event.data.cost).toBeDefined();
            expect(event.data.context).toBeDefined();
        });
    });

    describe('buildPerformanceLog()', () => {
        it('formats string correctly with all components', () => {
            tracker.reset(1000);
            tracker.recordPerf('retrieval', 150);
            tracker.recordPerf('llm_call_1', 300);
            tracker.addToolTime(100);
            tracker.incrementToolCallCount();

            const log = tracker.buildPerformanceLog();

            expect(log).toContain('PERFORMANCE BREAKDOWN');
            expect(log).toContain('Retrieval: 150ms');
            expect(log).toContain('llm_call_1=300ms');
            expect(log).toContain('Tools: 100ms');
            expect(log).toContain('1 çağrı');
        });

        it('omits tools suffix when no tool time', () => {
            tracker.reset(1000);
            tracker.recordPerf('retrieval', 100);

            const log = tracker.buildPerformanceLog();

            expect(log).not.toContain('Tools:');
        });

        it('includes agentic timings when present', () => {
            tracker.reset(1000);
            tracker.recordPerf('retrieval', 100);
            tracker.recordPerf('responseVerification', 50);

            const log = tracker.buildPerformanceLog();

            expect(log).toContain('Agentic:');
            expect(log).toContain('responseVerification=50ms');
        });
    });

    describe('buildCostLog()', () => {
        it('returns null when no cost', () => {
            tracker.reset(1000);
            const result = tracker.buildCostLog();
            expect(result).toBeNull();
        });

        it('returns string when cost > 0', () => {
            tracker.reset(1000);
            tracker.recordLlmCall('openai', 'gpt-4o', 100, 50, 500);

            const result = tracker.buildCostLog();
            expect(result).not.toBeNull();
            expect(result!).toContain('TOPLAM MALİYET');
            expect(result!).toContain('input');
            expect(result!).toContain('output');
        });

        it('includes per-call details when more than one call', () => {
            tracker.reset(1000);
            tracker.recordLlmCall('openai', 'gpt-4o', 100, 50, 500);
            tracker.recordLlmCall('openai', 'gpt-4o', 200, 80, 600);

            const result = tracker.buildCostLog();
            expect(result).not.toBeNull();
            expect(result!).toContain('[1]');
            expect(result!).toContain('[2]');
        });

        it('does not include per-call details for single call', () => {
            tracker.reset(1000);
            tracker.recordLlmCall('openai', 'gpt-4o', 100, 50, 500);

            const result = tracker.buildCostLog();
            expect(result).not.toBeNull();
            expect(result!).not.toContain('[1]');
        });
    });

    describe('saveToDatabase()', () => {
        it('calls metricsCollector.recordMetrics with correct structure', async () => {
            tracker.reset(1000);
            tracker.recordPerf('retrieval', 100);
            tracker.recordLlmCall('openai', 'gpt-4o', 50, 25, 200);
            tracker.setContextTokens({ systemPrompt: 300, userMsg: 50, pastHistory: 800 });
            tracker.addToolTime(50);
            tracker.incrementToolCallCount();

            await tracker.saveToDatabase('conv-save-test');

            expect(metricsCollector.recordMetrics).toHaveBeenCalledTimes(1);
            const call = (metricsCollector.recordMetrics as jest.Mock).mock.calls[0][0];
            expect(call.conversationId).toBe('conv-save-test');
            expect(call.performance).toBeDefined();
            expect(call.cost).toBeDefined();
            expect(call.context).toBeDefined();
            expect(call.cost.promptTokens).toBe(50);
            expect(call.cost.completionTokens).toBe(25);
            expect(call.context.systemPromptTokens).toBe(300);
            expect(call.context.userMessageTokens).toBe(50);
            expect(call.context.historyTokens).toBe(800);
        });

        it('handles errors gracefully', async () => {
            tracker.reset(1000);
            (metricsCollector.recordMetrics as jest.Mock).mockRejectedValueOnce(new Error('DB error'));

            await expect(tracker.saveToDatabase('conv-err')).resolves.toBeUndefined();
        });
    });
});