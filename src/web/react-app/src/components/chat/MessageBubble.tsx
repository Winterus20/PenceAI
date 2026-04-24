import React, { useMemo, useState, lazy, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check, ThumbsUp, ThumbsDown, RefreshCw, SquarePen, BrainCircuit, Paperclip, ChevronDown, Sparkles, GitBranch } from 'lucide-react';
import type { AttachmentItem, Message, MessageMetrics } from '@/store/agentStore';
import type { ConversationBranchInfo } from '@/store/types';
import { cn } from '@/lib/utils';
import { stripThinkTags, formatTime, stripOuterBackticks } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { MetricsPanel } from './MetricsPanel';
import { ToolCallIndicator } from './ToolCallIndicator';
import { MemorySourcePills } from './MemorySourcePills';

const CodeBlock = lazy(() => import('./CodeBlock').then(m => ({ default: m.CodeBlock })));

/* ─── Sub-components ─── */

const AttachmentPreview: React.FC<{
  attachments?: AttachmentItem[];
  onImageClick?: (url: string, alt: string) => void;
}> = ({ attachments, onImageClick }) => {
  if (!attachments?.length) return null;

  return (
    <div className="mb-4 flex flex-wrap gap-3">
      {attachments.map((attachment, index) => {
        const isImage = attachment.mimeType?.startsWith('image/');

        return (
          <div key={`${attachment.fileName}-${index}`} className="border border-border/70 bg-card/60 p-2 text-left text-sm text-foreground/80 rounded-xl">
            {isImage && attachment.previewUrl ? (
              <img
                src={attachment.previewUrl}
                alt={attachment.fileName}
                className={cn(
                  "mb-2 h-28 w-28 object-cover rounded-lg",
                  onImageClick && "cursor-pointer hover:opacity-80 transition-opacity"
                )}
                onClick={() => onImageClick?.(attachment.previewUrl!, attachment.fileName)}
              />
            ) : (
              <div className="mb-2 flex h-16 w-20 items-center justify-center border border-dashed border-border/70 text-muted-foreground rounded-lg">
                <Paperclip size={16} />
              </div>
            )}
            <div className="max-w-32 truncate font-medium">{attachment.fileName}</div>
            <div className="text-xs text-muted-foreground">
              {attachment.size ? `${(attachment.size / 1024).toFixed(1)} KB` : attachment.mimeType}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const InlineMetaBlock: React.FC<{
  icon: React.ReactNode;
  title: string;
  count: number;
  visible: boolean;
  children: React.ReactNode;
}> = ({ icon, title, count, visible, children }) => {
  const [expanded, setExpanded] = useState(false);

  if (!visible || count === 0) return null;

  return (
    <div className="mb-3 w-full max-w-[85%] border border-border/40 bg-card/60 text-sm text-foreground/80 rounded-xl overflow-hidden shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
      >
        <span className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
          {icon}
          {title}
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-foreground/70">{count}</span>
        </span>
        <motion.div
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown size={14} className="text-muted-foreground" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.04, 0.62, 0.23, 0.98] }}
          >
            <div className="border-t border-border/40 px-4 py-3 bg-black/20">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const BranchDropdown: React.FC<{
  branches: ConversationBranchInfo[];
  onLoadBranch: (conversationId: string) => void;
}> = ({ branches, onLoadBranch }) => {
  const [open, setOpen] = useState(false);

  if (branches.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[11px] text-purple-400/70 hover:text-purple-300 transition-colors px-1.5 py-0.5 rounded-md hover:bg-purple-500/10"
      >
        <GitBranch size={10} />
        {branches.length} dal
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 bg-card border border-border/60 rounded-lg shadow-lg py-1 min-w-[180px] z-50">
          {branches.map((branch) => (
            <button
              key={branch.id}
              type="button"
              onClick={() => { onLoadBranch(branch.id); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-sm text-foreground/80 hover:bg-white/5 truncate"
            >
              {branch.title || 'Başlıksız Dal'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ─── Main Component ─── */

export interface MessageBubbleProps {
  msg: Message;
  showThinking: boolean;
  showTools: boolean;
  isReceiving?: boolean;
  copiedId: string | null;
  onCopy: (id: string, text: string) => void;
  onFeedback?: (messageId: string, type: 'positive' | 'negative') => void;
  onRegenerate?: () => void;
  onEditMessage?: (messageId: string, content: string) => void;
  onImageClick?: (url: string, alt: string) => void;
  feedbacks?: Record<string, { type: 'positive' | 'negative' }>;
  conversationId?: string;
  metrics?: MessageMetrics;
  memorySaved?: boolean;
  onFork?: (messageId: string, dbMessageId?: number) => void;
  branchesForMessage?: ConversationBranchInfo[];
  onLoadBranch?: (conversationId: string) => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = React.memo(({
  msg,
  showThinking,
  showTools,
  isReceiving,
  copiedId,
  onCopy,
  onFeedback,
  onRegenerate,
  onEditMessage,
  onImageClick,
  feedbacks,
  conversationId,
  metrics,
  memorySaved,
  onFork,
  branchesForMessage,
  onLoadBranch,
}) => {
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';
  const cleanContent = useMemo(() => stripThinkTags(msg.content), [msg.content]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
      className={cn(
        "flex gap-3 group py-3 w-full",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      {/* Avatar */}
      <div className="flex-shrink-0 mt-1 relative">
        {isUser ? (
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-purple-600 to-indigo-500 flex items-center justify-center text-[11px] font-bold text-white uppercase shadow-lg shadow-purple-500/20">
            K
          </div>
        ) : (
          <div className={cn(
            "h-8 w-8 rounded-full bg-gradient-to-br from-violet-500 via-fuchsia-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-purple-500/30 animate-gradient-slow",
            memorySaved && "memory-sparkle-ring"
          )}>
            <BrainCircuit size={15} />
          </div>
        )}
        {/* Memory saved sparkle */}
        <AnimatePresence>
          {memorySaved && !isUser && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
              className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-gradient-to-br from-amber-400 to-yellow-500 flex items-center justify-center shadow-lg shadow-amber-500/30"
              title="Bilgi belleğe kaydedildi"
            >
              <Sparkles size={9} className="text-white" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Content Column */}
      <div className={cn("flex flex-col max-w-[82%] min-w-0", isUser ? "items-end" : "items-start")}>
        {/* Thinking */}
        {!isUser && !isSystem && msg.thinking?.length ? (
          <InlineMetaBlock
            icon={<BrainCircuit size={14} />}
            title="Düşünce Süreci"
            count={msg.thinking.length}
            visible={showThinking}
          >
            <div className="space-y-2 text-[13px] leading-relaxed text-foreground/75">
              {msg.thinking.map((entry, idx) => (
                <div key={`${msg.id}-thinking-${idx}`} className="border-l-2 border-purple-500/30 pl-3 py-1">
                  {entry}
                </div>
              ))}
            </div>
          </InlineMetaBlock>
        ) : null}

        {/* Tools — compact pill indicators */}
        {!isUser && !isSystem && msg.toolCalls?.length && showTools ? (
          <ToolCallIndicator toolCalls={msg.toolCalls} />
        ) : null}

        {/* Bubble */}
        <div className={cn(
          "text-base md:text-[15.5px] leading-relaxed font-normal tracking-[-0.01em] w-fit px-5 py-3.5 shadow-sm overflow-hidden",
          isUser
            ? "bg-[#2f2f2f] text-foreground/90 rounded-[22px] rounded-br-sm"
            : isSystem
            ? "bg-destructive/10 text-destructive/80 italic border border-destructive/20 rounded-[22px]"
            : "bg-card border border-border/40 text-foreground rounded-[22px] rounded-bl-sm"
        )}>
          <AttachmentPreview attachments={msg.attachments} onImageClick={onImageClick} />
          <div className={cn(
            "prose dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-black/40 prose-pre:border prose-pre:border-white/5 prose-pre:rounded-xl prose-pre:p-4 hover:prose-a:text-foreground",
            isUser ? "prose-p:mb-0 text-left" : "prose-p:mb-4"
          )}>
            {msg.content ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code(props: React.ClassAttributes<HTMLElement> & React.HTMLAttributes<HTMLElement> & { inline?: boolean; className?: string }) {
                    const { inline, className, children } = props;

                    if (inline) {
                      return <code className="bg-card/70 px-1.5 py-0.5 text-sm rounded">{children}</code>;
                    }

                    return <Suspense fallback={<code className="bg-card/70 px-1.5 py-0.5 text-sm rounded">{children}</code>}><CodeBlock className={className}>{children}</CodeBlock></Suspense>;
                  },
                }}
              >
                {stripOuterBackticks(cleanContent)}
              </ReactMarkdown>
            ) : (
              <span className="flex items-center gap-2 text-sm italic">
                {isReceiving || msg.pending ? (
                  <span className="flex items-center gap-1.5 text-foreground/50">
                    <span className="streaming-dots flex gap-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-400/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-400/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-400/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                    düşünüyor...
                  </span>
                ) : 'Yanıt bekleniyor...'}
              </span>
            )}
          </div>
        </div>

        {/* Memory Source Pills — RAG provenance */}
        {!isUser && !isSystem && msg.sources?.length ? (
          <MemorySourcePills sources={msg.sources} />
        ) : null}

        {/* Ghost Actions & Timestamp */}
        <div className={cn("flex items-center gap-2 mt-1.5", isUser ? "flex-row-reverse" : "flex-row")}>
          <div className="text-[11px] font-medium text-muted-foreground/50 mx-1">
            {formatTime(msg.timestamp)}
          </div>
          {branchesForMessage && branchesForMessage.length > 0 && onLoadBranch && (
            <BranchDropdown branches={branchesForMessage} onLoadBranch={onLoadBranch} />
          )}

          {!isSystem && (
            <div className={cn(
              "flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-300",
              isUser ? "translate-x-2 group-hover:translate-x-0" : "-translate-x-2 group-hover:translate-x-0"
            )}>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-none hover:bg-transparent text-foreground/30 hover:text-foreground transition-colors"
                onClick={() => onCopy(msg.id, msg.content)}
                aria-label={copiedId === msg.id ? 'Kopyalandı' : 'Mesajı kopyala'}
                title="Kopyala"
              >
                {copiedId === msg.id ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
              </Button>
              {isUser ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-none hover:bg-transparent text-foreground/30 hover:text-foreground transition-colors"
                  onClick={() => onEditMessage?.(msg.id, msg.content)}
                  aria-label="Mesajı düzenle"
                  title="Düzenle"
                >
                  <SquarePen size={12} aria-hidden="true" />
                </Button>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'h-6 w-6 rounded-none hover:bg-transparent transition-colors',
                      feedbacks?.[msg.id]?.type === 'positive' ? 'text-emerald-400' : 'text-foreground/30 hover:text-foreground'
                    )}
                    onClick={() => onFeedback?.(msg.id, 'positive')}
                    aria-label="Yanıt beğenildi olarak işaretle"
                    aria-pressed={feedbacks?.[msg.id]?.type === 'positive'}
                    title="Beğen"
                  >
                    <ThumbsUp size={12} aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'h-6 w-6 rounded-none hover:bg-transparent transition-colors',
                      feedbacks?.[msg.id]?.type === 'negative' ? 'text-destructive' : 'text-foreground/30 hover:text-foreground'
                    )}
                    onClick={() => onFeedback?.(msg.id, 'negative')}
                    aria-label="Yanıt beğenilmedi olarak işaretle"
                    aria-pressed={feedbacks?.[msg.id]?.type === 'negative'}
                    title="Beğenme"
                  >
                    <ThumbsDown size={12} aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 rounded-none hover:bg-transparent text-foreground/30 hover:text-foreground transition-colors"
                    onClick={onRegenerate}
                    aria-label="Yanıtı yeniden oluştur"
                    title="Yeniden oluştur"
                  >
                    <RefreshCw size={12} aria-hidden="true" />
                  </Button>
                  {onFork && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 rounded-none hover:bg-transparent text-foreground/30 hover:text-foreground transition-colors"
                      onClick={() => onFork(msg.id, msg.dbId)}
                      aria-label="Bu mesajdan dallandır"
                      title="Dallandır"
                    >
                      <GitBranch size={12} aria-hidden="true" />
                    </Button>
                  )}
                  {metrics && (
                    <MetricsPanel
                      metrics={metrics}
                      conversationId={conversationId ?? ''}
                      triggerClassName="h-6 w-6 rounded-none hover:bg-transparent text-foreground/30 hover:text-foreground transition-colors"
                    />
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
});

MessageBubble.displayName = 'MessageBubble';
