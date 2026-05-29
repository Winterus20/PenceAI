import { makeFragment } from './index.js';
import type { PromptFragment } from '../types.js';

export interface TelescopicSummary {
  id: number;
  summary: string;
  level: number;
  created_at: string;
  end_msg_id: number;
}

export interface TelescopicContextInput {
  telescopicSummaries: TelescopicSummary[];
}

/**
 * Teleskopik konuşma özetlerini prompt'a dönüştürür.
 * Uzun konuşmaların sıkıştırılmış kısımlarını içerir.
 * Ayrıca history'den hangi mesajların atılacağını belirlemek için
 * maxEndMsgId'yi de döndürür.
 * Priority: 5 (orta — eski konuşma bağlamı)
 */
export function buildTelescopicContextFragment(input: TelescopicContextInput): PromptFragment & { maxEndMsgId: number } {
  const { telescopicSummaries } = input;

  if (!telescopicSummaries || telescopicSummaries.length === 0) {
    return { text: '', estimatedTokens: 0, priority: 5, id: 'telescopicContext', maxEndMsgId: 0 };
  }

  let text = `\n\n## Önceki Konuşma Özetleri (Teleskopik)\nAşağıdaki özetler, bu konuşmanın daha eski ve sıkıştırılmış kısımlarını içerir:\n\n`;
  let maxEndMsgId = 0;

  for (const sum of telescopicSummaries) {
    text += `[Seviye ${sum.level} Özet]: ${sum.summary}\n`;
    if (sum.end_msg_id > maxEndMsgId) {
      maxEndMsgId = sum.end_msg_id;
    }
  }

  // NOT: makeFragment() yerine manuel oluşturuyoruz çünkü
  // maxEndMsgId alanını PromptFragment'e eklememiz gerekiyor.
  // Normal builder'lar sadece PromptFragment döndürür, bu ise
  // PromptFragment & { maxEndMsgId: number } döndürür.
  return {
    text,
    estimatedTokens: Math.ceil(text.length / 4),
    priority: 5,
    id: 'telescopicContext',
    maxEndMsgId,
  };
}
