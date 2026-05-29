import { makeFragment } from './index.js';
import type { PromptFragment } from '../types.js';

export interface MemoryRelation {
  source: string;
  target: string;
  relation: string;
  description: string;
}

export interface MemoryContextInput {
  memories: string[];
  memoryRelations?: MemoryRelation[];
}

const RELATION_LABELS: Record<string, string> = {
  'related_to': '↔ ilişkili',
  'supports': '→ destekliyor',
  'contradicts': '⚡ çelişiyor',
  'caused_by': '← nedeniyle',
  'part_of': '⊂ parçası',
};

/**
 * Kullanıcı bellekleri ve bellek ilişkilerini prompt'a dönüştürür.
 * Priority: 9 (yüksek — kişiselleştirme için kritik)
 */
export function buildMemoryContextFragment(input: MemoryContextInput): PromptFragment {
  const { memories, memoryRelations = [] } = input;

  if (memories.length === 0 && memoryRelations.length === 0) {
    return makeFragment('memoryContext', '', 9);
  }

  let text = '<kullanici_hakkinda>\n';
  memories.forEach((m, i) => {
    text += `${i + 1}. ${m}\n`;
  });

  if (memoryRelations.length > 0) {
    text += '\n<bilgiler_arasi_baglantilar>\n';
    for (const rel of memoryRelations) {
      const label = RELATION_LABELS[rel.relation] || rel.relation;
      const desc = rel.description ? ` (${rel.description})` : '';
      text += `- "${rel.source}" ${label} "${rel.target}"${desc}\n`;
    }
    text += '\n[Tree of Thoughts] Bu bağlantıları kullanarak bilgiler arasında çıkarım yap. A\'dan B\'ye ve B\'den C\'ye olan bağlantıları takip ederek ("Multi-hop" zincirler) adım adım mantıksal sonuçlara ulaş.\n';
    text += '</bilgiler_arasi_baglantilar>\n';
  }

  text += '</kullanici_hakkinda>\n';

  return makeFragment('memoryContext', text, 9);
}
