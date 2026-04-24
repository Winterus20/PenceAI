# PenceAI Gateway, LLM Provider'ları & Observability — Optimizasyon Raporu

> **İncelenen Dosya:** `src/gateway/` (ve alt dizinleri), `src/llm/`, `src/observability/`, `src/errors/`, `src/utils/`, ilgili testler
> **Toplam Bulgu:** 37
> **Kritik:** 12 | **Orta:** 16 | **Düşük:** 9

---

## [Goal Description]

Gateway (`src/gateway/`) HTTP/WebSocket sunucusu, LLM (`src/llm/`) çoklu provider entegrasyonu, Observability (`src/observability/`) metrik ve loglama, Errors (`src/errors/`) ve Utils (`src/utils/`) modülleri, PenceAI'nin dış dünya ile iletişim, AI model erişimi ve sistem izlenebilirliğini sağlar. Bu rapor, ağ performansını, LLM maliyet optimizasyonunu, hata yönetimini, güvenlik ve gözlemlenebilirlik zayıflıklarını analiz eder.

---

## User Review Required

> [!IMPORTANT]
> **Circuit Breaker + Fallback Chain:** LLM provider değişikliği, maliyet ve latency etkileri doğurabilir. Özellikle ücretli provider'ların (Anthropic, OpenAI) fallback sıralaması dikkatle planlanmalıdır.
>
> **Rate Limiting Middleware:** Gateway'e eklenen rate limiting, meşru kullanıcıları etkileyebilir. IP bazlı mı user bazlı mı olacağı kararlaştırılmalıdır.

> [!WARNING]
> **WebSocket Batching Değişikliği:** Client-side message buffer + debounce eklenmesi, frontend davranışını değiştirir. Gerçek zamanlılık gereksinimleri göz önünde bulundurulmalıdır.

> [!CAUTION]
> **CORS ve Güvenlik:** Gateway CORS konfigürasyonunun değiştirilmesi, mevcut web client'ların bağlantısını kesebilir. Önce whitelist'i doğrula.

---

## Proposed Changes

### 🔴 Kritik Bulgular

#### [MODIFY] `src/gateway/channels/websocket.ts:76`
- **Sorun:** Her WebSocket mesajı ayrı ayrı gateway'e gönderiliyor, batching yok. Yüksek frekansta tek tek network round-trip.
- **Öneri:** Client-side message buffer + debounce (örn. 50ms) ile toplu gönder. Server-side batch processor ekle.
- **Kod Önerisi:**
  ```typescript
  const messageBuffer: WSMessage[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  
  function queueMessage(msg: WSMessage) {
    messageBuffer.push(msg);
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        gateway.sendBatch(messageBuffer.splice(0));
        flushTimer = null;
      }, 50);
    }
  }
  ```

#### [MODIFY] `src/gateway/channels/websocket.ts:44`
- **Sorun:** Keep-alive ping 30s, idle timeout 2min — production için çok kısa. Sürekli reconnection overhead.
- **Öneri:** Keep-alive 60s, idle timeout 5min yap. Connection pooling ekle.

#### [MODIFY] `src/llm/anthropic.ts` ve diğer provider'lar
- **Sorun:** Rate limiting ve circuit breaker pattern yok. API limit aşıldığında tüm sistem çöker.
- **Öneri:** `opossum` veya `cockatiel` kütüphanesi ile circuit breaker ekle. Her provider için ayrı rate limiter.
- **Kod Önerisi:**
  ```typescript
  import CircuitBreaker from 'opossum';
  
  const breaker = new CircuitBreaker(callAnthropic, {
    timeout: 30000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
  });
  ```

#### [MODIFY] `src/llm/provider.ts`
- **Sorun:** Model fallback chain (bir provider down olursa diğerine geçiş) zayıf implementasyonlu veya yok.
- **Öneri:** Priority-based fallback chain tanımla. Her provider health check ile izlenmeli.
- **Kod Önerisi:**
  ```typescript
  const providerChain = [
    { name: 'anthropic', priority: 1, fallbackOn: ['timeout', 'rate_limit'] },
    { name: 'groq', priority: 2, fallbackOn: ['timeout', '5xx'] },
    { name: 'ollama', priority: 3, fallbackOn: ['all'] },
  ];
  ```

#### [MODIFY] `src/llm/` (tüm provider dosyaları)
- **Sorun:** Timeout yönetimi tutarsız. Bazı provider'larda `fetch` timeout yok, bazılarında sabit değer.
- **Öneri:** `AbortController` ile standart timeout (30sn) uygula. Tüm provider'lar aynı timeout stratejisini kullansın.

#### [MODIFY] `src/llm/llmCache.ts`
- **Sorun:** LLM response cache key oluşturma mantığı zayıf. Prompt'taki whitespace farklılıkları cache miss'e neden oluyor.
- **Öneri:** Cache key için prompt'u normalize et (trim, collapse whitespace). Hash input'u sabitle.
- **Kod Önerisi:**
  ```typescript
  function normalizePrompt(prompt: string): string {
    return prompt.replace(/\s+/g, ' ').trim();
  }
  const cacheKey = hash(normalizePrompt(prompt) + model + temperature);
  ```

#### [MODIFY] `src/gateway/services/completionService.ts:87`
- **Sorun:** İki ayrı `await` ile sıralı çağrı: önce LLM cache, sonra model. Pipeline edilebilir.
- **Öneri:** Cache check ve model çağrısını pipeline pattern ile optimize et. Cache miss durumunda hemen model çağrısına geç.
- **Kod Önerisi:**
  ```typescript
  const cached = await llmCache.get(key);
  if (cached) return cached;
  // Hemen model çağrısına geç, paralel başlat
  const responsePromise = model.generate(messages);
  ```

#### [MODIFY] `src/gateway/services/completionService.ts:102`
- **Sorun:** `convertGatewayMessages` + token sayma + embedding cache + tool formatlama hepsi aynı fonksiyonda sıralı.
- **Öneri:** Her adımı ayrı fonksiyona böl; bağımsız adımları (`convertGatewayMessages`, `buildSystemPrompt`) paralel çalıştır.

#### [MODIFY] `src/gateway/middleware/` (güvenlik)
- **Sorun:** Input sanitization eksik. Kullanıcı girdileri doğrudan LLM prompt'una veya SQL'e aktarılıyor.
- **Öneri:** `express-rate-limit`, `helmet`, `dompurify` benzeri middleware ekle. Prompt injection için input validation.

#### [MODIFY] `src/gateway/routes.ts`
- **Sorun:** Route handler'larında error boundary yok. Bir route çökerse Express app crash edebilir.
- **Öneri:** `asyncHandler` wrapper kullan. `express-async-errors` veya her route'u `try/catch` ile sarmala.
- **Kod Önerisi:**
  ```typescript
  const asyncHandler = (fn: RequestHandler) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
  app.get('/api/completion', asyncHandler(completionHandler));
  ```

#### [MODIFY] `src/observability/metricsCollector.ts`
- **Sorun:** Metrics collection synchronous ve her request'te çalışıyor. Yüksek trafikte overhead yüksek.
- **Öneri:** Async batch metrics collector kullan. Ring buffer + flush interval (5sn). Prometheus pushgateway değerlendir.

#### [MODIFY] `src/utils/logger.ts`
- **Sorun:** Log seviyesi runtime'da değiştirilemiyor. `debug` log'ları production'da da hesaplanıyor.
- **Öneri:** `pino` veya `winston` ile structured logging. Log level'i `LOG_LEVEL` env'den oku. Hot-reload desteği.

---

### 🟡 Orta Bulgular

#### [MODIFY] `src/llm/cachedProvider.ts`
- **Sorun:** Provider cache'lenmiş instance'ları memory'de tutuyor ama TTL yok. Bellek baskısı.
- **Öneri:** Provider instance'larına LRU cache ile TTL ekle. Kullanılmayan provider'ları dispose et.

#### [MODIFY] `src/gateway/attachmentProcessor.ts`
- **Sorun:** Dosya işleme (upload) synchronous stream kullanıyor. Büyük dosyalarda event loop bloke olur.
- **Öneri:** Worker thread'e taşı veya `busboy` + async stream kullan. Max file size limiti ekle.

#### [MODIFY] `src/llm/openai.ts`, `src/llm/groq.ts`, vb.
- **Sorun:** Her provider dosyasında aynı retry/backoff mantığı tekrar ediyor.
- **Öneri:** Ortak retry decorator/utility oluştur. `async-retry` veya `p-retry` kütüphanesi kullan.

#### [MODIFY] `src/gateway/websocket.ts:82-83`
- **Sorun:** `JSON.stringify` öncesi nesne doğrulama (validation) yok. Circular reference riski.
- **Öneri:** `fast-json-stringify` veya `safe-stable-stringify` kullan. Schema-based serialization.

#### [MODIFY] `src/llm/` provider'ları
- **Sorun:** Streaming response handling tutarsız. Bazı provider'larda stream parse hatası tüm response'u bozar.
- **Öneri:** Stream parser'ları isolate et. Her chunk'ı ayrı `try/catch` ile işle. Partial JSON buffer kullan.

#### [MODIFY] `src/gateway/config.ts`
- **Sorun:** Config validasyonu runtime'da yapılmıyor. Eksik env variable'lar geç fark ediliyor.
- **Öneri:** `zod` schema ile config validasyonu. Uygulama başlangıcında `config.parse(process.env)`.

#### [MODIFY] `src/utils/costCalculator.ts`
- **Sorun:** Token başına maliyet hesaplaması hardcoded. Provider fiyat değişikliklerinde güncelleme gerekir.
- **Öneri:** Fiyat verilerini dış API'den veya config dosyasından çek. Periyodik güncelleme mekanizması.

#### [MODIFY] `src/errors/index.ts`
- **Sorun:** Error class'ları arasında tutarsız property isimlendirmesi (`message`, `detail`, `meta` karışık).
- **Öneri:** Base `AppError` class'ını standartlaştır. Tüm error'lar `code`, `message`, `statusCode`, `context` içersin.

#### [MODIFY] `src/utils/datetime.ts`
- **Sorun:** Tarih/zaman işlemleri native `Date` ile. `Intl` API kullanımı sınırlı. Timezone hataları riski.
- **Öneri:** `date-fns-tz` veya `luxon` kullan. Tüm datetime işlemleri UTC'de tut, presentation'da convert et.

#### [MODIFY] `src/gateway/userName.ts`
- **Sorun:** Kullanıcı adı üretimi deterministik değil. Test edilemez.
- **Öneri:** Seeded random kullan veya önceden tanımlı ad listesi ile deterministik seçim.

#### [MODIFY] `src/llm/minimax.ts`, `src/llm/mistral.ts`, `src/llm/nvidia.ts`
- **Sorun:** Daha az kullanılan provider'lar eksik error handling'e sahip. Timeout ve retry yok.
- **Öneri:** Tüm provider'ları ortak base class/utility üzerinden yeniden yapılandır.

#### [MODIFY] `src/gateway/bootstrap.ts`
- **Sorun:** Bootstrap sırası hardcoded. Dependency injection yok. Test edilemez.
- **Öneri:** DI container (örn. `tsyringe`, `inversify`) veya factory pattern kullan. Bootstrap aşamalarını async graph olarak tanımla.

#### [MODIFY] `src/llm/index.ts`
- **Sorun:** LLM modülü barrel export. Tüm provider'lar tek noktadan import ediliyor. Bundle boyutu artar.
- **Öneri:** Kullanıcı sadece ihtiyaç duyduğu provider'ı import etsin. Dynamic import değerlendir.

#### [MODIFY] `src/utils/thinkTags.ts`
- **Sorun:** `<think>` tag parse'ı regex tabanlı. Büyük çıktılarda greedy match yavaşlar.
- **Öneri:** Streaming state machine parser kullan. `<think>` tag'ini chunk chunk işle.

#### [MODIFY] `src/gateway/jobs/`
- **Sorun:** Background job'lar (varsa) queue ve retry mekanizması yok. Job fail olursa kaybolur.
- **Öneri:** `bullmq` veya `pg-boss` ile job queue ekle. Dead letter queue tanımla.

---

### 🟢 Düşük Bulgular

#### [MODIFY] `src/utils/logRingBuffer.ts`
- **Sorun:** Ring buffer boyutu hardcoded. Konfigüre edilemez.
- **Öneri:** Constructor'dan `capacity` al. `LOG_RING_BUFFER_SIZE` env variable desteği ekle.

#### [MODIFY] `src/gateway/intents.ts`
- **Sorun:** Intent matching regex tabanlı. Yeni intent eklemek kod değişikliği gerektiriyor.
- **Öneri:** Intent'leri config dosyasından veya database'den yükle. Regex'leri runtime compile et.

#### [MODIFY] `src/llm/github.ts`
- **Sorun:** GitHub Models provider'ı beta/experimental. Error handling yetersiz.
- **Öneri:** Experimental provider'ları ayrı modülde tut. Stabil provider'lardan izole et.

#### [MODIFY] `src/gateway/middleware/` (CORS)
- **Sorun:** CORS konfigürasyonu production için gevşek olabilir. `*` origin izni riskli.
- **Öneri:** Whitelist'e alınan domain'leri env'den oku. `Access-Control-Allow-Origin` dynamic set et.

#### [MODIFY] `tests/gateway/`
- **Sorun:** Gateway test'lerinde supertest kullanımı var ama WebSocket test coverage düşük.
- **Öneri:** `ws` kütüphanesi ile WebSocket integration test'i ekle. Connection lifecycle test et.

#### [MODIFY] `src/llm/ollama.ts`
- **Sorun:** Ollama provider'ı local only. Docker/network ortamında bağlantı hatalarına açık.
- **Öneri:** Health check endpoint'i (`/api/tags`) ile bağlantıyı test et. Bağlantı yoksa provider'ı devre dışı bırak.

#### [MODIFY] `src/utils/index.ts`
- **Sorun:** Utils barrel export. Gereksiz fonksiyonlar bundle'a dahil olabilir.
- **Öneri:** Barrel file'ı kaldır veya dynamic re-export kullan.

#### [MODIFY] `src/observability/metricsCollector.ts`
- **Sorun:** Metrics endpoint'i (`/metrics`) authentication yok. Herkes erişebilir.
- **Öneri:** `/metrics` endpoint'ini IP whitelist veya API key ile koru.

#### [MODIFY] `src/gateway/envUtils.ts`
- **Sorun:** Environment variable parse'ı `process.env` üzerinden direkt. Tip güvenliği yok.
- **Öneri:** `envalid` veya `dotenv-safe` kullan. Tip güvenli env config oluştur.

---

## Open Questions

1. **Circuit Breaker Threshold:** Error threshold %50 uygun mu? Düşük trafikte erken açılabilir. --dinamik olmasını konuşalım bunu yapmadan önce bana sor
2. **Rate Limiting Stratejisi:** IP bazlı mı user ID bazlı mı? WebSocket connection başına mı? --rate limit olmayacak şu an 
3. **Metrics Backend:** Prometheus mu, Datadog mu, yoksa custom dashboard mu? Karar verilmeli.  --bunlar ne demek bana açıkla yapmadan önce
4. **Provider Fallback Cost:** Ücretli provider'dan ücretsiz/provider'a fallback, maliyet optimizasyonu mu yoksa kalite düşüşü mü? --anlamadım
5. **Streaming Parse Hatası:** Stream parse hatası durumunda tüm response'u mu atmalı, kısmi sonucu mu döndürmeli?  --tüm response u atmalı

---

## Verification Plan

### Automated Tests

- [ ] `websocket.test.ts` — Batching davranışı testi. 10 mesajın 50ms içinde toplu gönderildiğini doğrula.
- [ ] `circuitBreaker.test.ts` — 5 hata sonrası circuit açılmasını, 30sn sonra kapanmasını test et.
- [ ] `fallbackChain.test.ts` — Primary provider down olduğunda secondary'ye geçiş testi.
- [ ] `rateLimit.test.ts` — 100 req/dk limiti aşıldığında 429 döndüğünü doğrula.
- [ ] `metricsCollector.test.ts` — Batch flush interval'ının 5sn olduğunu doğrula.
- [ ] `completionService.test.ts` — Paralel adım çalıştırma testi (convert + buildSystemPrompt).

### Manual Verification

- [ ] WebSocket bağlantı stability: 1 saat boyunca bağlı kalma, ping/pong sayısını ölç.
- [ ] LLM fallback latency: Primary down simülasyonunda geçiş süresi < 2sn olmalı.
- [ ] Log level hot-reload: `LOG_LEVEL=debug` sonrası log çıktısını anında gör. `LOG_LEVEL=error` sonrası debug log'ları kesilmeli.
- [ ] Security scan: `nmap` veya `owasp-zap` ile gateway port taraması yap. Açık endpoint'leri listele.

---

*Rapor tarihi: 2026-04-23*
