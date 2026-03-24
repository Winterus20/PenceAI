import React, { useRef, useEffect } from 'react';
import { MessageStream } from './MessageStream';
import type { Message, FeedbackState } from '../../store/agentStore';

export interface MessagePanelProps {
  messages: Message[];
  showThinking: boolean;
  showTools: boolean;
  isReceiving: boolean;
  activeConversationId: string | null;
  feedbacks: Record<string, FeedbackState>;
  onRegenerate: () => void;
  onQuickAction: (content: string) => void;
  onEditMessage: (content: string) => void;
  onSendFeedback: (messageId: string, type: 'positive' | 'negative') => void;
}

export const MessagePanel: React.FC<MessagePanelProps> = ({
  messages,
  showThinking,
  showTools,
  isReceiving,
  activeConversationId,
  feedbacks,
  onRegenerate,
  onQuickAction,
  onEditMessage,
  onSendFeedback,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isReceiving]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      <MessageStream
        messages={messages}
        showThinking={showThinking}
        showTools={showTools}
        isReceiving={isReceiving}
        activeConversationId={activeConversationId}
        onRegenerate={onRegenerate}
        onQuickAction={onQuickAction}
        onEditMessage={onEditMessage}
        onSendFeedback={(messageId, type) => onSendFeedback(messageId, type)}
        feedbacks={feedbacks}
      />
    </div>
  );
};
