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

/** Claim/Covariate: Olgusal bir iddia veya nitelik */
export interface ExtractedClaim {
    subject: string;           // İddia sahibi varlık (örn: "Ahmet")
    predicate: string;         // İddia fiili (örn: "kurucusudur")
    object: string;            // İddia nesnesi (örn: "X Şirketi")
    status: 'active' | 'historical' | 'uncertain'; // İddia durumu
    startDate?: string;        // Başlangıç tarihi (ISO format)
    endDate?: string;          // Bitiş tarihi (ISO format)
    confidence: number;        // Güven skoru [0,1]
    source: string;            // Kaynak bilgisi
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
    /** Çıkarılan olgusal iddialar (Claim Extraction) */
    claims: ExtractedClaim[];
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

