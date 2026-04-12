# PenceAI — QWEN.md

> **Proje:** PenceAI — Self-hosted, local-first AI agent platform
> **Versiyon:** 0.1.0
> **Dil:** TypeScript (ES2022)
> **Runtime:** Node.js >= 22
> **Son Güncelleme:** 11 Nisan 2026

---

## Proje Özeti

PenceAI, çoklu LLM provider desteği, bilişsel bellek katmanı (cognitive memory), GraphRAG tabanlı retrieval ve MCP (Model Context Protocol) entegrasyonu sunan bir AI agent runtime platformudur. Agent loop, tool calling, episodic/semantic bellek ayrımı, dual-process routing ve WebSocket tabanlı web arayüzü tek bir TypeScript kod tabında birleştirilir.

### Temel Yetenekler
- **Agent Runtime + Tool Loop:** `AgentRuntime` — reasoning, tool call, observation, response generation
- **Bilişsel Bellek Katmanı:** `MemoryManager` — conversation, long-term memory, retrieval, maintenance
- **GraphRAG:** Graph-aware retrieval, PageRank, community detection, token pruning, shadow-mode
- **MCP Entegrasyonu:** 18+ modül, marketplace, security layer, unified tool registry
- **Multi-Provider LLM:** OpenAI, Anthropic, Groq, Mistral, Ollama, NVIDIA, GitHub, MiniMax
- **Observability:** Langfuse + OpenTelemetry tracing, token usage, cost tracking
- **Web UI:** React + Vite + React Query + Zustand
- **Çoklu Kanal:** Telegram, Discord, WhatsApp altyapısı

---

## Klasör Yapısı

```
src/
├─ agent/           # Agent runtime, promptlar, MCP entegrasyonu
│  ├─ mcp/          # Model Context Protocol (client, adapter, registry, security, marketplace)
│  └─ runtime.ts    # Ana agent runtime (ReAct loop)
├─ autonomous/      # Arka plan düşünme, kuyruklar, otonom işçiler
├─ cli/             # CLI ve bakım komutları
├─ gateway/         # HTTP/WebSocket sunucu, bootstrap, controllers, services, jobs
├─ llm/             # LLM provider adapter'ları (openai, anthropic, ollama, vs.)
├─ memory/          # Database, retrieval, graph, GraphRAG, extraction pipeline
│  ├─ graphRAG/     # Graph-based Retrieval Augmented Generation
│  ├─ manager/      # MemoryManager modülleri (ConversationManager, MemoryStore, RetrievalService)
│  └─ extraction/   # Memory extraction pipeline
├─ router/          # Kanal soyutlama ve mesaj yönlendirme
├─ observability/   # Langfuse OpenTelemetry entegrasyonu
├─ utils/           # Logger, cost calculator
└─ web/
   └─ react-app/    # React frontend (Vite, React Query, Zustand)

tests/
├─ agent/mcp/       # MCP unit testleri
├─ benchmark/       # Performans benchmarkları
├─ e2e/             # Playwright E2E testleri
├─ frontend/        # Frontend testleri (UI, integration)
├─ gateway/         # Gateway testleri
├─ memory/          # Memory testleri (GraphRAG dahil)
└─ observability/   # Observability testleri
```

---

## Önemli Komutlar

### Geliştirme
```bash
npm run dev                  # Backend + frontend concurrently
npm run dev:backend-only     # Sadece backend (tsx watch)
```

### Build & Start
```bash
npm run build                # tsc + React app build
npm run start                # node dist/gateway/index.js
```

### Test
```bash
npm test                              # Tüm testler (Jest)
npm run test:frontend                 # Frontend testleri
npm run test:ui                       # UI component testleri
npm run test:mcp:e2e                  # MCP E2E (Playwright)
npm run test:mcp:e2e:ui               # Playwright UI modu
npm run test:mcp:e2e:headed           # Playwright headed modu
npm run test:mcp:e2e:report           # Rapor görüntüleme
```

### GraphRAG
```bash
npm run graphrag:status              # Durum kontrol
npm run graphrag:readiness           # Hazırlık kontrolü
npm run graphrag:go-full             # Tam aktivasyon
npm run graphrag:emergency-rollback  # Acil geri alma
```

### CLI & Bakım
```bash
npm run cli          # CLI araçları
npm run maintenance  # Bakım görevleri
```

---

## Teknoloji Yığını

| Katman | Teknoloji |
|--------|-----------|
| Dil | TypeScript (ES2022, strict) |
| Runtime | Node.js >= 22 |
| Backend | Express + WebSocket (ws) |
| Veritabanı | SQLite (`better-sqlite3`), `sqlite-vec` (vektör) |
| LLM SDK | OpenAI, Anthropic, `@azure-rest/ai-inference` |
| MCP | `@modelcontextprotocol/sdk` |
| Embedding | `@xenova/transformers` (ONNX) |
| Observability | Langfuse + OpenTelemetry |
| Frontend | React + Vite + React Query + Zustand |
| Test | Jest + Playwright + Testing Library |
| Log | Pino |

---

## Ortam Değişkenleri (`.env`)

Gerekli değişkenler `.env.example` dosyasında tanımlıdır. Önemli gruplar:

- **Sunucu:** `PORT` (3001), `HOST` (localhost)
- **Veritabanı:** `DB_PATH` (./data/penceai.db)
- **LLM Provider'lar:** En az bir API key gerekli (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, vb.)
- **Local Model:** `OLLAMA_BASE_URL`
- **Güvenlik:** `ALLOW_SHELL_EXECUTION` (varsayılan: false), `DASHBOARD_PASSWORD`, `SENSITIVE_PATHS`
- **Embedding:** `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`
- **MCP:** `ENABLE_MCP` (varsayılan: true)
- **Observability:** `LANGFUSE_ENABLED` (varsayılan: false)

---

## Mimari Notları

### Agent Runtime (`src/agent/runtime.ts`)
- ReAct loop: Reason → Act → Observe
- Tool calling ve observation yönetimi
- Bellek çıkarımı (light/deep extraction)
- Konuşma özetleme
- Context budama (sliding window, 128K token limiti)

### Memory Manager (`src/memory/manager/index.ts`)
- Facade pattern ile modüler yapı: `ConversationManager`, `MemoryStore`, `RetrievalService`
- Episodik/semantik bellek ayrımı
- Ebbinghaus unutma eğrisi tabanlı decay/review
- Hybrid search (FTS + semantic + RRF fusion)
- Graph-aware retrieval ve spreading activation
- Reconsolidation pilot (güvenli bellek birleştirme)

### GraphRAG (`src/memory/graphRAG/`)
- `GraphRAGEngine`: Ana graph-aware retrieval motoru
- `PageRankScorer`: Node önem skorlama
- `CommunityDetector`: Topluluk tespiti
- `CommunitySummarizer`: Topluluk özetleme
- `TokenPruner`: Token bütçe yönetimi
- `ShadowMode`: Güvenli feature rollout testi
- `GraphCache`: Performans için önbellekleme

### MCP Modülü (`src/agent/mcp/`)
- `MCPClientManager`: Sunucu yaşam döngüsü yönetimi
- `UnifiedToolRegistry`: Merkezi araç kayıt ve çalıştırma
- `Security Layer`: Komut doğrulama, path extraction, argüman validasyonu
- `EventBus`: MCP lifecycle event yayınlama
- `Marketplace`: Sunucu keşif ve yükleme
- Savunma-derinliği güvenlik modeli

### Gateway (`src/gateway/`)
- HTTP + WebSocket sunucu
- REST API endpoint'leri (controllers/services)
- Arka plan işleri (autonomousWorker, systemTasks)
- Observability API (Langfuse proxy)

### Router (`src/router/`)
- Mesaj kanal normalizasyonu
- Semantik intent eşleştirme (ONNX embedding)
- Transport soyutlama

---

## Test Yapısı

| Test Tipi | Lokasyon | Framework |
|-----------|----------|-----------|
| Unit/Integration | `tests/memory/`, `tests/gateway/`, `tests/agent/mcp/` | Jest |
| GraphRAG | `tests/memory/graphRAG/` | Jest |
| Frontend UI | `tests/frontend/ui/` | Jest + Testing Library |
| Frontend Integration | `tests/frontend/integration/` | Jest |
| E2E | `tests/e2e/specs/` | Playwright |
| Benchmark | `tests/benchmark/` | Jest |
| Observability | `tests/observability/` | Jest |

---

## Geliştirme Kuralları (Kod Tabından Çıkarılan)

- **TypeScript strict mode** aktiftir — tip güvenliğine dikkat edin
- **ESM modül sistemi** — `import/export` kullanın, `require` değil
- **Path alias:** `@/*` → `src/*` (ancak Jest'te `src/web/react-app/src/` eşlenir)
- **React app ayrı build** — `src/web/react-app/` kök tsconfig'den hariç tutulmuş
- **Test dosyaları** `*.test.ts` pattern'i ile — tsconfig'den hariç
- **Pino logger** — yapılandırılabilir log seviyeleri (`LOG_LEVEL`)
- **Güvenlik:** Hassas yollar (`SENSITIVE_PATHS`) whitelist dışındadır, shell execution varsayılan olarak kapalı

---

## Bilinen Özellikler ve Deneysel Alanlar

### Üretim Seviyesinde
- Gateway + web chat akışı
- Konuşma tabanlı bellek saklama ve çağırma
- MCP temel entegrasyon
- LLM provider desteği (8 provider)
- Token kullanım ve maliyet takibi
- Langfuse observability

### Deneysel / Prototip
- GraphRAG aktif kullanımı (shadow → production geçişi)
- Reconsolidation pilot (güvenlik kriterleri netleştirilmeli)
- Dual-process routing yapılandırılabilirliği
- Otonom düşünce ve merak motorları

---

## Dikkat Edilmesi Gerekenler

1. **Bellek ve konuşma verisi** yerel SQLite'da saklanır — hassas veri kullanımında dikkatli olun
2. **Shell execution** (`ALLOW_SHELL_EXECUTION`) güvenlik riski oluşturabilir
3. **Harici API'lere** veri gönderimi provider seçimine bağlıdır
4. **GraphRAG** henüz tam üretim olgunluğunda değildir
5. **React app** ayrı bir `npm install` gerektirebilir (`src/web/react-app/` içinde)
