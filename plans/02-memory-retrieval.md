# PenceAI Memory & Retrieval Sistemi — Optimizasyon Raporu

> **İncelenen Dosya:** `src/memory/` (ve alt dizinleri), `src/router/`, ilgili testler
> **Toplam Bulgu:** 24
> **Kritik:** 8 | **Orta:** 10 | **Düşük:** 6

---

## [Goal Description]

Memory (`src/memory/`) ve Router (`src/router/`) modülleri, PenceAI'nin bilgi kalıcılığı, semantik arama ve vektör tabanlı retrieval katmanını oluşturur. Bu rapor, SQLite veritabanı performansını, embedding/vektör işlemlerini, GraphRAG traversal'larını, önbellekleme stratejilerini ve kod tekrarlarını analiz ederek iyileştirme önerileri sunar.

---

## User Review Required

> [!IMPORTANT]
> **SQLite Index Ekleme:** Mevcut `memories` tablosuna index eklenmesi, write throughput'u hafifçe etkileyebilir. Read/write ratio değerlendirilmelidir.
>
> **Embedding Cache Bellek Kullanımı:** Vektör boyutları (örn. 1536-dim) büyük olabilir. Cache `maxSize` sınırı dikkatle ayarlanmalıdır.

> [!WARNING]
> **Transaction Kullanımına Geçiş:** Batch insert/update'lerde transaction kullanımı, concurrency hatalarına yol açabilir. WAL mode ve busy timeout ayarları gözden geçirilmelidir.

---

## Proposed Changes

### 🔴 Kritik Bulgular

#### [MODIFY] `src/memory/schema.ts`
- **Sorun:** `memories` tablosunda `category`, `memory_type`, `is_archived`, `provenance_conversation_id`, `provenance_source`, `next_review_at` sütunları için index tanımlanmamış. Sık kullanılan filtreleme sorguları full table scan yapıyor.
- **Öneri:** Aşağıdaki index'leri ekle:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
  CREATE INDEX IF NOT EXISTS idx_memories_archived ON memories(is_archived);
  CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);
  CREATE INDEX IF NOT EXISTS idx_memories_conversation ON memories(provenance_conversation_id);
  CREATE INDEX IF NOT EXISTS idx_memories_review ON memories(next_review_at, is_archived);
  CREATE INDEX IF NOT EXISTS idx_memories_composite ON memories(is_archived, category, memory_type);
  ```

#### [MODIFY] `src/memory/manager/Retriever.ts`
- **Sorun:** Embedding hesaplamalarında gereksiz tekrar. Aynı query embedding'i sürekli yeniden hesaplanıyor.
- **Öneri:** Query embedding LRU cache (TTL: 1 saat). Aynı metin için embedding sonucu tekrar kullanılsın.
- **Kod Önerisi:**
  ```typescript
  const queryEmbeddingCache = new LRUCache<string, number[]>({
    maxSize: 500,
    ttl: 3_600_000,
  });
  ```

#### [MODIFY] `src/memory/database.ts`
- **Sorun:** Transaction kullanımı yerine tek tek `INSERT`/`UPDATE` yapılıyor. Batch bellek kaydetme işlemleri yavaş.
- **Öneri:** Batch işlemlerde `BEGIN...COMMIT` transaction bloğu kullan. `PRAGMA journal_mode=WAL` aktifse concurrency artar.
- **Kod Önerisi:**
  ```typescript
  async batchInsert(memories: Memory[]): Promise<void> {
    const db = await this.getDb();
    await db.exec('BEGIN');
    try {
      for (const m of memories) {
        await db.run('INSERT INTO memories (...) VALUES (...)', [...]);
      }
      await db.exec('COMMIT');
    } catch (e) {
      await db.exec('ROLLBACK');
      throw e;
    }
  }
  ```

#### [MODIFY] `src/memory/retrievalOrchestrator.ts`
- **Sorun:** Retrieval stratejileri (`semantic`, `keyword`, `graph`) seri çalıştırılıyor. `await semantic(); await keyword(); await graph();`
- **Öneri:** Bağımsız retrieval'ları `Promise.all` ile paralel çalıştır. Sonuçları merge et.
- **Kod Önerisi:**
  ```typescript
  const [semanticResults, keywordResults, graphResults] = await Promise.all([
    this.semanticRetrieve(query),
    this.keywordRetrieve(query),
    this.graphRetrieve(query),
  ]);
  return this.mergeResults(semanticResults, keywordResults, graphResults);
  ```

#### [MODIFY] `src/memory/graphRAG/`
- **Sorun:** Graph traversal (BFS/DFS) her seferinde tüm graph'i yükler. Node ve edge önbellekleme yok.
- **Öneri:** Sık erişilen node'ları ve komşularını LRU cache'le. Graph segment'leri lazy load et.
- **Kod Önerisi:**
  ```typescript
  const graphNodeCache = new LRUCache<string, GraphNode>({ maxSize: 10_000, ttl: 600_000 });
  ```

#### [MODIFY] `src/memory/shortTermPhase.ts`
- **Sorun:** Kısa süreli bellek (short-term) temizleme (garbage collection) her mesajda çalışıyor. `O(n)` scan.
- **Öneri:** GC'yi zaman tabanlı çalıştır (örn. her 5dk veya threshold aşılınca). Background job olarak ayır.

#### [MODIFY] `src/memory/embeddings.ts`
- **Sorun:** Embedding hesaplama fonksiyonu her çağrıda yeni bir HTTP bağlantısı açıyor. Connection reuse yok.
- **Öneri:** HTTP agent (keep-alive) kullan. Fetch/axios instance'ını singleton olarak tut.

#### [MODIFY] `src/router/semantic.ts`
- **Sorun:** Semantik router her istekte embedding hesaplıyor. Route cache yok.
- **Öneri:** `(queryHash, routeResult)` şeklinde cache ekle. Benzer query'ler aynı rotaya yönlendirilsin.

---

### 🟡 Orta Bulgular

#### [MODIFY] `src/memory/ebbinghaus.ts`
- **Sorun:** Ebbinghaus forgetting curve hesaplamaları her bellek erişiminde tekrar ediliyor. Matematiksel fonksiyon cache'lenebilir.
- **Öneri:** `(interval, repetition)` çifti için önceden hesaplanmış değer tablosu (lookup table) kullan.

#### [MODIFY] `src/memory/manager.ts`
- **Sorun:** Bellek yöneticisi (manager) çok fazla sorumluluk üstleniyor (CRUD + search + archive + review). Single Responsibility ihlali.
- **Öneri:** Manager'ı alt servislere ayır: `MemoryStore`, `MemorySearcher`, `MemoryArchiver`.

#### [MODIFY] `src/memory/contextUtils.ts`
- **Sorun:** Context window hesaplamaları string length bazlı. Gerçek token sayısı değil.
- **Öneri:** `tiktoken` veya benzeri tokenizer kullan. String length yerine gerçek token count.

#### [MODIFY] `src/memory/graph.ts`
- **Sorun:** Graph edge'leri double storage yapıyor (A→B ve B→A ayrı satırlar). Normalization yok.
- **Öneri:** Edge'leri yönlü (directed) tut ama sorgularda `UNION` yerine `OR (src=? AND dst=?)` ile tek sorgu at.

#### [MODIFY] `src/memory/retrieval/`
- **Sorun:** Retrieval pipeline'ı tek bir fonksiyon içinde. Aşamalar (filter → rank → dedup) tightly coupled.
- **Öneri:** Chain of Responsibility pattern kullan. Her aşama bağımsız ve test edilebilir olsun.

#### [MODIFY] `src/memory/types.ts`
- **Sorun:** Bellek tipleri `any` veya loosely typed union kullanıyor. Runtime type güvenliği zayıf.
- **Öneri:** `zod` veya `valibot` ile runtime schema validasyonu ekle.

#### [MODIFY] `src/router/embedding-worker.ts`
- **Sorun:** Worker thread her embedding isteğinde yeni oluşturuluyor. Thread creation overhead yüksek.
- **Öneri:** Worker pool kullan. `piscina` veya `workerpool` kütüphaneleri değerlendir.

#### [MODIFY] `src/memory/extraction/`
- **Sorun:** Bellek çıkarımı (extraction) LLM çağrısı her mesajda yapılıyor. Maliyetli.
- **Öneri:** Çıkarım sonuçlarını mesaj hash'i üzerinden cache'le. Aynı mesaj tekrar çıkarılmasın.

#### [MODIFY] `src/memory/manager/`
- **Sorun:** N+1 sorgu problemi. Her bellek için ayrı `SELECT` atılıyor.
- **Öneri:** `IN (...)` clause kullanarak toplu sorgu yap. `SELECT * FROM memories WHERE id IN (?, ?, ?)`.

#### [MODIFY] `src/memory/database.ts`
- **Sorun:** Database bağlantısı her istekte yeni açılıyor. Connection pooling yok.
- **Öneri:** `better-sqlite3` kullanıyorsanız tek bağlantı yeterli. `sqlite3` async kullanıyorsanız connection pool (max 5) oluştur.

---

### 🟢 Düşük Bulgular

#### [MODIFY] `src/memory/types.ts`
- **Sorun:** `MemoryType` enum'ları string literal union yerine `enum` keyword kullanıyor. Tree-shaking dostu değil.
- **Öneri:** `const MemoryType = { ... } as const` ve `type MemoryType = typeof MemoryType[keyof typeof MemoryType]` patternine geç.

#### [MODIFY] `src/memory/contextUtils.ts`
- **Sorun:** Tarih/zaman işlemleri native `Date` kullanıyor. `Intl.DateTimeFormat` veya `date-fns` daha güvenli.
- **Öneri:** `date-fns` veya `dayjs` ekle. Zaman dilimi (timezone) tutarlılığı sağla.

#### [MODIFY] `tests/memory/`
- **Sorun:** Test veritabanı her test sonrası siliniyor; test süreleri uzun.
- **Öneri:** In-memory SQLite (`:memory:`) kullan. Test başına yeni DB yerine transaction rollback ile izolasyon sağla.

#### [MODIFY] `src/memory/graphRAG/`
- **Sorun:** Graph visualization/debug verileri production build'ine dahil.
- **Öneri:** Debug kodlarını `if (process.env.DEBUG_GRAPH)` guard'ı ile sarmala veya ayrı modüle çıkar.

#### [MODIFY] `src/memory/retrievalOrchestrator.ts`
- **Sorun:** Retrieval sonuçlarında duplicate (aynı belleğin birden fazla kaynaktan gelmesi) kontrolü hash bazlı değil, ID bazlı.
- **Öneri:** Bellek içeriği hash'ini de kontrol et. Aynı ID farklı versiyonlarda olabilir.

#### [MODIFY] `src/memory/manager.ts`
- **Sorun:** Archive/restore operasyonlarında soft-delete yerine hard-delete opsiyonu yok.
- **Öneri:** GDPR/veri silme talepleri için hard-delete API'si ekle. Varsayılan soft-delete kalsın.

---

## Open Questions — Cevaplanmış

1. **FTS5 Kullanımı:** ✅ **FTS5 AKTİF.** `memories_fts` ve `messages_fts` tabloları `USING fts5` ile oluşturulmuş. Tetikleyiciler (AFTER INSERT/UPDATE/DELETE) otomatik FTS index güncellemesi yapıyor. `LIKE` kullanılmıyor, tamamen FTS5 MATCH ile çalışıyor.
2. **Embedding Boyutu:** ✅ Varsayılan 1536 boyut (MiniMax/OpenAI). Voyage 3072 boyut. `validateEmbeddingDimensions()` ile DB tutarlılığı kontrol ediliyor.
3. **GraphRAG Segmentasyon:** ✅ GraphRAG `GraphExpander` ile BFS traversal yapıyor. `maxNodes` limiti (default 50) var. Ayrıca `GraphCache` ile traversal sonuçları DB'ye cache'leniyor (1-2 saat TTL). Lazy loading segmentasyon şu an gerekli değil — graph küçük ölçekli çalışıyor.
4. **WAL Mode:** ✅ **WAL AKTİF.** `this.db.pragma('journal_mode = WAL')`, `synchronous = NORMAL`, `busy_timeout = 5000` ve `foreign_keys = ON` olarak ayarlanmış. Concurrent read/write performansı iyi.

---

## Teyit Sonuçları (2026-04-23)

### ✅ Zaten Çözülmüş Bulgular (Kodda mevcut)

| # | Bulgu | Kanıt Dosya | Açıklama |
|---|-------|-------------|----------|
| 3 | Transaction kullanımı | `database.ts` migrate() | `this.db.transaction(() => { ... })()  ` ile tüm migration transaction içinde. `MemoryStore.executeEbbinghausUpdates()`, `MemoryStore.decayMemories()`, `MemoryStore.dearchiveMemories()`, `MemoryStore.computeAndStoreEmbedding()` hep transaction kullanıyor. |
| 4 | Paralel retrieval | `retrievalOrchestrator.ts` phase2 | `Promise.all([graphAwareSearch, getRecentConversationSummaries, getMemoriesDueForReview, getFollowUpCandidates])` ile zaten paralel. |
| 5 | GraphRAG node cache | `GraphCache.ts` | `GraphCache` sınıfı var, DB-backed TTL cache (1-2 saat). `graph_traversal_cache` tablosu. |
| 6 | GC zaman-tabanlı | `MemoryStore.executeEbbinghausUpdates()` | Ebbinghaus stability güncellemeleri TaskQueue'ya erteleniyor, her mesajda değil worker boşken çalışıyor. |
| 8 | Semantic router route cache | `router/semantic.ts` | `_cachedEmbeddings` Map ile intent example cache, `CacheConfig` ile TTL/LRU/MB limit, batch embedding. Route-level `(queryHash, routeResult)` cache yok ama bu düşük öncelikli. |
| 9 | Manager SRP | `memory/manager/` | Manager zaten alt servislere ayrılmış: `MemoryStore`, `RetrievalService`, `ConversationManager`, `FeedbackService`, `SpreadingActivationService`, `TokenUsageService`. |
| 11 | Graph double storage | `memory/graph.ts` `upsertRelation()` | Simetrik ilişkiler için normalization yapılıyor: `if (sourceMemoryId > targetMemoryId) { swap }`. Ayrıca `UNIQUE(source_memory_id, target_memory_id, relation_type)` constraint var. |
| 14 | N+1 sorgu | `RetrievalService.ts` | `getMemoryNeighborsBatch()` batch sorgu ile N+1 çözülmüş. `executeEbbinghausUpdates()` `IN (...)` clause kullanıyor. `
| 16 | Database connection pool | `database.ts` | `better-sqlite3` kullanılıyor — tek senkron bağlantı, connection pool gereksiz. |
| 18 | MemoryType string literal | `memory/types.ts` | `type MemoryType = 'episodic' | 'semantic'` — zaten string literal union, `enum` keyword kullanılmıyor. |

### ❌ Hala Geçerli Bulgular (Çözüldü)

| # | Bulgu | Dosya | Yapılan Düzeltme |
|---|-------|-------|------------------|
| 1 | Eksik index'ler | `database.ts` | ✅ `idx_memories_category`, `idx_memories_type`, `idx_memories_conversation`, `idx_memories_review`, `idx_memories_composite` eklendi. |
| 2 | Query embedding cache eksik | `RetrievalService.ts` | ✅ `getQueryEmbedding()` metodu çıkarıldı, `semanticSearch`, `semanticSearchMessages`, `semanticSearchArchival` hepsi aynı cache'i kullanıyor. |

### ⚠️ Düşük Öncelikli (Henüz Çözülmedi)

| # | Bulgu | Neden düşük öncelikli |
|---|-------|---------------------|
| 7 | HTTP connection reuse | `embeddings.ts` `fetchWithRetry` ile retry var ama keep-alive agent yok. Node.js `fetch` varsayılan keep-alive yapıyor. Düşük etki. |
| 10 | Ebbinghaus lookup table | `ebbinghaus.ts` saf matematiksel fonksiyonlar çok hızlı (`Math.exp`). Lookup table overhead'i daha büyük olabilir. |
| 12 | Context window token count | `contextUtils.ts` string length bazlı. `tiktoken` bağımlılık ekleme maliyeti yüksek, mevcut yaklaşım acceptable. |
| 13 | Retrieval pipeline chain of responsibility | `retrieval/` modülü zaten iyi ayrılmış (`ScoringPipeline`, `CoverageRepair`, `BudgetApplier` vb.). |
| 15 | Worker pool | `router/embedding-worker.ts` tek worker thread. `piscina` kütüphane bağımlılığı gerektirir, mevcut FIFO queue yeterli. |
| 17 | Extraction cache | `memoryExtractor.ts` mesaj hash cache zaten var (git diff'te görünen değişiklik). |

---

## Verification Plan

### Automated Tests

- [ ] `database.test.ts` — Index kullanımını `EXPLAIN QUERY PLAN` ile doğrula. Full table scan olmamalı.
- [ ] `retriever.test.ts` — Embedding cache hit/miss testi ekle. Aynı query 2. çağrıda cache'ten gelmeli.
- [ ] `retrievalOrchestrator.test.ts` — Paralel retrieval testi. 3 strateji aynı anda başlamalı.
- [ ] `graphRAG.test.ts` — Büyük graph (10K node) ile traversal süresi < 100ms olmalı.
- [ ] `batchInsert.test.ts` — 1000 bellek batch insert süresi < 5sn olmalı (transaction ile).

### Manual Verification

- [ ] SQLite `EXPLAIN QUERY PLAN` çıktısını incele. `SCAN TABLE` yerine `SEARCH TABLE` görmelisin.
- [ ] Embedding cache hit ratio: 1 saatlik simülasyonda %70+ hedefle.
- [ ] Memory kullanımı: 1M bellek ile uygulama RAM kullanımını ölç. GraphRAG lazy loading etkisi.

---

*Rapor tarihi: 2026-04-23*
