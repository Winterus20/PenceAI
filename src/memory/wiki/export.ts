/**
 * Wiki Export — Bellekleri Markdown ve Obsidian formatlarına dönüştürür.
 */

import type { ExportMemoryRow, ObsidianFile } from './types.js';

function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 100);
}

function escapeYaml(value: string): string {
  if (/[\n'"#:]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

/**
 * Bellek listesini kategoriye göre gruplandırıp tek bir Markdown string'e döker.
 */
export function exportToMarkdown(memories: ExportMemoryRow[]): string {
  if (memories.length === 0) {
    return '# PenceAI Memory Export\n\n_No memories found._\n';
  }

  const byCategory = new Map<string, ExportMemoryRow[]>();
  for (const m of memories) {
    const cat = m.category || 'general';
    const list = byCategory.get(cat) ?? [];
    list.push(m);
    byCategory.set(cat, list);
  }

  const lines: string[] = ['# PenceAI Memory Export\n'];
  for (const [category, items] of byCategory) {
    lines.push(`## ${category}\n`);
    for (const item of items) {
      const date = item.updated_at ? new Date(item.updated_at).toISOString().split('T')[0] : 'unknown';
      lines.push(`- **${date}** (importance: ${item.importance}) — ${item.content}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Her kategori bir dosya; YAML frontmatter ile Obsidian vault formatı.
 */
export function exportToObsidian(memories: ExportMemoryRow[]): { files: ObsidianFile[] } {
  if (memories.length === 0) {
    return {
      files: [
        {
          filename: 'README.md',
          content: '# PenceAI Memory Export\n\n_No memories found._\n',
        },
      ],
    };
  }

  const byCategory = new Map<string, ExportMemoryRow[]>();
  for (const m of memories) {
    const cat = m.category || 'general';
    const list = byCategory.get(cat) ?? [];
    list.push(m);
    byCategory.set(cat, list);
  }

  const files: ObsidianFile[] = [];
  for (const [category, items] of byCategory) {
    const lines: string[] = [
      '---',
      `category: ${escapeYaml(category)}`,
      `memory_count: ${items.length}`,
      `generated_at: ${new Date().toISOString()}`,
      '---',
      '',
      `# ${category}\n`,
    ];

    for (const item of items) {
      const date = item.updated_at ? new Date(item.updated_at).toISOString().split('T')[0] : 'unknown';
      lines.push(`- **${date}** (importance: ${item.importance}) — ${item.content}`);
    }
    lines.push('');

    files.push({
      filename: `${sanitizeFilename(category)}.md`,
      content: lines.join('\n'),
    });
  }

  // Index dosyası
  const indexLines: string[] = [
    '# PenceAI Memory Export',
    '',
    '## Categories',
    '',
  ];
  for (const category of byCategory.keys()) {
    indexLines.push(`- [[${sanitizeFilename(category)}]]`);
  }
  files.unshift({
    filename: 'README.md',
    content: indexLines.join('\n'),
  });

  return { files };
}
