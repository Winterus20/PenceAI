import type { LLMToolDefinition } from '../router/types.js';
import { getConfig } from '../gateway/config.js';

export const BASE_SYSTEM_PROMPT = `Sen PençeAI adlı kişisel bir AI asistanısın. {USER_NAME}'in bilgisayarında yerel olarak çalışırsın — tüm veriler cihazda kalır, dışarıya çıkmaz.
Şu an: {NOW}

Samimi, doğrudan ve zekisin. Gereksiz giriş cümlesi yok, laf dolandırma yok — işe odaklan.`;

/**
 * Sistem prompt'u oluşturur.
 */
export function buildSystemPrompt(
    userName: string,
    memories: string[] = [],
    recentContext: string[] = [],
    conversationSummaries: Array<{ title: string; summary: string; updated_at: string }> = [],
    reviewMemories: string[] = [],
    memoryRelations: Array<{ source: string; target: string; relation: string; description: string }> = [],
    archivalMemories: string[] = [],
    followUpMemories: string[] = [],
): string {
    const now = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

    const config = getConfig();
    let basePrompt = config.systemPrompt && config.systemPrompt.trim() !== '' ? config.systemPrompt : BASE_SYSTEM_PROMPT;

    // Replace template variables
    // Ensure the custom prompt acts correctly even if the user didn't write variables by appending base info if it's missing.
    basePrompt = basePrompt.replace(/{USER_NAME}/g, userName).replace(/{NOW}/g, now);

    let prompt = basePrompt + `

## Dil
Kullanıcının yazdığı dilde yanıtla — dili asla kendin değiştirme. Karma dil girişlerinde baskın dili esas al.

## Yanıt Stili
- Yanıt uzunluğunu sorunun derinliğiyle orantılı tut: basit soruya kısa yanıt, karmaşık konuya ayrıntılı yanıt.
- Selamlama mesajlarına (selam, merhaba, naber, hi vb.) tek cümleyle doğal karşılık ver — liste, öneri menüsü veya geçmiş özeti sunma.
- Yanıtlarını Markdown formatında ver; tek satırlık kısa yanıtlarda Markdown zorunlu değil.

## Davranış
- Kritik belirsizliklerde tahmin yerine tek bir soru sor; önemsiz detaylar için makul varsayım kullan.
- Geri alınamaz eylemler (silme, sistem komutu, kritik dosya değişikliği) önce kullanıcıya açıkla ve onay al — onaysız gerçekleştirme.
- Karmaşık görevlerde adımları önce zihinsel olarak planla, sonra sırayla uygula; bir adım başarısız olursa dur ve kullanıcıyı bilgilendir.

## Araç Kullanımı
- Araçları yalnızca gerçekten gerektiğinde kullan; sohbet sorularını araç çağırmadan yanıtla.
- Araç seçimi: kullanıcı eskiyle ilgili spesifik bir şey sorarsa → searchConversation | kalıcı bilgi sorgulama → searchMemory.
- searchConversation'ı YASAKLI durumlar: selamlama (selam, merhaba, naber, hi), ilk mesaj, günlük sohbet, genel soru, anlamsız/kısa mesajlar, tek kelimelik mesajlar, emoji mesajları. Sistem prompt'undaki özetler zaten yeterli — ekstra arama yapma.
- KURAL: Kullanıcı geçmişe açıkça referans vermedikçe ("daha önce", "geçen sefer", "konuşmuştuk" gibi ifadeler) searchConversation'ı ASLA çağırma. Şüpheye düşersen ÇAĞIRMA.
- JSON parametrelerinde sayısal değerleri tırnak içine alma: "count": 5 doğru, "count": "5" yanlış`;

    if (memories.length > 0) {
        prompt += `\n\n## Kullanıcı Hakkında Bildiklerin\n`;
        memories.forEach((m, i) => {
            prompt += `${i + 1}. ${m}\n`;
        });

        // İlişkisel bağlam (Memory Graph)
        if (memoryRelations.length > 0) {
            prompt += `\n### Bilgiler Arası Bağlantılar\n`;
            const RELATION_LABELS: Record<string, string> = {
                'related_to': '↔ ilişkili',
                'supports': '→ destekliyor',
                'contradicts': '⚡ çelişiyor',
                'caused_by': '← nedeniyle',
                'part_of': '⊂ parçası',
            };
            for (const rel of memoryRelations) {
                const label = RELATION_LABELS[rel.relation] || rel.relation;
                const desc = rel.description ? ` (${rel.description})` : '';
                prompt += `- "${rel.source}" ${label} "${rel.target}"${desc}\n`;
            }
            prompt += `[Tree of Thoughts] Bu bağlantıları kullanarak bilgiler arasında çıkarım yap. A'dan B'ye ve B'den C'ye olan bağlantıları takip ederek ("Multi-hop" zincirler) adım adım mantıksal sonuçlara ulaş.\n`;
        }
    }

    if (conversationSummaries.length > 0) {
        const MAX_SUMMARY_CHARS = 2800; // ~800 token
        let usedChars = 0;
        const lines: string[] = [];

        for (const s of conversationSummaries) {
            const dateStr = s.updated_at.endsWith('Z') ? s.updated_at : s.updated_at.replace(' ', 'T') + 'Z';
            const date = new Date(dateStr).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short' });
            const title = s.title ? `"${s.title}"` : 'Başlıksız konuşma';
            const line = `- [${date}] ${title}: ${s.summary}`;
            if (usedChars + line.length > MAX_SUMMARY_CHARS) break;
            lines.push(line);
            usedChars += line.length;
        }

        if (lines.length > 0) {
            prompt += `\n\n## Geçmiş Konuşma Özetleri\nAşağıdaki özetler daha önceki konuşmaların ne hakkında olduğunu gösterir. Bağlam olarak kullan:\n`;
            lines.forEach(line => { prompt += `${line}\n`; });
        }
    }

    if (recentContext.length > 0) {
        prompt += `\n\n## Yakın Geçmiş Bağlam (Son 48 Saat)\nAşağıdaki bilgiler son konuşmalardan alınmıştır. Bellekte kayıtlı değildir ama yanıtlarını kişiselleştirmek için kullan:\n`;
        recentContext.forEach((ctx, i) => {
            prompt += `${i + 1}. ${ctx}\n`;
        });
    }

    if (reviewMemories.length > 0) {
        prompt += `\n\n## Hatırlatma Gerektiren Bilgiler\nBu bilgilerin hatırlanma oranı düşüyor. Konuşmada doğal bir fırsat çıkarsa bunlara hafifçe değin:\n`;
        reviewMemories.forEach((m, i) => {
            prompt += `${i + 1}. ${m}\n`;
        });
    }

    if (archivalMemories.length > 0) {
        prompt += `\n\n## Uzak Geçmişten Hatırlanan (Güvenilirliği Düşük)\n⚠️ Bu bilgiler uzun süredir erişilmemişti ve arşivden geri getirildi. Doğruluğu belirsiz olabilir — dikkatli kullan:\n`;
        archivalMemories.forEach((m, i) => {
            prompt += `${i + 1}. ${m}\n`;
        });
    }

    if (followUpMemories.length > 0) {
        prompt += `\n\n## Proaktif Takip (İnisiyatif Al)\nAşağıdaki konular kullanıcının gündemindeki güncel olaylar ve projelerdir. Bu listeyi asla doğrudan kullanıcıya gösterme veya madde madde sıraya dizme.\nSadece sohbetin akışında gerçekten doğal ve anlamlı bir fırsat çıkarsa, listeden en fazla BİR tanesini seç ve yalnızca tek bir kısa soruyla değin (Örn: "Dünkü toplantın nasıl geçti?").\nKURALLAR:\n- Kullanıcı sadece "selam" veya küçük bir selamlama yazdıysa bu listeyi KULLANMA — sadece samimi bir karşılık ver.\n- Birden fazla konu aynı anda sorma.\n- Olayın zaten tamamlandığı net anlaşılıyorsa tekrar sorma.\n`;
        followUpMemories.forEach((m) => {
            prompt += `- ${m}\n`;
        });
    }

    return prompt;
}

/**
 * Yerleşik araç tanımlarını döndürür.
 */
export function getBuiltinToolDefinitions(): LLMToolDefinition[] {
    const config = getConfig();
    const tools: LLMToolDefinition[] = [
        {
            name: 'readFile',
            description: 'Belirtilen dosyayı okur ve içeriğini döndürür.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Okunacak dosyanın tam yolu',
                    },
                },
                required: ['path'],
            },
        },
        {
            name: 'writeFile',
            description: 'Belirtilen dosyaya içerik yazar. Dosya yoksa oluşturur.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Yazılacak dosyanın tam yolu',
                    },
                    content: {
                        type: 'string',
                        description: 'Dosyaya yazılacak içerik',
                    },
                },
                required: ['path', 'content'],
            },
        },
        {
            name: 'listDirectory',
            description: 'Belirtilen dizindeki dosya ve klasörleri listeler.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Listelenecek dizinin tam yolu',
                    },
                },
                required: ['path'],
            },
        },
        {
            name: 'searchMemory',
            description: 'Uzun vadeli bellekte arama yapar. Sonuçlarda her kaydın ID, kategori, önem ve erişim sayısı gösterilir.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Arama sorgusu',
                    },
                },
                required: ['query'],
            },
        },
        {
            name: 'deleteMemory',
            description: 'Bellekten bir kaydı ID ile siler. Yanlış veya güncelliğini yitirmiş bellekleri temizlemek için kullan.',
            parameters: {
                type: 'object',
                properties: {
                    id: {
                        type: 'integer',
                        description: 'Silinecek bellek kaydının ID numarası',
                    },
                },
                required: ['id'],
            },
        },
        {
            name: 'searchConversation',
            description: `Geçmiş konuşmalarda belirli bir konuyu veya mesajı arar. SADECE kullanıcı açıkça geçmişteki bir konuşmayı referans ederse çağır ("daha önce ne demiştik", "geçen sefer bahsettiğim", "bunu konuşmuştuk" gibi ifadeler ZORUNLU). Bu aracı gereksiz çağırmak YASAKTIR. Selamlama, günlük sohbet, yeni konular, ilk mesaj, anlamsız/kısa mesajlar, genel sorular veya greeting mesajları için KESİNLİKLE çağırma. Şüpheliysen çağırma.`,
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Kullanıcının sorduğu spesifik konu veya anahtar kelime',
                    },
                },
                required: ['query'],
            },
        },
    ];

    // Kabuk erişimi etkinse ekle
    if (config.allowShellExecution) {
        tools.push({
            name: 'executeShell',
            description: 'Bir kabuk komutu çalıştırır ve çıktısını döndürür. DİKKAT: Tehlikeli komutlarda kullanıcıyı bilgilendir.',
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'Çalıştırılacak kabuk komutu',
                    },
                    cwd: {
                        type: 'string',
                        description: 'Çalışma dizini (opsiyonel)',
                    },
                },
                required: ['command'],
            },
        });
    }

    // Web arama (Brave Search) etkinse ekle
    if (config.braveSearchApiKey) {
        tools.push({
            name: 'webSearch',
            description: 'Web\'de arama yapar ve sonuçları döndürür. Güncel bilgiler, haberler, teknik konular ve her türlü web araması için kullan.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Arama sorgusu (doğal dilde veya anahtar kelimelerle)',
                    },
                    count: {
                        type: 'integer',
                        description: 'Döndürülecek sonuç sayısı (varsayılan: 5, maksimum: 10)',
                    },
                    freshness: {
                        type: 'string',
                        description: 'Zaman filtresi: pd (son 24 saat), pw (son 1 hafta), pm (son 1 ay), py (son 1 yıl)',
                        enum: ['pd', 'pw', 'pm', 'py'],
                    },
                },
                required: ['query'],
            },
        });
    }

    return tools;
}

/**
 * Hafif bellek çıkarım prompt'u — son mesaj çifti için.
 */
export function buildLightExtractionPrompt(userName: string = 'Kullanıcı'): string {
    return `Aşağıdaki kullanıcı-asistan mesaj çiftini analiz et. SADECE kalıcı ve uzun vadeli bilgileri çıkar.

## KAYDET — Sadece Bunları Çıkar
- Kişisel kimlik bilgileri (isim, yaş, meslek, konum)
- Kalıcı tercihler ve zevkler (yemek, müzik, teknoloji, dil, hobi)
- Uzun vadeli projeler ve hedefler
- Aile üyeleri, evcil hayvanlar, önemli ilişkiler (isim ve bağlam)
- Teknik beceriler ve düzenli kullandığı teknolojiler
- Kronik alışkanlıklar ve rutinler (çalışma saatleri vb.)
- Hayat değiştiren olaylar (iş değişikliği, taşınma, mezuniyet)

## KAYDETME — Bunları Asla Çıkarma
- Anlık duygular veya geçici durumlar ("bugün yorgunum", "canım sıkıldı")
- Anlık merakla sorulan sorular ("X'in başkenti neresi?", "Y nasıl yapılır?")
- Konuşmanın konusu veya akışı ("X hakkında konuştuk", "Y dosyasını düzenledi")
- Geçici istekler veya tek seferlik sorular
- Asistanın verdiği yanıtlar veya öneriler
- Teknik hata mesajları veya geçici debugging bilgileri
- Anlık planlar ("yarın şunu yapacağım" gibi kısa vadeli)
- Sadece "isim" beyanları (kullanıcının adı haricinde, bağlamsız özel isimler)
- Mesajın sonundaki "Bellekte Zaten Kayıtlı Bilgiler" listesindeki bilgilerin TEKRARLARI, YENİDEN İFADELERİ veya ALT KÜMELERİ (örn: bellekte "Kullanıcı 21 yaşında" varsa, "Yaş: 21" ÇIKARMA)
- Mevcut bir bilgiyle aynı anlama gelen ama farklı kelimelerle yazılmış bilgileri ASLA çıkarma.

## Kurallar
- ÇOK seçici ol — şüpheliysen veya anlık bir heves ise KAYDETME
- Maksimum 2-3 bilgi çıkar, daha fazlasına gerek yok
- Her bilgiyi ÖZLÜ ve TEK bir cümle olarak yaz.
- Bilgi kimin hakkındaysa, cümle o isimle başlayabilir VEYA gizli özne olabilir, ancak doğal bir dil kullan. ("Piyano çalmayı sever", "Yiğit Emre, Ayşegül ile tanıştı" gibi doğal ifadeler bırak)
- Bilgi yoksa boş dizi döndür (çoğu mesajda bilgi OLMAYACAK — bu normal)
- Direkt bilgiyi yaz, gereksiz betimleme yapma
- MEVCUT BELLEK KONTROLÜ: Yeni çıkaracağın bir bilgi, "Bellekte Zaten Kayıtlı Bilgiler" listesindeki HERHANGİ BİR bilginin mantıksal olarak aynısı veya bir parçasıysa KESİNLİKLE ÇIKARMA.
- DİKKAT: Bilgileri mutlaka diyaloğun konuşulduğu dilde (orijinal dilde) çıkar.

## Yanıt Formatı
SADECE aşağıdaki JSON formatında yanıt ver, başka hiçbir şey yazma:
[{"content": "bilgi metni", "category": "preference|fact|habit|project|event|other", "importance": 1-10}]

Bilgi yoksa: []`;
}

/**
 * Derin bellek çıkarım prompt'u — tüm konuşma için.
 */
export function buildDeepExtractionPrompt(userName: string = 'Kullanıcı'): string {
    return `Aşağıdaki konuşmanın tamamını analiz et. SADECE kullanıcı hakkında kalıcı ve uzun vadeli bilgileri çıkar.

## KAYDET — Sadece Bunları Çıkar
- Kişisel kimlik bilgileri (isim, yaş, meslek, konum)
- Kalıcı tercihler ve zevkler
- Uzun vadeli projeler, hedefler ve iş bilgileri
- Aile üyeleri, evcil hayvanlar, önemli ilişkiler
- Teknik beceriler ve ilgi alanları
- Kronik alışkanlıklar ve rutinler
- İletişim tercihleri
- Hayat değiştiren olaylar (iş değişikliği, taşınma, mezuniyet, evlilik)

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

## Kurallar
- ÇOK seçici ol — sadece gelecekte aylarca/yıllarca geçerli olacak kalıcı gerçekleri kaydet
- Mümkünse birden fazla kısa bilgiyi, aynı konu altındaysa tek bir anlamlı ve uzun cümlede birleştir.
- Her bilgiyi kısa ve net bir cümle olarak yaz. 
- Bilgi kimin hakkındaysa, cümle o isimle başlayabilir VEYA gizli özne olabilir, ancak doğal bir dil kullan. ("Piyano çalmayı sever", "Yiğit Emre, Ayşegül ile tanıştı" gibi doğal ifadeler bırak)
- Çelişen bilgiler varsa en son geçerli olanı al
- Şüpheliysen KAYDETME, bilgi yoksa boş dizi döndür (bu normal)
- importance skoru: gerçekten önemli hayat/iş bilgileri 8-10, genel tercihler 5-7, çok spesifik detaylar 1-4
- DİKKAT: Bilgileri mutlaka diyaloğun konuşulduğu dilde (orijinal dilde) çıkar.

## Yanıt Formatı
SADECE aşağıdaki JSON formatında yanıt ver, başka hiçbir şey yazma:
[{"content": "bilgi metni", "category": "preference|fact|habit|project|event|other", "importance": 1-10}]

Bilgi yoksa: []`;
}

/**
 * Konuşma özetleme prompt'u — bir konuşmayı JSON formatında özetler.
 */
export function buildSummarizationPrompt(): string {
    return `Aşağıdaki konuşmayı analiz et ve kısa bir özet oluştur.

## Görev
Konuşmayı ileriki konuşmalarda bağlam olarak kullanılabilecek şekilde özetle.

## Yanıt Formatı
SADECE aşağıdaki JSON formatında yanıt ver, başka hiçbir şey yazma:
{
  "topics": ["ana konu 1", "ana konu 2"],
  "mood": "kullanıcının genel tonu (meraklı, stresli, mutlu vb.)",
  "decisions": ["alınan karar 1", "alınan karar 2"],
  "open_questions": ["henüz çözülmemiş soru veya konu"],
  "summary": "Konuşmanın 2-3 cümlelik özeti. Ne hakkında konuşuldu, ne karar verildi, ne açıkta kaldı."
}

## Kurallar
- summary alanı maksimum 3 cümle, net ve bilgi dolu olsun
- topics için ana konuları kısaca yaz (maks. 5)
- decisions yalnızca net kararlar için (emin değilsen boş bırak)
- JSON dışında hiçbir şey yazma
- DİKKAT: Özetin ve başlıkların dilini, konuşmanın ağırlıklı yapıldığı dilde tut.`;
}

/**
 * Entity extraction prompt'u — bellek içeriğinden varlıkları çıkarır
 * ve mevcut belleklerle ilişki kurar. Artık merkezi User Node etrafında toplanıyor.
 */
export function buildEntityExtractionPrompt(existingEntities: string[], relatedMemories: Array<{ id: number; content: string }>, userName: string = 'Kullanıcı'): string {
    let prompt = `Aşağıdaki bellek kaydını analiz et. İçindeki varlıkları (entity) çıkar ve varolan belleklerle ilişkilerini belirle.

## ZORUNLU KURAL: Merkezi Kullanıcı
Bilgiler her ne şekilde yazılmış olursa olsun (gizli özneyle bile olsa), bu anılar ana kullanıcımız olan '${userName}' ile ilgilidir. 
HER ZAMAN '${userName}' adında bir "person" entity çıkar. 
Daha sonra cümlede geçen eylemi, kavramı veya projeyi ayrı bir entity olarak çıkar ve bunları '${userName}' ile güçlü bir şekilde (related_to, part_of, supports) bağla! (Örn: "Piyano çalmayı sever" -> [Entity: Yiğit Emre], [Entity: Piyano] -> İkisi arasında 'related_to' veya 'supports' ilişkisi kur).

## Entity Türleri
- person: Kişi adları (sadece spesifik kişiler)
- technology: Programlama dilleri, framework'ler, araçlar, spesifik konseptler (örn. React, Python, Ebbinghaus)
- project: Somut projeler, kalıcı iş hedefleri
- place: Şehirler, ülkeler, spesifik mekanlar
- organization: Şirketler, okullar, kurumlar
- concept: Spesifik felsefi veya profesyonel konseptler (genel kelimeleri ÇIKARMA, örn: "iş", "şey", "zaman", "yardım" KULLANILAMAZ)

## İlişki Türleri
- related_to: Genel anlamda ilişkili (diğerleri uymazsa)
- supports: İlk bilgi ikincisini destekliyor/güçlendiriyor
- contradicts: Bilgiler çelişiyor
- caused_by: Birincisi ikincisinin kalıcı bir sonucu
- part_of: Birincisi ikincisinin alt parçası/bileşeni`;

    if (existingEntities.length > 0) {
        prompt += `\n\n## Mevcut Bilinen Varlıklar\n${existingEntities.join(', ')}`;
    }

    if (relatedMemories.length > 0) {
        prompt += `\n\n## İlişki Kurulabilecek Mevcut Bellekler\n`;
        relatedMemories.forEach(m => {
            prompt += `- [ID:${m.id}] ${m.content}\n`;
        });
    }

    prompt += `

## Yanıt Formatı
SADECE aşağıdaki JSON formatında yanıt ver, başka hiçbir şey yazma:
{
  "entities": [{"name": "varlık adı", "type": "person|technology|project|place|organization|concept"}],
  "relations": [{"targetMemoryId": 123, "relationType": "related_to|supports|contradicts|caused_by|part_of", "confidence": 0.1-1.0, "description": "ilişki açıklaması"}]
}

## Kurallar
- ZORUNLU: HER ZAMAN ana kullanıcıyı (${userName}) bir Entity olarak çıkar ve çıkarılan diğer tüm olguları (Entity) onunla ilişkilendir!
- Sadece somut ve spesifik olguları çıkar ("iş", "bugün", "soru", "şey" gibi soyut/genel kelimeleri asla Entity olarak çıkarma).
- Entity isimleri tutarlı olsun (mevcut varlıkların yazılışını kullan)
- İlişkiler SADECE yukarıdaki mevcut belleklerle kurulabilir, bellek listesinde olmayan ID'leri kullanma.
- confidence 0.7-1.0 = güçlü ilişki, 0.4-0.6 = orta, <0.4 = zayıf
- Zorlama ilişki kurma — sadece gerçek bağlantıları belirt. Bulamazsan boş bırak.
- Entity yoksa boş dizi, ilişki yoksa boş dizi döndür.`;

    return prompt;
}
