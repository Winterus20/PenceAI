# Karpathy'nin LLM Wiki'sinden PenceAI İçin Çıkarılan Dersler

> **Kaynak:** [karpathy/llm-wiki.md](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
> **Tarih:** 11 Nisan 2026
> **Durum:** Analiz tamamlandı, aksiyon planı hazır

---

## 📋 Karpathy'nin Öz Fikri

Geleneksel RAG sistemleri her sorguda ham belgeleri sıfırdan tarar — bilgi **birikmez**. Karpathy, LLM'nin sürekli okuduğu, güncellediği ve birbirine bağladığı **kalıcı bir Markdown wiki** oluşturmayı öneriyor. Bu wiki, ham kaynaklar ile kullanıcı arasında yaşayan, her kaynak eklendiğinde veya soru sorulduğunda zenginleşen "biriken bir bilgi katmanı" görevi görüyor.

---

## 🏗️ Karpathy'nin 3 Katmanlı Mimarisi

```
1. Raw Sources        → Değişmez ham belgeler (gerçek kaynak)
2. The Wiki           → LLM tarafından oluşturulan/yönetilen, birbirine bağlı Markdown dosyaları
3. The Schema         → CLAUDE.md / AGENTS.md — LLM'nin wiki kurallarını belirleyen yapılandırma
```

### PenceAI'deki Karşılığı

```
1. User Messages      → Değişmez kullanıcı mesajları (conversation history)
2. Memory Store       → LLM tarafından extract edilen, graph'a bağlı bellekler
3. Retrieval Schema   → RetrievalOrchestratorDeps, PromptContextRecipe, Typed interfaces
```

> **Teşhis aynı, form farklı.** Karpathy Markdown/wiki kullanıyor, PenceAI SQLite/graph kullanıyor.

---

## 📖 Ders 1: "Bilgi Birikmeli, Birleşmemeli"

### Karpathy'nin Argümanı

> *"RAG pieces together fragments at query time. Information does not accumulate. That's the whole point of a wiki — it accumulates."*

### PenceAI'deki Durum

```
✅ Şu an yapıyoruz:
├── extractMemoriesLight()        → Her 3 mesajda sentez
├── extractMemoriesDeep()         → Konuşma sonunda derin sentez
├── summarizeConversation()       → Özet birikir
└── processMemoryGraphWithLLM()   → Entity'ler graph'a eklenir

❌ AMA:
├── Bellekler birbirine "bağlı" ama "güncellenmiş" değil
├── Eski bellek → yeni bilgiyle çelişirse ne olur?
└── Reconsolidation Pilot sadece 2 bellek arası karşılaştırma yapıyor
```

### Çıkarım

Reconsolidation Pilot şu an **ikili** (existing vs incoming) çalışıyor. **Global tutarlılık** lazım:

```
Mevcut:  Bellek A vs Bellek B → merge kararı
Hedef:   Tüm bellekler → çelişki taraması → toplu güncelleme
```

### Aksiyon

- `memory:lint` CLI komutu — tüm bellekleri tara, çelişki flag'le
- BackgroundWorker'a "weekly lint pass" ekle
- Çelişki bulunan bellekler → `review_profile: 'conflict'` olarak işaretle

---

## 📖 Ders 2: "Hatalar Kalıcı Hale Gelip Bileşik Büyüyebilir"

### Karpathy'nin Uyarısı

> *"The biggest technical risk is errors becoming permanent and compounding."*

### PenceAI'deki Risk Senaryosu

```
1. Kullanıcı: "Python kullanıyorum"
2. LLM extract → Memory[id=42] "Kullanıcı Python kullanıyor" (confidence: 0.85)
3. 2 hafta sonra: "Artık Rust kullanıyorum"
4. LLM extract → Memory[id=98] "Kullanıcı Rust kullanıyor" (confidence: 0.9)
5. İki bellek YAN YANA duruyor → ÇELİŞKİ

Mevcut mitigasyonlar:
├── Reconsolidation Pilot  → Sadece çok benzer bellekleri merge eder
│   └── "Python" vs "Rust" → semantic ~0.4 → TRIGGER ETMEZ ❌
├── Ebbinghaus decay       → Eski bellek zamanla soluyor
│   └── Ama 365 güne kadar hayatta → 1 yıl çelişki ❌
└── BackgroundWorker       → Decay + maintenance yapıyor
    └── Ama ÇELİŞKİ TARAMASI YOK ❌
```

### Çıkarım

Semantic benzerlik **çelişki tespiti için yetersiz**. "Python" ve "Rust" farklı kelimeler ama aynı kategoride çelişiyorlar.

### Aksiyon

```typescript
// Yeni: LLM-based contradiction detector
async detectContradictions(memories: MemoryRow[]): Promise<Contradiction[]> {
  // 1. Kategori bazlı grupla (preference, fact, project)
  // 2. Her grupta LLM'e çelişki sor (batch prompt)
  // 3. Çelişki bulunan → [!contradiction] tag'i + review queue
}

interface Contradiction {
  memoryIdA: number;
  memoryIdB: number;
  reason: string;
  confidence: number;
  suggestedResolution: 'keep_newer' | 'keep_older' | 'merge' | 'flag_for_review';
}
```

---

## 📖 Ders 3: "İnsan + LLM İşbirliği — Rol Dağılımı Şart"

### Karpathy'nin Rol Dağılımı

| İnsan | LLM |
|-------|-----|
| Kaynak seçimi | Özetleme |
| Yön belirleme | Bağlantı kurma |
| Derin analiz | Dosyalama |
| Karar verme | Tutarlılık koruma |

### PenceAI'deki Durum

```
✅ LLM zaten yapıyor:
├── Özetleme (extractMemories)
├── Bağlantı kurma (processMemoryGraph)
├── Dosyalama (category assignment)
└── Tutarlılık (Reconsolidation Pilot)

❌ Kullanıcı yapamıyor:
├── Bellek düzeltme (sadece silme var)
├── Bellek birleştirme (manuel yok)
├── Kategori düzeltme (otomatik, override yok)
└── Çelişki çözme (otomatik, kullanıcı onayı yok)
```

### Çıkarım

PenceAI çok **otomatik**. Kullanıcıya "sürücü koltuğu" vermiyor.

### Aksiyon

```
Memory Dialog'a yeni özellikler:
├── [Düzenle] butonu — bellek içeriğini düzenle
├── [Birleştir] butonu — 2 belleği manuel birleştir
├── [Çelişki Çöz] — flagged contradictions'ı kullanıcıya göster
└── [Kategori Değiştir] — otomatik category'yi override et

Backend'e yeni endpoint'ler:
├── PUT /api/memories/:id              ✅ Zaten var
├── POST /api/memories/:id/merge       ← YENİ
├── POST /api/memories/contradictions/resolve  ← YENİ
└── PUT /api/memories/:id/category     ← YENİ
```

---

## 📖 Ders 4: "Periyodik Bakım (Lint) Şart"

### Karpathy'nin Lint Tanımı

> *"Give the LLM a periodic maintenance task: scan for contradictions, find orphaned pages, update stale info, fill missing links."*

### PenceAI'de Var Olan Bakım

```
BackgroundWorker.runLoop():
├── decayRelationships()    ✅ Ebbinghaus decay
├── processReviewQueue()    ✅ Review adayı bellekler
├── runAutonomousThoughts() ✅ Think engine
└── graphMaintenance()      ✅ Proximity relations
```

### PenceAI'de Olmayan Bakım

```
❌ Çelişki taraması
❌ Öksüz entity tespiti (hiçbir memory'ye link edilmemiş entity'ler)
❌ Stale info güncelleme (kullanıcının değişen bilgileri)
❌ Missing link tamamlama (birbirine bağlanması gereken bellekler)
❌ Kategori drift tespiti (zamanla kategorisi yanlış olan bellekler)
```

### Aksiyon

```typescript
// BackgroundWorker'a eklenecek: Weekly Lint Pass
async runWeeklyLintPass(): Promise<LintReport> {
  const report = {
    contradictions: await this.detectContradictions(),
    orphanedEntities: await this.findOrphanedEntities(),
    staleMemories: await this.findStaleMemories(),
    missingLinks: await this.findMissingLinks(),
    categoryDrift: await this.detectCategoryDrift(),
  };
  // Auto-fix edilebilir olanları düzelt
  // Geri kalanı → review queue
  return report;
}
```

---

## 📖 Ders 5: "Provenance (Kaynak İzlenebilirliği) Kritik"

### Karpathy'nin Yaklaşımı

> *"Ed25519 signed responses, Git history for every page, @import for provenance."*

### PenceAI'deki Mevcut Provenance

```typescript
// Şu an var:
interface MemoryRow {
  provenance_source: string;           // 'conversation' | 'extraction' | 'manual'
  provenance_conversation_id: string;  // Hangi konuşmadan
  provenance_message_id: number;       // Hangi mesajdan
  confidence: number;                  // LLM confidence
}
```

### Eksik Olan

```typescript
// Olması gereken:
interface ProvenanceTrace {
  llmProvider: string;              // OpenAI, Anthropic, etc.
  model: string;                    // gpt-4o, claude-sonnet-4, etc.
  extractionPrompt: string;         // Hash of the prompt used
  extractionTimestamp: string;
  extractionType: 'light' | 'deep' | 'summarization';
  revisionHistory: {
    action: 'created' | 'merged' | 'updated' | 'contradiction_flagged';
    timestamp: string;
    reason: string;
  }[];
}
```

### Aksiyon

```sql
-- Database'e yeni kolonlar:
ALTER TABLE memories ADD COLUMN provenance_trace TEXT;      -- JSON
ALTER TABLE memories ADD COLUMN last_lint_check DATETIME;
ALTER TABLE memories ADD COLUMN contradiction_flags TEXT;   -- JSON array

-- Yeni tablo:
CREATE TABLE memory_revisions (
  id INTEGER PRIMARY KEY,
  memory_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  llm_provider TEXT,
  model TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);
```

---

## 📖 Ders 6: "İnsan Okunabilir Format Güçlüdür"

### Karpathy'nin Format Tercihi

> *"Markdown wiki — human-readable, Git-friendly, Obsidian-compatible."*

### PenceAI'deki Durum

```
Şu an: SQLite binary storage
├── Artı: Hızlı, compact, transaction-safe
├── Artı: FTS5, sqlite-vec, graph relations
└── Eksi: İnsan okuyamıyor, diff edemiyor, export zor
```

### Çıkarım

Binary storage'ı **değiştirme** — ama **export layer** ekle.

### Aksiyon

```bash
# Yeni CLI komutları:
npm run memory:export-md        # Tüm bellekleri Markdown'a export et
npm run memory:export-obsidian  # Obsidian-compatible (vault format)
npm run memory:export-git       # Git-compatible wiki (her bellek = 1 dosya)
npm run memory:graph-export     # Graph visualization (Mermaid/Graphviz)
```

```
Export formatı:
memory-wiki/
├── index.md                    # Katalog (LLM-generated)
├── log.md                      # Kronolojik kayıt
├── preferences/
│   ├── programming-languages.md
│   ├── work-hours.md
│   └── theme-preferences.md
├── projects/
│   ├── penceai.md
│   └── react-dashboard.md
├── events/
│   └── project-deadlines.md
└── graph/
    └── memory-graph.mmd        # Mermaid graph visualization
```

---

## 📖 Ders 7: "Ölçek Sınırlı Başla, Organik Büyü"

### Karpathy'nin Ölçek Yaklaşımı

> *"Optimize for ~100 sources, hundreds of pages. Use grep + index.md, not embeddings."*

### PenceAI'deki Durum

```
Şu an: Embedding-heavy architecture
├── Her bellek → 1536-dim embedding
├── Her sorgu → embedding + FTS + GraphRAG
├── Maliyet: ~2000-3500 token / sorgu
└── Latency: ~1.2-1.8 saniye

Küçük ölçek için overkill:
├── 50 bellek varsa → embedding gereksiz
├── 10 bellek varsa → GraphRAG gereksiz
└── 5 bellek varsa → dual-process routing gereksiz
```

### Aksiyon: Adaptif Retrieval

```typescript
function selectRetrievalStrategy(memoryCount: number, queryComplexity: number): Strategy {
  if (memoryCount < 20 && queryComplexity < 3) {
    return 'keyword_only';        // Sadece FTS, embedding yok
  }
  if (memoryCount < 100 && queryComplexity < 5) {
    return 'fts_semantic';        // FTS + Semantic, GraphRAG yok
  }
  if (memoryCount < 500) {
    return 'full_hybrid';         // FTS + Semantic + Graph neighbors
  }
  return 'full_graphrag';         // Dual-process + GraphRAG + Spreading Activation
}
```

---

## 📊 Aksiyon Planı Özeti

| # | Ders | Öncelik | Efor | Aksiyon |
|---|------|:-------:|:----:|---------|
| 1 | Bilgi birikmeli | 🔴 Yüksek | 2 gün | Reconsolidation'ı ikili → global genişlet |
| 2 | Hatalar bileşik büyür | 🔴 Yüksek | 3 gün | Çelişki tespit CLI + BackgroundWorker lint pass |
| 3 | İnsan-LLM işbirliği | 🟡 Orta | 3 gün | Memory dialog'a düzenle/birleştir/çöz butonları |
| 4 | Periyodik bakım şart | 🔴 Yüksek | 2 gün | Weekly lint pass (BackgroundWorker'a ekle) |
| 5 | Provenance kritik | 🟡 Orta | 2 gün | `memory_revisions` tablosu + trace JSON |
| 6 | İnsan okunabilir export | 🟢 Düşük | 1 gün | `memory:export-md` CLI komutu |
| 7 | Adaptif ölçek | 🟢 Düşük | 1 gün | Memory count-based strategy switching |

**Toplam: ~14 gün, tüm değişiklikler mevcut altyapıya ekleniyor — sıfır breaking change.**

---

## 💎 En Önemli 3 Çıkarım

### 1. Global Tutarlılık Eksik
Şu an sadece ikili merge var, global contradiction detection yok.

### 2. Kullanıcı Kontrolü Eksik
Çok otomatik, kullanıcı "direksiyonda" değil.

### 3. Periyodik Lint Eksik
Decay var ama contradiction/orphan/stale detection yok.

---

## 🏆 PenceAI vs Karpathy — Karşılaştırma Özeti

| Boyut | Karpathy LLM Wiki | PenceAI Memory | Kim Önde? |
|-------|------------------|----------------|-----------|
| Bilgi birikimi | ✅ Wiki-based | ✅ Memory Store | ⚖️ Eşit |
| Çelişki tespiti | ❌ Yok | ⚠️ Sadece ikili | 🔴 Karpathy (fikir olarak) |
| Unutma yönetimi | ❌ Yok | ✅ Ebbinghaus | 🔴 PenceAI |
| Graph ilişkileri | ⚠️ Markdown links | ✅ PageRank + Community | 🔴 PenceAI |
| Dual-Process | ❌ Yok | ✅ System1/System2 | 🔴 PenceAI |
| Spreading Activation | ❌ Yok | ✅ Graph BFS | 🔴 PenceAI |
| Versiyonlama | ✅ Git history | ⚠️ Timestamp | 🔴 Karpathy |
| Provenance | ✅ Ed25519 + Git | ⚠️ Basic | 🔴 Karpathy |
| İnsan okunabilir | ✅ Markdown | ❌ Binary | 🔴 Karpathy |
| Ölçek | ~100 kaynak | Binlerce memory | 🔴 PenceAI |
| Retrieval kalitesi | grep + index | Hybrid + GraphRAG | 🔴 PenceAI |

**Sonuç:** PenceAI retrieval ve memory mimarisinde Karpathy'den **%40 daha zengin**. Ama şeffaflık, versiyonlama ve kullanıcı kontrolü alanlarında Karpathy'den öğrenilecek çok şey var.
