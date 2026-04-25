import { useMemo, useState, useEffect, useCallback } from 'react';
import { useAgentStore } from '@/store/agentStore';
import type { MessageMetrics } from '@/store/types';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Coins,
  Cpu,
  DollarSign,
  Eye,
  Layers,
  MessageSquare,
  RefreshCw,
  Search,
  AlertTriangle,
  TrendingUp,
} from 'lucide-react';
import * as Tabs from '@radix-ui/react-tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  useAllMetrics,
  useMetricsSummary,
} from '@/hooks/queries/useMetrics';
import {
  useProviderStats,
  useErrorStats,
} from '@/hooks/queries/useObservability';
import type { MetricsEntry } from '@/services/observabilityService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatCost(usd: number | undefined | null): string {
  if (usd == null || Number.isNaN(usd)) return 'Ücretsiz';
  if (usd === 0) return 'Ücretsiz';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

/** Backend MetricsEntry → client MessageMetrics */
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
// Shared Sub-components
// ---------------------------------------------------------------------------

const MetricCard = ({
  icon: Icon,
  label,
  value,
  subValue,
  color = 'purple',
}: {
  icon: any;
  label: string;
  value: string | number;
  subValue?: string;
  color?: 'purple' | 'blue' | 'green' | 'orange';
}) => {
  const colorMap = {
    purple: 'from-purple-500/20 to-purple-500/5 border-purple-500/20',
    blue: 'from-blue-500/20 to-blue-500/5 border-blue-500/20',
    green: 'from-green-500/20 to-green-500/5 border-green-500/20',
    orange: 'from-orange-500/20 to-orange-500/5 border-orange-500/20',
  };
  const iconColorMap = {
    purple: 'text-purple-400',
    blue: 'text-blue-400',
    green: 'text-green-400',
    orange: 'text-orange-400',
  };

  return (
    <div className={`rounded-xl border bg-gradient-to-br ${colorMap[color]} p-4`}>
      <div className="flex items-start gap-3">
        <div className={`rounded-lg bg-muted/30 p-2 ${iconColorMap[color]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
          {subValue && <p className="mt-1 text-xs text-muted-foreground">{subValue}</p>}
        </div>
      </div>
    </div>
  );
};

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
        <span className="text-foreground/70">{label}</span>
        <span className="text-muted-foreground">{value}</span>
      </div>
      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

const getLevelIcon = (level: string) => {
  switch (level) {
    case 'ERROR':
      return <AlertTriangle className="h-4 w-4 text-red-400" />;
    case 'WARNING':
      return <AlertTriangle className="h-4 w-4 text-yellow-400" />;
    default:
      return <CheckCircle2 className="h-4 w-4 text-green-400" />;
  }
};

// ---------------------------------------------------------------------------
// Summary Tab
// ---------------------------------------------------------------------------

const SummaryTab = ({
  entries,
  backendSummary,
}: {
  entries: MessageMetrics[];
  backendSummary: { success?: boolean; totalQueries?: number; totalTokens?: number; totalCost?: number; avgResponseTime?: number } | null;
}) => {
  const { data: providerStats } = useProviderStats();

  const totalQueries = entries.length;
  const totalTokens = entries.reduce((s, m) => s + (m.cost.totalTokens ?? 0), 0);
  const totalCost = entries.reduce((s, m) => s + (m.cost.total ?? 0), 0);
  const totalTime = entries.reduce((s, m) => s + (m.performance.total ?? 0), 0);
  const avgResponseTime = totalQueries > 0 ? totalTime / totalQueries : 0;
  const promptTokens = entries.reduce((s, m) => s + (m.cost.promptTokens ?? 0), 0);
  const completionTokens = entries.reduce((s, m) => s + (m.cost.completionTokens ?? 0), 0);
  const totalCtx = promptTokens + completionTokens;
  const promptPct = totalCtx > 0 ? (promptTokens / totalCtx) * 100 : 0;
  const completionPct = totalCtx > 0 ? (completionTokens / totalCtx) * 100 : 0;

  // Time breakdown
  const retrievalTime = entries.reduce((s, m) => s + (m.performance.retrieval ?? 0), 0);
  const graphRAGTime = entries.reduce((s, m) => s + (m.performance.graphRAG ?? 0), 0);
  const toolTime = entries.reduce((s, m) => s + (m.performance.tools ?? 0), 0);
  const llmOnlyTime = Math.max(totalTime - retrievalTime - graphRAGTime - toolTime, 0);
  const retrievalPct = totalTime > 0 ? (retrievalTime / totalTime) * 100 : 0;
  const graphRAGPct = totalTime > 0 ? (graphRAGTime / totalTime) * 100 : 0;
  const toolPct = totalTime > 0 ? (toolTime / totalTime) * 100 : 0;
  const llmPct = totalTime > 0 ? (llmOnlyTime / totalTime) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard
          icon={MessageSquare}
          label="Sorgular"
          value={totalQueries}
          subValue={backendSummary?.success ? `Backend + Client` : 'Client'}
          color="purple"
        />
        <MetricCard
          icon={Coins}
          label="Toplam Maliyet"
          value={formatCost(totalCost)}
          subValue={`${formatCost(totalTokens > 0 ? totalCost / totalTokens * 1000 : 0)} / 1K token`}
          color="green"
        />
        <MetricCard
          icon={Clock}
          label="Ort. Yanıt Süresi"
          value={formatMs(avgResponseTime)}
          subValue={`Toplam: ${formatMs(totalTime)}`}
          color="blue"
        />
        <MetricCard
          icon={Cpu}
          label="Token Kullanımı"
          value={formatTokens(totalTokens)}
          subValue={`↑ ${formatTokens(completionTokens)} · ↓ ${formatTokens(promptTokens)}`}
          color="orange"
        />
      </div>

      {/* Token & Time Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Token Distribution */}
        <div className="rounded-xl border border-border/30 bg-card p-5">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Layers className="h-4 w-4 text-blue-400" />
            Token Dağılımı
          </h3>
          <BarSegment label="Prompt" value={formatTokens(promptTokens)} pct={promptPct} color="bg-blue-500" />
          <BarSegment label="Completion" value={formatTokens(completionTokens)} pct={completionPct} color="bg-purple-500" />
        </div>

        {/* Time Breakdown */}
        <div className="rounded-xl border border-border/30 bg-card p-5">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Clock className="h-4 w-4 text-cyan-400" />
            Zaman Dağılımı
          </h3>
          <BarSegment label="LLM Inference" value={`${llmPct.toFixed(1)}%`} pct={llmPct} color="bg-indigo-500" />
          <BarSegment label="Retrieval" value={`${retrievalPct.toFixed(1)}%`} pct={retrievalPct} color="bg-cyan-500" />
          <BarSegment label="GraphRAG" value={`${graphRAGPct.toFixed(1)}%`} pct={graphRAGPct} color="bg-teal-500" />
          <BarSegment label="Tools" value={`${toolPct.toFixed(1)}%`} pct={toolPct} color="bg-orange-500" />
        </div>
      </div>

      {/* Provider Distribution */}
      {providerStats?.success && Object.keys(providerStats.providerStats).length > 0 && (
        <div className="rounded-xl border border-border/30 bg-card p-5">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
            <DollarSign className="h-4 w-4 text-emerald-400" />
            Provider Dağılımı
          </h3>
          <div className="space-y-2">
            {Object.entries(providerStats.providerStats)
              .filter(([, stats]) => stats != null)
              .sort(([, a], [, b]) => b.count - a.count)
              .slice(0, 8)
              .map(([provider, stats]) => {
                const costShare = totalCost > 0 ? (stats.totalCost / totalCost) * 100 : 0;
                return (
                  <div key={provider} className="flex items-center justify-between rounded-lg bg-muted/30 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-500/10 text-indigo-400">
                        {provider}
                      </span>
                      <span className="text-xs text-muted-foreground">{stats.count} çağrı</span>
                    </div>
                    <div className="flex items-center gap-5 text-xs">
                      <span className="text-muted-foreground">{formatTokens(stats.totalTokens)} token</span>
                      <span className="text-muted-foreground">~{formatMs(stats.avgLatency)}</span>
                      <span className="font-medium text-foreground">{formatCost(stats.totalCost)}</span>
                      <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-500/70 transition-all duration-500"
                          style={{ width: `${Math.min(costShare, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Detail Tab
// ---------------------------------------------------------------------------

const DetailTab = ({
  backendMetrics,
}: {
  backendMetrics: MetricsEntry[];
}) => {
  const { data: providerStats } = useProviderStats();
  const { data: errorStats } = useErrorStats();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const traces = useMemo(() => {
    return backendMetrics.map((m, idx) => ({
      id: m.messageId || `trace-${idx}`,
      name: `Query #${idx + 1}`,
      timestamp: m.timestamp,
      latency: m.performance.total,
      cost: m.cost.total,
      totalTokens: m.cost.totalTokens,
      observations: m.performance.llmCalls.map((call) => ({
        name: call.key,
        model: call.key,
        tokens: 0,
        cost: 0,
        level: 'DEFAULT',
      })),
    }));
  }, [backendMetrics]);

  const filteredTraces = traces.filter(
    (t) =>
      !searchQuery ||
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.observations.some((o) => o.model?.toLowerCase().includes(searchQuery.toLowerCase())),
  );
  const displayedTraces = showAll ? filteredTraces : filteredTraces.slice(0, 15);

  return (
    <div className="flex flex-col gap-6">
      {/* Error Stats */}
      {errorStats?.success && (
        <div className="rounded-xl border border-border/30 bg-card p-5">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
            <AlertTriangle className="h-4 w-4" />
            Hata Oranları
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center rounded-lg bg-muted/30 p-3">
              <p className="text-2xl font-semibold text-foreground">{errorStats.totalTraces}</p>
              <p className="text-xs text-muted-foreground mt-1">Toplam</p>
            </div>
            <div className="text-center rounded-lg bg-muted/30 p-3">
              <p className="text-2xl font-semibold text-green-400">
                {((1 - errorStats.errorRate / 100) * 100).toFixed(1)}%
              </p>
              <p className="text-xs text-muted-foreground mt-1">Başarı Oranı</p>
            </div>
            <div className="text-center rounded-lg bg-muted/30 p-3">
              <p className="text-2xl font-semibold text-red-400">{errorStats.errorTraces}</p>
              <p className="text-xs text-muted-foreground mt-1">Hata</p>
            </div>
          </div>
        </div>
      )}

      {/* Provider Distribution Detailed */}
      {providerStats?.success && (
        <div className="rounded-xl border border-border/30 bg-card p-5">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
            <TrendingUp className="h-4 w-4" />
            Provider Detayları
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/30 text-left text-xs text-muted-foreground uppercase tracking-wider">
                  <th className="py-3 px-4 font-medium">Provider</th>
                  <th className="py-3 px-4 font-medium">Çağrı</th>
                  <th className="py-3 px-4 font-medium">Token</th>
                  <th className="py-3 px-4 font-medium">Maliyet</th>
                  <th className="py-3 px-4 font-medium">Ort. Latency</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(providerStats.providerStats)
                  .filter(([, stats]) => stats != null)
                  .sort(([, a], [, b]) => b.count - a.count)
                  .map(([provider, stats]) => (
                    <tr key={provider} className="border-b border-border/20 hover:bg-muted/30 transition-colors">
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-500/10 text-indigo-400">
                          {provider}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-foreground/70 tabular-nums">{stats.count}</td>
                      <td className="py-3 px-4 text-foreground/70 tabular-nums">{formatTokens(stats.totalTokens)}</td>
                      <td className="py-3 px-4 text-foreground/70 tabular-nums">{formatCost(stats.totalCost)}</td>
                      <td className="py-3 px-4 text-foreground/70 tabular-nums">{formatMs(stats.avgLatency)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Trace List */}
      <div className="rounded-xl border border-border/30 bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Eye className="h-4 w-4" />
            Son LLM Çağrıları
          </h3>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Model veya trace ara..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-48 pl-7 text-xs"
            />
          </div>
        </div>

        <div className="space-y-2">
          {displayedTraces.map((trace) => {
            const isExpanded = expandedId === trace.id;
            return (
              <div key={trace.id}>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : trace.id)}
                  className="flex w-full items-center justify-between rounded-lg bg-muted/30 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                >
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{trace.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(trace.timestamp).toLocaleString('tr-TR')}
                      {trace.observations.length > 0 && <> · {trace.observations.length} observation</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-muted-foreground">{formatMs(trace.latency)}</span>
                    <span className="text-muted-foreground">{formatTokens(trace.totalTokens)} tok</span>
                    <span className="font-medium text-foreground">{formatCost(trace.cost)}</span>
                    {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </button>

                {/* Expanded Trace Detail */}
                {isExpanded && (
                  <div className="ml-6 mt-2 rounded-lg border border-border/20 bg-muted/10 p-3">
                    <div className="space-y-2">
                      {trace.observations.map((obs, idx) => (
                        <div key={idx} className="rounded-md bg-muted/30 px-3 py-2">
                          <div className="flex items-center gap-2">
                            {getLevelIcon(obs.level)}
                            <span className="text-xs font-medium text-foreground">{obs.name}</span>
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-500/10 text-indigo-400">
                              {obs.model || 'unknown'}
                            </span>
                          </div>
                          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                            <span>{obs.tokens || 0} token</span>
                            <span>Maliyet: {formatCost(obs.cost)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {filteredTraces.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">Trace bulunamadı</p>
          )}
        </div>

        {filteredTraces.length > 15 && (
          <Button
            variant="ghost"
            onClick={() => setShowAll(!showAll)}
            className="mt-3 w-full text-xs text-purple-400 hover:text-purple-300"
          >
            {showAll ? (
              <><ChevronUp className="mr-1 h-3 w-3" /> Daha az göster</>
            ) : (
              <><ChevronDown className="mr-1 h-3 w-3" /> {filteredTraces.length - 15} trace daha göster</>
            )}
          </Button>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function MetricsPage() {
  const messageMetrics = useAgentStore((s) => s.messageMetrics);
  const setActiveView = useAgentStore((s) => s.setActiveView);

  const [timeRange, setTimeRange] = useState<'1d' | '7d' | '30d'>('1d');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [activeTab, setActiveTab] = useState('summary');

  // Backend data
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
    const interval = setInterval(refetch, 30_000);
    return () => clearInterval(interval);
  }, [autoRefresh, refetch]);

  // Client + Backend merge
  const entries = useMemo(() => {
    const clientEntries = Object.values(messageMetrics).filter((m): m is MessageMetrics => m != null);
    const backendEntries = (allMetrics?.metrics || []).map(backendToMessageMetrics);
    return [...backendEntries, ...clientEntries];
  }, [allMetrics, messageMetrics]);

  // Empty state
  if (entries.length === 0) {
    return (
      <div className="min-h-screen bg-background text-foreground p-6 flex flex-col">
        <button
          onClick={() => setActiveView('chat')}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4 self-start"
        >
          <ArrowLeft className="w-4 h-4" />
          Sohbete Dön
        </button>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Activity className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
            <h2 className="text-xl font-semibold text-muted-foreground">Henüz Veri Yok</h2>
            <p className="text-muted-foreground/60 mt-2 text-sm">Mesaj göndererek metrik toplamaya başlayın.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border/30 bg-card px-6 py-5 sm:px-7 sm:py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setActiveView('chat')}
              className="flex items-center justify-center rounded-lg p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              title="Sohbete dön"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center gap-3 text-[1.7rem] font-semibold tracking-[-0.03em] sm:text-[1.9rem]">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500/20 text-blue-400">
                  <Activity className="h-5 w-5" />
                </span>
                Observability
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                LLM çağrıları, performans metrikleri ve hata analizleri
              </p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3">
            <div className="flex bg-muted/50 rounded-lg border border-border/40 p-1">
              {(['1d', '7d', '30d'] as const).map((range) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                    timeRange === range ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {range === '1d' ? '24h' : range === '7d' ? '7 gün' : '30 gün'}
                </button>
              ))}
            </div>
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                autoRefresh
                  ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                  : 'bg-muted/50 border-border/40 text-muted-foreground'
              }`}
              title={autoRefresh ? 'Auto-refresh: Açık (30s)' : 'Auto-refresh: Kapalı'}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-spin' : ''}`} style={{ animationDuration: '2s' }} />
              {autoRefresh ? '30s' : 'Off'}
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs.Root value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border/20 bg-muted/10 px-6">
          <Tabs.List className="flex gap-4">
            <Tabs.Trigger
              value="summary"
              className="border-b-2 border-transparent px-3 py-3 text-sm font-medium text-muted-foreground transition-all data-[state=active]:border-blue-400 data-[state=active]:text-foreground"
            >
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Özet
              </div>
            </Tabs.Trigger>
            <Tabs.Trigger
              value="detail"
              className="border-b-2 border-transparent px-3 py-3 text-sm font-medium text-muted-foreground transition-all data-[state=active]:border-blue-400 data-[state=active]:text-foreground"
            >
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Detay
              </div>
            </Tabs.Trigger>
          </Tabs.List>
        </div>

        {/* Tab Content */}
        <div className="subtle-scrollbar overflow-y-auto flex-1">
          <div className="px-6 py-5">
            <Tabs.Content value="summary">
              <SummaryTab entries={entries} backendSummary={backendSummary} />
            </Tabs.Content>
            <Tabs.Content value="detail">
              <DetailTab backendMetrics={allMetrics?.metrics || []} />
            </Tabs.Content>
          </div>
        </div>
      </Tabs.Root>
    </div>
  );
}
