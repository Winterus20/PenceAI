import { OpenAIProvider } from './openai.js';
import { getConfig } from '../gateway/config.js';
import { LLMError } from '../errors/LLMError.js';
import { fetchCustomOpenAIModels } from './customOpenAI.js';

/** OpenRouter OpenAI-uyumlu API kökü */
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * OpenRouter LLM Provider — tek API anahtarı ile çoklu model erişimi.
 * @see https://openrouter.ai/docs
 */
export class OpenRouterProvider extends OpenAIProvider {
    readonly name = 'openrouter';
    /** Modeller GET /v1/models ile dinamik yüklenir */
    readonly supportedModels: string[] = [];

    protected getStrictModels(): ReadonlySet<string> {
        return new Set();
    }

    constructor() {
        const config = getConfig();
        if (!config.openrouterApiKey) {
            throw new LLMError('OPENROUTER_API_KEY ortam değişkeni ayarlanmamış');
        }

        const defaultHeaders: Record<string, string> = {};
        const referer = config.openrouterHttpReferer?.trim();
        const title = config.openrouterAppTitle?.trim();
        if (referer) defaultHeaders['HTTP-Referer'] = referer;
        if (title) defaultHeaders['X-Title'] = title;

        super(OPENROUTER_BASE_URL, config.openrouterApiKey, {
            defaultHeaders: Object.keys(defaultHeaders).length > 0 ? defaultHeaders : undefined,
        });
    }

    async listAvailableModels(): Promise<string[]> {
        const config = getConfig();
        return fetchCustomOpenAIModels(OPENROUTER_BASE_URL, config.openrouterApiKey!);
    }

    private async verifyApiKey(): Promise<boolean> {
        try {
            await this.client.models.list();
            return true;
        } catch {
            return false;
        }
    }

    private static httpStatus(err: unknown): number | undefined {
        if (err && typeof err === 'object' && 'status' in err) {
            const status = (err as { status: unknown }).status;
            if (typeof status === 'number') return status;
        }
        return undefined;
    }

    /** Geçici upstream limitleri — anahtar geçerli sayılır (models.list ile doğrulanır). */
    private static isTransientUpstreamError(err: unknown): boolean {
        const status = OpenRouterProvider.httpStatus(err);
        return status === 429 || status === 502 || status === 503;
    }

    async healthCheck(): Promise<boolean> {
        const config = getConfig();
        const model = config.defaultLLMModel?.trim();
        if (!model) {
            return this.verifyApiKey();
        }
        try {
            await this.client.chat.completions.create({
                model,
                messages: [{ role: 'user', content: 'ping' }],
                max_tokens: 1,
            });
            return true;
        } catch (err: unknown) {
            if (OpenRouterProvider.isTransientUpstreamError(err)) {
                return this.verifyApiKey();
            }
            return false;
        }
    }
}
