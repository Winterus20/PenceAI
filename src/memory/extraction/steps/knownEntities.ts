import type { ExtractorStep, ExtractionContext, ExtractedEntity } from '../types.js';

export class KnownEntitiesStep implements ExtractorStep {
    name = 'KnownEntitiesStep';

    async extract(context: ExtractionContext): Promise<ExtractionContext> {
        if (context.existingEntitiesCache.size === 0) {
            return context;
        }

        let newUnprocessedText = context.unprocessedText;
        const newEntities: ExtractedEntity[] = [];

        // Map'i array'e çevir (name, type pair olarak)
        const entries = Array.from(context.existingEntitiesCache.entries());

        // Uzundan kısaya sırala ki 'Yapay Zeka' varken önce 'Yapay'ı bulmasın
        entries.sort((a, b) => b[0].length - a[0].length);

        for (const [knownEntity, entityType] of entries) {
            // Regex ile tam kelime eşleşmesi ara (case-insensitive)
            // Sadece harf, rakam ve Türkçe karakter içeren kelimeleri tam eşleştirmek için \b sınırını kullanırız
            const regex = new RegExp(`\\b${escapeRegExp(knownEntity)}\\b`, 'gi');

            if (regex.test(newUnprocessedText)) {
                // Eşleşme bulundu
                newEntities.push({
                    name: knownEntity,
                    type: entityType, // Artık doğru entity type kullanılıyor (concept yerine gerçek tip)
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
