import { ExtractorStep, ExtractionContext, ExtractedEntity } from '../types.js';

export class KnownEntitiesStep implements ExtractorStep {
    name = 'KnownEntitiesStep';

    async extract(context: ExtractionContext): Promise<ExtractionContext> {
        if (context.existingEntitiesCache.size === 0) {
            return context;
        }

        let newUnprocessedText = context.unprocessedText;
        const newEntities: ExtractedEntity[] = [];

        // Hızlıca cümle içindeki kelimeleri/öbekleri kontrol et (Greedy match tavsiye edilir, bu basit bir sürüm)
        const entries = Array.from(context.existingEntitiesCache);

        // Uzundan kısaya sırala ki 'Yapay Zeka' varken önce 'Yapay'ı bulmasın
        entries.sort((a, b) => b.length - a.length);

        for (const knownEntity of entries) {
            // Regex ile tam kelime eşleşmesi ara (case-insensitive)
            // Sadece harf, rakam ve Türkçe karakter içeren kelimeleri tam eşleştirmek için \b sınırını kullanırız
            const regex = new RegExp(`\\b${escapeRegExp(knownEntity)}\\b`, 'gi');

            if (regex.test(newUnprocessedText)) {
                // Eşleşme bulundu
                newEntities.push({
                    name: knownEntity, // Orijinal formatlı halini cache'den almak daha iyi olabilir, şu an cache string
                    type: 'concept', // Veritabanından tipi de yüklememiz gerekirdi ama cache Set<string> olunca genel 'concept' veriyoruz
                    confidence: 1.0,
                    source: 'cache'
                });

                // Bulunan metni MASKELER (LLM görmesin/tekrar bulmasın diye)
                newUnprocessedText = newUnprocessedText.replace(regex, `[KNOWN_ENTITY]`);
            }
        }

        return {
            ...context,
            unprocessedText: newUnprocessedText,
            entities: [...context.entities, ...newEntities]
        };
    }
}

function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}
