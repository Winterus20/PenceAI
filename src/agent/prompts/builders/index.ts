import type { PromptFragment, ComposeResult } from '../types.js';
import { estimateTokens } from '../types.js';
import { logger } from '../../../utils/index.js';

/**
 * Prompt fragment'larını önceliğe göre sıralar, token bütçesine göre kırpar
 * ve birleştirir.
 *
 * Algoritma:
 * 1. Boş text'li fragment'ları filtrele
 * 2. Önceliğe göre sırala (yüksek → düşük)
 * 3. Sırayla ekle, bütçe aşılınca dur ve kalan düşük önceliklileri at
 * 4. Atılanları logla (observability)
 *
 * NOT: Priority 10 olanlar "zorunlu" değildir — sadece sıralamada ilk sırada
 * oldukları için bütçeye sığma olasılıkları yüksektir. Eğer base prompt bile
 * bütçeyi tek başına aşıyorsa, düşük öncelikliler atılır.
 *
 * @param fragments Birleştirilecek prompt parçaları
 * @param maxTotalTokens Maksimum token bütçesi (varsayılan: 6000)
 * @returns ComposeResult { prompt, usedTokens, droppedFragments }
 */
export function composePrompt(
  fragments: PromptFragment[],
  maxTotalTokens: number = 6000,
): ComposeResult {
  const nonEmpty = fragments.filter(f => f.text.trim().length > 0);

  const sorted = [...nonEmpty].sort((a, b) => b.priority - a.priority);

  const included: PromptFragment[] = [];
  const dropped: string[] = [];
  let usedTokens = 0;

  for (const fragment of sorted) {
    if (usedTokens + fragment.estimatedTokens <= maxTotalTokens) {
      included.push(fragment);
      usedTokens += fragment.estimatedTokens;
    } else {
      dropped.push(fragment.id);
    }
  }

  const finalPrompt = included.map(f => f.text).join('\n');

  if (dropped.length > 0) {
    logger.info({
      msg: '[PromptComposer] Token bütçesi aşıldı, düşük öncelikli parçalar atlandı',
      droppedFragments: dropped,
      usedTokens,
      maxTotalTokens,
    });
  }

  return {
    prompt: finalPrompt,
    usedTokens,
    droppedFragments: dropped,
  };
}

/**
 * composePrompt'un "bütçesiz" versiyonu — tüm fragment'ları öncelik sırasına
 * göre birleştirir ama hiçbirini atmaz. Sadece sıralama ve birleştirme yapar.
 *
 * Kullanım: Token bütçesi henüz bilinmediğinde veya contextPreparer gibi
 * bütçeyi dışarıdan yöneten bir katmanla birlikte çalışırken.
 */
export function composePromptUnlimited(fragments: PromptFragment[]): {
  prompt: string;
  totalTokens: number;
} {
  const nonEmpty = fragments.filter(f => f.text.trim().length > 0);
  const sorted = [...nonEmpty].sort((a, b) => b.priority - a.priority);

  const prompt = sorted.map(f => f.text).join('\n');
  const totalTokens = sorted.reduce((sum, f) => sum + f.estimatedTokens, 0);

  return { prompt, totalTokens };
}

/**
 * Bir metin parçasını PromptFragment'a dönüştürür.
 * @param id Fragment kimliği
 * @param text Metin
 * @param priority Öncelik (1-10)
 */
export function makeFragment(id: string, text: string, priority: number): PromptFragment {
  return {
    id,
    text,
    estimatedTokens: estimateTokens(text),
    priority,
  };
}
