# PenceAI — Sonraki Adımlar Analizi

> **Tarih:** 4 Nisan 2026  
> **Durum:** Projenin mevcut durumu incelendi, stratejik yol haritası oluşturuldu

---

## 📊 Mevcut Durum Özeti

### ✅ Güçlü Yanlar
- **Bellek Sistemi:** GraphRAG, Ebbinghaus, spreading activation, dual-process retrieval — oldukça olgun
- **LLM Çeşitliliği:** 8 provider (OpenAI, Anthropic, Ollama, MiniMax, GitHub, Groq, Mistral, NVIDIA)
- **Araç Sistemi:** Zod validation, güvenlik kontrolleri, web araçları — sağlam
- **Frontend:** Modüler store (slices), shadcn/ui bileşenleri, dark mode — temel hazır
- **Test Kapsama:** Memory katmanı iyi test edilmiş (7+ test dosyası)

### ⚠️ Zayıf/Eksik Yanlar
- **MCP Protokolü:** Yok — 2026'da standart haline geldi, entegrasyon kritik
- **Observability:** Sadece pino loglama — LLM trace/cost tracking yok
- **Docker/Deployment:** Yok — self-hosted felsefe için zorunlu
- **Frontend Testleri:** Yapısı var ama kapsam sınırlı
- **CI/CD Pipeline:** Yok
- **Token Usage Tracking:** Yok — maliyet kontrolü eksik

---

## 🎯 Önerilen Yol Haritası

Öncelik sırasını belirlerken şu kriterleri kullandım:
1. **Değer/Efor Oranı** — En az çabayla en çok fayda
2. **Bağımlılık Zinciri** — Diğer özelliklerin önkoşulu olanlar önce
3. **Kullanıcı Deneyimi** — Günlük kullanımda hissedilir iyileştirmeler
4. **Teknik Borç** — Biriken riskleri azaltma

---

### 🔴 Kademe 1: Hemen Yapılmalı (Bu Hafta)

#### 1.1 MCP (Model Context Protocol) Entegrasyonu
| | |
|---|---|
| **Öncelik** | 🔴 KRİTİK |
| **Tahmini Süre** | 3-5 gün |
| **Zorluk** | ⭐⭐⭐ |

**Neden şimdi?**
- 2026'nın de facto agent standardı — her major AI şirketi benimsedi
- Mevcut tool sistemi (`tools.ts`) MCP ile paralel çalışabilir
- Harici MCP sunucularına bağlantı, araç keşfi otomatik olur
- Projenin "ekosistem uyumluluğunu" dramatik şekilde artırır

**Yapılacaklar:**
1. `@modelcontextprotocol/sdk` kurulumu
2. `src/agent/mcp/client.ts` — MCPClientManager
3. `runtime.ts` entegrasyonu (tool resolution'a MCP ekleme)
4. `.env` yapılandırma: `MCP_SERVERS`, `ENABLE_MCP`
5. Mevcut araçlarla paralel çalışma (feature flag)

> [!IMPORTANT]
> Bu özellik, projenin diğer AI agent'larla ve araç ekosistemiyle konuşabilmesi için **en kritik** eksik parça.

---

#### 1.2 Token Usage & Cost Tracking
| | |
|---|---|
| **Öncelik** | 🔴 YÜKSEK |
| **Tahmini Süre** | 1-2 gün |
| **Zorluk** | ⭐⭐ |

**Neden şimdi?**
- Her LLM çağrısında token kullanımı takip edilmiyor — maliyet kontrolü imkansız
- Provider response'larından `usage` bilgisi zaten geliyor ama kaydedilmiyor
- Hem backend DB'ye kayıt hem frontend'de gösterim gerekli

**Yapılacaklar:**
1. `src/memory/database.ts`'e `token_usage` tablosu ekle
2. Her provider'ın `chat()` dönüşünde `usage` bilgisini yakala ve kaydet
3. `src/gateway/routes.ts`'e `/api/usage/stats` endpoint'i
4. Frontend'de basit bir kullanım dashboard'u (Settings dialog'a tab olarak)

---

### 🟡 Kademe 2: Kısa Vadeli (1-2 Hafta İçinde)

#### 2.1 Docker Compose Deployment
| | |
|---|---|
| **Öncelik** | 🟡 YÜKSEK |
| **Tahmini Süre** | 2-3 gün |
| **Zorluk** | ⭐⭐ |

**Neden?** Self-hosted felsefenin doğal uzantısı. Planlar zaten `FUTURE_IMPLEMENTATION_PLAN.md`'de hazır.

**Yapılacaklar:**
1. `Dockerfile` (backend, multi-stage build)
2. `Dockerfile.frontend` (React + Nginx)
3. `docker-compose.yml` (backend + frontend + opsiyonel Ollama + Langfuse)
4. `nginx.conf` (reverse proxy, WebSocket desteği)
5. README güncellemesi

---

#### 2.2 Langfuse Observability
| | |
|---|---|
| **Öncelik** | 🟡 ORTA-YÜKSEK |
| **Tahmini Süre** | 3-4 gün |
| **Zorluk** | ⭐⭐ |

**Neden?** Token tracking'in doğal uzantısı. LLM çağrı zincirleri, prompt versioning, cost analytics.

**Bağımlılık:** Token usage tracking (1.2) tamamlanmalı

**Yapılacaklar:**
1. `langfuse` SDK kurulumu
2. `src/utils/langfuse.ts` — Langfuse client singleton
3. Provider'lara trace/generation entegrasyonu
4. `runtime.ts`'e session-level tracing
5. Docker Compose'a Langfuse servisi ekleme

---

#### 2.3 Frontend Polish: Streaming UX İyileştirmeleri
| | |
|---|---|
| **Öncelik** | 🟡 ORTA |
| **Tahmini Süre** | 2-3 gün |
| **Zorluk** | ⭐⭐ |

**Neden?** Kullanıcı deneyiminde en çok hissedilen alan. Streaming cevaplarda:
- Tool kullanım göstergesi (hangi araç çağrıldı, ne kadar sürdü)
- Syntax highlighting iyileştirmesi (CodeBlock.tsx zaten var ama geliştirilmeli)
- Daha akıcı typing indicator ve mesaj geçişleri
- Ajan düşünce sürecini gösteren "thinking bubbles"

---

### 🟢 Kademe 3: Orta Vadeli (2-4 Hafta İçinde)

#### 3.1 Agentic RAG / Self-RAG
| | |
|---|---|
| **Öncelik** | 🟢 ORTA |
| **Tahmini Süre** | 1 hafta |
| **Zorluk** | ⭐⭐⭐ |

**Neden?** Mevcut dual-process (System1/System2) retrieval çok iyi temel oluşturuyor. Üzerine:
- Self-retrieval karar mekanizması
- Multi-hop retrieval (3-hop)
- Retrieval evaluation (relevance scoring)
- Adaptive chunking (kod vs doküman vs konuşma)

**Bağımlılık:** Langfuse entegrasyonu (debug için çok gerekli)

---

#### 3.2 CI/CD Pipeline
| | |
|---|---|
| **Öncelik** | 🟢 ORTA |
| **Tahmini Süre** | 1-2 gün |
| **Zorluk** | ⭐ |

**Neden?** Proje büyüdükçe manuel test sürdürülemez. `.github/` klasörü zaten mevcut.

**Yapılacaklar:**
1. `.github/workflows/ci.yml` — lint, type-check, test
2. `.github/workflows/docker.yml` — Docker image build & push
3. PR template ve branch protection kuralları

---

#### 3.3 Güvenlik Katmanı: Input/Output Guardrails
| | |
|---|---|
| **Öncelik** | 🟢 ORTA |
| **Tahmini Süre** | 3-4 gün |
| **Zorluk** | ⭐⭐⭐ |

**Neden?** Mevcut güvenlik sadece dosya sistemi ve shell seviyesinde. LLM-specific korumalar eksik:
- Prompt injection tespiti
- Output content filtering
- RAG poisoning koruması
- Rate limiting (per-user, per-tool)

---

### 🔵 Kademe 4: Uzun Vadeli (1-2 Ay İçinde)

#### 4.1 Multi-Agent Orchestration
- Birden fazla ajanın birlikte çalışması (researcher + writer + reviewer)
- A2A (Agent-to-Agent) protokolü

#### 4.2 Voice/Multimodal Interface
- Sesli giriş/çıkış desteği (Whisper + TTS)
- Görsel giriş (image analysis)

#### 4.3 Plugin Sistemi
- Kullanıcıların kendi araçlarını/entegrasyonlarını ekleyebilmesi
- MCP üzerine inşa edilebilir

---

## 📋 Önerilen İlk Adım

Benim tavsiyem **MCP Entegrasyonu (1.1)** ile başlamak. Nedenleri:

1. **En yüksek stratejik değer** — Projenin ekosistem uyumluluğunu anında artırır
2. **Feature flag ile güvenli** — Mevcut sistemi bozmadan paralel çalışır
3. **Diğer modüllere bağımlılık yok** — Hemen başlanabilir
4. **Planlar hazır** — `FUTURE_IMPLEMENTATION_PLAN.md`'de detaylı tasarım mevcut

Alternatif olarak, eğer daha somut ve kullanıcı-facing bir iyileştirme isteniyorsa **Token Usage Tracking (1.2)** küçük ama etkili bir başlangıç adımı olabilir.

---

## 🤔 Sana Sorular

1. **MCP ile mi başlayalım, yoksa önce Token Tracking / Cost gibi daha somut bir iyileştirme mi yapalım?**
2. **Docker deployment yakın zamanda gerekli mi, yoksa şimdilik localhost yeterli mi?**
3. **Frontend tarafında hangi iyileştirme seni en çok rahatsız ediyor?** (streaming UX, tool göstergesi, vb.)
4. **Başka öncelikli gördüğün bir alan var mı?**
