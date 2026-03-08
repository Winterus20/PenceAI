import { OpenAIProvider } from './openai.js';
import { getConfig } from '../gateway/config.js';
import type { ChatOptions } from './provider.js';
import type { LLMMessage, LLMResponse } from '../router/types.js';

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
        // === Meta Llama 4 ===
        'meta/llama-4-maverick-17b-128e-instruct',   // Llama 4 Maverick — multimodal 128 MoE
        'meta/llama-4-scout-17b-16e-instruct',        // Llama 4 Scout — multimodal 16 MoE
        // === Meta Llama 3.x ===
        'meta/llama-3.3-70b-instruct',               // Llama 3.3 70B
        'meta/llama-3.2-90b-vision-instruct',        // Llama 3.2 90B Vision
        'meta/llama-3.2-11b-vision-instruct',        // Llama 3.2 11B Vision
        'meta/llama-3.2-3b-instruct',                // Llama 3.2 3B
        'meta/llama-3.2-1b-instruct',                // Llama 3.2 1B
        'meta/llama-3.1-405b-instruct',              // Llama 3.1 405B
        'meta/llama-3.1-70b-instruct',               // Llama 3.1 70B
        'meta/llama-3.1-8b-instruct',                // Llama 3.1 8B
        'meta/llama3-70b-instruct',                  // Llama 3 70B
        'meta/llama3-8b-instruct',                   // Llama 3 8B
        'meta/llama2-70b',                           // Llama 2 70B
        'meta/codellama-70b',                        // Code Llama 70B
        // === NVIDIA Nemotron / NeMo ===
        'nvidia/llama-3.1-nemotron-ultra-253b-v1',   // Nemotron Ultra 253B
        'nvidia/llama-3.3-nemotron-super-49b-v1.5',  // Nemotron Super 49B v1.5
        'nvidia/llama-3.3-nemotron-super-49b-v1',    // Nemotron Super 49B v1
        'nvidia/llama-3.1-nemotron-nano-8b-v1',      // Nemotron Nano 8B
        'nvidia/llama-3.1-nemotron-nano-4b-v1_1',    // Nemotron Nano 4B
        'nvidia/llama-3.1-nemotron-nano-vl-8b-v1',   // Nemotron Nano VL 8B
        'nvidia/llama-3.1-nemoguard-8b-content-safety', // NeMoGuard content safety
        'nvidia/llama-3.1-nemoguard-8b-topic-control',  // NeMoGuard topic control
        'nvidia/llama-3.1-nemotron-safety-guard-8b-v3',           // Nemotron Safety Guard 8B v3
        'nvidia/llama-3.1-nemotron-safety-guard-multilingual-8b-v1', // Nemotron Safety Guard multilingual
        'nvidia/nvidia-nemotron-nano-9b-v2',         // Nemotron Nano 9B v2 — hybrid Mamba
        'nvidia/nemotron-nano-12b-v2-vl',            // Nemotron Nano 12B v2 VL
        'nvidia/nemotron-3-nano-30b-a3b',            // Nemotron 3 Nano 30B MoE
        'nvidia/nemotron-4-mini-hindi-4b-instruct',  // Nemotron Mini 4B Hindi
        'nvidia/nemotron-mini-4b-instruct',          // Nemotron Mini 4B
        'nvidia/nemotron-content-safety-reasoning-4b', // Nemotron content safety reasoning
        'nvidia/nemoguard-jailbreak-detect',         // NeMoGuard jailbreak detection
        'nvidia/mistral-nemo-minitron-8b-base',      // Mistral NeMo Minitron 8B base
        'nvidia/llama3-chatqa-1.5-8b',               // ChatQA 1.5 8B — RAG
        'nvidia/usdcode',                            // USDCode — OpenUSD
        'nvidia/riva-translate-4b-instruct-v1_1',   // Riva Translate 4B
        // === DeepSeek ===
        'deepseek-ai/deepseek-v3.2',                 // DeepSeek V3.2 — 685B
        'deepseek-ai/deepseek-v3.1',                 // DeepSeek V3.1
        'deepseek-ai/deepseek-v3.1-terminus',        // DeepSeek V3.1 Terminus — strict tool calling
        'deepseek-ai/deepseek-r1',                   // DeepSeek R1 — reasoning
        'deepseek-ai/deepseek-r1-distill-qwen-32b',  // DeepSeek R1 distill Qwen 32B
        'deepseek-ai/deepseek-r1-distill-qwen-14b',  // DeepSeek R1 distill Qwen 14B
        'deepseek-ai/deepseek-r1-distill-qwen-7b',   // DeepSeek R1 distill Qwen 7B
        'deepseek-ai/deepseek-r1-distill-llama-8b',  // DeepSeek R1 distill Llama 8B
        // === Qwen ===
        'qwen/qwen3.5-397b-a17b',                    // Qwen3.5 397B MoE VLM
        'qwen/qwen3-235b-a22b',                      // Qwen3 235B MoE
        'qwen/qwen3-coder-480b-a35b-instruct',       // Qwen3 Coder 480B
        'qwen/qwen3-next-80b-a3b-instruct',          // Qwen3 Next 80B instruct
        'qwen/qwen3-next-80b-a3b-thinking',          // Qwen3 Next 80B thinking
        'qwen/qwq-32b',                              // QwQ 32B — reasoning
        'qwen/qwen2.5-coder-32b-instruct',           // Qwen2.5 Coder 32B
        'qwen/qwen2.5-coder-7b-instruct',            // Qwen2.5 Coder 7B
        'qwen/qwen2.5-7b-instruct',                  // Qwen2.5 7B
        'qwen/qwen2-7b-instruct',                    // Qwen2 7B
        // === Mistral / MistralAI ===
        'mistralai/mistral-large-3-675b-instruct-2512',   // Mistral Large 3 675B MoE VLM
        'mistralai/devstral-2-123b-instruct-2512',        // Devstral 2 123B code agent
        'mistralai/mistral-medium-3-instruct',            // Mistral Medium 3 — multimodal
        'mistralai/mistral-small-3_1-24b-instruct-2503',  // Mistral Small 3.1 24B
        'mistralai/mistral-small-24b-instruct',           // Mistral Small 24B
        'mistralai/mistral-nemotron',                     // Mistral Nemotron — agentic
        'mistralai/magistral-small-2506',                 // Magistral Small — reasoning
        'mistralai/mistral-large-2-instruct',             // Mistral Large 2
        'mistralai/mistral-large',                        // Mistral Large
        'mistralai/mistral-7b-instruct-v0.3',             // Mistral 7B v0.3
        'mistralai/mistral-7b-instruct',                  // Mistral 7B
        'mistralai/mixtral-8x22b-instruct',               // Mixtral 8x22B
        'mistralai/mixtral-8x7b-instruct',                // Mixtral 8x7B
        'mistralai/codestral-22b-instruct-v0.1',          // Codestral 22B
        'mistralai/mamba-codestral-7b-v0.1',              // Mamba Codestral 7B
        'mistralai/mathstral-7b-v0.1',                    // Mathstral 7B
        'mistralai/ministral-14b-instruct-2512',          // Ministral 14B
        // === Google Gemma ===
        'google/gemma-3-27b-it',                     // Gemma 3 27B — multimodal
        'google/gemma-3-1b-it',                      // Gemma 3 1B — edge
        'google/gemma-3n-e4b-it',                    // Gemma 3n E4B — audio/image/text
        'google/gemma-3n-e2b-it',                    // Gemma 3n E2B — edge
        'google/gemma-2-27b-it',                     // Gemma 2 27B
        'google/gemma-2-9b-it',                      // Gemma 2 9B
        'google/gemma-2-2b-it',                      // Gemma 2 2B
        'google/gemma-7b',                           // Gemma 7B
        'google/gemma-2b',                           // Gemma 2B
        'google/codegemma-1.1-7b',                   // CodeGemma 1.1 7B
        'google/codegemma-7b',                       // CodeGemma 7B
        'google/shieldgemma-9b',                     // ShieldGemma 9B — safety
        'google/recurrentgemma-2b',                  // RecurrentGemma 2B
        // === Microsoft Phi ===
        'microsoft/phi-4-multimodal-instruct',       // Phi-4 Multimodal — speech/vision
        'microsoft/phi-4-mini-instruct',             // Phi-4 Mini
        'microsoft/phi-4-mini-flash-reasoning',      // Phi-4 Mini Flash — edge reasoning
        'microsoft/phi-3.5-vision-instruct',         // Phi-3.5 Vision
        'microsoft/phi-3.5-mini',                    // Phi-3.5 Mini
        'microsoft/phi-3-medium-128k-instruct',      // Phi-3 Medium 128K
        'microsoft/phi-3-medium-4k-instruct',        // Phi-3 Medium 4K
        'microsoft/phi-3-small-128k-instruct',       // Phi-3 Small 128K
        'microsoft/phi-3-small-8k-instruct',         // Phi-3 Small 8K
        'microsoft/phi-3-mini-128k-instruct',        // Phi-3 Mini 128K
        'microsoft/phi-3-mini-4k-instruct',          // Phi-3 Mini 4K
        // === MoonshotAI Kimi ===
        'moonshotai/kimi-k2.5',                      // Kimi K2.5 — multimodal MoE
        'moonshotai/kimi-k2-instruct-0905',          // Kimi K2 Instruct 0905
        'moonshotai/kimi-k2-instruct',               // Kimi K2 Instruct
        'moonshotai/kimi-k2-thinking',               // Kimi K2 Thinking — open reasoning
        // === MiniMaxAI ===
        'minimaxai/minimax-m2.5',                    // MiniMax M2.5 — 230B
        'minimaxai/minimax-m2.1',                    // MiniMax M2.1 — multimodal agentic
        'minimaxai/minimax-m2',                      // MiniMax M2
        // === OpenAI OSS ===
        'openai/gpt-oss-120b',                       // GPT OSS 120B — MoE reasoning
        'openai/gpt-oss-20b',                        // GPT OSS 20B — MoE efficient
        // === IBM Granite ===
        'ibm/granite-3.3-8b-instruct',              // Granite 3.3 8B
        'ibm/granite-guardian-3.0-8b',              // Granite Guardian 3.0 8B — safety
        'ibm/granite-34b-code-instruct',             // Granite 34B Code
        'ibm/granite-8b-code-instruct',              // Granite 8B Code
        // === Z-AI GLM ===
        'z-ai/glm5',                                 // GLM-5 744B MoE
        'z-ai/glm4.7',                               // GLM-4.7 — agentic coding
        // === ByteDance ===
        'bytedance/seed-oss-36b-instruct',           // Seed OSS 36B
        // === StepFun ===
        'stepfun-ai/step-3.5-flash',                 // Step 3.5 Flash — 200B MoE reasoning
        // === Speakleash ===
        'speakleash/bielik-11b-v2_6-instruct',       // Bielik 11B — Polish language
        // === Stockmark ===
        'stockmark/stockmark-2-100b-instruct',       // Stockmark 2 100B — Japanese business
        // === Sovereign / Multilingual ===
        'sarvamai/sarvam-m',                         // Sarvam-M — Indian languages
        'marin/marin-8b-instruct',                   // Marin 8B — open datasets
        'utter-project/eurollm-9b-instruct',         // EuroLLM 9B — EU languages
        'opengpt-x/teuken-7b-instruct-commercial-v0.4', // Teuken 7B — EU 24 languages
        'gotocompany/gemma-2-9b-cpt-sahabatai-instruct', // Sahabat-AI — Indonesian
        'speakleash/bielik-11b-v2_6-instruct',       // Bielik 11B v2.6 — Polish
        'institute-of-science-tokyo/llama-3.1-swallow-70b-instruct-v0.1', // Swallow 70B — Japanese
        'institute-of-science-tokyo/llama-3.1-swallow-8b-instruct-v0.1',  // Swallow 8B — Japanese
        'tokyotech-llm/llama-3-swallow-70b-instruct-v0.1', // Swallow 70B — Japanese
        'yentinglin/llama-3-taiwan-70b-instruct',    // Taiwan LLM 70B — Traditional Chinese
        'igenius/colosseum_355b_instruct_16k',       // Colosseum 355B — regulated industries
        'igenius/italia_10b_instruct_16k',           // Italia 10B — European languages
        // === Other ===
        'abacusai/dracarys-llama-3.1-70b-instruct',  // Dracarys Llama 3.1 70B
        'aisingapore/sea-lion-7b-instruct',          // SEA-LION 7B — SE Asian languages
        'ai21labs/jamba-1.5-mini-instruct',          // Jamba 1.5 Mini — MoE
        'baichuan-inc/baichuan2-13b-chat',           // Baichuan2 13B — Chinese/English
        'bigcode/starcoder2-15b',                    // StarCoder2 15B
        'bigcode/starcoder2-7b',                     // StarCoder2 7B
        'databricks/dbrx-instruct',                  // DBRX Instruct
        'mediatek/breeze-7b-instruct',               // Breeze 7B — Traditional Chinese
        'rakuten/rakutenai-7b-instruct',             // RakutenAI 7B Instruct
        'rakuten/rakutenai-7b-chat',                 // RakutenAI 7B Chat
        'seallms/seallm-7b-v2.5',                   // SeaLLM 7B — SE Asian
        'snowflake/arctic',                          // Snowflake Arctic
        'thudm/chatglm3-6b',                         // ChatGLM3 6B — Chinese/English
        'tiiuae/falcon3-7b-instruct',                // Falcon3 7B
        'upstage/solar-10.7b-instruct',              // Solar 10.7B
        '01-ai/yi-large',                            // Yi Large
    ];

    constructor() {
        const config = getConfig();
        if (!config.nvidiaApiKey) {
            throw new Error('NVIDIA_API_KEY ortam değişkeni ayarlanmamış');
        }
        super('https://integrate.api.nvidia.com/v1', config.nvidiaApiKey);
    }

    /**
     * NVIDIA NIM — tools yalnızca ENABLE_NVIDIA_TOOLS=true ise gönderilir.
     * Çoğu model tool_choice:"auto" desteklemediği için varsayılan: false.
     * Tools devre dışıysa runtime fallback JSON parser araç çağrılarını yakalar.
     */
    async chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse> {
        const config = getConfig();
        const safeOptions = config.enableNvidiaTools ? options : (options ? { ...options, tools: undefined } : options);
        return super.chat(messages, safeOptions);
    }

    async chatStream(messages: LLMMessage[], options: ChatOptions | undefined, onToken: (token: string) => void): Promise<LLMResponse> {
        const config = getConfig();
        const safeOptions = config.enableNvidiaTools ? options : (options ? { ...options, tools: undefined } : options);
        return super.chatStream(messages, safeOptions, onToken);
    }
}
