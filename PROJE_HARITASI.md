# Openclaw / PençeAI — Proje Haritası

Bu dosya, projeyi tekrar tekrar keşfetmeden hızlı karar verebilmek için hazırlanmış kalıcı bir referanstır.
Yeni bir görev geldiğinde önce **buraya**, sonra yalnızca ilgili hedef dosyalara bakmak amaçlanır.

---

## 1) Proje ne yapıyor?

Bu proje, yerelde çalışan bir **kişisel AI asistan platformu**.
Temel bileşenler:

- **Chat + agent runtime**
- **Uzun vadeli bellek sistemi** (SQLite + FTS + embedding + graph)
- **Web dashboard**
- **REST API + WebSocket**
- **Arka plan görev kuyruğu / otonom sistem**
- **Birden çok LLM provider desteği**

Kısa akış:

1. Kullanıcı dashboard üzerinden mesaj gönderir.
2. `src/gateway/websocket.ts` mesajı alır.
3. `src/router/semantic.ts` bazı niyetleri LLM’e gitmeden yerelde çözmeye çalışır.
4. Ana akış `src/agent/runtime.ts` içinde işler.
5. Agent, gerekirse tool çağırır, belleği kullanır, LLM provider’a gider.
6. Sonuç WebSocket ile UI’a akar.
7. Konuşma/bellek/özet/graph/decay işlemleri `src/memory/*` ve arka plan worker’ları ile yürür.

---

## 2) En önemli giriş noktaları

### Mutlaka bilinmesi gereken dosyalar

- `src/gateway/index.ts`
  - Sunucunun gerçek giriş noktası.
  - Express, HTTP server, WebSocket, DB, LLM, agent, background worker burada ayağa kalkar.

- `src/agent/runtime.ts`
  - Ana konuşma işleme merkezi.
  - Mesajı bağlama oturtur, prompt kurar, tool çalıştırır, LLM çağırır, streaming event üretir.

- `src/memory/manager.ts`
  - Uygulamanın bellek orkestratörü.
  - Konuşmalar, mesajlar, memory CRUD, arama, decay, graph delegasyonu burada birleşir.

- `src/memory/database.ts`
  - SQLite şema, tablo, FTS, vektör ve yardımcı DB katmanı.

- `src/memory/graph.ts`
  - Memory graph / entity / relation yönetimi.

- `src/web/react-app/src/App.tsx`
  - React frontend’in ana kabuğu.
  - Uygulama layout’unu başlatır ve `ChatWindow` bileşenini yükler.

- `src/web/react-app/src/components/chat/ChatWindow.tsx`
  - Aktif chat ekranının ana bileşeni.
  - Header, mesaj akışı, input alanı, settings ve memory dialog akışını yönetir.

- `src/web/react-app/src/hooks/useAgentSocket.ts`
  - Frontend’in WebSocket istemci katmanı.
  - Gateway ile `/ws` bağlantısını kurar, reconnect yapar ve gelen event’leri store’a işler.

- `src/web/react-app/src/store/agentStore.ts`
  - Zustand tabanlı frontend state merkezi.
  - Mesaj listesi, bağlantı durumu, thinking durumu ve bellek/graph state’i burada tutulur.

- `src/web/react-app/vite.config.ts`
  - Vite build ayarları burada.
  - Frontend build çıktısını `dist/web/public` altına üretir; gateway bu klasörü servis eder.

---

## 3) Mimari özet

### Katmanlar

#### A. Gateway katmanı
- HTTP API sağlar.
- WebSocket chat akışını yönetir.
- Auth, config reload, stats broadcast, static dashboard servis eder.

#### B. Agent katmanı
- Sistem prompt’u kurar.
- Tool tanımlarını LLM’e verir.
- Tool çağrılarını yürütür.
- Hafif / derin memory extraction ve summary üretir.

#### C. Memory katmanı
- SQLite tabanlı kalıcı veri saklar.
- FTS arama + embedding tabanlı semantik arama + hybrid arama sağlar.
- Ebbinghaus tabanlı unutma/tekrar mekanizması içerir.
- Entity/relation graph tutar.

#### D. Autonomous katman
- Arka plan görev kuyruğu.
- Otonom düşünce, merak/araştırma, takip ve iş planlama.

#### E. Web UI
- Vite + React tabanlı tek sayfa dashboard.
- Chat, memory diyaloğu, ayarlar, markdown mesaj akışı ve WebSocket tabanlı canlı cevap deneyimi sağlar.
- Build çıktısı `dist/web/public` altına alınır ve gateway tarafından statik olarak servis edilir.

---

## 4) Dizin bazlı proje haritası

## Kök dizin

- `.gitignore`
  - Git dışında tutulacak dosyaları belirler.

- `package.json`
  - Node/TypeScript projesinin ana manifest’i.
  - Build, dev, start ve test script’leri burada.
  - Giriş noktası olarak dağıtımda `dist/gateway/index.js` kullanılır.

- `package-lock.json`
  - NPM bağımlılık kilidi.

- `tsconfig.json`
  - TypeScript derleme ayarları.
  - ESM tabanlı çıktı ve Node/TS çalışma yapısını belirler.

- `jest.config.js`
  - Test altyapısı konfigürasyonu.
  - TypeScript testlerinin nasıl koşacağını belirler.

- `OPTIMIZATIONS.md`
  - Performans/iyileştirme notları ve teknik backlog.
  - Mimari kararları anlamak için faydalı referans.

- `build_output.txt`
  - Build çıktısı / inceleme logu niteliğinde yardımcı dosya.
  - Kaynak kod değil.

- `memories_dump.txt`
  - Bellek sistemi dump/export çıktısı gibi davranan yardımcı gözlem dosyası.
  - Analiz/debug için kullanılır; ana mantık burada değil.

- `check_duplicates.ts`
  - Muhtemelen duplicate memory tespiti / denetimi için yardımcı script.

- `cleanup_memories.ts`
  - Bellek temizliği veya bakım işlemleri için kullanılan script.

- `test_dedup.ts`
  - Dedup mantığını hızlı test etmek için yardımcı script.

- `cleanup.log`
- `cleanup2.log`
- `cleanup3.log`
- `cleanup4.log`
  - Temizlik script’lerinin çalışma çıktıları / debug logları.
  - Kod değiştirirken genelde ilk bakılacak yer değildir.

- `data/`
  - Çalışma zamanı verileri; SQLite DB ve test DB dosyaları burada olur.
  - Kaynak kod değil, runtime artifact klasörü.

- `logs/`
  - Pino log rotasyonu çıktıları.
  - Örn: `logs/penceai.1.log`

---

## `scripts/`

- `scripts/test_memory_ai.ts`
  - Bellek sistemini uçtan uca denemek için yardımcı script.
  - Temp DB açar, memory ekler, semantic dedup dener, graph işleme ve Ebbinghaus update akışını test eder.

---

## `src/agent/`

- `src/agent/prompt.ts`
  - Sistem prompt üretimi burada.
  - `buildSystemPrompt(...)` kullanıcının adı, bellekler, konuşma özetleri, review bilgileri, ilişkiler gibi bağlamı prompt’a yerleştirir.
  - Yerleşik tool JSON şemaları da burada üretilir: `readFile`, `writeFile`, `listDirectory`, `searchMemory`, `deleteMemory`, `searchConversation`, opsiyonel `executeShell`, opsiyonel `webSearch`.
  - Ayrıca hafif bellek çıkarımı, derin çıkarım, özetleme ve entity extraction prompt’ları burada tanımlıdır.

- `src/agent/runtime.ts`
  - Agent’in gerçek işlem merkezi.
  - Kullanıcı mesajını alır, bellek/konuşma bağlamını toplar, prompt oluşturur, LLM’i çağırır, tool kullanımını yönetir, streaming event’leri üretir.
  - Hafif bellek çıkarımı, derin bellek çıkarımı, konuşma özeti üretimi ve graph işleme gibi üst düzey ajan davranışları burada toplanır.

- `src/agent/tools.ts`
  - Agent’in kullanabildiği built-in araçların gerçek çalışma kodu.
  - Dosya okuma/yazma, dizin listeleme, bellek arama/silme, konuşma geçmişi arama, shell çalıştırma, Brave web araması.
  - Güvenlik burada önemlidir: hassas path kontrolü, onay akışı, tehlikeli shell pattern bloklama, `validatePath(...)` koruması.

---

## `src/autonomous/`

- `src/autonomous/index.ts`
  - Barrel export dosyası.

- `src/autonomous/queue.ts`
  - Kalıcı görev kuyruğu.
  - Görevler öncelik + zamanlama mantığıyla yönetilir.
  - Pending/running görevleri DB’den geri yükleyebilir.

- `src/autonomous/worker.ts`
  - Arka plan işleyicisi.
  - Task queue’dan görev çeker, yürütür, durdurur, kullanıcı aktivitesine göre davranır.

- `src/autonomous/thinkEngine.ts`
  - Memory graph / geçmişten “düşünce tohumu” üretir.
  - Otonom döngünün fikir üretim tarafı.

- `src/autonomous/curiosityEngine.ts`
  - Merak motoru / subagent task üretimi.
  - Bir fixation veya konu başlığını araştırma görevine dönüştürür.

- `src/autonomous/urgeFilter.ts`
  - Otonom düşüncenin kullanıcıya aktarılıp aktarılmayacağını değerlendirir.
  - Feedback, relevance, zaman hassasiyeti ve kullanıcı isteksizliği gibi faktörleri kullanır.

Gateway içinde tanımlı ana background task tipleri:

- `memory_decay`
- `embedding_backfill`
- `ebbinghaus_update`
- `deep_memory_extraction`
- `conversation_summarization`
- `autonomous_tick`
- `subagent_research`

---

## `src/cli/`

- `src/cli/maintenance.ts`
  - CLI bakım script’i.
  - Bellek graph backfill + relationship decay bakımını çalıştırır.
  - Veritabanı ve memory graph sağlığını toparlamak için kullanılır.

---

## `src/gateway/`

- `src/gateway/index.ts`
  - Sunucu bootstrap dosyası.
  - DB, LLM provider, `AgentRuntime`, `TaskQueue`, `BackgroundWorker`, `SemanticRouter`, Express, WebSocket ve dashboard statik servis burada başlar.
  - Dashboard şifre koruması ve WS upgrade auth kontrolü de burada.
  - Ayrıca düzenli memory decay ve embedding backfill görevleri burada schedule edilir.

- `src/gateway/config.ts`
  - `.env` bazlı uygulama konfigürasyonunu yükler.
  - DB yolu, provider seçimi, embedding provider, shell izni, sensitive paths, dashboard şifresi, decay threshold gibi ayarlar burada normalize edilir.
  - `loadConfig()`, `getConfig()`, `reloadConfig()` kritik fonksiyonlardır.

- `src/gateway/envUtils.ts`
  - `.env` dosyasını okuma/yazma yardımcıları.
  - Settings API tarafından kullanılır.

- `src/gateway/routes.ts`
  - REST API route tanımları burada.
  - Memory CRUD, conversations, settings, health, onboarding, provider listesi gibi endpoint’leri içerir.

- `src/gateway/websocket.ts`
  - WebSocket chat akışının merkezi.
  - Mesaj kuyruğu, per-connection thinking mode, confirm request/response, attachment parsing, agent event streaming burada.
  - Kullanıcı dosya eklerini metin/görsel/binary olarak ayrıştırır.

### REST API endpoint özeti

- `GET /api/stats`
- `GET /api/channels`
- `GET /api/conversations`
- `GET /api/conversations/:id/messages`
- `DELETE /api/conversations/:id`
- `GET /api/memories`
- `POST /api/memories`
- `PUT /api/memories/:id`
- `GET /api/memories/search?q=...`
- `DELETE /api/memories/:id`
- `GET /api/memory-graph`
- `GET /api/health`
- `GET /api/settings/sensitive-paths`
- `POST /api/settings/sensitive-paths`
- `DELETE /api/settings/sensitive-paths`
- `GET /api/settings`
- `POST /api/settings`
- `POST /api/onboarding/process`
- `GET /api/llm/providers`

### WebSocket mesaj akışı

İstemciden sunucuya:

- `chat`
- `set_thinking`
- `confirm_response`

Sunucudan istemciye:

- `token`
- `response`
- `agent_event`
- `clear_stream`
- `confirm_request`
- `error`
- `stats`

`agent_event` içinde tipik event’ler:

- `thinking`
- `tool_start`
- `tool_end`
- `iteration`

---

## `src/llm/`

Bu klasör provider mimarisini taşır.

- `src/llm/provider.ts`
  - Ortak provider soyutlaması / interface katmanı.
  - `chat`, opsiyonel `chatStream`, `healthCheck`, model çözümleme gibi ortak sözleşme burada.

- `src/llm/index.ts`
  - Provider registration merkezi.
  - `registerAllProviders()` ve fabrika akışı buradan yönetilir.

- `src/llm/openai.ts`
  - OpenAI tabanlı ana provider implementasyonu.
  - Tool calling ve streaming desteğinin temel omurgası büyük ölçüde burada.

- `src/llm/anthropic.ts`
  - Anthropic/Claude provider entegrasyonu.

- `src/llm/ollama.ts`
  - Yerel Ollama entegrasyonu.
  - Lokal model kullanımı için önemli dosya.

- `src/llm/minimax.ts`
  - MiniMax provider entegrasyonu.

- `src/llm/github.ts`
  - GitHub Models tabanlı provider.
  - OpenAI-benzeri sağlayıcı yaklaşımını yeniden kullanır.

- `src/llm/groq.ts`
  - Groq provider entegrasyonu.

- `src/llm/mistral.ts`
  - Mistral provider entegrasyonu.

- `src/llm/nvidia.ts`
  - NVIDIA NIM provider entegrasyonu.

Not:

- Sağlayıcı seçimi config üzerinden yapılır.
- `registerAllProviders()` çağrılmadan factory ile provider yaratılmaz.

---

## `src/memory/`

Bu klasör projenin en kritik katmanlarından biri.

- `src/memory/database.ts`
  - SQLite şema kurulumunu yapar.
  - `conversations`, `messages`, `memories`, FTS tabloları, embedding tabloları, graph tabloları, settings ve benzeri kalıcı yapılar burada hazırlanır.
  - DB erişim nesnesi ve kapanış işlemleri de buradadır.

- `src/memory/manager.ts`
  - Yüksek seviye bellek orkestratörü.
  - Konuşma açma, geçmiş okuma, memory ekleme/düzenleme/silme, FTS arama, semantik arama, hybrid arama, decay, graph delegasyonu, stats ve ayar erişimi burada.
  - Uygulamadaki en sık dokunulan backend dosyalarından biridir.

- `src/memory/graph.ts`
  - `MemoryGraphManager` benzeri graph mantığını taşır.
  - Entity upsert, memory-entity link, relation oluşturma, komşu bulma, graph export, relation decay, cleanup, proximity relation üretimi gibi işler burada.

- `src/memory/embeddings.ts`
  - Embedding provider factory, embedding hesaplama ve vektör yardımcıları.
  - Semantik arama omurgası.

- `src/memory/ebbinghaus.ts`
  - Ebbinghaus tarzı unutma eğrisi / retrievability / stability mantığı.
  - Belleklerin ne zaman zayıflayacağı ve tekrar gündeme geleceği burada hesaplanır.

- `src/memory/types.ts`
  - Bellek, konuşma, graph, arama ve ilişkili domain tipleri.

### Bellek subsystem genel akışı

1. Mesaj/konuşma SQLite’a kaydedilir.
2. Önemli bilgi çıkarılırsa `memories` tablosuna eklenir.
3. Embedding hesaplanırsa vektör tablosuna yazılır.
4. Entity/relation bilgisi çıkarılırsa graph tabloları güncellenir.
5. Aramalarda FTS + embedding + graph expansion birlikte kullanılır.
6. Zamanla decay ve review mekanizması devreye girer.

---

## `src/memory/extraction/`

- `src/memory/extraction/pipeline.ts`
  - `ExtractorPipeline` sınıfı.
  - Step zincirini sırayla çalıştırır; text yeterince küçülürse early-exit yapar.

- `src/memory/extraction/types.ts`
  - `ExtractedEntity`, `ExtractedRelation`, `ExtractionContext`, `ExtractorStep` tipleri.

### `src/memory/extraction/steps/`

- `datetime.ts`
  - Tarih/zaman ifadelerini çıkaran step.

- `knownEntities.ts`
  - Zaten bilinen entity’leri regex/lookup benzeri mantıkla yakalayan step.

- `llmFallback.ts`
  - Rule/known-entity tabanlı çıkarım yetmezse LLM destekli fallback extraction step’i.

- `network.ts`
  - Metin içindeki ağ/ilişki bağlamını çıkaran step.

### `src/memory/extraction/utils/`

- Şu an pratikte boş / rezerv klasör görünümünde.

---

## `src/router/`

- `src/router/index.ts`
  - `MessageRouter` sınıfı.
  - Kanal soyutlaması, incoming message handler, outgoing response gönderimi ve `createWebMessage(...)` burada.

- `src/router/semantic.ts`
  - `SemanticRouter` sınıfı.
  - Embedding tabanlı hızlı intent routing yapar.
  - Bazı komutları ana LLM akışına gitmeden yerelde çözmek için kullanılır.

- `src/router/embedding-worker.ts`
  - Worker thread içinde embedding modeli yükler/çalıştırır.
  - `SemanticRouter`’ın ana thread’i bloklamadan çalışması için kritik.

- `src/router/types.ts`
  - Unified message, channel, attachment, tool definition ve benzeri shared tipler.

Gateway içinde şu local semantic intent’ler kayıtlı:

- `clear_queue`
- `worker_status`

---

## `src/utils/`

- `src/utils/datetime.ts`
  - SQLite tarihlerini normalize eden yardımcılar.
  - `normalizeSqliteDate(...)`, `daysSince(...)` gibi sık kullanılan fonksiyonlar var.

- `src/utils/logger.ts`
  - Pino tabanlı logger altyapısı.
  - File rotation, pretty output ve `AsyncLocalStorage` ile traceId desteği içerir.
  - `runWithTraceId(...)` istek/iş bazlı iz sürmek için önemli.

---

## `src/web/react-app/`

- `src/web/react-app/package.json`
  - Frontend’e özel bağımlılıklar ve Vite script’leri burada.

- `src/web/react-app/vite.config.ts`
  - Alias, proxy ve build output ayarlarını taşır.
  - Build sonucu `../../../dist/web/public` klasörüne yazılır.

- `src/web/react-app/src/main.tsx`
  - React uygulamasının giriş noktası.

- `src/web/react-app/src/App.tsx`
  - Uygulama shell’i; ana sayfada `ChatWindow` render eder.

- `src/web/react-app/src/components/chat/ChatWindow.tsx`
  - Chat UI’ın ana container’ı.
  - Header, konuşma geçmişi sidebar’ı, attachment destekli input alanı, export akışı, onboarding ve confirm modal entegrasyonunu içerir.

- `src/web/react-app/src/components/chat/MessageStream.tsx`
  - Mesajları markdown olarak render eder.
  - Kod bloğu kopyalama, attachment önizleme, inline thinking/tool blokları ve mesaj aksiyon butonlarını içerir.

- `src/web/react-app/src/components/chat/SettingsDialog.tsx`
  - Ayarlar modalı için işlevsel React formudur.
  - Provider/model seçimi, API anahtarları, embedding ve gelişmiş runtime ayarlarını `/api/settings` ile senkronize eder.

- `src/web/react-app/src/components/chat/MemoryDialog.tsx`
  - Bellek görünümü için işlevsel modal.
  - Bellek arama, kategori filtreleme, ekleme, düzenleme ve silme işlemlerini yapar.

- `src/web/react-app/src/components/chat/ConfirmDialog.tsx`
  - WebSocket üzerinden gelen hassas tool onay isteklerini kullanıcıya gösterir.
  - Geri sayım, onay ve red akışını yönetir.

- `src/web/react-app/src/components/chat/OnboardingDialog.tsx`
  - İlk kurulum/tanışma akışını React tarafında sunar.
  - Kullanıcı adı ve biyografi bilgisini ayarlar + onboarding API’lerine gönderir.

- `src/web/react-app/src/hooks/useAgentSocket.ts`
  - WebSocket bağlantısı, reconnect ve gelen/giden chat event yönetimi burada.
  - Streaming token, thinking/tool event’leri ve confirm_request akışını store’a işler.

- `src/web/react-app/src/store/agentStore.ts`
  - Zustand state store.
  - Mesajlar, konuşmalar, bağlantı bilgisi, thinking/tool meta verisi ve confirm state burada tutulur.

- `src/web/react-app/src/components/ui/*`
  - Buton, textarea, dialog, scroll area gibi paylaşılan UI primitive’leri.

- `src/web/react-app/src/lib/utils.ts`
  - Sınıf birleştirme (`cn`) gibi frontend yardımcıları.

## `src/web/public_old/`

- Önceki framework’süz dashboard sürümü burada arşivlenmiş durumda.
- Aktif frontend artık burası değil; referans/debug amaçlı tutuluyor.

---

## `tests/`

Test klasörü güçlü; özellikle bellek ve graph sistemi yoğun test edilmiş.

- `tests/curiosity-engine.test.ts`
  - Merak motoru görev üretimi, limitler, cooldown, lifecycle, prompt kurma, rapor parse ve kategori çıkarımı testleri.

- `tests/ebbinghaus.test.ts`
  - Ebbinghaus decay ve stability/retrievability hesaplarının doğruluğu.

- `tests/memory-comprehensive.test.ts`
  - Memory subsystem için geniş kapsamlı toplu davranış testi.

- `tests/memory-database.test.ts`
  - DB şema/CRUD/temel kalıcılık katmanı testleri.

- `tests/memory-extraction.test.ts`
  - Entity/relation extraction ve extraction pipeline davranışları.

- `tests/memory-graph-full.test.ts`
  - Entity yönetimi, relation yönetimi, graph traversal, stability update, relation decay, proximity, cleanup ve graph process akışının kapsamlı testi.

- `tests/memory-integration.test.ts`
  - Bellek katmanları arasındaki entegrasyon senaryoları.

- `tests/memory-manager-full.test.ts`
  - Conversation yönetimi, memory CRUD, arama, decay, settings, stats, graph delegasyonu, follow-up candidate ve stres testlerini kapsar.

- `tests/memory-system.test.ts`
  - Memory sisteminin genel uçtan uca davranışlarını doğrular.

- `tests/think-engine.test.ts`
  - Otonom düşünce üretim mantığı testleri.

- `tests/types.test.ts`
  - Ortak type/domain beklentileri için doğrulamalar.

- `tests/urge-filter.test.ts`
  - Urge filter karar mantığı ve feedback etkileri.

---

## 5) Sık görevlerde ilk bakılacak dosyalar

### UI / dashboard sorunu varsa

Öncelik sırası:

1. `src/web/react-app/src/components/chat/ChatWindow.tsx`
2. `src/web/react-app/src/components/chat/MessageStream.tsx`
3. `src/web/react-app/src/hooks/useAgentSocket.ts`
4. `src/web/react-app/src/store/agentStore.ts`
5. `src/web/react-app/vite.config.ts`
6. `src/gateway/websocket.ts`
7. `src/gateway/routes.ts`

### Mesaj neden yanlış işleniyor / neden LLM yanlış davranıyor?

1. `src/agent/runtime.ts`
2. `src/agent/prompt.ts`
3. `src/agent/tools.ts`
4. `src/llm/provider.ts`
5. İlgili provider dosyası (`openai.ts`, `anthropic.ts`, `ollama.ts` vs.)

### Bellek kaydı / arama / dedup sorunu varsa

1. `src/memory/manager.ts`
2. `src/memory/database.ts`
3. `src/memory/embeddings.ts`
4. `src/memory/graph.ts`
5. `tests/memory-manager-full.test.ts`
6. `tests/memory-graph-full.test.ts`

### Konuşma geçmişi / history / summary sorunu varsa

1. `src/memory/manager.ts`
2. `src/agent/runtime.ts`
3. `src/gateway/routes.ts`
4. `src/web/react-app/src/store/agentStore.ts`
5. `src/web/react-app/src/hooks/useAgentSocket.ts`

### Graph / entity / relation problemi varsa

1. `src/memory/graph.ts`
2. `src/memory/extraction/pipeline.ts`
3. `src/memory/extraction/steps/*`
4. `src/agent/prompt.ts` (entity extraction prompt)
5. `tests/memory-graph-full.test.ts`
6. `tests/memory-extraction.test.ts`

### Otonom sistem / arka plan işi / queue sorunu varsa

1. `src/autonomous/queue.ts`
2. `src/autonomous/worker.ts`
3. `src/autonomous/thinkEngine.ts`
4. `src/autonomous/curiosityEngine.ts`
5. `src/autonomous/urgeFilter.ts`
6. `src/gateway/index.ts`

### Config / ayarlar / .env sorunu varsa

1. `src/gateway/config.ts`
2. `src/gateway/envUtils.ts`
3. `src/gateway/routes.ts`
4. `src/web/react-app/src/components/chat/SettingsDialog.tsx`
5. `src/web/react-app/src/hooks/useAgentSocket.ts`

### Güvenlik / shell / dosya erişimi sorunu varsa

1. `src/agent/tools.ts`
2. `src/gateway/config.ts`
3. `src/gateway/websocket.ts`

---

## 6) Bu projede genelde bakılmaması gereken dosyalar

İlk aşamada aşağıdakilere girmek çoğu görev için gereksizdir:

- `logs/*`
- `cleanup*.log`
- `build_output.txt`
- `memories_dump.txt`
- `data/*` runtime DB dosyaları
- `src/web/public_old/lib/*` vendor dosyaları

Yalnızca debug veya geçmiş inceleme gerekiyorsa bak.

---

## 7) Hızlı teknik notlar

- Proje **TypeScript + ESM** dünyasında çalışıyor.
- Dashboard artık Vite + React tabanlıdır.
- Aktif istemci kodu `src/web/react-app` altındadır; `src/web/public_old` eski dashboard’un arşivlenmiş sürümüdür.
- LLM provider katmanı değiştirilebilir tasarlanmış.
- Memory sistemi projenin asıl diferansiyel kısmı; değişikliklerin çoğu `src/memory/*` tarafını etkiler.
- `AgentRuntime` ve `MemoryManager` birlikte projenin çekirdeğidir.
- Build çıktısı `dist/web/public` altına yazılır ve `src/gateway/index.ts` bu klasörü statik olarak servis eder.
- UI değişikliklerinde önce ilgili modülü hedeflemek daha güvenlidir.

---

## 8) Sonraki görevlerde kullanım önerisi

Yeni iş geldiğinde şu kısa yöntem yeterli:

1. Önce bu dosyada ilgili bölüm bulun.
2. “Sık görevlerde ilk bakılacak dosyalar” listesinden hedef dosyaları seç.
3. Sadece o dosyaları aç.
4. Gerekirse ilgili test dosyasını da aç.

Yani bütün projeyi tekrar taramak yerine önce bu harita kullanılmalı.

---

## 9) Kısa karar ağacı

- **Chat cevap vermiyor mu?** → `gateway/websocket.ts` + `agent/runtime.ts`
- **REST endpoint bozuk mu?** → `gateway/routes.ts`
- **Ayar kaydedilmiyor mu?** → `gateway/routes.ts` + `gateway/envUtils.ts` + `gateway/config.ts`
- **Bellek bulunmuyor mu?** → `memory/manager.ts` + `memory/embeddings.ts` + `memory/database.ts`
- **Graph/UI state görünmüyor mu?** → `memory/graph.ts` + `web/react-app/src/store/agentStore.ts`
- **Otonom işler saçmalıyor mu?** → `autonomous/*` + `gateway/index.ts`
- **Provider hatası mı var?** → `llm/index.ts` + ilgili provider dosyası

---

## 10) Bakım notu

Bu dosya bir “canlı proje indeksi” olarak düşünülmeli.
Yeni klasör/dosya eklendiğinde veya büyük refactor yapıldığında bu dosya da güncellenmeli.
