/**
 * LLM Provider Observability Helpers
 *
 * Tüm LLM provider'ları için ortak observability utility fonksiyonları.
 * Langfuse native generation API kullanır (input, output, model, usage, cost).
 */

import { trace, SpanStatusCode } from '@opentelemetry/api';
import {
  isLangfuseInitialized,
  startTrace,
  endTrace,
  startLangfuseGeneration,
  endLangfuseGeneration,
} from '../observability/langfuse.js';
import type { LLMMessage, LLMResponse } from '../router/types.js';
import { calculateCost } from '../utils/costCalculator.js';

/**
 * LLM çağrısını Langfuse generation observation ile trace eder.
 * Model, input, output, token usage ve cost bilgilerini otomatik kaydeder.
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

  // Generation observation başlat
  const generation = startLangfuseGeneration(`${providerName}.chat`, {
    model,
    input: [], // LLM messages buraya gelecek (runtime'dan)
    modelParameters: {
      provider: providerName,
    },
  });

  try {
    const result = await fn();

    // Response metadata'ı çıkar
    if (result && typeof result === 'object' && 'usage' in result) {
      const llmResult = result as unknown as LLMResponse;

      // Usage bilgisi
      const usage = llmResult.usage ? {
        promptTokens: llmResult.usage.promptTokens || 0,
        completionTokens: llmResult.usage.completionTokens || 0,
        totalTokens: llmResult.usage.totalTokens || 0,
      } : undefined;

      // Cost hesaplama
      const cost = usage
        ? calculateCost(providerName, model, usage.promptTokens, usage.completionTokens)
        : undefined;

      // Generation'ı sonlandır ve bilgileri kaydet
      endLangfuseGeneration(generation, {
        output: llmResult.content,
        usage,
        cost,
      });
    } else {
      // Usage yoksa sadece content'i kaydet
      endLangfuseGeneration(generation, {
        output: (result as any)?.content || 'No content',
      });
    }

    return result;
  } catch (error: any) {
    // Hata durumunda generation'ı error ile sonlandır
    endLangfuseGeneration(generation, {
      error,
    });
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
