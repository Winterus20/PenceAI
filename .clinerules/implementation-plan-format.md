## Brief overview
Bu dosya, projede oluşturulacak "Implementation Plan" (Uygulama Planı) süreçleri için zorunlu yapı, stil, içerik ve yaklaşım standartlarını tanımlar.

## Plan Structure and Hierarchy
- Planlar yapısal bölümlerden oluşmalı ve her bölüm başlığının hemen altında bir yatay çizgi (`---`) bulunmalıdır.
- **[Goal Description]:** Görevin özeti, arka planı ve ulaşılmak istenen hedef kısa ve öz bir şekilde açıklanmalıdır.
- **User Review Required:** Onay gerektiren mimari kararlar ve riskli değişiklikler belirtilmelidir. Bu bölümde GitHub tarzı Alert kartları (`> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`) zorunludur.
- **Proposed Changes:** Değişiklikler bileşenlere veya servis katmanlarına göre gruplandırılmalıdır. Detaylar şu formatta verilmelidir:
  - `#### [NEW] dosya_adi.js`
  - `#### [MODIFY] dosya_adi.ts`
  - `#### [DELETE] dosya_adi.css`
- **Open Questions:** Açığa kavuşmamış teknik sorular ve tasarım kararları listelenmelidir.
- **Verification Plan:** Değişikliklerin doğrulama adımları her zaman `Automated Tests` ve `Manual Verification` olmak üzere iki alt başlıkta belirtilmelidir.

## Analysis and Alternatives
- Önerilen her yeni sistem veya teknik değişiklik için artı ve eksi (pros/cons) analizleri açıkça yazılmalıdır.
- Kullanıcı talep ettiğinde veya mantıklı görüldüğünde mimari veya pratik alternatifler plana dahil edilmelidir.

## Style and Markdown Rules
- Başlık hiyerarşisi kesinlikle markdown kurallarına uymalıdır (Ana başlıklarda `#`, alt başlıklarda `##` ve `###`).
- Vurgulanması gereken kritik durumlar hariç gereksiz kalın (bold) yazılardan kaçınılmalı, kritik uyarılarda GitHub Alert yapısı tercih edilmelidir.
- Gerekli durumlarda değişikliğin anlaşılması için kısa diff'ler veya formatlı kod blokları eklenmelidir.
- Dosya isimleri ve dizin yolları belirginleştirilmeli, daima projenin hiyerarşik yapısına uygun bir liste izlenmelidir.

## Tone and Approach
- Ton daima profesyonel, sonuç odaklı ve sıkı bir mühendislik disiplini çerçevesinde olmalıdır.
- Konuşma dili ve gereksiz dolgu cümleleri kesinlikle kullanılmamalı, doğrudan teknik eksene odaklanılmalıdır.