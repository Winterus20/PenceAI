/**
 * Unit tests for LLM Prompt Caching — LLMCacheService & CachedLLMProvider.
 */

import Database from 'better-sqlite3';
import { LLMCacheService, type LLMCacheConfig } from '../../src/llm/llmCache.js';
import { CachedLLMProvider } from '../../src/llm/cachedProvider.js';
import { LLMProvider, type ChatOptions } from '../../src/llm/provider.js';
import type { LLMMessage, LLMResponse } from '../../src/router/types.js';

// ─── Mock LLMProvider ──────────────────────────────────────────

class MockProvider extends LLMProvider {
    readonly name = 'mock';
    readonly supportedModels = ['mock-model'];
    callCount = 0;
    lastOptions: ChatOptions | undefined;

    async chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse> {
        this.callCount++;
        this.lastOptions = options;
        return {
            content: `Response #${this.callCount} for: ${messages.map(m => m.content).join('|')}`,
            finishReason: 'stop',
            usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        };
    }

    async healthCheck(): Promise<boolean> {
        return true;
    }
}

// ─── Helpers ───────────────────────────────────────────────────

function createTestDb(): Database.Database {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    return db;
}

function makeMessages(contents: string[]): LLMMessage[] {
    return contents.map(c => ({ role: 'user' as const, content: c }));
}

// ─── LLMCacheService Tests ─────────────────────────────────────

describe('LLMCacheService', () => {
    let db: Database.Database;
    let cache: LLMCacheService;

    beforeEach(() => {
        db = createTestDb();
        cache = new LLMCacheService(db, { enabled: true, ttlHours: 24, maxEntries: 100 });
    });

    afterEach(() => {
        db.close();
    });

    test('should return null on cache miss', () => {
        const result = cache.get('[]', 'mock-model');
        expect(result).toBeNull();
    });

    test('should store and retrieve a response', () => {
        const response: LLMResponse = {
            content: 'Hello world',
            finishReason: 'stop',
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        };

        cache.set('[{"role":"user","content":"hi"}]', 'mock-model', response, 'mock');

        const retrieved = cache.get('[{"role":"user","content":"hi"}]', 'mock-model');
        expect(retrieved).not.toBeNull();
        expect(retrieved!.content).toBe('Hello world');
        expect(retrieved!.finishReason).toBe('stop');
        expect((retrieved as any)._fromCache).toBe(true);
    });

    test('should differentiate by model', () => {
        const response: LLMResponse = {
            content: 'Model A response',
            finishReason: 'stop',
        };

        cache.set('[{"role":"user","content":"hi"}]', 'model-a', response, 'mock');

        // Same prompt, different model → miss
        const result = cache.get('[{"role":"user","content":"hi"}]', 'model-b');
        expect(result).toBeNull();
    });

    test('should differentiate by system prompt', () => {
        const response: LLMResponse = {
            content: 'With system prompt',
            finishReason: 'stop',
        };

        cache.set('[{"role":"user","content":"hi"}]', 'mock-model', response, 'mock', 'System A');

        // Same messages + model but different system prompt → miss
        const result = cache.get('[{"role":"user","content":"hi"}]', 'mock-model', 'System B');
        expect(result).toBeNull();

        // Same system prompt → hit
        const hit = cache.get('[{"role":"user","content":"hi"}]', 'mock-model', 'System A');
        expect(hit).not.toBeNull();
    });

    test('should track hit/miss stats', () => {
        const response: LLMResponse = { content: 'Cached', finishReason: 'stop' };
        cache.set('[]', 'm', response, 'mock');

        cache.get('[]', 'm'); // hit
        cache.get('[]', 'm'); // hit
        cache.get('[miss]', 'm'); // miss

        const stats = cache.getStats();
        expect(stats.hits).toBe(2);
        expect(stats.misses).toBe(1);
        expect(stats.hitRate).toBeCloseTo(2 / 3);
        expect(stats.entries).toBe(1);
    });

    test('should treat expired entries as miss', () => {
        const response: LLMResponse = { content: 'Cached', finishReason: 'stop' };

        // Insert via the cache service first (to get the right key)
        cache.set('[{"role":"user","content":"expire-test"}]', 'm', response, 'mock');

        // Verify it's a hit before expiry
        const hitBefore = cache.get('[{"role":"user","content":"expire-test"}]', 'm');
        expect(hitBefore).not.toBeNull();

        // Now manually update created_at to a past date to simulate expiry
        db.prepare(
            `UPDATE llm_cache SET created_at = ? WHERE model = 'm'`,
        ).run('2020-01-01 00:00:00');

        // Create a new cache instance that uses the same DB but has a short TTL
        // The original cache has ttlHours=24, so the 2020 entry is expired
        const result = cache.get('[{"role":"user","content":"expire-test"}]', 'm');
        expect(result).toBeNull(); // Should be treated as miss now
    });

    test('purgeExpired should remove old entries', () => {
        const response: LLMResponse = { content: 'Old', finishReason: 'stop' };

        // Insert with a past created_at
        db.prepare(
            `INSERT OR REPLACE INTO llm_cache (cache_key, response_json, model, provider, prompt_tokens, completion_tokens, created_at, last_accessed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            'manual_key', JSON.stringify(response), 'm', 'mock', null, null,
            '2020-01-01 00:00:00', '2020-01-01 00:00:00',
        );

        const countBefore = (db.prepare('SELECT COUNT(*) as c FROM llm_cache').get() as any).c;
        expect(countBefore).toBe(1);

        const purged = cache.purgeExpired();
        expect(purged).toBe(1);

        const countAfter = (db.prepare('SELECT COUNT(*) as c FROM llm_cache').get() as any).c;
        expect(countAfter).toBe(0);
    });

    test('clear should remove all entries and reset stats', () => {
        const response: LLMResponse = { content: 'X', finishReason: 'stop' };
        cache.set('[]', 'm', response, 'mock');
        cache.get('[]', 'm'); // hit

        cache.clear();

        const stats = cache.getStats();
        expect(stats.hits).toBe(0);
        expect(stats.misses).toBe(0);
        expect(stats.entries).toBe(0);
    });

    test('should do nothing when disabled', () => {
        const disabledCache = new LLMCacheService(db, { enabled: false, ttlHours: 24, maxEntries: 100 });

        const response: LLMResponse = { content: 'X', finishReason: 'stop' };
        disabledCache.set('[]', 'm', response, 'mock');

        const result = disabledCache.get('[]', 'm');
        expect(result).toBeNull();

        expect(disabledCache.isEnabled()).toBe(false);
    });

    test('should evict LRU entries when maxEntries exceeded', () => {
        const smallCache = new LLMCacheService(db, { enabled: true, ttlHours: 24, maxEntries: 3 });

        for (let i = 0; i < 5; i++) {
            const response: LLMResponse = { content: `Entry ${i}`, finishReason: 'stop' };
            smallCache.set(`[{"i":${i}}]`, 'm', response, 'mock');
        }

        const stats = smallCache.getStats();
        // Should have evicted 2 entries (5 - 3 = 2)
        expect(stats.entries).toBeLessThanOrEqual(3);
    });

    test('should overwrite existing entry on set with same key', () => {
        const response1: LLMResponse = { content: 'First', finishReason: 'stop' };
        const response2: LLMResponse = { content: 'Second', finishReason: 'stop' };

        cache.set('[]', 'm', response1, 'mock');
        cache.set('[]', 'm', response2, 'mock'); // Same key → overwrite

        const result = cache.get('[]', 'm');
        expect(result!.content).toBe('Second');

        const stats = cache.getStats();
        expect(stats.entries).toBe(1);
    });
});

// ─── CachedLLMProvider Tests ───────────────────────────────────

describe('CachedLLMProvider', () => {
    let db: Database.Database;
    let cache: LLMCacheService;
    let mockProvider: MockProvider;
    let cachedProvider: CachedLLMProvider;

    beforeEach(() => {
        db = createTestDb();
        cache = new LLMCacheService(db, { enabled: true, ttlHours: 24, maxEntries: 100 });
        mockProvider = new MockProvider();
        cachedProvider = new CachedLLMProvider(mockProvider, cache, 'mock');
    });

    afterEach(() => {
        db.close();
    });

    test('should delegate to inner provider on cache miss', async () => {
        const messages = makeMessages(['hello']);
        const result = await cachedProvider.chat(messages);

        expect(result.content).toContain('Response #1');
        expect(mockProvider.callCount).toBe(1);
    });

    test('should return cached response on cache hit', async () => {
        const messages = makeMessages(['hello']);

        // First call → miss, delegates to provider
        const result1 = await cachedProvider.chat(messages);
        expect(mockProvider.callCount).toBe(1);

        // Second call → hit, returns cached response
        const result2 = await cachedProvider.chat(messages);
        expect(mockProvider.callCount).toBe(1); // No additional call
        expect(result2.content).toBe(result1.content);
        expect((result2 as any)._fromCache).toBe(true);
    });

    test('should not cache tool_calls responses', async () => {
        // Create a mock that returns tool_calls
        const toolMock = new (class extends MockProvider {
            async chat(): Promise<LLMResponse> {
                this.callCount++;
                return {
                    content: '',
                    finishReason: 'tool_calls',
                    toolCalls: [{ id: '1', name: 'testTool', arguments: { x: 1 } }],
                };
            }
        })();

        const cachedTool = new CachedLLMProvider(toolMock, cache, 'mock');
        const messages = makeMessages(['do something']);

        // First call → should NOT be cached
        await cachedTool.chat(messages);
        expect(toolMock.callCount).toBe(1);

        // Second call → still goes to provider (not cached)
        await cachedTool.chat(messages);
        expect(toolMock.callCount).toBe(2);
    });

    test('should differentiate by system prompt', async () => {
        const messages = makeMessages(['hello']);

        const result1 = await cachedProvider.chat(messages, { systemPrompt: 'System A' });
        const result2 = await cachedProvider.chat(messages, { systemPrompt: 'System B' });

        // Different system prompts → different cache keys → both are misses
        expect(mockProvider.callCount).toBe(2);
        expect(result1.content).toContain('Response #1');
        expect(result2.content).toContain('Response #2');

        // Same system prompt → hit
        const result3 = await cachedProvider.chat(messages, { systemPrompt: 'System A' });
        expect(mockProvider.callCount).toBe(2); // No new call
        expect(result3.content).toBe(result1.content);
    });

    test('should bypass cache when disabled', async () => {
        const disabledCache = new LLMCacheService(db, { enabled: false, ttlHours: 24, maxEntries: 100 });
        const disabledProvider = new CachedLLMProvider(mockProvider, disabledCache, 'mock');

        const messages = makeMessages(['hello']);
        await disabledProvider.chat(messages);
        await disabledProvider.chat(messages);

        // Both calls go to the inner provider
        expect(mockProvider.callCount).toBe(2);
    });

    test('should pass through streaming calls without caching', async () => {
        const streamMock = new (class extends MockProvider {
            async chatStream(
                _messages: LLMMessage[],
                _options: ChatOptions,
                onToken: (token: string) => void,
            ): Promise<LLMResponse> {
                this.callCount++;
                onToken('token1');
                return { content: 'streamed', finishReason: 'stop' };
            }
        })();

        const cachedStream = new CachedLLMProvider(streamMock, cache, 'mock');
        const messages = makeMessages(['hello']);
        const tokens: string[] = [];

        const result = await cachedStream.chatStream(messages, {}, (t) => tokens.push(t));

        // Streaming always goes to the provider
        expect(streamMock.callCount).toBe(1);
        expect(tokens).toEqual(['token1']);
        expect(result.content).toBe('streamed');
    });

    test('should expose inner provider properties', () => {
        expect(cachedProvider.name).toBe('mock');
        expect(cachedProvider.supportedModels).toEqual(['mock-model']);
        expect(cachedProvider.supportsNativeToolCalling).toBe(false);
        expect(cachedProvider.defaultModel).toBe('mock-model');
    });

    test('should delegate healthCheck to inner provider', async () => {
        const healthy = await cachedProvider.healthCheck();
        expect(healthy).toBe(true);
    });
});
