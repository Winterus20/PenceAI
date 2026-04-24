import validator from 'validator';
import type { ExtractorStep, ExtractionContext, ExtractedEntity } from '../types.js';

export class NetworkStep implements ExtractorStep {
    name = 'NetworkStep';

    async extract(context: ExtractionContext): Promise<ExtractionContext> {
        const newUnprocessedText = context.unprocessedText;
        const newEntities: ExtractedEntity[] = [];

        // Basic tokenization by space to test with validator
        const tokens = newUnprocessedText.split(/\s+/);

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            if (!token) continue;

            // Daha robust token temizleme: baştaki ve sondaki non-alphanumeric karakterleri temizle
            // Bu, tırnak, parantez, noktalama gibi karakterleri de kapsar
            // Örn: "https://google.com." → "https://google.com"
            // Örn: "(test@example.com)" → "test@example.com"
            const cleanToken = token.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');

            // Boş token kontrolü
            if (!cleanToken) continue;

            // Email kontrolü URL'den önce — isURL({require_protocol:false}) email'leri de URL sayar
            if (validator.isEmail(cleanToken)) {
                newEntities.push({
                    name: cleanToken,
                    type: 'email',
                    confidence: 1.0,
                    source: 'validator'
                });
                tokens[i] = '[EMAIL]';
            }
            // IP kontrolü URL'den önce — isURL({require_protocol:false}) IP'leri de URL sayar
            else if (validator.isIP(cleanToken)) {
                newEntities.push({
                    name: cleanToken,
                    type: 'ip_address',
                    confidence: 1.0,
                    source: 'validator'
                });
                tokens[i] = '[IP]';
            }
            // URL kontrolü en son — en geniş eşleşme
            else if (validator.isURL(cleanToken, { require_protocol: false, require_valid_protocol: true })) {
                newEntities.push({
                    name: cleanToken,
                    type: 'url',
                    confidence: 1.0,
                    source: 'validator'
                });
                tokens[i] = '[URL]';
            }
        }

        return {
            ...context,
            unprocessedText: tokens.join(' '),
            entities: [...context.entities, ...newEntities]
        };
    }
}
