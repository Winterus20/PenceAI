import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BrainCircuit, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MemorySource } from '@/store/agentStore';

/* ─── Category Color Map ─── */

const CATEGORY_COLORS: Record<string, string> = {
  preference: 'bg-purple-500/15 text-purple-300 border-purple-500/20',
  fact: 'bg-blue-500/15 text-blue-300 border-blue-500/20',
  habit: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20',
  project: 'bg-amber-500/15 text-amber-300 border-amber-500/20',
  event: 'bg-red-500/15 text-red-300 border-red-500/20',
  general: 'bg-slate-500/15 text-slate-300 border-slate-500/20',
};

function getCategoryStyle(category?: string): string {
  return CATEGORY_COLORS[category || 'general'] || CATEGORY_COLORS.general;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 1) + '…';
}

/* ─── Single Source Pill ─── */

const SourcePill: React.FC<{
  source: MemorySource;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
}> = ({ source, index, isExpanded, onToggle }) => {
  const categoryStyle = getCategoryStyle(source.category);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, delay: index * 0.03 }}
    >
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-medium',
          'border backdrop-blur-sm transition-all duration-200',
          'hover:brightness-125 cursor-pointer',
          categoryStyle,
        )}
        title={source.content}
      >
        <BrainCircuit size={9} className="opacity-60" />
        <span className="max-w-[120px] truncate">{truncate(source.content, 30)}</span>
        {source.score != null && (
          <span className="opacity-50 text-[9px]">
            {Math.round(source.score * 100)}%
          </span>
        )}
      </button>

      {/* Expanded content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className={cn(
              'mt-1 px-2.5 py-2 rounded-lg text-[11px] leading-relaxed border',
              'bg-black/30 backdrop-blur-sm',
              categoryStyle,
            )}>
              <p className="text-foreground/80 whitespace-pre-wrap">{source.content}</p>
              <div className="flex items-center gap-3 mt-1.5 text-[9px] text-muted-foreground/50">
                {source.category && (
                  <span className="uppercase tracking-wider">{source.category}</span>
                )}
                {source.importance != null && (
                  <span>önem: {source.importance}/10</span>
                )}
                {source.score != null && (
                  <span>benzerlik: {Math.round(source.score * 100)}%</span>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

/* ─── Main Component ─── */

export interface MemorySourcePillsProps {
  sources: MemorySource[];
  className?: string;
}

export const MemorySourcePills: React.FC<MemorySourcePillsProps> = React.memo(
  ({ sources, className }) => {
    const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
    const [showAll, setShowAll] = useState(false);

    if (!sources?.length) return null;

    const visibleSources = showAll ? sources : sources.slice(0, 3);
    const hiddenCount = sources.length - 3;

    return (
      <div className={cn('mt-2 space-y-1', className)}>
        {/* Header */}
        <div className="flex items-center gap-1.5 px-0.5">
          <BrainCircuit size={10} className="text-purple-400/50" />
          <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground/40 font-medium">
            {sources.length} kaynak kullanıldı
          </span>
        </div>

        {/* Pills */}
        <div className="flex flex-wrap gap-1">
          {visibleSources.map((source, index) => (
            <SourcePill
              key={`source-${source.id}-${index}`}
              source={source}
              index={index}
              isExpanded={expandedIndex === index}
              onToggle={() => setExpandedIndex(expandedIndex === index ? null : index)}
            />
          ))}

          {!showAll && hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium text-muted-foreground/50 hover:text-muted-foreground/80 bg-white/[0.03] border border-white/8 hover:bg-white/[0.06] transition-all"
            >
              +{hiddenCount} daha
              <ChevronDown size={8} />
            </button>
          )}
        </div>
      </div>
    );
  },
);

MemorySourcePills.displayName = 'MemorySourcePills';
