import { ExtractorStep, ExtractionContext, ExtractedEntity, ExtractedRelation } from '../types.js';

export class LLMFallbackStep implements ExtractorStep {
    name = 'LLMFallbackStep';

    constructor(
        // we will pass the original processMemoryGraph extraction function here
        private llmExtractFn: (content: string, existingEntities: string[]) => Promise<{
            entities: Array<{ name: string; type: string }>;
            relations: Array<{ targetMemoryId: number; relationType: string; confidence: number; description: string }>;
        }>
    ) { }

    async extract(context: ExtractionContext): Promise<ExtractionContext> {
        // If the text is fully processed or too small, skip LLM
        if (context.unprocessedText.trim().length < 5) {
            return context;
        }

        // We give LLM the *unprocessed* text but also inform it of what we *already* found
        // So LLM doesn't hallucinate dates or emails that we already caught perfectly.
        const hints = context.entities.map(e => `${e.name} (${e.type})`).join(', ');

        // This is a simplified integration. In reality, the prompt should be adjusted inside the tool logic 
        // to say "I already found: ${hints}, now find the rest in this text: ${context.unprocessedText}"
        // For backwards compatibility and ease of integration right now, we will pass existing 
        // cached entities + our newly found entities to the LLM's `existingEntities` param.

        const combinedExisting = Array.from(context.existingEntitiesCache);
        context.entities.forEach(e => combinedExisting.push(e.name));

        const result = await this.llmExtractFn(context.unprocessedText, combinedExisting);

        const newEntities: ExtractedEntity[] = result.entities.map(e => ({
            name: e.name,
            type: e.type,
            confidence: 0.8, // LLM confidence is high but not 100% like regex
            source: 'llm'
        }));

        // Note: The original returned relations are tied to memoryId already in processMemoryGraph logic, 
        // we'll just proxy them back as-is through a custom mapping since the original types were tightly coupled.
        const newRelations: ExtractedRelation[] = result.relations.map(r => ({
            sourceEntityName: 'SOURCE_MEM', // dummy, will be mapped later
            targetEntityName: r.targetMemoryId.toString(),
            relationType: r.relationType,
            confidence: r.confidence,
            source: 'llm'
        }));

        // Since we don't change how relations are saved (graph.ts does targetMemoryId insertions directly),
        // we will just keep the original structure for ease of integration today.

        return {
            ...context,
            // LLM theoretically processes the rest of the string
            unprocessedText: '',
            entities: [...context.entities, ...newEntities],
            relations: [...context.relations, ...newRelations],
            // A backdoor way to pass raw relations back to the graph manager since ExtractedRelation uses string names
            // @ts-ignore
            rawLlmRelations: result.relations
        };
    }
}
