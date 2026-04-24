import { describe, it, expect } from '@jest/globals';
import { exportToMarkdown, exportToObsidian } from '../../../src/memory/wiki/export.js';
import type { ExportMemoryRow } from '../../../src/memory/wiki/types.js';

function makeMemories(): ExportMemoryRow[] {
  return [
    { id: 1, content: 'Yigit Python sever', category: 'preference', importance: 5, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-02T00:00:00Z' },
    { id: 2, content: 'Yigit Rust sever', category: 'preference', importance: 4, created_at: '2024-01-03T00:00:00Z', updated_at: '2024-01-04T00:00:00Z' },
    { id: 3, content: 'Proje X 2024 Q1 tamamlandı', category: 'timeline', importance: 3, created_at: '2024-02-01T00:00:00Z', updated_at: '2024-02-01T00:00:00Z' },
  ];
}

describe('exportToMarkdown', () => {
  it('renders grouped markdown', () => {
    const md = exportToMarkdown(makeMemories());
    expect(md).toContain('# PenceAI Memory Export');
    expect(md).toContain('## preference');
    expect(md).toContain('## timeline');
    expect(md).toContain('Yigit Python sever');
    expect(md).toContain('Yigit Rust sever');
    expect(md).toContain('Proje X 2024 Q1 tamamlandı');
  });

  it('renders empty state', () => {
    const md = exportToMarkdown([]);
    expect(md).toContain('No memories found');
  });
});

describe('exportToObsidian', () => {
  it('returns files with YAML frontmatter', () => {
    const { files } = exportToObsidian(makeMemories());
    expect(files.length).toBeGreaterThanOrEqual(3); // README + categories

    const readme = files.find((f) => f.filename === 'README.md');
    expect(readme).toBeDefined();
    expect(readme!.content).toContain('Categories');

    const pref = files.find((f) => f.filename === 'preference.md');
    expect(pref).toBeDefined();
    expect(pref!.content).toContain('---');
    expect(pref!.content).toContain('category:');
    expect(pref!.content).toContain('memory_count:');
  });

  it('escapes special YAML characters', () => {
    const memories: ExportMemoryRow[] = [
      { id: 4, content: 'Contains "quotes" and: colons', category: 'special:chars', importance: 1, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' },
    ];
    const { files } = exportToObsidian(memories);
    const catFile = files.find((f) => f.filename === 'special_chars.md');
    expect(catFile).toBeDefined();
    expect(catFile!.content).toContain('"special:chars"');
  });
});
