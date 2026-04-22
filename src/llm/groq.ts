import { OpenAIProvider } from './openai.js';
import { getConfig } from '../gateway/config.js';
import { LLMError } from '../errors/LLMError.js';

/**
 * Groq LLM Provider — OpenAI-uyumlu API kullanır.
 * OpenAIProvider'ı extend ederek kod tekrarını önler.
 */
export class GroqProvider extends OpenAIProvider {
    readonly name = 'groq';
    readonly supportedModels = [
        // === Production Models ===
        'llama-3.3-70b-versatile',        // Meta Llama 3.3 70B — 280 tps, 131K ctx
        'llama-3.1-8b-instant',           // Meta Llama 3.1 8B  — 560 tps, 131K ctx (hız)
        'openai/gpt-oss-120b',            // OpenAI GPT OSS 120B — 500 tps, 131K ctx
        'openai/gpt-oss-20b',             // OpenAI GPT OSS 20B  — 1000 tps, 131K ctx (hız)
        // === Production Systems (araç destekli) ===
        'groq/compound',                  // Groq Compound — web search + code execution
        'groq/compound-mini',             // Groq Compound Mini
        // === Preview Models ===
        'meta-llama/llama-4-scout-17b-16e-instruct', // Llama 4 Scout 17B — 750 tps, vision, 131K ctx
        'qwen/qwen3-32b',                 // Qwen3 32B — 400 tps, 131K ctx
        'moonshotai/kimi-k2-instruct-0905', // Kimi K2 — 200 tps, 262K ctx
    ];

    constructor() {
        const config = getConfig();
        if (!config.groqApiKey) {
            throw new LLMError('GROQ_API_KEY ortam değişkeni ayarlanmamış');
        }
        super('https://api.groq.com/openai/v1', config.groqApiKey);
    }
}
