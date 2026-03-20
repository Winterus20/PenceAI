import { useEffect, useRef } from 'react';
import { useAgentStore } from '../store/agentStore';
import type { ToolCallItem } from '../store/agentStore';

const stripThinkTags = (text?: string) => {
    if (!text) return '';
    return text
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<\/?think>/gi, '')
        .trim();
};

export function useAgentSocket() {
    const ws = useRef<WebSocket | null>(null);
    const currentAssistantMessageId = useRef<string | null>(null);
    const pendingToolCalls = useRef<ToolCallItem[]>([]);
    const pendingThinking = useRef<string[]>([]);
    const thinkingEnabledRef = useRef(false);
    const {
        setConnected,
        setReceiving,
        addMessage,
        appendToMessage,
        patchMessage,
        setThinking,
        setActiveConversationId,
        setStats,
        setConfirmRequest,
    } = useAgentStore();

    // Benzersiz bir referansla mount durumunu takip edelim
    const mounted = useRef(true);
    const reconnectTimeout = useRef<number | null>(null);

    const syncAssistantMeta = () => {
        const assistantId = currentAssistantMessageId.current;
        if (!assistantId) return;

        patchMessage(assistantId, {
            toolCalls: pendingToolCalls.current.length > 0 ? [...pendingToolCalls.current] : undefined,
            thinking: pendingThinking.current.length > 0 ? [...pendingThinking.current] : undefined,
        });
    };

    const createAssistantPlaceholder = () => {
        const assistantId = crypto.randomUUID();
        currentAssistantMessageId.current = assistantId;
        pendingToolCalls.current = [];
        pendingThinking.current = [];
        setThinking('');

        addMessage({
            id: assistantId,
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString(),
            pending: true,
        });

        return assistantId;
    };

    const connect = () => {
        if (!mounted.current) return;
        if (ws.current?.readyState === WebSocket.OPEN || ws.current?.readyState === WebSocket.CONNECTING) return;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // Explicitly point to backend during Vite development (port 5173) to bypass proxy flakiness
        const wsHost = window.location.port === '5173' ? 'localhost:3000' : window.location.host;
        const wsUrl = `${protocol}//${wsHost}/ws`;

        const socket = new WebSocket(wsUrl);
        ws.current = socket;

        socket.onopen = () => {
            if (!mounted.current) {
                socket.close();
                return;
            }
            setConnected(true);
            console.log('[WS] Connected to PenceAI Gateway');

            if (thinkingEnabledRef.current) {
                socket.send(JSON.stringify({ type: 'set_thinking', enabled: true }));
            }
        };

        socket.onclose = () => {
            if (!mounted.current) return; // Unmount olduysa reconnect yapma

            setConnected(false);
            setReceiving(false);
            console.log('[WS] Disconnected, attempting reconnect in 3s...');
            reconnectTimeout.current = window.setTimeout(connect, 3000);
        };

        socket.onerror = (err) => {
            if (!mounted.current) return;
            console.error('[WS] Error:', err);
        };

        socket.onmessage = (event) => {
            if (!mounted.current) return;
            try {
                const data = JSON.parse(event.data);
                handleWsMessage(data);
            } catch (err) {
                console.error('[WS] Message parse error:', err);
            }
        };
    };

    const handleWsMessage = (data: any) => {
        switch (data.type) {
            case 'token':
                if (!currentAssistantMessageId.current) {
                    createAssistantPlaceholder();
                }
                if (currentAssistantMessageId.current) {
                    appendToMessage(currentAssistantMessageId.current, data.content || '');
                }
                break;

            case 'response':
                if (currentAssistantMessageId.current) {
                    patchMessage(currentAssistantMessageId.current, {
                        content: data.content ?? '',
                        toolCalls: pendingToolCalls.current.length > 0 ? [...pendingToolCalls.current] : undefined,
                        thinking: pendingThinking.current.length > 0 ? [...pendingThinking.current] : undefined,
                        pending: false,
                    });
                } else {
                    addMessage({
                        id: crypto.randomUUID(),
                        role: 'assistant',
                        content: data.content ?? '',
                        timestamp: new Date().toISOString(),
                        toolCalls: pendingToolCalls.current.length > 0 ? [...pendingToolCalls.current] : undefined,
                        thinking: pendingThinking.current.length > 0 ? [...pendingThinking.current] : undefined,
                    });
                }

                if (data.conversationId) {
                    setActiveConversationId(data.conversationId);
                }

                currentAssistantMessageId.current = null;
                pendingToolCalls.current = [];
                pendingThinking.current = [];
                setThinking('');
                setReceiving(false);
                break;

            case 'agent_event':
                handleAgentEvent(data.eventType, data.data);
                break;

            case 'clear_stream':
                if (currentAssistantMessageId.current) {
                    patchMessage(currentAssistantMessageId.current, { content: '' });
                }
                break;

            case 'replace_stream':
                if (currentAssistantMessageId.current) {
                    patchMessage(currentAssistantMessageId.current, { content: data.content });
                }
                break;

            case 'tool_use':
                break;

            case 'error':
                if (currentAssistantMessageId.current) {
                    patchMessage(currentAssistantMessageId.current, {
                        content: `⚠️ Hata: ${data.message}`,
                        pending: false,
                        toolCalls: pendingToolCalls.current.length > 0 ? [...pendingToolCalls.current] : undefined,
                        thinking: pendingThinking.current.length > 0 ? [...pendingThinking.current] : undefined,
                    });
                } else {
                    addMessage({
                        id: crypto.randomUUID(),
                        role: 'system',
                        content: `⚠️ Hata: ${data.message}`,
                        timestamp: new Date().toISOString(),
                    });
                }

                currentAssistantMessageId.current = null;
                pendingToolCalls.current = [];
                pendingThinking.current = [];
                setThinking('');
                setReceiving(false);
                break;

            case 'stats':
                setStats(data.stats || {});
                break;

            case 'confirm_request':
                setConfirmRequest(data);
                break;
        }
    };

    const handleAgentEvent = (eventType: string, data: any) => {
        switch (eventType) {
            case 'thinking':
                const cleaned = stripThinkTags(data.content);
                if (cleaned) {
                    pendingThinking.current = [...pendingThinking.current, cleaned];
                    setThinking(pendingThinking.current.join('\n'));
                    syncAssistantMeta();
                }
                break;
            case 'tool_start': {
                pendingToolCalls.current = [
                    ...pendingToolCalls.current,
                    {
                        name: data.name,
                        arguments: data.arguments,
                        status: 'running',
                        result: null,
                        isError: false,
                    },
                ];
                syncAssistantMeta();
                break;
            }
            case 'tool_end': {
                const lastRunningIndex = (() => {
                    for (let index = pendingToolCalls.current.length - 1; index >= 0; index -= 1) {
                        const candidate = pendingToolCalls.current[index];
                        if (candidate.name === data.name && candidate.status === 'running') {
                            return index;
                        }
                    }

                    return -1;
                })();

                pendingToolCalls.current = pendingToolCalls.current.map((tool, index) => {
                    const isMatchingTool = tool.name === data.name && tool.status === 'running';
                    const isLastMatch = isMatchingTool && lastRunningIndex === index;

                    if (!isLastMatch) return tool;

                    return {
                        ...tool,
                        status: data.isError ? 'error' : 'success',
                        result: typeof data.result === 'string' ? data.result : JSON.stringify(data.result ?? ''),
                        isError: !!data.isError,
                    };
                });
                syncAssistantMeta();
                break;
            }
            case 'iteration':
                break;
        }
    };

    const sendChatPayload = (content: string, attachments: any[] = [], activeConversationId?: string, appendUserMessage = true) => {
        const trimmedContent = content.trim();
        const isConnected = useAgentStore.getState().isConnected;
        const socket = ws.current;
        const readyState = socket?.readyState;

        console.debug('[useAgentSocket] sendChatPayload:start', {
            contentLength: content.length,
            trimmedLength: trimmedContent.length,
            attachments: attachments.length,
            activeConversationId,
            appendUserMessage,
            isConnected,
            readyState,
        });

        if (!trimmedContent && attachments.length === 0) {
            console.debug('[useAgentSocket] sendChatPayload:blocked', {
                reason: 'empty-payload',
                content,
                attachments: attachments.length,
            });
            return;
        }

        if (!isConnected || readyState !== WebSocket.OPEN || !socket) {
            console.warn('[useAgentSocket] sendChatPayload:blocked', {
                reason: !isConnected ? 'not-connected' : !socket ? 'missing-socket' : 'socket-not-open',
                readyState,
                contentPreview: content.slice(0, 120),
                attachments: attachments.length,
            });
            setReceiving(false);
            return;
        }

        setReceiving(true);

        if (appendUserMessage) {
            console.debug('[useAgentSocket] sendChatPayload:addUserMessage', {
                contentPreview: content.slice(0, 120),
                attachments: attachments.length,
            });
            addMessage({
                id: crypto.randomUUID(),
                role: 'user',
                content,
                attachments,
                timestamp: new Date().toISOString()
            });
        }

        createAssistantPlaceholder();
        console.debug('[useAgentSocket] sendChatPayload:placeholder-created');

        const wsMsg: any = { type: 'chat', content };

        if (attachments.length > 0) {
            wsMsg.attachments = attachments.map(att => ({
                fileName: att.fileName,
                mimeType: att.mimeType,
                size: att.size,
                data: att.data
            }));
        }

        if (activeConversationId) {
            wsMsg.conversationId = activeConversationId;
        } else {
            wsMsg.newConversation = true;
        }

        console.debug('[useAgentSocket] sendChatPayload:ws-send', {
            payloadType: wsMsg.type,
            hasConversationId: !!wsMsg.conversationId,
            newConversation: !!wsMsg.newConversation,
            attachments: wsMsg.attachments?.length ?? 0,
            readyStateBeforeSend: socket.readyState,
        });

        socket.send(JSON.stringify(wsMsg));
    };

    const sendMessage = (content: string, attachments: any[] = [], activeConversationId?: string) => {
        sendChatPayload(content, attachments, activeConversationId, true);
    };

    const regenerateLastResponse = (content: string, activeConversationId?: string) => {
        sendChatPayload(content, [], activeConversationId, false);
    };

    const setThinkingEnabled = (enabled: boolean) => {
        thinkingEnabledRef.current = enabled;
        if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify({ type: 'set_thinking', enabled }));
        }
    };

    const respondToConfirmation = (id: string, approved: boolean) => {
        if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify({
                type: 'confirm_response',
                id,
                approved,
            }));
        }
        setConfirmRequest(null);
    };

    useEffect(() => {
        mounted.current = true;
        // Strict Mode'da ardışık mount/unmount sırasında çift websocket açmayı ve 
        // "WebSocket is closed before the connection is established" hatasını önlemek için küçük bir gecikme ekliyoruz.
        const connectTimer = window.setTimeout(() => {
            connect();
        }, 100);

        return () => {
            mounted.current = false;
            clearTimeout(connectTimer);
            if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);

            if (ws.current) {
                ws.current.onclose = null; // Unmount tetiklendiğinde reconnect'i engelle
                ws.current.onerror = null;
                ws.current.onmessage = null;
                ws.current.onopen = null;
                ws.current.close();
                ws.current = null;
            }
        };
    }, []);

    return {
        sendMessage,
        regenerateLastResponse,
        setThinkingEnabled,
        respondToConfirmation,
    };
}
