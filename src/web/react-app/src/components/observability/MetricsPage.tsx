import { useMemo, useState, useEffect, useCallback } from 'react';
import { useAgentStore } from '@/store/agentStore';
import type { MessageMetrics } from '@/store/types';
import { BarChart3, DollarSign, MessageSquare, Clock, TrendingUp, Search, Cpu, Layers, RefreshCw, ArrowLeft } from 'lucide-react';
import { useAllMetrics, useMetricsSummary } from '@/hooks/queries/useMetrics';
import type { MetricsEntry } from '@/services/observabilityService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return `${n}`;
}

interface AggregatedMetrics {
  totalQueries: number;
  totalTokens: number;
  totalCost: number;
  avgResponseTime: number;
  avgTokensPerQuery: number;
  costPerToken: number;
  byProvider: Record<string, { calls: number; tokens: number; cost: number; totalTime: number }>;
  retrievalTime: number;
  graphRAGTime: number;
  toolTime: number;
  maxProviderBreakdown: { name: string; cost: number; pct: number }[];
}

function aggregate(entries: MessageMetrics[]): AggregatedMetrics {
  const totalQueries = entries.length;
  const totalTokens = entries.reduce((s, m) => s + (m.cost.totalTokens ?? 0), 0);
  const totalCost = entries.reduce((s, m) => s + (m.cost.total ?? 0), 0);
  const totalTime = entries.reduce((s, m) => s + (m.performance.total ?? 0), 0);
  const avgResponseTime = totalQueries > 0 ? totalTime / totalQueries : 0;
  const avgTokensPerQuery = totalQueries > 0 ? totalTokens / totalQueries : 0;
  const costPerToken = totalTokens > 0 ? totalCost / totalTokens : 0;

  const retrievalTime = entries.reduce((s, m) => s + (m.performance.retrieval ?? 0), 0);
  const graphRAGTime = entries.reduce((s, m) => s + (m.performance.graphRAG ?? 0), 0);
  const toolTime = entries.reduce((s, m) => s + (m.performance.tools ?? 0), 0);

  // By provider breakdown (from llmCalls array keys)
  const byProvider: Record<string, { calls: number; tokens: number; cost: number; totalTime: number }> = {};

  for (const entry of entries) {
    for (const call of entry.performance.llmCalls ?? []) {
      if (!byProvider[call.key]) {
        byProvider[call.key] = { calls: 0, tokens: 0, cost: 0, totalTime: 0 };
      }
      byProvider[call.key].calls += 1;
      byProvider[call.key].totalTime += call.ms;
    }
    // Approximate: split tokens & cost proportionally to llmCall time
    const totalLlmTime = entry.performance.llmCalls.reduce((s, c) => s + c.ms, 0);
    if (totalLlmTime > 0) {
      for (const call of entry.performance.llmCalls) {
        const ratio = call.ms / totalLlmTime;
        byProvider[call.key].tokens += Math.round(entry.cost.totalTokens * ratio);
        byProvider[call.key].cost += entry.cost.total * ratio;
      }
    }
  }

  const maxProviderBreakdown = Object.entries(byProvider)
    .map(([name, v]) => ({ name, cost: v.cost, pct: totalCost > 0 ? (v.cost / totalCost) * 100 : 0 }))
    .sort((a, b) => b.cost - a.cost);

  return {
    totalQueries,
    totalTokens,
    totalCost,
    avgResponseTime,
    avgTokensPerQuery,
    costPerToken,
    byProvider,
    retrievalTime,
    graphRAGTime,
    toolTime,
    maxProviderBreakdown,
  };
}

/**
 * Backend MetricsEntry'yi MessageMetrics formatına dönüştür
 */
function backendToMessageMetrics(entry: MetricsEntry): MessageMetrics {
  return {
    performance: {
      total: entry.performance.total,
      retrieval: entry.performance.retrieval,
      graphRAG: entry.performance.graphRAG,
      llmCalls: entry.performance.llmCalls,
      agentic: entry.performance.agentic,
      tools: entry.performance.tools,
      toolCalls: entry.performance.toolCalls,
    },
    cost: {
      total: entry.cost.total,
      totalTokens: entry.cost.totalTokens,
      promptTokens: entry.cost.promptTokens,
      completionTokens: entry.cost.completionTokens,
      breakdown: [],
    },
    context: {
      historyTokens: entry.context.historyTokens,
      userMessageTokens: entry.context.userMessageTokens,
      systemPromptTokens: entry.context.systemPromptTokens,
    },
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5 flex items-start gap-4">
      <div className={`p-3 rounded-lg ${accent}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <p className="text-sm text-gray-400">{label}</p>
        <p className="text-2xl font-bold mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

function BarSegment({
  label,
  value,
  pct,
  color,
}: {
  label: string;
  value: string;
  pct: number;
  color: string;
}) {
  return (
    <div className="mb-3">
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-300">{label}</span>
        <span className="text-gray-400">{value}</span>
      </div>
      <div className="w-full h-2.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

function ProviderRow({
  name,
  calls,
  cost,
  tokens,
  time,
  costPct,
}: {
  name: string;
  calls: number;
  cost: number;
  tokens: number;
  time: number;
  costPct: number;
}) {
  return (
    <tr className="border-b border-gray-700/50 hover:bg-gray-700/20 transition-colors">
      <td className="py-3 px-4">
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-500/10 text-indigo-400">
          {name}
        </span>
      </td>
      <td className="py-3 px-4 text-gray-300 tabular-nums">{calls}</td>
      <td className="py-3 px-4 text-gray-300 tabular-nums">{formatTokens(tokens)}</td>
      <td className="py-3 px-4 text-gray-300 tabular-nums">{formatCost(cost)}</td>
      <td className="py-3 px-4 text-gray-300 tabular-nums">{formatMs(time)}</td>
      <td className="py-3 px-4">
        <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden" style={{ minWidth: 80 }}>
          <div
            className="h-full rounded-full bg-emerald-500/70 transition-all duration-500"
            style={{ width: `${Math.min(costPct, 100)}%` }}
          />
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function MetricsPage() {
  const messageMetrics = useAgentStore((s) => s.messageMetrics);
  const setActiveView = useAgentStore((s) => s.setActiveView);

  // Time range ve auto-refresh state
  const [timeRange, setTimeRange] = useState<'1d' | '7d' | '30d'>('1d');
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Backend'den veri çek
  const daysForSummary = timeRange === '1d' ? 1 : timeRange === '7d' ? 7 : 30;
  const { data: backendSummary, refetch: refetchSummary } = useMetricsSummary(daysForSummary);
  const { data: allMetrics, refetch: refetchAll } = useAllMetrics(200);

  // Auto-refresh
  const refetch = useCallback(() => {
    refetchSummary();
    refetchAll();
  }, [refetchSummary, refetchAll]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      refetch();
    }, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, refetch]);

  // Client + Backend verilerini birleştir
  const mergedMetrics = useMemo(() => {
    const clientEntries = Object.values(messageMetrics).filter((m): m is MessageMetrics => m != null);
    const backendEntries = (allMetrics?.metrics || []).map(backendToMessageMetrics);

    // Backend + client side'i birleştir (client side daha guncel olabilir)
    return [...backendEntries, ...clientEntries];
  }, [allMetrics, messageMetrics]);

  const entries = useMemo(
    () => {
      // Zaten mergedMetrics icinde birlestirilmis durumda
      return mergedMetrics;
    },
    [mergedMetrics],
  );

  const agg = useMemo(() => aggregate(entries), [entries]);

  // Token distribution (prompt vs completion)
  const promptTokens = entries.reduce((s, m) => s + (m.cost.promptTokens ?? 0), 0);
  const completionTokens = entries.reduce((s, m) => s + (m.cost.completionTokens ?? 0), 0);
  const totalCtx = promptTokens + completionTokens;
  const promptPct = totalCtx > 0 ? (promptTokens / totalCtx) * 100 : 0;
  const completionPct = totalCtx > 0 ? (completionTokens / totalCtx) * 100 : 0;

  // Performance breakdown
  const totalPerfTime =
    agg.retrievalTime + agg.graphRAGTime + agg.toolTime + (agg.totalQueries > 0 ? agg.avgResponseTime * agg.totalQueries - agg.retrievalTime - agg.graphRAGTime - agg.toolTime : 0);
  const llmOnlyTime = Math.max(totalPerfTime - agg.retrievalTime - agg.graphRAGTime - agg.toolTime, 0);
  const retrievalPct = totalPerfTime > 0 ? (agg.retrievalTime / totalPerfTime) * 100 : 0;
  const graphRAGPct = totalPerfTime > 0 ? (agg.graphRAGTime / totalPerfTime) * 100 : 0;
  const toolPct = totalPerfTime > 0 ? (agg.toolTime / totalPerfTime) * 100 : 0;
  const llmPct = totalPerfTime > 0 ? (llmOnlyTime / totalPerfTime) * 100 : 0;

  if (entries.length === 0) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-6 flex flex-col">
        <button
          onClick={() => setActiveView('chat')}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mb-4 self-start"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Chat
        </button>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <BarChart3 className="w-16 h-16 mx-auto text-gray-600 mb-4" />
            <h2 className="text-xl font-semibold text-gray-400">No Metrics Yet</h2>
            <p className="text-gray-500 mt-2 text-sm">Send a message to start collecting metrics.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setActiveView('chat')}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
            title="Back to Chat"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="w-7 h-7 text-indigo-400" />
              Metrics Dashboard
            </h1>
          <p className="text-gray-400 text-sm mt-1">
            {backendSummary?.success
              ? `Backend + Client merged data (${agg.totalQueries} queries)`
              : `Cumulative metrics across all conversations (${agg.totalQueries} queries)`
            }
          </p>
          </div>
        </div>

        {/* Filtreleme ve Auto-refresh kontrolleri */}
        <div className="flex items-center gap-3">
          {/* Time Range Selector */}
          <div className="flex bg-gray-800 rounded-lg border border-gray-700 p-1">
            {(['1d', '7d', '30d'] as const).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                  timeRange === range
                    ? 'bg-indigo-500 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {range === '1d' ? '24h' : range === '7d' ? '7 gün' : '30 gün'}
              </button>
            ))}
          </div>

          {/* Auto-refresh Toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              autoRefresh
                ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400'
                : 'bg-gray-800 border-gray-700 text-gray-500'
            }`}
            title={autoRefresh ? 'Auto-refresh: ON (30s)' : 'Auto-refresh: OFF'}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-spin' : ''}`} style={{ animationDuration: '2s' }} />
            {autoRefresh ? '30s' : 'Off'}
          </button>
        </div>
      </div>

      {/* Top Row: Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <SummaryCard
          icon={MessageSquare}
          label="Total Queries"
          value={String(agg.totalQueries)}
          sub={`Avg ${agg.avgTokensPerQuery.toFixed(0)} tokens/query`}
          accent="bg-indigo-500/20"
        />
        <SummaryCard
          icon={Layers}
          label="Total Tokens"
          value={formatTokens(agg.totalTokens)}
          sub={`Prompt: ${formatTokens(promptTokens)} · Completion: ${formatTokens(completionTokens)}`}
          accent="bg-blue-500/20"
        />
        <SummaryCard
          icon={DollarSign}
          label="Total Cost"
          value={formatCost(agg.totalCost)}
          sub={`${formatCost(agg.costPerToken)} / 1K tokens`}
          accent="bg-emerald-500/20"
        />
        <SummaryCard
          icon={Clock}
          label="Avg Response Time"
          value={formatMs(agg.avgResponseTime)}
          sub={`Total: ${formatMs(agg.retrievalTime + agg.graphRAGTime + agg.toolTime + llmOnlyTime)}`}
          accent="bg-amber-500/20"
        />
      </div>

      {/* Second Row: Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Token Distribution */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-400" />
            Token Distribution
          </h2>

          <BarSegment label="Prompt Tokens" value={formatTokens(promptTokens)} pct={promptPct} color="bg-blue-500" />
          <BarSegment
            label="Completion Tokens"
            value={formatTokens(completionTokens)}
            pct={completionPct}
            color="bg-purple-500"
          />

          <div className="mt-6 pt-4 border-t border-gray-700">
            <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
              <Cpu className="w-4 h-4" />
              Time Breakdown
            </h3>
            <BarSegment label="LLM Inference" value={`${llmPct.toFixed(1)}%`} pct={llmPct} color="bg-indigo-500" />
            <BarSegment label="Retrieval" value={`${retrievalPct.toFixed(1)}%`} pct={retrievalPct} color="bg-cyan-500" />
            <BarSegment label="GraphRAG" value={`${graphRAGPct.toFixed(1)}%`} pct={graphRAGPct} color="bg-teal-500" />
            <BarSegment label="Tools" value={`${toolPct.toFixed(1)}%`} pct={toolPct} color="bg-orange-500" />
          </div>
        </div>

        {/* Cost by Provider */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-emerald-400" />
            Cost by Provider
          </h2>

          {agg.maxProviderBreakdown.length === 0 ? (
            <p className="text-gray-500 text-sm">No provider data available.</p>
          ) : (
            <div>
              {agg.maxProviderBreakdown.map((p) => (
                <BarSegment
                  key={p.name}
                  label={p.name}
                  value={`${formatCost(p.cost)} (${p.pct.toFixed(1)}%)`}
                  pct={p.pct}
                  color="bg-emerald-500"
                />
              ))}
            </div>
          )}

          {/* Quick stats */}
          <div className="mt-6 pt-4 border-t border-gray-700 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Providers Used</p>
              <p className="text-xl font-bold mt-1">{Object.keys(agg.byProvider).length}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Total LLM Calls</p>
              <p className="text-xl font-bold mt-1">
                {Object.values(agg.byProvider).reduce((s, v) => s + v.calls, 0)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Third Row: Detailed Table */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Search className="w-5 h-5 text-gray-400" />
          Provider Breakdown
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="py-3 px-4 font-medium">Provider</th>
                <th className="py-3 px-4 font-medium">Calls</th>
                <th className="py-3 px-4 font-medium">Tokens</th>
                <th className="py-3 px-4 font-medium">Cost</th>
                <th className="py-3 px-4 font-medium">Time</th>
                <th className="py-3 px-4 font-medium">Cost Share</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(agg.byProvider)
                .sort(([, a], [, b]) => b.cost - a.cost)
                .map(([name, v]) => (
                  <ProviderRow
                    key={name}
                    name={name}
                    calls={v.calls}
                    cost={v.cost}
                    tokens={v.tokens}
                    time={v.totalTime}
                    costPct={agg.totalCost > 0 ? (v.cost / agg.totalCost) * 100 : 0}
                  />
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
