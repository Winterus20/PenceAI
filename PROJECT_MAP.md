    # PenceAI Proje Haritası

> **Son Güncelleme:** 28 Mayıs 2026  
> **Durum:** İçerik modüler dosyalara taşındı — ana indeks `project/README.md`

Bu dosya geriye dönük uyumluluk için kök dizinde tutulur. Tam proje haritası `project/` altındaki 10 modüler dosyada yaşar.

---

## Hızlı Başvuru

| Konu | Değer / Konum |
|------|----------------|
| Mimari indeks | [`project/README.md`](./project/README.md) |
| Agent kuralları | [`AGENTS.md`](./AGENTS.md) |
| SQLite şema | **v25** — `src/memory/database.ts` |
| Node.js | >= 22.0.0 |
| Config erişimi | `getConfig()` — `src/gateway/config.ts` (doğrudan `process.env` kullanma) |
| Agent kuralları (Türkçe) | `.clinerules/` klasörü |

---

## Modüler İçindekiler

👉 [**Ana İndeks (project/README.md)**](./project/README.md)

1. [Proje Özeti](./project/01-proje-ozeti.md)
2. [Mimari Genel Bakış](./project/02-mimari-genel-bakis.md)
3. [Modül Yapısı](./project/03-modul-yapisi.md)
4. [Veritabanı Şeması](./project/04-veritabani-semasi.md)
5. [Teknoloji Yığını](./project/05-teknoloji-yigini.md)
6. [API Endpoints](./project/06-api-endpoints.md)
7. [WebSocket Protokolü](./project/07-websocket-protokolu.md)
8. [Güvenlik](./project/08-guvenlik.md)
9. [Test Yapısı](./project/09-test-yapisi.md)
10. [Geliştirici Notları](./project/10-gelistirici-notlari.md)

---

## İlgili Dokümantasyon

- **AGENTS.md** — agent'lar için kritik konvansiyonlar (import `.js`, MCP pattern'leri, build gotcha'ları)
