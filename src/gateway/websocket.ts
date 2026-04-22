/**
 * WebSocket bağlantı yönetimi — chat mesajları, onay mekanizması, düşünme modu.
 * index.ts'den çıkarıldı.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import type { ConfirmCallback } from '../agent/tools.js';
import type { MemoryManager } from '../memory/manager.js';
import type { AgentRuntime } from '../agent/runtime.js';
import { getConfig } from './config.js';
import { resolveIncomingUserName } from './userName.js';
import { MessageRouter } from '../router/index.js';
import type { SemanticRouter } from '../router/semantic.js';
import type { BackgroundWorker } from '../autonomous/index.js';
import { logger, runWithTraceId } from '../utils/logger.js';
import { logRingBuffer } from '../utils/logRingBuffer.js';
import { processAttachments, type WebSocketAttachment } from './attachmentProcessor.js';

// ============================================================
// Zod Schemas for WebSocket Messages
// ============================================================

const WebSocketAttachmentSchema = z.object({
  mimeType: z.string().optional(),
  fileName: z.string().optional(),
  size: z.number().optional(),
  data: z.string().optional(),
});

const WebSocketChatMessageSchema = z.object({
  type: z.literal('chat'),
  content: z.string().optional(),
  conversationId: z.string().optional(),
  newConversation: z.boolean().optional(),
  userName: z.string().optional(),
  attachments: z.array(WebSocketAttachmentSchema).optional(),
});

const WebSocketSetThinkingMessageSchema = z.object({
  type: z.literal('set_thinking'),
  enabled: z.boolean(),
});

const WebSocketConfirmResponseMessageSchema = z.object({
  type: z.literal('confirm_response'),
  id: z.string().min(1),
  approved: z.boolean(),
});

const WebSocketMessageSchema = z.union([
  WebSocketChatMessageSchema,
  WebSocketSetThinkingMessageSchema,
  WebSocketConfirmResponseMessageSchema,
]);

/**
 * WebSocket yapılandırma sabitleri
 * Tüm magic number'lar burada merkezi olarak yönetiliyor
 */
export const WS_CONFIG = {
  /** Onay isteği zaman aşımı (ms) */
  confirmationTimeoutMs: 60000,
  /** Maksimum mesaj uzunluğu (karakter) */
  maxMessageLength: 50000,
} as const;

/** Maksimum mesaj işlem süresi (ms) — aşılırsa timeout */
const MESSAGE_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000; // 5 dakika

// WebSocket mesaj tipleri (runtime validation Zod ile yapılır)
interface WebSocketChatMessage {
  type: 'chat';
  content?: string;
  conversationId?: string;
  newConversation?: boolean;
  userName?: string;
  attachments?: WebSocketAttachment[];
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

    // --- Per-connection rate limiter (sliding window) ---
    const wsRateLimiter = new Map<string, number[]>();
    const MAX_WS_MSG_PER_WINDOW = 30;
    const WS_RATE_WINDOW_MS = 60_000;

    function checkWsRateLimit(connId: string): boolean {
      const now = Date.now();
      const calls = wsRateLimiter.get(connId) ?? [];
      const recent = calls.filter(t => t > now - WS_RATE_WINDOW_MS);
      if (recent.length >= MAX_WS_MSG_PER_WINDOW) {
        return false;
      }
      recent.push(now);
      wsRateLimiter.set(connId, recent);
      return true;
    }

    // --- Live Log Broadcasting ---
    logRingBuffer.on('log', (entry) => {
      const payload = JSON.stringify({ type: 'sys_log', entry });
      wss.clients.forEach((client) => {
        if ((client as WebSocket).readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      });
    });

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

    wss.on('connection', (ws, req) => {
        const connId = `${req.socket.remoteAddress || 'unknown'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        logger.info(`[Gateway] 🔗 WebSocket bağlantısı açıldı — ${connId}`);

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
                if (confirmCounter >= Number.MAX_SAFE_INTEGER - 1000) confirmCounter = 0;
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
                    await runWithTraceId(async () => {
                        await Promise.race([
                            handleChatMessage(data, ws),
                            new Promise<void>((_, reject) =>
                                setTimeout(() => reject(new Error('Mesaj işlem süresi doldu (5 dk)')), MESSAGE_PROCESSING_TIMEOUT_MS)
                            ),
                        ]);
                    });
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
            const wsAttachments: WebSocketAttachment[] = Array.isArray(chatData.attachments) ? chatData.attachments : [];
            const { enrichedContent, builtAttachments } = processAttachments(chatData.content, wsAttachments);

            const message = MessageRouter.createWebMessage(
                enrichedContent,
                resolveWebUserName(chatData.userName),
                channelId,
                builtAttachments,
            );

            try {
                // 1. Semantic Router Interception
                const messageContext: Record<string, unknown> = {
                    userId: message.senderId,
                    userName: message.senderName,
                    channelId: message.channelId,
                    timestamp: message.timestamp,
                };
                const semanticCheck = await semanticRouter.route(message.content, messageContext);
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
                        } else if (event.type === 'metrics') {
                            ws.send(JSON.stringify({ type: 'metrics', data: event.data }));
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

            // Rate limit check
            if (!checkWsRateLimit(connId)) {
              logger.warn(`[Gateway] ⛔ WS rate limit exceeded for ${connId}`);
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'error', message: 'Çok fazla mesaj gönderildi, lütfen yavaşlayın.' }));
              }
              return;
            }

            try {
                const parsed = JSON.parse(raw.toString());

                // Zod schema validation
                const validation = WebSocketMessageSchema.safeParse(parsed);
                if (!validation.success) {
                  logger.warn({ errors: validation.error.errors }, '[Gateway] WS mesaj doğrulama hatası');
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Geçersiz mesaj formatı' }));
                  }
                  return;
                }
                const data = validation.data;

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
            wsRateLimiter.delete(connId);
            for (const [id, pending] of pendingConfirmations) {
                pending.resolve(false);
            }
            pendingConfirmations.clear();
            logger.info(`[Gateway] 🔌 WebSocket bağlantısı kapandı — ${connId}`);
        });
    });
}
