/**
 * Memory modülü — Ortak tip tanımları ve yardımcı fonksiyonlar.
 */

// ========== Veritabanı Satır Tipleri ==========

export interface ConversationRow {
    id: string;
    channel_type: string;
    channel_id: string;
    user_id: string;
    user_name: string;
    title: string;
    summary: string;
    is_summarized: number;
    created_at: string;
    updated_at: string;
}

export interface MessageRow {
    id: number;
    conversation_id: string;
    role: string;
    content: string;
    tool_calls: string | null;
    tool_results: string | null;
    attachments: string | null;
    created_at: string;
}

export type MemoryType = 'episodic' | 'semantic';

export type BehaviorDiscoveryLifecycleState = 'disabled' | 'observe' | 'candidate' | 'shadow' | 'limited' | 'trusted';
export type BehaviorDiscoveryDomain = 'retrieval' | 'write';
export type BehaviorDiscoveryRiskProfile = 'low' | 'medium' | 'high';
export type BehaviorDiscoveryShadowReadiness = 'hold' | 'shadow_ready' | 'promotion_blocked';

export interface BehaviorDiscoveryCandidate {
    id: string;
    domain: BehaviorDiscoveryDomain;
    feature: string;
    state: Extract<BehaviorDiscoveryLifecycleState, 'candidate' | 'shadow'>;
    summary: string;
    trigger: string;
    observedSignals: string[];
    riskProfile: BehaviorDiscoveryRiskProfile;
}

export interface BehaviorDiscoveryShadowComparison {
    candidateId: string;
    currentSelectionIds: number[];
    shadowSelectionIds: number[];
    addedIds: number[];
    removedIds: number[];
    changed: boolean;
    summary: string;
    readiness: BehaviorDiscoveryShadowReadiness;
}

export interface BehaviorDiscoveryTrace {
    enabled: boolean;
    domain: BehaviorDiscoveryDomain;
    state: Extract<BehaviorDiscoveryLifecycleState, 'disabled' | 'observe' | 'candidate' | 'shadow'>;
    liveEffectAllowed: boolean;
    observedSignals: string[];
    candidates: BehaviorDiscoveryCandidate[];
    shadowComparison: BehaviorDiscoveryShadowComparison | null;
    guardrails: string[];
}

export interface MemoryTypeInference {
    memoryType: MemoryType;
    reason: string;
}

export interface MemoryRow {
    id: number;
    user_id: string;
    category: string;
    content: string;
    importance: number;
    access_count: number;
    is_archived: number;
    last_accessed: string | null;
    created_at: string;
    updated_at: string;
    provenance_source: string | null;
    provenance_conversation_id: string | null;
    provenance_message_id: number | null;
    confidence: number | null;
    review_profile: string | null;
    memory_type: MemoryType | null;
    // Ebbinghaus Forgetting Curve alanları (migration sonrası eklendi, eski kayıtlarda null olabilir)
    stability: number | null;        // hafıza kararlılığı (gün)
    retrievability: number | null;   // anlık hatırlama oranı [0,1]
    next_review_at: number | null;   // unix timestamp (saniye)
    review_count: number | null;     // toplam review sayısı
    max_importance: number | null; // arşivden geri gelirken importance cap (re-learning)
  }
  
  // ========== Feedback Tipleri ==========
  
  export interface FeedbackRow {
    id: number;
    message_id: string;
    conversation_id: string;
    type: 'positive' | 'negative';
    comment: string | null;
    created_at: string;
  }
  
  export interface FeedbackInput {
    messageId: string;
    conversationId: string;
    type: 'positive' | 'negative';
    comment?: string | null;
    timestamp: string;
  }

export interface MemoryWriteMetadata {
    source?: string;
    conversationId?: string;
    messageId?: number;
    confidence?: number;
    reviewProfile?: string;
    memoryType?: MemoryType;
    reconsolidationHint?: 'access' | 'write_merge';
    rolloutState?: 'disabled' | 'shadow' | 'commit';
    writeTraceId?: string;
}

export type ReconsolidationProposalMode = 'skip' | 'proposal_append' | 'commit_update';

export interface ReconsolidationGuardrailSnapshot {
    confidenceFloor: number;
    strictContainmentFloor: number;
    structuredVarianceSimilarityFloor: number;
    highSimilaritySemanticFloor: number;
    highSimilarityJaccardFloor: number;
    appendSemanticFloor: number;
    appendJaccardFloor: number;
    observedConfidence: number | null;
    semanticSimilarity: number;
    jaccardSimilarity: number;
    containmentRatio: number;
    structuredVariance: boolean;
    incomingAddsNewInformation: boolean;
}

export interface ReconsolidationDecision {
    pilotActive: boolean;
    eligible: boolean;
    action: 'update' | 'append' | 'skip';
    reason: string;
    safetyReasons: string[];
    preferredContent: 'existing' | 'incoming' | 'longer';
    candidateContent: string | null;
    proposalMode: ReconsolidationProposalMode;
    commitEligible: boolean;
    shadowEligible: boolean;
    guardrails: ReconsolidationGuardrailSnapshot;
}

export interface MessageSearchRow extends MessageRow {
    similarity: number;
    conversation_title: string;
    channel_type: string;
}

export interface RecentConversationRow extends ConversationRow {
    message_count: number;
    first_message: string | null;
}

// ========== Memory Graph Interfaces ==========

export interface MemoryEntityRow {
    id: number;
    name: string;
    type: string;
    normalized_name: string;
    created_at: string;
}

export interface MemoryRelationRow {
    id: number;
    source_memory_id: number;
    target_memory_id: number;
    relation_type: string;
    confidence: number;
    description: string;
    created_at: string;
    last_accessed_at: string | null;
    access_count: number | null;
    decay_rate: number | null;
}

export interface GraphNode {
    id: string;            // "memory_<id>" or "entity_<id>"
    type: 'memory' | 'entity';
    label: string;
    fullContent?: string;
    rawId?: number;
    category?: string;
    importance?: number;
    entityType?: string;   // person, technology, project, concept, place, etc.
}

export interface GraphEdge {
    source: string;
    target: string;
    type: string;          // related_to, supports, contradicts, caused_by, part_of, has_entity
    confidence: number;
    description: string;
}

export interface MemoryGraph {
    nodes: GraphNode[];
    edges: GraphEdge[];
}

export interface GraphAwareSearchResult {
    active: MemoryRow[];
    archival: MemoryRow[];
}

// ========== GraphRAG Interfaces ==========

/** GraphExpander: Multi-hop BFS traversal sonucu */
export interface GraphExpansionResult {
    nodes: MemoryRow[];
    edges: MemoryRelationRow[];
    hopDistances: Map<number, number>;  // nodeId -> hop distance
    maxHopReached: boolean;
}

/** GraphExpander: Traversal seçenekleri */
export interface GraphExpansionOptions {
    seedNodeIds: number[];
    maxDepth: number;        // Default: 3
    maxNodes: number;        // Default: 50 (performans limiti)
    relationTypes?: string[]; // null ise tüm relation tipleri
    minConfidence: number;   // Default: 0.3
    useCache: boolean;       // Default: true
}

/** PageRank: Scoring seçenekleri */
export interface PageRankOptions {
    dampingFactor: number;       // Default: 0.85
    maxIterations: number;       // Default: 20
    convergenceThreshold: number; // Default: 0.001
}

/** GraphCache: Cache entry */
export interface GraphCacheEntry {
    queryHash: string;
    maxDepth: number;
    nodeIds: number[];
    relationIds: number[];
    score: number;
    createdAt: Date;
    expiresAt: Date;
}

/** GraphExpander: Neighbor query sonucu */
export interface NeighborResult {
    nodeId: number;
    neighborId: number;
    relationId: number;
    relationType: string;
    confidence: number;
    weight: number;
}

// ========== Yardımcı Fonksiyonlar ==========

/**
 * FTS5 özel karakterlerini escape eder.
 * AND, OR, NOT operatörlerini ve *, ", ( ) gibi sembolleri temizler.
 */
export function escapeFtsQuery(text: string, useOr: boolean = false): string {
    // Tırnak işaretlerini kaldır
    let escaped = text.replace(/"/g, '');
    // Parantezleri kaldır
    escaped = escaped.replace(/[()]/g, '');
    // Yıldız ve diğer özel karakterleri kaldır
    escaped = escaped.replace(/[*^~{}\[\]]/g, '');
    // Kelimelere ayır ve FTS operatörlerini filtrele
    const words = escaped.split(/\s+/).filter(w => {
        const upper = w.toUpperCase();
        return w.length > 0 && upper !== 'AND' && upper !== 'OR' && upper !== 'NOT' && upper !== 'NEAR';
    });
    if (words.length === 0) return '';
    // Her kelimeyi tırnak içine alarak güvenli MATCH sorgusu oluştur
    return words.map(w => `"${w}"`).join(useOr ? ' OR ' : ' ');
}

function normalizeCategoryForInference(category: string | null | undefined): string {
    return (category || 'general').trim().toLowerCase();
}

function hasAnyPattern(text: string, patterns: RegExp[]): boolean {
    return patterns.some(pattern => pattern.test(text));
}

export function normalizeMemoryType(memoryType: string | null | undefined): MemoryType | null {
    const normalized = (memoryType || '').trim().toLowerCase();
    if (normalized === 'episodic' || normalized === 'semantic') {
        return normalized;
    }
    return null;
}

export function inferMemoryType(
    content: string,
    category: string,
    metadata?: Pick<MemoryWriteMetadata, 'source' | 'conversationId' | 'memoryType'>,
): MemoryTypeInference {
    const explicitType = normalizeMemoryType(metadata?.memoryType);
    if (explicitType) {
        return {
            memoryType: explicitType,
            reason: 'explicit_metadata',
        };
    }

    const normalizedCategory = normalizeCategoryForInference(category);
    const normalizedContent = content.trim().toLowerCase();
    const source = (metadata?.source || '').trim().toLowerCase();

    const semanticCategories = new Set([
        'preference',
        'profile',
        'user_fact',
        'identity',
        'general',
        'knowledge',
        'concept',
        'skill',
    ]);
    const episodicCategories = new Set([
        'follow_up',
        'followup',
        'event',
        'timeline',
        'status',
        'task',
        'conversation',
        'session',
    ]);

    if (semanticCategories.has(normalizedCategory)) {
        return { memoryType: 'semantic', reason: `category:${normalizedCategory}` };
    }

    if (episodicCategories.has(normalizedCategory)) {
        return { memoryType: 'episodic', reason: `category:${normalizedCategory}` };
    }

    const preferencePatterns = [
        /\btercih/i,
        /\bfavori/i,
        /\bsever\b/i,
        /\bseviyor\b/i,
        /\bhoşlan/i,
        /\bistemem\b/i,
        /\bgenelde\b/i,
        /\balışkanlık/i,
        /\bprofil\b/i,
        /\bpreference\b/i,
        /\bprefer(s|red)?\b/i,
        /\blikes?\b/i,
        /\bdislikes?\b/i,
    ];
    if (hasAnyPattern(normalizedContent, preferencePatterns)) {
        return { memoryType: 'semantic', reason: 'content:preference_or_profile_cue' };
    }

    const episodicPatterns = [
        /\bbugün\b/i,
        /\bdün\b/i,
        /\byarın\b/i,
        /\baz önce\b/i,
        /\bgeçen\b/i,
        /\bson konuşma\b/i,
        /\bson durum\b/i,
        /\bgüncel\b/i,
        /\bupdate\b/i,
        /\bfollow[ -]?up\b/i,
        /\btoplantı\b/i,
        /\bcall\b/i,
        /\bissue\b/i,
        /\btask\b/i,
        /\bprogress\b/i,
    ];
    if (hasAnyPattern(normalizedContent, episodicPatterns)) {
        return { memoryType: 'episodic', reason: 'content:temporal_or_followup_cue' };
    }

    if (source === 'conversation' && metadata?.conversationId) {
        return { memoryType: 'episodic', reason: 'source:conversation_scoped_default' };
    }

    if (source === 'system' || source === 'import') {
        return { memoryType: 'semantic', reason: `source:${source || 'system'}` };
    }

    return {
        memoryType: 'semantic',
        reason: 'default:semantic_safe_fallback',
    };
}

/** Konuşma timeout süresi (milisaniye) — 2 saat */
export const CONVERSATION_TIMEOUT_MS = 2 * 60 * 60 * 1000;

/** Tek kullanıcılı sistem — sabit kullanıcı ID'si */
export const DEFAULT_USER_ID = 'default';
export const DEFAULT_USER_NAME = 'Kullanıcı';
