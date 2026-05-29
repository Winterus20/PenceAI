import OpenAI from 'openai';
import { OpenAIProvider } from './openai.js';
import { getConfig } from '../gateway/config.js';
import { LLMError } from '../errors/LLMError.js';

const NON_CHAT_MODEL_PATTERN = /embed|whisper|tts|dall-?e|moderation|rerank|davinci|babbage/i;

/**
 * Kullanıcı tanımlı OpenAI-uyumlu endpoint (OpenRouter, LiteLLM, local gateway vb.)
 * CUSTOM_OPENAI_BASE_URL + CUSTOM_OPENAI_API_KEY ile yapılandırılır.
 */
export function normalizeOpenAICompatibleBaseUrl(url: string): string {
    const trimmed = url.trim().replace(/\/+$/, '');
    if (!trimmed) {
        throw new LLMError('CUSTOM_OPENAI_BASE_URL boş olamaz');
    }
    if (/\/v1$/i.test(trimmed) || /\/openai\/v1$/i.test(trimmed)) {
        return trimmed;
    }
    return `${trimmed}/v1`;
}

/** OpenAI models.list yanıtından sohbet model ID'lerini çıkarır */
export function parseOpenAIModelIds(models: Array<{ id?: string | null; object?: string | null }>): string[] {
    const ids = models
        .filter((m) => m.id && (m.object === 'model' || m.object == null))
        .map((m) => m.id as string)
        .filter((id) => !NON_CHAT_MODEL_PATTERN.test(id));
    return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

/** Verilen endpoint + anahtar ile GET /v1/models */
export async function fetchCustomOpenAIModels(baseUrl: string, apiKey: string): Promise<string[]> {
    const client = new OpenAI({
        apiKey,
        baseURL: normalizeOpenAICompatibleBaseUrl(baseUrl),
        timeout: 20_000,
        maxRetries: 0,
    });
    const response = await client.models.list();
    const models = parseOpenAIModelIds(response.data);
    if (models.length === 0) {
        throw new LLMError('Endpoint model listesi döndürdü ancak kullanılabilir sohbet modeli bulunamadı');
    }
    return models;
}

export class CustomOpenAIProvider extends OpenAIProvider {
    readonly name = 'custom';
    /** Model adı tamamen DEFAULT_LLM_MODEL / istek üzerinden gelir */
    readonly supportedModels: string[] = [];

    protected getStrictModels(): ReadonlySet<string> {
        return new Set();
    }

    constructor() {
        const config = getConfig();
        if (!config.customOpenaiApiKey) {
            throw new LLMError('CUSTOM_OPENAI_API_KEY ortam değişkeni ayarlanmamış');
        }
        if (!config.customOpenaiBaseUrl?.trim()) {
            throw new LLMError('CUSTOM_OPENAI_BASE_URL ortam değişkeni ayarlanmamış');
        }
        super(
            normalizeOpenAICompatibleBaseUrl(config.customOpenaiBaseUrl),
            config.customOpenaiApiKey,
        );
    }

    async listAvailableModels(): Promise<string[]> {
        const config = getConfig();
        return fetchCustomOpenAIModels(config.customOpenaiBaseUrl!, config.customOpenaiApiKey!);
    }

    async healthCheck(): Promise<boolean> {
        const config = getConfig();
        const model = config.defaultLLMModel?.trim();
        if (!model) {
            try {
                await this.client.models.list();
                return true;
            } catch {
                return false;
            }
        }
        try {
            await this.client.chat.completions.create({
                model,
                messages: [{ role: 'user', content: 'ping' }],
                max_tokens: 1,
            });
            return true;
        } catch {
            return false;
        }
    }
}
