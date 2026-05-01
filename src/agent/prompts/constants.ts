/**
 * Bellek çıkarım prompt'ları için ortak içerikler.
 * buildLightExtractionPrompt ve buildDeepExtractionPrompt arasındaki
 * tekrarı ortadan kaldırmak için kullanılır.
 */

export const EXTRACTION_CATEGORIES = `## Kategori Tanımları (Karıştırma)

- preference: Kullanıcının SEVDİKLERİ/SEVMEDİKLERİ (yemek, müzik, renk, teknoloji tercihi)
  Örnek: "Kahveyi sütsüz sever", "VS Code kullanır"

- fact: Değişmez GERÇEKLER (yaş, meslek, konum, dil, eğitim)
  Örnek: "İstanbul'da yaşıyor", "25 yaşında", "Yazılım mühendisi"

- habit: DÜZENLİ tekrarlanan davranışlar (alışkanlıklar, rutinler)
  Örnek: "Her sabah 6'da kalkar", "Haftada 3 gün spor yapar"

- project: Aktif veya planlanan PROJELER/İŞLER (uzun vadeli)
  Örnek: "E-ticaret sitesi geliştiriyor", "Startup kuruyor"

- event: ÖNEMLİ YAŞAM OLAYLARI (nadiren değişir, yaşam değiştirici)
  Örnek: "2024'te taşındı", "Mezun oldu", "İş değiştirdi"

- other: Yukarıdaki kategorilere uymayan (çok nadir kullan)`;

export const EXTRACTION_IMPORTANCE_SCORING = `## Importance Skorlama Rehberi

10: HAYATİ bilgiler (isim, yaş, ana meslek, yaşam konumu)
8-9: ÖNEMLİ yaşam/iş bilgileri (eş, çocuk, ana hedef)
6-7: KALICI tercihler (yemek, teknoloji, hobi)
4-5: SPESİFİK detaylar (ikincil tercihler)
2-3: ÇOK SPESİF/geçici (yakında değişebilir)
1: NEREDEYSE GEREKSİZ (şüphe duyuyorsan 1 ver)`;

export const EXTRACTION_MEMORY_CONTROL = `## Bellek Kontrolü — Esnek Kurallar (Katı Değil!)

Yeni bilgiyi mevcut belleklerle karşılaştır. 3 durum var:

1️⃣ ATLA — Tamamen aynı anlama geliyorsa:
   Mevcut: "Python biliyor"
   Yeni: "Python kullanıyorum"
   Karar: ATLA (aynı anlama geliyor)

2️⃣ GÜNCELLE — Mevcut bilgiyi güncelliyorsa (süre, detay, konum değişti):
   Mevcut: "Python ile 2 yıldır çalışıyor"
   Yeni: "Python ile 3 yıldır çalışıyor, Django'ya da başladı"
   Karar: "Python ile 3 yıldır çalışıyor, Django kullanıyor" (GÜNCELLE)

3️⃣ EKLE — Mevcut bilgiye ek bilgi ekliyorsa veya tamamen yeniyse:
   Mevcut: "Python biliyor"
   Yeni: "Python ile 3 yıldır çalışıyor, Django kullanıyor"
   Karar: "Django kullanıyor" (EKLE — Python zaten var)
   NOT: Mevcut belleği GÜNCELLEME, sadece yeni kısmı ekle

ÖNEMLİ: Mesajın sonundaki "Bellekte Zaten Kayıtlı Bilgiler" listesindeki bilgilerin TEKRARLARINI, YENİDEN İFADELERİNİ veya ALT KÜMELERİNİ çıkarma. Mevcut bir bilgiyle aynı anlama gelen ama farklı kelimelerle yazılmış bilgileri ATLA.`;

export const EXTRACTION_EXAMPLES = `## Örnekler

✅ DOĞRU — Kalıcı bilgi:
Kullanıcı: "Python ile 5 yıldır çalışıyorum, Django projeleri yaparım"
Çıktı: [{"content": "Python ve Django ile 5 yıllık deneyime sahip", "category": "fact", "importance": 8}]

✅ DOĞRU — Tercih:
Kullanıcı: "Kahveyi sütsüz içmeyi tercih ederim"
Çıktı: [{"content": "Kahveyi sütsüz içer", "category": "preference", "importance": 6}]

❌ YANLIŞ — Geçici durum:
Kullanıcı: "Bugün çok yorgunum, yarın devam ederiz"
Çıktı: [] (kaydetme!)

❌ YANLIŞ — Tekrar:
Mevcut bellek: "Python biliyor"
Kullanıcı: "Python kullanıyorum"
Çıktı: [] (tekrar çıkarma!)`;

export const EXTRACTION_RESPONSE_FORMAT = `## Yanıt Formatı
SADECE aşağıdaki JSON formatında yanıt ver, başka hiçbir şey yazma:
[{"content": "bilgi metni", "category": "preference|fact|habit|project|event|other", "importance": 1-10}]

Bilgi yoksa: []`;
