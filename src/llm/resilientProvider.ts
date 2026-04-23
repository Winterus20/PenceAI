/**
 * ResilientLLMProvider — Circuit breaker + priority-based fallback chain.
 *
 * Her provider için ayrı bir CircuitBreaker instance'ı tutar.
 * Primary provider başarısız olursa sıradaki provider'a geçiş yapar.
 * Tüm provider'lar açık (open) durumdaysa hata fırlatılır.
 *
 * Usage:
 *   const resilient = new ResilientLLMProvider([
 *     { provider: anthropicProvider, priority: 1 },
 *     { provider: openaiProvider, priority: 2 },
 *     { provider: ollamaProvider, priority: 3 },
 *   ]);
 *   const response = await resilient.chat(messages, options);
 */

import { LLMProvider, type ChatOptions } from './provider.js';
import type { LLMMessage, LLMResponse } from '../router/types.js';
import { logger } from '../utils/logger.js';

// ═══════════════════════════════════════════════════════════
//  Circuit Breaker State Machine
// ═══════════════════════════════════════════════════════════

export enum CircuitState {
    CLOSED = 'CLOSED',       // Normal — istekler geçer
    OPEN = 'OPEN',           // Kesik — istekler red edilir
    HALF_OPEN = 'HALF_OPEN', // Test — tek istek geçer
}

export interface CircuitBreakerConfig {
    /** Hata eşiği — ardışık hata sonrası circuit açılır (düşük trafikte fallback) */
    errorThreshold: number;
    /** Circuit açık kaldıktan sonra yarı-açık test süresi (ms) */
    resetTimeoutMs: number;
    /** Yarı-açık durumda izin verilen test isteği sayısı */
    halfOpenMaxRequests: number;
    /** Dinamik eşik: kayan pencere süresi (ms) — bu süre içindeki istekler error rate hesabına dahil */
    windowDurationMs: number;
    /** Dinamik eşik: error rate üst limiti (0.0–1.0) — bu oranı aşarsa circuit açılır */
    errorRateThreshold: number;
    /** Dinamik eşik: minimum örneklem boyutu — bu sayının altında istek varsa ardışık hata eşiği kullanılır */
    minSampleSize: number;
}

const DEFAULT_CB_CONFIG: Readonly<CircuitBreakerConfig> = {
    errorThreshold: 5,
    resetTimeoutMs: 30_000,
    halfOpenMaxRequests: 1,
    windowDurationMs: 60_000,       // 60 saniyelik kayan pencere
    errorRateThreshold: 0.5,         // %50 hata oranı
    minSampleSize: 5,               // 5 istekten sonra dinamik eşik devreye girer
};

/** Kayan pencere olay kaydı */
interface WindowEntry {
    timestamp: number;
    success: boolean;
}

class CircuitBreaker {
    private state: CircuitState = CircuitState.CLOSED;
    private failureCount = 0;
    private lastFailureAt = 0;
    private halfOpenSuccessCount = 0;
    /** Kayan pencere — son N saniyedeki istek sonuçları */
    private window: WindowEntry[] = [];

    constructor(
        private readonly name: string,
        private readonly config: CircuitBreakerConfig = DEFAULT_CB_CONFIG,
    ) {}

    /** Circuit durumunu döndürür — zamanlamaya göre otomatik geçiş yapar */
    getState(): CircuitState {
        if (this.state === CircuitState.OPEN) {
            const elapsed = Date.now() - this.lastFailureAt;
            if (elapsed >= this.config.resetTimeoutMs) {
                this.state = CircuitState.HALF_OPEN;
                this.halfOpenSuccessCount = 0;
                logger.info(`[CircuitBreaker:${this.name}] 🟡 OPEN → HALF_OPEN (${elapsed}ms geçti, test isteğine izin veriliyor)`);
            }
        }
        return this.state;
    }

    /** İsteğin geçmesine izin var mı? */
    allowRequest(): boolean {
        const state = this.getState();
        if (state === CircuitState.CLOSED) return true;
        if (state === CircuitState.HALF_OPEN) {
            return this.halfOpenSuccessCount < this.config.halfOpenMaxRequests;
        }
        return false; // OPEN
    }

    /** Başarılı çağrı — durumu günceller */
    recordSuccess(): void {
        this.pushWindowEntry(true);
        if (this.state === CircuitState.HALF_OPEN) {
            this.halfOpenSuccessCount++;
            if (this.halfOpenSuccessCount >= this.config.halfOpenMaxRequests) {
                this.state = CircuitState.CLOSED;
                this.failureCount = 0;
                this.window = [];  // Temiz sayfa — eski hatalar yeni kararları etkilemesin
                logger.info(`[CircuitBreaker:${this.name}] 🟢 HALF_OPEN → CLOSED (test başarılı)`);
            }
        } else if (this.state === CircuitState.CLOSED) {
            this.failureCount = 0; // Ardışık hata sayısını sıfırla
        }
    }

    /** Başarısız çağrı — durumu günceller */
    recordFailure(): void {
        this.pushWindowEntry(false);
        this.failureCount++;
        this.lastFailureAt = Date.now();

        if (this.state === CircuitState.HALF_OPEN) {
            // Test isteği başarısız → tekrar OPEN
            this.state = CircuitState.OPEN;
            logger.warn(`[CircuitBreaker:${this.name}] 🔴 HALF_OPEN → OPEN (test isteği başarısız)`);
        } else if (this.state === CircuitState.CLOSED && this.shouldOpen()) {
            this.state = CircuitState.OPEN;
            const stats = this.getWindowStats();
            logger.warn(
                `[CircuitBreaker:${this.name}] 🔴 CLOSED → OPEN ` +
                `(${stats.failures}/${stats.total} istek başarısız, ` +
                `rate: ${(stats.errorRate * 100).toFixed(1)}%, ` +
                `ardışık: ${this.failureCount})`,
            );
        }
    }

    /** Mevcut durumu metrik olarak döndür */
    getStats(): { state: CircuitState; failureCount: number; lastFailureAt: number; windowTotal: number; windowFailures: number; errorRate: number } {
        const ws = this.getWindowStats();
        return {
            state: this.state,
            failureCount: this.failureCount,
            lastFailureAt: this.lastFailureAt,
            windowTotal: ws.total,
            windowFailures: ws.failures,
            errorRate: ws.errorRate,
        };
    }

    /** Manual reset — test veya admin amaçlı */
    reset(): void {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.lastFailureAt = 0;
        this.halfOpenSuccessCount = 0;
        this.window = [];
        logger.info(`[CircuitBreaker:${this.name}] 🔄 Manual reset → CLOSED`);
    }

    // ─── Sliding Window Helpers ────────────────────────────

    /** Kayan pencereye yeni olay ekle — eski girişleri temizle */
    private pushWindowEntry(success: boolean): void {
        const now = Date.now();
        this.window.push({ timestamp: now, success });
        // Pencere dışındaki girişleri temizle
        const cutoff = now - this.config.windowDurationMs;
        while (this.window.length > 0 && this.window[0]!.timestamp < cutoff) {
            this.window.shift();
        }
    }

    /** Kayan pencere istatistikleri */
    private getWindowStats(): { total: number; failures: number; errorRate: number } {
        const total = this.window.length;
        if (total === 0) return { total: 0, failures: 0, errorRate: 0 };
        const failures = this.window.filter(e => !e.success).length;
        return { total, failures, errorRate: failures / total };
    }

    /** Circuit açılmalı mı? — dinamik eşik mantığı */
    private shouldOpen(): boolean {
        // 1) Düşük trafik / ardışık hata: statik eşik (her zaman aktif)
        //    5 ardışık hata → hemen aç (backward compatible)
        if (this.failureCount >= this.config.errorThreshold) return true;

        // 2) Yüksek trafik / aralıklı hata: pencere bazlı error rate
        //    Ardışık hata eşiğine ulaşmayan ama genel hata oranı yüksek durumlar
        //    Örn: 10 istekte 6 başarısız (%60) → aç, 5 ardışık olmadan da
        const stats = this.getWindowStats();
        if (stats.total >= this.config.minSampleSize && stats.errorRate >= this.config.errorRateThreshold) {
            return true;
        }

        return false;
    }
}

// ═══════════════════════════════════════════════════════════
//  Fallback Chain Entry
// ═══════════════════════════════════════════════════════════

export interface FallbackEntry {
    provider: LLMProvider;
    /** Öncelik — düşük sayı = yüksek öncelik. 1 = primary */
    priority: number;
    /** Bu provider'a hangi hata tiplerinde fallback yapılacak */
    fallbackOn?: ('timeout' | 'rate_limit' | '5xx' | 'all')[];
}

// ═══════════════════════════════════════════════════════════
//  ResilientLLMProvider
// ═══════════════════════════════════════════════════════════

export class ResilientLLMProvider extends LLMProvider {
    readonly name = 'resilient';
    readonly supportedModels: string[];

    private entries: FallbackEntry[];
    private breakers: Map<string, CircuitBreaker> = new Map();
    private cbConfig: CircuitBreakerConfig;

    constructor(
        entries: FallbackEntry[],
        cbConfig: CircuitBreakerConfig = DEFAULT_CB_CONFIG,
    ) {
        super();
        if (entries.length === 0) {
            throw new Error('ResilientLLMProvider requires at least one provider entry');
        }

        // Priority'ye göre sırala (düşük sayı = yüksek öncelik)
        this.entries = [...entries].sort((a, b) => a.priority - b.priority);
        this.cbConfig = cbConfig;

        // Her provider için circuit breaker oluştur
        for (const entry of this.entries) {
            this.breakers.set(entry.provider.name, new CircuitBreaker(entry.provider.name, cbConfig));
        }

        // Primary provider'ın desteklediği modelleri raporla
        this.supportedModels = this.entries[0]!.provider.supportedModels;
    }

    get supportsNativeToolCalling(): boolean {
        return this.entries[0]!.provider.supportsNativeToolCalling;
    }

    get defaultModel(): string {
        return this.entries[0]!.provider.defaultModel;
    }

    /**
     * Primary provider'ı döndürür — direkt erişim gerekirse.
     */
    get primaryProvider(): LLMProvider {
        return this.entries[0]!.provider;
    }

    /**
     * Chat — circuit breaker koruması ile fallback chain.
     * Primary provider circuit açıksa sıradaki provider'a geçer.
     */
    async chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse> {
        for (const entry of this.entries) {
            const breaker = this.breakers.get(entry.provider.name)!;

            // Circuit kapalıysa veya yarı-açıksa ve test izni varsa → dene
            if (!breaker.allowRequest()) {
                logger.debug(`[ResilientLLM] ⛔ ${entry.provider.name} circuit OPEN — atlanıyor`);
                continue;
            }

            try {
                const response = await entry.provider.chat(messages, options);
                breaker.recordSuccess();
                return response;
            } catch (err: unknown) {
                const error = err instanceof Error ? err : new Error(String(err));
                const shouldFallback = this.shouldFallback(error, entry.fallbackOn);

                breaker.recordFailure();

                logger.warn(
                    `[ResilientLLM] ❌ ${entry.provider.name} başarısız: ${error.message}` +
                    (shouldFallback ? ' → fallback deneniyor' : ''),
                );

                if (!shouldFallback) {
                    // Bu hata tipi için fallback yok → hatayı yukarı fırlat
                    throw err;
                }
                // Sonraki provider'ı dene
            }
        }

        // Tüm provider'lar tükendi
        throw new Error(
            `Tüm LLM provider'ları başarısız oldu: ${this.entries.map(e => e.provider.name).join(', ')}. ` +
            `Circuit breaker durumları: ${this.getCircuitStatusSummary()}`,
        );
    }

    /**
     * Streaming chat — circuit breaker koruması ile fallback.
     * Stream başlatıldıktan sonra fallback yapılamaz (partial stream).
     */
    async chatStream(
        messages: LLMMessage[],
        options: ChatOptions,
        onToken: (token: string) => void,
    ): Promise<LLMResponse> {
        for (const entry of this.entries) {
            const breaker = this.breakers.get(entry.provider.name)!;

            if (!breaker.allowRequest()) {
                continue;
            }

            // Streaming destekleniyorsa dene, desteklenmiyorsa atla
            if (!entry.provider.chatStream) {
                continue;
            }

            try {
                const response = await entry.provider.chatStream(messages, options, onToken);
                breaker.recordSuccess();
                return response;
            } catch (err: unknown) {
                const error = err instanceof Error ? err : new Error(String(err));
                breaker.recordFailure();
                logger.warn(`[ResilientLLM] ❌ ${entry.provider.name} stream başarısız: ${error.message} → fallback`);
                // Stream fallback yapılamaz ama circuit breaker state güncellendi
            }
        }

        // Son çare: non-streaming dene
        logger.info('[ResilientLLM] Tüm streaming provider\'lar başarısız — non-streaming fallback');
        return this.chat(messages, options);
    }

    async healthCheck(): Promise<boolean> {
        // Primary provider health check
        return this.entries[0]!.provider.healthCheck();
    }

    /**
     * Tüm circuit breaker durumlarını döndürür.
     */
    getCircuitStats(): Map<string, { state: CircuitState; failureCount: number; lastFailureAt: number; windowTotal: number; windowFailures: number; errorRate: number }> {
        const result = new Map<string, { state: CircuitState; failureCount: number; lastFailureAt: number; windowTotal: number; windowFailures: number; errorRate: number }>();
        for (const [name, breaker] of this.breakers) {
            result.set(name, breaker.getStats());
        }
        return result;
    }

    /**
     * Belirli bir provider'ın circuit breaker'ını sıfırla.
     */
    resetCircuit(providerName: string): void {
        const breaker = this.breakers.get(providerName);
        if (breaker) breaker.reset();
    }

    // ─── Internals ───────────────────────────────────────────

    private shouldFallback(
        error: Error,
        fallbackOn?: ('timeout' | 'rate_limit' | '5xx' | 'all')[],
    ): boolean {
        const triggers = fallbackOn ?? ['timeout', 'rate_limit', '5xx'];
        if (triggers.includes('all')) return true;

        const msg = error.message.toLowerCase();

        // Non-transient errors should NOT fallback (client errors — our fault)
        if (msg.includes('400') || msg.includes('401') || msg.includes('403') ||
            msg.includes('invalid') || msg.includes('context_length_exceeded') ||
            msg.includes('content_filter')) {
            return false;
        }

        for (const trigger of triggers) {
            switch (trigger) {
                case 'timeout':
                    if (msg.includes('timeout') || msg.includes('abort') || msg.includes('etimedout')) return true;
                    break;
                case 'rate_limit':
                    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('rate_limit')) return true;
                    break;
                case '5xx':
                    if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('529')) return true;
                    break;
            }
        }

        // Bilinmeyen hata tipleri — fallback yapma (güvenli taraf)
        return false;
    }

    private getCircuitStatusSummary(): string {
        const parts: string[] = [];
        for (const [name, breaker] of this.breakers) {
            const stats = breaker.getStats();
            parts.push(`${name}=${stats.state}(failures=${stats.failureCount})`);
        }
        return parts.join(', ');
    }
}
