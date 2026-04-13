import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import type { Channel, ChannelType, UnifiedMessage, MessageResponse, Attachment } from './types.js';

type MessageHandler = (message: UnifiedMessage) => Promise<void>;

export interface ChannelRegistrationOptions {
    forceReplace?: boolean; // Aynı tip kanal varsa eskisini değiştirir (default: true)
}

export class MessageRouter {
    private channels: Map<ChannelType, Channel> = new Map();
    private messageHandler: MessageHandler | null = null;

    /**
     * Yeni bir kanal kaydeder.
     * Aynı tip kanal zaten varsa, forceReplace=true ise eskisini değiştirir.
     */
    registerChannel(channel: Channel, options?: ChannelRegistrationOptions): void {
        const forceReplace = options?.forceReplace ?? true;
        
        // Duplicate channel kontrolü
        const existingChannel = this.channels.get(channel.type);
        if (existingChannel) {
            if (!forceReplace) {
                logger.warn(`[Router] ⚠️ Kanal zaten kayıtlı: ${channel.type} (${existingChannel.name}). Yeni kayıt reddedildi.`);
                return;
            }
            logger.warn(`[Router] 🔄 Mevcut kanal değiştiriliyor: ${channel.type} (${existingChannel.name} → ${channel.name})`);
        }

        this.channels.set(channel.type, channel);
        channel.onMessage(async (message) => {
            logger.info(`[Router] 📨 ${channel.type}/${message.senderName}: ${message.content.substring(0, 80)}${message.content.length > 80 ? '...' : ''}`);
            if (this.messageHandler) {
                await this.messageHandler(message);
            }
        });
        logger.info(`[Router] ✅ Kanal kaydedildi: ${channel.name} (${channel.type})`);
    }

    /**
     * Tüm kaydedilmiş kanalları başlatır.
     */
    async connectAll(): Promise<void> {
        for (const [type, channel] of this.channels) {
            try {
                await channel.connect();
                logger.info(`[Router] 🔗 ${type} bağlandı`);
            } catch (err) {
                logger.error({ err }, `[Router] ❌ ${type} bağlantı hatası`);
            }
        }
    }

    /**
     * Tüm kanalları kapatır.
     */
    async disconnectAll(): Promise<void> {
        for (const [type, channel] of this.channels) {
            try {
                await channel.disconnect();
                logger.info(`[Router] 🔌 ${type} bağlantısı kesildi`);
            } catch (err) {
                logger.error({ err }, `[Router] ❌ ${type} kapatma hatası`);
            }
        }
    }

    /**
     * Gelen mesajları işleyecek handler'ı ayarlar.
     */
    onMessage(handler: MessageHandler): void {
        this.messageHandler = handler;
    }

    /**
     * Belirli bir kanala yanıt gönderir.
     * Race condition koruması: sendMessage sırasında bağlantı koparsa otomatik reconnect dener.
     */
    async sendResponse(channelType: ChannelType, channelId: string, response: MessageResponse): Promise<void> {
        const channel = this.channels.get(channelType);
        if (!channel) {
            throw new Error(`Kanal bulunamadı: ${channelType}`);
        }
        if (!channel.isConnected) {
            throw new Error(`Kanal bağlı değil: ${channelType}`);
        }

        try {
            await channel.sendMessage(channelId, response);
        } catch (err: any) {
            logger.warn({ err }, `[Router] ⚠️ Mesaj gönderme hatası (${channelType}), yeniden bağlanma deneniyor...`);
            
            // Otomatik reconnect denemesi (1 kez)
            try {
                await channel.connect();
                logger.info(`[Router] 🔗 ${channelType} yeniden bağlandı`);
                await channel.sendMessage(channelId, response);
            } catch (reconnectErr: any) {
                logger.error({ err: reconnectErr }, `[Router] ❌ ${channelType} yeniden bağlanma başarısız`);
                throw new Error(
                    `Mesaj gönderilemedi (${channelType}): ${reconnectErr.message ?? 'Bilinmeyen hata'}`
                );
            }
        }
    }

    /**
     * Kayıtlı kanalların durumunu döndürür.
     */
    getChannelStatus(): Array<{ type: ChannelType; name: string; connected: boolean }> {
        return Array.from(this.channels.entries()).map(([type, channel]) => ({
            type,
            name: channel.name,
            connected: channel.isConnected,
        }));
    }

    /**
     * Web Dashboard'dan gelen mesaj için UnifiedMessage oluşturur.
     */
    static createWebMessage(content: string, userName: string = 'Kullanıcı', channelId: string = 'dashboard', attachments: Attachment[] = []): UnifiedMessage {
        return {
            id: uuidv4(),
            channelType: 'web',
            channelId,
            senderId: 'default',
            senderName: userName,
            content,
            attachments,
            timestamp: new Date(),
        };
    }
}
