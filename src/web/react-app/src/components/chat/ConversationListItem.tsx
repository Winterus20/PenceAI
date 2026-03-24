import React, { useState, useRef, useEffect } from 'react';
import { Pin, PinOff, Trash2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAgentStore } from '@/store/agentStore';
import toast from 'react-hot-toast';

export interface ConversationItem {
  id: string;
  title?: string;
  user_name?: string;
  message_count?: number;
  created_at?: string;
  updated_at?: string;
}

interface ConversationListItemProps {
  conversation: ConversationItem;
  isActive: boolean;
  isPinned: boolean;
  onSelect: (id: string) => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
}

const normalizeTimestamp = (value?: string) => {
  if (!value) return new Date().toISOString();
  if (value.endsWith('Z')) return value;
  return value.includes('T') ? `${value}Z` : value.replace(' ', 'T') + 'Z';
};

export const ConversationListItem: React.FC<ConversationListItemProps> = ({
  conversation,
  isActive,
  isPinned,
  onSelect,
  onTogglePin,
  onDelete,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const updateConversationTitle = useAgentStore((state) => state.updateConversationTitle);
  const selectedConversationIds = useAgentStore((state) => state.selectedConversationIds);
  const toggleConversationSelection = useAgentStore((state) => state.toggleConversationSelection);

  const isSelected = selectedConversationIds.includes(conversation.id);

  const displayName = conversation.title || conversation.user_name || 'Sohbet';
  const messageCount = conversation.message_count || 0;
  const timestamp = normalizeTimestamp(conversation.updated_at || conversation.created_at);
  const formattedDate = new Date(timestamp).toLocaleDateString('tr-TR');

  // Input'a odaklanma
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Double-click handler
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditTitle(conversation.title || '');
    setIsEditing(true);
  };

  // API çağrısı ile başlık güncelleme
  const saveTitle = async (newTitle: string) => {
    const trimmedTitle = newTitle.trim();
    
    // Başlık boşsa veya değişmediyse kaydetme
    if (!trimmedTitle || trimmedTitle === conversation.title) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`/api/conversations/${conversation.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: trimmedTitle }),
      });

      if (!response.ok) {
        throw new Error('Başlık güncellenemedi');
      }

      // Store'da güncelle
      updateConversationTitle(conversation.id, trimmedTitle);
      
      toast.success('Sohbet başlığı güncellendi');
    } catch (error) {
      console.error('Rename error:', error);
      toast.error('Başlık güncellenirken bir hata oluştu');
    } finally {
      setIsSaving(false);
      setIsEditing(false);
    }
  };

  // Input blur handler
  const handleBlur = () => {
    if (!isSaving) {
      saveTitle(editTitle);
    }
  };

  // Keyboard handler
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveTitle(editTitle);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsEditing(false);
      setEditTitle('');
    }
  };

  // Seçim toggle handler
  const handleToggleSelection = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleConversationSelection(conversation.id);
  };

  return (
    <div
      className={`w-full border transition-colors duration-200 ${
        isSelected
          ? 'border-purple-500/50 bg-purple-500/10'
          : isActive
          ? 'border-foreground/40 bg-white/[0.07]'
          : 'border-border/60 bg-white/[0.03] hover:bg-white/[0.06]'
      }`}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex items-start justify-between gap-2 p-3">
        {/* Checkbox - sol tarafta */}
        <button
          type="button"
          role="checkbox"
          aria-checked={isSelected}
          aria-label={`${displayName} sohbetini seç`}
          onClick={handleToggleSelection}
          className={`flex-shrink-0 w-5 h-5 rounded border flex items-center justify-center transition-all focus:ring-2 focus:ring-purple-500/50 focus:ring-offset-1 focus:ring-offset-background ${
            isSelected
              ? 'bg-purple-500 border-purple-500 text-white'
              : isHovered
              ? 'border-foreground/40 bg-white/[0.05] hover:border-foreground/60'
              : 'border-transparent'
          }`}
        >
          {isSelected && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
        
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <Input
              ref={inputRef}
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              disabled={isSaving}
              className="h-7 w-full px-2 text-sm font-medium"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <button
              type="button"
              onClick={() => onSelect(conversation.id)}
              className="min-w-0 flex-1 text-left w-full"
            >
              <div className="truncate font-medium text-foreground/90 cursor-pointer">
                {displayName}
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-label-sm uppercase text-muted-foreground">
                <span>{messageCount} mesaj</span>
                <span>{formattedDate}</span>
              </div>
            </button>
          )}
        </div>
        {!isEditing && (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-none"
              onClick={() => onTogglePin(conversation.id)}
              aria-label={isPinned ? `${displayName} sabitlemesini kaldır` : `${displayName} sohbetini sabitle`}
              title={isPinned ? 'Sabitlemeyi kaldır' : 'Sabitle'}
            >
              {isPinned ? <PinOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Pin className="h-3.5 w-3.5" aria-hidden="true" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-none text-destructive"
              onClick={() => onDelete(conversation.id)}
              aria-label={`${displayName} sohbetini sil`}
              title="Sohbeti sil"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
