import type {
    MemoryType,
    ReconsolidationDecision,
    ReconsolidationGuardrailSnapshot,
    ReconsolidationProposalMode,
} from './types.js';

export interface NormalizedMemoryWriteInput {
    content: string;
    category: string;
    importance: number;
    accepted: boolean;
    reasons: string[];
    originalContent: string;
    originalCategory: string;
    originalImportance: number;
}

export interface MemoryMergeDecisionInput {
    category: string;
    existingContent: string;
    incomingContent: string;
    semanticSimilarity?: number;
    jaccardSimilarity?: number;
    containmentRatio?: number;
}

export interface MemoryMergeDecision {
    shouldMerge: boolean;
    reason: string;
    preferredContent: 'existing' | 'incoming' | 'longer';
}

export interface ReconsolidationDecisionInput {
    memoryType: MemoryType;
    category: string;
    existingContent: string;
    incomingContent: string;
    confidence?: number | null;
    semanticSimilarity?: number;
    jaccardSimilarity?: number;
    containmentRatio?: number;
}

const CATEGORY_ALIASES: Record<string, string> = {
    fact: 'general',
    note: 'general',
    notes: 'general',
    profile: 'user_fact',
    preference: 'preference',
    preferences: 'preference',
    project_update: 'project',
    todo: 'task',
    reminder: 'task',
};

const VOLATILE_CATEGORIES = new Set(['event', 'project', 'task']);

function normalizeWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function normalizeCategory(category: string): string {
    const normalized = normalizeWhitespace(category).toLowerCase();
    return CATEGORY_ALIASES[normalized] ?? (normalized || 'general');
}

function clampImportance(importance: number): number {
    if (!Number.isFinite(importance)) return 5;
    return Math.max(1, Math.min(10, Math.round(importance)));
}

function hasStructuredVariance(existingContent: string, incomingContent: string): boolean {
    const existingHasDigits = /\d/.test(existingContent);
    const incomingHasDigits = /\d/.test(incomingContent);
    const existingHasDateLike = /\b\d{1,2}[./-]\d{1,2}([./-]\d{2,4})?\b/.test(existingContent);
    const incomingHasDateLike = /\b\d{1,2}[./-]\d{1,2}([./-]\d{2,4})?\b/.test(incomingContent);
    return (existingHasDigits && incomingHasDigits) || existingHasDateLike || incomingHasDateLike;
}

export function normalizeMemoryWriteInput(
    content: string,
    category: string = 'general',
    importance: number = 5,
): NormalizedMemoryWriteInput {
    const normalizedContent = normalizeWhitespace(content);
    const normalizedCategory = normalizeCategory(category);
    const normalizedImportance = clampImportance(importance);
    const reasons: string[] = [];

    if (normalizedContent !== content) {
        reasons.push('content_normalized');
    }
    if (normalizedCategory !== category) {
        reasons.push('category_normalized');
    }
    if (normalizedImportance !== importance) {
        reasons.push('importance_clamped');
    }

    const accepted = normalizedContent.length > 0;
    if (!accepted) {
        reasons.push('empty_content_rejected');
    }

    return {
        content: normalizedContent,
        category: normalizedCategory,
        importance: normalizedImportance,
        accepted,
        reasons,
        originalContent: content,
        originalCategory: category,
        originalImportance: importance,
    };
}

export function decideMemoryMerge(input: MemoryMergeDecisionInput): MemoryMergeDecision {
    const { category, existingContent, incomingContent, semanticSimilarity = 0, jaccardSimilarity = 0, containmentRatio = 0 } = input;
    const normalizedCategory = normalizeCategory(category);

    if (normalizeWhitespace(existingContent).toLowerCase() === normalizeWhitespace(incomingContent).toLowerCase()) {
        return {
            shouldMerge: true,
            reason: 'exact_normalized_match',
            preferredContent: 'longer',
        };
    }

    if (VOLATILE_CATEGORIES.has(normalizedCategory) && hasStructuredVariance(existingContent, incomingContent)) {
        const passesStrictSignal = semanticSimilarity >= 0.92 || jaccardSimilarity >= 0.78 || containmentRatio >= 0.9;
        return {
            shouldMerge: passesStrictSignal,
            reason: passesStrictSignal ? 'volatile_category_strict_match' : 'volatile_category_preserve_distinct',
            preferredContent: containmentRatio >= 0.9 ? 'existing' : 'longer',
        };
    }

    if (containmentRatio >= 0.9) {
        return {
            shouldMerge: true,
            reason: 'incoming_contained_by_existing',
            preferredContent: 'existing',
        };
    }

    return {
        shouldMerge: true,
        reason: 'default_merge_allowed',
        preferredContent: 'longer',
    };
}

function tokenizeForSimilarity(text: string): Set<string> {
    return new Set(normalizeWhitespace(text).toLowerCase().split(/\s+/).filter(token => token.length > 2));
}

function computeJaccardSimilarity(existingContent: string, incomingContent: string): number {
    const setA = tokenizeForSimilarity(existingContent);
    const setB = tokenizeForSimilarity(incomingContent);
    const intersectionCount = [...setA].filter(token => setB.has(token)).length;
    const unionSize = setA.size + setB.size - intersectionCount;
    return unionSize > 0 ? intersectionCount / unionSize : 0;
}

function computeContainmentRatio(existingContent: string, incomingContent: string): number {
    const incomingTokens = tokenizeForSimilarity(incomingContent);
    if (incomingTokens.size === 0) return 0;
    const existingTokens = tokenizeForSimilarity(existingContent);
    const overlap = [...incomingTokens].filter(token => existingTokens.has(token)).length;
    return overlap / incomingTokens.size;
}

export function decideReconsolidationPilot(input: ReconsolidationDecisionInput): ReconsolidationDecision {
    const {
        memoryType,
        category,
        existingContent,
        incomingContent,
        confidence,
        semanticSimilarity = 0,
        jaccardSimilarity = computeJaccardSimilarity(existingContent, incomingContent),
        containmentRatio = computeContainmentRatio(existingContent, incomingContent),
    } = input;

    const normalizedExisting = normalizeWhitespace(existingContent).toLowerCase();
    const normalizedIncoming = normalizeWhitespace(incomingContent).toLowerCase();
    const safetyReasons: string[] = [];
    const guardrails: ReconsolidationGuardrailSnapshot = {
        confidenceFloor: 0.78,
        strictContainmentFloor: 0.92,
        structuredVarianceSimilarityFloor: 0.95,
        highSimilaritySemanticFloor: 0.93,
        highSimilarityJaccardFloor: 0.85,
        appendSemanticFloor: 0.86,
        appendJaccardFloor: 0.72,
        observedConfidence: Number.isFinite(confidence) ? Number(confidence) : null,
        semanticSimilarity,
        jaccardSimilarity,
        containmentRatio,
        structuredVariance: hasStructuredVariance(existingContent, incomingContent),
        incomingAddsNewInformation: normalizedExisting !== normalizedIncoming,
    };

    const buildDecision = (
        decision: Omit<ReconsolidationDecision, 'guardrails' | 'proposalMode' | 'commitEligible' | 'shadowEligible'>,
        proposalMode: ReconsolidationProposalMode,
    ): ReconsolidationDecision => ({
        ...decision,
        proposalMode,
        commitEligible: decision.action === 'update',
        shadowEligible: decision.action === 'update' || decision.action === 'append',
        guardrails,
    });

    if (memoryType !== 'semantic') {
        safetyReasons.push('memory_type_not_semantic');
        return buildDecision({
            pilotActive: true,
            eligible: false,
            action: 'skip',
            reason: 'episodic_memory_excluded',
            safetyReasons,
            preferredContent: 'existing',
            candidateContent: null,
        }, 'skip');
    }

    if (!Number.isFinite(confidence) || Number(confidence) < guardrails.confidenceFloor) {
        safetyReasons.push('confidence_below_floor');
        return buildDecision({
            pilotActive: true,
            eligible: false,
            action: 'skip',
            reason: 'low_confidence_guard',
            safetyReasons,
            preferredContent: 'existing',
            candidateContent: null,
        }, 'skip');
    }

    if (normalizedExisting === normalizedIncoming) {
        safetyReasons.push('no_new_information');
        return buildDecision({
            pilotActive: true,
            eligible: true,
            action: 'skip',
            reason: 'exact_match_no_rewrite',
            safetyReasons,
            preferredContent: 'existing',
            candidateContent: null,
        }, 'skip');
    }

    if (guardrails.structuredVariance && containmentRatio < guardrails.strictContainmentFloor && semanticSimilarity < guardrails.structuredVarianceSimilarityFloor) {
        safetyReasons.push('structured_variance_conflict');
        return buildDecision({
            pilotActive: true,
            eligible: true,
            action: 'skip',
            reason: 'conflict_guard_preserve_existing',
            safetyReasons,
            preferredContent: 'existing',
            candidateContent: null,
        }, 'skip');
    }

    if (containmentRatio >= guardrails.strictContainmentFloor) {
        safetyReasons.push('contained_update_guard');
        return buildDecision({
            pilotActive: true,
            eligible: true,
            action: 'update',
            reason: 'high_containment_guarded_update',
            safetyReasons,
            preferredContent: 'existing',
            candidateContent: existingContent,
        }, 'commit_update');
    }

    if (semanticSimilarity >= guardrails.highSimilaritySemanticFloor || jaccardSimilarity >= guardrails.highSimilarityJaccardFloor) {
        safetyReasons.push('high_similarity_guard');
        const preferredContent = incomingContent.length >= existingContent.length ? 'incoming' : 'existing';
        return buildDecision({
            pilotActive: true,
            eligible: true,
            action: 'update',
            reason: 'high_similarity_guarded_update',
            safetyReasons,
            preferredContent,
            candidateContent: preferredContent === 'incoming' ? incomingContent : existingContent,
        }, 'commit_update');
    }

    if (semanticSimilarity >= guardrails.appendSemanticFloor || jaccardSimilarity >= guardrails.appendJaccardFloor) {
        safetyReasons.push('append_first_guard');
        return buildDecision({
            pilotActive: true,
            eligible: true,
            action: 'append',
            reason: 'novel_semantic_detail_append_first',
            safetyReasons,
            preferredContent: 'longer',
            candidateContent: `${existingContent}\n[reconsolidated] ${incomingContent}`,
        }, 'proposal_append');
    }

    safetyReasons.push(`category:${normalizeCategory(category) || 'general'}`);
    safetyReasons.push('weak_signal_no_change');
    return buildDecision({
        pilotActive: true,
        eligible: false,
        action: 'skip',
        reason: 'weak_reconsolidation_signal',
        safetyReasons,
        preferredContent: 'existing',
        candidateContent: null,
    }, 'skip');
}
