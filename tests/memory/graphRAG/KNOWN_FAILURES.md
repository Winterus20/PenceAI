# GraphRAG Bilinen Başarısız Testler

Bu dosya, GraphRAG test suite'inde başarısız olan testleri ve çözüm önerilerini içerir.

---

## 1. CommunityDetector - Veritabanı Hatası Testi

**Dosya:** [`tests/memory/graphRAG/CommunityDetector.test.ts`](tests/memory/graphRAG/CommunityDetector.test.ts)

**Test Adı:** `"Veritabanı hatasında boş community listesi döner"`

### Hata
```
SqliteError: no such table: memories
```

### Kök Sebep
Test mock database'inde `memories` tablosu oluşturulmamış. `CommunityDetector.detectCommunities()` metodu `memories` tablosuna sorgu yapmaya çalışıyor, ancak mock database'de bu tablo yok.

### Çözüm Önerisi
Test setup'ında (`beforeEach` bloğunda) `memories` tablosunu oluştur:

```typescript
beforeEach(() => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      archived INTEGER DEFAULT 0
    )
  `);
});
```

### Öncelik: ORTA
Bu test, error handling davranışını test ediyor. Production'da veritabanı hatası durumunda graceful degradation önemli.

---

## 2. Performance - Linear Scaling Testi

**Dosya:** [`tests/memory/graphRAG/performance.test.ts`](tests/memory/graphRAG/performance.test.ts)

**Test Adı:** `"Linear scaling: 2x node → ~2x süre"`

### Hata
```
expect(received).toBeLessThan(expected)

Expected: < 5
Received: 7
```

### Kök Sebep
Test, 100 node'dan 200 node'a çıkışta sürenin 2x artmasını bekliyor (5ms altı). Ancak gerçek performans 7ms, yani scaling ratio beklenenden yüksek. Bu, algoritmanın O(n²) veya daha karmaşık bir scaling gösterdiğine işaret edebilir.

### Çözüm Önerisi

**Seçenek A: Test Eşiğini Gevşet**
```typescript
// Eski: expect(ratio).toBeLessThan(5);
// Yeni:
expect(ratio).toBeLessThan(8);
```

**Seçenek B: Algoritmayı Optimize Et**
- PageRankScorer'da sparse matrix kullan
- CommunityDetector'da sampling stratejisini iyileştir
- GraphExpander'da visited set'ini optimize et

**Seçenek C: Test'i Skip Et (Geçici)**
```typescript
test.skip('Linear scaling: 2x node → ~2x süre', async () => {
  // TODO: Algoritma optimizasyonu sonrası tekrar aktif et
});
```

### Öncelik: DÜŞÜK
Bu bir correctness hatası değil, performance karakteristiği. Production'da 7ms vs 5ms farkı ihmal edilebilir. Ancak büyük graph'lerde (10K+ node) bu scaling sorunu büyüyebilir.

---

## Son Güncelleme

**Tarih:** 2026-04-04
**Test Durumu:** 435/437 geçiyor (%99.54 başarı oranı)
**Toplam Başarısız:** 2 test
