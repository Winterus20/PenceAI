import { BarChart3, DollarSign, TrendingUp } from 'lucide-react';
import { useUsageStats } from '@/hooks/queries/useUsageStats';
import { useState } from 'react';

const PERIOD_OPTIONS = [
  { value: 'day', label: 'Bugün' },
  { value: 'week', label: 'Bu Hafta' },
  { value: 'month', label: 'Bu Ay' },
  { value: 'all', label: 'Tüm Zamanlar' },
];

function formatNumber(num: number): string {
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  return num.toString();
}

function formatCost(usd: number): string {
  if (usd < 0.01) return '<$0.01';
  return '$' + usd.toFixed(4);
}

export function UsageStatsCard() {
  const [period, setPeriod] = useState('week');
  const { data, isLoading, error } = useUsageStats(period);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-surface bg-surface-xs p-5 text-foreground">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-32 rounded bg-surface-strong/20" />
          <div className="grid grid-cols-2 gap-4">
            <div className="h-16 rounded bg-surface-strong/20" />
            <div className="h-16 rounded bg-surface-strong/20" />
          </div>
          <div className="h-24 rounded bg-surface-strong/20" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-red-400">
        Kullanım istatistikleri yüklenemedi.
      </div>
    );
  }

  if (!data || data.totalTokens === 0) {
    return (
      <div className="rounded-xl border border-surface bg-surface-xs p-5 text-foreground">
        <div className="flex items-center gap-3 text-surface-subtle">
          <BarChart3 className="h-5 w-5" />
          <span>Henüz kullanım verisi yok. LLM çağrıları yaptıkça burada görünecek.</span>
        </div>
      </div>
    );
  }

  const providerEntries = Object.entries(data.providerBreakdown || {});

  return (
    <div className="space-y-5">
      {/* Period Selector */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Token Kullanımı</h3>
        <div className="flex gap-1">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setPeriod(opt.value)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                period === opt.value
                  ? 'bg-purple-500/20 text-purple-400'
                  : 'text-surface-subtle hover:bg-surface-strong/10 hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-surface bg-surface-xs p-4">
          <div className="flex items-center gap-2 text-surface-subtle">
            <BarChart3 className="h-4 w-4" />
            <span className="text-xs">Toplam Token</span>
          </div>
          <div className="mt-1 text-2xl font-bold text-foreground">
            {formatNumber(data.totalTokens)}
          </div>
        </div>
        <div className="rounded-xl border border-surface bg-surface-xs p-4">
          <div className="flex items-center gap-2 text-surface-subtle">
            <DollarSign className="h-4 w-4" />
            <span className="text-xs">Tahmini Maliyet</span>
          </div>
          <div className="mt-1 text-2xl font-bold text-green-400">
            {formatCost(data.totalCost)}
          </div>
        </div>
      </div>

      {/* Provider Breakdown */}
      {providerEntries.length > 0 && (
        <div className="rounded-xl border border-surface bg-surface-xs p-4">
          <div className="mb-3 flex items-center gap-2 text-surface-subtle">
            <TrendingUp className="h-4 w-4" />
            <span className="text-xs font-medium">Provider Dağılımı</span>
          </div>
          <div className="space-y-2.5">
            {providerEntries.map(([provider, stats]) => {
              const pct = data.totalTokens > 0 ? (stats.tokens / data.totalTokens) * 100 : 0;
              return (
                <div key={provider}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium capitalize text-foreground">{provider}</span>
                    <span className="text-surface-subtle">
                      {formatNumber(stats.tokens)} token ({formatCost(stats.cost)})
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-strong/20">
                    <div
                      className="h-full rounded-full bg-purple-500 transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Daily Usage Mini Chart */}
      {data.dailyUsage && data.dailyUsage.length > 0 && (
        <div className="rounded-xl border border-surface bg-surface-xs p-4">
          <div className="mb-3 text-xs font-medium text-surface-subtle">Günlük Kullanım</div>
          <div className="flex items-end gap-1">
            {data.dailyUsage.slice(-7).map((day) => {
              const maxTokens = Math.max(...data.dailyUsage.map((d) => d.tokens), 1);
              const heightPct = (day.tokens / maxTokens) * 100;
              return (
                <div
                  key={day.date}
                  className="group relative flex-1"
                  title={`${day.date}: ${formatNumber(day.tokens)} token`}
                >
                  <div
                    className="w-full rounded-t bg-purple-500/60 transition-all hover:bg-purple-400"
                    style={{ height: `${Math.max(heightPct, 5)}%`, minHeight: '4px' }}
                  />
                  <div className="mt-1 truncate text-center text-[10px] text-surface-subtle">
                    {new Date(day.date).toLocaleDateString('tr-TR', { weekday: 'short' })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
