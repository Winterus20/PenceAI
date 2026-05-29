import { makeFragment } from './index.js';
import type { PromptFragment } from '../types.js';

export interface FollowUpContextInput {
  followUpMemories: string[];
}

/**
 * Kullanıcının gündemindeki güncel olaylar ve projeleri prompt'a dönüştürür.
 * Proaktif takip için kullanılır — doğrudan gösterilmez, doğal fırsat
 * çıkarsa tek bir soruyla değinilir.
 * Priority: 6 (orta — kişiselleştirme ama dikkatli kullanım)
 */
export function buildFollowUpContextFragment(input: FollowUpContextInput): PromptFragment {
  const { followUpMemories } = input;

  if (followUpMemories.length === 0) {
    return makeFragment('followUpContext', '', 6);
  }

  let text = '<proaktif_takip>\nAşağıdaki konular kullanıcının gündemindeki güncel olaylar ve projelerdir. Bu listeyi asla doğrudan kullanıcıya gösterme veya madde madde sıraya dizme.\nSadece sohbetin akışında gerçekten doğal ve anlamlı bir fırsat çıkarsa, listeden en fazla BİR tanesini seç ve yalnızca tek bir kısa soruyla değin (Örn: "Dünkü toplantın nasıl geçti?").\nKURALLAR:\n- Kullanıcı sadece "selam" veya küçük bir selamlama yazdıysa bu listeyi KULLANMA — sadece samimi bir karşılık ver.\n- Birden fazla konu aynı anda sorma.\n- Olayın zaten tamamlandığı net anlaşılıyorsa tekrar sorma.\n';
  followUpMemories.forEach((m) => {
    text += `- ${m}\n`;
  });
  text += '</proaktif_takip>\n';

  return makeFragment('followUpContext', text, 6);
}
