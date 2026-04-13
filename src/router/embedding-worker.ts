/**
 * Embedding Worker Thread — ONNX model inference'ı ana thread'den izole eder.
 *
 * @xenova/transformers WASM hesaplamaları sırasında event loop bloklanmasını
 * tamamen ortadan kaldırır. Ana thread iletişimi message passing ile yapılır.
 * 
 * Özellikler:
 * - FIFO request queue ile sıralı işleme
 * - Queue overflow koruması (max 1000 pending request)
 * - INT8 quantization ile hızlı inference, düşük bellek
 */
import { parentPort } from 'node:worker_threads';
import { pipeline, env } from '@xenova/transformers';

// Local Node.js environment optimizations
env.allowLocalModels = false;
env.useBrowserCache = false;

interface EmbeddingRequest {
    id: number;
    text: string;
}

interface EmbeddingResponse {
    id: number;
    embedding: number[] | null;
    error: string | null;
}

// Queue yapılandırması
const MAX_QUEUE_SIZE = 1000;

// Request queue
const requestQueue: EmbeddingRequest[] = [];
let isProcessing = false;

let extractor: any = null;
let initPromise: Promise<void> | null = null;

async function ensureModel(): Promise<void> {
    if (extractor) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        console.log('[EmbeddingWorker] 🔄 Loading model: Xenova/all-MiniLM-L6-v2 (quantized: INT8)');
        extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
            quantized: true, // INT8 quantization — hızlı inference, düşük bellek
        });
        console.log('[EmbeddingWorker] ✅ Model loaded successfully');
    })();

    return initPromise;
}

/**
 * Tek bir embedding request'ini işler.
 */
async function processRequest(request: EmbeddingRequest): Promise<void> {
    try {
        await ensureModel();
        const output = await extractor(request.text, { pooling: 'mean', normalize: true });
        const embedding = Array.from(output.data) as number[];
        
        const response: EmbeddingResponse = { 
            id: request.id, 
            embedding, 
            error: null 
        };
        parentPort?.postMessage(response);
    } catch (err: any) {
        const response: EmbeddingResponse = { 
            id: request.id, 
            embedding: null, 
            error: err.message ?? 'Unknown error' 
        };
        parentPort?.postMessage(response);
    }
}

/**
 * Queue'daki istekleri sırayla işler.
 */
async function processQueue(): Promise<void> {
    if (isProcessing || requestQueue.length === 0) return;
    
    isProcessing = true;
    
    while (requestQueue.length > 0) {
        const request = requestQueue.shift()!; // FIFO
        await processRequest(request);
    }
    
    isProcessing = false;
}

/**
 * Yeni embedding request'ini queue'ya ekler.
 */
function enqueueRequest(request: EmbeddingRequest): void {
    // Queue overflow koruması
    if (requestQueue.length >= MAX_QUEUE_SIZE) {
        const response: EmbeddingResponse = {
            id: request.id,
            embedding: null,
            error: `Queue overflow (max ${MAX_QUEUE_SIZE} pending requests)`
        };
        parentPort?.postMessage(response);
        return;
    }
    
    requestQueue.push(request);
    processQueue(); // Kuyruk işlemini başlat
}

// Ana thread'den gelen mesajları dinle
parentPort?.on('message', (msg: EmbeddingRequest) => {
    enqueueRequest(msg);
});

// Worker hazır sinyali
parentPort?.postMessage({ type: 'ready' });
console.log('[EmbeddingWorker] 🚀 Worker thread started, listening for requests');
