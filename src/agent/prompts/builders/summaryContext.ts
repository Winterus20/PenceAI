import { makeFragment } from './index.js';
import type { PromptFragment } from '../types.js';

export interface ConversationSummary {
  title: string;
  summary: string;
  updated_at: string;
}

export interface SummaryContextInput {
  conversationSummaries: ConversationSummary[];
}

const MAX_SUMMARY_CHARS = 2800;

/**
 * Geçmiş konuşma özetlerini prompt'a dönüştürür.
 * Karakter limiti uygular (2800 char ≈ 800 token).
 * Priority: 7 (orta-yüksek)
 */
export function buildSummaryContextFragment(input: SummaryContextInput): PromptFragment {
  const { conversationSummaries } = input;

  if (conversationSummaries.length === 0) {
    return makeFragment('summaryContext', '', 7);
  }

  let usedChars = 0;
  const lines: string[] = [];

  for (const s of conversationSummaries) {
    const dateStr = s.updated_at.endsWith('Z') ? s.updated_at : s.updated_at.replace(' ', 'T') + 'Z';
    const date = new Date(dateStr).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short' });
    const title = s.title ? `"${s.title}"` : 'Başlıksız konuşma';
    const line = `- [${date}] ${title}: ${s.summary}`;
    if (usedChars + line.length > MAX_SUMMARY_CHARS) break;
    lines.push(line);
    usedChars += line.length;
  }

  if (lines.length === 0) {
    return makeFragment('summaryContext', '', 7);
  }

  let text = '<gecmis_konusma_ozetleri>\nAşağıdaki özetler daha önceki konuşmaların ne hakkında olduğunu gösterir. Bağlam olarak kullan:\n';
  lines.forEach(line => { text += `${line}\n`; });
  text += '</gecmis_konusma_ozetleri>\n';

  return makeFragment('summaryContext', text, 7);
}
