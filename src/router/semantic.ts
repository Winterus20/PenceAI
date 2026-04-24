import { Worker } from 'node:worker_threads';
import { logger } from '../utils/logger.js';

export interface SemanticIntent<TContext = Record<string, unknown>> {
    name: string;
    description: string;
    examples: string[];
    action: (message: string, context?: TContext) => Promise<string | null>;
    _cachedEmbeddings?: Map<string, CachedEmbedding>;
}

export interface CachedEmbedding {
    vector: number[];
    createdAt: Date;
    lastAccessed: Date;
    size: number; // byte cinsinden (embedding boyutu * 4)
}

export interface TimeoutConfig {
    initialLoadMs: number;    // İlk model yükleme için timeout (default: 120000)
    normalMs: number;         // Normal embedding çağrıları için timeout (default: 15000)
    maxRetries: number;       // Max yeniden deneme sayısı (default: 3)
    backoffMultiplier: number; // Her retry'da timeout çarpanı (default: 2)
}

export interface FallbackConfig {
    mode: 'llm' | 'default' | 'none';
    defaultResponse?: string;
    onLowConfidence?: (message: string, bestScore: number, intentName?: string) => Promise<string | null>;
}

export interface CacheConfig {
    ttlMinutes: number;       // Cache geçerlilik süresi (default: 30)
    maxEntries: number;       // Max cache entry sayısı (default: 500)
    maxMemoryMB: number;      // Max cache bellek kullanımı (default: 100)
}

interface EmbeddingResponse {
    id?: number;
    type?: string;
    embedding: number[] | null;
    embeddings: number[][] | null;  // Batch mode response
    error: string | null;
}

interface PendingRequest {
    resolve: (v: number[] | number[][]) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
    isBatch?: boolean;
}

export class SemanticRouter<TContext = Record<string, unknown>> {
    private intents: SemanticIntent<TContext>[] = [];
    private worker: Worker | null = null;
    private isReady: boolean = false;
    private initializationPromise: Promise<void> | null = null;
    
    // Timeout yapılandırması
    private timeoutConfig: TimeoutConfig;
    private isFirstLoad: boolean = true;
    
    // Cache yapılandırması
    private cacheConfig: CacheConfig;
    private totalCacheSize: number = 0; // byte cinsinden
    
    // Fallback yapılandırması
    private fallbackConfig: FallbackConfig;
    
    // Worker thread message passing için request tracking
    private _requestId: number = 0;
    private _pendingRequests: Map<number, PendingRequest> = new Map();
    
    // Worker restart tracking
    private _restartCount: number = 0;
    private _maxRestarts: number = 3;

    constructor(
        threshold: number = 0.82,
        options?: {
            timeout?: Partial<TimeoutConfig>;
            cache?: Partial<CacheConfig>;
            fallback?: Partial<FallbackConfig>;
        }
    ) {
        this.similarityThreshold = threshold;
        
        // Varsayılan yapılandırmalar
        this.timeoutConfig = {
            initialLoadMs: 120000, // 2 dakika
            normalMs: 15000,        // 15 saniye
            maxRetries: 3,
            backoffMultiplier: 2,
            ...options?.timeout,
        };
        
        this.cacheConfig = {
            ttlMinutes: 30,
            maxEntries: 500,
            maxMemoryMB: 100,
            ...options?.cache,
        };
        
        this.fallbackConfig = {
            mode: 'none',
            defaultResponse: 'Niyet belirlenemedi, lütfen sorunuzu daha açık ifade edin.',
            ...options?.fallback,
        };
        
        this.initialize();
    }

    private similarityThreshold: number;

    private async initialize() {
        if (this.initializationPromise) return this.initializationPromise;

        this.initializationPromise = (async () => {
            try {
                logger.info(`[SemanticRouter] 🧠 Loading embedding model in worker thread (all-MiniLM-L6-v2)...`);

                await this.spawnWorker();

                // İlk embedding'i tetikle — model yüklemesini başlat
                const initialTimeout = this.timeoutConfig.initialLoadMs;
                await this.getEmbedding('warmup', initialTimeout);
                
                this.isFirstLoad = false;
                this.isReady = true;
                this._restartCount = 0; // Başarılı yükleme sonrası restart sayacını sıfırla
                
                logger.info(`[SemanticRouter] ✅ Embedding model loaded in worker. Zero event-loop-blocking routing enabled.`);
            } catch (err) {
                logger.error({ err }, '[SemanticRouter] ❌ Failed to initialize worker thread, falling back to disabled.');
                this.isReady = false;
            }
        })();

        return this.initializationPromise;
    }

    /**
     * Yeni worker thread oluşturur ve message handler'ları kurar.
     */
    private async spawnWorker(): Promise<void> {
        // Eski worker'ı temizle
        if (this.worker) {
            try {
                this.worker.removeAllListeners('message');
                this.worker.removeAllListeners('error');
                await this.worker.terminate();
            } catch {
                // Terminate hatası görmezden gel
            }
            this.worker = null;
        }

        const isTsNode = import.meta.url.endsWith('.ts');
        const workerExt = isTsNode ? '.ts' : '.js';
        const workerUrl = new URL(`./embedding-worker${workerExt}`, import.meta.url);
        
        const workerOptions: any = {};
        if (isTsNode) {
            workerOptions.execArgv = ['--import', 'tsx'];
        }

        this.worker = new Worker(workerUrl, workerOptions);

        // Worker'dan gelen yanıtları karşıla
        this.worker.on('message', (msg: EmbeddingResponse) => {
            // Ready sinyali
            if (msg.type === 'ready') {
                logger.info(`[SemanticRouter] ✅ Worker thread ready. Main thread unblocked.`);
                return;
            }
            // Embedding yanıtı
            if (msg.id !== undefined) {
                const pending = this._pendingRequests.get(msg.id);
                if (pending) {
                    this._pendingRequests.delete(msg.id);
                    clearTimeout(pending.timer);
                    if (msg.error) {
                        pending.reject(new Error(msg.error));
                    } else if (pending.isBatch && msg.embeddings) {
                        pending.resolve(msg.embeddings);
                    } else if (!pending.isBatch && msg.embedding) {
                        pending.resolve(msg.embedding);
                    } else {
                        pending.reject(new Error('Empty embedding response'));
                    }
                }
            }
        });

        this.worker.on('error', (err) => {
            logger.error({ err }, '[SemanticRouter] ❌ Worker thread error');
            this.handleWorkerCrash();
        });
    }

    /**
     * Worker çöküşünde otomatik yeniden başlatma.
     */
    private async handleWorkerCrash(): Promise<void> {
        this.isReady = false;
        
        // Bekleyen tüm istekleri hata ile çöz
        for (const [id, pending] of this._pendingRequests) {
            pending.reject(new Error('Worker thread crashed'));
            clearTimeout(pending.timer);
            this._pendingRequests.delete(id);
        }

        if (this._restartCount >= this._maxRestarts) {
            logger.error(`[SemanticRouter] ❌ Max restart attempts (${this._maxRestarts}) reached. Disabling semantic routing.`);
            return;
        }

        this._restartCount++;
        const backoffMs = Math.pow(2, this._restartCount - 1) * 1000; // 1s, 2s, 4s
        
        logger.info(`[SemanticRouter] 🔄 Restarting worker in ${backoffMs}ms (attempt ${this._restartCount}/${this._maxRestarts})...`);
        
        setTimeout(async () => {
            try {
                await this.spawnWorker();
                // Worker'ın hazır olduğunu test et
                await this.getEmbedding('warmup', 30000);
                this.isReady = true;
                logger.info(`[SemanticRouter] ✅ Worker restarted successfully (attempt ${this._restartCount})`);
            } catch (err) {
                logger.error({ err }, `[SemanticRouter] ❌ Worker restart failed (attempt ${this._restartCount})`);
                this.handleWorkerCrash(); // Recursive retry
            }
        }, backoffMs);
    }

    public registerIntent(intent: SemanticIntent<TContext>) {
        this.intents.push(intent);
        logger.debug(`[SemanticRouter] Registered intent: ${intent.name}`);
    }

    /**
     * Cache'den eski entry'leri temizler (lazy cleanup).
     */
    private cleanupCache(cache: Map<string, CachedEmbedding>): void {
        const now = new Date();
        const ttlMs = this.cacheConfig.ttlMinutes * 60 * 1000;
        
        for (const [key, cached] of cache.entries()) {
            const age = now.getTime() - cached.lastAccessed.getTime();
            if (age > ttlMs) {
                cache.delete(key);
                this.totalCacheSize -= cached.size;
            }
        }
    }

    /**
     * LRU stratejisi ile cache'den entry siler.
     */
    private evictLRU(cache: Map<string, CachedEmbedding>): void {
        let oldestKey: string | null = null;
        let oldestTime = Infinity;
        
        for (const [key, cached] of cache.entries()) {
            if (cached.lastAccessed.getTime() < oldestTime) {
                oldestTime = cached.lastAccessed.getTime();
                oldestKey = key;
            }
        }
        
        if (oldestKey) {
            const removed = cache.get(oldestKey)!;
            cache.delete(oldestKey);
            this.totalCacheSize -= removed.size;
            logger.debug(`[SemanticRouter] 🗑️ Evicted LRU cache entry (freed ${(removed.size / 1024).toFixed(1)}KB)`);
        }
    }

    // Cosine similarity
    private calculateSimilarity(vec1: number[], vec2: number[]): number {
        let dotProduct = 0;
        let norm1 = 0;
        let norm2 = 0;
        for (let i = 0; i < vec1.length; i++) {
            dotProduct += vec1[i]! * vec2[i]!;
            norm1 += vec1[i]! * vec1[i]!;
            norm2 += vec2[i]! * vec2[i]!;
        }
        if (norm1 === 0 || norm2 === 0) return 0;
        return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
    }

    /**
     * Dinamik timeout ile embedding alır.
     * İlk yükleme için daha uzun timeout, sonraki çağrılar için normal timeout kullanır.
     */
    private async getEmbedding(text: string, customTimeout?: number): Promise<number[]> {
        if (!this.worker) {
            await this.initialize();
        }
        if (!this.worker) throw new Error("Worker not initialized");

        const id = ++this._requestId;
        const timeoutMs = customTimeout ?? (this.isFirstLoad 
            ? this.timeoutConfig.initialLoadMs 
            : this.timeoutConfig.normalMs);

        return new Promise<number[]>((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pendingRequests.delete(id);
                reject(new Error(`Embedding worker timeout (${timeoutMs}ms)`));
            }, timeoutMs);

            this._pendingRequests.set(id, {
                resolve: (embedding) => {
                    clearTimeout(timer);
                    resolve(embedding as number[]);
                },
                reject: (err) => {
                    clearTimeout(timer);
                    reject(err);
                },
                timer,
                isBatch: false,
            });
            this.worker!.postMessage({ id, text });
        });
    }

    /**
     * Batch embedding: birden fazla text'i tek bir worker mesajında gönderir.
     * 10 intent × 5 example = 50 sequential mesaj yerine 1 mesaj ile çözülür.
     */
    private async getEmbeddingsBatch(texts: string[], customTimeout?: number): Promise<number[][]> {
        if (!this.worker) {
            await this.initialize();
        }
        if (!this.worker) throw new Error('Worker not initialized');

        if (texts.length === 0) return [];

        // Tek eleman → tekil çağrı (batch overhead'inden kaçın)
        if (texts.length === 1) {
            return [await this.getEmbedding(texts[0]!, customTimeout)];
        }

        const id = ++this._requestId;
        const timeoutMs = customTimeout ?? (this.isFirstLoad
            ? this.timeoutConfig.initialLoadMs
            : Math.max(this.timeoutConfig.normalMs, texts.length * 2000)); // batch için ek süre

        return new Promise<number[][]>((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pendingRequests.delete(id);
                reject(new Error(`Batch embedding worker timeout (${timeoutMs}ms for ${texts.length} texts)`));
            }, timeoutMs);

            this._pendingRequests.set(id, {
                resolve: (embeddings) => {
                    clearTimeout(timer);
                    resolve(embeddings as number[][]);
                },
                reject: (err) => {
                    clearTimeout(timer);
                    reject(err);
                },
                timer,
                isBatch: true,
            });
            this.worker!.postMessage({ id, text: '', texts });
        });
    }

    /**
     * Mesajı intent'lere göre yönlendirir.
     * Threshold altında eşleşme olursa fallback mechanism devreye girer.
     *
     * Optimizasyon: Cache'e alınmamış example embedding'leri batch olarak worker'a gönderir
     * (sequential yerine tek bir toplu istek — ~50× daha az IPC mesajı).
     */
    public async route(message: string, context?: TContext): Promise<{ handled: boolean, response: string | null }> {
        if (!this.isReady) {
            logger.warn('[SemanticRouter] ⚠️ Worker not ready, skipping routing');
            return { handled: false, response: null };
        }

        try {
            const inputEmbedding = await this.getEmbedding(message);

            // --- Batch embedding: tüm cache'siz example'ları topla ---
            const uncachedItems: Array<{ intentIdx: number; exampleIdx: number; text: string }> = [];
            const exampleEmbeddings: (number[] | null)[][] = []; // [intentIdx][exampleIdx]

            for (let iIdx = 0; iIdx < this.intents.length; iIdx++) {
                const intent = this.intents[iIdx]!;
                if (!intent._cachedEmbeddings) {
                    intent._cachedEmbeddings = new Map<string, CachedEmbedding>();
                }
                this.cleanupCache(intent._cachedEmbeddings);

                exampleEmbeddings[iIdx] = [];
                for (let eIdx = 0; eIdx < intent.examples.length; eIdx++) {
                    const example = intent.examples[eIdx]!;
                    const cached = intent._cachedEmbeddings.get(example);

                    if (cached) {
                        const age = new Date().getTime() - cached.lastAccessed.getTime();
                        const ttlMs = this.cacheConfig.ttlMinutes * 60 * 1000;
                        if (age < ttlMs) {
                            exampleEmbeddings[iIdx]![eIdx] = cached.vector;
                            cached.lastAccessed = new Date();
                            continue;
                        } else {
                            intent._cachedEmbeddings.delete(example);
                            this.totalCacheSize -= cached.size;
                        }
                    }

                    // Cache'de yok → batch listesine ekle
                    exampleEmbeddings[iIdx]![eIdx] = null;
                    uncachedItems.push({ intentIdx: iIdx, exampleIdx: eIdx, text: example });
                }
            }

            // --- Batch embedding hesapla (tek worker mesajı) ---
            if (uncachedItems.length > 0) {
                const batchTexts = uncachedItems.map(item => item.text);
                let batchResults: number[][];

                try {
                    batchResults = await this.getEmbeddingsBatch(batchTexts);
                } catch (batchErr) {
                    // Batch başarısız → tekil fallback
                    logger.warn({ err: batchErr }, '[SemanticRouter] Batch embedding failed, falling back to sequential');
                    batchResults = [];
                    for (const item of uncachedItems) {
                        try {
                            batchResults.push(await this.getEmbedding(item.text));
                        } catch {
                            batchResults.push([]);
                        }
                    }
                }

                // Sonuçları yerleştir ve cache'e al
                for (let i = 0; i < uncachedItems.length; i++) {
                    const { intentIdx, exampleIdx } = uncachedItems[i]!;
                    const embedding = batchResults[i];

                    if (embedding && embedding.length > 0) {
                        exampleEmbeddings[intentIdx]![exampleIdx] = embedding;

                        // Cache'e kaydet
                        const intent = this.intents[intentIdx]!;
                        const example = intent.examples[exampleIdx]!;
                        const embeddingSize = embedding.length * 4;
                        this.totalCacheSize += embeddingSize;

                        const maxMemoryBytes = this.cacheConfig.maxMemoryMB * 1024 * 1024;
                        while (this.totalCacheSize > maxMemoryBytes) {
                            this.evictLRU(intent._cachedEmbeddings!);
                        }
                        while (intent._cachedEmbeddings!.size >= this.cacheConfig.maxEntries) {
                            this.evictLRU(intent._cachedEmbeddings!);
                        }

                        intent._cachedEmbeddings!.set(example, {
                            vector: embedding,
                            createdAt: new Date(),
                            lastAccessed: new Date(),
                            size: embeddingSize,
                        });
                    }
                }
            }

            // --- Similarity hesapla ---
            let bestMatch = {
                intent: null as SemanticIntent<TContext> | null,
                exampleKey: null as string | null,
                score: 0,
            };

            for (let iIdx = 0; iIdx < this.intents.length; iIdx++) {
                const intent = this.intents[iIdx]!;
                for (let eIdx = 0; eIdx < intent.examples.length; eIdx++) {
                    const exampleEmbedding = exampleEmbeddings[iIdx]?.[eIdx];
                    if (!exampleEmbedding) continue;

                    const score = this.calculateSimilarity(inputEmbedding, exampleEmbedding);
                    if (score > bestMatch.score) {
                        bestMatch = {
                            intent,
                            exampleKey: intent.examples[eIdx]!,
                            score,
                        };
                    }
                }
            }

            if (bestMatch.intent && bestMatch.score >= this.similarityThreshold) {
                logger.info(`[SemanticRouter] 🎯 Matched intent '${bestMatch.intent.name}' with score ${bestMatch.score.toFixed(3)}`);
                const response = await bestMatch.intent.action(message, context);
                return { handled: true, response };
            }

            // Fallback mechanism
            if (bestMatch.intent && this.fallbackConfig.mode !== 'none') {
                logger.debug(
                    `[SemanticRouter] ⚠️ Low confidence match for '${bestMatch.intent.name}' ` +
                    `(score: ${bestMatch.score.toFixed(3)}, threshold: ${this.similarityThreshold})`
                );
                
                if (this.fallbackConfig.mode === 'llm' && this.fallbackConfig.onLowConfidence) {
                    const fallbackResponse = await this.fallbackConfig.onLowConfidence(
                        message, 
                        bestMatch.score, 
                        bestMatch.intent.name
                    );
                    return { handled: true, response: fallbackResponse };
                }
                
                if (this.fallbackConfig.mode === 'default') {
                    return { 
                        handled: true, 
                        response: this.fallbackConfig.defaultResponse ?? null 
                    };
                }
            }

            logger.debug(`[SemanticRouter] No intent matched above threshold (highest: ${bestMatch.score.toFixed(3)})`);
            return { handled: false, response: null };

        } catch (err) {
            logger.error({ err }, '[SemanticRouter] Routing error');
            return { handled: false, response: null };
        }
    }

    /**
     * Router durumunu döndürür (monitoring için).
     */
    public getStatus(): {
        isReady: boolean;
        intentCount: number;
        cacheEntries: number;
        cacheSizeMB: number;
        restartCount: number;
    } {
        const totalEntries = this.intents.reduce(
            (sum, intent) => sum + (intent._cachedEmbeddings?.size ?? 0), 
            0
        );
        
        return {
            isReady: this.isReady,
            intentCount: this.intents.length,
            cacheEntries: totalEntries,
            cacheSizeMB: this.totalCacheSize / (1024 * 1024),
            restartCount: this._restartCount,
        };
    }

    /**
     * Cache'i manuel olarak temizler.
     */
    public clearCache(): void {
        for (const intent of this.intents) {
            if (intent._cachedEmbeddings) {
                intent._cachedEmbeddings.clear();
            }
        }
        this.totalCacheSize = 0;
        logger.info('[SemanticRouter] 🧹 Cache cleared');
    }
}
