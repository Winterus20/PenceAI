import React, { useState } from 'react';
import { Search, Plus, Pin, PinOff, Trash2, PanelLeftClose, MoreVertical, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ConversationItem, ActiveView } from '../../store/agentStore';
import { normalizeTimestamp, formatRelativeTime } from '@/lib/utils';
import { SidebarMenu } from './SidebarMenu';

export type SortOrder = 'newest' | 'oldest' | 'messages';

export interface GroupedConversations {
  pinned: ConversationItem[];
  groups: {
    today: ConversationItem[];
    yesterday: ConversationItem[];
    thisWeek: ConversationItem[];
    older: ConversationItem[];
  };
}

export interface ConversationPanelProps {
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  sortOrder: SortOrder;
  conversations: ConversationItem[];
  activeConversationId: string | null;
  pinnedConversations: string[];
  onNewChat: () => void;
  onLoadConversation: (id: string) => void;
  onTogglePinned: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation?: (id: string, title: string) => void;
  stats?: {
    conversations: number;
    messages: number;
    memories: number;
  } | null;
  isConnected: boolean;
  isMobile?: boolean;
  onCloseMobile?: () => void;
  onToggleSidebar?: () => void;
}

export const ConversationPanel: React.FC<ConversationPanelProps> = ({
  setActiveView,
  searchQuery,
  setSearchQuery,
  sortOrder,
  conversations,
  activeConversationId,
  pinnedConversations,
  onNewChat,
  onLoadConversation,
  onTogglePinned,
  onDeleteConversation,
  onRenameConversation,
  isConnected,
  isMobile = false,
  onCloseMobile,
  onToggleSidebar,
}) => {
  const groupedConversations = React.useMemo(() => {
    const filtered = conversations
      .filter((conversation) => (conversation.title || conversation.user_name || 'Sohbet').toLowerCase().includes(searchQuery.trim().toLowerCase()))
      .sort((a, b) => {
        if (sortOrder === 'oldest') {
          return new Date(normalizeTimestamp(a.created_at)).getTime() - new Date(normalizeTimestamp(b.created_at)).getTime();
        }

        if (sortOrder === 'messages') {
          return (b.message_count || 0) - (a.message_count || 0);
        }

        return new Date(normalizeTimestamp(b.updated_at || b.created_at)).getTime() - new Date(normalizeTimestamp(a.updated_at || a.created_at)).getTime();
      });

    const pinned = filtered.filter((conversation) => pinnedConversations.includes(conversation.id));
    const others = filtered.filter((conversation) => !pinnedConversations.includes(conversation.id));

    const groups: Record<string, typeof others> = { today: [], yesterday: [], thisWeek: [], older: [] };
    const now = new Date();
    const today = now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const oneWeekAgo = new Date(now);
    oneWeekAgo.setDate(now.getDate() - 7);

    others.forEach((conversation) => {
      const date = new Date(normalizeTimestamp(conversation.updated_at || conversation.created_at));
      if (date.toDateString() === today) groups.today.push(conversation);
      else if (date.toDateString() === yesterday.toDateString()) groups.yesterday.push(conversation);
      else if (date >= oneWeekAgo) groups.thisWeek.push(conversation);
      else groups.older.push(conversation);
    });

    return { pinned, groups };
  }, [conversations, pinnedConversations, searchQuery, sortOrder]);

  const handleLoadConversation = (id: string) => {
    onLoadConversation(id);
    if (isMobile && onCloseMobile) {
      onCloseMobile();
    }
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const handleStartRename = (conversation: ConversationItem) => {
    setEditingId(conversation.id);
    setEditTitle(conversation.title || '');
  };

  const handleSaveRename = (id: string) => {
    const trimmed = editTitle.trim();
    if (trimmed && onRenameConversation) {
      onRenameConversation(id, trimmed);
    }
    setEditingId(null);
    setEditTitle('');
  };

  const renderConversationItem = (conversation: ConversationItem, isPinned: boolean) => {
    const isEditing = editingId === conversation.id;

    return (
      <div
        key={conversation.id}
        className={`group w-full rounded-lg transition-colors ${activeConversationId === conversation.id ? 'bg-white/10' : 'hover:bg-white/5'}`}
      >
        <div className="flex items-center justify-between gap-2 p-2 px-3">
          {isEditing ? (
            <div className="flex-1 flex gap-1">
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveRename(conversation.id);
                  if (e.key === 'Escape') { setEditingId(null); setEditTitle(''); }
                }}
                onBlur={() => handleSaveRename(conversation.id)}
                autoFocus
                className="flex-1 h-7 px-2 text-sm bg-white/10 border border-white/20 rounded text-foreground focus:outline-none focus:ring-1 focus:ring-white/30"
              />
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => handleLoadConversation(conversation.id)}
                className="min-w-0 flex-1 text-left flex flex-col gap-0.5"
              >
                <div className="truncate text-[14px] font-normal text-foreground/90">{conversation.title || conversation.user_name || 'Sohbet'}</div>
                <div className="text-[11px] text-muted-foreground/50">{formatRelativeTime(conversation.updated_at || conversation.created_at)}</div>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/10"
                  >
                    <MoreVertical className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[160px]">
                  <DropdownMenuItem onClick={() => handleStartRename(conversation)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Yeniden Adlandır
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onTogglePinned(conversation.id)}>
                    {isPinned ? (
                      <>
                        <PinOff className="mr-2 h-4 w-4" />
                        Sabitlemeyi Kaldır
                      </>
                    ) : (
                      <>
                        <Pin className="mr-2 h-4 w-4" />
                        Sabitle
                      </>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => onDeleteConversation(conversation.id)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Sil
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-sidebar">
      {/* Header: Toggle & New Chat (ChatGPT Style) */}
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-2">
          {onToggleSidebar && (
            <Button variant="ghost" size="icon" className="h-10 w-10 hover:bg-white/5 rounded-lg text-muted-foreground hover:text-foreground md:flex hidden" onClick={onToggleSidebar} title="Menüyü Küçült">
              <PanelLeftClose size={18} />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-10 w-10 hover:bg-white/5 rounded-lg text-muted-foreground hover:text-foreground" onClick={() => {
            const el = document.getElementById('search-input');
            if (el) el.focus();
          }} title="Konuşma Ara">
            <Search size={18} />
          </Button>
        </div>
        <Button variant="ghost" size="icon" className="h-10 w-10 hover:bg-white/5 rounded-lg text-muted-foreground hover:text-foreground" onClick={onNewChat} title="Yeni Sohbet">
          <Plus size={18} />
        </Button>
      </div>

      <div className="px-3 pb-2">
        <div className="relative flex-1 group">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground group-focus-within:text-foreground" />
          <input
            id="search-input"
            className="h-9 w-full rounded-xl bg-white/5 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:bg-white/10 focus:outline-none focus:ring-1 focus:ring-white/20 transition-all"
            placeholder="Konuşma ara..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Navigasyon kaldırıldı — SidebarMenu kullanılıyor */}

      {/* Sohbet Listesi */}
      <div className="flex-1 overflow-y-auto subtle-scrollbar px-3 pb-4">
        {groupedConversations.pinned.length ? (
          <div className="mb-6">
            <div className="mb-1 px-2 text-xs font-semibold text-muted-foreground">Sabitlenmiş</div>
            <div className="space-y-[2px]">
              {groupedConversations.pinned.map((conversation) => renderConversationItem(conversation, true))}
            </div>
          </div>
        ) : null}

        {[
          ['today', 'Bugün'],
          ['yesterday', 'Dün'],
          ['thisWeek', 'Önceki 7 Gün'],
          ['older', 'Daha Eski'],
        ].map(([key, label]) => {
          const items = groupedConversations.groups[key] || [];
          if (!items.length) return null;

          return (
            <div key={key} className="mb-6">
              <div className="mb-1 px-2 text-xs font-semibold text-muted-foreground">{label}</div>
              <div className="space-y-[2px]">
                {items.map((conversation) => renderConversationItem(conversation, false))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bağlantı Durumu Sadece Koptuğunda Gösterilecek */}
      {!isConnected && (
        <div className="px-4 py-3 border-t border-red-500/10 bg-red-500/5">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-[pulse_1.5s_ease-in-out_infinite] shadow-[0_0_12px_rgba(239,68,68,0.6)]" />
            <span className="text-sm font-medium text-red-400">Bağlantı Bekleniyor veya Koptu...</span>
          </div>
        </div>
      )}

      {/* Alt Bölge - Menü */}
      <div className="mt-auto border-t border-border/40 bg-white/[0.02] p-3">
        <SidebarMenu setActiveView={setActiveView} />
      </div>
    </div>
  );
};
