# PenceAI — Kapsamlı İyileştirme Planı

> **Durum:** Keşif Tamamlandi | **Hedef:** Mevcut 186 kaynak + 56 TSX + 99 test dosyasinin kalitesini artirmak
> **Odak:** Yeni ozellik degil, mevcut kodun saglamlastirilmasi
> **Tarih:** 22 Nisan 2026

---

##  Mevcut Durum Ozeti

| Metrik | Deger | Durum |
|--------|-------|-------|
| Kaynak Dosyalari (`.ts`) | 186 | |
| React Bilesenleri (`.tsx`) | 56 | |
| Test Dosyalari (`.test.ts`) | 99 | |
| Toplam Kaynak Satir | ~41,731 | |
| Toplam Test Satir | ~32,397 | |
| TypeScript Derleme (`tsc --noEmit`) | 0 hata | |
| ESLint | **Yapilandirma hatasi** | |
| `npm audit` | **14 zafiyet** (5 moderate, 4 high, 5 critical) | |
| `any` Kullanimi | ~3,400+ eslesme | |
| `as any` Kullanimi | 53 adet | |
| `console.*` Kullanimi | 879 adet | |
| TODO/FIXME/HACK/XXX | 150 adet | |
| Test Coverage (ornek: llm) | ~75% statements, ~49% branches | |
| Git Hooks | Yok | |

---

## 1.  Test Altyapisi

### 1.1 Hiz ve Kararlilik
- **Sorun:** `npm test` tam suitte timeouta ugruyor; bazi testler cok uzun suruyor.
- **Eylem:**
  - Jest `--maxWorkers` ve `--testTimeout` degerlerini optimize et.
  - Agir GraphRAG/integration testlerini ayri bir `test:slow` scriptine tasiya.
  - Test veritabani olusturma/teardown sureclerini hizlandir (in-memory SQLite kullanimini yayginlastir).

### 1.2 Coverage Hedefleri
- **Sorun:** Dusuk branch coverage (~49% ornek modulde); pek cok dosya hic test edilmiyor.
- **Eylem:**
  - Her kaynak modul icin minimum %70 statement, %50 branch coverage hedefi koy.
  - Coverage raporunu CIda zorunlu hale getir.
  - **Oncelikli test eksiklikleri:**
    - `src/gateway/` (sadece 1 test dosyasi)
    - `src/router/`
    - `src/utils/`
    - `src/cli/`
    - `src/agent/mcp/` (19 dosya, cok az test)
    - `src/web/react-app/src/` (React bilesen testleri sinirli)

### 1.3 Test Kalitesi
- **Sorun:** Bazi testler implementasyon detayina fazla bagimli.
- **Eylem:**
  - Mock kullanimini azalt, integration test oranini artir.
  - Test fixturelarini merkezi `tests/fixtures/` dizinine tasiya.
  - Her test dosyasinda `describe` bloklari icin tutarli isimlendirme standardi getir.

---

## 2.  TypeScript Kalitesi

### 2.1 ESLint Duzenlenmesi
- **Sorun:** `@typescript-eslint/consistent-type-imports` kuralinda `fixStyle: 'inline-imports'` desteklenmiyor.
- **Eylem:**
  - `eslint.config.mjs` dosyasinda `fixStyle: 'inline-type-imports'` olarak duzelt.
  - Alternatif olarak kurali gecici olarak kaldir ve `typescript-eslint` surum uyumlulugunu kontrol et.

### 2.2 `tsconfig.json` Modernizasyonu
- **Sorun:** `ignoreDeprecations: "5.0"` kullaniliyor; `isolatedModules` jest configde deprecated.
- **Eylem:**
  - `ignoreDeprecations` kaldir, temel sorunu coz.
  - `isolatedModules: true` degerini `tsconfig.json`a tasiya, jest configden kaldir.
  - `"noUncheckedIndexedAccess"` ekle, potansiyel undefined hatalarini yakalamak icin.
  - `"exactOptionalPropertyTypes"` ekle, opsiyel alan tiplerini siki tut.

### 2.3 `any` Kullaniminin Azaltilmasi
- **Sorun:** ~3,400+ `: any` kullanimi; 53 `as any` kullanimi.
- **Eylem:**
  - `no-explicit-any` kuralini `warn`dan `error`a yukselt (dosya bazli exception listesi ile).
  - Oncelikle temel katmanlardaki (`src/llm/`, `src/memory/`, `src/utils/`) `any` kullanimlarini temizle.
  - `unknown` tipini tercih et; type guardlar ile guvenli daraltma yap.

### 2.4 `console.*` Temizligi
- **Sorun:** 879 `console.*` cagrisi; projede pino kullanilmasina ragmen yaygin.
- **Eylem:**
  - `no-console` kuralini `warn` olarak etkinlestir.
  - Her `console.log/error/warn`i pino loggera cevir; `console` kullanimini sadece CLI araclariyla sinirla.

---

## 3.  Guvenlik

### 3.1 Bagimli Zafiyetler
- **Sorun:** 14 npm audit zafiyeti; kritik olanlar `handlebars`, `protobufjs`.
- **Eylem:**
  - `npm audit fix` ile cozulebilenleri hemen uygula (`@hono/node-server`, `axios`, `basic-ftp`, `brace-expansion`, `follow-redirects`, `lodash`, `path-to-regexp`, `picomatch`).
  - Kritik `handlebars` guncellemesi — proje icin gerekliyse surum yukselt, degilse kaldir.
  - `protobufjs` zafiyeti `@xenova/transformers` icin gecerli; ONNX runtime dependency zincirini degerlendir ve alternatif embedding providerlari goz onunde bulundur.

### 3.2 Guvenlik Politikalari
- **Eylem:**
  - ` helmet ` middlewareini Express gatewaye ekle (CSP, HSTS, X-Frame-Options).
  - Rate limiting middlewareini (`express-rate-limit`) tum public endpointlere uygula.
  - WebSocket baglanti validasyonunu guclendir — origin kontrolu ekle.

---

## 4.  Performans

### 4.1 Veritabani
- **Sorun:** SQLite bircok yerde disk dosyasi uzerinden calisiyor; testlerde bile.
- **Eylem:**
  - Test ortaminda `:memory:` modulunu zorunlu kil.
  - Uzun suren sorgular icin query execution time loggingi ekle.
  - `better-sqlite3` prepared statement cache kullanimini gozden gecir.

### 4.2 Hafiza Yonetimi
- **Sorun:** GraphRAG ve embedding islemleri bellek yogun.
- **Eylem:**
  - Buyuk embedding vectorleri icin streaming isleme patterni uygula.
  - LRU cache boyutlarini yapilandirilabilir hale getir.
  - `pino-roll` log rotasyonunu gozden gecir; cok buyuk log dosyalari riski.

### 4.3 Build Optimizasyonu
- **Eylem:**
  - `tsc` build surecini hizlandirmak icin `incremental` derlemeyi etkinlestir.
  - `src/web/react-app` icin ayrı bir `tsconfig.json` olustur; root configde `composite` ve `references` kullan.

---

## 5.  Gelistirici Deneyimi (DX)

### 5.1 Git Hooks
- **Sorun:** `.git/hooks/` dizininde sadece ornek dosyalar var; pre-commit/pre-push yok.
- **Eylem:**
  - `husky` + `lint-staged` kurulumu yap:
    - `pre-commit`: `lint-staged` ile sadece staged dosyalari lintle ve formatla.
    - `pre-push`: `tsc --noEmit` ve `npm test` calistir.
  - Commit mesaji formatini kontrol eden bir `commit-msg` hooku ekle (Conventional Commits).

### 5.2 Script Standartlastirmasi
- **Sorun:** `package.json` scriptleri karmasik; `dev:backend` ve `dev:backend-only` ayni.
- **Eylem:**
  - Tekrarlayan scriptleri kaldir.
  - `test:unit`, `test:integration`, `test:e2e`, `test:coverage` olmak uzere net ayirim yap.
  - Her scriptin ne yaptigini kisa aciklama ekle.

### 5.3 IDE Entegrasyonu
- **Eylem:**
  - `.vscode/settings.json` ve `.vscode/extensions.json` ekle (Debugger, TypeScript, ESLint, Prettier onerileri).
  - `import` organizasyonu icin `.prettierrc`de `importOrder` kurallari belirle.

---

## 6.  Kod Bakimi

### 6.1 Kod Kalitesi Kurallari
- **Eylem:**
  - ESLint `complexity` kurali ekle (maksimum cyclomatic complexity = 15).
  - `max-lines-per-function` kurali ekle (maksimum 100 satir).
  - `no-nested-ternary` kurali ekle.

### 6.2 TODO/FIXME Takibi
- **Sorun:** 150 TODO/FIXME/HACK/XXX yorumu kaynak kodda daginik.
- **Eylem:**
  - Her biri icin ayrı GitHub issue ac (veya Jira ticketlari olustur).
  - Acil olanlari (HACK, XXX) 1 sprint icinde coz, geri kalanlari planla.
  - `eslint-plugin-todo` ile TODO yorumlarini otomatik takibe al.

### 6.3 Dokumantasyon
- **Eylem:**
  - Her public fonksiyon ve class icin JSDoc/TSDoc zorunlu hale getir.
  - `README.md`ye katkı rehberi (CONTRIBUTING.md) ekle.
  - Mimari kararlari `docs/architecture/` altinda ADR (Architecture Decision Record) olarak kaydet.

---

## 7.  Oncelik Sirasi ve Zaman Cizelgesi

| Faz | Konu | Tahmini Sure | Oncelik |
|-----|------|-------------|---------|
| **Faz 1** | ESLint duzeltmesi, `tsconfig` guncellemesi, `npm audit fix` | 1 gun | Kritik |
| **Faz 2** | Git hooks (husky + lint-staged), script standartlastirmasi | 1 gun | Yuksek |
| **Faz 3** | `console.*` temizligi, `any` kullanimi azaltma (temel katmanlar) | 2-3 gun | Yuksek |
| **Faz 4** | Test coverage artirma (gateway, router, utils, cli) | 3-5 gun | Yuksek |
| **Faz 5** | Guvenlik middleware (helmet, rate-limit) | 1 gun | Orta |
| **Faz 6** | Performans optimizasyonlari (cache, build) | 2 gun | Orta |
| **Faz 7** | TODO/FIXME cozumu, dokumantasyon | Surekli | Dusuk |

---

## 8.  Hemen Baslayabilecek Eylemler

1. **`eslint.config.mjs` duzelt:** `fixStyle: 'inline-imports'` -> `fixStyle: 'inline-type-imports'`
2. **`npm audit fix` calistir:** Cozulebilen 9 zafiyeti hemen kapat.
3. **`tsconfig.json`a `isolatedModules: true` ekle** ve jest configden kaldir.
4. **`husky` + `lint-staged` kur:** `npm install -D husky lint-staged && npx husky init`
5. **Bir sonraki sprintte en az 3 TODOyu coz** ve issue trackera kaydet.

---

> Bu plan, mevcut kod tabaninin saglamligini artirmaya odaklanir. Her faz tamamlandiginda kalite metrikleri yeniden olculmeli ve plan guncellenmelidir.
