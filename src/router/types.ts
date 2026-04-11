// ============================================
// PençeAI — Unified Message Types
// ============================================

export type ChannelType = 'web' | 'telegram' | 'discord' | 'whatsapp';

export interface UnifiedMessage {
    id: string;
    channelType: ChannelType;
    channelId: string;        // Kanal veya sohbet ID'si
    senderId: string;          // Gönderen kullanıcı ID'si
    senderName: string;        // Gönderen kullanıcı adı
    content: string;           // Metin içeriği
    attachments: Attachment[];  // Ek dosyalar
    timestamp: Date;
    replyToId?: string;        // Yanıt verilen mesaj ID'si
    metadata?: Record<string, unknown>;
}

export interface Attachment {
    type: 'image' | 'audio' | 'video' | 'document' | 'other';
    url?: string;
    data?: Buffer;
    mimeType: string;
    fileName?: string;
    size?: number;
}

export interface MessageResponse {
    content: string;
    attachments?: Attachment[];
    metadata?: Record<string, unknown>;
}

export interface Channel {
    type: ChannelType;
    name: string;
    isConnected: boolean;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    sendMessage(channelId: string, response: MessageResponse): Promise<void>;
    onMessage(handler: (message: UnifiedMessage) => Promise<void>): void;
}

export interface ConversationContext {
    conversationId: string;
    channelType: ChannelType;
    channelId: string;
    userId: string;
    userName: string;
    history: ConversationMessage[];
}

/** Görüntüleme/kalıcılık için hafif ek dosya meta verisi (binary data base64 olarak yalnızca görseller için). */
export interface AttachmentMeta {
    fileName: string;
    mimeType: string;
    size?: number;
    /** Görseller için base64 verisi (yeniden gösterim amacıyla). Diğer dosya türlerinde yok. */
    data?: string;
}

export interface ConversationMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    timestamp: Date;
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
    /** Kullanıcı mesajındaki ek dosyalar (görseller dahil). */
    attachments?: AttachmentMeta[];
}

export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

export interface ToolResult {
    toolCallId: string;
    name: string;
    result: string;
    isError: boolean;
}

// LLM Types
export interface ImageBlock {
    mimeType: string;   // e.g. 'image/jpeg'
    data: string;       // base64 encoded bytes
    fileName?: string;
}

export interface LLMMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
    /** Görsel blokları — multimodal istekler için */
    imageBlocks?: ImageBlock[];
}

export interface LLMToolDefinition {
    name: string;
    description: string;           // İnsan okuması için (dialog, UI vb.)
    llmDescription?: string;       // LLM için sıkıştırılmış description
    parameters: Record<string, unknown>; // JSON Schema (tam)
    llmParameters?: Record<string, unknown>; // LLM için minimal JSON schema
}

export interface LLMResponse {
    content: string;
    toolCalls?: ToolCall[];
    finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
    /** Modelin düşünme içeriği (reasoning_split: true kullanıldığında doldurulur) */
    thinkingContent?: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

export interface LLMStreamChunk {
    content?: string;
    toolCalls?: ToolCall[];
    finishReason?: LLMResponse['finishReason'];
}
