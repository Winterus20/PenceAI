import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { BrainCircuit, Wrench, Menu, X, PanelLeftOpen, Command, ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useAgentStore } from '../../store/agentStore';
import { useAgentSocket } from '../../hooks/useAgentSocket';
import { useConversations } from '../../hooks/useConversations';
import { useBranchInfoQuery } from '@/hooks/queries/useConversations';
import { useMessageBuilder } from '../../hooks/useMessageBuilder';
import type { ConversationBranchInfo } from '@/store/types';
import { useFileUpload } from '../../hooks/useFileUpload';
import { useConversationFilters } from '../../hooks/useConversationFilters';
import { Toast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/button';
import { CanvasPanel } from '@/components/ui/CanvasPanel';
import { ConversationPanel } from './ConversationPanel';
import { MessagePanel } from './MessagePanel';
import { InputPanel } from './InputPanel';
import hotToast from 'react-hot-toast';
import { AnimatePresence, motion } from 'framer-motion';

const SettingsDialog = lazy(() => import('./SettingsDialog').then(m => ({ default: m.SettingsDialog })));
const MemoryDialog = lazy(() => import('./MemoryDialog').then(m => ({ default: m.MemoryDialog })));
const ConfirmDialog = lazy(() => import('./ConfirmDialog').then(m => ({ default: m.ConfirmDialog })));
const OnboardingDialog = lazy(() => import('./OnboardingDialog').then(m => ({ default: m.OnboardingDialog })));
const CommandPalette = lazy(() => import('./CommandPalette').then(m => ({ default: m.CommandPalette })));

const BranchDeleteDialog: React.FC<{
  open: boolean;
  branches: ConversationBranchInfo[];
  onConfirm: (deleteBranches: boolean) => void;
  onCancel: () => void;
}> = ({ open, branches, onConfirm, onCancel }) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border/60 rounded-xl p-6 max-w-md w-full shadow-2xl">
        <h3 className="text-lg font-semibold text-foreground mb-2">
          Bu konuşmanın {branches.length} alt dalı var
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Silme işlemini nasıl yapmak istersiniz?
        </p>
        <div className="space-y-2 mb-4">
          <label className="flex items-start gap-3 p-3 rounded-lg hover:bg-white/5 cursor-pointer border border-border/30">
            <input type="radio" name="deleteOption" value="all" defaultChecked className="mt-1" />
            <div>
              <div className="text-sm font-medium text-foreground">Dallarla birlikte sil</div>
              <div className="text-xs text-muted-foreground">Ana konuşma ve tüm alt dallar silinecek</div>
            </div>
          </label>
          <label className="flex items-start gap-3 p-3 rounded-lg hover:bg-white/5 cursor-pointer border border-border/30">
            <input type="radio" name="deleteOption" value="onlyMain" className="mt-1" />
            <div>
              <div className="text-sm font-medium text-foreground">Sadece ana konuşmayı sil</div>
              <div className="text-xs text-muted-foreground">Dallar bağımsız konuşma olarak kalır</div>
            </div>
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>İptal</Button>
          <Button variant="destructive" size="sm" onClick={() => {
            const selected = document.querySelector<HTMLInputElement>('input[name="deleteOption"]:checked');
            onConfirm(selected?.value === 'all');
          }}>Sil</Button>
        </div>
      </div>
    </div>
  );
};

export const ChatWindow = () => {
  // Agent Store
  const {
    messages,
    isReceiving,
    isConnected,
    conversations,
    activeConversationId,
    confirmRequest,
    activeView,
    feedbacks,
    toast,
    canvasArtifact,
    isCommandPaletteOpen,
    setMessages,
    setActiveView,
    sendFeedback,
    hideToast,
    updateConversationTitle,
    setMessageMetrics,
    messageMetrics,
    setCanvasArtifact,
    toggleCommandPalette,
    editingMessage,
    setEditingMessage,
    clearEditingMessage,
    updateMessageContent,
    removeMessagesAfter,
  } = useAgentStore();

  // WebSocket
  const { sendMessage, regenerateLastResponse, setThinkingEnabled, respondToConfirmation } = useAgentSocket((metrics) => {
    console.log('[Metrics] Received metrics event:', JSON.stringify(metrics, null, 2).substring(0, 500));
    // Metrics'i son assistant mesajına bağla (messageId bazlı anahtarlama)
    const state = useAgentStore.getState();
    const lastAssistantMsg = [...state.messages].reverse().find(m => m.role === 'assistant');
    const targetMessageId = metrics.messageId || lastAssistantMsg?.id || `fallback-${Date.now()}`;
    setMessageMetrics({ messageId: targetMessageId, metrics });
    console.log('[Metrics] Stored metrics for message:', targetMessageId);
  });

  // Custom Hooks
  const {
    pinnedConversations,
    loadConversations,
    loadConversation: loadConversationFromHook,
    deleteConversation,
    confirmDeleteWithBranches,
    togglePinned,
    handleNewChat: handleNewChatFromHook,
  } = useConversations();

  const { buildRenderableMessages } = useMessageBuilder();

  const { forkConversation } = useConversations();

  const {
    pendingAttachments,
    isDragOver,
    handleFileSelection,
    handleDrop,
    handleDragOver,
    handleDragLeave,
    removeAttachment,
    clearAttachments,
  } = useFileUpload({ maxFiles: 10, maxSize: 25 * 1024 * 1024 });

  const {
    searchQuery,
    setSearchQuery,
    sortOrder,
  } = useConversationFilters();

  const { data: branchInfo } = useBranchInfoQuery(activeConversationId);

  // UI State
  const [input, setInput] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);
  const [showConversations, setShowConversations] = useState(true);
  const [showThinking, setShowThinking] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [deleteBranchDialog, setDeleteBranchDialog] = useState<{
    isOpen: boolean;
    conversationId: string;
    branches: ConversationBranchInfo[];
  } | null>(null);

  // Global keyboard shortcut: Cmd+K / Ctrl+K for command palette
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggleCommandPalette();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [toggleCommandPalette]);

  // Thinking enabled sync
  const prevThinkingRef = useRef(showThinking);
  useEffect(() => {
    if (prevThinkingRef.current !== showThinking) {
      prevThinkingRef.current = showThinking;
      setThinkingEnabled(showThinking);
    }
  }, [showThinking, setThinkingEnabled]);

  // Rename conversation handler
  const handleRenameConversation = useCallback(async (id: string, title: string) => {
    try {
      await api.patch(`/conversations/${id}`, { title });
      if (updateConversationTitle) {
        updateConversationTitle(id, title);
      }
      hotToast.success('Sohbet başlığı güncellendi');
    } catch (error) {
      console.error('Rename error:', error);
      hotToast.error('Başlık güncellenirken bir hata oluştu');
    }
  }, [updateConversationTitle]);

  // Mesaj alma sonrası konuşmaları yenile
  useEffect(() => {
    if (!isReceiving) {
      void loadConversations();
    }
  }, [isReceiving, loadConversations]);

  // Onboarding kontrolü
  useEffect(() => {
    const loadOnboardingState = async () => {
      try {
        const settings = await api.get<{ defaultUserName?: string }>('/settings');
        if (!settings.defaultUserName || settings.defaultUserName === 'Kullanıcı') {
          setOnboardingOpen(true);
        }
      } catch (error) {
        console.error('Onboarding bilgisi alınamadı:', error);
        hotToast.error('Onboarding bilgisi yüklenirken bir hata oluştu');
      }
    };

    void loadOnboardingState();
  }, []);

  // Konuşma yükleme wrapper'ı - mesajları set eder
  const loadConversation = useCallback(
    async (conversationId: string) => {
      const rawMessages = await loadConversationFromHook(conversationId);
      setMessages(buildRenderableMessages(rawMessages));
    },
    [loadConversationFromHook, buildRenderableMessages, setMessages]
  );

  // Sayfa yüklendiğinde aktif sohbetin mesajlarını yükle
  useEffect(() => {
    if (activeConversationId && messages.length === 0 && conversations.length > 0) {
      const conversationExists = conversations.some(c => c.id === activeConversationId);
      if (conversationExists) {
        void loadConversation(activeConversationId);
      }
    }
  }, [activeConversationId, conversations, messages.length, loadConversation]);

  // Yeni sohbet başlat
  const handleNewChat = () => {
    handleNewChatFromHook();
    clearAttachments();
  };

  const handleSend = (contentOverride?: string | React.MouseEvent<HTMLButtonElement>) => {
    const resolvedOverride = typeof contentOverride === 'string' ? contentOverride : undefined;
    const contentToSend = resolvedOverride ?? input;
    const trimmedContent = contentToSend.trim();

    if ((!trimmedContent && pendingAttachments.length === 0) || isReceiving) {
      return;
    }

    // if we are in editing mode, handle history rewrite
    if (editingMessage.messageId) {
      const { messageId } = editingMessage;
      
      // 1. Update the message content in store
      updateMessageContent(messageId, contentToSend);
      
      // 2. Remove all subsequent messages (since history is changed)
      removeMessagesAfter(messageId);
      
      // 3. Clear editing state
      clearEditingMessage();
      
      // 4. Trigger regeneration from that message
      // Note: we don't call sendMessage because that would add a *new* message. 
      // We want the backend to see the updated history and respond to identifying the context.
      // regenerateLastResponse uses the content of the last user message in store.
      regenerateLastResponse(contentToSend, activeConversationId ?? undefined);
    } else {
      // Normal send
      sendMessage(contentToSend, pendingAttachments, activeConversationId ?? undefined);
    }

    setInput('');
    clearAttachments();
  };

  const handleQuickAction = (content: string) => {
    console.debug('[ChatWindow] handleQuickAction:selected', {
      content,
      currentInputBeforeSet: input,
      isReceiving,
      activeConversationId,
    });

    setInput(content);

    console.debug('[ChatWindow] handleQuickAction:send-direct', {
      scheduledContent: content,
      currentInputAtSendTime: input,
      isReceiving,
      activeConversationId,
    });
    handleSend(content);
  };

  const handleRegenerate = () => {
    const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
    if (!lastUserMessage || isReceiving) return;
    regenerateLastResponse(lastUserMessage.content, activeConversationId ?? undefined);
  };

  const handleEditMessage = (messageId: string, content: string) => {
    setInput(content);
    setEditingMessage({ messageId, content });
  };

  const handleDeleteConversation = useCallback(async (conversationId: string) => {
    if (!window.confirm('Bu sohbet silinsin mi?')) return;

    const result = await deleteConversation(conversationId);
    if (result && typeof result === 'object' && result.hasChildren) {
      setDeleteBranchDialog({
        isOpen: true,
        conversationId: result.conversationId,
        branches: result.branches,
      });
    }
  }, [deleteConversation]);

  const handleForkMessage = useCallback(async (_messageId: string, dbMessageId?: number) => {
    if (!activeConversationId || !dbMessageId) return;
    const result = await forkConversation(activeConversationId, dbMessageId);
    if (result) {
      const rawMessages = await loadConversationFromHook(result.conversationId);
      setMessages(buildRenderableMessages(rawMessages));
    }
  }, [activeConversationId, forkConversation, loadConversationFromHook, buildRenderableMessages, setMessages]);

  const handleLoadBranch = useCallback(async (conversationId: string) => {
    const rawMessages = await loadConversationFromHook(conversationId);
    setMessages(buildRenderableMessages(rawMessages));
  }, [loadConversationFromHook, buildRenderableMessages, setMessages]);

  const messageBranches = React.useMemo(() => {
    const branchMap = new Map<number, ConversationBranchInfo[]>();
    if (!activeConversationId) return branchMap;
    const branches = conversations.filter(c => c.parent_conversation_id === activeConversationId);
    for (const branch of branches) {
      if (branch.branch_point_message_id) {
        const existing = branchMap.get(branch.branch_point_message_id) || [];
        existing.push(branch as ConversationBranchInfo);
        branchMap.set(branch.branch_point_message_id, existing);
      }
    }
    return branchMap;
  }, [conversations, activeConversationId]);

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden selection:bg-primary/20">
      <Suspense fallback={null}><SettingsDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} /></Suspense>
      <Suspense fallback={null}><MemoryDialog open={isMemoryOpen} onOpenChange={setIsMemoryOpen} /></Suspense>
      <Suspense fallback={null}><OnboardingDialog open={onboardingOpen} onCompleted={() => setOnboardingOpen(false)} /></Suspense>
      <Suspense fallback={null}>
        <CommandPalette
          isOpen={isCommandPaletteOpen}
          onClose={() => toggleCommandPalette()}
          onAction={(content) => {
            setInput(content);
          }}
        />
      </Suspense>

      <Suspense fallback={null}><ConfirmDialog
        open={!!confirmRequest}
        confirmRequest={confirmRequest}
        onApprove={() => confirmRequest && respondToConfirmation(confirmRequest.id, true)}
        onDeny={() => confirmRequest && respondToConfirmation(confirmRequest.id, false)}
      /></Suspense>

      {/* Desktop Sidebar */}
      <AnimatePresence initial={false}>
        {showConversations && (
          <motion.aside 
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 260, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            className="hidden md:flex flex-col flex-shrink-0 bg-sidebar border-r border-border/40 overflow-hidden z-20 shadow-lg"
          >
            <div className="w-[260px] h-full flex flex-col">
              <ConversationPanel
                activeView={activeView}
                setActiveView={setActiveView}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                sortOrder={sortOrder}
                conversations={conversations}
                activeConversationId={activeConversationId}
                pinnedConversations={pinnedConversations}
                onNewChat={handleNewChat}
                onLoadConversation={loadConversation}
                onTogglePinned={togglePinned}
                onDeleteConversation={handleDeleteConversation}
                onRenameConversation={handleRenameConversation}
                isConnected={isConnected}
                onToggleSidebar={() => setShowConversations(false)}
              />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 relative h-full bg-background">
        {/* Floating Top Header inside main content */}
        <header className="absolute top-0 left-0 right-0 h-14 px-3 md:px-4 flex items-center justify-between z-30 transition-all duration-300 bg-background/60 backdrop-blur-md border-b border-white/[0.04]">
          <div className="flex items-center gap-2">
            <AnimatePresence>
              {!showConversations && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 md:flex hidden hover:bg-white/10 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setShowConversations(true)}
                    title="Menüyü Büyüt"
                  >
                    <PanelLeftOpen size={18} />
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 md:hidden flex hover:bg-white/10 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setIsMobileSidebarOpen(true)}
            >
              <Menu size={18} />
            </Button>
            {activeConversationId && branchInfo?.isBranch && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-muted-foreground hover:text-foreground hover:bg-white/10 rounded-lg"
                onClick={async () => {
                  if (branchInfo.parentConversationId) {
                    await loadConversation(branchInfo.parentConversationId);
                  }
                }}
                title="Üst dala dön"
              >
                <ArrowLeft size={14} />
                <span className="text-xs">Üst Dal</span>
              </Button>
            )}
            <button className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-white/5 transition-colors text-lg font-semibold text-foreground/90">
              Pençe<span className="text-purple-400">AI</span>
              <span className="text-muted-foreground text-xs font-normal border border-white/10 rounded-full px-2 py-0.5 bg-white/5">v0.1</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <Button variant={showThinking ? 'secondary' : 'ghost'} size="icon" className={`h-9 w-9 rounded-full transition-colors ${showThinking ? 'bg-purple-500/20 text-purple-300 hover:bg-purple-500/30' : 'hover:bg-white/10 text-muted-foreground hover:text-foreground'}`} onClick={() => setShowThinking((prev) => !prev)} title="Düşünme Modu">
              <BrainCircuit size={16} />
            </Button>
            <Button variant={showTools ? 'secondary' : 'ghost'} size="icon" className={`h-9 w-9 rounded-full transition-colors ${showTools ? 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30' : 'hover:bg-white/10 text-muted-foreground hover:text-foreground'}`} onClick={() => setShowTools((prev) => !prev)} title="Araçlar">
              <Wrench size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => toggleCommandPalette()}
              title="Komut Paleti (⌘K)"
            >
              <Command size={16} />
            </Button>
          </div>
        </header>

        {/* Messages & Input */}
        <div className="flex flex-1 overflow-hidden relative pt-14">
          <div className="flex w-full h-full">
            {/* Chat Area */}
            <div className="flex-1 flex flex-col min-w-0 h-full">
              <MessagePanel
                messages={messages}
                showThinking={showThinking}
                showTools={showTools}
                isReceiving={isReceiving}
                activeConversationId={activeConversationId}
                feedbacks={feedbacks}
                onRegenerate={handleRegenerate}
                onQuickAction={handleQuickAction}
                onEditMessage={handleEditMessage}
                onSendFeedback={(messageId, type) => sendFeedback(messageId, activeConversationId || '', type)}
                messageMetrics={messageMetrics}
                onFork={handleForkMessage}
                messageBranches={messageBranches}
                onLoadBranch={handleLoadBranch}
              />

              <div
                className={`w-full mt-auto relative px-4 transition-colors ${isDragOver ? 'bg-primary/5 ring-2 ring-primary/50' : ''}`}
                onDragOver={(e) => { e.preventDefault(); handleDragOver(); }}
                onDragLeave={handleDragLeave}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(Array.from(e.dataTransfer.files || []));
                }}
              >
                <InputPanel
                  input={input}
                  setInput={setInput}
                  isReceiving={isReceiving}
                  pendingAttachments={pendingAttachments}
                  onRemoveAttachment={removeAttachment}
                  onSend={handleSend}
                  onFileSelection={handleFileSelection}
                />
              </div>
            </div>

            {/* Canvas Panel (split-view) */}
            <CanvasPanel
              artifact={canvasArtifact}
              onClose={() => setCanvasArtifact(null)}
            />
          </div>
        </div>
      </div>

      {/* Mobil Sidebar Overlay */}
      {isMobileSidebarOpen && (
        <div
          className="fixed inset-0 z-[60] md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Mobil menü"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setIsMobileSidebarOpen(false)}
            aria-hidden="true"
          />

          {/* Sidebar */}
          <aside className="absolute left-0 top-0 bottom-0 w-[85vw] max-w-sm bg-card/95 backdrop-blur border-r border-border/60 flex flex-col shadow-xl animate-slide-in-left">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border/60">
              <span className="text-sm font-semibold tracking-tighter text-label text-foreground/90">PençeAI</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-none"
                onClick={() => setIsMobileSidebarOpen(false)}
                aria-label="Menüyü kapat"
              >
                <X size={18} />
              </Button>
            </div>

            <ConversationPanel
              activeView={activeView}
              setActiveView={setActiveView}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              sortOrder={sortOrder}
              conversations={conversations}
              activeConversationId={activeConversationId}
              pinnedConversations={pinnedConversations}
              onNewChat={handleNewChat}
              onLoadConversation={loadConversation}
              onTogglePinned={togglePinned}
              onDeleteConversation={handleDeleteConversation}
              onRenameConversation={handleRenameConversation}
                isConnected={isConnected}
                isMobile={true}
                onCloseMobile={() => setIsMobileSidebarOpen(false)}
              />
          </aside>
        </div>
      )}

      {/* Toast Notification */}
      <Toast
        message={toast.message}
        type={toast.type}
        isVisible={toast.isVisible}
        onClose={hideToast}
      />

      <BranchDeleteDialog
        open={!!deleteBranchDialog?.isOpen}
        branches={deleteBranchDialog?.branches || []}
        onConfirm={async (deleteBranches) => {
          if (deleteBranchDialog?.conversationId) {
            await confirmDeleteWithBranches(deleteBranchDialog.conversationId, deleteBranches);
          }
          setDeleteBranchDialog(null);
        }}
        onCancel={() => setDeleteBranchDialog(null)}
      />
    </div>
  );
};
