import { getConfig } from '../gateway/config.js';
import { logger } from '../utils/logger.js';

// ============================================
// Embedding Providers — Semantik Benzerlik Araması
// ============================================

/** Geçici hatalar için üstel geri çekilme (exponential backoff) ile yeniden deneme. */
async function fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries: number = 3,
    baseDelayMs: number = 500
): Promise<Response> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);
            // Başarılı veya kalıcı hata (4xx, 5xx — 429/500/502/503 hariç) → hemen dön
            if (response.ok || (response.status < 500 && response.status !== 429)) {
                return response;
            }
            // Geçici hata (429, 5xx) → retry
            lastError = new Error(`HTTP ${response.status}`);
            // 429 için Retry-After header'a bak
            if (response.status === 429) {
                const retryAfter = response.headers.get('retry-after');
                if (retryAfter) {
                    const waitSec = parseInt(retryAfter, 10);
                    if (!isNaN(waitSec) && waitSec > 0 && waitSec <= 60) {
                        await new Promise(r => setTimeout(r, waitSec * 1000));
                        continue;
                    }
                }
            }
        } catch (err) {
            // Ağ hatası (DNS, timeout, connection reset vb.)
            lastError = err instanceof Error ? err : new Error(String(err));
        }
        if (attempt < maxRetries) {
            const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 200;
            await new Promise(r => setTimeout(r, delay));
        }
    }
    throw lastError ?? new Error('fetchWithRetry: bilinmeyen hata');
}

/**
 * Embedding provider arayüzü.
 * Metin(ler)i vektör uzayına gömme (embed) işlemi yapar.
 */
export interface EmbeddingProvider {
    /** Bir veya birden fazla metni embed eder. */
    embed(texts: string[]): Promise<number[][]>;
    /** Embedding boyutu (ör: 1536). */
    readonly dimensions: number;
    /** Provider adı. */
    readonly name: string;
}

// ========== Base Http Embedding ==========

/**
 * HTTP tabanlı embedding provider'ları için soyut temel sınıf.
 * Tüm provider'lar OpenAI-uyumlu /embeddings endpoint'i kullanır.
 */
abstract class BaseHttpEmbedding implements EmbeddingProvider {
    abstract readonly name: string;
    abstract readonly dimensions: number;
    protected abstract readonly baseURL: string;
    protected abstract readonly model: string;
    private apiKey: string;

    constructor(apiKey: string) {
        if (!apiKey) {
            throw new Error('Embedding API key sağlanmadı (embedding için gerekli)');
        }
        // Gelişmiş kontrol: API key içinde geçersiz karakterler (ör. sansürlenmiş •) var mı?
        if (/[^\x20-\x7E]/.test(apiKey)) {
            logger.warn(`[Embedding] Geçersiz API Key formatı tespit edildi (Unicode karakter içeriyor). Semantik arama çalışmayabilir veya hatalara yol açabilir.`);
            // ASCII olmayan karakterleri temizle ki uygulama çökmesin.
            // Ama yine de muhtemelen yetki hatası alacaktır.
            this.apiKey = apiKey.replace(/[^\x20-\x7E]/g, '');
        } else {
            this.apiKey = apiKey;
        }
    }

    async embed(texts: string[]): Promise<number[][]> {
        if (texts.length === 0) return [];
        const response = await fetchWithRetry(`${this.baseURL}/embeddings`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ model: this.model, input: texts }),
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`${this.name} embedding hatası (${response.status}): ${error}`);
        }
        const data = await response.json() as { data: Array<{ embedding: number[]; index: number }> };
        return data.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
    }
}

// ========== MiniMax Embedding ==========

/**
 * MiniMax Embedding Provider.
 * Model: embo-01 (1536 boyut)
 * API: https://api.minimax.io/v1/embeddings (OpenAI uyumlu)
 */
export class MiniMaxEmbedding extends BaseHttpEmbedding {
    readonly name = 'minimax';
    readonly dimensions = 1536;
    protected readonly baseURL = 'https://api.minimax.io/v1';
    protected readonly model: string;
    constructor(apiKey: string, model?: string) {
        super(apiKey);
        this.model = model || 'embo-01';
    }
}

// ========== OpenAI Embedding ==========

/**
 * OpenAI Embedding Provider.
 * Model: text-embedding-3-small (1536 boyut)
 * API: https://api.openai.com/v1/embeddings
 */
export class OpenAIEmbedding extends BaseHttpEmbedding {
    readonly name = 'openai';
    readonly dimensions = 1536;
    protected readonly baseURL = 'https://api.openai.com/v1';
    protected readonly model: string;
    constructor(apiKey: string, model?: string) {
        super(apiKey);
        this.model = model || 'text-embedding-3-small';
    }
}

// ========== Voyage Embedding ==========

/**
 * Voyage AI Embedding Provider.
 * Model: voyage-3-large (3072 boyut)
 * API: https://api.voyageai.com/v1/embeddings (OpenAI uyumlu)
 */
export class VoyageEmbedding extends BaseHttpEmbedding {
    readonly name = 'voyage';
    readonly dimensions = 3072;
    protected readonly baseURL = 'https://api.voyageai.com/v1';
    protected readonly model: string;
    constructor(apiKey: string, model?: string) {
        super(apiKey);
        this.model = model || 'voyage-3-large';
    }
}

// ========== Yardımcı Fonksiyonlar ==========

/**
 * Config'e göre doğru embedding provider'ı oluşturur.
 * EMBEDDING_PROVIDER=none ise null döner (semantik arama devre dışı).
 */
export function createEmbeddingProvider(): EmbeddingProvider | null {
    const config = getConfig();
    const provider = config.embeddingProvider;
    const embeddingModel = config.embeddingModel;

    switch (provider) {
        case 'minimax':
            return new MiniMaxEmbedding(config.minimaxApiKey || '', embeddingModel);
        case 'openai':
            return new OpenAIEmbedding(config.openaiApiKey || '', embeddingModel);
        case 'voyage':
            return new VoyageEmbedding(config.voyageApiKey || '', embeddingModel);
        case 'none':
            return null;
        default:
            logger.warn(`[Embedding] Bilinmeyen provider: ${provider}, embedding devre dışı.`);
            return null;
    }
}
