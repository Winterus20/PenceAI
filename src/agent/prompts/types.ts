/**
 * Prompt builder'lar için ortak tip tanımları.
 *
 * Her context bloğu bir PromptFragment döndürür.
 * composePrompt() bu parçaları önceliğe göre sıralar,
 * token bütçesine göre kırpar ve birleştirir.
 */

/**
 * Tek bir prompt parçasının yapısı.
 */
export interface PromptFragment {
  /** Prompt metni (boş string = bu parça atlanacak) */
  text: string;
  /** Bu parçanın tahmini token sayısı (karakter/4 heuristiği) */
  estimatedTokens: number;
  /** Öncelik: 1-10 arası. Token bütçesi aşıldığında düşük öncelikliler atılır. */
  priority: number;
  /** Parça tanımlayıcı (debug/metrics/log için) */
  id: string;
}

/**
 * Builder fonksiyonların ortak imzası.
 * Her builder kendi context tipini alır ve PromptFragment döndürür.
 */
export type PromptBuilder<TContext = unknown> = (context: TContext) => PromptFragment;

/**
 * composePrompt() sonucu.
 */
export interface ComposeResult {
  /** Birleştirilmiş final prompt metni */
  prompt: string;
  /** Kullanılan toplam token sayısı */
  usedTokens: number;
  /** Bütçe yetersizliğinden atılan parçaların id'leri */
  droppedFragments: string[];
}

/**
 * Token tahmini için hybrid strateji:
 * - Fragment seviyesinde: karakter/4 (hızlı, yaklaşık)
 * - Final seviyesinde: gpt-tokenizer ile doğru sayım
 */
export const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
