import type { LLMMessage, LLMToolDefinition, LLMResponse } from '../router/types.js';
import { getConfig } from '../gateway/config.js';
import { logger } from '../utils/logger.js';
import { traceLLMCall, traceLLMStream } from './observability.js';

/**
 * Streaming sırasında tool call tespit edildiğinde onToken ile gönderilen özel sinyal.
 * Runtime bu sinyali yakalayarak önceden stream edilmiş metni temizler.
 */
export const TOOL_CALL_CLEAR_SIGNAL = '\x00__CLEAR_STREAM__\x00';

/**
 * LLM Provider soyut sınıfı.
 * Tüm LLM entegrasyonları bu sınıfı genişletir.
 */
export abstract class LLMProvider {
    abstract readonly name: string;
    abstract readonly supportedModels: string[];

    /**
     * Provider'ın varsayılan modeli (supportedModels[0] veya override).
     * Alt sınıflar bunu override edebilir.
     */
    get defaultModel(): string {
        return this.supportedModels[0] || 'unknown';
    }

    /**
     * Kullanılacak modeli çözümler.
     * Öncelik: options.model > config.defaultLLMModel > provider.defaultModel
     * Geçersiz model adı varsa uyarır ve provider varsayılanına döner.
     */
    protected resolveModel(requestedModel?: string): string {
        // 1) Açıkça istenen model varsa doğrudan kullan
        if (requestedModel) {
            if (this.supportedModels.length > 0 && !this.supportedModels.includes(requestedModel)) {
                logger.warn(`[${this.name}] ⚠️  İstenen model "${requestedModel}" desteklenen modeller listesinde yok. Yine de denenecek.`);
            }
            return requestedModel;
        }

        // 2) Config'deki defaultLLMModel'i kontrol et
        const configModel = getConfig().defaultLLMModel;
        if (configModel) {
            if (this.supportedModels.length > 0 && !this.supportedModels.includes(configModel)) {
                logger.warn(`[${this.name}] ⚠️  DEFAULT_LLM_MODEL="${configModel}" bu provider tarafından desteklenmiyor.`);
                logger.warn(`[${this.name}] ℹ️  Varsayılan model kullanılıyor: ${this.defaultModel}`);
                return this.defaultModel;
            }
            return configModel;
        }

        // 3) Provider varsayılanı
        return this.defaultModel;
    }

    /**
     * Sohbet tamamlama isteği gönderir.
     */
    abstract chat(
        messages: LLMMessage[],
        options?: ChatOptions
    ): Promise<LLMResponse>;

    /**
     * Streaming sohbet tamamlama — her metin token'ı için onToken callback çağrılır.
     * Araç çağrısı durumunda onToken çağrılmaz; tam LLMResponse döndürülür.
     * Desteklemeyen provider'lar bu metodu override etmek zorunda değil.
     */
    chatStream?(
        messages: LLMMessage[],
        options: ChatOptions,
        onToken: (token: string) => void
    ): Promise<LLMResponse>;

    /**
     * Provider'ın erişilebilir olup olmadığını kontrol eder.
     */
    abstract healthCheck(): Promise<boolean>;

    /**
     * LLM çağrısını otomatik trace eder.
     * Langfuse enabled ise span oluşturur, değilse direkt çalıştırır.
     * 
     * Kullanım:
     * ```typescript
     * return this.withTrace('chat', model, async () => {
     *   // ... actual LLM call ...
     *   return response;
     * });
     * ```
     */
    protected async withTrace<T>(
      operation: string,
      model: string,
      fn: () => Promise<T>
    ): Promise<T> {
      return traceLLMCall(this.name, `${this.name}.${operation} (${model})`, fn);
    }

    /**
     * Streaming LLM çağrısını otomatik trace eder.
     */
    protected async withTraceStream<T>(
      operation: string,
      model: string,
      fn: () => Promise<T>
    ): Promise<T> {
      return traceLLMStream(this.name, `${this.name}.${operation} (${model})`, fn);
    }
}

export interface ChatOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: LLMToolDefinition[];
    systemPrompt?: string;
    /** MiniMax M2.5: reasoning_split=true ile düşünme içeriğini ayrı alanda döndür */
    thinking?: boolean;
}

/**
 * Provider adından LLMProvider instance'ı oluşturur.
 */
export class LLMProviderFactory {
    private static providers: Map<string, () => Promise<LLMProvider>> = new Map();

    static register(name: string, factory: () => Promise<LLMProvider>): void {
        this.providers.set(name, factory);
    }

    static async create(name: string): Promise<LLMProvider> {
        const factory = this.providers.get(name);
        if (!factory) {
            throw new Error(`Bilinmeyen LLM provider: ${name}. Mevcut: ${Array.from(this.providers.keys()).join(', ')}`);
        }
        return factory();
    }

    static getAvailable(): string[] {
        return Array.from(this.providers.keys());
    }
}
