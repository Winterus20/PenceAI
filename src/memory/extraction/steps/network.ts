import validator from 'validator';
import { ExtractorStep, ExtractionContext, ExtractedEntity } from '../types.js';

export class NetworkStep implements ExtractorStep {
    name = 'NetworkStep';

    async extract(context: ExtractionContext): Promise<ExtractionContext> {
        let newUnprocessedText = context.unprocessedText;
        const newEntities: ExtractedEntity[] = [];

        // Basic tokenization by space to test with validator
        const tokens = newUnprocessedText.split(/\s+/);

        for (let i = 0; i < tokens.length; i++) {
            let token = tokens[i];

            // Clean up basic punctuations at the end of token (e.g. "https://google.com.")
            const cleanToken = token.replace(/[.,;!?()]+$/, '');

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
