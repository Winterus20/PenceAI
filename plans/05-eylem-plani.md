# PenceAI Optimizasyon — Öncelikli Eylem Planı

> **Tarih:** 2026-04-23
> **Toplam Bulgu:** 119+
> **Planlama Metodolojisi:** MoSCoW (Must have / Should have / Could have / Won't have)

---

## [Goal Description]

Bu doküman, `01-agent-autonomous.md`, `02-memory-retrieval.md`, `03-gateway-llm-observability.md` ve `04-proje-geneli.md` raporlarındaki **119+ bulguyu** önceliklendirilmiş, zaman çizelgeli ve kaynak atamalı bir eylem planına dönüştürür. Her aşama, bir önceki aşamanın başarıyla doğrulanmasına dayanır.

---

## User Review Required

> [!IMPORTANT]
> **Plan Onayı:** Bu eylem planı kabul edilmeden uygulamaya geçilmemelidir. Özellikle "Hemen" aşamasındaki maddeler, üretim ortamını etkileyebilecek kritik değişiklikler içerir.
>
> **Kaynak Ataması:** Bazı maddeler (örn. circuit breaker, CI/CD pipeline) backend/DevOps uzmanlığı gerektirir. Takım kapasitesi göz önünde bulundurulmalıdır.

> [!WARNING]
> **Test Coverage Ön Koşulu:** Kritik değişikliklere başlamadan önce mevcut test coverage'ı %70+ olmalıdır. Düşük coverage ile refactoring, regresyon riskini artırır.

---

## Eylem Planı Özeti

| Aşama | Süre | Öncelik | Kritik Bulgu Sayısı | Hedef |
|-------|------|---------|---------------------|-------|
| **Hemen** | 1-3 gün | 🔴 Must | 15 | Acil performans ve güvenlik düzeltmeleri |
| **Kısa Vade** | 1-2 hafta | 🟡 Should | 12 | Yapısal iyileştirmeler ve önbellekleme |
| **Orta Vade** | 1 ay | 🟢 Could | 6 | Mimari refaktör ve monitoring |
| **Uzun Vade** | 1-3 ay | 🔵 Won't (şimdilik) | 3 | Stratejik değişiklikler |

---

## Phase 1: Hemen (1-3 Gün)

> **Hedef:** En yüksek etkiyi en düşük riskle sağlamak. Sadece izole, düşük kırılma riskli değişiklikler.

### 1.1 Build Performansı

| # | Bulgu | Dosya | Etki | Risk |
|---|-------|-------|------|------|
| 1 | `incremental: true` ekle | `tsconfig.json` | Derleme süresi %50+ azalır | 🟢 Düşük |
| 2 | `tsBuildInfoFile` tanımla | `tsconfig.json` | Artımlı build stabilitesi | 🟢 Düşük |

**Acceptance Criteria:**
- `npm run build` süresi mevcut sürenin %50'si altına inmeli.
- İkinci `npm run build` (değişiklik yoksa) < 5sn olmalı.

**Doğrulama:** `time npm run build` (önce/sonra)

---

### 1.2 Veritabanı Performansı

| # | Bulgu | Dosya | Etki | Risk |
|---|-------|-------|------|------|
| 3 | SQLite index'leri ekle | `src/memory/schema.ts` | Sorgu süresi %80+ azalır | 🟡 Orta |
| 4 | `PRAGMA journal_mode=WAL` kontrolü | `src/memory/database.ts` | Concurrent write performansı | 🟢 Düşük |

**Acceptance Criteria:**
- `EXPLAIN QUERY PLAN` çıktısında `SCAN TABLE` yerine `SEARCH TABLE` görülmeli.
- 10K bellek üzerinde filtreleme sorgusu < 100ms olmalı.

**Doğrulama:** `EXPLAIN QUERY PLAN SELECT * FROM memories WHERE is_archived = 0 AND category = 'user'`

---

### 1.3 Önbellekleme (Cache) — Hızlı Kazanım

| # | Bulgu | Dosya | Etki | Risk |
|---|-------|-------|------|------|
| 5 | Embedding LRU cache | `src/agent/memoryExtractor.ts` | Embedding API maliyeti %60+ azalır | 🟡 Orta |
| 6 | Query embedding cache | `src/memory/manager/Retriever.ts` | Tekrar sorgular anında yanıtlanır | 🟡 Orta |
| 7 | LLM response cache key normalize | `src/llm/llmCache.ts` | Cache hit ratio artar | 🟢 Düşük |

**Acceptance Criteria:**
- Aynı query 2. çağrıda < 10ms yanıt vermeli (cache hit).
- Cache memory usage < 512MB (monitoring ile doğrula).

**Doğrulama:** Embedding cache hit/miss log'ları; `process.memoryUsage()` izleme.

---

### 1.4 WebSocket Hızlı Fix'ler

| # | Bulgu | Dosya | Etki | Risk |
|---|-------|-------|------|------|
| 8 | Keep-alive 60s, idle 5min | `src/gateway/channels/websocket.ts` | Reconnection overhead azalır | 🟡 Orta |
| 9 | WebSocket message batching (server-side) | `src/gateway/channels/websocket.ts` | Network round-trip azalır | 🟡 Orta |

**Acceptance Criteria:**
- WebSocket bağlantısı 1 saat boyunca stabil kalmalı (ping/pong sayısı azalmalı).
- 100 mesajlık burst < 200ms içinde işlenmeli.

**Doğrulama:** Chrome DevTools Network tab; WebSocket frame sayısı (before/after).

---

### 1.5 Güvenlik — Acil

| # | Bulgu | Dosya | Etki | Risk |
|---|-------|-------|------|------|
| 10 | `asyncHandler` wrapper | `src/gateway/routes.ts` | App crash riski elimine edilir | 🟢 Düşük |
| 11 | Input sanitization (basic) | `src/gateway/middleware/` | Injection riski azalır | 🟡 Orta |
| 12 | Rate limiting middleware | `src/gateway/middleware/` | DDoS/abuse koruması | 🟡 Orta |

**Acceptance Criteria:**
- Async route hatası Express app'i crash etmemeli.
- 100 req/dk limiti aşıldığında 429 dönmeli.
- `<script>` tag içeren input sanitize edilmeli.

**Doğrulama:** `npm run test:security` veya manuel curl testleri.

---

### 1.6 Bağımlılık Güvenliği

| # | Bulgu | Dosya | Etki | Risk |
|---|-------|-------|------|------|
| 13 | `npm audit fix` | `package.json` | Known vulnerability'ler kapatılır | 🟢 Düşük |
| 14 | `npm outdated` listeleme | `package.json` | Güncelleme planı oluşturulur | 🟢 Düşük |

**Acceptance Criteria:**
- `npm audit` kritik severity = 0 olmalı.
- `npm outdated` çıktısı dokümante edilmeli.

**Doğrulama:** `npm audit --audit-level=moderate`

---

## Phase 2: Kısa Vade (1-2 Hafta)

> **Hedef:** Yapısal iyileştirmeler, paralelleştirme ve önbellekleme stratejilerinin tamamlanması.

### 2.1 Agent & Autonomous Optimizasyonları

| # | Bulgu | Dosya | Etki | Risk |
|---|-------|-------|------|------|
| 15 | Token sayımı artımlı tut | `src/agent/reactLoop.ts` | Context compaction latency azalır | 🟡 Orta |
| 16 | System prompt cache | `src/agent/contextPreparer.ts` | Her istekte encode kalkar | 🟢 Düşük |
| 17 | Tool çağrıları paralelleştir | `src/agent/toolManager.ts` | Tool latency %40+ azalır | 🟡 Orta |
| 18 | Worker event listener temizliği | `src/autonomous/worker.ts` | Memory leak riski kalkar | 🟡 Orta |
| 19 | MCP timeout ekle | `src/agent/mcp/` | Event loop bloke olmaz | 🟢 Düşük |

**Acceptance Criteria:**
- 50+ tool çağrılı konuşmada toplam süre < 10sn olmalı.
- Worker terminate sonrası `process.memoryUsage()` artışı olmamalı.
- MCP çağrısı 30sn'de timeout vermeli.

**Doğrulama:** `reactLoop.benchmark.ts`, `worker.memory.test.ts`

---

### 2.2 Memory & Retrieval Optimizasyonları

| # | Bulgu | Dosya | Etki | Risk |
|---|-------|-------|------|------|
| 20 | Batch insert transaction | `src/memory/database.ts` | Batch yazma hızı %80+ artar | 🟡 Orta |
| 21 | Retrieval paralelleştir | `src/memory/retrievalOrchestrator.ts` | Retrieval süresi %50+ azalır | 🟡 Orta |
| 22 | GraphRAG node cache | `src/memory/graphRAG/` | Graph traversal hızlanır | 🟡 Orta |
| 23 | Short-term GC zaman tabanlı | `src/memory/shortTermPhase.ts` | Her mesajda scan kalkar | 🟢 Düşük |
| 24 | Connection pooling / singleton | `src/memory/database.ts` | DB bağlantı yönetimi optimize | 🟢 Düşük |

**Acceptance Criteria:**
- 1000 bellek batch insert < 5sn olmalı.
- 3 retrieval stratejisi paralel başlamalı (Promise.all).
- Graph traversal 10K node ile < 100ms olmalı.

**Doğrulama:** `retrievalOrchestrator.test.ts`, `graphRAG.benchmark.ts`

---

### 2.3 Gateway & LLM Optimizasyonları

| # | Bulgu | Dosya | Etki | Risk |
|---|-------|-------|------|------|
| 25 | Circuit breaker ekle | `src/llm/anthropic.ts`, vb. | API limit aşımında graceful fail | 🟡 Orta |
| 26 | Provider fallback chain | `src/llm/provider.ts` | High availability sağlanır | 🟡 Orta |
| 27 | Standart timeout (AbortController) | `src/llm/` (tüm) | Tutarlı timeout yönetimi | 🟢 Düşük |
| 28 | CompletionService adımları böl | `src/gateway/services/completionService.ts` | Kod okunabilirliği ve test edilebilirlik | 🟢 Düşük |
| 29 | Async batch metrics | `src/observability/metricsCollector.ts` | Metrics overhead azalır | 🟢 Düşük |

**Acceptance Criteria:**
- Circuit breaker 5 hata sonrası açılmalı, 30sn sonra yarı-açık (half-open) olmalı.
- Primary provider down simülasyonunda fallback < 2sn içinde başlamalı.
- Tüm provider'lar 30sn timeout ile çalışmalı.

**Doğrulama:** `circuitBreaker.test.ts`, `fallbackChain.test.ts`

---

### 2.4 Docker & Build

| # | Bulgu | Dosya | Etki | Risk |
|---|-------|-------|------|------|
| 30 | Multi-stage Dockerfile | `Dockerfile` | Image boyutu %60+ azalır | 🟡 Orta |
| 31 | `.dockerignore` genişlet | `.dockerignore` | Build context küçülür | 🟢 Düşük |
| 32 | `docker-compose.yml` healthcheck | `docker-compose.yml` | Container orchestration sağlığı | 🟢 Düşük |

**Acceptance Criteria:**
- Docker image boyutu < 200MB olmalı.
- `docker build` süresi (cached) < 30sn olmalı.
- Healthcheck endpoint'i `http://localhost:3000/health` 200 dönmeli.

**Doğrulama:** `docker images | grep penceai`, `docker inspect --format='{{.Size}}' penceai`

---

## Phase 3: Orta Vade (1 Ay)

> **Hedef:** Mimari refaktör, test stratejisi ve monitoring'in tamamlanması.

### 3.1 Mimari Refaktör

| # | Bulgu | Dosya | Etki | Risk |
|---|-------|-------|------|------|
| 33 | Shared interfaces ayrıştır | `src/types/` veya `src/contracts/` | Circular dependency kırılır | 🔴 Kritik |
| 34 | Barrel file kademeli kaldırma | Tüm `index.ts` | Tree-shaking gelişir | 🟡 Orta |
| 35 | Memory manager alt servislere ayır | `src/memory/manager.ts` | SRP sağlanır | 🟡 Orta |
| 36 | Retrieval pipeline chain of responsibility | `src/memory/retrieval/` | Test edilebilirlik artar | 🟡 Orta |

**Acceptance Criteria:**
- `madge --circular src/` çıktısı 0 circular dependency göstermeli.
- Barrel file kaldırılan modüllerde import'lar doğrudan alt dosyalardan yapılmalı.
- `MemoryManager`'ın `CRUD`, `Search`, `Archive` sorumlulukları ayrı class'larda olmalı.

**Doğrulama:** `madge --circular src/`, unit test coverage.

---

### 3.2 Test Altyapısı

| # | Bulgu | Dosya | Etki | Risk |
|---|-------|-------|------|------|
| 37 | Jest `maxWorkers` optimize | `jest.config.js` | Test süresi %30+ azalır | 🟢 Düşük |
| 38 | Mock stratejisi (msw) | `tests/` | Integration test hızlanır | 🟡 Orta |
| 39 | Shared test fixtures | `tests/setup.ts` | Mock tekrarı azalır | 🟢 Düşük |
| 40 | Benchmark test'leri ekle | `tests/benchmark/` | Regresyon tespiti | 🟢 Düşük |
| 41 | WebSocket integration test | `tests/gateway/` | Coverage artar | 🟡 Orta |

**Acceptance Criteria:**
- `npm test` süresi < 60sn olmalı.
- Coverage %70+ olmalı.
- Benchmark test'ler CI'da çalışmalı ve regresyon varsa fail etmeli.

**Doğrulama:** `npm test -- --coverage`, CI pipeline run.

---

### 3.3 CI/CD Pipeline

| # | Bulgu | Dosya | Etki | Risk |
|---|-------|-------|------|------|
| 42 | GitHub Actions CI | `.github/workflows/ci.yml` | Otomatik test/build | 🟡 Orta |
| 43 | Lint + format + test + build | CI pipeline | Kod kalitesi garanti | 🟢 Düşük |
| 44 | Docker build CI'da | CI pipeline | Image her PR'da üretilir | 🟢 Düşük |

**Acceptance Criteria:**
- Her PR'da CI başarıyla çalışmalı.
- Lint hatası varsa PR merge edilememeli (branch protection).
- Docker image her merge'de registry'e push edilmeli.

**Doğrulama:** GitHub Actions run log'ları.

---

### 3.4 Ortam Yönetimi

| # | Bulgu | Dosya | Etki | Risk |
|---|-------|-------|------|------|
| 45 | `.env.example` oluştur | `.env.example` | Onboarding kolaylaşır | 🟢 Düşük |
| 46 | Config validasyon (zod) | `src/gateway/config.ts` | Runtime tip güvenliği | 🟢 Düşük |
| 47 | Log level hot-reload | `src/utils/logger.ts` | Runtime debugging kolaylaşır | 🟢 Düşük |

**Acceptance Criteria:**
- `.env.example` tüm gerekli variable'ları içermeli.
- Eksik config ile uygulama başlamamalı (graceful shutdown).
- `LOG_LEVEL=debug` sonrası log çıktısı anında değişmeli.

**Doğrulama:** `npm start` (eksik env ile), `LOG_LEVEL` değişiklik testi.

---

## Phase 4: Uzun Vade (1-3 Ay)

> **Hedef:** Stratejik değişiklikler, monorepo değerlendirmesi ve ileri seviye optimizasyonlar.

### 4.1 İleri Seviye Optimizasyonlar

| # | Bulgu | Dosya | Etki | Risk |
|---|-------|-------|------|------|
| 48 | Dependency injection container | `src/gateway/bootstrap.ts` | Test edilebilirlik, loose coupling | 🟡 Orta |
| 49 | Frontend/backend ayrımı | `src/web/react-app/` | Monorepo veya ayrı repo | 🔴 Kritik |
| 50 | Distributed tracing | `src/observability/` | Microservice hazırlığı | 🟡 Orta |
| 51 | Monorepo (Turborepo/pnpm) | Proje kökü | Build caching, pipeline | 🟡 Orta |

**Acceptance Criteria:**
- DI container ile tüm servisler constructor injection ile test edilebilmeli.
- Frontend ayrı repo'ya taşınırsa API contract'ı (OpenAPI) tanımlanmalı.
- Distributed tracing span'leri her HTTP/WebSocket request'i için görünür olmalı.

**Doğrulama:** Architecture Decision Record (ADR) dokümanı; prototype.

---

### 4.2 Dokümantasyon & Topluluk

| # | Bulgu | Dosya | Etki | Risk |
|---|-------|-------|------|------|
| 52 | README güncelle | `README.md` | Topluluk katılımı artar | 🟢 Düşük |
| 53 | API dokümantasyonu (OpenAPI) | `docs/api.yml` | Entegrasyon kolaylaşır | 🟢 Düşük |
| 54 | Changelog (CHANGELOG.md) | `CHANGELOG.md` | Versiyon takibi | 🟢 Düşük |

**Acceptance Criteria:**
- README'de quick start < 5 adımda tamamlanabilmeli.
- OpenAPI spec swagger-ui'da görüntülenebilmeli.
- Her release'de CHANGELOG.md güncellenmeli.

**Doğrulama:** Yeni geliştirici onboarding testi (yakın zamanda katılan birisi 30dk içinde çalıştırmalı).

---

## Kaynak Ataması Önerisi

| Rol | Hemen | Kısa Vade | Orta Vade | Uzun Vade |
|-----|-------|-----------|-----------|-----------|
| **Backend Dev (1)** | 1.1, 1.2, 1.3, 1.5 | 2.1, 2.2, 2.3 | 3.1, 3.4 | 4.1 |
| **DevOps/Platform (1)** | 1.4, 1.6 | 2.4 | 3.3, 3.4 | 4.1 |
| **Frontend Dev (1)** | — | — | 3.1 (barrel files) | 4.1, 4.2 |
| **QA/Test (1)** | — | — | 3.2 | — |

---

## Risk Matrisi

| Risk | Olasılık | Etki | Önlem |
|------|----------|------|-------|
| Barrel file kaldırma — import hataları | Orta | Yüksek | Kademeli rollout; `grep` ile tüm import'ları kontrol et |
| SQLite index — write throughput düşüşü | Düşük | Orta | WAL mode aktif; benchmark yap |
| Circuit breaker — erken açılma | Orta | Yüksek | Threshold'u trafiğe göre ayarla; monitoring |
| Docker multi-stage — mevcut pipeline kırılması | Düşük | Yüksek | Staging ortamında 1 hafta test et |
| LLM fallback — maliyet artışı | Orta | Orta | Fallback provider maliyetini hesapla; bütçe onayı al |

---

## Özet: "Önce Şunu Yap"

1. **Bugün:** `tsconfig.json` incremental build + SQLite index'leri.
2. **Bu hafta:** Embedding cache + WebSocket batching + `npm audit fix`.
3. **Bu ay:** Tool paralelleştirme + retrieval paralelleştirme + Docker multi-stage.
4. **Bu çeyrek:** Circular dependency çözümü + CI/CD pipeline + monorepo değerlendirmesi.

---

*Plan tarihi: 2026-04-23*
*Sonraki revizyon: Her aşama tamamlandığında*
