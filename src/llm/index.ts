export { LLMProvider, LLMProviderFactory, type ChatOptions } from './provider.js';
export { OpenAIProvider } from './openai.js';
export { AnthropicProvider } from './anthropic.js';
export { OllamaProvider } from './ollama.js';
export { MiniMaxProvider } from './minimax.js';
export { GitHubProvider } from './github.js';
export { GroqProvider } from './groq.js';
export { MistralProvider } from './mistral.js';
export { NvidiaProvider } from './nvidia.js';

import { LLMProviderFactory } from './provider.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { OllamaProvider } from './ollama.js';
import { MiniMaxProvider } from './minimax.js';
import { GitHubProvider } from './github.js';
import { GroqProvider } from './groq.js';
import { MistralProvider } from './mistral.js';
import { NvidiaProvider } from './nvidia.js';

/**
 * Tüm LLM provider'ları fabrikaya kaydeder.
 */
export function registerAllProviders(): void {
    LLMProviderFactory.register('openai', async () => new OpenAIProvider());
    LLMProviderFactory.register('anthropic', async () => new AnthropicProvider());
    LLMProviderFactory.register('ollama', async () => new OllamaProvider());
    LLMProviderFactory.register('minimax', async () => new MiniMaxProvider());
    LLMProviderFactory.register('github', async () => new GitHubProvider());
    LLMProviderFactory.register('groq', async () => new GroqProvider());
    LLMProviderFactory.register('mistral', async () => new MistralProvider());
    LLMProviderFactory.register('nvidia', async () => new NvidiaProvider());
}
