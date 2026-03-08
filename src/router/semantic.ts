import { Worker } from 'node:worker_threads';
import { logger } from '../utils/logger.js';

export interface SemanticIntent {
    name: string;
    description: string;
    examples: string[];
    action: (message: string, context?: any) => Promise<string | null>;
    _cachedEmbeddings?: number[][];
}

interface EmbeddingResponse {
    id?: number;
    type?: string;
    embedding: number[] | null;
    error: string | null;
}

export class SemanticRouter {
    private intents: SemanticIntent[] = [];
    private worker: Worker | null = null;
    private isReady: boolean = false;
    private initializationPromise: Promise<void> | null = null;
    private similarityThreshold: number = 0.82;

    // Worker thread message passing için request tracking
    private _requestId: number = 0;
    private _pendingRequests: Map<number, { resolve: (v: number[]) => void; reject: (e: Error) => void }> = new Map();

    constructor(threshold: number = 0.82) {
        this.similarityThreshold = threshold;
        this.initialize();
    }

    private async initialize() {
        if (this.initializationPromise) return this.initializationPromise;

        this.initializationPromise = (async () => {
            try {
                logger.info(`[SemanticRouter] 🧠 Loading embedding model in worker thread (all-MiniLM-L6-v2)...`);

                const workerUrl = new URL('./embedding-worker.ts', import.meta.url);
                this.worker = new Worker(workerUrl, {
                    execArgv: ['--import', 'tsx'],
                });

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
                            if (msg.error) {
                                pending.reject(new Error(msg.error));
                            } else if (msg.embedding) {
                                pending.resolve(msg.embedding);
                            } else {
                                pending.reject(new Error('Empty embedding response'));
                            }
                        }
                    }
                });

                this.worker.on('error', (err) => {
                    logger.error({ err }, '[SemanticRouter] ❌ Worker thread error');
                    this.isReady = false;
                    // Bekleyen tüm istekleri hata ile çöz
                    for (const [id, pending] of this._pendingRequests) {
                        pending.reject(new Error('Worker thread crashed'));
                        this._pendingRequests.delete(id);
                    }
                });

                // İlk embedding'i tetikle — model yüklemesini başlat
                await this.getEmbedding('warmup');
                this.isReady = true;
                logger.info(`[SemanticRouter] ✅ Embedding model loaded in worker. Zero event-loop-blocking routing enabled.`);
            } catch (err) {
                logger.error({ err }, '[SemanticRouter] ❌ Failed to initialize worker thread, falling back to disabled.');
                this.isReady = false;
            }
        })();

        return this.initializationPromise;
    }

    public registerIntent(intent: SemanticIntent) {
        this.intents.push(intent);
        logger.debug(`[SemanticRouter] Registered intent: ${intent.name}`);
    }

    // Cosine similarity
    private calculateSimilarity(vec1: number[], vec2: number[]): number {
        let dotProduct = 0;
        let norm1 = 0;
        let norm2 = 0;
        for (let i = 0; i < vec1.length; i++) {
            dotProduct += vec1[i] * vec2[i];
            norm1 += vec1[i] * vec1[i];
            norm2 += vec2[i] * vec2[i];
        }
        if (norm1 === 0 || norm2 === 0) return 0;
        return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
    }

    private async getEmbedding(text: string): Promise<number[]> {
        if (!this.worker) {
            await this.initialize();
        }
        if (!this.worker) throw new Error("Worker not initialized");

        const id = ++this._requestId;
        return new Promise<number[]>((resolve, reject) => {
            // 30 saniye timeout — model ilk yüklemede yavaş olabilir
            const timer = setTimeout(() => {
                this._pendingRequests.delete(id);
                reject(new Error('Embedding worker timeout (30s)'));
            }, 30000);

            this._pendingRequests.set(id, {
                resolve: (embedding) => {
                    clearTimeout(timer);
                    resolve(embedding);
                },
                reject: (err) => {
                    clearTimeout(timer);
                    reject(err);
                },
            });
            this.worker!.postMessage({ id, text });
        });
    }

    public async route(message: string, context?: any): Promise<{ handled: boolean, response: string | null }> {
        if (!this.isReady) {
            // Fallback to LLM if model hasn't loaded yet
            return { handled: false, response: null };
        }

        try {
            const inputEmbedding = await this.getEmbedding(message);

            let bestMatch = { intent: null as SemanticIntent | null, score: 0 };

            for (const intent of this.intents) {
                // Lazy initialize cached embeddings for examples — paralel çalıştır
                if (!intent._cachedEmbeddings) {
                    intent._cachedEmbeddings = await Promise.all(
                        intent.examples.map(example => this.getEmbedding(example))
                    );
                }

                for (const exampleEmbedding of intent._cachedEmbeddings) {
                    const score = this.calculateSimilarity(inputEmbedding, exampleEmbedding);

                    if (score > bestMatch.score) {
                        bestMatch = { intent: intent, score };
                    }
                }
            }

            if (bestMatch.intent && bestMatch.score >= this.similarityThreshold) {
                logger.info(`[SemanticRouter] 🎯 Matched intent '${bestMatch.intent.name}' with score ${bestMatch.score.toFixed(3)}`);
                const response = await bestMatch.intent.action(message, context);
                return { handled: true, response };
            }

            logger.debug(`[SemanticRouter] No intent matched above threshold (highest: ${bestMatch.score.toFixed(3)})`);
            return { handled: false, response: null };

        } catch (err) {
            logger.error({ err }, '[SemanticRouter] Routing error');
            return { handled: false, response: null };
        }
    }
}
