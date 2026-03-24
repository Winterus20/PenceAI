import React from 'react';
import { Search, Plus, Pin, PinOff, Trash2, MessageSquare, Radio } from 'lucide-react';
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
  setSortOrder: (order: SortOrder) => void;
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
}

export const ConversationPanel: React.FC<ConversationPanelProps> = ({
  activeView,
  setActiveView,
  searchQuery,
  setSearchQuery,
  sortOrder,
  setSortOrder,
  conversations,
  activeConversationId,
  pinnedConversations,
  onNewChat,
  onLoadConversation,
  onTogglePinned,
  onDeleteConversation,
  stats,
  isConnected,
  isMobile = false,
  onCloseMobile,
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
      className={`w-full border transition-colors ${activeConversationId === conversation.id ? 'border-foreground/40 bg-white/[0.07]' : 'border-border/60 bg-white/[0.03] hover:bg-white/[0.06]'}`}
    >
      <div className="flex items-start justify-between gap-2 p-3">
        <button
          type="button"
          onClick={() => handleLoadConversation(conversation.id)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="truncate font-medium text-foreground/90">{conversation.title || conversation.user_name || 'Sohbet'}</div>
          <div className="mt-1 flex flex-wrap gap-2 text-label-sm uppercase text-muted-foreground">
            <span>{conversation.message_count || 0} mesaj</span>
            <span>{new Date(normalizeTimestamp(conversation.updated_at || conversation.created_at)).toLocaleDateString('tr-TR')}</span>
          </div>
        </button>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-none" onClick={() => onTogglePinned(conversation.id)}>
            {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-none text-destructive" onClick={() => onDeleteConversation(conversation.id)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Navigasyon Butonları */}
      <nav className="border-b border-border/60 p-2">
        <div className="flex gap-1">
          <button
            onClick={() => handleViewChange('chat')}
            className={`flex flex-1 flex-col items-center gap-1 rounded-lg px-2 py-2.5 text-xs font-medium transition-all duration-200 ${
              activeView === 'chat'
                ? 'bg-purple-600/20 text-purple-400 border border-purple-500/50'
                : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
            }`}
          >
            <MessageSquare className="h-4 w-4" />
            <span className={isMobile ? '' : 'hidden sm:inline'}>Sohbet</span>
          </button>
          <button
            onClick={() => handleViewChange('channels')}
            className={`flex flex-1 flex-col items-center gap-1 rounded-lg px-2 py-2.5 text-xs font-medium transition-all duration-200 ${
              activeView === 'channels'
                ? 'bg-purple-600/20 text-purple-400 border border-purple-500/50'
                : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
            }`}
          >
            <Radio className="h-4 w-4" />
            <span className={isMobile ? '' : 'hidden sm:inline'}>Kanallar</span>
          </button>
        </div>
      </nav>

      {/* Arama ve Yeni Sohbet */}
      <div className="border-b border-border/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              className="h-10 w-full border border-input bg-card/70 pl-9 pr-3 text-sm"
              placeholder="Konuşma ara..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Button variant="outline" className="rounded-none" onClick={onNewChat}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <select
          className="h-10 w-full border border-input bg-card/70 px-3 text-sm"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as SortOrder)}
        >
          <option value="newest">En yeni</option>
          <option value="oldest">En eski</option>
          <option value="messages">Mesaj sayısı</option>
        </select>
      </div>

      {/* Sohbet Listesi */}
      <div className="flex-1 overflow-y-auto p-3">
        {groupedConversations.pinned.length ? (
          <div className="mb-6">
            <div className="mb-2 px-2 text-meta">Sabitlenmiş</div>
            <div className="space-y-2">
              {groupedConversations.pinned.map((conversation) => renderConversationItem(conversation, true))}
            </div>
          </div>
        ) : null}

        {[
          ['today', 'Bugün'],
          ['yesterday', 'Dün'],
          ['thisWeek', 'Bu Hafta'],
          ['older', 'Daha Eski'],
        ].map(([key, label]) => {
          const items = groupedConversations.groups[key] || [];
          if (!items.length) return null;

          return (
            <div key={key} className="mb-6">
              <div className="mb-2 px-2 text-meta">{label}</div>
              <div className="space-y-2">
                {items.map((conversation) => renderConversationItem(conversation, false))}
              </div>
            </div>
          );
        })}
      </div>

      {/* İstatistikler */}
      {stats && (
        <div className="border-t border-border/60 px-4 py-3">
          <div className="flex items-center justify-around text-center">
            <div className="flex flex-col">
              <span className="text-lg font-semibold text-foreground">{stats.conversations || 0}</span>
              <span className="text-stats">Sohbet</span>
            </div>
            <div className="h-8 w-px bg-border/60" />
            <div className="flex flex-col">
              <span className="text-lg font-semibold text-foreground">{stats.messages || 0}</span>
              <span className="text-stats">Mesaj</span>
            </div>
            <div className="h-8 w-px bg-border/60" />
            <div className="flex flex-col">
              <span className="text-lg font-semibold text-foreground">{stats.memories || 0}</span>
              <span className="text-stats">Bellek</span>
            </div>
          </div>
        </div>
      )}

      {/* Bağlantı Durumu */}
      <div className="border-t border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              isConnected
                ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]'
                : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'
            }`}
          />
          <span className="text-sm text-muted-foreground">
            {isConnected ? 'Bağlı' : 'Bağlantı Kesik'}
          </span>
        </div>
      </div>
    </>
  );
};
