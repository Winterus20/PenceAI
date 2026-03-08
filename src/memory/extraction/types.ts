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

export interface ExtractionContext {
    originalText: string;
    unprocessedText: string;
    entities: ExtractedEntity[];
    relations: ExtractedRelation[];
    existingEntitiesCache: Set<string>;
}

export interface ExtractorStep {
    name: string;
    extract(context: ExtractionContext): Promise<ExtractionContext>;
}
