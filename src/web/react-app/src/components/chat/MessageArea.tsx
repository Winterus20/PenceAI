import React, { useRef, useEffect } from 'react';
import { MessageStream } from './MessageStream';
import type { Message, FeedbackState } from '../../store/agentStore';

interface MessageAreaProps {
  messages: Message[];
  showThinking: boolean;
  showTools: boolean;
  isReceiving: boolean;
  activeConversationId?: string | null;
  onRegenerate: () => void;
  onQuickAction: (content: string) => void;
  onEditMessage: (content: string) => void;
  onImageClick?: (url: string, alt: string) => void;
  onSendFeedback?: (messageId: string, type: 'positive' | 'negative') => void;
  feedbacks?: Record<string, FeedbackState>;
}

export const MessageArea: React.FC<MessageAreaProps> = ({
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
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isReceiving]);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
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
          onImageClick={onImageClick}
          onSendFeedback={onSendFeedback}
          feedbacks={feedbacks}
        />
      </div>
    </div>
  );
};
