# PenceAI Agent & Autonomous Modülleri — Optimizasyon Raporu

> **İncelenen Dosya:** 25+ kaynak ve test dosyası
> **Toplam Bulgu:** 30+
> **Kritik:** 9 | **Orta:** 12 | **Düşük:** 9

---

## [Goal Description]

Agent (`src/agent/`) ve Autonomous (`src/autonomous/`) modülleri, PenceAI'nin temel akıl yürütme (reasoning), bellek çıkarımı ve otonom davranış katmanlarını oluşturur. Bu rapor, bu modüller içerisindeki performans darboğazlarını, bellek yönetimi sorunlarını, async anti-pattern'lerini, önbellekleme eksikliklerini ve mimari zayıflıkları tespit ederek somut iyileştirme önerileri sunar.

---

## User Review Required

> [!IMPORTANT]
> **ReactLoop Context Compaction Değişikliği:** `reactLoop.ts` içindeki token sayımı artımlı hale getirilmesi, mevcut mesaj formatlama mantığını etkileyebilir. Unit test'lerin güncellenmesi gerekir.
>
> **Memory Extractor Cache Ekleme:** Embedding cache TTL değeri (önerilen 5 dk) bellek kullanımını artırır. Üretim ortamında `maxSize` limiti konfigüre edilmelidir.

> [!WARNING]
> **Autonomous Worker Döngüsü:** `autonomous/worker.ts` içindeki event listener'ların temizlenmemesi memory leak riski taşır. Bu değişiklik worker lifecycle'ını etkiler.

---

## Proposed Changes

### 🔴 Kritik Bulgular

#### [MODIFY] `src/agent/memoryExtractor.ts`
- **Sorun:** `getSimilarMemoriesForDedup()` ve `processMemoryGraphWithLLM()` her bellek eklenişinde embedding hesaplıyor. `extractMemoriesLight` her 3 mesajda bir `semanticSearch(10)` çağrısı yapıyor.
- **Öneri:** Embedding sonuçlarını bellek ID'ye göre LRU cache'le (TTL: 5dk). Aynı query embedding'i 1 saat boyunca tekrar hesaplanmasın.
- **Kod Önerisi:**
  ```typescript
  const embeddingCache = new LRUCache<string, number[]>({ maxSize: 1000, ttl: 300_000 });
  
  function getCachedEmbedding(key: string, compute: () => Promise<number[]>): Promise<number[]> {
    if (embeddingCache.has(key)) return Promise.resolve(embeddingCache.get(key)!);
    return compute().then(v => { embeddingCache.set(key, v); return v; });
  }
  ```

#### [MODIFY] `src/agent/reactLoop.ts:233-294`
- **Sorun:** Her tool çağrısı sonrası `llmMessages.reduce()` ile karakter bazlı token tahmini (O(n²) potansiyel). `compactEngine.compactIfNeeded()` içinde `encode()` çağrısı çok maliyetli.
- **Öneri:** Token sayımını `llmMessages` üzerinde artımlı (incremental) tut. Sadece yeni eklenen mesajın token sayısını ekle, her seferinde toplamı yeniden hesaplama.
- **Kod Önerisi:**
  ```typescript
  private totalTokens = 0;
  
  addMessage(msg: LLMMessage) {
    this.totalTokens += estimateTokens(msg.content);
    this.llmMessages.push(msg);
    if (this.totalTokens > TOKEN_THRESHOLD) {
      this.compactEngine.compact(this.llmMessages);
      this.totalTokens = this.llmMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    }
  }
  ```

#### [MODIFY] `src/agent/contextPreparer.ts`
- **Sorun:** Tekrar tekrar system prompt encode ediliyor. Her istekte `encode(systemPrompt)` çağrısı yapılıyor.
- **Öneri:** System prompt hash'ine göre önbellekle. Prompt değişmediği sürece token count sabit kalır.

#### [MODIFY] `src/agent/reactLoop.ts`
- **Sorun:** Her adımda tüm `llmMessages` dizisi kopyalanıyor (`[...llmMessages]`), bu büyük konuşmalarda bellek baskısı yaratır.
- **Öneri:** Immutable referans kullan, sadece değişiklik gerektiğinde kopyala (structural sharing veya `immer` benzeri kütüphane).

#### [MODIFY] `src/agent/toolManager.ts`
- **Sorun:** Tool çağrıları arasında paralelleştirme yok. `await toolA(); await toolB();` şeklinde seri çalışıyor.
- **Öneri:** Bağımsız tool çağrılarını `Promise.all` ile paralel hale getir. Dependency graph'i olan tool'lar için `Promise.all` + `topological sort` kullan.
- **Kod Önerisi:**
  ```typescript
  const independentTools = tools.filter(t => !t.dependencies);
  await Promise.all(independentTools.map(t => t.execute()));
  ```

#### [MODIFY] `src/autonomous/worker.ts`
- **Sorun:** Event listener'lar worker durdurulduğunda temizlenmiyor. Her `new Worker()` çağrısı memory leak riski taşıyor.
- **Öneri:** `worker.terminate()` sonrası event listener'ları `removeAllListeners()` ile temizle. Worker pool (örn. `generic-pool`) kullan.

#### [MODIFY] `src/agent/mcp/`
- **Sorun:** MCP (Model Context Protocol) handler'larında timeout yönetimi yok. Uzun süren tool çağrıları event loop'u bloke edebilir.
- **Öneri:** Her MCP çağrısına `AbortController` + `setTimeout` ile timeout ekle. Varsayılan timeout: 30sn.

#### [MODIFY] `src/autonomous/thinkEngine.ts`
- **Sorun:** `thinkEngine` her çağrıda yeni bir LLM prompt'u oluşturuyor; önceki düşünce zincirleri (thought chain) önbelleklenmiyor.
- **Öneri:** Benzer context'ler için düşünce sonuçlarını hash-based cache'le. TTL: 10dk.

#### [MODIFY] `src/agent/graphRAGManager.ts`
- **Sorun:** Graph traversal (`bfs`/`dfs`) her seferinde tüm graph'i memory'den yüklüyor. Büyük graph'lerde RAM kullanımı patlar.
- **Öneri:** Lazy loading + pagination. Sadece erişilen node'ları ve komşularını yükle. Graph segment'lerini LRU cache'le.

---

### 🟡 Orta Bulgular

#### [MODIFY] `src/agent/fallbackParser.ts`
- **Sorun:** Regex tabanlı fallback parser çok maliyetli. Büyük LLM çıktılarında `.*` greedy match yavaşlar.
- **Öneri:** Streaming parser kullan veya `RegExp` yerine state machine (örn. `nearley`, `chevrotain`) kullan.

#### [MODIFY] `src/agent/prompt.ts`
- **Sorun:** Prompt template'leri her seferinde string interpolation ile oluşturuluyor; compiled template cache yok.
- **Öneri:** `handlebars` veya `mustache` template cache kullan. Template'leri başlangıçta compile et ve cache'le.

#### [MODIFY] `src/autonomous/queue.ts`
- **Sorun:** Kuyruk işlemleri in-memory. Süreç çökerse kuyruk kaybolur.
- **Öneri:** SQLite tabanlı persistent queue değerlendir. Veya kuyruk boyutunu sınırla (`maxSize`) ve disk overflow ekle.

#### [MODIFY] `src/agent/metricsTracker.ts`
- **Sorun:** Metrikler her olayda synchronous yazılıyor. Yüksek trafikte I/O bloke edici.
- **Öneri:** Async batch metrics writer kullan. Ring buffer + flush interval (örn. 5sn) ile yaz.

#### [MODIFY] `src/agent/runtimeContext.ts`
- **Sorun:** Context object'i deep copy ile klonlanıyor. Büyük nesnelerde `structuredClone` maliyetli.
- **Öneri:** Immutable context pattern kullan. Sadece değişen alanları kopyala (shallow patch).

#### [MODIFY] `src/agent/tools.ts`
- **Sorun:** Tool şemaları (Zod/Joi) her çağrıda validate ediliyor; compiled schema cache yok.
- **Öneri:** Schema'ları modül yüklenirken bir kez compile et. `z.lazy()` kullanımında dikkat et.

#### [MODIFY] `src/autonomous/curiosityEngine.ts`
- **Sorun:** Merak motoru (curiosity) her döngüde tüm bellekleri tarıyor. `O(n)` scan.
- **Öneri:** Merak skorunu önbellekle ve sadece delta (yeni eklenen) belleklerde güncelle.

#### [MODIFY] `src/agent/compactEngine.ts`
- **Sorun:** Compaction algoritması mesajları mesaj mesaj işliyor. `O(n log n)` sorting yerine `O(n)` selection kullanılabilir.
- **Öneri:** En düşük önemli mesajları bulmak için partial sort (quickselect) kullan.

#### [MODIFY] `src/agent/search/`
- **Sorun:** Arama sonuçları önbelleklenmiyor. Aynı query tekrar tekrar çalıştırılıyor.
- **Öneri:** Query hash'i üzerinden 1dk TTL cache ekle.

#### [MODIFY] `src/autonomous/urgeFilter.ts`
- **Sorun:** `urgeFilter` threshold'u hardcoded. Runtime konfigürasyonu yok.
- **Öneri:** Threshold'u `config.ts` veya environment variable'dan oku. Hot-reload desteği ekle.

#### [MODIFY] `src/agent/runtime.ts`
- **Sorun:** Agent runtime'ı error boundary içermiyor. Bir tool çökerse tüm runtime durur.
- **Öneri:** Try-catch wrapper ile her tool çağrısını izole et. Graceful degradation sağla.

---

### 🟢 Düşük Bulgular

#### [MODIFY] `src/agent/toolPromptBuilder.ts`
- **Sorun:** Tool prompt'ları statik string concat ile oluşturuluyor. `
` escape'leri manuel.
- **Öneri:** Template literal function kullan. Prompt segment'lerini array'de topla, `join('\n')` ile birleştir.

#### [MODIFY] `src/autonomous/index.ts`
- **Sorun:** Autonomous modülü barrel export. Tree-shaking'i zayıflatır.
- **Öneri:** İç import'ları doğrudan alt dosyalardan yap.

#### [MODIFY] `tests/agent/`
- **Sorun:** Birçok test mock'ları tekrar ediyor. `beforeEach` içinde aynı setup.
- **Öneri:** Shared test fixtures oluştur. `jest.setupFilesAfterEnv` ile ortak mock'ları yükle.

#### [MODIFY] `src/agent/reactLoop.ts`
- **Sorun:** Debug log'ları production'da da çalışıyor. `console.log` yerine structured logger kullanılıyor ancak level kontrolü zayıf.
- **Öneri:** `if (logger.isDebugEnabled())` guard ekle. Hot path'lerde log tamamen kaldırılabilir.

#### [MODIFY] `src/agent/mcp/`
- **Sorun:** MCP tool'larının isimlendirmesi tutarsız. `snake_case` ve `camelCase` karışık.
- **Öneri:** Tek bir naming convention'a geç. `kebab-case` tool ID'ler için tercih edilebilir.

---

## Open Questions

1. **Embedding Cache TTL:** 5 dk uygun mu? Bellek kullanımı monitoring'i nasıl yapılacak?
2. **GraphRAG Lazy Loading:** Graph segmentasyon stratejisi (node count, edge weight, vb.) nasıl belirlenecek?
3. **Worker Pool Boyutu:** Autonomous worker pool'u dinamik mi sabit mi olmalı? `os.cpus().length` bazlı mı?
4. **Tool Paralelleştirme Sırası:** Dependency graph'i olan tool'lar için DAG traversal kütüphanesi eklenecek mi?

---

## Verification Plan

### Automated Tests

- [ ] `memoryExtractor.test.ts` — Embedding cache hit/miss testleri ekle.
- [ ] `reactLoop.test.ts` — Token sayımı artımlı tutulduğunu doğrula. 1000 mesajlık fixture ile benchmark.
- [ ] `toolManager.test.ts` — Paralel tool çağrısı testi ekle. Race condition kontrolü.
- [ ] `worker.test.ts` — Worker terminate sonrası event listener temizliğini doğrula.
- [ ] `graphRAGManager.test.ts` — Büyük graph (10K+ node) ile lazy loading performans testi.

### Manual Verification

- [ ] Memory leak testi: 1 saat boyunca sürekli agent çalıştır, heap snapshot al.
- [ ] ReactLoop latency: 50+ tool çağrılı konuşmada toplam süreyi ölç (before/after).
- [ ] Embedding cache hit ratio: `console.log` veya metrics ile 1 saatlik production trafik simülasyonunda %80+ hit hedefle.

---

*Rapor tarihi: 2026-04-23*
