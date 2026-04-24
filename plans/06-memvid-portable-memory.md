# PenceAI — Memvid Portable Memory Format Implementation Plan

> **Tarih:** 24 Nisan 2026
> **Kaynak:** [`FUTURE_IMPLEMENTATION_PLAN.md`](FUTURE_IMPLEMENTATION_PLAN.md) Madde 4, [memvid GitHub](https://github.com/memvid/memvid)
> **Öncelik:** 🟡 ORTA
> **Tahmini Süre:** 2-3 hafta
> **Zorluk:** ⭐⭐⭐

---

## [Goal Description]

PenceAI'nin SQLite tabanlı bellek ekosistemini (memories, messages, graph, embeddings) tek dosyalı, taşınabilir, append-only bir format üzerinden export/import edilebilir hale getirmek. Memvid'in Smart Frame veri modeli, deterministic snapshot/time-travel ve segment-based indexing yeteneklerini mevcut mimariye (SQLite + sqlite-vec + GraphRAG) adapte etmek.

---

## User Review Required

> [!IMPORTANT]
> **Export Kapsamı Kararı:** PenceAI'de bellek sistemi sadece `memories` tablosundan ibaret değil. `conversations`, `messages`, `memory_relations`, `memory_entities`, `memory_embeddings` (sqlite-vec) ve `graph_communities` tabloları da var. Plan taslakta "tam bellek durumu" export'unu öneriyor ancak bu dosya boyutunu çok büyütebilir. İki mod (`full` vs `memories-only`) mu sunulsun?
>
> **Format Seçimi:** Memvid orijinali binary `.mv2` (4KB header + embedded WAL + HNSW index). PenceAI'nin mevcut stack'i (Node.js + SQLite) binary format üretmek yerine JSON/JSONLines + gzip ile daha uyumlu çalışabilir. Format seçimi tüm fazları etkiler.

> [!WARNING]
> **Embedding Taşınabilirliği:** sqlite-vec `vec0` tablolarındaki float dizilerini harici formata aktarmak, boyut olarak (1536-dim × 4 byte × kayıt sayısı) çok maliyetli olabilir. Embedding'ler export'a dahil edilirse `.mv2` dosyası yüz MB'lara ulaşabilir.

> [!CAUTION]
> **Snapshot & WAL Position:** Mevcut `database.ts` zaten WAL modunda (`journal_mode = WAL`). Deterministic time-travel için SQLite'un kendi WAL snapshot'ı mı kullanılacak, yoksa uygulama seviyesinde `frameChecksums` ile bir snapshot layer mı inşa edilecek? Bu karar snapshot bütünlüğünü etkiler.

---

## Proposed Changes

### Yeni Modül: `src/memory/portable/`

Tüm portable memory işlemlerini (export, import, snapshot, segment) kapsayan yeni modül.

#### [NEW] `src/memory/portable/types.ts`

Smart Frame adaptasyonu — memvid konseptini PenceAI'nin `MemoryRow`, `MemoryRelationRow`, `MemoryEntityRow` tiplerine uyarlar.

```typescript
// SmartFrame: Self-contained, değişmez bellek birimi
interface SmartFrame {
  id: string;                       // memories.id → string/UUID
  timestamp: number;                // created_at → epoch ms
  content: string;
  metadata: FrameMetadata;
  embedding?: number[];             // sqlite-vec → float[] (opsiyonel)
  relations: FrameRelation[];       // memory_relations → normalized
  checksum: string;                 // SHA-256(content + metadata JSON)
}

interface FrameMetadata {
  category: string;
  importance: number;
  memoryType: 'episodic' | 'semantic';
  provenance?: {
    source: string;
    conversationId?: string;
    messageId?: number;
  };
  confidence?: number;
  reviewProfile?: string;
  stability?: number;
  retrievability?: number;
  nextReviewAt?: number;
  reviewCount?: number;
  maxImportance?: number;
  accessCount: number;
  isArchived: boolean;
  updatedAt: number;
}

interface FrameRelation {
  targetFrameId: string;
  type: string;
  confidence: number;
  description: string;
  weight?: number;
}

// Export/Import ana veri yapısı
interface PortableMemoryFile {
  version: 'penceai-memvid-1.0.0';
  createdAt: number;
  generator: string;                // "PenceAI x.y.z"
  exportMode: 'memories-only' | 'full';
  frames: SmartFrame[];
  graphSnapshot?: {
    entities: Array<{
      id: string;
      name: string;
      type: string;
      normalizedName: string;
    }>;
    communityIds: string[];
  };
  segments?: MemorySegment[];
  checksum: string;                 // Tüm dosya integrity (SHA-256)
}

interface MemorySegment {
  id: string;
  name: string;
  frameIds: string[];
  createdAt: number;
  updatedAt: number;
}

interface MemorySnapshot {
  id: string;
  label: string;
  timestamp: number;
  walPosition: number;              // SQLite WAL frame no (opsiyonel)
  frameChecksums: Map<string, string>;
  totalFrames: number;
}

interface ImportResult {
  importedCount: number;
  skippedCount: number;
  conflictCount: number;
  conflicts: FrameConflict[];
}

interface FrameConflict {
  frameId: string;
  reason: 'checksum_mismatch' | 'duplicate_id' | 'invalid_relation_target';
  existingChecksum: string;
  incomingChecksum: string;
}

interface ExportFilter {
  categories?: string[];
  memoryTypes?: ('episodic' | 'semantic')[];
  dateFrom?: number;
  dateTo?: number;
  includeArchived?: boolean;
  includeEmbeddings?: boolean;
}
```

#### [NEW] `src/memory/portable/exporter.ts`

- `exportAllMemories(filter?: ExportFilter): Promise<PortableMemoryFile>`
- `exportToFile(path: string, file: PortableMemoryFile): Promise<void>` (gzip opsiyonel)
- `exportStream(filter?: ExportFilter): ReadableStream<Uint8Array>` — büyük veri setleri için chunked stream

**Detay:**
- SQLite'dan `memories` + `memory_relations` + `memory_entities` çek
- `MemoryRow` → `SmartFrame` dönüştür
- Her frame için SHA-256 checksum hesapla
- Toplam dosya checksum'ı üret
- Gzip compression (opsiyonel, config'den)

#### [NEW] `src/memory/portable/importer.ts`

- `importFromFile(path: string): Promise<ImportResult>`
- `importFromData(file: PortableMemoryFile): Promise<ImportResult>`
- `mergeOrReplace(file: PortableMemoryFile, strategy: 'upsert' | 'replace' | 'skip'): Promise<ImportResult>`

**Conflict Resolution:**
- `checksum` çakışması varsa `updatedAt` karşılaştır
- Eksik `relation.targetFrameId` varsa relation atla (orphan relation koruma)
- Batch INSERT transaction içinde yap

#### [NEW] `src/memory/portable/snapshot.ts`

- `createSnapshot(label: string): Promise<MemorySnapshot>`
- `restoreSnapshot(snapshotId: string): Promise<void>`
- `listSnapshots(): Promise<MemorySnapshot[]>`
- `deleteSnapshot(snapshotId: string): Promise<boolean>`

**Detay:**
SQLite `wal_checkpoint(TRUNCATE)` sonrası:
1. Tüm aktif `memories` frame'lerini checksum'la
2. `memory_snapshots` tablosuna metadata kaydet
3. Snapshot dosyasını `snapshots/<id>.json` olarak kaydet

#### [NEW] `src/memory/portable/segmenter.ts`

- `createSegment(name: string, frameIds: string[]): Promise<MemorySegment>`
- `searchInSegment(segmentId: string, query: string): Promise<SmartFrame[]>` — FTS5 fallback
- `autoSegmentByTime(periodMs: number): Promise<MemorySegment[]>` — zaman dilimi bazlı gruplama
- `autoSegmentByCategory(): Promise<MemorySegment[]>` — kategori bazlı gruplama

#### [NEW] `src/memory/portable/integrity.ts`

- `verifyFile(file: PortableMemoryFile): boolean` — checksum doğrulama
- `verifyFrame(frame: SmartFrame): boolean` — frame-level checksum
- `repairOrphans(file: PortableMemoryFile): PortableMemoryFile` — eksik relation target'larını temizle

---

### Mevcut Dosya Değişiklikleri

#### [MODIFY] `src/memory/database.ts`

- `memories` tablosuna `frame_id TEXT` (opsiyonel) kolonu ekle — dışarıdan import edilen frame'lerin orijinal ID'sini korumak için
- `memory_snapshots` tablosu ekle:
  ```sql
  CREATE TABLE IF NOT EXISTS memory_snapshots (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    wal_position INTEGER,
    total_frames INTEGER NOT NULL,
    checksum TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  ```
- Migration: `LATEST_SCHEMA_VERSION` 19 → 20

#### [MODIFY] `src/gateway/routes.ts`

Yeni REST endpoint'leri:

| Method | Route | Açıklama |
|--------|-------|----------|
| POST | `/api/memory/export` | Bellekleri export et (body: `ExportFilter`) |
| POST | `/api/memory/import` | Bellek dosyası import et (multipart/form-data) |
| POST | `/api/memory/snapshot` | Snapshot oluştur (body: `{ label: string }`) |
| GET | `/api/memory/snapshots` | Snapshot listesi |
| POST | `/api/memory/snapshot/:id/restore` | Snapshot'a geri dön |
| DELETE | `/api/memory/snapshot/:id` | Snapshot sil |
| GET | `/api/memory/segments` | Segment listesi |

#### [MODIFY] `src/gateway/config.ts` + `.env.example`

```env
# Memvid Portable Memory Format
ENABLE_MEMVID_EXPORT=true
MEMVID_EXPORT_COMPRESS=gzip              # none | gzip
MEMVID_EXPORT_INCLUDE_EMBEDDINGS=false   # true = dosya büyük, false = import'ta yeniden hesapla
MEMVID_MAX_EXPORT_SIZE_MB=500
MEMVID_SNAPSHOT_RETENTION_DAYS=30
MEMVID_IMPORT_STRATEGY=upsert            # upsert | replace | skip
```

```typescript
// src/gateway/config.ts'e eklenecek
enableMemvidExport: boolean;
memvidExportCompress: 'none' | 'gzip';
memvidExportIncludeEmbeddings: boolean;
memvidMaxExportSizeMb: number;
memvidSnapshotRetentionDays: number;
memvidImportStrategy: 'upsert' | 'replace' | 'skip';
```

---

## Analysis and Alternatives

### Format Seçenekleri

| Seçenek | Artıları | Eksileri | PenceAI Uyumu |
|---------|----------|----------|---------------|
| **JSON + gzip** (Önerilen) | İnsan-okunabilir, Node.js native, kolay debug | Dosya boyutu binary'e göre ~2x | ✅ Mevcut stack ile uyumlu |
| **Binary .mv2** (Memvid orijinal) | En kompakt, embedded WAL, HNSW index | Node.js'de üretim karmaşık, parser gerekir | 🆕 Başlangıçta gereksiz |
| **JSONLines (.jsonl)** | Streaming için ideal, satır satır okuma | Tek frame okumak zor, checksum zor | 🟡 İkinci fazda değerlendir |
| **SQLite copy** | Birebir veri bütünlüğü, zero conversion | Taşınabilir değil (sqlite-vec bağımlı), büyük dosya | ❌ Memvid amacına aykırı |

**Karar:** Faz 1'de JSON + gzip ile başlanır. İleride binary `.mv2` desteği eklenebilir (plugin/adapter pattern ile).

### Embedding Dahil/Exclude

| Senaryo | Dosya Boyutu (10K kayıt) | Import Süresi | Uygunluk |
|---------|--------------------------|---------------|----------|
| Include embeddings | ~60-80 MB | Anlık | Büyük yedekler, cross-device taşıma |
| Exclude embeddings | ~2-5 MB | +2-3 dk (yeniden hesaplama) | Günlük export, paylaşım |

**Karar:** Varsayılan `exclude`. Config'den `include` yapılabilir.

---

## Open Questions

1. **Export Kapsamı:** `full` (her şey) ve `memories-only` (sadece bellekler + ilişkiler) olarak iki mod sunulsun mu?

2. **Format:** Faz 1'de JSON + gzip mi, yoksa binary `.mv2` mü? (Öneri: JSON + gzip)

3. **Embedding Dahil mi?** Varsayılan `false` (exclude), config'den `true` yapılabilir mi?

4. **Snapshot Stratejisi:** SQLite `wal_checkpoint(TRUNCATE)` + uygulama seviyesi frame hash manifesti mi, yoksa dosya seviyesinde `db.copy()` + manifest mi?

5. **Import Çakışma:** Aynı `frame_id` ile içerik farklıysa (kullanıcı dışarıda edit etmiş olabilir) `upsert` (üzerine yaz), `append` (yeni frame olarak ekle), `manual` (çakışma raporu üret) — hangisi varsayılan olsun?

---

## Verification Plan

### Automated Tests

- [ ] `portable/exporter.test.ts` — Export sonucu schema validasyonu, checksum doğruluğu, gzip çıktısı
- [ ] `portable/importer.test.ts` — Import + conflict resolution testleri, batch insert doğruluğu
- [ ] `portable/snapshot.test.ts` — Snapshot oluşturma, restore, integrity kontrolü
- [ ] `portable/segmenter.test.ts` — Segment bazlı arama doğruluğu
- [ ] `portable/integrity.test.ts` — Checksum verify, orphan repair
- [ ] `gateway/routes.portable.test.ts` — API endpoint testleri (export/import/snapshot)

### Manual Verification

- [ ] 10K bellek export süresi < 30 sn.
- [ ] Export dosyası gzip ile < 50 MB (embedding hariç).
- [ ] Snapshot restore sonrası bellek sayısı ve graph yapısı birebir aynı.
- [ ] Import sonrası retrieval sonuçları (semantic + graph) export öncesi ile aynı.

---

## Riskler ve Mitigasyon

| Risk | Açıklama | Risk Seviyesi | Mitigasyon |
|------|----------|---------------|------------|
| Mevcut `MemoryRow` ile uyumsuzluk | `frame_id` yeni kolonu eski kayıtları etkileyebilir | Düşük | `NULL` allowed, migration transaction içinde |
| Büyük dosya boyutu | Embedding dahil olursa yüz MB'lar | Orta | Varsayılan `exclude embeddings`, gzip |
| Snapshot storage overhead | Her snapshot tüm belleği kopyalar | Orta | Incremental snapshots + cleanup policy (retention days) |
| Import çakışmaları | Aynı ID, farklı içerik | Orta | Upsert logic + conflict resolution + checksum |
| sqlite-vec uyumsuzluğu | Vektör tablosu harici formatta | Orta | Embedding'leri opsiyonel tut, import'ta yeniden hesapla |

---

## Bağımlılık Sırası

1. **Faz 1:** `types.ts` + `integrity.ts` → Temel veri yapıları
2. **Faz 2:** `exporter.ts` → Export fonksiyonelliği
3. **Faz 3:** `importer.ts` → Import + conflict resolution
4. **Faz 4:** `snapshot.ts` → Snapshot/restore layer
5. **Faz 5:** `segmenter.ts` → Segment-based indexing
6. **Faz 6:** `routes.ts` + `config.ts` → API + feature flag
7. **Faz 7:** Test + migration → Production'a aç

---

## Referanslar

- memvid: https://github.com/memvid/memvid
- Smart Frames: https://github.com/memvid/memvid#smart-frames
- PenceAI DB Şeması: [`project/04-veritabani-semasi.md`](project/04-veritabani-semasi.md)
- PenceAI Modül Yapısı: [`project/03-modul-yapisi.md`](project/03-modul-yapisi.md)

---

*Plan tarihi: 2026-04-24*
*Sonraki revizyon: User review sonrası*
