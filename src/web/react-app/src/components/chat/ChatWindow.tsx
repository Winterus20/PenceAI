import React, { useState, useEffect, useCallback } from 'react';
import { Settings, BookOpen, History, BrainCircuit, Wrench, Download, Menu, X, Moon, Sun } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';
import { useAgentSocket } from '../../hooks/useAgentSocket';
import { useConversations } from '../../hooks/useConversations';
import { useMessageBuilder } from '../../hooks/useMessageBuilder';
import { useFileUpload } from '../../hooks/useFileUpload';
import { useConversationFilters } from '../../hooks/useConversationFilters';
import { SettingsDialog } from './SettingsDialog';
import { MemoryDialog } from './MemoryDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { OnboardingDialog } from './OnboardingDialog';
import { Toast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/button';
import { ConversationPanel } from './ConversationPanel';
import { MessagePanel } from './MessagePanel';
import { InputPanel } from './InputPanel';
import hotToast from 'react-hot-toast';

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
    stats,
    theme,
    setMessages,
    setActiveView,
    sendFeedback,
    hideToast,
    toggleTheme,
  } = useAgentStore();

  // WebSocket
  const { sendMessage, regenerateLastResponse, setThinkingEnabled, respondToConfirmation } = useAgentSocket();

  // Custom Hooks
  const {
    pinnedConversations,
    loadConversations,
    loadConversation: loadConversationFromHook,
    deleteConversation,
    togglePinned,
    handleNewChat: handleNewChatFromHook,
  } = useConversations();

  const { buildRenderableMessages } = useMessageBuilder();

  const {
    pendingAttachments,
    isDragOver,
    handleFileSelection,
    handleDrop,
    handleDragOver,
    handleDragLeave,
    clearAttachments,
  } = useFileUpload({ maxFiles: 10, maxSize: 25 * 1024 * 1024 });

  const {
    searchQuery,
    setSearchQuery,
    sortOrder,
    setSortOrder,
  } = useConversationFilters();

  // UI State
  const [input, setInput] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);
  const [showConversations, setShowConversations] = useState(true);
  const [showThinking, setShowThinking] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Thinking enabled sync
  useEffect(() => {
    setThinkingEnabled(showThinking);
  }, [showThinking, setThinkingEnabled]);

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
        const response = await fetch('/api/settings');
        const settings = await response.json();
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

    console.debug('[ChatWindow] handleSend:start', {
      inputLength: contentToSend.length,
      trimmedLength: trimmedContent.length,
      pendingAttachments: pendingAttachments.length,
      isReceiving,
      activeConversationId,
      usedOverride: resolvedOverride !== undefined,
    });

    if ((!trimmedContent && pendingAttachments.length === 0) || isReceiving) {
      console.debug('[ChatWindow] handleSend:blocked', {
        reason: !trimmedContent && pendingAttachments.length === 0 ? 'empty-payload' : 'receiving-in-progress',
        inputSnapshot: contentToSend,
        pendingAttachments: pendingAttachments.length,
        isReceiving,
        usedOverride: resolvedOverride !== undefined,
      });
      return;
    }

    console.debug('[ChatWindow] handleSend:dispatch', {
      inputSnapshot: contentToSend,
      pendingAttachments: pendingAttachments.length,
      activeConversationId,
      usedOverride: resolvedOverride !== undefined,
    });

    sendMessage(contentToSend, pendingAttachments, activeConversationId ?? undefined);
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

  const handleEditMessage = (content: string) => {
    setInput(content);
  };

  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId);

  const exportConversation = (format: 'md' | 'json') => {
    if (!messages.length) return;
    const title = activeConversation?.title || activeConversation?.user_name || 'Sohbet';
    const now = new Date().toISOString().slice(0, 10);

    const payload = format === 'md'
      ? `# ${title}\n\n${messages.map((message) => `## ${message.role}\n\n${message.content}`).join('\n\n')}`
      : JSON.stringify({ title, exportedAt: now, messages }, null, 2);

    const blob = new Blob([payload], { type: format === 'md' ? 'text/markdown' : 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${title.replace(/[^\w\-. ]/g, '_')}-${now}.${format}`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-screen bg-background text-foreground transition-colors duration-500">
      <header className="flex-none h-14 px-4 md:px-6 flex items-center justify-between fixed top-0 left-0 right-0 z-50 w-full border-b border-border/60 bg-background/95 backdrop-blur pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          {/* Mobil Menü Butonu */}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-none md:hidden hover:bg-accent/40"
            onClick={() => setIsMobileSidebarOpen(true)}
            aria-label="Menüyü aç"
          >
            <Menu size={18} strokeWidth={1.5} />
          </Button>
          <span className="text-sm font-semibold tracking-tighter uppercase text-foreground/90 select-none">
            PençeAI
          </span>
          <div className="flex items-center gap-1.5 opacity-50">
            <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-foreground' : 'bg-destructive'} transition-colors duration-500`} />
            <span className="text-meta font-medium">{isConnected ? 'Bağlı' : 'Offline'}</span>
          </div>
          <span className="hidden md:block text-label text-muted-foreground">
            {activeConversation?.title || activeConversation?.user_name || 'Yeni Sohbet'}
          </span>
        </div>

        <div className="flex items-center gap-1 opacity-60 hover:opacity-100 transition-opacity duration-300 pointer-events-auto">
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none hover:bg-accent/40" onClick={() => setShowConversations((prev) => !prev)}>
            <History size={14} strokeWidth={1.5} />
          </Button>
          <Button variant={showThinking ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8 rounded-none hover:bg-accent/40" onClick={() => setShowThinking((prev) => !prev)}>
            <BrainCircuit size={14} strokeWidth={1.5} />
          </Button>
          <Button variant={showTools ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8 rounded-none hover:bg-accent/40" onClick={() => setShowTools((prev) => !prev)}>
            <Wrench size={14} strokeWidth={1.5} />
          </Button>
          {messages.length ? (
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none hover:bg-accent/40" onClick={() => exportConversation(window.confirm('Tamam → Markdown, İptal → JSON') ? 'md' : 'json')}>
              <Download size={14} strokeWidth={1.5} />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="h-9 rounded-full border border-white/12 bg-white/[0.05] px-3 text-muted-foreground hover:border-white/20 hover:bg-white/[0.08] hover:text-foreground"
            onClick={() => setIsMemoryOpen(true)}
          >
            <BookOpen size={14} strokeWidth={1.5} />
            <span className="hidden sm:inline">Bellek</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 rounded-full border border-white/12 bg-white/[0.05] px-3 text-muted-foreground hover:border-white/20 hover:bg-white/[0.08] hover:text-foreground"
            onClick={() => setIsSettingsOpen(true)}
          >
            <Settings size={14} strokeWidth={1.5} />
            <span className="hidden sm:inline">Ayarlar</span>
          </Button>
        </div>
      </header>

      <SettingsDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
      <MemoryDialog open={isMemoryOpen} onOpenChange={setIsMemoryOpen} />
      <OnboardingDialog open={onboardingOpen} onCompleted={() => setOnboardingOpen(false)} />

      <ConfirmDialog
        open={!!confirmRequest}
        confirmRequest={confirmRequest}
        onApprove={() => confirmRequest && respondToConfirmation(confirmRequest.id, true)}
        onDeny={() => confirmRequest && respondToConfirmation(confirmRequest.id, false)}
      />

      <div className="flex flex-1 overflow-hidden pt-14">
        {showConversations ? (
          <aside className="hidden w-full max-w-sm border-r border-border/60 bg-card/55 md:flex md:flex-col">
            <ConversationPanel
              activeView={activeView}
              setActiveView={setActiveView}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              sortOrder={sortOrder}
              setSortOrder={setSortOrder}
              conversations={conversations}
              activeConversationId={activeConversationId}
              pinnedConversations={pinnedConversations}
              onNewChat={handleNewChat}
              onLoadConversation={loadConversation}
              onTogglePinned={togglePinned}
              onDeleteConversation={deleteConversation}
              stats={stats}
              isConnected={isConnected}
            />
          </aside>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
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
          />

          <div
            className={`max-w-3xl w-full flex flex-col relative group border ${isDragOver ? 'border-foreground/50 bg-card/50' : 'border-border/60 bg-card/20'} p-4 transition-colors mx-auto`}
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
              setPendingAttachments={() => {}}
              onSend={handleSend}
              onNewChat={handleNewChat}
              onFileSelection={handleFileSelection}
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
              setSortOrder={setSortOrder}
              conversations={conversations}
              activeConversationId={activeConversationId}
              pinnedConversations={pinnedConversations}
              onNewChat={handleNewChat}
              onLoadConversation={loadConversation}
              onTogglePinned={togglePinned}
              onDeleteConversation={deleteConversation}
              stats={stats}
              isConnected={isConnected}
              isMobile={true}
              onCloseMobile={() => setIsMobileSidebarOpen(false)}
            />

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
    </div>
  );
};
