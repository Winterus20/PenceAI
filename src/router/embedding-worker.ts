/**
 * Embedding Worker Thread — ONNX model inference'ı ana thread'den izole eder.
 *
 * @xenova/transformers WASM hesaplamaları sırasında event loop bloklanmasını
 * tamamen ortadan kaldırır. Ana thread iletişimi message passing ile yapılır.
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

let extractor: any = null;
let initPromise: Promise<void> | null = null;

async function ensureModel(): Promise<void> {
    if (extractor) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
            quantized: true, // INT8 quantization — hızlı inference, düşük bellek
        });
    })();

    return initPromise;
}

parentPort?.on('message', async (msg: EmbeddingRequest) => {
    try {
        await ensureModel();
        const output = await extractor(msg.text, { pooling: 'mean', normalize: true });
        const embedding = Array.from(output.data) as number[];
        const response: EmbeddingResponse = { id: msg.id, embedding, error: null };
        parentPort?.postMessage(response);
    } catch (err: any) {
        const response: EmbeddingResponse = { id: msg.id, embedding: null, error: err.message };
        parentPort?.postMessage(response);
    }
});

// Worker hazır sinyali
parentPort?.postMessage({ type: 'ready' });
