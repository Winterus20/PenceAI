import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Globe,
  FileText,
  Search,
  Terminal,
  BrainCircuit,
  Zap,
  Database,
  FolderOpen,
  Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolCallItem } from '@/store/agentStore';

/* ─── Tool Icon Mapper ─── */

const TOOL_ICON_MAP: Record<string, React.ReactNode> = {
  readFile: <FileText size={12} />,
  writeFile: <FileText size={12} />,
  listDirectory: <FolderOpen size={12} />,
  searchMemory: <BrainCircuit size={12} />,
  deleteMemory: <BrainCircuit size={12} />,
  saveMemory: <Database size={12} />,
  searchConversation: <Search size={12} />,
  webTool: <Globe size={12} />,
  webSearch: <Globe size={12} />,
  executeShell: <Terminal size={12} />,
};

function getToolIcon(name: string): React.ReactNode {
  // Check exact match
  if (TOOL_ICON_MAP[name]) return TOOL_ICON_MAP[name];

  // Check MCP namespaced tool (mcp:server:tool)
  const parts = name.split(':');
  const toolName = parts.length >= 3 ? parts[2] : name;
  if (TOOL_ICON_MAP[toolName]) return TOOL_ICON_MAP[toolName];

  // Check partial match
  const lowered = name.toLowerCase();
  if (lowered.includes('search') || lowered.includes('find')) return <Search size={12} />;
  if (lowered.includes('file') || lowered.includes('read') || lowered.includes('write')) return <FileText size={12} />;
  if (lowered.includes('web') || lowered.includes('http') || lowered.includes('fetch')) return <Globe size={12} />;
  if (lowered.includes('shell') || lowered.includes('exec') || lowered.includes('command')) return <Terminal size={12} />;
  if (lowered.includes('memory') || lowered.includes('remember')) return <BrainCircuit size={12} />;
  if (lowered.includes('database') || lowered.includes('db') || lowered.includes('sql')) return <Database size={12} />;

  return <Wrench size={12} />;
}

function getToolDisplayName(name: string): string {
  // For MCP tools, extract a readable name
  const parts = name.split(':');
  if (parts.length >= 3) {
    return `${parts[1]}/${parts[2]}`;
  }
  // CamelCase to readable
  return name.replace(/([A-Z])/g, ' $1').trim();
}

/* ─── Status Indicator ─── */

const StatusIcon: React.FC<{ status: ToolCallItem['status'] }> = ({ status }) => {
  switch (status) {
    case 'running':
      return (
        <Loader2
          size={11}
          className="animate-spin text-amber-400"
        />
      );
    case 'success':
      return <CheckCircle2 size={11} className="text-emerald-400" />;
    case 'error':
      return <XCircle size={11} className="text-red-400" />;
  }
};

/* ─── Single Tool Pill ─── */

const ToolPill: React.FC<{ tool: ToolCallItem; index: number }> = ({ tool, index }) => {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.85, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.85, y: -4 }}
      transition={{
        duration: 0.25,
        delay: index * 0.04,
        ease: [0.23, 1, 0.32, 1],
      }}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium tracking-wide',
        'border backdrop-blur-sm transition-all duration-300 shadow-sm',
        tool.status === 'running' &&
          'bg-amber-500/8 border-amber-500/20 text-amber-300 tool-pulse',
        tool.status === 'success' &&
          'bg-emerald-500/8 border-emerald-500/20 text-emerald-300',
        tool.status === 'error' &&
          'bg-red-500/8 border-red-500/20 text-red-300',
      )}
    >
      <span className="opacity-70">{getToolIcon(tool.name)}</span>
      <span className="max-w-[160px] truncate">{getToolDisplayName(tool.name)}</span>
      <StatusIcon status={tool.status} />
    </motion.div>
  );
};

/* ─── Main Component ─── */

export interface ToolCallIndicatorProps {
  toolCalls: ToolCallItem[];
  className?: string;
}

export const ToolCallIndicator: React.FC<ToolCallIndicatorProps> = React.memo(
  ({ toolCalls, className }) => {
    if (!toolCalls?.length) return null;

    const runningCount = toolCalls.filter((t) => t.status === 'running').length;
    const completedCount = toolCalls.filter((t) => t.status !== 'running').length;

    return (
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        className={cn('mb-2 w-full max-w-[85%]', className)}
      >
        {/* Summary header */}
        <div className="flex items-center gap-2 mb-1.5 px-1">
          <Zap size={10} className="text-purple-400/60" />
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60 font-medium">
            {runningCount > 0
              ? `${runningCount} araç çalışıyor`
              : `${completedCount} araç tamamlandı`}
          </span>
        </div>

        {/* Tool pills */}
        <div className="flex flex-wrap gap-1.5">
          <AnimatePresence mode="popLayout">
            {toolCalls.map((tool, index) => (
              <ToolPill
                key={`${tool.name}-${index}`}
                tool={tool}
                index={index}
              />
            ))}
          </AnimatePresence>
        </div>
      </motion.div>
    );
  },
);

ToolCallIndicator.displayName = 'ToolCallIndicator';
