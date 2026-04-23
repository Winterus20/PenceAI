export { LLMProvider, LLMProviderFactory, type ChatOptions } from './provider.js';
export { OpenAIProvider } from './openai.js';
export { AnthropicProvider } from './anthropic.js';
export { OllamaProvider } from './ollama.js';
export { MiniMaxProvider } from './minimax.js';
export { GitHubProvider } from './github.js';
export { GroqProvider } from './groq.js';
export { MistralProvider } from './mistral.js';
export { NvidiaProvider } from './nvidia.js';
export { CachedLLMProvider } from './cachedProvider.js';
export { LLMCacheService, type LLMCacheConfig, type LLMCacheStats } from './llmCache.js';
export { ResilientLLMProvider, CircuitState, type CircuitBreakerConfig, type FallbackEntry } from './resilientProvider.js';

import { LLMProviderFactory, LLMProvider } from './provider.js';
import type { FallbackEntry } from './resilientProvider.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { OllamaProvider } from './ollama.js';
import { MiniMaxProvider } from './minimax.js';
import { GitHubProvider } from './github.js';
import { GroqProvider } from './groq.js';
import { MistralProvider } from './mistral.js';
import { NvidiaProvider } from './nvidia.js';

/**
 * Varsayılan fallback chain yapılandırması.
 * Primary provider başarısız olursa sıradaki provider'a geçiş yapar.
 * Sıralama: config.defaultLLMProvider → ollama (local fallback)
 */
export function buildDefaultFallbackChain(primaryProvider: LLMProvider): FallbackEntry[] {
    const entries: FallbackEntry[] = [
        { provider: primaryProvider, priority: 1, fallbackOn: ['timeout', 'rate_limit', '5xx'] },
    ];

    // Local Ollama — son çare fallback (cache yok, raw provider)
    if (primaryProvider.name !== 'ollama') {
        try {
            const ollamaProvider = LLMProviderFactory.create('ollama');
            entries.push({ provider: ollamaProvider, priority: 99, fallbackOn: ['all'] });
        } catch {
            // Ollama yoksa görmezden gel
        }
    }

    return entries;
}

export function registerAllProviders(): void {
    LLMProviderFactory.register('openai', () => new OpenAIProvider());
    LLMProviderFactory.register('anthropic', () => new AnthropicProvider());
    LLMProviderFactory.register('ollama', () => new OllamaProvider());
    LLMProviderFactory.register('minimax', () => new MiniMaxProvider());
    LLMProviderFactory.register('github', () => new GitHubProvider());
    LLMProviderFactory.register('groq', () => new GroqProvider());
    LLMProviderFactory.register('mistral', () => new MistralProvider());
    LLMProviderFactory.register('nvidia', () => new NvidiaProvider());
}
