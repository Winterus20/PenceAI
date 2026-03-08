import { OpenAIProvider } from './openai.js';
import { getConfig } from '../gateway/config.js';

/**
 * Mistral AI LLM Provider — OpenAI-uyumlu API kullanır.
 * OpenAIProvider'ı extend ederek kod tekrarını önler.
 */
export class MistralProvider extends OpenAIProvider {
    readonly name = 'mistral';
    readonly supportedModels = [
        // === Frontier — Genel Amaçlı ===
        'mistral-large-latest',       // Mistral Large 3 (v25.12) — en güçlü, multimodal
        'mistral-medium-latest',      // Mistral Medium 3.1 (v25.08) — frontier multimodal
        'mistral-small-latest',       // Mistral Small 3.2 (v25.06) — hafif, hızlı
        'ministral-8b-latest',        // Ministral 3 8B (v25.12) — verimli, multimodal
        'ministral-3b-latest',        // Ministral 3 3B (v25.12) — en küçük, en hızlı
        // === Frontier — Akıl Yürütme (Reasoning) ===
        'magistral-medium-latest',    // Magistral Medium 1.2 — frontier reasoning
        'magistral-small-latest',     // Magistral Small 1.2 — küçük reasoning
        // === Specialist — Kod ===
        'codestral-latest',           // Codestral (v25.08) — kod tamamlama
        'devstral-latest',            // Devstral 2 (v25.12) — code agent (SWE)
        // === Diğer ===
        'open-mistral-nemo',          // Mistral Nemo 12B (v24.07) — çok dilli open source
    ];

    constructor() {
        const config = getConfig();
        if (!config.mistralApiKey) {
            throw new Error('MISTRAL_API_KEY ortam değişkeni ayarlanmamış');
        }
        super('https://api.mistral.ai/v1', config.mistralApiKey);
    }
}
