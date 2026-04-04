import React, { useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Virtuoso } from 'react-virtuoso';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check, ThumbsUp, ThumbsDown, RefreshCw, SquarePen, Wrench, BrainCircuit, Paperclip, ChevronDown } from 'lucide-react';
import type { AttachmentItem, Message, ToolCallItem } from '@/store/agentStore';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface MessageStreamProps {
  messages: Message[];
  showThinking: boolean;
  showTools: boolean;
  isReceiving?: boolean;
  activeConversationId?: string | null;
  onRegenerate?: () => void;
  onQuickAction?: (message: string) => void;
  onEditMessage?: (messageId: string, content: string) => void;
  onImageClick?: (url: string, alt: string) => void;
  onSendFeedback?: (messageId: string, type: 'positive' | 'negative') => void;
  feedbacks?: Record<string, { type: 'positive' | 'negative' }>;
}

const quickActions = [
    'Bilgisayarımdaki Masaüstü dosyalarını listele',
    'Bugün hava durumu nasıl?',
    'Basit bir Python scripti yaz',
    'Kendini tanıt, neler yapabilirsin?',
];

const stripThinkTags = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '');

const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime())
        ? ''
        : date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
};

const CodeBlock = ({ children, className }: { children?: React.ReactNode; className?: string }) => {
    const [copied, setCopied] = React.useState(false);
    const codeText = React.useMemo(() => String(children).replace(/\n$/, ''), [children]);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(codeText);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
    };

    const language = className?.replace('language-', '') || 'text';

    return (
        <div className="border border-border/70 bg-background/40">
            <div className="flex items-center justify-between border-b border-border/70 px-3 py-2 text-label text-muted-foreground">
                <span>{language}</span>
                <button type="button" className="inline-flex items-center gap-1 text-foreground/70 hover:text-foreground" onClick={handleCopy}>
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                    {copied ? 'Kopyalandı' : 'Kopyala'}
                </button>
            </div>
            <pre className="overflow-x-auto p-4 text-sm leading-6 text-foreground"><code>{codeText}</code></pre>
        </div>
    );
};

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
          <div key={`${attachment.fileName}-${index}`} className="border border-border/70 bg-card/60 p-2 text-left text-sm text-foreground/80">
            {isImage && attachment.previewUrl ? (
              <img
                src={attachment.previewUrl}
                alt={attachment.fileName}
                className={cn(
                  "mb-2 h-28 w-28 object-cover",
                  onImageClick && "cursor-pointer hover:opacity-80 transition-opacity"
                )}
                onClick={() => onImageClick?.(attachment.previewUrl!, attachment.fileName)}
              />
            ) : (
              <div className="mb-2 flex h-16 w-20 items-center justify-center border border-dashed border-border/70 text-muted-foreground">
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
    const [expanded, setExpanded] = React.useState(false);

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

const ToolList: React.FC<{ toolCalls: ToolCallItem[] }> = ({ toolCalls }) => {
    return (
        <div className="space-y-3">
            {toolCalls.map((tool, index) => (
                <div key={`${tool.name}-${index}`} className="border border-border/60 bg-background/40 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3 text-tool-label">
                        <span className="font-medium text-foreground">{tool.name}</span>
                        <span className={cn(
                            'font-medium',
                            tool.status === 'error'
                                ? 'text-destructive'
                                : tool.status === 'running'
                                    ? 'text-amber-400'
                                    : 'text-emerald-400'
                        )}>
                            {tool.status === 'running' ? 'çalışıyor' : tool.status === 'error' ? 'hata' : 'tamam'}
                        </span>
                    </div>
                    {tool.arguments ? (
                        <pre className="mb-2 overflow-x-auto whitespace-pre-wrap break-words border border-border/50 bg-card/60 p-2 text-xs text-muted-foreground">
                            {JSON.stringify(tool.arguments, null, 2)}
                        </pre>
                    ) : null}
                    {tool.result ? (
                        <pre className="overflow-x-auto whitespace-pre-wrap break-words border border-border/50 bg-card/60 p-2 text-xs text-foreground/80">
                            {tool.result}
                        </pre>
                    ) : null}
                </div>
            ))}
        </div>
    );
};

export const MessageStream: React.FC<MessageStreamProps> = ({
  messages,
  showThinking,
  showTools,
  isReceiving,
  // activeConversationId is passed from parent but not used in this component
  // It's kept in props interface for potential future use
  activeConversationId: _unused,
  onRegenerate,
  onQuickAction,
  onEditMessage,
  onImageClick,
  onSendFeedback,
  feedbacks,
}) => {
  // Suppress unused variable warning - this prop is intentionally unused
  void _unused;
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const virtuosoRef = useRef<HTMLDivElement>(null);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleFeedback = (messageId: string, type: 'positive' | 'negative') => {
    // Eğer aynı feedback zaten verilmişse, toggle yap (kaldır)
    const currentFeedback = feedbacks?.[messageId];
    if (currentFeedback?.type === type) {
      return; // Aynı tipe tekrar tıklanırsa bir şey yapma (veya kaldırma mantığı eklenebilir)
    }
    onSendFeedback?.(messageId, type);
  };

  // Mesajlar değiştiğinde otomatik scroll
  useEffect(() => {
    if (virtuosoRef.current && messages.length > 0) {
      // Son mesaja scroll
      const scrollContainer = virtuosoRef.current.querySelector('[data-testid="virtuoso-scroller"]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages.length, isReceiving]);

  // Mesaj render fonksiyonu
  const renderMessage = (_index: number, msg: Message) => {
    const isUser = msg.role === 'user';
    const isSystem = msg.role === 'system';

    return (
    	<div
    		key={msg.id}
    		className={cn(
    			"flex flex-col group animate-in slide-in-from-bottom-2 fade-in duration-300 ease-out py-3 w-full",
    			isUser ? "items-end" : "items-start"
    		)}
    	>
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

        {!isUser && !isSystem && msg.toolCalls?.length ? (
          <InlineMetaBlock
            icon={<Wrench size={14} />}
            title="Kullanılan Araçlar"
            count={msg.toolCalls.length}
            visible={showTools}
          >
            <ToolList toolCalls={msg.toolCalls} />
          </InlineMetaBlock>
        ) : null}

        {/* Typographic Content Body (Bubble) */}
        <div className={cn(
          "text-base md:text-[15.5px] leading-relaxed font-normal tracking-[-0.01em] max-w-[85%] w-fit px-5 py-3.5 shadow-sm overflow-hidden",
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
                      return <code className="bg-card/70 px-1.5 py-0.5 text-sm">{children}</code>;
                    }
  
                    return <CodeBlock className={className}>{children}</CodeBlock>;
                  },
                }}
              >
                {stripThinkTags(msg.content)}
              </ReactMarkdown>
            ) : (
              <span className="flex items-center gap-2 opacity-50 text-sm italic">
                {isReceiving || msg.pending ? 'İşleniyor...' : 'Yanıt bekleniyor...'}
              </span>
            )}
          </div>
        </div>

        {/* Ghost Actions & Timestamp */}
        <div className={cn("flex items-center gap-2 mt-2", isUser ? "flex-row-reverse" : "flex-row")}>
          <div className="text-[11px] font-medium text-muted-foreground/50 mx-1">
            {formatTime(msg.timestamp)}
          </div>

        {!isSystem && (
          <div className={cn(
            "flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-300",
            isUser ? "translate-x-2 group-hover:translate-x-0" : "-translate-x-2 group-hover:translate-x-0"
          )}>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded-none hover:bg-transparent text-foreground/30 hover:text-foreground transition-colors"
              onClick={() => handleCopy(msg.id, msg.content)}
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
                  onClick={() => handleFeedback(msg.id, 'positive')}
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
                  onClick={() => handleFeedback(msg.id, 'negative')}
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
              </>
            )}
          </div>
        )}
        </div>
      </div>
    );
  };

    if (messages.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center p-8 animate-in fade-in duration-1000 mt-[10vh]">
                <h3 className="text-3xl md:text-3xl font-semibold tracking-tight mb-8 text-foreground">Ne üzerinde çalışıyorsun?</h3>
                <div className="mt-8 max-w-2xl flex flex-wrap items-center justify-center gap-3">
                    {quickActions.map((action) => (
                        <Button
                            key={action}
                            variant="outline"
                            className="rounded-xl border border-white/10 bg-white/5 text-[13px] font-normal text-foreground/70 hover:bg-white/10 hover:text-foreground hover:border-white/20 px-4 py-2 h-auto"
                            onClick={() => onQuickAction?.(action)}
                        >
                            {action}
                        </Button>
                    ))}
                </div>
            </div>
        );
    }

    return (
      <div
        ref={virtuosoRef}
        className="h-full w-full px-4 md:px-8"
      >
        <Virtuoso
          data={messages}
          itemContent={renderMessage}
          style={{ height: '100%', width: '100%' }}
          className="subtle-scrollbar"
          followOutput={(isAtBottom) => {
            // Yeni mesaj geldiğinde otomatik scroll
            if (isAtBottom) {
              return 'smooth';
            }
            return false;
          }}
          increaseViewportBy={{ top: 200, bottom: 200 }}
          overscan={5}
        />
      </div>
    );
  };
