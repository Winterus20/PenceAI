import { ExtractorStep, ExtractionContext } from './types.js';
import { logger } from '../../utils/logger.js';

export class ExtractorPipeline {
    constructor(private steps: ExtractorStep[]) { }

    async run(text: string, existingCache: Set<string>): Promise<ExtractionContext> {
        let context: ExtractionContext = {
            originalText: text,
            unprocessedText: text,
            entities: [],
            relations: [],
            existingEntitiesCache: existingCache
        };

        for (const step of this.steps) {
            logger.debug(`[ExtractorPipeline] Executing step: ${step.name}`);

            context = await step.extract(context);

            // Early exit condition
            // If the unprocessed text is very short (e.g. less than 3 characters), we can stop early.
            if (context.unprocessedText.trim().length < 3) {
                logger.debug(`[ExtractorPipeline] Early exit triggered. Unprocessed text: "${context.unprocessedText}"`);
                break;
            }
        }

        return context;
    }
}
