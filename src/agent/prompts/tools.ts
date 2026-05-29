import type { LLMToolDefinition } from '../../router/types.js';
import { getConfig } from '../../gateway/config.js';

/**
 * Yerleşik araç tanımlarını döndürür.
 */
export function getBuiltinToolDefinitions(): LLMToolDefinition[] {
    const config = getConfig();
    const tools: LLMToolDefinition[] = [
        {
            name: 'readFile',
            description: 'Belirtilen dosyanın tam içeriğini okur ve döndürür. Dosya düzenleme öncesinde MUTLAKA içeriği okumak için kullanılır. Büyük dosyalarda (>500 satır) dikkatli kullan — gerekirse parça parça oku.',
            llmDescription: 'Dosya oku (düzenlemeden ÖNCE okumayı unutma)',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Okunacak dosyanın tam mutlak yolu veya proje köküne göre göreceli yol',
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
            description: 'Mevcut bir dosyada belirli bir metin parçasını bulur ve değiştirir. SADECE küçük, hedefli düzenlemeler için kullanılır (örn: bir fonksiyon ekleme, bir satır değiştirme). Dosyanın tamamını yeniden yazmak İÇİN KULLANMA — o durumda writeFile kullan. ⚠️ oldText olarak yeterince spesifik ve benzersiz bir metin parçası kullan; yaygın satırlar (örn: sadece "}" veya "return") yanlış konumlarda eşleşebilir. Eğer oldText dosyada bulunamazsa işlem başarısız olur, o yüzden readFile ile içeriği doğrula.',
            llmDescription: 'Dosyada küçük düzenleme yap (spesifik metin değişimi)',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Düzenlenecek dosyanın tam yolu',
                    },
                    oldText: {
                        type: 'string',
                        description: 'Dosyada bulunacak ve değiştirilecek KESİN metin parçası. Satır sonları ve boşluklar dahil olmalıdır.',
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
            description: 'Mevcut bir dosyanın sonuna içerik ekler. Dosya yoksa oluşturur. Log, not ekleme, yapılandırma dosyasına satır ekleme veya bir listeye öğe ekleme için idealdir. Dosyanın mevcut içeriğini okumadan sonuna ekleme yapılabilir.',
            llmDescription: 'Dosyanın sonuna ekle (log, not, liste ekleme)',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Eklenecek dosyanın tam yolu',
                    },
                    content: {
                        type: 'string',
                        description: 'Dosyanın sonuna eklenecek içerik. Yeni satır gerekiyorsa başa/tail’e \\n ekle.',
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
            description: 'Glob kalıbı kullanarak dosya ADINA göre arar. "src/**/*.ts" gibi kalıplarla hızlıca dosya bulmak için kullanılır. İÇERİK araması YAPMAZ — dosya içeriğinde arama yapmak için önce searchFiles ile dosyayı bul, sonra readFile ile içeriği oku.',
            llmDescription: 'Dosya adına göre ara (glob kalıbı ile)',
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
            description: 'Belirtilen dosyaya içerik yazar. Dosya yoksa oluşturur, VARSA TAMAMEN ÜZERİNE YAZAR. SADECE yeni dosya oluşturma veya mevcut dosyanın tamamını değiştirme gerektiğinde kullan. Küçük düzenlemeler için editFile kullan. ÖNEMLİ: Mevcut bir dosyanın üzerine yazmadan önce readFile ile içeriğini okuduğundan emin ol ve kullanıcıya onay sor.',
            llmDescription: 'Dosya yaz/oluştur (TAMAMEN üzerine yazar — dikkatli kullan)',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Yazılacak dosyanın tam yolu',
                    },
                    content: {
                        type: 'string',
                        description: 'Dosyaya yazılacak tam içerik',
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
            description: 'Belirtilen dizindeki dosya ve klasörleri listeler. Bir dosyanın nerede olduğunu anlamak veya proje yapısını keşfetmek için kullanılır. Dosya adı biliniyorsa searchFiles daha hızlıdır; dizin yapısını görmek istiyorsan listDirectory kullan.',
            llmDescription: 'Dizin listele (proje yapısını keşfet)',
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
            description: 'Uzun vadeli bellekte (kullanıcı hakkında kaydedilmiş bilgilerde) arama yapar. Kullanıcının geçmişte söylediği tercihleri, alışkanlıkları veya kişisel bilgileri bulmak için kullan. "Geçmişte X hakkında ne demiştin?" sorusunda kullan.',
            llmDescription: 'Bellekte ara (kullanıcının geçmiş bilgileri)',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Arama sorgusu (doğal dilde)',
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
            description: 'Bellekten bir kaydı ID ile siler. Kullanıcı bir bilgiyi yanlış hatırladığını veya silinmesini istediğinde kullan. Silmeden önce searchMemory ile doğru ID\'yi bul.',
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
            description: 'Kullanıcının açıkça istediği veya kalıcı olduğu kesin bilgileri uzun vadeli belleğe kaydeder. Kullanıcı "bunu hatırla", "unutma ki...", "tercihim şu" dediğinde kullan. Bilginin kalıcı ve kişisel olduğundan emin ol. Tekrarlanan geçici durumları kaydetme.',
            llmDescription: 'Belleğe kaydet (kullanıcı açıkça istediğinde veya kalıcı bilgi)',
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
            description: 'Geçmiş konuşmalarda belirli bir konuyu veya mesajı arar. Kullanıcı "geçen hafta X hakkında ne konuşmuştuk?" veya "daha önce Y demiştin" dediğinde kullan. Bellekten farklı olarak konuşma geçmişinin tamamında arama yapar.',
            llmDescription: 'Geçmiş konuşmada ara (konuşma tarihçesinde)',
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
            description: 'Bilinen spesifik bir URL\'nin içeriğini okur ve metne dönüştürür. Kullanıcı "şu sayfayı oku" veya "https://... adresindeki bilgiyi getir" dediğinde kullan. Belirsiz bir konuda genel arama yapmak için webSearch kullan.',
            llmDescription: 'Belirli URL oku (spesifik web sayfası)',
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
                required: ['url'],
            },
            llmParameters: {
                type: 'object',
                properties: {
                    url: { type: 'string' },
                    mode: { type: 'string', enum: ['quick', 'deep'] },
                },
                required: ['url'],
            },
        },
        {
            name: 'wake_me_in',
            description: 'Belirtilen dakika sonra asistanın kendisini uyandırmasını sağlar. Uyandığında "reason" ifadesini bir görev olarak yürütür — araçları kullanır, web araması yapar, dosya okur vb. Sadece hatırlatma değil, gerçek görev yürütmesidir. Örnek: "Teknoloji haberlerini özetle" dersen, agent uyandığında webSearch kullanıp haber bulur ve özetler.',
            llmDescription: 'Gelecekte uyan ve görevi yürüt (otonom zamanlayıcı)',
            parameters: {
                type: 'object',
                properties: {
                    minutes: {
                        type: 'number',
                        description: 'Kaç dakika sonra uyanılacağı',
                    },
                    reason: {
                        type: 'string',
                        description: 'Uyanma sebebi (bu not uyandığında sana gösterilecek)',
                    },
                },
                required: ['minutes', 'reason'],
            },
            llmParameters: {
                type: 'object',
                properties: {
                    minutes: { type: 'number' },
                    reason: { type: 'string' },
                },
                required: ['minutes', 'reason'],
            },
        },
        {
            name: 'wake_me_every',
            description: 'Belirtilen bir cron ifadesine göre asistanın düzenli olarak uyanmasını sağlar. Her tetiklendiğinde "reason" ifadesini bir görev olarak yürütür — araçları kullanır, sonuç üretir. Örnek: "0 9 * * *" ile "Teknoloji haberlerini özetle" dersen, her sabah 9\'da agent webSearch yapar ve haber özeti gönderir.',
            llmDescription: 'Düzenli uyan ve görevi yürüt (cron job)',
            parameters: {
                type: 'object',
                properties: {
                    cronExpression: {
                        type: 'string',
                        description: 'Geçerli bir cron ifadesi (örn: "*/5 * * * *" her 5 dakikada bir)',
                    },
                    reason: {
                        type: 'string',
                        description: 'Uyanma sebebi',
                    },
                },
                required: ['cronExpression', 'reason'],
            },
            llmParameters: {
                type: 'object',
                properties: {
                    cronExpression: { type: 'string' },
                    reason: { type: 'string' },
                },
                required: ['cronExpression', 'reason'],
            },
        },
        {
            name: 'cancel_timer',
            description: 'Daha önce kurulmuş bir zamanlayıcıyı (wake_me_in veya wake_me_every) iptal eder. Kullanıcı "zamanlayıcıyı iptal et" veya "alarmı kapat" dediğinde kullan. Önce list_timers ile ID\'yi bul.',
            llmDescription: 'Zamanlayıcı iptal et',
            parameters: {
                type: 'object',
                properties: {
                    timerId: {
                        type: 'string',
                        description: 'İptal edilecek zamanlayıcının ID\'si',
                    },
                },
                required: ['timerId'],
            },
            llmParameters: {
                type: 'object',
                properties: {
                    timerId: { type: 'string' },
                },
                required: ['timerId'],
            },
        },
        {
            name: 'list_timers',
            description: 'Şu anda aktif olan tüm zamanlayıcıları (wake_me_in ve wake_me_every) listeler. Kullanıcı "zamanlayıcılarım neler?" veya "aktif alarm var mı?" dediğinde kullan.',
            llmDescription: 'Aktif zamanlayıcıları listele',
            parameters: {
                type: 'object',
                properties: {},
                required: [],
            },
            llmParameters: {
                type: 'object',
                properties: {},
                required: [],
            },
        },
        {
            name: 'prompt_human',
            description: 'Kullanıcıya proaktif olarak bir soru sorar ve yanıt bekler. Belirsiz bir durumda, kullanıcı tercihi gerektiğinde veya ek bilgiye ihtiyaç duyulduğunda kullanılır. Tahmin yürütmek yerine soru sormak daha iyiyse bu aracı kullan.',
            llmDescription: 'Kullanıcıya soru sor (yanıt bekle)',
            parameters: {
                type: 'object',
                properties: {
                    question: {
                        type: 'string',
                        description: 'Kullanıcıya sorulacak net ve kısa soru',
                    },
                },
                required: ['question'],
            },
            llmParameters: {
                type: 'object',
                properties: {
                    question: { type: 'string' },
                },
                required: ['question'],
            },
        },
    ];

    // Kabuk erişimi etkinse ekle
    if (config.allowShellExecution) {
        tools.push({
            name: 'executeShell',
            description: 'Bir kabuk (PowerShell/CMD) komutu çalıştırır. SADECE okuma/arama/listeleme komutları otomatik çalıştırılır. YAZMA, SİLME veya SİSTEM DEĞİŞİKLİĞİ gerektiren komutlar (rm, del, format, shutdown, regedit vb.) için KESİNLİKLE kullanıcı onayı al. Güvenli komutlar: ls, cat, find, grep (varsa), npm, node, python, echo, mkdir, touch.',
            llmDescription: 'Shell komutu çalıştır (GÜVENLİ komutlar: ls, cat, npm, node vb.)',
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'Çalıştırılacak tam komut satırı. Path traversal (../../../) ve pipe içeren komutlar dikkatle kontrol edilmeli.',
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
        description: 'Web\'de arama yapar ve sonuçları döndürür. Birden fazla kaynak (Brave, DuckDuckGo, Wikipedia, Hacker News, Reddit) kullanır. Belirsiz veya güncel bir konuda bilgi toplamak, kullanıcının sorusunu doğrulamak için kullan. Spesifik bir URL okumak için webTool kullan.',
        llmDescription: 'Web\'de ara (çoklu kaynak — genel bilgi toplama)',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Arama sorgusu (doğal dilde veya anahtar kelimelerle). Türkçe veya İngilizce olabilir.',
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
