/**
 * Provider ve model bazlı token maliyet hesaplama.
 * Fiyatlar yaklaşık değerlerdir (2026 Nisan), gerçek fatura ile tam eşleşmeyebilir.
 * Birimler: $/1K tokens (bin token başına dolar).
 */

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
 * Belirli bir LLM çağrısının yaklaşık maliyetini hesaplar.
 *
 * @param provider - LLM provider adı (openai, anthropic, vb.)
 * @param model - Model adı (gpt-4o, claude-sonnet-4, vb.)
 * @param promptTokens - Kullanılan prompt/input token sayısı
 * @param completionTokens - Kullanılan completion/output token sayısı
 * @returns Tahmini maliyet (USD)
 */
export function calculateCost(
  provider: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const providerPricing = PRICING_MAP[provider?.toLowerCase()];
  const modelPricing = providerPricing?.[model] ?? providerPricing?.['default'] ?? FALLBACK_PRICING;

  const promptCost = (promptTokens / 1000) * modelPricing.promptPer1K;
  const completionCost = (completionTokens / 1000) * modelPricing.completionPer1K;

  return Math.round((promptCost + completionCost) * 10000) / 10000; // 4 ondalık hassasiyet
}

/**
 * Provider'ın desteklediği modellerin fiyat listesini döndürür.
 *
 * @param provider - Provider adı
 * @returns Model adları ve fiyatları
 */
export function getModelPricing(provider: string): Record<string, ModelPricing> {
  return PRICING_MAP[provider?.toLowerCase()] ?? {};
}

/**
 * Tüm provider'ların listesini döndürür.
 */
export function getSupportedProviders(): string[] {
  return Object.keys(PRICING_MAP);
}
