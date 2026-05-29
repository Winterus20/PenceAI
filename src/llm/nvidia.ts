import { OpenAIProvider } from './openai.js';
import { getConfig } from '../gateway/config.js';
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
        'deepseek-ai/deepseek-v4-pro',
        'deepseek-ai/deepseek-v4-flash',
        'deepseek-ai/deepseek-v3.2',
        'deepseek-ai/deepseek-v3.1-terminus',
        'deepseek-ai/deepseek-r1',
        // === Qwen ===
        'qwen/qwen3.5-397b-a17b',
        'qwen/qwen3.5-122b-a10b',
        'qwen/qwen3-coder-480b-a35b-instruct',
        'qwen/qwen3-next-80b-a3b-instruct',
        'qwen/qwen3-next-80b-a3b-thinking',
        'qwen/qwen2.5-coder-32b-instruct',
        // === NVIDIA Nemotron ===
        'nvidia/llama-3.1-nemotron-ultra-253b-v1',
        'nvidia/llama-3.3-nemotron-super-49b-v1',
        'nvidia/llama-3.3-nemotron-super-49b-v1.5',
        'nvidia/nemotron-3-super-120b-a12b',
        'nvidia/nemotron-3-nano-30b-a3b',
        'nvidia/nvidia-nemotron-nano-9b-v2',
        // === Mistral ===
        'mistralai/mistral-large-3-675b-instruct-2512',
        'mistralai/mistral-large-2-instruct',
        'mistralai/mistral-medium-3-instruct',
        'mistralai/mistral-small-4-119b-2603',
        'mistralai/mixtral-8x22b-instruct',
        'mistralai/codestral-22b-instruct-v0.1',
        'mistralai/devstral-2-123b-instruct-2512',
        // === Google Gemma ===
        'google/gemma-4-31b-it',
        'google/gemma-3-27b-it',
        // === Microsoft Phi ===
        'microsoft/phi-4-multimodal-instruct',
        'microsoft/phi-4-mini-instruct',
        'microsoft/phi-3.5-moe-instruct',
        // === MiniMax ===
        'minimaxai/minimax-m2.7',
        'minimaxai/minimax-m2.5',
        // === Z.ai ===
        'z-ai/glm-5.1',
        'z-ai/glm4.7',
        // === OpenAI OSS ===
        'openai/gpt-oss-120b',
        // === MoonshotAI Kimi ===
        'moonshotai/kimi-k2.5',
        'moonshotai/kimi-k2-instruct',
        'moonshotai/kimi-k2-thinking',
        // === IBM Granite ===
        'ibm/granite-3.3-8b-instruct',
        'ibm/granite-3.0-8b-instruct',
    ];

    /**
     * NVIDIA NIM'de Llama, Mistral, Qwen, DeepSeek gibi modeller native tool calling destekler.
     * Sadece Gemma ve eski OSS modelleri strict mode'a girmeli.
     */
    protected getStrictModels(): ReadonlySet<string> {
        return new Set([
            'gemma',                    // Google Gemma — tool calling desteklemez
            'mixtral-8x22b',            // Eski Mixtral — native tool yok
            'codestral-22b-instruct-v0.1', // Eski Codestral — native tool yok
            'gpt-oss',                  // OpenAI OSS — tool calling yok
        ]);
    }

    constructor() {
        const config = getConfig();
        if (!config.nvidiaApiKey) {
            throw new LLMError('NVIDIA_API_KEY ortam değişkeni ayarlanmamış');
        }
        super('https://integrate.api.nvidia.com/v1', config.nvidiaApiKey);
    }
}
