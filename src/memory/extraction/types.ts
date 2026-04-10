export interface ExtractedEntity {
    name: string;
    type: string;
    confidence: number;
    source: string;
}

export interface ExtractedRelation {
    sourceEntityName: string;
    targetEntityName: string;
    relationType: string;
    confidence: number;
    source: string;
}

export interface RawLlmRelation {
    targetMemoryId: number;
    relationType: string;
    confidence: number;
    description: string;
}

export interface ExtractionContext {
    originalText: string;
    unprocessedText: string;
    entities: ExtractedEntity[];
    relations: ExtractedRelation[];
    /**
     * Mevcut entity cache'i — name → type mapping olarak tutulur.
     * Set<string> yerine Map<string, string> kullanılarak entity type bilgisi korunur.
     */
    existingEntitiesCache: Map<string, string>;
    /**
     * Optional "escape hatch" payload returned by the LLM fallback step.
     * This keeps the extraction pipeline generic while allowing graph logic
     * to consume richer relation metadata (memoryId-bound) when available.
     */
    rawLlmRelations?: RawLlmRelation[];
}

export interface ExtractorStep {
    name: string;
    extract(context: ExtractionContext): Promise<ExtractionContext>;
}
