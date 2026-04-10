/**
 * Langfuse Observability Module
 *
 * OpenTelemetry tabanlı LLM observability altyapısı.
 * Langfuse ile trace, metric ve evaluation sağlar.
 *
 * Özellikler:
 * - OpenTelemetry SDK yapılandırması
 * - LangfuseSpanProcessor entegrasyonu
 * - Feature flag ile enable/disable
 * - Graceful shutdown ve flush
 * - Trace context yönetimi
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { startActiveObservation, startObservation } from '@langfuse/tracing';
import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import { logger } from '../utils/logger.js';

// ========== Types ==========

export interface LangfuseConfig {
  secretKey: string;
  publicKey: string;
  baseUrl: string;
  enabled: boolean;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
}

// ========== Global State ==========

let sdk: NodeSDK | null = null;
let spanProcessor: LangfuseSpanProcessor | null = null;
let isInitialized = false;

// ========== Initialization ==========

/**
 * Langfuse OpenTelemetry SDK'sını başlatır.
 * Feature flag kapalıysa no-op geçer.
 */
export function initializeLangfuse(config: LangfuseConfig): boolean {
  if (!config.enabled) {
    logger.info('[Observability] Langfuse devre dışı (LANGFUSE_ENABLED=false)');
    return false;
  }

  if (!config.secretKey || !config.publicKey) {
    logger.warn('[Observability] Langfuse enabled ancak API keys eksik, atlanıyor');
    return false;
  }

  if (isInitialized) {
    logger.debug('[Observability] Langfuse zaten başlatılmış');
    return true;
  }

  try {
    // Environment variables'ı set et (Langfuse SDK bunları okur)
    process.env.LANGFUSE_SECRET_KEY = config.secretKey;
    process.env.LANGFUSE_PUBLIC_KEY = config.publicKey;
    process.env.LANGFUSE_BASE_URL = config.baseUrl;

    // Span processor oluştur
    spanProcessor = new LangfuseSpanProcessor();

    // OpenTelemetry SDK'ı yapılandır
    sdk = new NodeSDK({
      spanProcessors: [spanProcessor],
    });

    // SDK'ı başlat
    sdk.start();
    isInitialized = true;

    logger.info(
      { baseUrl: config.baseUrl },
      '[Observability] ✅ Langfuse OpenTelemetry initialized'
    );

    return true;
  } catch (error: any) {
    logger.error(
      { error: error.message },
      '[Observability] ❌ Langfuse initialization failed'
    );
    return false;
  }
}

// ========== Shutdown & Flush ==========

/**
 * Bekleyen tüm trace'leri Langfuse'a gönderir ve SDK'ı kapatır.
 * Graceful shutdown için kullanılır.
 */
export async function shutdownLangfuse(): Promise<void> {
  if (!isInitialized || !sdk) {
    logger.debug('[Observability] Langfuse zaten kapalı, flush atlanıyor');
    return;
  }

  try {
    logger.info('[Observability] 🔄 Flushing pending traces to Langfuse...');
    await sdk.shutdown();
    isInitialized = false;
    sdk = null;
    spanProcessor = null;
    logger.info('[Observability] ✅ Langfuse shutdown complete');
  } catch (error: any) {
    logger.error(
      { error: error.message },
      '[Observability] ❌ Langfuse shutdown error'
    );
  }
}

/**
 * Bekleyen trace'leri zorla gönderir (SDK kapanmadan).
 */
export async function flushLangfuse(): Promise<void> {
  if (!isInitialized || !spanProcessor) {
    return;
  }

  try {
    await spanProcessor.forceFlush();
    logger.debug('[Observability] Trace flush complete');
  } catch (error: any) {
    logger.error(
      { error: error.message },
      '[Observability] Trace flush error'
    );
  }
}

// ========== Tracing Helpers ==========

/**
 * Yeni bir trace başlatır.
 * Agent runtime, memory retrieval, LLM calls için kullanılır.
 */
export function startTrace(
  name: string,
  attributes?: Record<string, string | number | boolean>
): { tracer: any; span: any } {
  const tracer = trace.getTracer('penceai');
  const span = tracer.startSpan(name);

  // Attributes ekle
  if (attributes) {
    Object.entries(attributes).forEach(([key, value]) => {
      span.setAttribute(key, value);
    });
  }

  return { tracer, span };
}

/**
 * Aktif trace'in span'ını bitirir.
 */
export function endTrace(span: any, error?: Error): void {
  if (!span) return;

  if (error) {
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
  }

  span.end();
}

/**
 * Langfuse-native active observation başlatır.
 * Agent runtime gibi async operasyonlar için kullanılır.
 * Otomatik olarak parent trace'e bağlanır.
 */
export async function startActiveLangfuseTrace<T>(
  name: string,
  options: {
    input?: unknown;
    metadata?: Record<string, unknown>;
    userId?: string;
    sessionId?: string;
  },
  fn: (span: any) => Promise<T>
): Promise<T> {
  if (!isInitialized) {
    // Langfuse disabled, just run the function
    return fn(null);
  }

  return startActiveObservation(name, async (span) => {
    // Input ve metadata'yı ayarla
    if (options.input) {
      span.update({ input: options.input });
    }
    if (options.metadata) {
      span.update({ metadata: options.metadata });
    }

    try {
      const result = await fn(span);
      span.update({ output: 'Success' });
      return result;
    } catch (error: any) {
      span.update({ output: `Error: ${error.message}` });
      throw error;
    }
  });
}

/**
 * Langfuse-native generation observation başlatır.
 * LLM çağrıları için kullanılır (model, input, output, usage, cost).
 */
export function startLangfuseGeneration(
  name: string,
  options: {
    model?: string;
    input?: unknown[];
    modelParameters?: Record<string, unknown>;
  }
): any {
  if (!isInitialized) {
    return null;
  }

  return startObservation(name, {
    name: options.model, // Model adını name attribute'una ekle
    input: options.input,
    modelParameters: options.modelParameters,
  } as any, { asType: 'generation' });
}

/**
 * Generation observation'ı bitirir.
 * Output, usage ve cost bilgilerini ekler.
 */
export function endLangfuseGeneration(
  generation: any,
  options: {
    output?: unknown;
    usage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
    cost?: number;
    error?: Error;
  }
): void {
  if (!generation) return;

  try {
    // Output ve usage'ı ayarla
    const updateData: Record<string, unknown> = {};
    if (options.output) {
      updateData.output = options.output;
    }
    if (options.usage) {
      updateData.usage = {
        input: options.usage.promptTokens || 0,
        output: options.usage.completionTokens || 0,
        total: options.usage.totalTokens || 0,
        unit: 'TOKENS',
      };
    }
    if (options.cost !== undefined) {
      updateData.cost = options.cost;
    }

    generation.update(updateData);
    generation.end();
  } catch (error: any) {
    logger.debug({ error: error.message }, '[Observability] Generation end error');
  }
}

/**
 * Mevcut trace context'ini alır (WebSocket propagation için).
 */
export function getCurrentTraceContext(): TraceContext | null {
  if (!isInitialized) return null;

  const span = trace.getActiveSpan();
  if (!span) return null;

  return {
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
  };
}

/**
 * Belirli bir trace context ile fonksiyon çalıştırır.
 */
export function runInTraceContext<T>(
  span: any,
  fn: () => T
): T {
  if (!isInitialized) return fn();

  const ctx = trace.setSpan(context.active(), span);
  return context.with(ctx, fn);
}

// ========== Status ==========

/**
 * Langfuse'un başlatılıp başlatılmadığını kontrol eder.
 */
export function isLangfuseInitialized(): boolean {
  return isInitialized;
}

/**
 * Langfuse konfigürasyonunu validate eder.
 */
export function validateLangfuseConfig(config: LangfuseConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.enabled) {
    if (!config.secretKey) {
      errors.push('LANGFUSE_SECRET_KEY is required when Langfuse is enabled');
    }
    if (!config.publicKey) {
      errors.push('LANGFUSE_PUBLIC_KEY is required when Langfuse is enabled');
    }
    if (!config.baseUrl) {
      errors.push('LANGFUSE_BASE_URL is required when Langfuse is enabled');
    } else if (!config.baseUrl.startsWith('http')) {
      errors.push('LANGFUSE_BASE_URL must be a valid URL');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
