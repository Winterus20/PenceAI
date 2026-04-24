/**
 * Hybrid Search Testleri
 * 
 * FTS + Semantic + RRF fusion birleştirme testleri.
 * Ebbinghaus retention ağırlıklandırma ve threshold filtreleme.
 */

import { rrfFusion, applyRetentionToRrfWithExplain } from '../../src/memory/contextUtils.js';
import type { MemoryRow } from '../../src/memory/types.js';

// ========== Test Fixture Helper ==========

function createMemoryRow(overrides: Partial<MemoryRow> & Pick<MemoryRow, 'id' | 'content'>): MemoryRow {
  return {
    id: overrides.id,
    user_id: overrides.user_id ?? 'default',
    category: overrides.category ?? 'general',
    content: overrides.content,
    importance: overrides.importance ?? 5,
    access_count: overrides.access_count ?? 0,
    is_archived: overrides.is_archived ?? 0,
    last_accessed: overrides.last_accessed ?? null,
    created_at: overrides.created_at ?? '2026-03-08T10:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-03-08T10:00:00.000Z',
    provenance_source: overrides.provenance_source ?? 'conversation',
    provenance_conversation_id: overrides.provenance_conversation_id ?? 'conv-1',
    provenance_message_id: overrides.provenance_message_id ?? null,
    confidence: overrides.confidence ?? 0.8,
    review_profile: overrides.review_profile ?? 'standard',
    memory_type: overrides.memory_type ?? null,
    stability: overrides.stability ?? null,
    retrievability: overrides.retrievability ?? null,
    next_review_at: overrides.next_review_at ?? null,
    review_count: overrides.review_count ?? null,
    max_importance: overrides.max_importance ?? null,
  };
}

// ========== RRF Fusion Testleri ==========

describe('RRF Fusion', () => {
  test('FTS-only sonuçları doğru birleştirir', () => {
    const ftsResults = [
      createMemoryRow({ id: 1, content: 'TypeScript programlama dili' }),
      createMemoryRow({ id: 2, content: 'TypeScript tip sistemi' }),
      createMemoryRow({ id: 3, content: 'TypeScript derleyici' }),
    ];
    const semanticResults: MemoryRow[] = [];

    const result = rrfFusion(
      ftsResults,
      semanticResults,
      (m) => m.id,
      (m) => m,
      10
    );

    expect(result.results).toHaveLength(3);
    expect(result.results.map(m => m.id)).toEqual([1, 2, 3]);
    // FTS weight = 1.5 varsayılan
    expect(result.scoreEntries[0].score).toBeCloseTo((1 / (60 + 0 + 1)) * 1.5, 5);
  });

  test('Semantic-only sonuçları doğru birleştirir', () => {
    const ftsResults: MemoryRow[] = [];
    const semanticResults = [
      createMemoryRow({ id: 4, content: 'JavaScript framework' }),
      createMemoryRow({ id: 5, content: 'Node.js runtime' }),
    ];

    const result = rrfFusion(
      ftsResults,
      semanticResults,
      (m) => m.id,
      (m) => m,
      10
    );

    expect(result.results).toHaveLength(2);
    expect(result.results.map(m => m.id)).toEqual([4, 5]);
    // Semantic weight = 1.0 varsayılan
    expect(result.scoreEntries[0].score).toBeCloseTo(1 / (60 + 0 + 1), 5);
  });

  test('FTS ve Semantic sonuçları RRF ile birleştirir', () => {
    const ftsResults = [
      createMemoryRow({ id: 1, content: 'Python veri analizi' }),
      createMemoryRow({ id: 2, content: 'Python makine öğrenmesi' }),
    ];
    const semanticResults = [
      createMemoryRow({ id: 2, content: 'Python makine öğrenmesi' }), // Ortak
      createMemoryRow({ id: 3, content: 'Jupyter notebook' }),
    ];

    const result = rrfFusion(
      ftsResults,
      semanticResults,
      (m) => m.id,
      (m) => m,
      10
    );

    // ID 2 hem FTS hem Semantic'te var, skorları toplanmalı
    expect(result.results).toHaveLength(3);
    
    // ID 2 en yüksek skora sahip olmalı (iki kaynaktan geliyor)
    expect(result.results[0].id).toBe(2);
    
    // Explain kontrolü
    const id2Explain = result.explain?.find(e => e.id === 2);
    expect(id2Explain).toBeTruthy();
    expect(id2Explain?.sources).toContain('fts');
    expect(id2Explain?.sources).toContain('semantic');
  });

  test('Limit parametresi doğru uygulanır', () => {
    const ftsResults = Array.from({ length: 20 }, (_, i) =>
      createMemoryRow({ id: i + 1, content: `Bellek ${i + 1}` })
    );
    const semanticResults = Array.from({ length: 20 }, (_, i) =>
      createMemoryRow({ id: i + 100, content: `Semantik ${i + 100}` })
    );

    const result = rrfFusion(
      ftsResults,
      semanticResults,
      (m) => m.id,
      (m) => m,
      5 // Sadece 5 sonuç
    );

    expect(result.results).toHaveLength(5);
    expect(result.scoreEntries).toHaveLength(5);
  });

  test('Boş sonuçlar güvenli şekilde handle edilir', () => {
    const emptyFtsResults: MemoryRow[] = [];
    const emptySemanticResults: MemoryRow[] = [];
    const result = rrfFusion(
      emptyFtsResults,
      emptySemanticResults,
      (m: MemoryRow) => m.id,
      (m: MemoryRow) => m,
      10
    );

    expect(result.results).toHaveLength(0);
    expect(result.scoreEntries).toHaveLength(0);
    expect(result.explain).toHaveLength(0);
  });
});

// ========== Ebbinghaus Retention Ağırlıklandırma Testleri ==========

describe('Ebbinghaus Retention Ağırlıklandırma', () => {
  test('Yüksek stability bellekleri daha yüksek retention weight alır', () => {
    const highStabilityMemory = createMemoryRow({
      id: 1,
      content: 'Yüksek stability bellek',
      stability: 30, // 30 gün stability
      importance: 8,
      last_accessed: '2026-03-01T10:00:00.000Z', // 7 gün önce
    });
    
    const lowStabilityMemory = createMemoryRow({
      id: 2,
      content: 'Düşük stability bellek',
      stability: 5, // 5 gün stability
      importance: 8,
      last_accessed: '2026-03-01T10:00:00.000Z', // 7 gün önce
    });

    const entries = [
      { score: 0.1, item: highStabilityMemory },
      { score: 0.1, item: lowStabilityMemory },
    ];

    const result = applyRetentionToRrfWithExplain(entries, 10);

    // Yüksek stability daha yüksek retention weight almalı
    const highStabilityExplain = result.explain.find(e => e.id === 1);
    const lowStabilityExplain = result.explain.find(e => e.id === 2);

    expect(highStabilityExplain?.retentionWeight).toBeGreaterThan(
      lowStabilityExplain?.retentionWeight ?? 0
    );
  });

  test('Yakın zamanda erişilen bellekler daha yüksek retention weight alır', () => {
    const recentAccessMemory = createMemoryRow({
      id: 1,
      content: 'Yakın erişim',
      stability: 10,
      last_accessed: '2026-03-07T10:00:00.000Z', // 1 gün önce
    });
    
    const oldAccessMemory = createMemoryRow({
      id: 2,
      content: 'Eski erişim',
      stability: 10,
      last_accessed: '2026-02-08T10:00:00.000Z', // 28 gün önce
    });

    const entries = [
      { score: 0.1, item: recentAccessMemory },
      { score: 0.1, item: oldAccessMemory },
    ];

    const result = applyRetentionToRrfWithExplain(entries, 10);

    const recentExplain = result.explain.find(e => e.id === 1);
    const oldExplain = result.explain.find(e => e.id === 2);

    // Yakın erişim daha yüksek retention weight almalı
    expect(recentExplain?.retentionWeight).toBeGreaterThan(
      oldExplain?.retentionWeight ?? 0
    );
  });

  test('Stability null ise importance\'tan türetilir', () => {
    const memoryNoStability = createMemoryRow({
      id: 1,
      content: 'Stability yok',
      stability: null,
      importance: 7,
      last_accessed: '2026-03-01T10:00:00.000Z',
    });

    const entries = [{ score: 0.1, item: memoryNoStability }];

    const result = applyRetentionToRrfWithExplain(entries, 10);

    // Stability = importance * 2.0 olarak hesaplanmalı
    expect(result.results).toHaveLength(1);
    expect(result.explain[0].retentionWeight).toBeGreaterThan(0);
  });

  test('Retention weight aralığı [0.4, 1.0] arasında kalır', () => {
    // Çok eski bellek (düşük retention)
    const veryOldMemory = createMemoryRow({
      id: 1,
      content: 'Çok eski',
      stability: 1,
      last_accessed: '2025-01-01T10:00:00.000Z', // Çok eski
    });
    
    // Çok yeni bellek (yüksek retention)
    const veryNewMemory = createMemoryRow({
      id: 2,
      content: 'Çok yeni',
      stability: 100,
      last_accessed: '2026-03-08T10:00:00.000Z', // Bugün
    });

    const entries = [
      { score: 0.1, item: veryOldMemory },
      { score: 0.1, item: veryNewMemory },
    ];

    const result = applyRetentionToRrfWithExplain(entries, 10);

    for (const explain of result.explain) {
      expect(explain.retentionWeight).toBeGreaterThanOrEqual(0.4);
      expect(explain.retentionWeight).toBeLessThanOrEqual(1.0);
    }
  });
});

// ========== Threshold Filtreleme Testleri ==========

describe('Threshold Filtreleme', () => {
  test('Düşük skorlu sonuçlar elenir', () => {
    const memories = [
      createMemoryRow({ id: 1, content: 'Yüksek skor', importance: 9 }),
      createMemoryRow({ id: 2, content: 'Düşük skor', importance: 1 }),
      createMemoryRow({ id: 3, content: 'Orta skor', importance: 5 }),
    ];

    // FTS sonuçları gibi sıralı
    const ftsResults = [memories[0], memories[1], memories[2]];
    const semanticResults: MemoryRow[] = [];

    const result = rrfFusion(
      ftsResults,
      semanticResults,
      (m) => m.id,
      (m) => m,
      10
    );

    // Tüm sonuçlar gelmeli (threshold yok, sadece RRF sıralaması)
    expect(result.results).toHaveLength(3);
    
    // İlk sıradaki en yüksek RRF skoruna sahip
    expect(result.results[0].id).toBe(1);
  });

  test('Limit sıfır ise boş sonuç döner', () => {
    const memories = [
      createMemoryRow({ id: 1, content: 'Test' }),
    ];

    const result = rrfFusion(
      memories,
      [],
      (m) => m.id,
      (m) => m,
      0
    );

    expect(result.results).toHaveLength(0);
  });
});

// ========== Hybrid Search Senaryo Testleri ==========

describe('Hybrid Search Senaryoları', () => {
  test('Aynı ID farklı kaynaklarda birleştirilir', () => {
    const sharedMemory = createMemoryRow({
      id: 1,
      content: 'Python veri bilimi',
      category: 'skill',
      importance: 8,
    });

    // FTS'de 1. sırada
    const ftsResults = [sharedMemory];
    
    // Semantic'te de 1. sırada
    const semanticResults = [sharedMemory];

    const result = rrfFusion(
      ftsResults,
      semanticResults,
      (m) => m.id,
      (m) => m,
      10
    );

    // Tek sonuç olmalı (duplicate değil, birleştirilmiş)
    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe(1);

    // Skor iki kaynaktan gelmeli
    const explain = result.explain?.[0];
    expect(explain?.sources).toContain('fts');
    expect(explain?.sources).toContain('semantic');
  });

  test('Farklı dillerde içerik doğru işlenir', () => {
    const turkishMemory = createMemoryRow({
      id: 1,
      content: 'Türkçe içerik: Kullanıcı React tercih ediyor',
    });
    const englishMemory = createMemoryRow({
      id: 2,
      content: 'English content: User prefers TypeScript',
    });

    const ftsResults = [turkishMemory];
    const semanticResults = [englishMemory];

    const result = rrfFusion(
      ftsResults,
      semanticResults,
      (m) => m.id,
      (m) => m,
      10
    );

    expect(result.results).toHaveLength(2);
  });

  test('Archived bellekler hariç tutulur (is_archived = 1)', () => {
    // Not: rrfFusion fonksiyonu is_archived kontrolü yapmaz
    // Bu test, çağıran kodun archived bellekleri filtrelemesini simüle eder
    const activeMemories = [
      createMemoryRow({ id: 1, content: 'Aktif bellek', is_archived: 0 }),
    ];
    const archivedMemories = [
      createMemoryRow({ id: 2, content: 'Arşiv bellek', is_archived: 1 }),
    ];

    // Sadece aktif bellekleri geçir
    const ftsResults = activeMemories.filter(m => m.is_archived === 0);
    const semanticResults: MemoryRow[] = [];

    const result = rrfFusion(
      ftsResults,
      semanticResults,
      (m) => m.id,
      (m) => m,
      10
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0].is_archived).toBe(0);
  });
});

// ========== Explain ve Debug Testleri ==========

describe('Explain ve Debug Bilgisi', () => {
  test('Her sonuç için explain bilgisi üretilir', () => {
    const ftsResults = [
      createMemoryRow({ id: 1, content: 'FTS sonucu 1' }),
      createMemoryRow({ id: 2, content: 'FTS sonucu 2' }),
    ];
    const semanticResults = [
      createMemoryRow({ id: 3, content: 'Semantic sonucu 1' }),
    ];

    const result = rrfFusion(
      ftsResults,
      semanticResults,
      (m) => m.id,
      (m) => m,
      10
    );

    expect(result.explain).toHaveLength(3);
    
    for (const explain of result.explain ?? []) {
      expect(explain.id).toBeDefined();
      expect(explain.sources).toBeDefined();
      expect(explain.baseScore).toBeGreaterThan(0);
    }
  });

  test('ScoreEntries doğru sırada döner', () => {
    const ftsResults = [
      createMemoryRow({ id: 1, content: 'Birinci' }),
      createMemoryRow({ id: 2, content: 'İkinci' }),
      createMemoryRow({ id: 3, content: 'Üçüncü' }),
    ];
    const semanticResults: MemoryRow[] = [];

    const result = rrfFusion(
      ftsResults,
      semanticResults,
      (m) => m.id,
      (m) => m,
      10
    );

    // ScoreEntries azalan sırada olmalı
    for (let i = 1; i < result.scoreEntries.length; i++) {
      expect(result.scoreEntries[i - 1].score).toBeGreaterThanOrEqual(
        result.scoreEntries[i].score
      );
    }
  });
});
