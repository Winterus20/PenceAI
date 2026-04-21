import type { LLMToolDefinition } from '../router/types.js';
import { getConfig } from '../gateway/config.js';

export const BASE_SYSTEM_PROMPT = `Sen PençeAI adlı kişisel bir AI asistanısın. {USER_NAME}'in bilgisayarında yerel olarak çalışırsın — tüm veriler cihazda kalır, dışarıya çıkmaz.
Şu an: {NOW}

<persona>
Samimi, doğrudan ve zekisin. Gereksiz giriş cümlesi yok, laf dolandırma yok — işe odaklan.
</persona>`;

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

<kurallar>
<dil>
Kullanıcının yazdığı dilde yanıtla — dili asla kendin değiştirme. Karma dil girişlerinde baskın dili esas al.
</dil>

<yanit_stili>
- Yanıt uzunluğunu sorunun derinliğiyle orantılı tut: basit soruya kısa yanıt, karmaşık konuya ayrıntılı yanıt.
- Selamlama mesajlarına (selam, merhaba, naber, hi vb.) tek cümleyle doğal karşılık ver — liste, öneri menüsü veya geçmiş özeti sunma.
- Yanıtlarını Markdown formatında ver; tek satırlık kısa yanıtlarda Markdown zorunlu değil.
</yanit_stili>

<davranis>
- Kritik belirsizliklerde tahmin yerine tek bir soru sor; önemsiz detaylar için makul varsayım kullan.
- Geri alınamaz eylemler (silme, sistem komutu, kritik dosya değişikliği) önce kullanıcıya açıkla ve onay al — onaysız gerçekleştirme.
- Karmaşık veya birden fazla adım gerektiren görevlerde, nihai yanıtından önce DAİMA <plan> ... </plan> etiketleri arasında adım adım ne yapacağını planla ve analiz et. Asıl yanıtı bu etiketlerin dışına yaz. Bir adım başarısız olursa dur ve kullanıcıyı bilgilendir.
</davranis>

<arac_kullanimi>
- Kullanılabilir araçlar: \`readFile\`, \`writeFile\`, \`editFile\`, \`appendFile\`, \`searchFiles\`, \`listDirectory\`, \`executeShell\`, \`searchMemory\`, \`deleteMemory\`, \`saveMemory\`, \`searchConversation\`, \`webSearch\`, \`webTool\` ve MCP araçları (\`mcp:server:tool\` formatında).
- MCP araçları harici servisler içindir (GitHub, filesystem, veritabanları, API'ler).
- Kullanıcı bir işlem istediğinde "yapacağım" deme, BİZZAT ARAÇLARI KULLAN.
- JSON parametrelerinde sayısal değerleri tırnak içine alma: "count": 5 doğru, "count": "5" yanlış.
</arac_kullanimi>
</kurallar>`;

    if (memories.length > 0) {
        prompt += `\n<kullanici_hakkinda>\n`;
        memories.forEach((m, i) => {
            prompt += `${i + 1}. ${m}\n`;
        });

        // İlişkisel bağlam (Memory Graph)
        if (memoryRelations.length > 0) {
            prompt += `\n<bilgiler_arasi_baglantilar>\n`;
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
            prompt += `\n[Tree of Thoughts] Bu bağlantıları kullanarak bilgiler arasında çıkarım yap. A'dan B'ye ve B'den C'ye olan bağlantıları takip ederek ("Multi-hop" zincirler) adım adım mantıksal sonuçlara ulaş.\n</bilgiler_arasi_baglantilar>\n`;
        }
        prompt += `</kullanici_hakkinda>\n`;
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
            prompt += `\n<gecmis_konusma_ozetleri>\nAşağıdaki özetler daha önceki konuşmaların ne hakkında olduğunu gösterir. Bağlam olarak kullan:\n`;
            lines.forEach(line => { prompt += `${line}\n`; });
            prompt += `</gecmis_konusma_ozetleri>\n`;
        }
    }

    if (recentContext.length > 0) {
        prompt += `\n<yakin_gecmis_baglam>\nAşağıdaki bilgiler son konuşmalardan alınmıştır. Bellekte kayıtlı değildir ama yanıtlarını kişiselleştirmek için kullan:\n`;
        recentContext.forEach((ctx, i) => {
            prompt += `${i + 1}. ${ctx}\n`;
        });
        prompt += `</yakin_gecmis_baglam>\n`;
    }

    if (reviewMemories.length > 0) {
        prompt += `\n<hatirlatma_gerektiren_bilgiler>\nBu bilgilerin hatırlanma oranı düşüyor. Konuşmada doğal bir fırsat çıkarsa bunlara hafifçe değin:\n`;
        reviewMemories.forEach((m, i) => {
            prompt += `${i + 1}. ${m}\n`;
        });
        prompt += `</hatirlatma_gerektiren_bilgiler>\n`;
    }

    if (archivalMemories.length > 0) {
        prompt += `\n<uzak_gecmis_arsiv>\n⚠️ Bu bilgiler uzun süredir erişilmemişti ve arşivden geri getirildi. Doğruluğu belirsiz olabilir — dikkatli kullan:\n`;
        archivalMemories.forEach((m, i) => {
            prompt += `${i + 1}. ${m}\n`;
        });
        prompt += `</uzak_gecmis_arsiv>\n`;
    }

    if (followUpMemories.length > 0) {
        prompt += `\n<proaktif_takip>\nAşağıdaki konular kullanıcının gündemindeki güncel olaylar ve projelerdir. Bu listeyi asla doğrudan kullanıcıya gösterme veya madde madde sıraya dizme.\nSadece sohbetin akışında gerçekten doğal ve anlamlı bir fırsat çıkarsa, listeden en fazla BİR tanesini seç ve yalnızca tek bir kısa soruyla değin (Örn: "Dünkü toplantın nasıl geçti?").\nKURALLAR:\n- Kullanıcı sadece "selam" veya küçük bir selamlama yazdıysa bu listeyi KULLANMA — sadece samimi bir karşılık ver.\n- Birden fazla konu aynı anda sorma.\n- Olayın zaten tamamlandığı net anlaşılıyorsa tekrar sorma.\n`;
        followUpMemories.forEach((m) => {
            prompt += `- ${m}\n`;
        });
        prompt += `</proaktif_takip>\n`;
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
            llmDescription: 'Dosya oku',
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
            llmParameters: {
                type: 'object',
                properties: {
                    path: { type: 'string' },
                },
                required: ['path'],
            },
        },
        {
            name: 'editFile',
            description: 'Mevcut bir dosyada belirli bir metin parçasını bulur ve değiştirir. writeFile yerine küçük düzenlemeler için kullanılır — dosyanın tamamını yeniden yazmaz. ⚠️ oldText olarak yeterince spesifik ve benzersiz bir metin parçası kullanın; yaygın satırlar (örn: sadece "}" veya "return") yanlış konumlarda eşleşebilir.',
            llmDescription: 'Dosyada düzenleme yap (eski metni yeni metinle değiştir — spesifik/metinsel eşleşme kullan)',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Düzenlenecek dosyanın tam yolu',
                    },
                    oldText: {
                        type: 'string',
                        description: 'Dosyada bulunacak ve değiştirilecek metin parçası',
                    },
                    newText: {
                        type: 'string',
                        description: 'Yerine yazılacak yeni metin',
                    },
                    replaceAll: {
                        type: 'boolean',
                        description: 'true ise tüm eşleşmeleri değiştir, false ise sadece ilkini (varsayılan: false)',
                    },
                },
                required: ['path', 'oldText', 'newText'],
            },
            llmParameters: {
                type: 'object',
                properties: {
                    path: { type: 'string' },
                    oldText: { type: 'string' },
                    newText: { type: 'string' },
                    replaceAll: { type: 'boolean' },
                },
                required: ['path', 'oldText', 'newText'],
            },
        },
        {
            name: 'appendFile',
            description: 'Mevcut bir dosyanın sonuna içerik ekler. Dosya yoksa oluşturur. Log, not ekleme veya dosyaya satır ekleme için kullanılır.',
            llmDescription: 'Dosyaya ekleme yap (sonuna ekle)',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Eklenecek dosyanın tam yolu',
                    },
                    content: {
                        type: 'string',
                        description: 'Dosyanın sonuna eklenecek içerik',
                    },
                },
                required: ['path', 'content'],
            },
            llmParameters: {
                type: 'object',
                properties: {
                    path: { type: 'string' },
                    content: { type: 'string' },
                },
                required: ['path', 'content'],
            },
        },
        {
            name: 'searchFiles',
            description: 'Glob kalıbı kullanarak dosya arar. Dosya ismine göre hızlıca dosya bulmak için kullanılır. Örn: "**/*.ts", "src/**/*.json"',
            llmDescription: 'Dosya ara (glob kalıbı ile)',
            parameters: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description: 'Glob arama kalıbı (örn: "**/*.ts", "src/**/*.json", "**/test_*.js")',
                    },
                    directory: {
                        type: 'string',
                        description: 'Aramanın yapılacağı kök dizin (belirtilmezse geçerli dizin)',
                    },
                    maxResults: {
                        type: 'integer',
                        description: 'Maksimum sonuç sayısı (varsayılan: 50, maksimum: 200)',
                    },
                },
                required: ['pattern'],
            },
            llmParameters: {
                type: 'object',
                properties: {
                    pattern: { type: 'string' },
                    directory: { type: 'string' },
                    maxResults: { type: 'integer' },
                },
                required: ['pattern'],
            },
        },
        {
            name: 'writeFile',
            description: 'Belirtilen dosyaya içerik yazar. Dosya yoksa oluşturur.',
            llmDescription: 'Dosya yaz veya oluştur',
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
            llmParameters: {
                type: 'object',
                properties: {
                    path: { type: 'string' },
                    content: { type: 'string' },
                },
                required: ['path', 'content'],
            },
        },
        {
            name: 'listDirectory',
            description: 'Belirtilen dizindeki dosya ve klasörleri listeler.',
            llmDescription: 'Dizin listele',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Listelenecek dizinin tam yolu (Örn: "C:/Users/..." veya "./src")',
                    },
                },
                required: ['path'],
            },
            llmParameters: {
                type: 'object',
                properties: {
                    path: { type: 'string' },
                },
                required: ['path'],
            },
        },
        {
            name: 'searchMemory',
            description: 'Uzun vadeli bellekte arama yapar.',
            llmDescription: 'Bellekte ara',
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
            llmParameters: {
                type: 'object',
                properties: {
                    query: { type: 'string' },
                },
                required: ['query'],
            },
        },
        {
            name: 'deleteMemory',
            description: 'Bellekten bir kaydı ID ile siler.',
            llmDescription: 'Bellekten sil (ID ile)',
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
            llmParameters: {
                type: 'object',
                properties: {
                    id: { type: 'integer' },
                },
                required: ['id'],
            },
        },
        {
            name: 'saveMemory',
            description: '[DENEYSEL] Kullanıcının açıkça istediği bilgileri uzun vadeli belleğe kaydeder.',
            llmDescription: 'Belleğe kaydet (kullanıcı açıkça istediğinde)',
            parameters: {
                type: 'object',
                properties: {
                    content: {
                        type: 'string',
                        description: 'Kaydedilecek bilginin net ve özeti (örn: "Ayşe kahveyi şekersiz sever")',
                    },
                    category: {
                        type: 'string',
                        description: 'Bilginin kategorisi (preference, fact, habit, project, event, other)',
                        enum: ['preference', 'fact', 'habit', 'project', 'event', 'other'],
                    },
                    importance: {
                        type: 'integer',
                        description: 'Bilginin önemi (1-10 arası, varsayılan 5)',
                    },
                },
                required: ['content'],
            },
            llmParameters: {
                type: 'object',
                properties: {
                    content: { type: 'string' },
                    category: {
                        type: 'string',
                        enum: ['preference', 'fact', 'habit', 'project', 'event', 'other'],
                    },
                    importance: { type: 'integer' },
                },
                required: ['content'],
            },
        },
        {
            name: 'searchConversation',
            description: 'Geçmiş konuşmalarda belirli bir konuyu veya mesajı arar.',
            llmDescription: 'Geçmiş konuşmada ara (sadece kullanıcı geçmişe referans verirse)',
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
            llmParameters: {
                type: 'object',
                properties: {
                    query: { type: 'string' },
                },
                required: ['query'],
            },
        },
        {
            name: 'webTool',
            description: 'Bir web sayfasının içeriğini okur ve metne dönüştürür.',
            llmDescription: 'Web sayfası oku',
            parameters: {
                type: 'object',
                properties: {
                    url: {
                        type: 'string',
                        description: 'Okunacak web sayfasının tam URL adresi (örn: https://example.com)',
                    },
                    mode: {
                        type: 'string',
                        description: 'Tarama modu: "quick" (varsayılan, yerel fetch) veya "deep" (JS destekli gelişmiş okuma)',
                        enum: ['quick', 'deep'],
                    },
                },
                required: ['url', 'mode'],
            },
            llmParameters: {
                type: 'object',
                properties: {
                    url: { type: 'string' },
                    mode: { type: 'string', enum: ['quick', 'deep'] },
                },
                required: ['url', 'mode'],
            },
        },
    ];

    // Kabuk erişimi etkinse ekle
    if (config.allowShellExecution) {
        tools.push({
            name: 'executeShell',
            description: 'Bir kabuk (PowerShell/CMD) komutu çalıştırır.',
            llmDescription: 'Shell komutu çalıştır',
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'Çalıştırılacak tam komut satırı',
                    },
                    cwd: {
                        type: 'string',
                        description: 'Komutun çalıştırılacağı dizin (belirtilmezse varsayılan dizin kullanılır)',
                    },
                },
                required: ['command'],
            },
            llmParameters: {
                type: 'object',
                properties: {
                    command: { type: 'string' },
                    cwd: { type: 'string' },
                },
                required: ['command'],
            },
        });
    }

    // Web arama (Smart Search — Brave + DuckDuckGo + Wikipedia + HN + Reddit)
    tools.push({
        name: 'webSearch',
        description: 'Web\'de arama yapar ve sonuçları döndürür. Birden fazla kaynak (Brave, DuckDuckGo, Wikipedia, Hacker News, Reddit) kullanır.',
        llmDescription: 'Web\'de ara (çoklu kaynak)',
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
        llmParameters: {
            type: 'object',
            properties: {
                query: { type: 'string' },
                count: { type: 'integer' },
                freshness: { type: 'string', enum: ['pd', 'pw', 'pm', 'py'] },
            },
            required: ['query'],
        },
    });

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

## Kategori Tanımları (Karıştırma)

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
  
- other: Yukarıdaki kategorilere uymayan (çok nadir kullan)

## Importance Skorlama Rehberi

10: HAYATİ bilgiler (isim, yaş, ana meslek, yaşam konumu)
8-9: ÖNEMLİ yaşam/iş bilgileri (eş, çocuk, ana hedef)
6-7: KALICI tercihler (yemek, teknoloji, hobi)
4-5: SPESİFİK detaylar (ikincil tercihler)
2-3: ÇOK SPESİF/geçici (yakında değişebilir)
1: NEREDEYSE GEREKSİZ (şüphe duyuyorsan 1 ver)

## Bellek Kontrolü — Esnek Kurallar (Katı Değil!)

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

ÖNEMLİ: Mesajın sonundaki "Bellekte Zaten Kayıtlı Bilgiler" listesindeki bilgilerin TEKRARLARINI, YENİDEN İFADELERİNİ veya ALT KÜMELERİNİ çıkarma. Mevcut bir bilgiyle aynı anlama gelen ama farklı kelimelerle yazılmış bilgileri ATLA.

## Örnekler

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
Çıktı: [] (tekrar çıkarma!)

## Kurallar
- ÇOK seçici ol — şüpheliysen veya anlık bir heves ise KAYDETME
- Maksimum 2-3 bilgi çıkar, daha fazlasına gerek yok
- Her bilgiyi ÖZLÜ ve TEK bir cümle olarak yaz.
- Bilgi kimin hakkındaysa, cümle o isimle başlayabilir VEYA gizli özne olabilir, ancak doğal bir dil kullan. ("Piyano çalmayı sever", "Yiğit Emre, Ayşegül ile tanıştı" gibi doğal ifadeler bırak)
ZORUNLU KURAL: Yanıtın KESİNLİKLE geçerli bir raw JSON dizisi olmalıdır. Kod bloğu (\`\`\`json) KULLANMA. Açıklama metni, selamlama veya başka bir metin EKLEME. Doğrudan [ ile başla.
Aşağıdaki formata uyormal)
- Direkt bilgiyi yaz, gereksiz betimleme yapma
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

## Kategori Tanımları (Karıştırma)

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
  
- other: Yukarıdaki kategorilere uymayan (çok nadir kullan)

## Importance Skorlama Rehberi

10: HAYATİ bilgiler (isim, yaş, ana meslek, yaşam konumu)
8-9: ÖNEMLİ yaşam/iş bilgileri (eş, çocuk, ana hedef)
6-7: KALICI tercihler (yemek, teknoloji, hobi)
4-5: SPESİFİK detaylar (ikincil tercihler)
2-3: ÇOK SPESİF/geçici (yakında değişebilir)
1: NEREDEYSE GEREKSİZ (şüphe duyuyorsan 1 ver)

## Bellek Kontrolü — Esnek Kurallar (Katı Değil!)

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

ÖNEMLİ: Mesajın sonundaki "Bellekte Zaten Kayıtlı Bilgiler" listesindeki bilgilerin TEKRARLARINI, YENİDEN İFADELERİNİ veya ALT KÜMELERİNİ çıkarma. Mevcut bir bilgiyle aynı anlama gelen ama farklı kelimelerle yazılmış bilgileri ATLA.

## Örnekler

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
Çıktı: [] (tekrar çıkarma!)

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
SADECE aşağıdaki JSON formatında yanıt ver, başka hiçbir şey yazma:
[{"content": "bilgi metni", "category": "preference|fact|habit|project|event|other", "importance": 1-10}]

Bilgi yoksa: []`;
}

/**
 * Konuşma özetleme prompt'u — bir konuşmayı JSON formatında özetler.
 */
export function buildSummarizationPrompt(): string {
    return `Aşağıdaki konuşmayı analiz et ve kısa bir özet ile başlık oluştur.

## Görev
Konuşmayı ileriki konuşmalarda bağlam olarak kullanılabilecek şekilde özetle VE konuşmayı temsil eden kısa bir başlık belirle.

ZORUNLU KURAL: Yanıtın KESİNLİKLE geçerli bir raw JSON objesi olmalıdır. Kod bloğu (\`\`\`json) KULLANMA. Açıklama metni, selamlama veya başka bir metin EKLEME. Doğrudan { ile başla.
Aşağıdaki formata uy
SADECE aşağıdaki JSON formatında yanıt ver, başka hiçbir şey yazma:
{
  "title": "Konuşmayı özetleyen 3-6 kelimelik başlık",
  "topics": ["ana konu 1", "ana konu 2"],
  "mood": "kullanıcının genel tonu (meraklı, stresli, mutlu vb.)",
  "decisions": ["alınan karar 1", "alınan karar 2"],
  "open_questions": ["henüz çözülmemiş soru veya konu"],
  "summary": "Konuşmanın 2-3 cümlelik özeti. Ne hakkında konuşuldu, ne karar verildi, ne açıkta kaldı."
}

## Kurallar
- title: Maksimum 6 kelime, konuşmanın ana konusunu yansıtsın
- summary alanı maksimum 3 cümle, net ve bilgi dolu olsun
- topics için ana konuları kısaca yaz (maks. 5)
- decisions yalnızca net kararlar için (emin değilsen boş bırak)
- JSON dışında hiçbir şey yazma
- DİKKAT: Özetin ve başlığın dilini, konuşmanın ağırlıklı yapıldığı dilde tut.`;
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
ZORUNLU KURAL: Yanıtın KESİNLİKLE geçerli bir raw JSON objesi olmalıdır. Kod bloğu (\`\`\`json) KULLANMA. Açıklama metni, selamlama veya başka bir metin EKLEME. Doğrudan { ile başla.
Aşağıdaki formata uy
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
