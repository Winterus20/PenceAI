/**
 * MultiHopRetrieval — Agentic RAG Multi-Hop Retrieval Loop (Faz 4)
 *
 * Kritik "eksik bilgi" tespit ettiğinde yeni bir sorguyla tekrar retrieval yapar.
 * Maksimum 3 kez tekrar eder. Her seferinde:
 * 1. Eksik bilgiye göre yeni sorgu üret
 * 2. Farklı retriever stratejisi dene
 * 3. Yeni sonuçları mevcutlerle birleştir (dedup)
 * 4. Yeni sonuçları tekrar kritiğe sok
 *
 * Self-RAG'in multi-hop reasoning iyileştirmesinin karşılığıdır.
 */

import type { MemoryRow } from '../types.js';
import type { LLMProvider } from '../../llm/provider.js';
import type { CritiqueResult } from './PassageCritique.js';
import type { RetrieverType } from './RetrievalDecider.js';

export interface HopEntry {
    hopNumber: number;
    query: string;
    retrieversUsed: RetrieverType[];
    resultsCount: number;
    critiqueResult: CritiqueResult;
}

export interface MultiHopResult {
    memories: MemoryRow[];
    hops: HopEntry[];
    finalCompleteness: number;
    exhaustedMaxHops: boolean;
    totalRetrievalCalls: number;
}

const QUERY_REFINEMENT_PROMPT = `You are a Query Refinement Engine. Based on what's missing, generate a NEW, more targeted search query.

Original Query: "{query}"
What's Missing: {missingInfo}
What We Already Found: {foundSummary}

Generate a DIFFERENT, more targeted query that would find the missing information. Be specific.
Focus on the gaps — don't just repeat the original query.

Output: <query>your refined query here</query>`;

export interface MultiHopRetrievalConfig {
    maxHops: number;                    // Default: 3
    hopRetrieverStrategy: RetrieverType[][];  // Her hop için kullanılacak retriever'lar
}

const DEFAULT_CONFIG: MultiHopRetrievalConfig = {
    maxHops: 3,
    hopRetrieverStrategy: [
        ['system2'],                          // 1. hop: derin hybrid search
        ['graphRAG'],                          // 2. hop: graph-based retrieval
        ['system1', 'system2', 'graphRAG'],   // 3. hop: hepsi (son çare)
    ],
};

export class MultiHopRetrieval {
    private config: MultiHopRetrievalConfig;

    constructor(
        private llmProvider: LLMProvider,
        private critiqueFn: (query: string, passages: MemoryRow[]) => Promise<CritiqueResult>,
        config?: Partial<MultiHopRetrievalConfig>,
    ) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Multi-hop retrieval loop.
     *
     * @param originalQuery - Orijinal kullanıcı sorgusu
     * @param initialResult - İlk retrieval sonuçları
     * @param initialCritique - İlk retrieval'ın kritik sonucu
     * @param retrieveFn - Belirtilen retriever'larla arama yapan fonksiyon
     */
    async execute(
        originalQuery: string,
        initialResult: MemoryRow[],
        initialCritique: CritiqueResult,
        retrieveFn: (query: string, retrievers: RetrieverType[]) => Promise<MemoryRow[]>,
    ): Promise<MultiHopResult> {
        const hops: HopEntry[] = [];
        let currentMemories = [...initialResult];
        let currentCritique = initialCritique;
        let totalRetrievalCalls = 1; // İlk retrieval zaten yapıldı

        for (let hop = 1; hop <= this.config.maxHops; hop++) {
            // Yeterli bilgi varsa döngüyü kır
            if (!currentCritique.needsMoreRetrieval) {
                break;
            }

            // 1. Yeni sorgu üret
            const refinedQuery = await this.generateRefinedQuery(
                originalQuery,
                currentCritique.missingInfo,
                currentMemories,
            );

            // 2. Bu hop için retriever stratejisi seç
            const retrievers = this.selectRetrieversForHop(hop);

            // 3. Retrieval yap
            const newMemories = await retrieveFn(refinedQuery, retrievers);
            totalRetrievalCalls++;

            // 4. Yeni sonuçları kritiğe sok
            const newCritique = await this.critiqueFn(refinedQuery, newMemories);

            // 5. Mevcut bilgilerle birleştir (ID'ye göre dedup)
            const existingIds = new Set(currentMemories.map(m => m.id));
            const uniqueNew = newMemories.filter(m => !existingIds.has(m.id));
            currentMemories = [...currentMemories, ...uniqueNew];

            // 6. Hop kaydını tut
            hops.push({
                hopNumber: hop,
                query: refinedQuery,
                retrieversUsed: retrievers,
                resultsCount: newMemories.length,
                critiqueResult: newCritique,
            });

            currentCritique = newCritique;
        }

        return {
            memories: currentMemories,
            hops,
            finalCompleteness: currentCritique.overallCompleteness,
            exhaustedMaxHops: hops.length === this.config.maxHops && currentCritique.needsMoreRetrieval,
            totalRetrievalCalls,
        };
    }

    private async generateRefinedQuery(
        originalQuery: string,
        missingInfo: string[],
        previousResults: MemoryRow[],
    ): Promise<string> {
        const foundSummary = previousResults.length > 0
            ? previousResults.slice(0, 3).map(m => `• ${m.content.substring(0, 150)}`).join('\n')
            : '(nothing found yet)';

        const prompt = QUERY_REFINEMENT_PROMPT
            .replace('{query}', originalQuery)
            .replace('{missingInfo}', missingInfo.join('; '))
            .replace('{foundSummary}', foundSummary);

        try {
            const response = await this.llmProvider.chat([
                { role: 'system', content: 'You are a query refinement engine for a search system. Output only the refined query inside <query> tags.' },
                { role: 'user', content: prompt },
            ], { temperature: 0.3, maxTokens: 256 });

            const match = response.content.match(/<query>(.+?)<\/query>/is);
            if (match && match[1].trim().length > 2) {
                return match[1].trim();
            }
        } catch {
            // LLM başarısız olursa fallback
        }

        // Fallback: orijinal sorguya "more specific" ekle
        return `${originalQuery} — more details, specifics, examples`;
    }

    private selectRetrieversForHop(hop: number): RetrieverType[] {
        // Config'den strateji al, eğer yoksa default kullan
        const strategy = this.config.hopRetrieverStrategy;
        if (hop <= strategy.length) {
            return strategy[hop - 1];
        }
        // Max hop'ı aşarsa hepsini dene
        return ['system1', 'system2', 'graphRAG'];
    }
}
