## Brief overview
Bu dosya, bir görev tamamlandığında kullanıcıya sunulacak final özetinin ("Walkthrough") yapısını, stilini ve içeriğini belirler.

## General Structure
Görev tamamlandığında (attempt_completion üzerinden üretilecek rapor), aşağıdaki metin yapısına tam olarak uymalıdır:

- **Giriş:** Rapor "İşlem Başarıyla Tamamlandı" gibi pozitif ve kesin bir giriş ifadesi ile başlamalıdır.
- **Summary of Accomplishments:** Bu görevde tam olarak neler başarıldığını özetleyen, 3-4 maddelik yüksek seviyeli bir liste.
- **Key Changes:** Yapılan en önemli teknik değişiklikler, etkilenen özellikler veya dosya bazlı detaylarla listelenmelidir.
- **Technical Decisions:** Çözüm için neden bu yöntemin seçildiği, kullanılan algoritmalar veya arka planda alınan spesifik mimari kararlar açıklanmalıdır.
- **Verification & Testing:** Yapılan işin çalıştığı nasıl kanıtlandı? Başarıyla geçen test komutları veya denenen spesifik test senaryoları detaylandırılmalıdır.

## Visual and Style Rules
- **Markdown:** Başlıklar kesin olmalı (`#`, `##`, `###`) ve okunaklı, düzenli liste yapıları (`-`) tercih edilmelidir.
- **Code Snippets:** Eğer kritik bir algoritma/mantık revize edildiyse, değişimin anlaşılması için "before/after" yerine doğrudan yeni mantık formatlı kısa bir kod bloğu olarak dahil edilmelidir.
- **Alerts:** Kullanıcının aklında bulunması gereken yan etkiler (side-effects) veya potansiyel riskler varsa; GitHub tarzı uyarılardan faydalanılmalıdır (`> [!TIP]`, `> [!NOTE]`, `> [!WARNING]`).
- **Tone:** İletişim tonu daima kendinden emin, teknik olarak yeterli düzeyde ve açıklayıcı olmalıdır.