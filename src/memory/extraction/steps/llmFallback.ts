import type { ExtractorStep, ExtractionContext, ExtractedEntity, ExtractedRelation } from '../types.js';

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

        // LLM'e zaten bulunan entity'leri bilgi olarak ver — tekrar bulmasını önle
        // Bu bilgi, extractFn içindeki prompt'a enjekte edilecek
        const hints = context.entities.map(e => `${e.name} (${e.type})`).join(', ');

        // Mevcut cache + yeni bulunan entity'leri birleştir
        const combinedExisting = new Map(context.existingEntitiesCache);
        context.entities.forEach(e => combinedExisting.set(e.name, e.type));

        // extractFn'e hints ve combinedExisting entity listesi geçir
        // extractFn, bu bilgiyi prompt'a ekleyerek LLM'in duplikasyon yapmasını önler
        const existingEntityNames = Array.from(combinedExisting.keys());
        const result = await this.llmExtractFn(context.unprocessedText, existingEntityNames);

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
