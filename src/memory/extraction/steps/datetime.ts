import * as chrono from 'chrono-node';
import type { ExtractorStep, ExtractionContext, ExtractedEntity } from '../types.js';

export class DateTimeStep implements ExtractorStep {
    name = 'DateTimeStep';

    async extract(context: ExtractionContext): Promise<ExtractionContext> {
        let newUnprocessedText = context.unprocessedText;
        const newEntities: ExtractedEntity[] = [];

        // Chrono parse options configuration (Turkish locale doesn't exist by default in chrono, it supports basics and english)
        // Using strict mode to prevent too many false positives
        const results = chrono.parse(newUnprocessedText);

        for (const res of results) {
            newEntities.push({
                name: res.start.date().toISOString(),
                type: 'datetime',
                confidence: 0.95, // High confidence for chronos standard results
                source: 'chrono'
            });

            // Mask the found string so LLM won't process it anymore
            // split().join() ile TÜM eşleşmeleri değiştir (String.replace sadece ilk eşleşmeyi değiştirir)
            newUnprocessedText = newUnprocessedText.split(res.text).join('[DATETIME]');
        }

        return {
            ...context,
            unprocessedText: newUnprocessedText,
            entities: [...context.entities, ...newEntities]
        };
    }
}
