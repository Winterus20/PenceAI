/**
 * MetricsPanel — Compact metrics popover button for MessageBubble.
 * Sits next to 👍/👎/🔄 buttons, opens a floating panel on click.
 */

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clock,
  DollarSign,
  Database,
  Wrench,
  Brain,
  Cpu,
  ChevronDown,
} from 'lucide-react';
import type { MessageMetrics } from '@/store/types';
import { cn } from '@/lib/utils';

interface MetricsPanelProps {
  metrics: MessageMetrics;
  conversationId: string;
  triggerClassName?: string;
}

export const MetricsPanel: React.FC<MetricsPanelProps> = ({ metrics, triggerClassName }) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const perf = metrics.performance;
  const cost = metrics.cost;
  const ctx = metrics.context;

  const maxPerf = Math.max(
    perf.total,
    perf.retrieval,
    perf.tools,
    ...perf.llmCalls.map((c) => c.ms),
    ...Object.values(perf.agentic),
  );

  function formatMs(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  const totalTokens = cost.totalTokens;
  const promptPct = totalTokens > 0 ? ((cost.promptTokens / totalTokens) * 100).toFixed(0) : '0';
  const completionPct = totalTokens > 0 ? ((cost.completionTokens / totalTokens) * 100).toFixed(0) : '0';

  return (
    <div className="relative inline-flex" ref={ref}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((p) => !p)}
        className={cn(
          'h-6 w-6 rounded-none hover:bg-transparent text-foreground/30 hover:text-foreground transition-colors flex items-center justify-center',
          triggerClassName,
        )}
        title="Metrics"
        aria-label="View metrics"
      >
        <Cpu size={12} aria-hidden="true" />
      </button>

      {/* Popover Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-0 mb-2 z-50 w-80 rounded-xl border border-gray-700/60 bg-gray-900/95 backdrop-blur-xl shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-700/50 px-4 py-2">
              <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                <Cpu size={13} />
                Metrics
              </span>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-500 hover:text-gray-300 transition-colors"
              >
                <ChevronDown size={14} />
              </button>
            </div>

            <div className="max-h-[28rem] overflow-y-auto p-4 space-y-3">
              {/* ⏱️ Performance */}
              <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-3.5">
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  <Clock size={12} /> Performans
                </div>
                <div className="space-y-2">
                  {/* Total */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">Toplam</span>
                    <span className="font-mono text-white font-semibold">{formatMs(perf.total)}</span>
                  </div>
                  {/* Breakdown bars */}
                  {[
                    { label: 'Retrieval', ms: perf.retrieval, color: 'bg-blue-500' },
                    { label: 'LLM', ms: perf.llmCalls.reduce((s, c) => s + c.ms, 0), color: 'bg-purple-500' },
                    { label: 'Tools', ms: perf.tools, color: 'bg-green-500' },
                    { label: 'Agentic', ms: Object.values(perf.agentic).reduce((s, v) => s + v, 0), color: 'bg-orange-500' },
                  ]
                    .filter((x) => x.ms > 0)
                    .map((item) => {
                      const pct = maxPerf > 0 ? Math.min((item.ms / maxPerf) * 100, 100) : 0;
                      return (
                        <div key={item.label} className="flex flex-col gap-0.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-400">{item.label}</span>
                            <span className="font-mono text-gray-300">{formatMs(item.ms)}</span>
                          </div>
                          <div className="h-1 w-full overflow-hidden rounded-full bg-gray-700/50">
                            <div className={`h-full rounded-full ${item.color}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* 💰 Cost */}
              <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-3.5">
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  <DollarSign size={12} /> Maliyet
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">Toplam</span>
                    <span className="font-mono text-emerald-400 font-semibold">${cost.total.toFixed(4)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">Token</span>
                    <span className="font-mono text-gray-300">{totalTokens.toLocaleString()}</span>
                  </div>
                  {/* Token split bar */}
                  <div className="h-2 w-full overflow-hidden rounded-full bg-gray-700/50 flex">
                    <div className="h-full bg-purple-500 rounded-l-full" style={{ width: `${promptPct}%` }} />
                    <div className="h-full bg-blue-500 rounded-r-full" style={{ width: `${completionPct}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-gray-500">
                    <span>↓ {promptPct}% ({cost.promptTokens.toLocaleString()})</span>
                    <span>↑ {completionPct}% ({cost.completionTokens.toLocaleString()})</span>
                  </div>
                </div>
              </div>

              {/* 📊 Context */}
              {(ctx.historyTokens || ctx.userMessageTokens || ctx.systemPromptTokens) > 0 && (
                <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-3.5">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                    <Database size={12} /> Bağlam
                  </div>
                  <div className="space-y-1.5 text-xs">
                    {[
                      { label: 'Geçmiş', tokens: ctx.historyTokens, color: 'bg-gray-400' },
                      { label: 'Mesaj', tokens: ctx.userMessageTokens, color: 'bg-blue-400' },
                      { label: 'Sistem', tokens: ctx.systemPromptTokens, color: 'bg-purple-400' },
                    ]
                      .filter((x) => x.tokens > 0)
                      .map((item) => (
                        <div key={item.label} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`h-2 w-2 rounded-full ${item.color}`} />
                            <span className="text-gray-400">{item.label}</span>
                          </div>
                          <span className="font-mono text-gray-300">{item.tokens.toLocaleString()} tok</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* 🧠 Agentic RAG (only if present) */}
              {Object.keys(perf.agentic).length > 0 && (
                <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-3.5">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                    <Brain size={12} /> Agentic RAG
                  </div>
                  <div className="space-y-1.5 text-xs">
                    {Object.entries(perf.agentic).map(([key, ms]) => (
                      <div key={key} className="flex items-center justify-between">
                        <span className="text-gray-400 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                        <span className="font-mono text-gray-300">{formatMs(ms)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 🔧 Tool Calls (only if > 1) */}
              {perf.toolCalls > 1 && (
                <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-3.5">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                    <Wrench size={12} /> Tool Çağrıları
                  </div>
                  <div className="text-xs text-gray-400">
                    {perf.toolCalls} çağrı, {formatMs(perf.tools)} toplam
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MetricsPanel;
