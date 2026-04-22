## Brief overview
Bu dosya, projede ihtiyaç duyulan genel bağlam, mimari bilgiler ve proje yapısı için her zaman başvurulması gereken ana kaynakları tanımlar.

## Core Reference Document
- Projenin tamamı `project/` klasörü içerisinde detaylı olarak dökümante edilmiştir.
- Projenin mimarisi, modül yapısı, veritabanı şeması, kullanılan teknoloji yığını, API endpoint'leri ve sistem akışları gibi konularda bilgiye ihtiyaç duyulduğunda, her zaman öncelikle parça parça ayrılmış referansların indeksi olan `project/README.md` dosyasına bakılmalı ve oradaki yönlendirmelere göre ilgili alt dosya (`project/01-proje-ozeti.md`, `project/03-modul-yapisi.md` vb.) okunmalıdır.
- Mimari kararlar veya dosya yapıları hakkında varsayım yapmak yerine, bu referans dosyaları okunmalı ve oradaki yönlendirmelere göre hareket edilmelidir.

## Yönlendirici Referans Dosyaları (project/)
- `01-proje-ozeti.md`: Projenin amacı, özellikleri ve temel akışı (veri akışı vb.)
- `02-mimari-genel-bakis.md`: Projenin katmanlı mimarisi ve topolojisi
- `03-modul-yapisi.md`: Agent, Memory, Router, Gateway gibi modüller ve alt dosyaları
- `04-veritabani-semasi.md`: SQLite veritabanı şeması ve FTS5/Vektör yapıları
- `05-teknoloji-yigini.md`: Backend ve Frontend teknolojileri ile versiyonları
- `06-api-endpoints.md`: Gateway üzerinden sunulan tüm REST API rotaları
- `07-websocket-protokolu.md`: Mesaj tipleri ve gerçek zamanlı bağlantı detayları
- `08-guvenlik.md`: Dosya yolu, MCP komutları ve auth erişim kontrolleri
- `09-test-yapisi.md`: Test klasörleri, bileşenlerin test mantıkları
- `10-gelistirici-notlari.md`: Başlatma scriptleri, çevresel değişkenler (.env) ve özel uyarılar

## System Architecture and Module Structure
- Yeni bir modül veya bileşen eklemeyi planlarken, `project/03-modul-yapisi.md` içindeki "Modül Yapısı" ve `project/04-veritabani-semasi.md` içindeki "Veritabanı Şeması" bölümleri referans alınmalıdır.
- Kod yazarken mevcut dizin yapısına ve TypeScript konvansiyonlarına (örneğin '.js' uzantılı import kullanma zorunluluğu) uygun hareket edilmelidir. Tüm bu kritik kurallar ilgili dokümanda belirtilmiştir.
