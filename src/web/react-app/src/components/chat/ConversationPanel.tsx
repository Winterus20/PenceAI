import React from 'react';
import { Search, Plus, Pin, PinOff, Trash2, MessageSquare, Radio, PanelLeftClose, BookOpen, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ConversationItem, ActiveView } from '../../store/agentStore';

const normalizeTimestamp = (value?: string) => {
  if (!value) return new Date().toISOString();
  if (value.endsWith('Z')) return value;
  return value.includes('T') ? `${value}Z` : value.replace(' ', 'T') + 'Z';
};

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
  stats?: {
    conversations: number;
    messages: number;
    memories: number;
  } | null;
  isConnected: boolean;
  isMobile?: boolean;
  onCloseMobile?: () => void;
  onToggleSidebar?: () => void;
  onOpenMemory?: () => void;
  onOpenSettings?: () => void;
}

export const ConversationPanel: React.FC<ConversationPanelProps> = ({
  activeView,
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
  isConnected,
  isMobile = false,
  onCloseMobile,
  onToggleSidebar,
  onOpenMemory,
  onOpenSettings,
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

  const handleViewChange = (view: ActiveView) => {
    setActiveView(view);
    if (isMobile && onCloseMobile) {
      onCloseMobile();
    }
  };

  const handleLoadConversation = (id: string) => {
    onLoadConversation(id);
    if (isMobile && onCloseMobile) {
      onCloseMobile();
    }
  };

  const renderConversationItem = (conversation: ConversationItem, isPinned: boolean) => (
    <div
      key={conversation.id}
      className={`group w-full rounded-lg transition-colors ${activeConversationId === conversation.id ? 'bg-white/10' : 'hover:bg-white/5'}`}
    >
      <div className="flex items-center justify-between gap-2 p-2 px-3">
        <button
          type="button"
          onClick={() => handleLoadConversation(conversation.id)}
          className="min-w-0 flex-1 text-left flex items-center gap-2"
        >
          <div className="truncate text-[14px] font-normal text-foreground/90">{conversation.title || conversation.user_name || 'Sohbet'}</div>
        </button>
        <div className="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
          <Button variant="ghost" size="icon" className="h-6 w-6 rounded-md hover:bg-white/10 text-muted-foreground hover:text-foreground" onClick={() => onTogglePinned(conversation.id)}>
            {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 rounded-md hover:bg-red-500/20 text-muted-foreground hover:text-red-400" onClick={() => onDeleteConversation(conversation.id)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );

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

      {/* Navigasyon (Proje Özel) */}
      <nav className="px-3 pb-2 flex gap-1">
        <button
          onClick={() => handleViewChange('chat')}
          className={`flex-1 flex items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs font-medium transition-all duration-200 ${
            activeView === 'chat'
              ? 'bg-white/10 text-foreground'
              : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
          }`}
        >
          <MessageSquare className="h-4 w-4" />
          <span className={isMobile ? '' : 'hidden sm:inline'}>Sohbet</span>
        </button>
        <button
          onClick={() => handleViewChange('channels')}
          className={`flex-1 flex items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs font-medium transition-all duration-200 ${
            activeView === 'channels'
              ? 'bg-white/10 text-foreground'
              : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
          }`}
        >
          <Radio className="h-4 w-4" />
          <span className={isMobile ? '' : 'hidden sm:inline'}>Kanallar</span>
        </button>
      </nav>

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

      {/* Alt Bölge - Bellek ve Ayarlar */}
      <div className="mt-auto border-t border-border/40 bg-white/[0.02] p-3 flex items-center justify-center gap-2">
        <button
          onClick={onOpenMemory}
          className="flex flex-[1] items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-medium text-muted-foreground transition-all hover:bg-white/10 hover:text-foreground"
        >
          <BookOpen className="h-4 w-4" />
          <span>Bellek</span>
        </button>
        <button
          onClick={onOpenSettings}
          className="flex flex-[1] items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-medium text-muted-foreground transition-all hover:bg-white/10 hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
          <span>Ayarlar</span>
        </button>
      </div>
    </div>
  );
};
