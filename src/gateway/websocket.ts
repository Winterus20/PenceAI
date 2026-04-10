/**
 * WebSocket bağlantı yönetimi — chat mesajları, onay mekanizması, düşünme modu.
 * index.ts'den çıkarıldı.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { ConfirmCallback } from '../agent/tools.js';
import type { MemoryManager } from '../memory/manager.js';
import type { AgentRuntime } from '../agent/runtime.js';
import { getConfig } from './config.js';
import { resolveIncomingUserName } from './userName.js';
import { MessageRouter } from '../router/index.js';
import type { SemanticRouter } from '../router/semantic.js';
import type { BackgroundWorker } from '../autonomous/index.js';
import { logger, runWithTraceId } from '../utils/logger.js';

/**
 * WebSocket yapılandırma sabitleri
 * Tüm magic number'lar burada merkezi olarak yönetiliyor
 */
export const WS_CONFIG = {
  /** Onay isteği zaman aşımı (ms) */
  confirmationTimeoutMs: 60000,
  /** Maksimum mesaj uzunluğu (karakter) */
  maxMessageLength: 50000,
  /** Maksimum dosya boyutu (Base64, byte) */
  maxAttachmentBase64Size: 10 * 1024 * 1024, // 10 MB
  /** Metin dosyası kısaltma sınırı (karakter) */
  maxTextFileLength: 20000,
} as const;

// WebSocket mesaj tipleri
interface WebSocketChatMessage {
	type: 'chat';
	content?: string;
	conversationId?: string;
	newConversation?: boolean;
	userName?: string;
	attachments?: WebSocketAttachment[];
	traceId?: string; // Langfuse trace ID propagation
}

interface WebSocketAttachment {
	mimeType?: string;
	fileName?: string;
	size?: number;
	data?: string;
}

interface WebSocketSetThinkingMessage {
	type: 'set_thinking';
	enabled: boolean;
}

interface WebSocketConfirmResponseMessage {
	type: 'confirm_response';
	id: string;
	approved: boolean;
}

type WebSocketMessage = WebSocketChatMessage | WebSocketSetThinkingMessage | WebSocketConfirmResponseMessage | Record<string, unknown>;

export interface WebSocketDeps {
    memory: MemoryManager;
    agent: AgentRuntime;
    semanticRouter: SemanticRouter;
    autonomousWorker: BackgroundWorker;
    broadcastStats: () => void;
}

export function resolveWebUserName(candidate: unknown): string {
    return resolveIncomingUserName(candidate, getConfig().defaultUserName);
}

export function setupWebSocket(wss: WebSocketServer, deps: WebSocketDeps): void {
    const { memory, agent, semanticRouter, autonomousWorker, broadcastStats } = deps;

    // --- Keep-Alive Ping/Pong ---
    const keepAliveInterval = setInterval(() => {
        wss.clients.forEach((client) => {
            const wsWithAlive = client as WebSocket & { isAlive?: boolean };
            if (wsWithAlive.isAlive === false) {
                logger.debug('[Gateway] 💀 Zombi WebSocket bağlantısı sonlandırıldı');
                return client.terminate();
            }
            wsWithAlive.isAlive = false;
            client.ping();
        });
    }, 30000);

    wss.on('close', () => {
        clearInterval(keepAliveInterval);
    });

    wss.on('connection', (ws) => {
        logger.info(`[Gateway] 🔗 WebSocket bağlantısı açıldı`);

        const wsWithAlive = ws as WebSocket & { isAlive?: boolean };
        wsWithAlive.isAlive = true;
        ws.on('pong', () => {
            wsWithAlive.isAlive = true;
        });

        // --- Per-connection mesaj kuyruğu (race condition önleme) ---
        const messageQueue: Array<{ data: WebSocketMessage }> = [];
        let isProcessing = false;

        // --- Per-connection düşünme modu ---
        let thinkingEnabled = false;

        // --- Per-connection aktif konuşma takibi ---
        let lastActiveConversationId: string | null = null;

        // --- Per-connection onay bekleme haritası ---
        const pendingConfirmations = new Map<string, { resolve: (approved: boolean) => void }>();
        let confirmCounter = 0;

        /**
         * WS üzerinden kullanıcıdan onay isteyen callback.
         */
        const confirmCallback: ConfirmCallback = (info) => {
            return new Promise<boolean>((resolve) => {
                const confirmId = `confirm_${++confirmCounter}_${Date.now()}`;
                pendingConfirmations.set(confirmId, { resolve });

                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'confirm_request',
                        id: confirmId,
                        toolName: info.toolName,
                        path: info.path,
                        operation: info.operation,
                        description: info.description,
                    }));
                } else {
                    pendingConfirmations.delete(confirmId);
                    resolve(false);
                }

                setTimeout(() => {
                  if (pendingConfirmations.has(confirmId)) {
                    pendingConfirmations.delete(confirmId);
                    resolve(false);
                  }
                }, WS_CONFIG.confirmationTimeoutMs);
            });
        };

        async function processQueue() {
            if (isProcessing || messageQueue.length === 0) return;
            isProcessing = true;

            while (messageQueue.length > 0) {
                const { data } = messageQueue.shift()!;
                try {
                    // Extract traceId from chat message for Langfuse propagation
                    const traceId = (data as WebSocketChatMessage).traceId;
                    await runWithTraceId(async () => {
                        await handleChatMessage(data, ws);
                    }, traceId);
                } catch (err) {
                    logger.error({ err }, '[Gateway] Kuyruk mesaj hatası');
                }
            }

            isProcessing = false;
        }

        async function handleChatMessage(data: WebSocketMessage, ws: WebSocket) {
        // Type guard: Sadece chat mesajlarını işle
        if (data.type !== 'chat') {
        	return;
        }
        const chatData = data as WebSocketChatMessage;
       
        let channelId: string;
       
        if (chatData.newConversation) {
        channelId = `web-${Date.now()}`;
        } else if (chatData.conversationId) {
        const ctx = memory.getConversationContext(chatData.conversationId);
        channelId = ctx ? ctx.channelId : `web-${Date.now()}`;
        } else {
        channelId = `web-${Date.now()}`;
        }

            // ---- Dosya ekleme işleme ----
            const TEXT_MIMES = new Set([
                'text/plain', 'text/markdown', 'text/csv', 'text/html', 'text/css',
                'text/javascript', 'text/typescript', 'application/json', 'application/xml',
                'application/javascript', 'application/typescript',
            ]);
            const isTextFile = (mimeType: string, fileName: string) =>
                TEXT_MIMES.has(mimeType) ||
                mimeType.startsWith('text/') ||
                /\.(txt|md|json|csv|xml|html|htm|css|js|ts|jsx|tsx|py|rb|java|c|cpp|h|hpp|cs|go|rs|sh|yaml|yml|toml|ini|cfg|conf|env|log|sql)$/i.test(fileName || '');

            let enrichedContent: string = chatData.content ?? '';
            const wsAttachments: WebSocketAttachment[] = Array.isArray(chatData.attachments) ? chatData.attachments : [];
            const builtAttachments: import('../router/types.js').Attachment[] = [];

            for (const att of wsAttachments) {
                const mime: string = att.mimeType || 'application/octet-stream';
                const name: string = att.fileName || 'dosya';

                // OPT-5: Base64 boyut sınırı — büyük dosyalar olay döngüsünü bloke eder
                if (att.data && typeof att.data === 'string' && att.data.length > WS_CONFIG.maxAttachmentBase64Size) {
                    logger.warn(`[Gateway] ⚠️ Dosya çok büyük, atlandı: ${name} (${(att.data.length / 1024 / 1024).toFixed(1)} MB base64)`);
                    enrichedContent += `\n\n[Dosya çok büyük ve işlenemedi: ${name} (${mime})]`;
                    continue;
                }

                if (att.data && isTextFile(mime, name)) {
                    let text: string;
                    try {
                        text = Buffer.from(att.data as string, 'base64').toString('utf-8');
                    } catch {
                        text = '(içerik okunamadı)';
                    }
                    const truncated = text.length > WS_CONFIG.maxTextFileLength ? text.substring(0, WS_CONFIG.maxTextFileLength) + '\n...(dosya uzun, kısaltıldı)' : text;
                    const lang = name.split('.').pop() || '';
                    enrichedContent += `\n\n---\n**[Dosya: ${name}]**\n\`\`\`${lang}\n${truncated}\n\`\`\``;
                    logger.info(`[Gateway] 📄 Metin dosyası eklendi: ${name} (${text.length} karakter)`);
                } else if (mime.startsWith('image/') && att.data) {
                    let imgBuffer: Buffer;
                    try {
                        imgBuffer = Buffer.from(att.data as string, 'base64');
                    } catch {
                        imgBuffer = Buffer.alloc(0);
                    }
                    builtAttachments.push({
                        type: 'image',
                        mimeType: mime,
                        fileName: name,
                        size: att.size,
                        data: imgBuffer,
                    });
                    enrichedContent += enrichedContent.trim() ? '' : '(Aşağıdaki görseli analiz et)';
                    logger.info(`[Gateway] 🖼️ Görsel eklendi: ${name} (${mime}, ${imgBuffer.length} byte)`);
                } else {
                    builtAttachments.push({
                        type: mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : 'document',
                        mimeType: mime,
                        fileName: name,
                        size: att.size,
                    });
                    enrichedContent += `\n\n[Kullanıcı bir dosya ekledi: ${name} (${mime})]`;
                    logger.info(`[Gateway] 📎 Binary dosya eklendi: ${name} (${mime})`);
                }
            }

            const message = MessageRouter.createWebMessage(
                enrichedContent,
                resolveWebUserName(chatData.userName),
                channelId,
                builtAttachments,
            );

            try {
                // 1. Semantic Router Interception
                const semanticCheck = await semanticRouter.route(message.content, message);
                if (semanticCheck.handled && semanticCheck.response) {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'response',
                            content: semanticCheck.response,
                            conversationId: chatData.conversationId || `web-${Date.now()}`,
                        }));
                    }
                    return;
                }

                // 2. Default LLM Pipeline
                const { response, conversationId: convId } = await agent.processMessage(message, (event) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        if (event.type === 'token') {
                            ws.send(JSON.stringify({ type: 'token', content: event.data.content }));
                        } else if (event.type === 'clear_stream') {
                            ws.send(JSON.stringify({ type: 'clear_stream' }));
                        } else if (event.type === 'replace_stream') {
                            ws.send(JSON.stringify({ type: 'replace_stream', content: event.data.content }));
                        } else {
                            ws.send(JSON.stringify({
                                type: 'agent_event',
                                eventType: event.type,
                                data: event.data,
                            }));
                        }
                    }
                }, confirmCallback, { thinking: thinkingEnabled });

                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'response',
                        content: response,
                        conversationId: convId,
                    }));
                }

                // Önceden aktif olan konuşmadan farklı bir konuşmaya geçildiyse, eski konuşmayı analiz et
                if (lastActiveConversationId && lastActiveConversationId !== convId) {
                    const oldCtx = memory.getConversationContext(lastActiveConversationId);
                    if (oldCtx && oldCtx.history.length > 1) {
                        agent.extractMemoriesDeep(lastActiveConversationId).catch(err => {
                            logger.error({ err }, `[Gateway] Konuşma değişimi sonrası derin analiz hatası (id: ${lastActiveConversationId})`);
                        });
                    }
                }
                lastActiveConversationId = convId;

                broadcastStats();
            } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
            type: 'error',
            message: error.message || 'Bilinmeyen hata',
            }));
            }
            }
        }

        ws.on('message', async (raw) => {
            autonomousWorker.registerUserActivity();

            try {
                const data = JSON.parse(raw.toString());

                if (data.type === 'chat' && (data.content || (data.attachments && data.attachments.length > 0))) {
                  if (typeof data.content === 'string' && data.content.length > WS_CONFIG.maxMessageLength) {
                    ws.send(JSON.stringify({ type: 'error', message: `Mesaj çok uzun (maksimum ${WS_CONFIG.maxMessageLength.toLocaleString('tr-TR')} karakter)` }));
                        return;
                    }
                    messageQueue.push({ data });
                    logger.info(`[Gateway] 📥 Mesaj kuyruğa eklendi (kuyruk: ${messageQueue.length})`);
                    processQueue();
                } else if (data.type === 'set_thinking') {
                    thinkingEnabled = !!data.enabled;
                    logger.info(`[Gateway] 🧠 Düşünme modu: ${thinkingEnabled ? '✅ Açık' : '❌ Kapalı'}`);
                } else if (data.type === 'confirm_response' && data.id) {
                    const pending = pendingConfirmations.get(data.id);
                    if (pending) {
                        pendingConfirmations.delete(data.id);
                        pending.resolve(!!data.approved);
                        logger.info(`[Gateway] 🔐 Onay yanıtı: ${data.id} → ${data.approved ? '✅ onaylandı' : '❌ reddedildi'}`);
                    }
                }
            } catch (err) {
                logger.error({ err }, '[Gateway] WS mesaj hatası');
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Mesaj işlenemedi',
                    }));
                }
            }
        });

        ws.on('close', () => {
            messageQueue.length = 0;
            for (const [id, pending] of pendingConfirmations) {
                pending.resolve(false);
            }
            pendingConfirmations.clear();
            logger.info(`[Gateway] 🔌 WebSocket bağlantısı kapandı`);
        });
    });
}
