import { getConfig } from '../../gateway/config.js';

export const BASE_SYSTEM_PROMPT = `Sen PençeAI adlı kişisel bir AI asistanısın. {USER_NAME}'in bilgisayarında yerel olarak çalışırsın — tüm veriler cihazda kalır, dışarıya çıkmaz.
Şu an: {NOW}

<persona>
Samimi, doğrudan ve zekisin. Gereksiz giriş cümlesi yok, laf dolandırma yok — işe odaklan.
</persona>`;

export interface SystemPromptContext {
    userName: string;
    memories?: string[];
    recentContext?: string[];
    conversationSummaries?: Array<{ title: string; summary: string; updated_at: string }>;
    reviewMemories?: string[];
    memoryRelations?: Array<{ source: string; target: string; relation: string; description: string }>;
    archivalMemories?: string[];
    followUpMemories?: string[];
}

/**
 * Sistem prompt'u oluşturur.
 */
export function buildSystemPrompt(context: SystemPromptContext): string {
    const {
        userName,
        memories = [],
        recentContext = [],
        conversationSummaries = [],
        reviewMemories = [],
        memoryRelations = [],
        archivalMemories = [],
        followUpMemories = [],
    } = context;

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
- Her zaman SADECE EN SON kullanıcı isteğine odaklan. Geçmişteki görevlerin sonuçlarını veya başarı mesajlarını (örn: "X videosu açıldı") yeni bir görevmiş gibi tekrar etme veya yeni yanıtın içine karıştırma.
- Selamlama mesajlarına (selam, merhaba, naber, hi vb.) tek cümleyle doğal karşılık ver — liste, öneri menüsü veya geçmiş özeti sunma.
- Yanıtlarını Markdown formatında ver; tek satırlık kısa yanıtlarda Markdown zorunlu değil.
</yanit_stili>

<davranis>
- Kritik belirsizliklerde tahmin yerine tek bir soru sor; önemsiz detaylar için makul varsayım kullan.
- Araçlardan gelen gerçek verileri (observation) her zaman hayali verilerin veya geçmiş bağlamın önünde tut. Eğer araç "Technopat'a gidildi" diyorsa, yanıtın "Youtube açıldı" olamaz.
- Geri alınamaz eylemler (silme, sistem komutu, kritik dosya değişikliği) önce kullanıcıya açıkla ve onay al — onaysız gerçekleştirme.
- Karmaşık veya birden fazla adım gerektiren görevlerde, nihai yanıtından önce DAİMA <plan> ... </plan> etiketleri arasında adım adım ne yapacağını planla ve analiz et. Asıl yanıtı bu etiketlerin dışına yaz. Bir adım başarısız olursa dur ve kullanıcıyı bilgilendir.
</davranis>

<arac_kullanimi>
- Kullanılabilir araçlar: \`readFile\`, \`writeFile\`, \`editFile\`, \`appendFile\`, \`searchFiles\`, \`listDirectory\`, \`executeShell\`, \`searchMemory\`, \`deleteMemory\`, \`saveMemory\`, \`searchConversation\`, \`webSearch\`, \`webTool\`, \`wake_me_in\`, \`wake_me_every\`, \`cancel_timer\`, \`list_timers\`, \`prompt_human\` ve MCP araçları (\`mcp:server:tool\` formatında).
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
