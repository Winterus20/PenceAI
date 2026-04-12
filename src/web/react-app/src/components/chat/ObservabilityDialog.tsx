/**
 * Observability Dialog
 *
 * Yerel observability metriklerini ve trace'lerini gösterir.
 * İki tab: Özet ve Detay
 */

import { useState } from 'react';
import { 
  Activity, 
  BarChart3, 
  Clock, 
  Coins, 
  Cpu, 
  AlertTriangle, 
  CheckCircle2, 
  ChevronDown, 
  ChevronUp,
  Eye,
  Loader2,
  Search,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import * as Tabs from '@radix-ui/react-tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  useObservabilitySummary, 
  useRecentTraces, 
  useProviderStats, 
  useErrorStats,
  useTraceDetail,
} from '@/hooks/queries/useObservability';
import { metaBadgeClassName } from '@/styles/dialog';
import { formatRelativeTime } from '@/lib/utils';

// ========== Utility Functions ==========

const formatCost = (cost: number | undefined | null): string => {
  if (cost == null || isNaN(cost)) return 'Ücretsiz';
  if (cost === 0) return 'Ücretsiz';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
};

const formatLatency = (ms: number | undefined | null): string => {
  if (ms == null || isNaN(ms)) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const formatTokens = (tokens: number | undefined | null): string => {
  if (tokens == null || isNaN(tokens)) return '0';
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return tokens.toString();
};

const getLevelColor = (level: string): string => {
  switch (level) {
    case 'ERROR': return 'text-red-400';
    case 'WARNING': return 'text-yellow-400';
    case 'DEBUG': return 'text-blue-400';
    default: return 'text-green-400';
  }
};

const getLevelIcon = (level: string) => {
  switch (level) {
    case 'ERROR': return <AlertTriangle className="h-4 w-4" />;
    case 'WARNING': return <AlertTriangle className="h-4 w-4" />;
    default: return <CheckCircle2 className="h-4 w-4" />;
  }
};

// ========== Metric Card Component ==========

const MetricCard = ({ 
  icon: Icon, 
  label, 
  value, 
  subValue,
  color = 'purple' 
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
        <div className={`rounded-lg bg-white/5 p-2 ${iconColorMap[color]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <p className="text-xs text-surface-subtle">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
          {subValue && (
            <p className="mt-1 text-xs text-surface-subtle">{subValue}</p>
          )}
        </div>
      </div>
    </div>
  );
};

// ========== Summary Tab ==========

const SummaryTab = () => {
  const { data: summary, isLoading: summaryLoading } = useObservabilitySummary();
  const { data: traces, isLoading: tracesLoading } = useRecentTraces(10);
  const { data: providerStats, isLoading: providerLoading } = useProviderStats();

  if (summaryLoading || tracesLoading || providerLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
      </div>
    );
  }

  if (!summary?.success) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Activity className="mb-4 h-12 w-12 text-surface-subtle" />
        <p className="text-sm text-surface-subtle">
          Henüz veri yok.
        </p>
      </div>
    );
  }

  const { metrics } = summary;

  return (
    <div className="space-y-6">
      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard
          icon={Activity}
          label="Bugünkü Trace"
          value={metrics.tracesToday}
          subValue={`7 gün: ${metrics.tracesLast7Days}`}
          color="purple"
        />
        <MetricCard
          icon={Coins}
          label="Bugünkü Cost"
          value={formatCost(metrics.totalCostToday)}
          subValue={`7 gün: ${formatCost(metrics.totalCostLast7Days)}`}
          color="green"
        />
        <MetricCard
          icon={Clock}
          label="Ort. Latency"
          value={formatLatency(metrics.avgLatency)}
          color="blue"
        />
        <MetricCard
          icon={Cpu}
          label="Token Kullanımı"
          value={formatTokens(metrics.totalTokensToday)}
          subValue={`7 gün: ${formatTokens(metrics.totalTokensLast7Days)}`}
          color="orange"
        />
      </div>

      {/* Provider Stats */}
      {providerStats?.success && Object.keys(providerStats.providerStats).length > 0 && (
        <div className="rounded-lg border border-surface bg-surface-sm p-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Provider Dağılımı</h3>
          <div className="space-y-2">
            {Object.entries(providerStats.providerStats)
              .filter(([, stats]) => stats != null)
              .sort(([, a], [, b]) => b.count - a.count)
              .slice(0, 5)
              .map(([provider, stats]) => (
                <div key={provider} className="flex items-center justify-between rounded-md bg-white/5 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className={metaBadgeClassName}>{provider}</span>
                    <span className="text-xs text-surface-subtle">{stats.count} çağrı</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-surface-subtle">
                      {formatTokens(stats.totalTokens)} token
                    </span>
                    <span className="font-medium text-foreground">
                      {formatCost(stats.totalCost)}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Recent Traces */}
      <div className="rounded-lg border border-surface bg-surface-sm p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Son LLM Çağrıları</h3>
        <div className="space-y-2">
          {traces?.traces?.slice(0, 8).map((trace) => (
            <div key={trace.id} className="flex items-center justify-between rounded-md bg-white/5 px-3 py-2">
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">{trace.name}</p>
                <p className="text-xs text-surface-subtle">
                  {formatRelativeTime(trace.timestamp)}
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-surface-subtle">{formatLatency(trace.latency)}</span>
                <span className="font-medium text-foreground">{formatCost(trace.cost)}</span>
              </div>
            </div>
          ))}
          {(!traces?.traces || traces.traces.length === 0) && (
            <p className="py-4 text-center text-sm text-surface-subtle">Henüz trace bulunmuyor</p>
          )}
        </div>
      </div>
    </div>
  );
};

// ========== Detail Tab ==========

const DetailTab = () => {
  const { data: traces } = useRecentTraces(50);
  const { data: providerStats } = useProviderStats();
  const { data: errorStats } = useErrorStats();
  const [expanded, setExpanded] = useState(false);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const { data: traceDetail, isLoading: detailLoading } = useTraceDetail(selectedTraceId);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredTraces = traces?.traces?.filter(trace => 
    trace.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    trace.observations.some(obs => obs.model?.toLowerCase().includes(searchQuery.toLowerCase()))
  ) || [];

  const displayedTraces = expanded ? filteredTraces : filteredTraces.slice(0, 15);

  return (
    <div className="flex flex-col gap-6" style={{ minHeight: 0 }}>
      {/* Error Stats */}
      {errorStats?.success && (
        <div className="rounded-lg border border-surface bg-surface-sm p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <AlertTriangle className="h-4 w-4" />
            Hata Oranları
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-2xl font-semibold text-foreground">{errorStats.totalTraces}</p>
              <p className="text-xs text-surface-subtle">Toplam</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-semibold text-green-400">
                {((1 - errorStats.errorRate / 100) * 100).toFixed(1)}%
              </p>
              <p className="text-xs text-surface-subtle">Başarı Oranı</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-semibold text-red-400">{errorStats.errorTraces}</p>
              <p className="text-xs text-surface-subtle">Hata</p>
            </div>
          </div>
        </div>
      )}

      {/* Provider Distribution */}
      {providerStats?.success && (
        <div className="rounded-lg border border-surface bg-surface-sm p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <BarChart3 className="h-4 w-4" />
            Provider Dağılımı (Detaylı)
          </h3>
          <div className="space-y-2">
            {Object.entries(providerStats.providerStats)
              .filter(([, stats]) => stats != null)
              .sort(([, a], [, b]) => b.count - a.count)
              .map(([provider, stats]) => (
                <div key={provider} className="rounded-md bg-white/5 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className={metaBadgeClassName}>{provider}</span>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-surface-subtle">{stats.count} çağrı</span>
                      <span className="text-surface-subtle">~{formatLatency(stats.avgLatency)}</span>
                      <span className="font-medium text-foreground">{formatCost(stats.totalCost)}</span>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Trace List */}
      <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-surface bg-surface-sm p-4">
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Trace Detayları</h3>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-surface-subtle" />
            <Input
              placeholder="Model veya trace ara..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-48 pl-7 text-xs"
            />
          </div>
        </div>

        <div className="space-y-2">
          {displayedTraces.map((trace) => (
            <div key={trace.id} className="space-y-2">
              <button
                onClick={() => setSelectedTraceId(selectedTraceId === trace.id ? null : trace.id)}
                className="flex w-full items-center justify-between rounded-md bg-white/5 px-3 py-2 transition-colors hover:bg-white/10"
              >
                <div className="flex-1 text-left">
                  <p className="text-sm font-medium text-foreground">{trace.name}</p>
                  <p className="text-xs text-surface-subtle">
                    {formatRelativeTime(trace.timestamp)}
                    {trace.observations.length > 0 && (
                      <> · {trace.observations.length} observation</>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-surface-subtle">{formatLatency(trace.latency)}</span>
                  <span className="text-surface-subtle">{formatTokens(trace.totalTokens)} token</span>
                  <span className="font-medium text-foreground">{formatCost(trace.cost)}</span>
                  {selectedTraceId === trace.id ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </div>
              </button>

              {/* Trace Detail Expanded */}
              {selectedTraceId === trace.id && (
                <div className="ml-4 rounded-md border border-surface bg-surface-xs p-3">
                  {traceDetail?.trace ? (
                    <div className="space-y-2">
                      {traceDetail.trace.observations.map((obs) => (
                        <div key={obs.id} className="rounded-sm bg-white/5 px-3 py-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {getLevelIcon(obs.level)}
                              <span className="text-xs font-medium text-foreground">{obs.name}</span>
                              <span className={metaBadgeClassName}>{obs.model || 'unknown'}</span>
                            </div>
                            <span className={`flex items-center gap-1 text-xs ${getLevelColor(obs.level)}`}>
                              {obs.level}
                            </span>
                          </div>
                          <div className="mt-2 flex items-center gap-4 text-xs text-surface-subtle">
                            <span>Input: {obs.usage.input} token</span>
                            <span>Output: {obs.usage.output} token</span>
                            <span>Cost: {formatCost(obs.cost)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : detailLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {trace.observations.map((obs, idx) => (
                        <div key={idx} className="rounded-sm bg-white/5 px-3 py-2">
                          <div className="flex items-center gap-2">
                            {getLevelIcon(obs.level)}
                            <span className="text-xs font-medium text-foreground">{obs.name}</span>
                            <span className={metaBadgeClassName}>{obs.model || 'unknown'}</span>
                          </div>
                          <div className="mt-2 flex items-center gap-4 text-xs text-surface-subtle">
                            <span>{obs.tokens || 0} token</span>
                            <span>Cost: {formatCost(obs.cost)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {filteredTraces.length === 0 && (
            <p className="py-4 text-center text-sm text-surface-subtle">Trace bulunamadı</p>
          )}
        </div>

        {/* Show More Button */}
        {filteredTraces.length > 15 && (
          <Button
            variant="ghost"
            onClick={() => setExpanded(!expanded)}
            className="mt-3 w-full text-xs text-purple-400 hover:text-purple-300"
          >
            {expanded ? (
              <>
                <ChevronUp className="mr-1 h-3 w-3" />
                Daha az göster
              </>
            ) : (
              <>
                <ChevronDown className="mr-1 h-3 w-3" />
                {filteredTraces.length - 15} trace daha göster
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
};

// ========== Main Dialog Component ==========

export const ObservabilityDialog = ({ 
  open, 
  onOpenChange, 
  inline = false 
}: { 
  open: boolean; 
  onOpenChange: (o: boolean) => void; 
  inline?: boolean; 
}) => {
  const [activeTab, setActiveTab] = useState('summary');

  const content = (
    <div className="glass-panel flex max-h-[calc(100dvh-2rem)] flex-col text-foreground">
      {/* Header */}
      <div className="shrink-0 border-b border-surface bg-surface-sm px-6 py-5 sm:px-7 sm:py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-[1.7rem] font-semibold tracking-[-0.03em] text-foreground sm:text-[1.9rem]">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500/20 text-blue-400">
                <Activity className="h-5 w-5" />
              </span>
              Observability
            </div>
            <p className="max-w-3xl text-sm leading-6 text-surface-subtle sm:text-[15px]">
              LLM çağrıları, performans metrikleri ve hata analizleri.
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs.Root value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-surface bg-surface-xs px-6">
          <Tabs.List className="flex gap-4">
            <Tabs.Trigger
              value="summary"
              className="border-b-2 border-transparent px-3 py-3 text-sm font-medium text-surface-subtle transition-all data-[state=active]:border-blue-400 data-[state=active]:text-foreground"
            >
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Özet
              </div>
            </Tabs.Trigger>
            <Tabs.Trigger
              value="detail"
              className="border-b-2 border-transparent px-3 py-3 text-sm font-medium text-surface-subtle transition-all data-[state=active]:border-blue-400 data-[state=active]:text-foreground"
            >
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Detay
              </div>
            </Tabs.Trigger>
          </Tabs.List>
        </div>

        {/* Tab Content */}
        <div className="subtle-scrollbar overflow-y-auto" style={{ maxHeight: 'calc(100dvh - 12rem)' }}>
          <div className="px-6 py-4">
            <Tabs.Content value="summary">
              <SummaryTab />
            </Tabs.Content>
            <Tabs.Content value="detail">
              <DetailTab />
            </Tabs.Content>
          </div>
        </div>
      </Tabs.Root>
    </div>
  );

  if (inline) {
    return content;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-panel flex max-h-[calc(100dvh-1.5rem)] w-[min(96vw,90rem)] max-w-[95vw] md:max-w-4xl flex-col overflow-hidden p-0 text-foreground">
        <VisuallyHidden.Root>
          <DialogTitle>Observability</DialogTitle>
          <DialogDescription>LLM çağrıları, performans metrikleri ve hata analizleri.</DialogDescription>
        </VisuallyHidden.Root>
        {content}
      </DialogContent>
    </Dialog>
  );
};
