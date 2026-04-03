import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Settings, BookOpen, BrainCircuit, Wrench, Menu, X, Moon, Sun } from 'lucide-react';
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
  const prevThinkingRef = useRef(showThinking);
  useEffect(() => {
    if (prevThinkingRef.current !== showThinking) {
      prevThinkingRef.current = showThinking;
      setThinkingEnabled(showThinking);
    }
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

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden selection:bg-primary/20">
      <SettingsDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
      <MemoryDialog open={isMemoryOpen} onOpenChange={setIsMemoryOpen} />
      <OnboardingDialog open={onboardingOpen} onCompleted={() => setOnboardingOpen(false)} />

      <ConfirmDialog
        open={!!confirmRequest}
        confirmRequest={confirmRequest}
        onApprove={() => confirmRequest && respondToConfirmation(confirmRequest.id, true)}
        onDeny={() => confirmRequest && respondToConfirmation(confirmRequest.id, false)}
      />

      {/* Desktop Sidebar */}
      {showConversations ? (
        <aside className="hidden md:flex flex-col w-[260px] flex-shrink-0 bg-sidebar border-r border-border/60 transition-all duration-300">
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
            onDeleteConversation={deleteConversation}
            stats={stats}
            isConnected={isConnected}
          />
        </aside>
      ) : null}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 relative h-full">
        {/* Top Header inside main content */}
        <header className="flex-none h-14 px-3 md:px-4 flex items-center justify-between z-10 w-full relative">
          <div className="flex items-center gap-2">
            {!showConversations && (
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 md:flex hidden hover:bg-white/5 rounded-lg text-muted-foreground hover:text-foreground"
                onClick={() => setShowConversations(true)}
              >
                <Menu size={18} />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 md:hidden flex hover:bg-white/5 rounded-lg text-muted-foreground hover:text-foreground"
              onClick={() => setIsMobileSidebarOpen(true)}
            >
              <Menu size={18} />
            </Button>
            
            <button className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-white/5 transition-colors text-lg font-semibold text-foreground/90">
              PençeAI
              <span className="text-muted-foreground text-sm font-normal">v0.1</span>
            </button>
          </div>

          <div className="flex items-center gap-1">
            <Button variant={showThinking ? 'secondary' : 'ghost'} size="icon" className="h-10 w-10 rounded-full hover:bg-white/5 text-muted-foreground hover:text-foreground" onClick={() => setShowThinking((prev) => !prev)} title="Düşünme Modu">
              <BrainCircuit size={18} />
            </Button>
            <Button variant={showTools ? 'secondary' : 'ghost'} size="icon" className="h-10 w-10 rounded-full hover:bg-white/5 text-muted-foreground hover:text-foreground" onClick={() => setShowTools((prev) => !prev)} title="Araçlar">
              <Wrench size={18} />
            </Button>
            <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-white/5 text-muted-foreground hover:text-foreground" onClick={() => setIsMemoryOpen(true)} title="Bellek">
              <BookOpen size={18} />
            </Button>
            <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-white/5 text-muted-foreground hover:text-foreground" onClick={() => setIsSettingsOpen(true)} title="Ayarlar">
              <Settings size={18} />
            </Button>
          </div>
        </header>

        {/* Messages & Input */}
        <div className="flex flex-1 overflow-hidden relative">
          <div className="flex w-full flex-col h-full">
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
                setPendingAttachments={() => {}}
                onSend={handleSend}
                onFileSelection={handleFileSelection}
              />
            </div>
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
