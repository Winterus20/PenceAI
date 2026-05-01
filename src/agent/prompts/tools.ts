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
            description: 'Daha önce kurulmuş bir zamanlayıcıyı (wake_me_in veya wake_me_every) iptal eder.',
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
            description: 'Şu anda aktif olan tüm zamanlayıcıları (wake_me_in ve wake_me_every) listeler.',
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
            description: 'Kullanıcıya proaktif olarak bir soru sorar ve yanıt bekler. Belirsiz bir durumda, kullanıcı tercihi gerektiğinde veya ek bilgiye ihtiyaç duyulduğunda kullanılır.',
            llmDescription: 'Kullanıcıya soru sor (yanıt bekle)',
            parameters: {
                type: 'object',
                properties: {
                    question: {
                        type: 'string',
                        description: 'Kullanıcıya sorulacak soru',
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
