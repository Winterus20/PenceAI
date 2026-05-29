/**
 * Entity extraction prompt'u — bellek içeriğinden varlıkları çıkarır
 * ve mevcut belleklerle ilişki kurar. Artık merkezi User Node etrafında toplanıyor.
 */
/**
 * Prompt injection riskini azaltmak için kullanıcı adını sanitize eder.
 */
function sanitizePromptInput(name: string): string {
    return name
        .replace(/[\x00-\x1F\x7F]/g, '')
        .replace(/[{}'"]/g, '')
        .replace(/\r?\n/g, ' ')
        .trim()
        .substring(0, 100);
}

export function buildEntityExtractionPrompt(
    existingEntities: string[],
    relatedMemories: Array<{ id: number; content: string }>,
    userName: string = 'Kullanıcı',
): string {
    const safeName = sanitizePromptInput(userName);
    let prompt = `Aşağıdaki bellek kaydını analiz et. İçindeki varlıkları (entity) çıkar ve varolan belleklerle ilişkilerini belirle.

## ZORUNLU KURAL: Merkezi Kullanıcı ve Diğer Kişileri Ayır
- Bu anılar ÖNCELİKLİ OLARAK ana kullanıcımız olan '${safeName}' ile ilgilidir. HER ZAMAN '${safeName}' adında bir "person" entity çıkar.
- Cümledeki eylem, kavram veya projeyi ayrı entity olarak çıkar ve bunları '${safeName}' ile güçlü bir şekilde (related_to, part_of, supports) bağla!
- ÖNEMLİ: Eğer bellek içeriğinde '${safeName}' dışında başka bir kişinin adı geçiyorsa (örn: "Emma Grace Frost gotik tarz sever"), bu kişiyi de ayrı "person" entity olarak çıkar. Ancak bu kişiyi '${safeName}' ile doğrudan ilişkilendirme — onlar FARKLI kişilerdir.
- Sadece '${safeName}' hakkındaki olguları '${safeName}' entity'sine bağla. Başka kişilerin tercihleri/özellikleri onların kendi entity'lerinde kalmalı.

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
- ZORUNLU: HER ZAMAN ana kullanıcıyı (${safeName}) bir Entity olarak çıkar.
- '${safeName}' hakkındaki olguları onunla ilişkilendir. Ancak bellekte '${safeName}' dışında bir kişi adı geçiyorsa, bu kişiyi AYRI entity olarak çıkar ve onu '${safeName}' ile ilişkilendirme.
- Sadece somut ve spesifik olguları çıkar ("iş", "bugün", "soru", "şey" gibi soyut/genel kelimeleri asla Entity olarak çıkarma).
- Entity isimleri tutarlı olsun (mevcut varlıkların yazılışını kullan)
- İlişkiler SADECE yukarıdaki mevcut belleklerle kurulabilir, bellek listesinde olmayan ID'leri kullanma.
- confidence 0.7-1.0 = güçlü ilişki, 0.4-0.6 = orta, <0.4 = zayıf
- Zorlama ilişki kurma — sadece gerçek bağlantıları belirt. Bulamazsan boş bırak.
- Entity yoksa boş dizi, ilişki yoksa boş dizi döndür.`;

    return prompt;
}
