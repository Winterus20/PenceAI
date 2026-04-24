/**
 * LLMCacheService — SQLite-backed LLM Prompt Caching.
 *
 * Problem: LLM calls (entity extraction, community summarization, same-intent
 * analyses, etc.) frequently send the same prompt+content to the API.  Without
 * caching every duplicate call costs real $ and takes 1-5 s.
 *
 * Solution:  `llm_cache` table keyed on MD5(normalized_prompt + model).
 *            TTL-based expiry, periodic LRU eviction, hit/miss stats.
 *
 * Benefit:   Identical queries resolve in 10-20 ms with $0 API cost.
 */

import { createHash } from 'crypto';
import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';
import type { LLMResponse } from '../router/types.js';

// ─── Public types ──────────────────────────────────────────────

export interface LLMCacheConfig {
    /** Enable/disable the cache (default: true) */
    enabled: boolean;
    /** Time-to-live in hours; entries older than this are considered stale (default: 24) */
    ttlHours: number;
    /** Maximum number of entries; oldest are evicted when exceeded (default: 1000) */
    maxEntries: number;
}

export interface LLMCacheStats {
    hits: number;
    misses: number;
    hitRate: number;
    entries: number;
}

// ─── Internal row shape ────────────────────────────────────────

interface CacheRow {
    cache_key: string;
    response_json: string;
    model: string;
    provider: string;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    created_at: string;
    last_accessed_at: string;
    access_count: number;
}

// ─── Defaults ──────────────────────────────────────────────────

const DEFAULT_CONFIG: LLMCacheConfig = {
    enabled: true,
    ttlHours: 24,
    maxEntries: 1000,
};

// ─── Service ───────────────────────────────────────────────────

export class LLMCacheService {
    private config: LLMCacheConfig;
    private db: Database.Database;

    /** Prepared statements (created lazily, cached for performance) */
    private stmtGet?: Database.Statement;
    private stmtSet?: Database.Statement;
    private stmtTouch?: Database.Statement;
    private stmtDeleteExpired?: Database.Statement;
    private stmtCount?: Database.Statement;
    private stmtEvict?: Database.Statement;
    private stmtClear?: Database.Statement;

    /** In-memory counters — reset on process restart but good enough for real-time monitoring */
    private hits = 0;
    private misses = 0;

    constructor(db: Database.Database, config?: Partial<LLMCacheConfig>) {
        this.db = db;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.ensureTable();
        this.prepareStatements();
    }

    // ─── Public API ──────────────────────────────────────────

    /**
     * Look up a cached response. Returns `null` on miss or if the entry
     * is stale (past TTL).
     */
    get(messagesJson: string, model: string, systemPrompt?: string): LLMResponse | null {
        if (!this.config.enabled) return null;

        const key = this.computeKey(messagesJson, model, systemPrompt);
        const row = this.stmtGet!.get(key) as CacheRow | undefined;

        if (!row) {
            this.misses++;
            return null;
        }

        // TTL check
        const ageMs = Date.now() - new Date(row.created_at).getTime();
        const ttlMs = this.config.ttlHours * 3600 * 1000;
        if (ageMs > ttlMs) {
            // Stale — treat as miss (will be overwritten on next set)
            this.misses++;
            return null;
        }

        // Cache hit — update access stats
        const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
        this.stmtTouch!.run(now, key);
        this.hits++;

        try {
            const response = JSON.parse(row.response_json) as LLMResponse;
            // Attach a marker so callers know this came from cache
            (response as LLMResponse & { _fromCache?: boolean })._fromCache = true;
            return response;
        } catch (err) {
            logger.warn({ err, key }, '[LLMCache] Corrupt cache entry — treating as miss');
            this.misses++;
            return null;
        }
    }

    /**
     * Store a response in the cache. Overwrites any existing entry
     * with the same key.
     */
    set(
        messagesJson: string,
        model: string,
        response: LLMResponse,
        provider: string,
        systemPrompt?: string,
    ): void {
        if (!this.config.enabled) return;

        const key = this.computeKey(messagesJson, model, systemPrompt);
        const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const responseJson = JSON.stringify(response);

        this.stmtSet!.run(
            key,
            responseJson,
            model,
            provider,
            response.usage?.promptTokens ?? null,
            response.usage?.completionTokens ?? null,
            now,  // created_at
            now,  // last_accessed_at
        );

        // Evict if over maxEntries
        this.evictIfNeeded();
    }

    /**
     * Remove entries that have exceeded their TTL.
     * Call periodically (e.g. every 30 min from a background job).
     */
    purgeExpired(): number {
        if (!this.config.enabled) return 0;
        const cutoffIso = new Date(Date.now() - this.config.ttlHours * 3600 * 1000)
            .toISOString()
            .replace('T', ' ')
            .substring(0, 19);
        const result = this.stmtDeleteExpired!.run(cutoffIso);
        const count = result.changes;
        if (count > 0) {
            logger.info(`[LLMCache] 🧹 Purged ${count} expired entries`);
        }
        return count;
    }

    /**
     * Remove all entries. Useful for testing or forced reset.
     */
    clear(): void {
        this.stmtClear!.run();
        this.hits = 0;
        this.misses = 0;
        logger.info('[LLMCache] Cache cleared');
    }

    /**
     * Return cache hit/miss stats.
     */
    getStats(): LLMCacheStats {
        const total = this.hits + this.misses;
        const row = this.stmtCount!.get() as { count: number } | undefined;
        return {
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? this.hits / total : 0,
            entries: row?.count ?? 0,
        };
    }

    /** Whether caching is enabled */
    isEnabled(): boolean {
        return this.config.enabled;
    }

    // ─── Internals ───────────────────────────────────────────

    /**
     * Compute a stable cache key: MD5(normalized_prompt + model).
     * The prompt is serialized as JSON of the messages array + optional
     * system prompt so that identical logical inputs produce the same key.
     */
    /** Normalize whitespace in plain text: collapse runs of whitespace into a single space, trim edges.
     *  Only safe for plain text (e.g. systemPrompt). NOT for JSON strings — would corrupt structure.
     */
    private static normalizePlainText(str: string): string {
        return str.replace(/\s+/g, ' ').trim();
    }

    private computeKey(messagesJson: string, model: string, systemPrompt?: string): string {
        // Normalize whitespace only in systemPrompt (plain text).
        // messagesJson is structured JSON — whitespace-normalizing it would cause false cache hits.
        const normalizedSystem = systemPrompt ? LLMCacheService.normalizePlainText(systemPrompt) : '';
        const normalized = (normalizedSystem ? normalizedSystem + '\n' : '') + messagesJson;
        return createHash('md5').update(normalized + '|' + model).digest('hex');
    }

    /**
     * Ensure the llm_cache table exists. Idempotent — safe to call
     * multiple times.
     *
     * Note: This table is also created by migration v19 in database.ts.
     * The duplicate CREATE TABLE IF NOT EXISTS here ensures the table is
     * available even when LLMCacheService is used with a fresh :memory:
     * DB in tests or before migration runs.
     */
    private ensureTable(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS llm_cache (
                cache_key            TEXT PRIMARY KEY,
                response_json        TEXT NOT NULL,
                model                TEXT NOT NULL,
                provider             TEXT NOT NULL DEFAULT '',
                prompt_tokens        INTEGER,
                completion_tokens    INTEGER,
                created_at           DATETIME NOT NULL,
                last_accessed_at     DATETIME NOT NULL,
                access_count         INTEGER DEFAULT 1
            );
            CREATE INDEX IF NOT EXISTS idx_llm_cache_created    ON llm_cache(created_at);
            CREATE INDEX IF NOT EXISTS idx_llm_cache_accessed   ON llm_cache(last_accessed_at);
        `);
    }

    /**
     * Create prepared statements once for performance.
     */
    private prepareStatements(): void {
        this.stmtGet = this.db.prepare(
            `SELECT cache_key, response_json, model, provider, prompt_tokens, completion_tokens, created_at, last_accessed_at, access_count
             FROM llm_cache WHERE cache_key = ?`,
        );
        this.stmtSet = this.db.prepare(
            `INSERT OR REPLACE INTO llm_cache
             (cache_key, response_json, model, provider, prompt_tokens, completion_tokens, created_at, last_accessed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        this.stmtTouch = this.db.prepare(
            `UPDATE llm_cache SET last_accessed_at = ?, access_count = access_count + 1 WHERE cache_key = ?`,
        );
        this.stmtDeleteExpired = this.db.prepare(
            `DELETE FROM llm_cache WHERE created_at < ?`,
        );
        this.stmtCount = this.db.prepare(
            `SELECT COUNT(*) AS count FROM llm_cache`,
        );
        this.stmtEvict = this.db.prepare(
            `DELETE FROM llm_cache WHERE cache_key IN (
                SELECT cache_key FROM llm_cache ORDER BY last_accessed_at ASC LIMIT ?
            )`,
        );
        this.stmtClear = this.db.prepare(`DELETE FROM llm_cache`);
    }

    /**
     * Evict least-recently-used entries if the table exceeds maxEntries.
     */
    private evictIfNeeded(): void {
        const row = this.stmtCount!.get() as { count: number } | undefined;
        const count = row?.count ?? 0;
        if (count > this.config.maxEntries) {
            const toEvict = count - this.config.maxEntries;
            this.stmtEvict!.run(toEvict);
            logger.info(`[LLMCache] 🗑️  Evicted ${toEvict} LRU entries (max=${this.config.maxEntries})`);
        }
    }
}
