/**
 * CachedLLMProvider — Decorator that adds prompt caching to any LLMProvider.
 *
 * Wraps an existing provider so that `chat()` calls are transparently
 * cached via LLMCacheService.  Streaming calls (`chatStream`) bypass
 * the cache entirely — streamed content is by definition real-time and
 * shouldn't be cached.
 *
 * Usage:
 *   const rawProvider = LLMProviderFactory.create('openai');
 *   const cache       = new LLMCacheService(db, { enabled: true, ttlHours: 24 });
 *   const llm         = new CachedLLMProvider(rawProvider, cache, 'openai');
 */

import { LLMProvider, type ChatOptions } from './provider.js';
import type { LLMMessage, LLMResponse } from '../router/types.js';
import type { LLMCacheService } from './llmCache.js';
import { logger } from '../utils/logger.js';

export class CachedLLMProvider extends LLMProvider {
    readonly name: string;
    readonly supportedModels: string[];

    constructor(
        private inner: LLMProvider,
        private cache: LLMCacheService,
        private providerName: string,
    ) {
        super();
        this.name = inner.name;
        this.supportedModels = inner.supportedModels;
    }

    get supportsNativeToolCalling(): boolean {
        return this.inner.supportsNativeToolCalling;
    }

    get defaultModel(): string {
        return this.inner.defaultModel;
    }

    /**
     * Synchronous chat — cache-aware.
     *
     * 1. Compute cache key from (messages + model + systemPrompt).
     * 2. On hit: return cached LLMResponse immediately (≈10-20 ms, $0 cost).
     * 3. On miss: delegate to inner provider, store the response, return it.
     */
    async chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse> {
        // If caching is disabled, pass through directly
        if (!this.cache.isEnabled()) {
            return this.inner.chat(messages, options);
        }

        const model = this.resolveModel(options?.model);
        const systemPrompt = options?.systemPrompt;

        // Serialize messages to a stable JSON string for the cache key
        const messagesJson = this.serializeMessages(messages);

        // --- Cache lookup ---
        const cached = this.cache.get(messagesJson, model, systemPrompt);
        if (cached) {
            logger.debug(
                `[CachedLLMProvider] ✅ Cache HIT — ${this.providerName}/${model} ` +
                `(saved $${this.estimateSavings(cached).toFixed(4)})`,
            );
            return cached;
        }

        // --- Cache miss — call the real provider ---
        const response = await this.inner.chat(messages, options);

        // Only cache responses that completed normally (not tool_calls or length)
        // Tool-call responses are part of multi-turn loops and shouldn't be cached
        // because the next turn depends on tool execution results.
        if (response.finishReason === 'stop') {
            this.cache.set(messagesJson, model, response, this.providerName, systemPrompt);
            logger.debug(
                `[CachedLLMProvider] 📦 Cached response — ${this.providerName}/${model}`,
            );
        }

        return response;
    }

    /**
     * Streaming chat — ALWAYS bypasses cache.
     * Streaming content is real-time and shouldn't be cached.
     */
    async chatStream(
        messages: LLMMessage[],
        options: ChatOptions,
        onToken: (token: string) => void,
    ): Promise<LLMResponse> {
        if (this.inner.chatStream) {
            return this.inner.chatStream(messages, options, onToken);
        }
        // Fallback: if inner provider doesn't support streaming, use regular chat
        return this.chat(messages, options);
    }

    async healthCheck(): Promise<boolean> {
        return this.inner.healthCheck();
    }

    // ─── Internals ───────────────────────────────────────────

    /**
     * Serialize messages to a deterministic JSON string.
     * Strips volatile fields (timestamps) and sorts keys for stability.
     */
    private serializeMessages(messages: LLMMessage[]): string {
        // Only include role + content + toolCalls for caching key stability.
        // toolResults and imageBlocks can be very large and are typically
        // unique per call, so we include a hash of their content rather than
        // the full data.
        return JSON.stringify(
            messages.map(m => {
                const entry: Record<string, unknown> = {
                    role: m.role,
                    content: m.content,
                };
                if (m.toolCalls) {
                    entry.toolCalls = m.toolCalls.map(tc => ({
                        name: tc.name,
                        // Sort argument keys for determinism
                        arguments: sortObjectKeys(tc.arguments),
                    }));
                }
                // For tool results, include a stable summary
                if (m.toolResults) {
                    entry.toolResultNames = m.toolResults.map(r => r.name);
                    entry.toolResultHash = simpleHash(
                        m.toolResults.map(r => r.result).join('|'),
                    );
                }
                // For image blocks, include a content hash to differentiate different images
                if (m.imageBlocks && m.imageBlocks.length > 0) {
                    entry.imageBlockCount = m.imageBlocks.length;
                    // Hash each image's mimeType + data length for stable differentiation
                    // without including the full base64 data in the key
                    entry.imageBlockHash = m.imageBlocks.map(img =>
                        `${img.mimeType}:${img.data.length}`,
                    ).join('|');
                }
                return entry;
            }),
        );
    }

    /**
     * Rough cost estimate for a cached response (so we can log savings).
     */
    private estimateSavings(response: LLMResponse): number {
        // Very rough: $0.003/1K prompt + $0.015/1K completion (GPT-4o avg)
        const promptCost = (response.usage?.promptTokens ?? 0) / 1000 * 0.003;
        const completionCost = (response.usage?.completionTokens ?? 0) / 1000 * 0.015;
        return promptCost + completionCost;
    }
}

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Sort object keys recursively for deterministic serialization.
 */
function sortObjectKeys(obj: Record<string, unknown>): Record<string, unknown> {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
        const val = obj[key];
        sorted[key] = val !== null && typeof val === 'object' && !Array.isArray(val)
            ? sortObjectKeys(val as Record<string, unknown>)
            : val;
    }
    return sorted;
}

/**
 * Simple non-cryptographic hash for short strings (fast, no crypto import needed).
 */
function simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
}
