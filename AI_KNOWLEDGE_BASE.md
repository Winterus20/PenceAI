# PençeAI - Proje Mimari ve Bilgi Bankası (AI Knowledge Base)

Bu belge, PençeAI projesini yapay zeka asistanı olarak çok daha hızlı ve kolay anlayıp modifiye edebilmem için oluşturulmuş **kapsamlı referans ve bilgi bankasıdır** (Knowledge yerine geçmesi için tasarlanmıştır). Aradığım bir dosyayı veya mantığı hızlıca bu dokümanda bulabilirim.

## 📌 1. Proje Özeti
**PençeAI**, TypeScript ile yazılmış "self-hosted" (yerel olarak barındırılabilen) ve "local-first" (öncelikli olarak yerel çalışmayı hedefleyen) bir **Yapay Zeka Ajan Platformudur**.
- Yalnızca basit bir sohbet botu değil, anıları (kısa ve uzun vadeli), bellek tiplerini (episodik ve semantik), arka planda düşünme ve graf-tabanlı bağlam getirme gibi bilişsel yetenekleri olan bir sistemdir.
- SQLite tabanlıdır, `better-sqlite3` ve vektör gömme (embedding) arama işlemleri için `sqlite-vec` kullanır.
- Express ve WebSocket altyapısı ile web arayüzü (React) arasında iletişim kurar.

---

## 📂 2. Dizin Yapısı ve Çekirdek Bileşenler

Proje kök dizini: `c:\Users\Yigit\Documents\PenceAI\`

### `src/agent/` - Ajan Çalışma Zamanı (Agent Runtime)
Ajanın düşünme mekanizması, dış araçları (tools) çağırma döngüsü ve karar alma mantığı burada bulunur.
- **`runtime.ts`**: Ajanın asıl çalıştığı, LLM ile iletişime geçtiği, konuşma geçmişini ve bağlamı hazırladığı ana beyin dosyası.
- **`prompt.ts`**: Ajanın sistem komutlarını ve LLM'ye gidecek Prompt stringlerini içerir.
- **`tools.ts`**: Ajanın kullanabileceği araç fonksiyonlarının (tool calling) tanımlandığı yerdir.
- **`runtimeContext.ts`**: Ajanın çalışma bağlamı yardımcıları/tipleri.

### `src/memory/` - Bilişsel Bellek Sistemi (Memory Layer)
Projenin en can alıcı noktalarından biri. Bellek yönetimi, ilişkisel veritabanı bağlantıları, vektörel arama ve bilginin kalıcılığı burada yönetilir.
- **`manager.ts`**: `MemoryManager` sınıfı. Bütün bellek sisteminin merkezidir. Mesaj kayıtları, gömme (embedding) işlemleri, bellek inceleme ve graf işlemlerini orkestre eder.
- **`database.ts`**: SQLite (`better-sqlite3` ve `sqlite-vec`) bağlantısının kurulduğu, şemaların ve temel veritabanı sorgularının yer aldığı dosya.
- **`retrievalOrchestrator.ts`**: Geçmiş anıların nasıl geri çağrılacağına (semantik arama, anahtar kelime veya vektör arama) karar veren sistem.
- **`graph.ts`**: Anılar/Bellekler arası komşulukların (graf düğümleri ve kenarları) ve ilişkilerin kurulduğu mantık. (Spreading activation vb.)
- **`ebbinghaus.ts`**: Ebbinghaus unutma eğrisi mantığı. Bilgilerin zaman içinde gücünün azalması ve unutulma/gözden geçirme döngüsünü ayarlar.
- **`shortTermPhase.ts` / `contextUtils.ts`**: Kısa vadeli bellek (konuşma penceresi) ile alakalı yardımcı araçlar.

### `src/gateway/` - Sunucu, Ağ Geçidi ve İletişim (Gateway Interface)
Uygulamanın dış dünyayla bağlantısını sağlayan giriş noktasıdır.
- **`index.ts`**: Uygulamanın **Ana Giriş Noktasıdır** (`npm run start` veya `npm run dev` ile ilk bu dosya çalışır). Tüm konfigürasyonlar, DB initialization, Web sunucusu ayağa kaldırma burada.
- **`websocket.ts`**: Client/React app ile canlı ve çift yönlü iletişimi sağlayan WebSocket sunucusu mantığı.
- **`bootstrap.ts`**: Sunucu önyükleme ayarları, dashboard vb. başlangıç helperları.
- **`routes.ts`**: RESTful API yönlendirmeleri.
- **`config.ts` / `envUtils.ts`**: `.env` üzerinden okunan çevre değişkenlerinin proje içine aktarımı.

### `src/autonomous/` - Otonom Görevler ve Arka Plan (Autonomous Tasks)
Sistem sessizken veya kullanıcı aktif değilken ajanın arka planda "düşünmesini" sağlayan deneysel altyapı.
- **`worker.ts` & `queue.ts`**: Arka planda çalışan background job (görev) kuyruğunu yönetir (Bellek özetleme, embedding oluşturma, bakım vb).
- **`thinkEngine.ts`**: Dual-process routing (Hızlı tepki vs. Derin Düşünme) ve daha derin anlam çıkarma işlemleri.
- **`curiosityEngine.ts`**: Ajanın kendi kendine araştırma ve merak tabanlı yeni sorular türetme altyapısı.
- **`urgeFilter.ts`**: Sistemde biriken "dürtüleri" ve gerçekleştirilmesi gereken kararları filtreleyen tetikleyici yapı.

### `src/llm/` - Dil Modeli Sağlayıcı Adaptörleri (Providers)
Çoklu LLM Desteği! Hangi modeli kullanmak istersek ilgili adaptör üzerinden istek atılır.
- **Dosyalar:** `openai.ts`, `anthropic.ts`, `ollama.ts`, `nvidia.ts`, `groq.ts`, `mistral.ts`, `minimax.ts`, `github.ts` ve ortak yapı için `provider.ts`.

### `src/router/` - Yönlendirici (Message Routing)
- **`index.ts`, `semantic.ts`, `embedding-worker.ts`**: Farklı kanallardan gelen (örneğin web socket veya REST) içerikleri normalize eder, parse eder ve doğru şekilde işlenmesi için ilgili componentlere dağıtır.

### `src/utils/` - Yardımcı Araçlar
- **`logger.ts`**: `pino` tabanlı kapsamlı log atma servisi.
- **`datetime.ts`**: Tarih hesaplamaları (chrono-node tabanlı).

### `tests/` - Test Klasörü (Jest)
Projeyi doğrulamak için `npm test` ile çalışan birim ve entegrasyon testleri burada yer alır (özellikle `memory/` katmanı detaylı test edilmiştir).

### `src/web/react-app/` - Frontend Uygulaması (React + Vite)
- Uygulamanın kullanıcıya sunduğu arayüz. Web socket üzerinden `gateway` portuna bağlanır. Chat UI, ayarlar ve anıları görüntüleme işlemleri burada yazılıdır.

### Ortam ve Konfigürasyon Dosyaları
- **`package.json`**: Entry point `dist/gateway/index.js` ve dev komutu `tsx watch src/gateway/index.ts`.
- **`.env` / `.env.example`**: API key'ler, veritabanı yolu (`DB_PATH`), varsayılan embedding sağlayıcısı ve model ayarları (`OLLAMA_BASE_URL`, vd.) saklanır.

---

## 🛠️ 3. Olası Görevlerde Nereye Bakmalıyım? (Quick Access)

- **Sistemin Başlangıç Ayarlarını Değiştirmek İçin:** -> `src/gateway/index.ts` ve `src/gateway/bootstrap.ts`
- **Veritabanı Tablosu Eklemek / Sorgu Güncellemek / SQL İzlemek İçin:** -> `src/memory/database.ts`
- **Prompt'u Güncellemek veya Yeni Araç (Tool) Eklemek İçin:** -> `src/agent/prompt.ts` ve `src/agent/tools.ts`
- **Ajanın Cevap Formatını / Karar Mekanizmasını Editlemek İçin:** -> `src/agent/runtime.ts`
- **Yeni Bir LLM Modeli/Provider'ı Kodu Eklemek İçin:** -> `src/llm/` klasörüne yeni bir `[isim].ts` açılıp `src/llm/index.ts` veya `provider.ts`'ye export edilir.
- **Anıların Silinme veya Hatırlanma (Vektör arama) Mantığını Değiştirmek İçin:** -> `src/memory/manager.ts` ve `src/memory/retrievalOrchestrator.ts`
- **Arka Planda Kendi Kendine Düşünme / Cron Görevleri İçin:** -> `src/autonomous/` içindeki Worker ve ThinkEngine kısımları.
- **Client (Tarayıcı) - Sunucu arasındaki iletişime Web Socket event'i eklemek için:** -> `src/gateway/websocket.ts`

Bu döküman projeye tamamen entegre olmak ve geliştirme hızımı maksimize etmek için özel olarak filtrelenip detaylandırılmıştır. Hızlı erişim için kullanılmalıdır.
