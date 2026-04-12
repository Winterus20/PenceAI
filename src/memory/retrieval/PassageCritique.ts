/**
 * PassageCritique — Agentic RAG Passage Critique Engine (Faz 2)
 *
 * Retrieval sonrası getirilen bellekleri tek tek değerlendirir:
 * - Alaka düzeyi (relevance): Bu passage soruyla alakalı mı?
 * - Tamlık (completeness): Yeterli bilgi sağlıyor mu?
 * - Sorunlar: Güncel mi, çelişkili mi, çok mu genel?
 *
 * Düşük skorlu passage'ları filtreler ve eksik bilgi tespit eder.
 * Self-RAG'deki [Relevant]/[Irrelevant] ve [Complete]/[Partial] token'larının
 * prompt-based karşılığıdır.
 */

import type { MemoryRow } from '../types.js';
import type { LLMProvider } from '../../llm/provider.js';

export type RelevanceLevel = 'Relevant' | 'PartiallyRelevant' | 'Irrelevant';
export type CompletenessLevel = 'Complete' | 'Partial' | 'Insufficient';

export interface PassageEvaluation {
    memoryId: number;
    relevance: RelevanceLevel;
    relevanceScore: number;        // 0-1
    completeness: CompletenessLevel;
    completenessScore: number;     // 0-1
    issues: string[];
    keep: boolean;
}

export interface CritiqueResult {
    evaluations: PassageEvaluation[];
    keptCount: number;
    filteredCount: number;
    overallCompleteness: number;   // 0-1 (kept passages' avg)
    needsMoreRetrieval: boolean;
    missingInfo: string[];
}

const PASSAGE_CRITIQUE_PROMPT = `You are a Passage Critique Engine for a personal AI assistant. Evaluate each retrieved passage against a user query.

For EACH passage, assess:
1. **Relevance**: Does this passage directly address the query?
   - Relevant: Directly addresses the query with specific info
   - PartiallyRelevant: Partially addresses, but has gaps or is tangential
   - Irrelevant: Does not address the query at all

2. **Completeness**: Does this passage provide enough detail to answer?
   - Complete: Sufficient detail and specifics to answer the query
   - Partial: Some useful info, but missing key details
   - Insufficient: Too vague, outdated, or lacks specifics

3. **Issues**: List any problems (e.g., "Outdated", "Too generic", "Contradicts other passage", "Missing specifics", "Wrong context")

Output format — valid JSON array only, no extra text:
[
  {
    "memoryId": 123,
    "relevance": "Relevant",
    "relevanceScore": 0.85,
    "completeness": "Partial",
    "completenessScore": 0.6,
    "issues": ["Missing specifics"],
    "keep": true
  }
]

RULES:
- Only set "keep": true if relevanceScore >= 0.5 AND completenessScore >= 0.3
- Be honest — if a passage is useless for this query, mark it irrelevant
- Do not hallucinate passage content — only evaluate what's actually there`;

export interface PassageCritiqueConfig {
    relevanceFloor: number;       // Default: 0.5 — altındaysa keep=false
    completenessFloor: number;    // Default: 0.3 — altındaysa keep=false
    maxPassagesPerCritique: number; // Default: 15 — çok fazla passage varsa truncate
}

const DEFAULT_CONFIG: PassageCritiqueConfig = {
    relevanceFloor: 0.5,
    completenessFloor: 0.3,
    maxPassagesPerCritique: 15,
};

export class PassageCritique {
    private config: PassageCritiqueConfig;

    constructor(
        private llmProvider: LLMProvider,
        config?: Partial<PassageCritiqueConfig>,
    ) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    async evaluate(
        query: string,
        passages: MemoryRow[],
    ): Promise<CritiqueResult> {
        if (passages.length === 0) {
            return this.emptyResult();
        }

        // Çok fazla passage varsa en önemlileriyle sınırla
        const limitedPassages = passages.slice(0, this.config.maxPassagesPerCritique);

        const prompt = this.buildPrompt(query, limitedPassages);
        const response = await this.llmProvider.chat([
            { role: 'system', content: PASSAGE_CRITIQUE_PROMPT },
            { role: 'user', content: prompt },
        ], { temperature: 0.2, maxTokens: 2048 });

        const evaluations = this.parseResponse(response.content, limitedPassages);

        // Config filter uygula
        const filteredEvaluations = evaluations.map(e => ({
            ...e,
            keep: e.keep && e.relevanceScore >= this.config.relevanceFloor && e.completenessScore >= this.config.completenessFloor,
        }));

        const kept = filteredEvaluations.filter(e => e.keep);

        return {
            evaluations: filteredEvaluations,
            keptCount: kept.length,
            filteredCount: filteredEvaluations.length - kept.length,
            overallCompleteness: kept.length > 0
                ? kept.reduce((sum, e) => sum + e.completenessScore, 0) / kept.length
                : 0,
            needsMoreRetrieval: kept.length === 0 || kept.every(e => e.completenessScore < 0.6),
            missingInfo: this.extractMissingInfo(query, filteredEvaluations),
        };
    }

    private emptyResult(): CritiqueResult {
        return {
            evaluations: [],
            keptCount: 0,
            filteredCount: 0,
            overallCompleteness: 0,
            needsMoreRetrieval: true,
            missingInfo: ['No passages retrieved'],
        };
    }

    private buildPrompt(query: string, passages: MemoryRow[]): string {
        const passagesText = passages.map((p, i) => {
            const header = `[Passage ${i + 1}] ID: ${p.id} | Category: ${p.category || 'uncategorized'} | Importance: ${p.importance}/5`;
            const content = p.content.substring(0, 400);
            return `${header}\n${content}`;
        }).join('\n\n---\n\n');

        return `Query: "${query}"

Retrieved Passages (${passages.length}):

${passagesText}`;
    }

    private parseResponse(content: string, passages: MemoryRow[]): PassageEvaluation[] {
        try {
            // JSON array çıkar
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (!jsonMatch) {
                return this.defaultEvaluations(passages);
            }
            const parsed = JSON.parse(jsonMatch[0]);
            if (!Array.isArray(parsed)) {
                return this.defaultEvaluations(passages);
            }

            // Validasyon
            return parsed.map((item: Record<string, unknown>, index: number): PassageEvaluation => {
                const memoryId = typeof item.memoryId === 'number' ? item.memoryId : (passages[index]?.id ?? 0);
                const relevance = (item.relevance as RelevanceLevel) || 'PartiallyRelevant';
                const relevanceScore = typeof item.relevanceScore === 'number' ? Math.min(1, Math.max(0, item.relevanceScore)) : 0.5;
                const completeness = (item.completeness as CompletenessLevel) || 'Partial';
                const completenessScore = typeof item.completenessScore === 'number' ? Math.min(1, Math.max(0, item.completenessScore)) : 0.5;
                const issues = Array.isArray(item.issues) ? item.issues : ['No issues listed'];
                const keep = typeof item.keep === 'boolean' ? item.keep : true;

                return { memoryId, relevance, relevanceScore, completeness, completenessScore, issues, keep };
            });
        } catch {
            return this.defaultEvaluations(passages);
        }
    }

    private defaultEvaluations(passages: MemoryRow[]): PassageEvaluation[] {
        // Parse başarısızsa konservatif yaklaş: hepsini tut
        return passages.map(p => ({
            memoryId: p.id,
            relevance: 'PartiallyRelevant' as const,
            relevanceScore: 0.5,
            completeness: 'Partial' as const,
            completenessScore: 0.5,
            issues: ['Critique parse failed, keeping as fallback'],
            keep: true,
        }));
    }

    private extractMissingInfo(query: string, evaluations: PassageEvaluation[]): string[] {
        const missing: string[] = [];

        const rejected = evaluations.filter(e => !e.keep);
        const incomplete = evaluations.filter(e => e.keep && e.completeness === 'Insufficient');
        const partiallyRelevant = evaluations.filter(e => e.keep && e.relevance === 'PartiallyRelevant');

        if (rejected.length > 0 && evaluations.length === rejected.length) {
            missing.push(`All ${evaluations.length} passages were rejected by critique`);
        }

        if (incomplete.length > 0) {
            missing.push(`${incomplete.length} passage(s) deemed insufficient for query: "${query.substring(0, 60)}"`);
        }

        if (partiallyRelevant.length > 0 && partiallyRelevant.length === evaluations.filter(e => e.keep).length) {
            missing.push('All kept passages are only partially relevant');
        }

        return missing;
    }
}
