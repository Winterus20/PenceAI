import type { Message} from 'discord.js';
import { Client, GatewayIntentBits, Partials, AttachmentBuilder } from 'discord.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger.js';
import type { Channel, UnifiedMessage, MessageResponse, Attachment } from '../../router/types.js';

export class DiscordChannel implements Channel {
    public readonly type = 'discord';
    public readonly name = 'Discord Gateway';
    public isConnected = false;
    
    private client: Client;
    private messageHandler?: (message: UnifiedMessage) => Promise<void>;
    private readonly token: string;
    private readonly allowedUsers: string[];
    
    // Arka plan bağlamı (sessiz dinleme) için son aktif kanal takibi
    private lastActiveChannelId: string | null = null;
    
    // Mesajları 2000 karaktere bölme boyutu
    private static readonly MAX_MESSAGE_LENGTH = 2000;

    constructor(token: string, allowedUsers: string[]) {
        this.token = token;
        // Tüm ID'leri işlenmesi kolay olması için string listesi
        this.allowedUsers = allowedUsers;
        
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.DirectMessages,
            ],
            partials: [Partials.Channel, Partials.Message],
        });

        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        this.client.on('ready', () => {
            this.isConnected = true;
            logger.info(`[Discord] 🤖 Bot giriş yaptı: ${this.client.user?.tag}`);
        });

        this.client.on('disconnect', () => {
            this.isConnected = false;
            logger.warn('[Discord] 🔌 Bağlantı koptu.');
        });

        this.client.on('messageCreate', async (message: Message) => {
            if (!this.messageHandler || message.author.bot || !this.client.user) return;
            
            const isDM = message.channel.isDMBased();
            const isMentioned = message.mentions.has(this.client.user.id);
            const isReplyToBot = message.reference && message.mentions.repliedUser?.id === this.client.user.id;
            const isTargeted = isMentioned || isReplyToBot;

            // DM Yetki Kontrolü
            if (isDM && this.allowedUsers.length > 0 && !this.allowedUsers.includes(message.author.id)) {
                logger.warn(`[Discord] ⛔ Yetkisiz DM denemesi reddedildi: ${message.author.tag} (${message.author.id})`);
                await message.reply('Bu botla etkileşime girme yetkiniz bulunmamaktadır.');
                return;
            }

            // Normal etkileşim (Tetikleyici mesaj: DM veya Sunucuda bir mention/reply ise)
            if (isDM || isTargeted) {
                this.lastActiveChannelId = message.channel.id;
                
                // Mesaj içeriğini temizle (Botun mentionID'lerini metinden sil - Model kafası karışmasın)
                let cleanContent = message.content.replace(new RegExp(`<@!?${this.client.user.id}>`, 'g'), '').trim();
                if (!cleanContent && message.attachments.size > 0) {
                    cleanContent = 'Ekteki dosyayı incele';
                }

                // AI'ın kimin konuştuğunu bilmesi için mesajın başına ismi ekliyoruz
                const authorName = message.author.globalName || message.author.username;
                cleanContent = `[Kullanıcı: ${authorName}] ${cleanContent}`;

                // Kullanıcıya botun mesajı işlediğini belli etmek için "yazıyor..." (typing) indicator gönder
                if ('sendTyping' in message.channel) {
                    try {
                        const targetChannel = message.channel as any;
                        await targetChannel.sendTyping();
                    } catch (e) {
                         logger.warn({ err: e }, '[Discord] Typing trigger failed');
                    }
                }

                const unifiedMsg = await this.convertToUnifiedMessage(message, cleanContent);
                await this.messageHandler(unifiedMsg);
            } 
            // Arka plan bağlamı ("Sessiz Dinleme") - Sadece en son aktif kanalda, hedef alınmayan mesajlarda
            else if (!isDM && message.channel.id === this.lastActiveChannelId) {
                const authorName = message.author.globalName || message.author.username;
                const formattedContent = `[Kullanıcı: ${authorName}] ${message.content}`;
                const unifiedMsg = await this.convertToUnifiedMessage(message, formattedContent);
                // Arka plan bayrağı ekle
                unifiedMsg.metadata = { ...unifiedMsg.metadata, isBackgroundContext: true };
                
                // Sadece handler'a fırlat, LLM'de isBackgroundContext tespit edilip sadece DB'ye yazılacak.
                await this.messageHandler(unifiedMsg);
            }
        });
    }

    private async convertToUnifiedMessage(message: Message, content: string): Promise<UnifiedMessage> {
        const unifiedAttachments: Attachment[] = [];
        
        // Gelen ekleri (resimler vb) topla
        for (const [_, att] of message.attachments) {
            let type: Attachment['type'] = 'other';
            if (att.contentType?.startsWith('image/')) type = 'image';
            else if (att.contentType?.startsWith('video/')) type = 'video';
            else if (att.contentType?.startsWith('audio/')) type = 'audio';
            else if (att.contentType?.startsWith('text/') || att.contentType?.startsWith('application/')) type = 'document';

            // Veriyi arrayBuffer olarak çekmek, projede belleğe işlenmesi için gerekebilir
            try {
                const response = await fetch(att.url);
                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                unifiedAttachments.push({
                    type,
                    url: att.url,
                    mimeType: att.contentType || 'application/octet-stream',
                    fileName: att.name,
                    size: att.size,
                    data: buffer
                });
            } catch (err) {
                logger.warn({ err }, `[Discord] ⚠️ Eklenti (attachment) indirilemedi: ${att.url}`);
            }
        }

        return {
            id: message.id || uuidv4(),
            channelType: 'discord',
            channelId: message.channel.id,
            senderId: message.author.id,
            senderName: message.author.globalName || message.author.username,
            content: content,
            attachments: unifiedAttachments,
            timestamp: message.createdAt,
            replyToId: message.reference?.messageId,
            metadata: {}
        };
    }

    public async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.isConnected) return resolve();

            this.client.once('ready', () => {
                resolve();
            });

            this.client.login(this.token).catch(err => {
                logger.error({ err }, '[Discord] ❌ Login başarısız oldu');
                reject(err);
            });
        });
    }

    public async disconnect(): Promise<void> {
        if (this.isConnected) {
            this.client.destroy();
            this.isConnected = false;
        }
    }

    public async sendMessage(channelId: string, response: MessageResponse): Promise<void> {
        try {
            const discordChannel = await this.client.channels.fetch(channelId);
            if (!discordChannel || !discordChannel.isTextBased()) {
                throw new Error(`Kanal metin tabanlı değil veya bulunamadı: ${channelId}`);
            }

            // --- Chunking (Mesajı Parçalara Ayırma) ---
            const messageChunks = this.splitMessage(response.content, DiscordChannel.MAX_MESSAGE_LENGTH);

            for (let i = 0; i < messageChunks.length; i++) {
                const chunk = messageChunks[i];
                const msgPayload: any = { content: chunk !== '' ? chunk : undefined };

                // Sadece son parçaya eklentileri (attachments) dahil et
                if (i === messageChunks.length - 1 && response.attachments && response.attachments.length > 0) {
                     msgPayload.files = response.attachments.map(att => {
                         if (att.data) return new AttachmentBuilder(att.data).setName(att.fileName || 'file');
                         else if (att.url) return new AttachmentBuilder(att.url).setName(att.fileName || 'file');
                         return null;
                     }).filter(Boolean);
                }

                // If content is completely missing and no files, skip
                if (!msgPayload.content && (!msgPayload.files || msgPayload.files.length === 0)) continue;

                const targetChannel = discordChannel as any;
                await targetChannel.send(msgPayload);
            }
        } catch (error) {
            logger.error({ err: error, channelId }, '[Discord] ❌ Mesaj gönderilemedi');
            throw error;
        }
    }

    public onMessage(handler: (message: UnifiedMessage) => Promise<void>): void {
        this.messageHandler = handler;
    }
    
    /**
     * İletilen metni Discord sınırlarına sığacak ve satır bütünlüğünü koruyacak şekilde böler
     */
    private splitMessage(text: string, maxLength: number): string[] {
        if (!text || text.length === 0) return [''];
        if (text.length <= maxLength) return [text];

        const chunks: string[] = [];
        let remaining = text;

        while (remaining.length > 0) {
            if (remaining.length <= maxLength) {
                chunks.push(remaining);
                break;
            }

            // Bütünlüğü korumak için en iyi kesme noktasını araştır
            // Önceki satır sonunu (`\n`) veya boşluğu tercih et
            // Daha akıcı olması için son 300 karakter içinde satır başı arıyoruz
            let splitIndex = remaining.lastIndexOf('\n', maxLength);
            if (splitIndex === -1 || splitIndex < maxLength - 300) {
                splitIndex = remaining.lastIndexOf(' ', maxLength);
            }
            if (splitIndex === -1) {
                // Hiçbir boşluk yoksa mecburen kelimenin ortasından kes
                splitIndex = maxLength;
            }

            const chunk = remaining.substring(0, splitIndex);
            if (chunk.trim()) chunks.push(chunk);
            remaining = remaining.substring(splitIndex).trim(); // Baştaki fazla boşluğu sil
        }

        return chunks;
    }
}
