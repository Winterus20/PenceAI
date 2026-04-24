/**
 * Provider ve model bazlı token maliyet hesaplama.
 * Fiyatlar yaklaşık değerlerdir (2026 Nisan), gerçek fatura ile tam eşleşmeyebilir.
 * Birimler: $/1K tokens (bin token başına dolar).
 */

import { logger } from './logger.js';

interface ModelPricing {
  /** Prompt/input token fiyatı ($/1K) */
  promptPer1K: number;
  /** Completion/output token fiyatı ($/1K) */
  completionPer1K: number;
}

/**
 * Provider → Model → Fiyat mapping tablosu.
 * Bilinmeyen model için fallback pricing kullanılır.
 */
const PRICING_MAP: Record<string, Record<string, ModelPricing>> = {
  openai: {
    'gpt-4o': { promptPer1K: 0.0025, completionPer1K: 0.01 },
    'gpt-4o-mini': { promptPer1K: 0.00015, completionPer1K: 0.0006 },
    'gpt-4-turbo': { promptPer1K: 0.01, completionPer1K: 0.03 },
    'gpt-4': { promptPer1K: 0.03, completionPer1K: 0.06 },
    'gpt-3.5-turbo': { promptPer1K: 0.0005, completionPer1K: 0.0015 },
    'o1': { promptPer1K: 0.015, completionPer1K: 0.06 },
    'o1-mini': { promptPer1K: 0.003, completionPer1K: 0.012 },
  },
  anthropic: {
    'claude-sonnet-4-20250514': { promptPer1K: 0.003, completionPer1K: 0.015 },
    'claude-opus-4-20250514': { promptPer1K: 0.015, completionPer1K: 0.075 },
    'claude-3-5-sonnet-20241022': { promptPer1K: 0.003, completionPer1K: 0.015 },
    'claude-3-5-haiku-20241022': { promptPer1K: 0.0008, completionPer1K: 0.004 },
    'claude-3-opus-20240229': { promptPer1K: 0.015, completionPer1K: 0.075 },
  },
  minimax: {
    'minimax-m2.5': { promptPer1K: 0.0005, completionPer1K: 0.002 },
    'minimax-m2': { promptPer1K: 0.001, completionPer1K: 0.003 },
  },
  github: {
    // GitHub Models genellikle OpenAI/Anthropic modellerini proxy'ler
    // Fiyatlar upstream ile aynı varsayılır
    'gpt-4o': { promptPer1K: 0.0025, completionPer1K: 0.01 },
    'gpt-4o-mini': { promptPer1K: 0.00015, completionPer1K: 0.0006 },
    'llama-3-70b': { promptPer1K: 0.0005, completionPer1K: 0.001 },
    'llama-3-8b': { promptPer1K: 0.0001, completionPer1K: 0.0003 },
  },
  groq: {
    'llama-3.1-70b': { promptPer1K: 0.00059, completionPer1K: 0.00079 },
    'llama-3.1-8b': { promptPer1K: 0.00005, completionPer1K: 0.00008 },
    'mixtral-8x7b': { promptPer1K: 0.00024, completionPer1K: 0.00024 },
    'gemma-7b': { promptPer1K: 0.00007, completionPer1K: 0.00007 },
  },
  mistral: {
    'mistral-large-latest': { promptPer1K: 0.002, completionPer1K: 0.006 },
    'mistral-small-latest': { promptPer1K: 0.0002, completionPer1K: 0.0006 },
    'codestral-latest': { promptPer1K: 0.001, completionPer1K: 0.003 },
    'ministral-8b-latest': { promptPer1K: 0.0001, completionPer1K: 0.0001 },
  },
  nvidia: {
    'nemotron-4-340b': { promptPer1K: 0.001, completionPer1K: 0.001 },
    'llama-3.1-70b': { promptPer1K: 0.00035, completionPer1K: 0.0004 },
    'llama-3.1-8b': { promptPer1K: 0.0001, completionPer1K: 0.0001 },
  },
  ollama: {
    // Ollama local çalıştığı için maliyet = 0
    // Ama token sayısını kaydetmek için 0 fiyat kullanıyoruz
    'default': { promptPer1K: 0, completionPer1K: 0 },
  },
};

/** Fallback fiyat — bilinmeyen provider/model için */
const FALLBACK_PRICING: ModelPricing = { promptPer1K: 0.001, completionPer1K: 0.003 };

/**
 * Model adını normalize eder; versiyon soneklerini temizler ve
 * bilinen temel model adlarına eşler.
 *
 * @param model - Normalize edilecek model adı
 * @returns Normalize edilmiş model adı
 *
 * @example
 * ```ts
 * normalizeModelName('gpt-4o-2024-08-06');
 * // => 'gpt-4o'
 *
 * normalizeModelName('claude-3-5-sonnet-latest');
 * // => 'claude-3-5-sonnet-20241022'
 * ```
 */
export function normalizeModelName(model: string): string {
  if (!model) return model;

  const lower = model.toLowerCase();

  // GPT-4o-mini ailesi (gpt-4o-mini-* → gpt-4o-mini)
  if (lower.startsWith('gpt-4o-mini')) {
    return 'gpt-4o-mini';
  }

  // GPT-4o ailesi (gpt-4o-* → gpt-4o)
  if (lower.startsWith('gpt-4o')) {
    return 'gpt-4o';
  }

  // GPT-4-turbo ailesi (gpt-4-turbo-* → gpt-4-turbo)
  if (lower.startsWith('gpt-4-turbo')) {
    return 'gpt-4-turbo';
  }

  // GPT-3.5-turbo ailesi (gpt-3.5-turbo-* → gpt-3.5-turbo)
  if (lower.startsWith('gpt-3.5-turbo')) {
    return 'gpt-3.5-turbo';
  }

  // GPT-4 ailesi (gpt-4-* → gpt-4)
  if (lower.startsWith('gpt-4') && !lower.startsWith('gpt-4o') && !lower.startsWith('gpt-4-turbo')) {
    return 'gpt-4';
  }

  // Claude 3.5 Sonnet ailesi
  if (lower.startsWith('claude-3-5-sonnet') || lower.startsWith('claude-3.5-sonnet')) {
    return 'claude-3-5-sonnet-20241022';
  }

  // Claude 3.5 Haiku ailesi
  if (lower.startsWith('claude-3-5-haiku') || lower.startsWith('claude-3.5-haiku')) {
    return 'claude-3-5-haiku-20241022';
  }

  // Claude 3 Opus ailesi
  if (lower.startsWith('claude-3-opus') || lower.startsWith('claude-3.0-opus')) {
    return 'claude-3-opus-20240229';
  }

  // Llama-3 ailesi - GitHub/groq/nvidia için en yakın eşleşme
  if (lower.startsWith('llama-3')) {
    if (lower.includes('70b')) {
      // Provider'a göre en yaygın 70b varyantı
      return 'llama-3-70b';
    }
    if (lower.includes('8b')) {
      return 'llama-3-8b';
    }
    // Genel llama-3 → en yakın 70b eşleşmesi
    return 'llama-3-70b';
  }

  // Versiyon soneklerini temizle: -2024-08-06, -latest, -turbo, -mini, -0125 gibi pattern'ler
  const versionedPattern = /^(.+?)(?:-\d{4}-\d{2}-\d{2}|-latest|-turbo|-mini|-\d{3,4})$/;
  const match = lower.match(versionedPattern);
  if (match) {
    return match[1] ?? model;
  }

  // Eşleşme bulunamadı, orijinal ismi döndür
  return model;
}

/**
 * Belirli bir LLM çağrısının yaklaşık maliyetini hesaplar.
 *
 * Negatif token değerleri 0'a kırpılır ve uyarı loglanır.
 * Model adı normalize edilir ve versiyon sonekleri temizlenir.
 * Model bulunamazsa provider default veya fallback pricing kullanılır.
 *
 * @param provider - LLM provider adı (openai, anthropic, vb.)
 * @param model - Model adı (gpt-4o, claude-sonnet-4, vb.)
 * @param promptTokens - Kullanılan prompt/input token sayısı
 * @param completionTokens - Kullanılan completion/output token sayısı
 * @returns Tahmini maliyet (USD)
 *
 * @example
 * ```ts
 * calculateCost('openai', 'gpt-4o', 1000, 500);
 * // => 0.0075 (yaklaşık)
 *
 * calculateCost('openai', 'gpt-4o-2024-08-06', 1000, 500);
 * // => 0.0075 (model normalize edilir)
 * ```
 */
export function calculateCost(
  provider: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  // Negatif token değerlerini 0'a kırp
  const safePromptTokens = Math.max(0, promptTokens);
  const safeCompletionTokens = Math.max(0, completionTokens);

  if (safePromptTokens !== promptTokens) {
    logger.warn({ originalValue: promptTokens, provider, model }, '[CostCalculator] Negatif prompt token değeri 0\'a kırpıldı');
  }
  if (safeCompletionTokens !== completionTokens) {
    logger.warn({ originalValue: completionTokens, provider, model }, '[CostCalculator] Negatif completion token değeri 0\'a kırpıldı');
  }

  const breakdown = calculateCostBreakdown(provider, model, safePromptTokens, safeCompletionTokens);
  return breakdown.total;
}

/**
 * Maliyet kırılımını detaylı olarak hesaplar.
 *
 * @param provider - LLM provider adı
 * @param model - Model adı
 * @param promptTokens - Prompt token sayısı
 * @param completionTokens - Completion token sayısı
 * @returns Toplam maliyet, prompt maliyeti, completion maliyeti ve kullanılan fiyat bilgisi
 *
 * @example
 * ```ts
 * calculateCostBreakdown('openai', 'gpt-4o', 1000, 500);
 * // => { total: 0.0075, promptCost: 0.0025, completionCost: 0.005, pricing: {...} }
 * ```
 */
export function calculateCostBreakdown(
  provider: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
): { total: number; promptCost: number; completionCost: number; pricing: ModelPricing } {
  const providerKey = provider?.toLowerCase();
  const normalizedModel = normalizeModelName(model);
  const providerPricing = PRICING_MAP[providerKey];

  // Null-safe model lookup: model undefined/null ise provider default veya fallback kullan
  let modelPricing: ModelPricing;
  if (!normalizedModel || !providerPricing?.[normalizedModel]) {
    modelPricing = providerPricing?.['default'] ?? FALLBACK_PRICING;
  } else {
    modelPricing = providerPricing[normalizedModel];
  }

  const promptCost = (promptTokens / 1000) * modelPricing.promptPer1K;
  const completionCost = (completionTokens / 1000) * modelPricing.completionPer1K;
  const total = Math.round((promptCost + completionCost) * 10000) / 10000;

  return {
    total,
    promptCost: Math.round(promptCost * 10000) / 10000,
    completionCost: Math.round(completionCost * 10000) / 10000,
    pricing: modelPricing,
  };
}

/**
 * Provider'ın desteklediği modellerin fiyat listesini döndürür.
 *
 * @param provider - Provider adı
 * @returns Model adları ve fiyatları
 *
 * @example
 * ```ts
 * getModelPricing('openai');
 * // => { 'gpt-4o': {...}, 'gpt-4o-mini': {...}, ... }
 * ```
 */
export function getModelPricing(provider: string): Record<string, ModelPricing> {
  return PRICING_MAP[provider?.toLowerCase()] ?? {};
}

/**
 * Tüm provider'ların listesini döndürür.
 *
 * @example
 * ```ts
 * getSupportedProviders();
 * // => ['openai', 'anthropic', 'minimax', 'github', 'groq', 'mistral', 'nvidia', 'ollama']
 * ```
 */
export function getSupportedProviders(): string[] {
  return Object.keys(PRICING_MAP);
}
