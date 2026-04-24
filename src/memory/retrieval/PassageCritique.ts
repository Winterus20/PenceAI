/**
 * PassageCritique — Agentic RAG Passage Evaluation Engine (Faz 2/5)
 *
 * Veritabanından veya diğer retrieverlardan gelen bellek parçalarını (passages)
 * LLM ile eleştirerek (critique) süzgeçten geçirir.
 *
 * - Relevance (Alaka): Belge soruyla doğrudan ilgili mi?
 * - Completeness (Bütünlük): Belge soruyu cevaplamak için yeterince detay içeriyor mu?
 *
 * Yalnızca tanımlanan eşik (floor) değerlerini geçen parçalar tutulur.
 */

import type { MemoryRow } from '../types.js';
import type { LLMProvider } from '../../llm/provider.js';
import { logger } from '../../utils/logger.js';

export type RelevanceLevel = 'Relevant' | 'PartiallyRelevant' | 'Irrelevant';
export type CompletenessLevel = 'Complete' | 'Partial' | 'Insufficient';

export interface PassageEvaluation {
  memoryId: number;
  relevance: RelevanceLevel;
  relevanceScore: number;        // 0-1
  completeness: CompletenessLevel;
  completenessScore: number;     // 0-1
  issues: string[];              // ["Outdated", "Too generic", "Missing specifics"]
  keep: boolean;                 // Final decision
}

export interface CritiqueResult {
  evaluations: PassageEvaluation[];
  keptCount: number;
  filteredCount: number;
  overallCompleteness: number;   // 0-1 (kept passages' avg)
  needsMoreRetrieval: boolean;   // Hiçbiri yeterli değilse veya ortalama bütünlük düşükse
  missingInfo: string[];         // Ne eksik?
}

export interface PassageCritiqueConfig {
  relevanceFloor: number;
  completenessFloor: number;
}

const PASSAGE_CRITIQUE_PROMPT = `You are a strict Passage Critique Engine for an advanced RAG system.
Evaluate EACH retrieved passage based on its usefulness for answering the user's query.

For EVERY passage, you MUST provide an evaluation inside a JSON array.

1. **Relevance**: Does this passage address the query directly or indirectly?
   - Relevant (~0.8 to 1.0): Directly addresses the core entity or topic.
   - PartiallyRelevant (~0.4 to 0.7): Related tangent, or provides partial context.
   - Irrelevant (~0.0 to 0.3): Does not address the query at all.

2. **Completeness**: Does this passage provide actionable or definitive detail?
   - Complete (~0.8 to 1.0): Sufficient stand-alone detail to answer the query.
   - Partial (~0.4 to 0.7): Good details but missing key specifics (like exact dates or full context).
   - Insufficient (~0.0 to 0.3): Too generic, outdated, or lacks meaningful information.

3. **Issues**: Briefly list any problems (e.g., "Outdated info", "Contradictory", "Too vague"). Array of strings.

Output format MUST be a valid JSON array of objects:
[
  {
    "memoryId": <integer>,
    "relevance": "<Relevant | PartiallyRelevant | Irrelevant>",
    "relevanceScore": <float 0.0 - 1.0>,
    "completeness": "<Complete | Partial | Insufficient>",
    "completenessScore": <float 0.0 - 1.0>,
    "issues": ["<issue 1>", "<issue 2>"]
  }
]

Do not add markdown formatting or extra text outside the JSON array. Output strictly JSON.`;

export class PassageCritique {
  private config: PassageCritiqueConfig;

  constructor(
    private llmProvider: LLMProvider,
    config?: Partial<PassageCritiqueConfig>
  ) {
    this.config = {
      relevanceFloor: config?.relevanceFloor ?? 0.5,
      completenessFloor: config?.completenessFloor ?? 0.3,
    };
  }

  async evaluate(
    query: string,
    passages: MemoryRow[],
  ): Promise<CritiqueResult> {
    if (passages.length === 0) {
      return {
        evaluations: [],
        keptCount: 0,
        filteredCount: 0,
        overallCompleteness: 0,
        needsMoreRetrieval: true,
        missingInfo: ['No passages were retrieved to evaluate.'],
      };
    }

    try {
      const prompt = this.buildPrompt(query, passages);
      
      let parsedEvaluations: Omit<PassageEvaluation, 'keep'>[];

      // Eger model native tool destekliyorsa kesin ve %100 dogru JSON formatinda al (Halusinasyon riskini sifirlar)
      if (this.llmProvider.supportsNativeToolCalling) {
        const response = await this.llmProvider.chat(
          [
            { role: 'system', content: 'You are a strict Passage Critique Engine.' },
            { role: 'user', content: prompt }
          ],
          {
            temperature: 0.1,
            tools: [this.getEvaluatorToolDefinition()]
          }
        );

        parsedEvaluations = this.extractFromToolCall(response.content, passages);
      } else {
        // Fallback: Eski yontemle (text parsing) ilerle
        const response = await this.llmProvider.chat(
          [
            { role: 'system', content: PASSAGE_CRITIQUE_PROMPT },
            { role: 'user', content: prompt }
          ],
          { temperature: 0.1 }
        );
        parsedEvaluations = this.parseResponse(response.content, passages);
      }
      
      // Keep kararını hesapla (config tabanlı floor değerlerini kullanarak)
      const evaluations: PassageEvaluation[] = parsedEvaluations.map(e => ({
        ...e,
        keep: e.relevanceScore >= this.config.relevanceFloor && e.completenessScore >= this.config.completenessFloor
      }));

      const kept = evaluations.filter(e => e.keep);
      
      const overallCompleteness = kept.length > 0 
        ? kept.reduce((sum, e) => sum + e.completenessScore, 0) / kept.length 
        : 0;

      // Tüm tutulanların completness seviyesi çok düşükse daha fazlası gerekebilir
      const needsMoreRetrieval = kept.length === 0 || overallCompleteness < 0.6;

      return {
        evaluations,
        keptCount: kept.length,
        filteredCount: evaluations.length - kept.length,
        overallCompleteness,
        needsMoreRetrieval,
        missingInfo: this.extractMissingInfo(query, evaluations),
      };
    } catch (err) {
      logger.warn({ msg: '[Agentic RAG] Passage critique failed, falling back to default evaluation', err });
      return this.fallbackEvaluation(passages);
    }
  }

  private buildPrompt(query: string, passages: MemoryRow[]): string {
    const passagesText = passages
      .map(p => `--- PASSAGE ID: ${p.id} ---\n${p.content}`)
      .join('\n\n');

    return `Query: "${query}"\n\nRetrieved Passages (${passages.length}):\n\n${passagesText}\n\nPlease strictly evaluate each passage returning its relevance and completeness score. Provide issues if incomplete/irrelevant. Output must match the required tool/JSON schema.`;
  }

  private getEvaluatorToolDefinition(): any {
    return {
      name: 'submit_evaluations',
      description: 'Submit the relevance and completeness evaluation for the provided passages',
      parameters: {
        type: 'object',
        properties: {
          evaluations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                memoryId: { type: 'number' },
                relevance: { type: 'string', enum: ['Relevant', 'PartiallyRelevant', 'Irrelevant'] },
                relevanceScore: { type: 'number' },
                completeness: { type: 'string', enum: ['Complete', 'Partial', 'Insufficient'] },
                completenessScore: { type: 'number' },
                issues: { type: 'array', items: { type: 'string' } },
              },
              required: ['memoryId', 'relevance', 'relevanceScore', 'completeness', 'completenessScore', 'issues']
            }
          }
        },
        required: ['evaluations']
      }
    };
  }

  private extractFromToolCall(content: string, originalPassages: MemoryRow[]): Omit<PassageEvaluation, 'keep'>[] {
    try {
      // Araç çağrısı sonucunu regex ya da doğrudan JSON aramasıyla çıkartıyoruz (Provider'a göre yapılabilecek farklılıklar olabilir).
      const jsonStart = content.indexOf('{');
      const jsonEnd = content.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) {
          throw new Error('Tool call JSON not found');
      }

      const jsonStr = content.substring(jsonStart, jsonEnd + 1);
      const parsed = JSON.parse(jsonStr);

      if (!parsed || !Array.isArray(parsed.evaluations)) {
        throw new Error('Parsed tool call result missing evaluations array');
      }

      return parsed.evaluations.map((item: any) => {
        const memoryId = typeof item.memoryId === 'number' ? item.memoryId : parseInt(item.memoryId, 10);
        return {
          memoryId: isNaN(memoryId) ? -1 : memoryId,
          relevance: this.validateRelevance(item.relevance),
          relevanceScore: typeof item.relevanceScore === 'number' ? item.relevanceScore : 0.5,
          completeness: this.validateCompleteness(item.completeness),
          completenessScore: typeof item.completenessScore === 'number' ? item.completenessScore : 0.5,
          issues: Array.isArray(item.issues) ? item.issues.map(String) : [],
        };
      });
    } catch (err) {
      logger.debug({ msg: '[Agentic RAG] Tool call parsing failed, relying on fallback text parse', content, err });
      return this.parseResponse(content, originalPassages);
    }
  }

  private parseResponse(content: string, originalPassages: MemoryRow[]): Omit<PassageEvaluation, 'keep'>[] {
    try {
      // Sesi, markdown vb. şeyleri temizleyip array'i bulmaya çalışalım.
      const jsonStart = content.indexOf('[');
      const jsonEnd = content.lastIndexOf(']');
      
      if (jsonStart === -1 || jsonEnd === -1) {
        throw new Error('No JSON array found in response');
      }

      const jsonStr = content.substring(jsonStart, jsonEnd + 1);
      const parsed = JSON.parse(jsonStr) as any[];

      if (!Array.isArray(parsed)) {
        throw new Error('Parsed result is not an array');
      }

      return parsed.map(item => {
        // Fallback or map data safely
        const memoryId = typeof item.memoryId === 'number' ? item.memoryId : parseInt(item.memoryId, 10);
        
        return {
          memoryId: isNaN(memoryId) ? -1 : memoryId,
          relevance: this.validateRelevance(item.relevance),
          relevanceScore: typeof item.relevanceScore === 'number' ? item.relevanceScore : 0.5,
          completeness: this.validateCompleteness(item.completeness),
          completenessScore: typeof item.completenessScore === 'number' ? item.completenessScore : 0.5,
          issues: Array.isArray(item.issues) ? item.issues.map(String) : [],
        };
      });
    } catch (err) {
      logger.debug({ msg: '[Agentic RAG] Could not parse critique JSON', content: content });
      throw err;
    }
  }

  private validateRelevance(val: any): RelevanceLevel {
    if (val === 'Relevant' || val === 'PartiallyRelevant' || val === 'Irrelevant') return val;
    return 'PartiallyRelevant';
  }

  private validateCompleteness(val: any): CompletenessLevel {
    if (val === 'Complete' || val === 'Partial' || val === 'Insufficient') return val;
    return 'Partial';
  }

  private extractMissingInfo(query: string, evaluations: PassageEvaluation[]): string[] {
    const insufficient = evaluations.filter(e => !e.keep || e.completeness === 'Insufficient');
    const issues = new Set<string>();
    
    for (const e of insufficient) {
      if (e.issues && e.issues.length > 0) {
        e.issues.forEach(i => issues.add(i));
      }
    }

    const missingList = Array.from(issues);
    if (missingList.length === 0 && evaluations.filter(e => e.keep).length === 0) {
      return [`The current passages completely fail to answer: "${query}"`];
    }

    return missingList;
  }

  private fallbackEvaluation(passages: MemoryRow[]): CritiqueResult {
    // LLM parse hatası gibi durumlarda pass geçmesi için hepsini partial kabul ediyoruz.
    const evaluations: PassageEvaluation[] = passages.map(p => ({
      memoryId: p.id,
      relevance: 'PartiallyRelevant',
      relevanceScore: Math.max(0.5, this.config.relevanceFloor), // always pass floor
      completeness: 'Partial',
      completenessScore: Math.max(0.5, this.config.completenessFloor), // always pass floor
      issues: ['Critique engine bypassed/failed- fallback used.'],
      keep: true,
    }));

    return {
      evaluations,
      keptCount: passages.length,
      filteredCount: 0,
      overallCompleteness: 0.5,
      needsMoreRetrieval: false, // Fallback durumunda multi-hop riskine girmemek için false dönüyoruz
      missingInfo: [],
    };
  }

  getConfig(): PassageCritiqueConfig {
    return { ...this.config };
  }
}
