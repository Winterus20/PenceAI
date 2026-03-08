import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Settings, BookOpen, Loader2, History, BrainCircuit, Wrench, Plus, Send, Paperclip, Search, Pin, PinOff, Trash2, Download } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';
import { useAgentSocket } from '../../hooks/useAgentSocket';
import { MessageStream } from './MessageStream';
import { SettingsDialog } from './SettingsDialog';
import { MemoryDialog } from './MemoryDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { OnboardingDialog } from './OnboardingDialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

const STORAGE_KEYS = {
    pinnedConversations: 'pencePinned',
};

const stripThinkTags = (text?: string) => {
    if (!text) return '';
    return text
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<\/?think>/gi, '')
        .trim();
};

const normalizeTimestamp = (value?: string) => {
    if (!value) return new Date().toISOString();
    if (value.endsWith('Z')) return value;
    return value.includes('T') ? `${value}Z` : value.replace(' ', 'T') + 'Z';
};

const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const ChatWindow = () => {
    const {
        messages,
        isReceiving,
        isConnected,
        conversations,
        activeConversationId,
        confirmRequest,
        setMessages,
        clearMessages,
        setConversations,
        setActiveConversationId,
        removeConversation,
    } = useAgentStore();
    const { sendMessage, regenerateLastResponse, setThinkingEnabled, respondToConfirmation } = useAgentSocket();
    const [input, setInput] = useState('');
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isMemoryOpen, setIsMemoryOpen] = useState(false);
    const [showConversations, setShowConversations] = useState(true);
    const [showThinking, setShowThinking] = useState(false);
    const [showTools, setShowTools] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'messages'>('newest');
    const [pendingAttachments, setPendingAttachments] = useState<any[]>([]);
    const [isDragOver, setIsDragOver] = useState(false);
    const [onboardingOpen, setOnboardingOpen] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [pinnedConversations, setPinnedConversations] = useState<string[]>(() => {
        if (typeof window === 'undefined') return [];
        try {
            return JSON.parse(window.localStorage.getItem(STORAGE_KEYS.pinnedConversations) || '[]');
        } catch {
            return [];
        }
    });

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isReceiving]);

    useEffect(() => {
        window.localStorage.setItem(STORAGE_KEYS.pinnedConversations, JSON.stringify(pinnedConversations));
    }, [pinnedConversations]);

    useEffect(() => {
        setThinkingEnabled(showThinking);
    }, [showThinking, setThinkingEnabled]);

    const loadConversations = useCallback(async () => {
        try {
            const response = await fetch('/api/conversations');
            const data = await response.json();
            setConversations(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Konuşmalar alınamadı:', error);
        }
    }, [setConversations]);

    useEffect(() => {
        void loadConversations();
    }, [loadConversations]);

    useEffect(() => {
        if (!isReceiving) {
            void loadConversations();
        }
    }, [isReceiving, loadConversations]);

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
            }
        };

        void loadOnboardingState();
    }, []);

    const buildRenderableMessages = useCallback((rawMessages: any[]) => {
        const renderable: any[] = [];
        let pendingTools: any[] = [];
        let pendingThinkingEntries: string[] = [];

        rawMessages.forEach((message) => {
            if (message.role === 'user') {
                const attachments = Array.isArray(message.attachments)
                    ? message.attachments.map((attachment: any) => ({
                        ...attachment,
                        previewUrl: attachment.mimeType?.startsWith('image/') && attachment.data
                            ? `data:${attachment.mimeType};base64,${attachment.data}`
                            : null,
                    }))
                    : undefined;

                renderable.push({
                    id: crypto.randomUUID(),
                    role: 'user',
                    content: message.content || '',
                    timestamp: normalizeTimestamp(message.timestamp),
                    attachments,
                });
                return;
            }

            if (message.role === 'assistant') {
                if (Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
                    const cleanedThinking = stripThinkTags(message.content);
                    if (cleanedThinking) {
                        pendingThinkingEntries = [...pendingThinkingEntries, cleanedThinking];
                    }

                    pendingTools = [
                        ...pendingTools,
                        ...message.toolCalls.map((toolCall: any) => ({
                            name: toolCall.name,
                            arguments: toolCall.arguments,
                            status: 'success',
                            result: null,
                            isError: false,
                        })),
                    ];
                    return;
                }

                renderable.push({
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    content: message.content || '',
                    timestamp: normalizeTimestamp(message.timestamp),
                    toolCalls: pendingTools.length ? pendingTools : undefined,
                    thinking: pendingThinkingEntries.length ? pendingThinkingEntries : undefined,
                });
                pendingTools = [];
                pendingThinkingEntries = [];
                return;
            }

            if (message.role === 'tool' && Array.isArray(message.toolResults)) {
                pendingTools = pendingTools.map((tool) => {
                    const match = message.toolResults.find((toolResult: any) => toolResult.name === tool.name && tool.result == null);
                    if (!match) return tool;

                    return {
                        ...tool,
                        result: typeof match.result === 'string' ? match.result : JSON.stringify(match.result ?? ''),
                        isError: !!match.isError,
                        status: match.isError ? 'error' : 'success',
                    };
                });
            }
        });

        if (pendingTools.length || pendingThinkingEntries.length) {
            renderable.push({
                id: crypto.randomUUID(),
                role: 'assistant',
                content: '⏳ İşlem devam ediyor...',
                timestamp: new Date().toISOString(),
                toolCalls: pendingTools.length ? pendingTools : undefined,
                thinking: pendingThinkingEntries.length ? pendingThinkingEntries : undefined,
                pending: true,
            });
        }

        return renderable;
    }, []);

    const loadConversation = useCallback(async (conversationId: string) => {
        try {
            const response = await fetch(`/api/conversations/${conversationId}/messages`);
            const data = await response.json();
            setMessages(buildRenderableMessages(Array.isArray(data) ? data : []));
            setActiveConversationId(conversationId);
        } catch (error) {
            console.error('Konuşma yüklenemedi:', error);
        }
    }, [buildRenderableMessages, setActiveConversationId, setMessages]);

    const handleNewChat = () => {
        clearMessages();
        setActiveConversationId(null);
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
        setPendingAttachments([]);
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleEditMessage = (content: string) => {
        setInput(content);
        textareaRef.current?.focus();
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

    const handleFileSelection = async (files: File[]) => {
        const MAX_FILES = 10;
        const MAX_SIZE = 25 * 1024 * 1024;

        const remainingSlots = Math.max(0, MAX_FILES - pendingAttachments.length);
        const selectedFiles = files.slice(0, remainingSlots);

        const loadedAttachments = await Promise.all(selectedFiles.map((file) => new Promise<any | null>((resolve) => {
            if (file.size > MAX_SIZE) {
                resolve(null);
                return;
            }

            const reader = new FileReader();
            reader.onload = () => {
                const result = String(reader.result || '');
                resolve({
                    fileName: file.name,
                    mimeType: file.type || 'application/octet-stream',
                    size: file.size,
                    data: result.split(',')[1],
                    previewUrl: file.type.startsWith('image/') ? result : null,
                });
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
        })));

        setPendingAttachments((current) => [...current, ...loadedAttachments.filter(Boolean)]);
    };

    const togglePinned = (conversationId: string) => {
        setPinnedConversations((current) => current.includes(conversationId)
            ? current.filter((id) => id !== conversationId)
            : [conversationId, ...current]);
    };

    const deleteConversation = async (conversationId: string) => {
        if (!window.confirm('Bu sohbet silinsin mi?')) return;

        try {
            await fetch(`/api/conversations/${conversationId}`, { method: 'DELETE' });
            removeConversation(conversationId);
            if (conversationId === activeConversationId) {
                handleNewChat();
            }
            await loadConversations();
        } catch (error) {
            console.error('Konuşma silinemedi:', error);
        }
    };

    const groupedConversations = useMemo(() => {
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
            <header className="flex-none h-14 px-6 flex items-center justify-between fixed top-0 left-0 right-0 z-50 w-full border-b border-border/60 bg-background/95 backdrop-blur pointer-events-none">
                <div className="flex items-center gap-4 pointer-events-auto">
                    <span className="text-sm font-semibold tracking-tighter uppercase text-foreground/90 select-none">
                        PençeAI
                    </span>
                    <div className="flex items-center gap-1.5 opacity-50">
                        <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-foreground' : 'bg-destructive'} transition-colors duration-500`} />
                        <span className="text-[10px] uppercase font-medium tracking-widest">{isConnected ? 'Bağlı' : 'Offline'}</span>
                    </div>
                    <span className="hidden md:block text-xs uppercase tracking-[0.22em] text-muted-foreground">
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
                                <Button variant="outline" className="rounded-none" onClick={handleNewChat}>
                                    <Plus className="h-4 w-4" />
                                </Button>
                            </div>
                            <select className="h-10 w-full border border-input bg-card/70 px-3 text-sm" value={sortOrder} onChange={(e) => setSortOrder(e.target.value as 'newest' | 'oldest' | 'messages')}>
                                <option value="newest">En yeni</option>
                                <option value="oldest">En eski</option>
                                <option value="messages">Mesaj sayısı</option>
                            </select>
                        </div>

                        <div className="flex-1 overflow-y-auto p-3">
                            {groupedConversations.pinned.length ? (
                                <div className="mb-6">
                                    <div className="mb-2 px-2 text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Sabitlenmiş</div>
                                    <div className="space-y-2">
                                        {groupedConversations.pinned.map((conversation) => (
                                            <div
                                                key={conversation.id}
                                                className={`w-full border transition-colors ${activeConversationId === conversation.id ? 'border-foreground/40 bg-white/[0.07]' : 'border-border/60 bg-white/[0.03] hover:bg-white/[0.06]'}`}
                                            >
                                                <div className="flex items-start justify-between gap-2 p-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => void loadConversation(conversation.id)}
                                                        className="min-w-0 flex-1 text-left"
                                                    >
                                                        <div className="font-medium text-foreground/90">{conversation.title || conversation.user_name || 'Sohbet'}</div>
                                                        <div className="mt-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">{conversation.message_count || 0} mesaj</div>
                                                    </button>
                                                    <div className="flex gap-1">
                                                        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-none" onClick={() => togglePinned(conversation.id)}>
                                                            <PinOff className="h-3.5 w-3.5" />
                                                        </Button>
                                                        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-none text-destructive" onClick={() => void deleteConversation(conversation.id)}>
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
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
                                const items = groupedConversations.groups[key] || [];
                                if (!items.length) return null;

                                return (
                                    <div key={key} className="mb-6">
                                        <div className="mb-2 px-2 text-[10px] uppercase tracking-[0.24em] text-muted-foreground">{label}</div>
                                        <div className="space-y-2">
                                            {items.map((conversation) => (
                                                <div
                                                    key={conversation.id}
                                                    className={`w-full border transition-colors ${activeConversationId === conversation.id ? 'border-foreground/40 bg-white/[0.07]' : 'border-border/60 bg-white/[0.03] hover:bg-white/[0.06]'}`}
                                                >
                                                    <div className="flex items-start justify-between gap-2 p-3">
                                                        <button
                                                            type="button"
                                                            onClick={() => void loadConversation(conversation.id)}
                                                            className="min-w-0 flex-1 text-left"
                                                        >
                                                            <div className="truncate font-medium text-foreground/90">{conversation.title || conversation.user_name || 'Sohbet'}</div>
                                                            <div className="mt-1 flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                                                                <span>{conversation.message_count || 0} mesaj</span>
                                                                <span>{new Date(normalizeTimestamp(conversation.updated_at || conversation.created_at)).toLocaleDateString('tr-TR')}</span>
                                                            </div>
                                                        </button>
                                                        <div className="flex gap-1">
                                                            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-none" onClick={() => togglePinned(conversation.id)}>
                                                                <Pin className="h-3.5 w-3.5" />
                                                            </Button>
                                                            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-none text-destructive" onClick={() => void deleteConversation(conversation.id)}>
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </aside>
                ) : null}

                <div className="flex min-w-0 flex-1 flex-col">
                    <div ref={scrollRef} className="flex-1 overflow-y-auto">
                        <MessageStream
                            messages={messages}
                            showThinking={showThinking}
                            showTools={showTools}
                            isReceiving={isReceiving}
                            onRegenerate={handleRegenerate}
                            onQuickAction={handleQuickAction}
                            onEditMessage={handleEditMessage}
                        />
                    </div>

                    <div className="w-full flex justify-center pb-6 pt-4 px-4 bg-gradient-to-t from-background via-background/95 to-transparent z-40 relative">
                        <div
                            className={`max-w-3xl w-full flex flex-col relative group border ${isDragOver ? 'border-foreground/50 bg-card/50' : 'border-border/60 bg-card/20'} p-4 transition-colors`}
                            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                            onDragLeave={() => setIsDragOver(false)}
                            onDrop={(e) => {
                                e.preventDefault();
                                setIsDragOver(false);
                                const files = Array.from(e.dataTransfer.files || []);
                                void handleFileSelection(files);
                            }}
                        >
                            {pendingAttachments.length ? (
                                <div className="mb-3 flex flex-wrap gap-2">
                                    {pendingAttachments.map((attachment, index) => (
                                        <div key={`${attachment.fileName}-${index}`} className="flex items-center gap-2 border border-border/60 bg-background/40 px-3 py-2 text-sm">
                                            <span className="max-w-48 truncate">{attachment.fileName}</span>
                                            <span className="text-xs text-muted-foreground">{formatFileSize(attachment.size)}</span>
                                            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setPendingAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}>✕</button>
                                        </div>
                                    ))}
                                </div>
                            ) : null}

                            <Textarea
                                ref={textareaRef}
                                value={input}
                                onChange={(e) => {
                                    setInput(e.target.value);
                                    e.currentTarget.style.height = 'auto';
                                    e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 160)}px`;
                                }}
                                onKeyDown={handleKeyDown}
                                onPaste={(e) => {
                                    const fileItems = Array.from(e.clipboardData.items)
                                        .filter((item) => item.kind === 'file')
                                        .map((item) => item.getAsFile())
                                        .filter(Boolean) as File[];

                                    if (fileItems.length) {
                                        e.preventDefault();
                                        void handleFileSelection(fileItems);
                                    }
                                }}
                                placeholder="Mesajınızı yazın veya dosya bırakın..."
                                className="min-h-[44px] w-full resize-none bg-transparent border-0 focus-visible:ring-0 rounded-none px-0 py-3 text-base font-light placeholder:text-foreground/20 transition-all duration-500"
                                rows={1}
                            />

                            <input
                                ref={fileInputRef}
                                type="file"
                                className="hidden"
                                multiple
                                onChange={(e) => {
                                    const files = Array.from(e.target.files || []);
                                    void handleFileSelection(files);
                                    e.target.value = '';
                                }}
                            />

                            <div className="mt-4 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                    <Button variant="outline" className="rounded-none" onClick={() => fileInputRef.current?.click()}>
                                        <Paperclip className="h-4 w-4" />
                                        Dosya Ekle
                                    </Button>
                                    <Button variant="outline" className="rounded-none" onClick={handleNewChat}>
                                        <Plus className="h-4 w-4" />
                                        Yeni Sohbet
                                    </Button>
                                </div>

                                <div className="flex items-center z-50">
                                    {isReceiving ? (
                                        <Loader2 className="animate-spin w-4 h-4 text-foreground/40" />
                                    ) : (
                                        <Button onClick={handleSend} disabled={!input.trim() && pendingAttachments.length === 0} className="rounded-none">
                                            <Send className="h-4 w-4" />
                                            Gönder
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
