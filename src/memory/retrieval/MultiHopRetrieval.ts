/**
 * MultiHopRetrieval — Agentic RAG Multi-Hop Engine (Faz 4/5)
 *
 * Eğer PassageCritique aşaması mevcut bilgilerin kullanıcı sorusunu cevaplamak için
 * eksik (incomplete) olduğunu tespit ederse, bu engine eksik bilgiyi analiz edip
 * "yeni bir hedefli sorgu" (refined query) üreterek tekrar RAG araması yapar.
 * 
 * Sonsuz döngüleri önlemek için maxHops parametresiyle sınırlandırılmıştır.
 */

import type { MemoryRow } from '../types.js';
import type { LLMProvider } from '../../llm/provider.js';
import { PassageCritique, type CritiqueResult } from './PassageCritique.js';
import { logger } from '../../utils/logger.js';

export interface HopEntry {
  hopNumber: number;
  query: string;
  targetRetriever: 'system1' | 'system2' | 'graphRAG';
  resultsCount: number;
  critiqueResult: CritiqueResult;
}

export interface RefinedQueryOutput {
  query: string;
  targetRetriever: 'system1' | 'system2' | 'graphRAG';
}

export interface MultiHopResult {
  memories: MemoryRow[];
  hops: HopEntry[];
  finalCompleteness: number;
  exhaustedMaxHops: boolean;
}

export interface MultiHopConfig {
  maxHops: number;
}

const QUERY_REFINEMENT_PROMPT = `You are an AI Query Refinement Engine for an Agentic RAG system.
Based on the original query and the missing information that was NOT found in the initial search, generate a NEW, highly targeted search query to find the missing details.

You must also determine which retrieval engine (targetRetriever) is most appropriate:
- system1 (Vector Search): For simple keywords, entities, and direct facts.
- system2 (Hybrid + Deep Search): For complex multi-sentence questions, semantic matches.
- graphRAG: For relational questions ("Who knows X?" or "How is Project A connected to Concept B?").

Original Query: "{query}"
Missing Information / Issues: {missingInfo}

INSTRUCTIONS:
- Produce a specific query
- Strictly use the provided tool schema for the response.`;

export class MultiHopRetrieval {
  private config: MultiHopConfig;

  constructor(
    private llmProvider: LLMProvider,
    private passageCritique: PassageCritique,
    config?: Partial<MultiHopConfig>
  ) {
    this.config = {
      maxHops: config?.maxHops ?? 3,
    };
  }

  /**
   * Çok adımlı arama döngüsünü başlatır.
   * 
   * @param originalQuery Kullanıcının orijinal sorgusu
   * @param initialMemories İlk aramadan dönen, geçerli (keep=true) kabul edilmiş hafızalar
   * @param initialCritique İlk aramanın eleştiri sonucu
   * @param retrieveFn Dışarıdan enjekte edilen, yeni sorguyla hafıza getirecek olan fonksiyon
   */
  async execute(
    originalQuery: string,
    initialMemories: MemoryRow[],
    initialCritique: CritiqueResult,
    retrieveFn: (refinedQuery: string, hopNumber: number, targetRetriever: string) => Promise<MemoryRow[]>
  ): Promise<MultiHopResult> {
    const hops: HopEntry[] = [];
    let currentMemories = [...initialMemories];
    let currentCritique = initialCritique;

    for (let hop = 1; hop <= this.config.maxHops; hop++) {
      if (!currentCritique.needsMoreRetrieval) {
        logger.debug({ msg: `[Agentic RAG] MultiHop stopped early at hop ${hop}, critique is satisfied.` });
        break;
      }

      logger.info({ msg: `[Agentic RAG] Executing hop ${hop}/${this.config.maxHops} due to missing info:`, missing: currentCritique.missingInfo });

      // 1. Yeni ve hedef odaklı bir arama sorgusu üret
      const refined = await this.generateRefinedQuery(
        originalQuery,
        currentCritique.missingInfo
      );

      // 2. Yeni sorguyla veritabanı/graph araması yap
      const newMemories = await retrieveFn(refined.query, hop, refined.targetRetriever);

      // 3. Yeni gelen sonuçları eleştir
      const newCritique = await this.passageCritique.evaluate(refined.query, newMemories);

      // 4. Eşsiz ve "keep=true" alan yeni sonuçları ana havuza ekle
      const existingIds = new Set(currentMemories.map(m => m.id));
      const validNewMemories = newMemories.filter(m => {
        const evalRecord = newCritique.evaluations.find(e => e.memoryId === m.id);
        return evalRecord?.keep && !existingIds.has(m.id);
      });

      currentMemories = [...currentMemories, ...validNewMemories];

      // 5. Hop geçmişine kaydet
      hops.push({
        hopNumber: hop,
        query: refined.query,
        targetRetriever: refined.targetRetriever,
        resultsCount: newMemories.length,
        critiqueResult: newCritique
      });

      // Bir sonraki iterasyonun durup durmayacağına karar vermek için currentCritique'i güncelle
      currentCritique = newCritique;
    }

    return {
      memories: currentMemories,
      hops,
      finalCompleteness: currentCritique.overallCompleteness,
      exhaustedMaxHops: currentCritique.needsMoreRetrieval && hops.length === this.config.maxHops,
    };
  }

  private async generateRefinedQuery(originalQuery: string, missingInfo: string[]): Promise<RefinedQueryOutput> {
    try {
      const prompt = QUERY_REFINEMENT_PROMPT
        .replace('{query}', originalQuery)
        .replace('{missingInfo}', missingInfo.join('; '));

      if (this.llmProvider.supportsNativeToolCalling) {
        const response = await this.llmProvider.chat([
          { role: 'system', content: 'You are a query refinement engine.' },
          { role: 'user', content: prompt }
        ], {
          temperature: 0.3,
          tools: [{
            name: 'submit_refined_query',
            description: 'Submit the refined query and target retriever',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'The newly refined search query targeting the missing data' },
                targetRetriever: { type: 'string', enum: ['system1', 'system2', 'graphRAG'] }
              },
              required: ['query', 'targetRetriever']
            }
          }]
        });

        return this.parseToolResponse(response.content, originalQuery);
      }

      // Fallback
      const response = await this.llmProvider.chat([
        { role: 'system', content: 'You are a query refinement engine. Return plain text query only' },
        { role: 'user', content: prompt }
      ], { temperature: 0.3 });

      return { query: response.content.trim() || originalQuery, targetRetriever: 'system2' };

    } catch (err) {
      logger.warn({ msg: '[Agentic RAG] Failed to generate refined query, returning original', err });
      return { query: originalQuery, targetRetriever: 'system2' };
    }
  }

  private parseToolResponse(content: string, originalQuery: string): RefinedQueryOutput {
    try {
      const jsonStart = content.indexOf('{');
      const jsonEnd = content.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON tool call');
      const parsed = JSON.parse(content.substring(jsonStart, jsonEnd + 1));
      
      const targetRetriever = ['system1', 'system2', 'graphRAG'].includes(parsed.targetRetriever) 
          ? parsed.targetRetriever 
          : 'system2';

      return {
        query: typeof parsed.query === 'string' && parsed.query.length > 0 ? parsed.query : originalQuery,
        targetRetriever
      };
    } catch (e) {
      logger.debug({ msg: '[Agentic RAG] Tool JSON parse fail in multi-hop, fallback applied' });
      return { query: originalQuery, targetRetriever: 'system2' };
    }
  }

  getConfig(): MultiHopConfig {
    return { ...this.config };
  }
}
