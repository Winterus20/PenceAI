import {
    EXTRACTION_CATEGORIES,
    EXTRACTION_EXAMPLES,
    EXTRACTION_IMPORTANCE_SCORING,
    EXTRACTION_MEMORY_CONTROL,
    EXTRACTION_RESPONSE_FORMAT,
} from './constants.js';

/**
 * Hafif bellek çıkarım prompt'u — son mesaj çifti için.
 */
export function buildLightExtractionPrompt(userName: string = 'Kullanıcı'): string {
    return `Aşağıdaki kullanıcı-asistan mesaj çiftini analiz et. SADECE kalıcı ve uzun vadeli bilgileri çıkar.

## KAYDET — Sadece Bunları Çıkar (SADECE KULLANICI HAKKINDA)
- Kullanıcının KENDİ kişisel kimlik bilgileri (isim, yaş, meslek, konum)
- Kullanıcının KENDİ kalıcı tercihleri ve zevkleri (yemek, müzik, teknoloji, dil, hobi)
- Kullanıcının KENDİ uzun vadeli projeleri ve hedefleri
- Kullanıcının KENDİ aile üyeleri, evcil hayvanları, önemli ilişkileri (isim ve bağlam)
- Kullanıcının KENDİ teknik becerileri ve düzenli kullandığı teknolojiler
- Kullanıcının KENDİ kronik alışkanlıkları ve rutinleri (çalışma saatleri vb.)
- Kullanıcının KENDİ hayat değiştiren olayları (iş değişikliği, taşınma, mezuniyet)

## KAYDETME — Bunları Asla Çıkarma
- Anlık duygular veya geçici durumlar ("bugün yorgunum", "canım sıkıldı")
- Anlık merakla sorulan sorular ("X'in başkenti neresi?", "Y nasıl yapılır?")
- Konuşmanın konusu veya akışı ("X hakkında konuştuk", "Y dosyasını düzenledi")
- Geçici istekler veya tek seferlik sorular
- Asistanın verdiği yanıtlar veya öneriler
- Teknik hata mesajları veya geçici debugging bilgileri
- Anlık planlar ("yarın şunu yapacağım" gibi kısa vadeli)
- Sadece "isim" beyanları (kullanıcının adı haricinde, bağlamsız özel isimler)
- BAŞKALARI hakkında konuşulan bilgiler: "Arkadaşım X'i seviyor", "Discord'daki Y gotik tarz sever", "Kardeşim Z'yi beğeniyor" — bunlar kullanıcı hakkında değil, KAYDETME

${EXTRACTION_CATEGORIES}

${EXTRACTION_IMPORTANCE_SCORING}

${EXTRACTION_MEMORY_CONTROL}

${EXTRACTION_EXAMPLES}

## Kurallar
- ÇOK seçici ol — şüpheliysen veya anlık bir heves ise KAYDETME
- Maksimum 2-3 bilgi çıkar, daha fazlasına gerek yok
- Her bilgiyi ÖZLÜ ve TEK bir cümle olarak yaz.
- Bilgi kimin hakkındaysa, cümle o isimle başlayabilir VEYA gizli özne olabilir, ancak doğal bir dil kullan. ("Piyano çalmayı sever", "Yiğit Emre, Ayşegül ile tanıştı" gibi doğal ifadeler bırak)
ZORUNLU KURAL: Yanıtın KESİNLİKLE geçerli bir raw JSON dizisi olmalıdır. Kod bloğu (\`\`\`json) KULLANMA. Açıklama metni, selamlama veya başka bir metin EKLEME. Doğrudan [ ile başla.
Aşağıdaki formata uy.
- Direkt bilgiyi yaz, gereksiz betimleme yapma
- DİKKAT: Bilgileri mutlaka diyaloğun konuşulduğu dilde (orijinal dilde) çıkar.

${EXTRACTION_RESPONSE_FORMAT}`;
}

/**
 * Derin bellek çıkarım prompt'u — tüm konuşma için.
 */
export function buildDeepExtractionPrompt(userName: string = 'Kullanıcı'): string {
    return `Aşağıdaki konuşmanın tamamını analiz et. SADECE kullanıcı hakkında kalıcı ve uzun vadeli bilgileri çıkar.

## KAYDET — Sadece Bunları Çıkar (SADECE KULLANICI HAKKINDA)
- Kullanıcının KENDİ kişisel kimlik bilgileri (isim, yaş, meslek, konum)
- Kullanıcının KENDİ kalıcı tercihleri ve zevkleri
- Kullanıcının KENDİ uzun vadeli projeleri, hedefleri ve iş bilgileri
- Kullanıcının KENDİ aile üyeleri, evcil hayvanları, önemli ilişkileri
- Kullanıcının KENDİ teknik becerileri ve ilgi alanları
- Kullanıcının KENDİ kronik alışkanlıkları ve rutinleri
- Kullanıcının KENDİ iletişim tercihleri
- Kullanıcının KENDİ hayat değiştiren olayları (iş değişikliği, taşınma, mezuniyet, evlilik)

## KAYDETME — Bunları Asla Çıkarma
- Konuşma akışı veya ne hakkında konuşulduğu
- Geçici duygular veya anlık durumlar
- Anlık merakla sorulan spesifik sorular (genel kültüre veya rastgele bilgiye dayalı)
- Tek seferlik sorular, geçici istekler veya yardım talepleri
- Teknik hata detayları veya debugging bilgileri
- Hangi dosyanın düzenlendiği veya hangi komutun çalıştırıldığı
- Asistanın verdiği yanıtlar veya öneriler
- Kısa vadeli planlar (örn. yarınki toplantı)
- Bağlamı olmayan tek kelimelik isimler
- BAŞKALARI hakkında konuşulan bilgiler: "Arkadaşım X'i seviyor", "Discord'daki Y gotik tarz sever", "Kardeşim Z'yi beğeniyor" — bunlar kullanıcı hakkında değil, KAYDETME

${EXTRACTION_CATEGORIES}

${EXTRACTION_IMPORTANCE_SCORING}

${EXTRACTION_MEMORY_CONTROL}

${EXTRACTION_EXAMPLES}

## Kurallar
- ÇOK seçici ol — sadece gelecekte aylarca/yıllarca geçerli olacak kalıcı gerçekleri kaydet
- Mümkünse birden fazla kısa bilgiyi, aynı konu altındaysa tek bir anlamlı ve uzun cümlede birleştir.
- Her bilgiyi kısa ve net bir cümle olarak yaz.
- Bilgi kimin hakkındaysa, cümle o isimle başlayabilir VEYA gizli özne olabilir, ancak doğal bir dil kullan. ("Piyano çalmayı sever", "Yiğit Emre, Ayşegül ile tanıştı" gibi doğal ifadeler bırak)
- Çelişen bilgiler varsa en son geçerli olanı al
- Şüpheliysen KAYDETME, bilgi yoksa boş dizi döndür (bu normal)
- DİKKAT: Bilgileri mutlaka diyaloğun konuşulduğu dilde (orijinal dilde) çıkar.

ZORUNLU KURAL: Yanıtın KESİNLİKLE geçerli bir raw JSON dizisi olmalıdır. Kod bloğu (\`\`\`json) KULLANMA. Açıklama metni, selamlama veya başka bir metin EKLEME. Doğrudan [ ile başla.
Aşağıdaki formata uy
${EXTRACTION_RESPONSE_FORMAT}`;
}
