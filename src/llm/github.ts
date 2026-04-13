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
        'o1',
        'o3-mini',
        'gpt-5',
        // Meta Llama
        'meta/Meta-Llama-3.3-70B-Instruct',
        'meta/Llama-3.2-11B-Vision-Instruct',
        // Mistral
        'mistral-ai/Mistral-large',
        // Microsoft
        'microsoft/Phi-4',
        // Cohere
        'cohere/Cohere-command-r-plus',
        // DeepSeek
        'deepseek/DeepSeek-R1',
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
