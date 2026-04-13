import type { ConversationMessage } from '../router/types.js';
import { DEFAULT_USER_NAME, type MemoryRow, type MemoryWriteMetadata } from './types.js';
import { computeRetention } from './ebbinghaus.js';
import { daysSince } from '../utils/datetime.js';

/** Konuşma bağlamı kelime dağarcığı için son N mesaj */
const CONVERSATION_LEXICON_WINDOW = 6;

export interface RRFScoreEntry<T> {
    score: number;
    item: T;
}

export interface RRFExplainEntry {
    id: number;
    sources: Array<'fts' | 'semantic'>;
    baseScore: number;
    retentionWeight?: number;
    finalScore?: number;
}

export interface RRFResult<T> {
    results: T[];
    scoreEntries: RRFScoreEntry<T>[];
    explain?: RRFExplainEntry[];
}

export function rrfFusion<T>(
    ftsResults: T[],
    semResults: T[],
    getId: (item: T) => number,
    toItem: (item: T) => T,
    limit: number,
    k: number = 60,
    ftsWeight: number = 1.5,
): RRFResult<T> {
    const scoreMap = new Map<number, RRFScoreEntry<T>>();
    const explainMap = new Map<number, RRFExplainEntry>();

    ftsResults.forEach((item, rank) => {
        const id = getId(item);
        const rrfScore = (1 / (k + rank + 1)) * ftsWeight;
        scoreMap.set(id, { score: rrfScore, item: toItem(item) });
        explainMap.set(id, {
            id,
            sources: ['fts'],
            baseScore: rrfScore,
        });
    });

    semResults.forEach((item, rank) => {
        const rrfScore = 1 / (k + rank + 1);
        const id = getId(item);
        const existing = scoreMap.get(id);
        const existingExplain = explainMap.get(id);
        if (existing) {
            existing.score += rrfScore;
            existing.item = toItem(item);
            if (existingExplain && !existingExplain.sources.includes('semantic')) {
                existingExplain.sources.push('semantic');
                existingExplain.baseScore += rrfScore;
            }
        } else {
            scoreMap.set(id, { score: rrfScore, item: toItem(item) });
            explainMap.set(id, {
                id,
                sources: ['semantic'],
                baseScore: rrfScore,
            });
        }
    });

    const scoreEntries = Array.from(scoreMap.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

    return {
        results: scoreEntries.map(entry => entry.item),
        scoreEntries,
        explain: scoreEntries.map(entry => explainMap.get(getId(entry.item))).filter((entry): entry is RRFExplainEntry => Boolean(entry)),
    };
}

export function applyRetentionToRrf(entries: RRFScoreEntry<MemoryRow>[], limit: number): MemoryRow[] {
    return applyRetentionToRrfWithExplain(entries, limit).results;
}

export function applyRetentionToRrfWithExplain(entries: RRFScoreEntry<MemoryRow>[], limit: number): {
    results: MemoryRow[];
    explain: RRFExplainEntry[];
} {
    const explain: RRFExplainEntry[] = [];

    for (const entry of entries) {
        const memory = entry.item;
        const stability = memory.stability ?? (memory.importance * 2.0);
        const elapsedDays = daysSince(memory.last_accessed);
        const retention = computeRetention(stability, elapsedDays);
        const retentionWeight = 0.4 + 0.6 * retention;
        const baseScore = entry.score;
        entry.score *= retentionWeight;
        explain.push({
            id: memory.id,
            sources: [],
            baseScore,
            retentionWeight,
            finalScore: entry.score,
        });
    }

    const ranked = entries
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

    return {
        results: ranked.map(entry => entry.item),
        explain: ranked.map(entry => explain.find(item => item.id === entry.item.id)!).filter(Boolean),
    };
}

export interface MemoryReviewPolicy {
    profile: string;
    initialStabilityMultiplier: number;
    reviewCadenceMultiplier: number;
    retentionFloor: number;
    confidenceWeight: number;
}

export interface ConversationAwareSelectionInput {
    query: string;
    activeConversationId: string;
    recentMessages: Array<{ role: string; content: string; created_at: string; conversation_title: string }>;
    relevantMemories: MemoryRow[];
    fallbackMemories: MemoryRow[];
    limit: number;
}

const REVIEW_POLICIES: Record<string, MemoryReviewPolicy> = {
    strict: {
        profile: 'strict',
        initialStabilityMultiplier: 0.9,
        reviewCadenceMultiplier: 0.85,
        retentionFloor: 0.8,
        confidenceWeight: 1.15,
    },
    standard: {
        profile: 'standard',
        initialStabilityMultiplier: 1,
        reviewCadenceMultiplier: 1,
        retentionFloor: 0.7,
        confidenceWeight: 1,
    },
    volatile: {
        profile: 'volatile',
        initialStabilityMultiplier: 0.7,
        reviewCadenceMultiplier: 0.75,
        retentionFloor: 0.62,
        confidenceWeight: 0.9,
    },
    durable: {
        profile: 'durable',
        initialStabilityMultiplier: 1.2,
        reviewCadenceMultiplier: 1.15,
        retentionFloor: 0.6,
        confidenceWeight: 1.05,
    },
};

const REVIEW_PROFILE_BY_CATEGORY: Record<string, string> = {
    event: 'volatile',
    project: 'volatile',
    task: 'volatile',
    preference: 'strict',
    user_fact: 'strict',
    profile: 'strict',
    general: 'standard',
    concept: 'durable',
    knowledge: 'durable',
};

function normalizeCategory(category: string | null | undefined): string {
    return (category || 'general').trim().toLowerCase() || 'general';
}

function normalizeProfile(profile: string | null | undefined): string {
    const normalized = (profile || '').trim().toLowerCase();
    return REVIEW_POLICIES[normalized] ? normalized : 'standard';
}

function clampConfidence(confidence: number | null | undefined): number {
    if (!Number.isFinite(confidence)) return 0.7;
    return Math.max(0.2, Math.min(0.98, Number(confidence)));
}

function extractTerms(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .map(part => part.trim())
        .filter(part => part.length >= 3);
}

function buildConversationLexicon(
    query: string,
    recentMessages: Array<{ role: string; content: string; created_at: string; conversation_title: string }>,
): Set<string> {
    const lexicon = new Set<string>(extractTerms(query));
    const recentSlice = recentMessages.slice(-CONVERSATION_LEXICON_WINDOW);
    for (const message of recentSlice) {
        for (const term of extractTerms(message.content)) {
            lexicon.add(term);
        }
    }
    return lexicon;
}

function scoreConversationAffinity(memory: MemoryRow, conversationLexicon: Set<string>, activeConversationId: string): number {
    let score = 0;
    if (memory.provenance_conversation_id && memory.provenance_conversation_id === activeConversationId) {
        score += 4;
    }

    const memoryTerms = extractTerms(memory.content);
    let overlap = 0;
    for (const term of memoryTerms) {
        if (conversationLexicon.has(term)) {
            overlap++;
        }
    }

    if (overlap > 0) {
        score += Math.min(3, overlap * 0.6);
    }

    if (memory.provenance_source === 'conversation') {
        score += 0.5;
    }

    return score;
}

export function deriveMemoryWriteMetadata(
    category: string,
    metadata?: MemoryWriteMetadata,
): Required<Pick<MemoryWriteMetadata, 'source' | 'confidence' | 'reviewProfile'>>
    & Pick<MemoryWriteMetadata, 'conversationId' | 'messageId' | 'rolloutState' | 'writeTraceId'> {
    const normalizedCategory = normalizeCategory(category);
    const reviewProfile = normalizeProfile(metadata?.reviewProfile ?? REVIEW_PROFILE_BY_CATEGORY[normalizedCategory]);
    const policy = REVIEW_POLICIES[reviewProfile];
    const defaultSource = metadata?.conversationId ? 'conversation' : 'system';

    return {
        source: (metadata?.source || defaultSource).trim().toLowerCase(),
        conversationId: metadata?.conversationId,
        messageId: metadata?.messageId,
        confidence: clampConfidence((metadata?.confidence ?? 0.7) * policy.confidenceWeight),
        reviewProfile,
        rolloutState: metadata?.rolloutState ?? 'commit',
        writeTraceId: metadata?.writeTraceId,
    };
}

export function getReviewPolicy(category: string, reviewProfile?: string | null): MemoryReviewPolicy {
    const categoryProfile = REVIEW_PROFILE_BY_CATEGORY[normalizeCategory(category)];
    const resolvedProfile = normalizeProfile(reviewProfile ?? categoryProfile);
    return REVIEW_POLICIES[resolvedProfile];
}

export function computeInitialReviewSchedule(
    importance: number,
    category: string,
    reviewProfile?: string | null,
): { profile: string; initialStability: number; firstRetentionTarget: number } {
    const policy = getReviewPolicy(category, reviewProfile);
    const initialStability = Math.max(0.75, importance * 2.0 * policy.initialStabilityMultiplier);
    return {
        profile: policy.profile,
        initialStability,
        firstRetentionTarget: policy.retentionFloor,
    };
}

export function computeReviewPriority(memory: MemoryRow, nowSec: number = Math.floor(Date.now() / 1000)): number {
    const policy = getReviewPolicy(memory.category, memory.review_profile);
    const dueAt = memory.next_review_at ?? nowSec;
    const overdueHours = Math.max(0, (nowSec - dueAt) / 3600);
    const retrievabilityPenalty = 1 - (memory.retrievability ?? 1);
    const confidencePenalty = 1 - clampConfidence(memory.confidence);
    return overdueHours * policy.reviewCadenceMultiplier + retrievabilityPenalty * 5 + confidencePenalty * 3;
}

export function selectConversationAwareSupplementalMemories(input: ConversationAwareSelectionInput): MemoryRow[] {
    const { query, activeConversationId, recentMessages, relevantMemories, fallbackMemories, limit } = input;
    if (limit <= 0) return [];

    const excludedIds = new Set(relevantMemories.map(memory => memory.id));
    const conversationLexicon = buildConversationLexicon(query, recentMessages);

    return fallbackMemories
        .filter(memory => !excludedIds.has(memory.id))
        .map(memory => ({
            memory,
            score: scoreConversationAffinity(memory, conversationLexicon, activeConversationId)
                + (memory.access_count * 0.08)
                + (memory.importance * 0.18)
                + (memory.confidence ?? 0.7),
        }))
        .sort((a, b) => b.score - a.score || b.memory.updated_at.localeCompare(a.memory.updated_at))
        .slice(0, limit)
        .map(entry => entry.memory);
}

export function buildConversationTranscript(
    history: ConversationMessage[],
    userName: string | undefined,
): { history: ConversationMessage[]; conversationText: string; userName: string } {
    const conversationText = history
        .filter(entry => entry.role === 'user' || entry.role === 'assistant')
        .map(entry => `${entry.role === 'user' ? 'Kullanıcı' : 'Asistan'}: ${entry.content}`)
        .join('\n\n');

    return {
        history,
        conversationText,
        userName: userName || DEFAULT_USER_NAME,
    };
}
