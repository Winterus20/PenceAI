/**
 * LRU Cache Utility
 * ================
 * Basit, hafif ve TypeScript-uyumlu LRU (Least Recently Used) cache implementasyonu.
 * TTL (Time-To-Live) ve maksimum boyut desteği sunar.
 */

export interface LRUCacheOptions {
    maxSize: number;
    ttlMs: number;
}

interface CacheEntry<V> {
    value: V;
    expiresAt: number;
}

export class LRUCache<K, V> {
    private cache: Map<K, CacheEntry<V>>;
    private maxSize: number;
    private ttlMs: number;

    constructor(options: LRUCacheOptions) {
        this.cache = new Map();
        this.maxSize = options.maxSize;
        this.ttlMs = options.ttlMs;
    }

    has(key: K): boolean {
        const entry = this.cache.get(key);
        if (!entry) return false;
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return false;
        }
        return true;
    }

    get(key: K): V | undefined {
        const entry = this.cache.get(key);
        if (!entry) return undefined;
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return undefined;
        }
        // LRU: erişilen entry'yi sona taşı (en son kullanılan = en son)
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.value;
    }

    set(key: K, value: V): void {
        // Aynı key varsa önce sil (LRU sırasını güncellemek için)
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }

        // Kapasite aşılırsa en eski entry'yi sil
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }

        this.cache.set(key, {
            value,
            expiresAt: Date.now() + this.ttlMs,
        });
    }

    delete(key: K): boolean {
        return this.cache.delete(key);
    }

    clear(): void {
        this.cache.clear();
    }

    get size(): number {
        return this.cache.size;
    }

    /**
     * TTL'si dolmuş entry'leri temizler.
     * Periyodik çağrı için kullanılabilir.
     */
    purgeExpired(): number {
        const now = Date.now();
        let removed = 0;
        for (const [key, entry] of this.cache) {
            if (now > entry.expiresAt) {
                this.cache.delete(key);
                removed++;
            }
        }
        return removed;
    }
}
