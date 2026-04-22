import { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { useAgentStore } from '../store/agentStore';
import type { ToolCallItem, AttachmentItem, MessageMetrics, MemorySource } from '../store/agentStore';
import { useStats } from './useStats';
import { stripThinkTags } from '@/lib/utils';

// WebSocket mesaj tipleri
interface WsTokenMessage {
	type: 'token';
	content: string;
}

interface WsResponseMessage {
	type: 'response';
	content: string;
	conversationId?: string;
}

interface WsAgentEventMessage {
	type: 'agent_event';
	eventType: string;
	data: Record<string, unknown>;
}

interface WsClearStreamMessage {
	type: 'clear_stream';
}

interface WsReplaceStreamMessage {
	type: 'replace_stream';
	content: string;
}

interface WsErrorMessage {
	type: 'error';
	message: string;
}

interface WsStatsMessage {
	type: 'stats';
	stats: Record<string, unknown>;
}

interface WsConfirmRequestMessage {
	type: 'confirm_request';
	id: string;
	toolName: string;
	path: string;
	operation: string;
	description: string;
}

interface WsMetricsMessage {
	type: 'metrics';
	data: MessageMetrics;
}

interface WsSysLogMessage {
	type: 'sys_log';
	entry: Record<string, unknown>;
}

type WsMessage = WsTokenMessage | WsResponseMessage | WsAgentEventMessage | WsClearStreamMessage | WsReplaceStreamMessage | WsErrorMessage | WsStatsMessage | WsConfirmRequestMessage | WsMetricsMessage | WsSysLogMessage;

// Agent event data tipleri
interface ThinkingEventData {
	content: string;
}

interface ToolStartEventData {
	name: string;
	arguments: Record<string, unknown>;
}

interface ToolEndEventData {
	name: string;
	result: string;
	isError?: boolean;
}

export function useAgentSocket(onMetrics?: (metrics: MessageMetrics) => void) {
    const ws = useRef<WebSocket | null>(null);
    const currentAssistantMessageId = useRef<string | null>(null);
    const pendingToolCalls = useRef<ToolCallItem[]>([]);
    const pendingThinking = useRef<string[]>([]);
    const pendingSources = useRef<MemorySource[]>([]);
    const thinkingEnabledRef = useRef(false);
    const onMetricsRef = useRef(onMetrics);

    // Keep onMetrics ref up-to-date
    onMetricsRef.current = onMetrics;
    
    // Use getState() pattern to avoid stale closures in WebSocket handlers
    const getStore = () => useAgentStore.getState();
    const { updateStatsFromWebSocket } = useStats();

    // Benzersiz bir referansla mount durumunu takip edelim
    const mounted = useRef(true);
    const reconnectTimeout = useRef<number | null>(null);
    const reconnectAttempts = useRef(0);
    const tokenBuffer = useRef<string>('');
    const flushTokenInterval = useRef<number | null>(null);

    const flushTokens = () => {
        if (tokenBuffer.current && currentAssistantMessageId.current) {
            getStore().appendToMessage(currentAssistantMessageId.current, tokenBuffer.current);
            tokenBuffer.current = '';
        }
    };

    const flushAndClearTokens = () => {
        flushTokens();
        tokenBuffer.current = '';
    };

    const syncAssistantMeta = () => {
        const assistantId = currentAssistantMessageId.current;
        if (!assistantId) return;

        getStore().patchMessage(assistantId, {
            toolCalls: pendingToolCalls.current.length > 0 ? [...pendingToolCalls.current] : undefined,
            thinking: pendingThinking.current.length > 0 ? [...pendingThinking.current] : undefined,
            sources: pendingSources.current.length > 0 ? [...pendingSources.current] : undefined,
        });
    };

    const createAssistantPlaceholder = () => {
        const assistantId = crypto.randomUUID();
        currentAssistantMessageId.current = assistantId;
        pendingToolCalls.current = [];
        pendingThinking.current = [];
        pendingSources.current = [];
        getStore().setThinking('');

        getStore().addMessage({
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

        // Vite dev server kullanırken WebSocket proxy'sini kullan
        // Vite config'te /ws proxy'si backend'e (3001) yönlendirilmiş
        // Production'da aynı sunucudan servis edildiği için relative path çalışır
        const wsUrl = `/ws`;

        // WebSocket relative URL kullanırken mevcut host/port otomatik kullanılır
        const socket = new WebSocket(wsUrl);
        ws.current = socket;

        socket.onopen = () => {
            if (!mounted.current) {
                socket.close();
                return;
            }
            reconnectAttempts.current = 0; // Bağlantı başarılı olunca deneme sayısını sıfırla
            getStore().setConnected(true);
            console.log('[WS] Connected to PenceAI Gateway');

            if (thinkingEnabledRef.current) {
                socket.send(JSON.stringify({ type: 'set_thinking', enabled: true }));
            }
        };

        socket.onclose = () => {
            if (!mounted.current) return; // Unmount olduysa reconnect yapma

            getStore().setConnected(false);
            getStore().setReceiving(false);
            
            // Exponential Backoff Stratejisi
            const baseDelay = 1000;
            const maxDelay = 30000; // Maksimum 30 saniye
            const delay = Math.min(baseDelay * Math.pow(2, reconnectAttempts.current), maxDelay);
            reconnectAttempts.current += 1;
            
            console.log(`[WS] Disconnected, attempting reconnect in ${delay}ms...`);
            reconnectTimeout.current = window.setTimeout(connect, delay);
        };

        socket.onerror = (err) => {
          if (!mounted.current) return;
          console.error('[WS] Error:', err);
          toast.error('WebSocket bağlantı hatası oluştu');
        };

        socket.onmessage = (event) => {
            if (!mounted.current) return;
            try {
                const data = JSON.parse(event.data);
                handleWsMessage(data);
            } catch (err) {
              console.error('[WS] Message parse error:', err);
              toast.error('Mesaj işlenirken hata oluştu');
            }
        };
    };

    const handleWsMessage = (data: WsMessage) => {
    switch (data.type) {
            case 'token':
                if (!currentAssistantMessageId.current) {
                    createAssistantPlaceholder();
                }
                if (currentAssistantMessageId.current) {
                    tokenBuffer.current += data.content || '';
                }
                break;

            case 'response':
                flushAndClearTokens();
                if (currentAssistantMessageId.current) {
                    getStore().patchMessage(currentAssistantMessageId.current, {
                        content: data.content ?? '',
                        toolCalls: pendingToolCalls.current.length > 0 ? [...pendingToolCalls.current] : undefined,
                        thinking: pendingThinking.current.length > 0 ? [...pendingThinking.current] : undefined,
                        sources: pendingSources.current.length > 0 ? [...pendingSources.current] : undefined,
                        pending: false,
                    });
                } else {
                    getStore().addMessage({
                        id: crypto.randomUUID(),
                        role: 'assistant',
                        content: data.content ?? '',
                        timestamp: new Date().toISOString(),
                        toolCalls: pendingToolCalls.current.length > 0 ? [...pendingToolCalls.current] : undefined,
                        thinking: pendingThinking.current.length > 0 ? [...pendingThinking.current] : undefined,
                        sources: pendingSources.current.length > 0 ? [...pendingSources.current] : undefined,
                    });
                }

                if (data.conversationId) {
                    getStore().setActiveConversationId(data.conversationId);
                }

                currentAssistantMessageId.current = null;
                pendingToolCalls.current = [];
                pendingThinking.current = [];
                pendingSources.current = [];
                getStore().setThinking('');
                getStore().setReceiving(false);
                break;

            case 'agent_event':
                handleAgentEvent(data.eventType, data.data);
                break;

            case 'clear_stream':
                if (currentAssistantMessageId.current) {
                    getStore().patchMessage(currentAssistantMessageId.current, { content: '' });
                }
                break;

            case 'replace_stream':
                if (currentAssistantMessageId.current) {
                    getStore().patchMessage(currentAssistantMessageId.current, { content: data.content });
                }
                break;

            case 'error':
              flushAndClearTokens();
              toast.error(data.message || 'Bilinmeyen bir hata oluştu');
              if (currentAssistantMessageId.current) {
                getStore().patchMessage(currentAssistantMessageId.current, {
                  content: `⚠️ Hata: ${data.message}`,
                  pending: false,
                  toolCalls: pendingToolCalls.current.length > 0 ? [...pendingToolCalls.current] : undefined,
                  thinking: pendingThinking.current.length > 0 ? [...pendingThinking.current] : undefined,
                });
              } else {
                getStore().addMessage({
                  id: crypto.randomUUID(),
                  role: 'system',
                  content: `⚠️ Hata: ${data.message}`,
                  timestamp: new Date().toISOString(),
                });
              }

                currentAssistantMessageId.current = null;
                pendingToolCalls.current = [];
                pendingThinking.current = [];
                pendingSources.current = [];
                getStore().setThinking('');
                getStore().setReceiving(false);
                break;

            case 'stats':
                updateStatsFromWebSocket(data.stats || {});
                break;

            case 'confirm_request':
                getStore().setConfirmRequest(data);
                break;

            case 'metrics':
                onMetricsRef.current?.(data.data);
                break;

            case 'sys_log':
                // Sistem loglarını global event olarak fırlat — SystemLogsView dinleyebilir
                window.dispatchEvent(new CustomEvent('sys_log', { detail: data.entry }));
                break;
        }
    };

    const handleAgentEvent = (eventType: string, data: unknown) => {
    const eventData = data as Record<string, unknown>;
    switch (eventType) {
    case 'thinking':
    const thinkingData = eventData as Partial<ThinkingEventData>;
    const cleaned = stripThinkTags(thinkingData.content);
                if (cleaned) {
                    pendingThinking.current = [...pendingThinking.current, cleaned];
                    getStore().setThinking(pendingThinking.current.join('\n'));
                    syncAssistantMeta();
                }
                break;
            case 'tool_start': {
            const toolStartData = eventData as Partial<ToolStartEventData>;
            pendingToolCalls.current = [
            ...pendingToolCalls.current,
            {
            name: toolStartData.name ?? '',
            arguments: toolStartData.arguments ?? {},
                        status: 'running',
                        result: null,
                        isError: false,
                    },
                ];
                syncAssistantMeta();
                break;
            }
            case 'tool_end': {
            const toolEndData = eventData as Partial<ToolEndEventData>;
            const lastRunningIndex = (() => {
            for (let index = pendingToolCalls.current.length - 1; index >= 0; index -= 1) {
            const candidate = pendingToolCalls.current[index];
            if (candidate.name === toolEndData.name && candidate.status === 'running') {
                            return index;
                        }
                    }

                    return -1;
                })();

                pendingToolCalls.current = pendingToolCalls.current.map((tool, index) => {
                const isMatchingTool = tool.name === toolEndData.name && tool.status === 'running';
                    const isLastMatch = isMatchingTool && lastRunningIndex === index;

                    if (!isLastMatch) return tool;

                    return {
                    ...tool,
                    status: toolEndData.isError ? 'error' : 'success',
                    result: typeof toolEndData.result === 'string' ? toolEndData.result : JSON.stringify(toolEndData.result ?? ''),
                    isError: !!toolEndData.isError,
                    };
                });
                syncAssistantMeta();
                break;
            }
            case 'iteration':
                break;
            case 'memory_retrieval': {
                // Memory sources used for RAG context
                const sources = eventData.sources as MemorySource[] | undefined;
                if (sources && Array.isArray(sources)) {
                    pendingSources.current = [...pendingSources.current, ...sources];
                    syncAssistantMeta();
                }
                break;
            }
        }
    };

    const sendChatPayload = (content: string, attachments: AttachmentItem[] = [], activeConversationId?: string, appendUserMessage = true) => {
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
            getStore().setReceiving(false);
            return;
        }

        getStore().setReceiving(true);

        if (appendUserMessage) {
            console.debug('[useAgentSocket] sendChatPayload:addUserMessage', {
                contentPreview: content.slice(0, 120),
                attachments: attachments.length,
            });
            getStore().addMessage({
                id: crypto.randomUUID(),
                role: 'user',
                content,
                attachments,
                timestamp: new Date().toISOString()
            });
        }

        createAssistantPlaceholder();
        console.debug('[useAgentSocket] sendChatPayload:placeholder-created');

        const userName = getStore().userName;
        const wsMsg: { type: 'chat'; content: string; userName?: string; attachments?: AttachmentItem[]; conversationId?: string; newConversation?: boolean } = { type: 'chat', content };
      
        if (userName) {
          wsMsg.userName = userName;
        }

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
        getStore().setConfirmRequest(null);
    };

    useEffect(() => {
        mounted.current = true;
        
        // Düzenli aralıklarla tokenları DOM'a bas (Buffer optimizasyonu)
        flushTokenInterval.current = window.setInterval(flushTokens, 50);

        // Strict Mode'da ardışık mount/unmount sırasında çift websocket açmayı ve 
        // "WebSocket is closed before the connection is established" hatasını önlemek için küçük bir gecikme ekliyoruz.
        const connectTimer = window.setTimeout(() => {
            connect();
        }, 100);

        return () => {
            mounted.current = false;
            clearTimeout(connectTimer);
            if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
            if (flushTokenInterval.current) clearInterval(flushTokenInterval.current);

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
