import React, { useRef, useEffect } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { Sparkles, Globe, Code, MessageCircle, BrainCircuit } from 'lucide-react';
import type { Message, MessageMetrics } from '@/store/agentStore';
import { Button } from '@/components/ui/button';
import { MessageBubble } from './MessageBubble';

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
  messageMetrics?: Record<string, MessageMetrics | null>;
}

const quickActions = [
  { text: 'Dosyalarımı listele', icon: <Globe size={16} />, desc: 'Masaüstü dosyalarını görüntüle' },
  { text: 'Bugün hava durumu nasıl?', icon: <Sparkles size={16} />, desc: 'Güncel hava bilgisi al' },
  { text: 'Basit bir Python scripti yaz', icon: <Code size={16} />, desc: 'Hızlı kod üretimi' },
  { text: 'Kendini tanıt, neler yapabilirsin?', icon: <MessageCircle size={16} />, desc: 'Yeteneklerini keşfet' },
];

export const MessageStream: React.FC<MessageStreamProps> = ({
  messages,
  showThinking,
  showTools,
  isReceiving,
  activeConversationId,
  onRegenerate,
  onQuickAction,
  onEditMessage,
  onImageClick,
  onSendFeedback,
  feedbacks,
  messageMetrics,
}) => {
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const virtuosoRef = useRef<HTMLDivElement>(null);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleFeedback = (messageId: string, type: 'positive' | 'negative') => {
    const currentFeedback = feedbacks?.[messageId];
    if (currentFeedback?.type === type) return;
    onSendFeedback?.(messageId, type);
  };

  useEffect(() => {
    if (virtuosoRef.current && messages.length > 0) {
      const scrollContainer = virtuosoRef.current.querySelector('[data-testid="virtuoso-scroller"]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages.length, isReceiving]);

  const renderMessage = (_index: number, msg: Message) => {
    const convId = msg.role === 'assistant' ? (activeConversationId ?? '') : '';
    const metricsForMsg = msg.role === 'assistant' ? (messageMetrics?.[convId] ?? undefined) : undefined;
    if (msg.role === 'assistant' && metricsForMsg) {
      console.log('[MessageStream] Passing metrics to MessageBubble for msg', msg.id, 'convId:', convId);
    }
    return (
    <MessageBubble
      key={msg.id}
      msg={msg}
      showThinking={showThinking}
      showTools={showTools}
      isReceiving={isReceiving}
      copiedId={copiedId}
      onCopy={handleCopy}
      onFeedback={handleFeedback}
      onRegenerate={onRegenerate}
      onEditMessage={onEditMessage}
      onImageClick={onImageClick}
      feedbacks={feedbacks}
      conversationId={msg.role === 'assistant' ? (activeConversationId ?? undefined) : undefined}
      metrics={metricsForMsg}
    />
  );
  };

  /* ─── Empty State ─── */
  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full flex-1 text-center p-8 animate-in fade-in duration-1000">
        {/* Animated Logo */}
        <div className="relative mb-8">
          <div className="h-20 w-20 rounded-3xl bg-gradient-to-br from-purple-600 via-fuchsia-500 to-indigo-500 flex items-center justify-center shadow-2xl shadow-purple-500/30 animate-gradient-slow">
            <BrainCircuit className="h-10 w-10 text-white" />
          </div>
          <div className="absolute -inset-4 rounded-[32px] bg-gradient-to-br from-purple-500/20 to-fuchsia-500/10 blur-xl animate-pulse" />
        </div>

        <h3 className="text-3xl md:text-3xl font-semibold tracking-tight mb-2 text-foreground">
          Ne üzerinde çalışıyorsun?
        </h3>
        <p className="text-sm text-muted-foreground/70 mb-10 max-w-md">
          Projelerine yardım edebilir, kod yazabilir, web'de arama yapabilir veya sadece sohbet edebilirim.
        </p>

        {/* Quick Action Cards */}
        <div className="max-w-2xl w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
          {quickActions.map((action) => (
            <Button
              key={action.text}
              variant="outline"
              className="h-auto rounded-2xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] hover:border-white/20 px-5 py-4 text-left flex items-start gap-3 transition-all duration-300 group"
              onClick={() => onQuickAction?.(action.text)}
            >
              <div className="h-9 w-9 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400 group-hover:bg-purple-500/20 transition-colors flex-shrink-0 mt-0.5">
                {action.icon}
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-foreground/90 mb-0.5">{action.text}</div>
                <div className="text-[11px] text-muted-foreground/60">{action.desc}</div>
              </div>
            </Button>
          ))}
        </div>
      </div>
    );
  }

  /* ─── Message List ─── */
  return (
    <div ref={virtuosoRef} className="h-full w-full px-4 md:px-8">
      <Virtuoso
        data={messages}
        itemContent={renderMessage}
        style={{ height: '100%', width: '100%' }}
        className="subtle-scrollbar"
        followOutput={(isAtBottom) => {
          if (isAtBottom) return 'smooth';
          return false;
        }}
        increaseViewportBy={{ top: 200, bottom: 200 }}
        overscan={5}
      />
    </div>
  );
};
