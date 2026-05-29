import { makeFragment } from './index.js';
import type { PromptFragment } from '../types.js';

export interface ReviewContextInput {
  reviewMemories: string[];
}

/**
 * Hatırlatma gerektiren (Ebbinghaus unutkanlık eğrisine göre düşen) bellekleri
 * prompt'a dönüştürür.
 * Priority: 5 (orta — doğal fırsat çıkarsa değinilir)
 */
export function buildReviewContextFragment(input: ReviewContextInput): PromptFragment {
  const { reviewMemories } = input;

  if (reviewMemories.length === 0) {
    return makeFragment('reviewContext', '', 5);
  }

  let text = '<hatirlatma_gerektiren_bilgiler>\nBu bilgilerin hatırlanma oranı düşüyor. Konuşmada doğal bir fırsat çıkarsa bunlara hafifçe değin:\n';
  reviewMemories.forEach((m, i) => {
    text += `${i + 1}. ${m}\n`;
  });
  text += '</hatirlatma_gerektiren_bilgiler>\n';

  return makeFragment('reviewContext', text, 5);
}
