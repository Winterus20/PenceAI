import { makeFragment } from './index.js';
import type { PromptFragment } from '../types.js';

export interface ArchivalContextInput {
  archivalMemories: string[];
}

/**
 * Uzun süredir erişilmemiş, arşivden geri getirilen bellekleri prompt'a dönüştürür.
 * Doğruluğu belirsiz olabilir — dikkatli kullanılması gerektiği vurgulanır.
 * Priority: 4 (düşük — güvenilirlik en düşük)
 */
export function buildArchivalContextFragment(input: ArchivalContextInput): PromptFragment {
  const { archivalMemories } = input;

  if (archivalMemories.length === 0) {
    return makeFragment('archivalContext', '', 4);
  }

  let text = '<uzak_gecmis_arsiv>\n⚠️ Bu bilgiler uzun süredir erişilmemişti ve arşivden geri getirildi. Doğruluğu belirsiz olabilir — dikkatli kullan:\n';
  archivalMemories.forEach((m, i) => {
    text += `${i + 1}. ${m}\n`;
  });
  text += '</uzak_gecmis_arsiv>\n';

  return makeFragment('archivalContext', text, 4);
}
