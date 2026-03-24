import React, { useMemo, useState } from 'react';
import { Search, Plus, MessageSquare, Radio, Brain, Settings, Trash2, X, Moon, Sun, MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConversationListItem } from './ConversationListItem';
import type { ConversationItem } from './ConversationListItem';
import type { StatsState, ActiveView } from '../../store/agentStore';
import { useAgentStore } from '@/store/agentStore';
import toast from 'react-hot-toast';
import { normalizeTimestamp } from '@/lib/utils';

interface GroupedConversations {
  pinned: ConversationItem[];
  groups: {
    today: ConversationItem[];
    yesterday: ConversationItem[];
    thisWeek: ConversationItem[];
    older: ConversationItem[];
  };
}

interface ConversationSidebarProps {
  conversations: ConversationItem[];
  activeConversationId: string | null;
  activeView: ActiveView;
  pinnedConversations: string[];
  searchQuery: string;
  sortOrder: 'newest' | 'oldest' | 'messages';
  stats: StatsState;
  isConnected: boolean;
  onSearchQueryChange: (query: string) => void;
  onSortOrderChange: (order: 'newest' | 'oldest' | 'messages') => void;
  onSelectConversation: (id: string) => void;
  onTogglePin: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onNewChat: () => void;
  onActiveViewChange: (view: ActiveView) => void;
}

const navItems: { view: ActiveView; icon: React.ReactNode; label: string }[] = [
  { view: 'chat', icon: <MessageSquare className="h-4 w-4" />, label: 'Sohbet' },
  { view: 'channels', icon: <Radio className="h-4 w-4" />, label: 'Kanallar' },
  { view: 'memory', icon: <Brain className="h-4 w-4" />, label: 'Bellek' },
  { view: 'settings', icon: <Settings className="h-4 w-4" />, label: 'Ayarlar' },
];

export const ConversationSidebar: React.FC<ConversationSidebarProps> = ({
  conversations,
  activeConversationId,
  activeView,
  pinnedConversations,
  searchQuery,
  sortOrder,
  stats,
  isConnected,
  onSearchQueryChange,
  onSortOrderChange,
  onSelectConversation,
  onTogglePin,
  onDeleteConversation,
  onNewChat,
  onActiveViewChange,
}) => {
  // Toplu silme state'leri
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Store'dan seçim state'leri
  const selectedConversationIds = useAgentStore((state) => state.selectedConversationIds);
  const clearConversationSelection = useAgentStore((state) => state.clearConversationSelection);
  const removeSelectedConversations = useAgentStore((state) => state.removeSelectedConversations);
  // Tema state'leri
  const theme = useAgentStore((state) => state.theme);
  const toggleTheme = useAgentStore((state) => state.toggleTheme);

  const groupedConversations = useMemo<GroupedConversations>(() => {
    const filtered = conversations
      .filter((conversation) =>
        (conversation.title || conversation.user_name || 'Sohbet').toLowerCase().includes(searchQuery.trim().toLowerCase())
      )
      .sort((a, b) => {
        if (sortOrder === 'oldest') {
          return (
            new Date(normalizeTimestamp(a.created_at)).getTime() -
            new Date(normalizeTimestamp(b.created_at)).getTime()
          );
        }

        if (sortOrder === 'messages') {
          return (b.message_count || 0) - (a.message_count || 0);
        }

        return (
          new Date(normalizeTimestamp(b.updated_at || b.created_at)).getTime() -
          new Date(normalizeTimestamp(a.updated_at || a.created_at)).getTime()
        );
      });

    const pinned = filtered.filter((conversation) => pinnedConversations.includes(conversation.id));
    const others = filtered.filter((conversation) => !pinnedConversations.includes(conversation.id));

    const groups: GroupedConversations['groups'] = { today: [], yesterday: [], thisWeek: [], older: [] };
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

  const handleDeleteWithConfirm = (conversationId: string) => {
    if (!window.confirm('Bu sohbet silinsin mi?')) return;
    onDeleteConversation(conversationId);
  };

  // Toplu silme işlemleri
  const handleBulkDeleteClick = () => {
    if (selectedConversationIds.length === 0) return;
    setShowBulkDeleteConfirm(true);
  };

  const handleBulkDeleteConfirm = async () => {
    setIsDeleting(true);
    try {
      const response = await fetch('/api/conversations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedConversationIds }),
      });

      if (!response.ok) {
        throw new Error('Toplu silme başarısız oldu');
      }

      // Store'dan seçilenleri kaldır
      removeSelectedConversations(selectedConversationIds);
      toast.success(`${selectedConversationIds.length} sohbet silindi`);
    } catch (error) {
      console.error('Bulk delete error:', error);
      toast.error('Sohbetler silinirken bir hata oluştu');
    } finally {
      setIsDeleting(false);
      setShowBulkDeleteConfirm(false);
      clearConversationSelection();
    }
  };

  const handleBulkDeleteCancel = () => {
    setShowBulkDeleteConfirm(false);
  };

  return (
    <aside className="hidden w-full max-w-sm border-r border-border/60 bg-card/55 md:flex md:flex-col">
      {/* Navigasyon Butonları */}
      <nav className="border-b border-border/60 p-2">
        <div className="flex gap-1">
          {navItems.map((item) => (
            <button
              key={item.view}
              onClick={() => onActiveViewChange(item.view)}
              className={`flex flex-1 flex-col items-center gap-1 rounded-lg px-2 py-2.5 text-xs font-medium transition-all duration-200 ${
                activeView === item.view
                  ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30 shadow-sm shadow-purple-500/10'
                  : 'text-muted-foreground hover:bg-purple-500/10 hover:text-purple-300'
              }`}
            >
              {item.icon}
              <span className="hidden sm:inline">{item.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Sohbet Arama ve Listesi - Sadece chat view'inde göster */}
      {activeView === 'chat' && (
      <>
      <div className="border-b border-border/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              className="h-10 w-full border border-input bg-card/70 pl-9 pr-3 text-sm"
              placeholder="Konuşma ara..."
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
            />
          </div>
          <Button variant="outline" className="rounded-none" onClick={onNewChat}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <select
          className="h-10 w-full border border-input bg-card/70 px-3 text-sm"
          value={sortOrder}
          onChange={(e) => onSortOrderChange(e.target.value as 'newest' | 'oldest' | 'messages')}
        >
          <option value="newest">En yeni</option>
          <option value="oldest">En eski</option>
          <option value="messages">Mesaj sayısı</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {/* Boş Durum UI'ı */}
        {conversations.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-4 py-8 text-center">
            <div className="mb-4 rounded-full bg-purple-500/10 p-4">
              <MessageSquarePlus className="h-10 w-10 text-purple-400" />
            </div>
            <h3 className="mb-2 text-lg font-semibold text-foreground">
              Henüz sohbet yok
            </h3>
            <p className="mb-6 max-w-[200px] text-sm text-muted-foreground">
              Yeni bir sohbet başlatmak için tıklayın
            </p>
            <Button
              onClick={onNewChat}
              className="bg-purple-600 hover:bg-purple-700 text-white gap-2"
            >
              <Plus className="h-4 w-4" />
              Yeni Sohbet
            </Button>
          </div>
        ) : (
          <>
            {groupedConversations.pinned.length ? (
              <div className="mb-6">
                <div className="mb-2 px-2 text-meta">
                  Sabitlenmiş
                </div>
                <div className="space-y-2">
                  {groupedConversations.pinned.map((conversation) => (
                    <ConversationListItem
                      key={conversation.id}
                      conversation={conversation}
                      isActive={activeConversationId === conversation.id}
                      isPinned={true}
                      onSelect={onSelectConversation}
                      onTogglePin={onTogglePin}
                      onDelete={handleDeleteWithConfirm}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {[
              ['today', 'Bugün'],
              ['yesterday', 'Dün'],
              ['thisWeek', 'Bu Hafta'],
              ['older', 'Daha Eski'],
            ].map(([key, label]) => {
              const items = groupedConversations.groups[key as keyof typeof groupedConversations.groups] || [];
              if (!items.length) return null;

              return (
                <div key={key} className="mb-6">
                  <div className="mb-2 px-2 text-meta">
                    {label}
                  </div>
                  <div className="space-y-2">
                    {items.map((conversation) => (
                      <ConversationListItem
                        key={conversation.id}
                        conversation={conversation}
                        isActive={activeConversationId === conversation.id}
                        isPinned={pinnedConversations.includes(conversation.id)}
                        onSelect={onSelectConversation}
                        onTogglePin={onTogglePin}
                        onDelete={handleDeleteWithConfirm}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Toplu İşlem Footer - Seçili öğe varsa göster */}
      {selectedConversationIds.length > 0 && (
        <div className="border-t border-purple-500/30 bg-purple-500/10 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-purple-300">
                {selectedConversationIds.length} seçili
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={clearConversationSelection}
              >
                <X className="h-3.5 w-3.5 mr-1" />
                İptal
              </Button>
            </div>
            <Button
              variant="destructive"
              size="sm"
              className="h-8 px-3 text-xs bg-red-600 hover:bg-red-700"
              onClick={handleBulkDeleteClick}
              disabled={isDeleting}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              {isDeleting ? 'Siliniyor...' : 'Seçilenleri Sil'}
            </Button>
          </div>
        </div>
      )}

      {/* İstatistikler */}
      <div className="border-t border-border/60 px-4 py-3">
        <div className="flex items-center justify-around text-center">
          <div className="flex flex-col">
            <span className="text-lg font-semibold text-foreground">{stats.conversations}</span>
            <span className="text-stats">Sohbet</span>
          </div>
          <div className="h-8 w-px bg-border/60" />
          <div className="flex flex-col">
            <span className="text-lg font-semibold text-foreground">{stats.messages}</span>
            <span className="text-stats">Mesaj</span>
          </div>
          <div className="h-8 w-px bg-border/60" />
          <div className="flex flex-col">
            <span className="text-lg font-semibold text-foreground">{stats.memories}</span>
            <span className="text-stats">Bellek</span>
          </div>
        </div>
      </div>

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

      {/* Tema Değiştirme */}
      <div className="border-t border-border/60 px-4 py-3">
        <button
          onClick={toggleTheme}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {theme === 'dark' ? (
            <>
              <Sun className="h-4 w-4" />
              <span>Açık Tema</span>
            </>
          ) : (
            <>
              <Moon className="h-4 w-4" />
              <span>Koyu Tema</span>
            </>
          )}
        </button>
      </div>
    </>
  )}

  {/* Toplu Silme Onay Dialog'u */}
  {showBulkDeleteConfirm && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border/60 p-6 max-w-md w-full mx-4 shadow-xl">
        <h3 className="text-lg font-semibold text-foreground mb-2">Toplu Silme Onayı</h3>
        <p className="text-sm text-muted-foreground mb-4">
          <span className="text-red-400 font-medium">{selectedConversationIds.length}</span> sohbet silinecek. Bu işlem geri alınamaz. Emin misiniz?
        </p>
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={handleBulkDeleteCancel}
            disabled={isDeleting}
          >
            İptal
          </Button>
          <Button
            variant="destructive"
            onClick={handleBulkDeleteConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? 'Siliniyor...' : 'Sil'}
          </Button>
        </div>
      </div>
    </div>
  )}
</aside>
);
};
