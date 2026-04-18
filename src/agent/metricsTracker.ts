import { calculateCost, logger } from '../utils/index.js';
import type { AgentEvent } from './runtime.js';
import { metricsCollector } from '../observability/metricsCollector.js';
import type { PerformanceMetrics, CostMetrics, ContextMetrics } from '../observability/metricsCollector.js';

export interface MetricsSession {
  startTimeMs: number;
  perfTimings: Record<string, number>;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  perCallDetails: string[];
  contextSystemPromptTokens: number;
  contextUserMsgTokens: number;
  contextHistoryTokens: number;
  sessionTotalToolTime: number;
  sessionToolCallCount: number;
}

export class MetricsTracker {
  private session: MetricsSession;

  constructor() {
    this.session = this.createEmptySession(0);
  }

  reset(startTimeMs: number): void {
    this.session = this.createEmptySession(startTimeMs);
  }

  private createEmptySession(startTimeMs: number): MetricsSession {
    return {
      startTimeMs,
      perfTimings: {},
      promptTokens: 0,
      completionTokens: 0,
      cost: 0,
      perCallDetails: [],
      contextSystemPromptTokens: 0,
      contextUserMsgTokens: 0,
      contextHistoryTokens: 0,
      sessionTotalToolTime: 0,
      sessionToolCallCount: 0,
    };
  }

  recordPerf(key: string, ms: number): void {
    this.session.perfTimings[key] = ms;
  }

  setContextTokens(info: { systemPrompt: number; userMsg: number; pastHistory: number }): void {
    this.session.contextSystemPromptTokens = info.systemPrompt;
    this.session.contextUserMsgTokens = info.userMsg;
    this.session.contextHistoryTokens = info.pastHistory;
  }

  recordLlmCall(provider: string, model: string, promptTokens: number, completionTokens: number, durationMs: number): number {
    const totalTokens = promptTokens + completionTokens;
    const callCost = calculateCost(provider, model, promptTokens, completionTokens);
    this.session.promptTokens += promptTokens;
    this.session.completionTokens += completionTokens;
    this.session.cost += callCost;
    this.session.perCallDetails.push(`${provider}/${model}: ${promptTokens} in + ${completionTokens} out = ${totalTokens} tokens | $${callCost.toFixed(4)}`);
    return callCost;
  }

  addToolTime(durationMs: number): void {
    this.session.sessionTotalToolTime += durationMs;
  }

  incrementToolCallCount(): number {
    this.session.sessionToolCallCount += 1;
    return this.session.sessionToolCallCount;
  }

  buildMetricsEvent(conversationId: string): AgentEvent {
    const s = this.session;
    const metricsMessageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      type: 'metrics',
      data: {
        conversationId,
        messageId: metricsMessageId,
        performance: {
          total: Date.now() - s.startTimeMs,
          retrieval: s.perfTimings.retrieval ?? 0,
          graphRAG: s.perfTimings.graphRAG ?? 0,
          llmCalls: Object.entries(s.perfTimings).filter(([k]) => k.startsWith('llm_call_')).map(([k, v]) => ({ key: k, ms: v })),
          agentic: Object.entries(s.perfTimings).filter(([k]) => ['retrievalDecision', 'passageCritique', 'multiHop', 'responseVerification'].includes(k)).reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {} as Record<string, number>),
          tools: s.sessionTotalToolTime,
          toolCalls: s.sessionToolCallCount,
        },
        cost: {
          total: s.cost,
          promptTokens: s.promptTokens,
          completionTokens: s.completionTokens,
          totalTokens: s.promptTokens + s.completionTokens,
          breakdown: s.perCallDetails,
        },
        context: {
          historyTokens: s.contextHistoryTokens,
          userMessageTokens: s.contextUserMsgTokens,
          systemPromptTokens: s.contextSystemPromptTokens,
        },
      },
    };
  }

  buildPerformanceLog(): string {
    const s = this.session;
    const agenticParts = Object.entries(s.perfTimings)
      .filter(([k]) => ['retrievalDecision', 'passageCritique', 'multiHop', 'responseVerification'].includes(k))
      .map(([k, v]) => `${k}=${v}ms`);
    const agenticSuffix = agenticParts.length > 0 ? ` | Agentic: ${agenticParts.join(', ')}` : '';
    const toolSuffix = s.sessionTotalToolTime > 0 ? ` | Tools: ${s.sessionTotalToolTime}ms (${s.sessionToolCallCount} çağrı)` : '';
    return `[Agent] ⏱️ PERFORMANCE BREAKDOWN — Toplam: ${Date.now() - s.startTimeMs}ms | Retrieval: ${s.perfTimings.retrieval ?? 0}ms | GraphRAG: ${s.perfTimings.graphRAG ?? 0}ms | LLM: ${Object.entries(s.perfTimings).filter(([k]) => k.startsWith('llm_call_')).map(([k, v]) => `${k}=${v}ms`).join(', ') || 'none'}${agenticSuffix}${toolSuffix}`;
  }

  buildCostLog(): string | null {
    const s = this.session;
    if (s.cost <= 0) return null;
    const totalTokens = s.promptTokens + s.completionTokens;
    const lines: string[] = [];
    lines.push(`[Agent] 💰 TOPLAM MALİYET: $${s.cost.toFixed(4)} | ${s.promptTokens} input + ${s.completionTokens} output = ${totalTokens} tokens`);
    if (s.perCallDetails.length > 1) {
      s.perCallDetails.forEach((detail, i) => {
        lines.push(`[Agent] 💰   [${i + 1}] ${detail}`);
      });
    }
    return lines.join('\n');
  }

  async saveToDatabase(conversationId: string): Promise<void> {
    const s = this.session;
    const metricsMessageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      await metricsCollector.recordMetrics({
        conversationId,
        messageId: metricsMessageId,
        timestamp: new Date().toISOString(),
        performance: {
          total: Date.now() - s.startTimeMs,
          retrieval: s.perfTimings.retrieval ?? 0,
          graphRAG: s.perfTimings.graphRAG ?? 0,
          llmCalls: Object.entries(s.perfTimings).filter(([k]) => k.startsWith('llm_call_')).map(([k, v]) => ({ key: k, ms: v })),
          agentic: Object.entries(s.perfTimings).filter(([k]) => ['retrievalDecision', 'passageCritique', 'multiHop', 'responseVerification'].includes(k)).reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {} as Record<string, number>),
          tools: s.sessionTotalToolTime,
          toolCalls: s.sessionToolCallCount,
        },
        cost: {
          total: s.cost,
          totalTokens: s.promptTokens + s.completionTokens,
          promptTokens: s.promptTokens,
          completionTokens: s.completionTokens,
        },
        context: {
          historyTokens: s.contextHistoryTokens,
          userMessageTokens: s.contextUserMsgTokens,
          systemPromptTokens: s.contextSystemPromptTokens,
        },
      });
    } catch (metricsErr) {
      logger.warn({ err: metricsErr }, '[Agent] Metrics DB kaydı başarısız (non-critical)');
    }
  }
}