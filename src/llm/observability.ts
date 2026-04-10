/**
 * LLM Provider Observability Helpers
 * 
 * Tüm LLM provider'ları için ortak observability utility fonksiyonları.
 */

import { trace, SpanStatusCode } from '@opentelemetry/api';
import { isLangfuseInitialized, startTrace, endTrace } from '../observability/langfuse.js';
import type { LLMMessage, LLMResponse } from '../router/types.js';

/**
 * LLM çağrısını trace eder.
 * Langfuse enabled ise otomatik span oluşturur, değilse direkt çağırır.
 */
export async function traceLLMCall<T>(
  providerName: string,
  model: string,
  fn: () => Promise<T>
): Promise<T> {
  // Langfuse enabled değilse direkt çağır
  if (!isLangfuseInitialized()) {
    return fn();
  }

  const { span } = startTrace(`${providerName}.chat`, {
    provider: providerName,
    model,
  });

  try {
    const result = await fn();
    
    // Response metadata ekle (eğer LLMResponse ise)
    if (result && typeof result === 'object' && 'usage' in result) {
      const llmResult = result as any;
      if (llmResult.usage) {
        span.setAttribute('llm.prompt_tokens', llmResult.usage.prompt_tokens || 0);
        span.setAttribute('llm.completion_tokens', llmResult.usage.completion_tokens || 0);
        span.setAttribute('llm.total_tokens', llmResult.usage.total_tokens || 0);
      }
    }

    span.setStatus({ code: SpanStatusCode.OK });
    endTrace(span);
    return result;
  } catch (error: any) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
    endTrace(span, error);
    throw error;
  }
}

/**
 * Streaming LLM çağrısını trace eder.
 */
export async function traceLLMStream<T>(
  providerName: string,
  model: string,
  fn: () => Promise<T>
): Promise<T> {
  return traceLLMCall(providerName, `${model} (stream)`, fn);
}
