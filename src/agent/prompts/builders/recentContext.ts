import { makeFragment } from './index.js';
import type { PromptFragment } from '../types.js';

export interface RecentContextInput {
  recentContext: string[];
}

/**
 * Son konuşmalardan alınan bağlam bilgilerini prompt'a dönüştürür.
 * Bellekte kayıtlı değildir ama yanıtları kişiselleştirmek için kullanılır.
 * Priority: 8 (yüksek — güncel bağlam)
 */
export function buildRecentContextFragment(input: RecentContextInput): PromptFragment {
  const { recentContext } = input;

  if (recentContext.length === 0) {
    return makeFragment('recentContext', '', 8);
  }

  let text = '<yakin_gecmis_baglam>\nAşağıdaki bilgiler son konuşmalardan alınmıştır. Bellekte kayıtlı değildir ama yanıtlarını kişiselleştirmek için kullan:\n';
  recentContext.forEach((ctx, i) => {
    text += `${i + 1}. ${ctx}\n`;
  });
  text += '</yakin_gecmis_baglam>\n';

  return makeFragment('recentContext', text, 8);
}
