import { OpenAIProvider } from './openai.js';
import { getConfig } from '../gateway/config.js';
import type { ChatOptions } from './provider.js';
import type { LLMMessage, LLMResponse } from '../router/types.js';
import { LLMError } from '../errors/LLMError.js';

/**
 * NVIDIA NIM API LLM Provider — OpenAI-uyumlu API kullanır.
 * OpenAIProvider'ı extend ederek kod tekrarını önler.
 *
 * NOT: NVIDIA NIM API'nin çoğu modeli tool_choice:"auto" desteklemiyor.
 * Tools göndermek için .env'de ENABLE_NVIDIA_TOOLS=true ayarlayın.
 * Aksi halde runtime fallback JSON parser ile araç çağrıları yakalanır.
 */
export class NvidiaProvider extends OpenAIProvider {
    readonly name = 'nvidia';
    readonly supportedModels = [
        // === Meta Llama ===
        'meta/llama-4-maverick-17b-128e-instruct',
        'meta/llama-4-scout-17b-16e-instruct',
        'meta/llama-3.3-70b-instruct',
        'meta/llama-3.1-405b-instruct',
        'meta/llama-3.1-70b-instruct',
        'meta/llama-3.1-8b-instruct',
        // === DeepSeek ===
        'deepseek-ai/deepseek-v3.2',
        'deepseek-ai/deepseek-r1',
        'deepseek-ai/deepseek-r1-distill-llama-8b',
        // === Qwen ===
        'qwen/qwen3.5-397b-a17b',
        'qwen/qwen3.5-122b-a10b',
        'qwen/qwen3-235b-a22b',
        'qwen/qwen2.5-coder-32b-instruct',
        'qwen/qwq-32b',
        // === NVIDIA Nemotron ===
        'nvidia/llama-3.1-nemotron-ultra-253b-v1',
        'nvidia/nemotron-3-super-120b-a12b',
        // === Mistral ===
        'mistralai/mistral-large-3-675b-instruct-2512',
        'mistralai/mistral-small-4-119b-2603',
        'mistralai/mixtral-8x22b-instruct',
        // === Google Gemma ===
        'google/gemma-4-31b-it',
        'google/gemma-3-27b-it',
        // === Microsoft Phi ===
        'microsoft/phi-4-multimodal-instruct',
        'microsoft/phi-3.5-mini',
        // === MiniMax ===
        'minimaxai/minimax-m2.7',
        'minimaxai/minimax-m2.5',
        // === Z.ai ===
        'z-ai/glm5',
        // === OpenAI OSS ===
        'openai/gpt-oss-120b',
        // === MoonshotAI Kimi ===
        'moonshotai/kimi-k2-instruct',
        // === IBM Granite ===
        'ibm/granite-3.3-8b-instruct',
    ];

    constructor() {
        const config = getConfig();
        if (!config.nvidiaApiKey) {
            throw new LLMError('NVIDIA_API_KEY ortam değişkeni ayarlanmamış');
        }
        super('https://integrate.api.nvidia.com/v1', config.nvidiaApiKey);
    }

    /**
     * NVIDIA NIM — tools varsayılan olarak GÖNDERİLİR.
     * Strict mode gerektiren modeller (gemma, llama, mistral) için
     * OpenAI base class otomatik olarak tools'u kaldırır ve mesajları normalize eder.
     * Model native tool calling destekliyorsa (minimax, deepseek, qwen vb.)
     * createChatCompletionWithToolFallback hata durumunda otomatik geri çekilir.
     */
    // chat ve chatStream override'a gerek yok — base class model adına göre karar veriyor
}
