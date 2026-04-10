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
