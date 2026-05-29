import { makeFragment } from './index.js';
import type { PromptFragment } from '../types.js';

export interface GraphRAGContextInput {
  shouldAdd: boolean;
  communitySummariesFormatted: string | null;
}

/**
 * GraphRAG topluluk özetlerini prompt'a dönüştürür.
 * Kullanıcının bellek grafiğinden otomatik olarak çıkarılmış topluluk bağlamı.
 * Priority: 6 (orta — zengin bağlam ama zorunlu değil)
 */
export function buildGraphRAGContextFragment(input: GraphRAGContextInput): PromptFragment {
  const { shouldAdd, communitySummariesFormatted } = input;

  if (!shouldAdd || !communitySummariesFormatted) {
    return makeFragment('graphRAGContext', '', 6);
  }

  const text = `\n\n## GraphRAG Community Context\nAşağıdaki topluluk özetleri, kullanıcının bellek grafiğinden otomatik olarak çıkarılmıştır:\n${communitySummariesFormatted}`;

  return makeFragment('graphRAGContext', text, 6);
}
