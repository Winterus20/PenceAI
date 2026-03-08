import { OpenAIProvider } from './openai.js';
import { getConfig } from '../gateway/config.js';

export class GitHubProvider extends OpenAIProvider {
    readonly name = 'github';
    // GitHub Models supporting Chat Completions
    readonly supportedModels = [
        // OpenAI
        'gpt-4o',
        'gpt-4o-mini',
        'gpt-4.1',
        'gpt-4.1-mini',
        'gpt-4.1-nano',
        'gpt-4.5-preview',
        'o1',
        'o1-mini',
        'o1-preview',
        'o3',
        'o3-mini',
        'o4-mini',
        'gpt-5',
        // Meta Llama
        'meta/Meta-Llama-3-70B-Instruct',
        'meta/Meta-Llama-3-8B-Instruct',
        'meta/Meta-Llama-3.1-405B-Instruct',
        'meta/Meta-Llama-3.1-70B-Instruct',
        'meta/Meta-Llama-3.1-8B-Instruct',
        'meta/Llama-3.2-11B-Vision-Instruct',
        'meta/Llama-3.2-90B-Vision-Instruct',
        'meta/Llama-3.3-70B-Instruct',
        // Mistral
        'mistral-ai/Mistral-large',
        'mistral-ai/Mistral-large-2407',
        'mistral-ai/Mistral-Nemo',
        'mistral-ai/Mistral-small',
        // Microsoft Phi
        'microsoft/Phi-3-medium-128k-instruct',
        'microsoft/Phi-3-mini-128k-instruct',
        'microsoft/Phi-3-small-128k-instruct',
        'microsoft/Phi-3.5-mini-instruct',
        'microsoft/Phi-3.5-MoE-instruct',
        'microsoft/Phi-4',
        'microsoft/Phi-4-mini-instruct',
        // Cohere
        'cohere/Cohere-command-r',
        'cohere/Cohere-command-r-plus',
        // DeepSeek
        'deepseek/DeepSeek-R1',
        'deepseek/DeepSeek-V3',
    ];

    constructor() {
        const config = getConfig();
        if (!config.githubToken) {
            throw new Error('GITHUB_TOKEN ortam değişkeni ayarlanmamış');
        }
        // Use OpenAI SDK connected to GitHub Models Inference Endpoint
        super('https://models.github.ai/inference', config.githubToken);
    }

    /**
     * GitHub Models Inference Endpoint, /v1/models rotasını desteklemez.
     * Bu yüzden OpenAIProvider'daki models.list() çağrısı yerine
     * basit bir completion isteğiyle sağlık kontrolü yapıyoruz.
     */
    async healthCheck(): Promise<boolean> {
        try {
            await this.client.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: 'ping' }],
                max_tokens: 1,
            });
            return true;
        } catch {
            return false;
        }
    }
}
