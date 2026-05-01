/**
 * Entity extraction prompt'u — bellek içeriğinden varlıkları çıkarır
 * ve mevcut belleklerle ilişki kurar. Artık merkezi User Node etrafında toplanıyor.
 */
export function buildEntityExtractionPrompt(
    existingEntities: string[],
    relatedMemories: Array<{ id: number; content: string }>,
    userName: string = 'Kullanıcı',
): string {
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
