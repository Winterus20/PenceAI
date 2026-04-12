/**
 * ResponseVerifier — Agentic RAG Response Verification Engine (Faz 3/5)
 *
 * Agent yanıtını retrieval sonuçlarıyla karşılaştırarak doğruluk kontrolü yapar:
 * - Destek kontrolü: Yanıttaki her iddia retrieval sonuçlarıyla destekleniyor mu?
 * - Utility skoru: Yanıt kullanıcının ihtiyacını ne kadar karşılıyor? (1-5)
 * - Hallüsinasyon tespiti: Desteklenmeyen iddialar var mı?
 *
 * Self-RAG'deki [Fully supported]/[No support] ve [Utility:1-5] token'larının
 * prompt-based karşılığıdır.
 */

import type { MemoryRow } from '../types.js';
import type { LLMProvider } from '../../llm/provider.js';

export type SupportLevel = 'FullySupported' | 'PartiallySupported' | 'Unsupported';

export interface VerificationResult {
    isSupported: SupportLevel;
    supportScore: number;          // 0-1
    utilityScore: number;          // 1-5
    hallucinations: string[];      // Desteklenmeyen iddialar
    needsRegeneration: boolean;
    feedback: string;
}

const VERIFICATION_PROMPT = `You are a Response Verification Engine. Evaluate a generated response against retrieved memories for factual accuracy and usefulness.

TASKS:

1. **Support Check**: Is each factual claim in the response supported by the retrieved memories?
   - FullySupported: Every claim is backed by at least one memory
   - PartiallySupported: Most claims backed, but some gaps or weak support exist
   - Unsupported: Claims are made without memory support (likely hallucination)

2. **Utility Score**: How useful is this response for answering the query? (1-5)
   - 5: Complete, accurate, actionable — fully answers the query
   - 4: Mostly complete and accurate, minor gaps
   - 3: Partially answers, significant gaps or some inaccuracies
   - 2: Barely relevant, major gaps or inaccuracies
   - 1: Completely off-topic or harmful misinformation

3. **Hallucination Check**: List any claims in the response that are NOT supported by the memories. Be specific — quote the unsupported claim.

4. **Decision**: Does this response need regeneration?
   - True if: supportScore < 0.6 OR utilityScore <= 2 OR there are critical hallucinations
   - False otherwise

5. **Feedback**: If regeneration needed, explain what should be fixed.

Output format — valid JSON only, no extra text:
{
  "isSupported": "FullySupported",
  "supportScore": 0.85,
  "utilityScore": 4,
  "hallucinations": ["Claim: 'The meeting is on Friday' — no memory supports this"],
  "needsRegeneration": false,
  "feedback": "Response is well-supported by retrieved memories"
}`;

export interface ResponseVerifierConfig {
    supportFloor: number;         // Default: 0.6 — altındaysa regeneration
    utilityFloor: number;         // Default: 2 — altındaysa regeneration
    maxRegenerations: number;     // Default: 1 — maksimum regenerasyon sayısı
}

const DEFAULT_CONFIG: ResponseVerifierConfig = {
    supportFloor: 0.6,
    utilityFloor: 2,
    maxRegenerations: 1,
};

export class ResponseVerifier {
    private config: ResponseVerifierConfig;

    constructor(
        private llmProvider: LLMProvider,
        config?: Partial<ResponseVerifierConfig>,
    ) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    async verify(
        query: string,
        response: string,
        memories: MemoryRow[],
    ): Promise<VerificationResult> {
        if (memories.length === 0) {
            return this.noMemoryResult(response);
        }

        const prompt = this.buildPrompt(query, response, memories);
        const result = await this.llmProvider.chat([
            { role: 'system', content: VERIFICATION_PROMPT },
            { role: 'user', content: prompt },
        ], { temperature: 0.2, maxTokens: 1024 });

        return this.parseResponse(result.content, response);
    }

    private noMemoryResult(response: string): VerificationResult {
        // Bellek yoksa destek kontrolü yapılamaz — kısmi destek varsay
        return {
            isSupported: 'PartiallySupported',
            supportScore: 0.5,
            utilityScore: response.length > 20 ? 3 : 2,
            hallucinations: [],
            needsRegeneration: false,
            feedback: 'No memories available for verification',
        };
    }

    private buildPrompt(query: string, response: string, memories: MemoryRow[]): string {
        const memoriesText = memories.map((m, i) => {
            const header = `[Memory ${i + 1}] ID: ${m.id} | Category: ${m.category || 'uncategorized'}`;
            const content = m.content.substring(0, 500);
            return `${header}\n${content}`;
        }).join('\n\n---\n\n');

        return `Query: "${query}"

Generated Response:
${response}

Retrieved Memories (${memories.length}):
${memoriesText}`;
    }

    private parseResponse(content: string, response: string): VerificationResult {
        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                return this.defaultResult(response);
            }
            const parsed = JSON.parse(jsonMatch[0]);

            const rawSupportScore = typeof parsed.supportScore === 'number'
                ? Math.min(1, Math.max(0, parsed.supportScore))
                : 0.5;
            const rawUtilityScore = typeof parsed.utilityScore === 'number'
                ? Math.min(5, Math.max(1, Math.round(parsed.utilityScore)))
                : 3;
            const isSupported = (parsed.isSupported as SupportLevel) || 'PartiallySupported';
            const hallucinations = Array.isArray(parsed.hallucinations) ? parsed.hallucinations : [];
            const feedback = typeof parsed.feedback === 'string' ? parsed.feedback : 'Verification inconclusive';

            // Regeneration kararı
            const needsRegeneration = rawSupportScore < this.config.supportFloor
                || rawUtilityScore <= this.config.utilityFloor
                || (isSupported === 'Unsupported')
                || (hallucinations.length > 2);

            return {
                isSupported,
                supportScore: rawSupportScore,
                utilityScore: rawUtilityScore,
                hallucinations,
                needsRegeneration,
                feedback,
            };
        } catch {
            return this.defaultResult(response);
        }
    }

    private defaultResult(response: string): VerificationResult {
        return {
            isSupported: 'PartiallySupported',
            supportScore: 0.5,
            utilityScore: 3,
            hallucinations: [],
            needsRegeneration: false,
            feedback: 'Verification parse failed — assuming partial support',
        };
    }

    /**
     * Regenerasyon için feedback prompt'u oluştur.
     * Yanıtın sonuna eklenerek LLM'in düzeltilmiş yanıt üretmesini sağlar.
     */
    buildRegenerationPrompt(originalResponse: string, verification: VerificationResult): string {
        return `${originalResponse}

---
⚠️ SELF-EVALUATION FEEDBACK:

Support Level: ${verification.isSupported}
Support Score: ${verification.supportScore.toFixed(2)}
Utility Score: ${verification.utilityScore}/5

Issues Found:
${verification.feedback}

${verification.hallucinations.length > 0 ? `Unsupported Claims (remove or back these with facts):\n${verification.hallucinations.map((h: string) => `  - ${h}`).join('\n')}` : ''}

Please revise your response to address these issues. Be factual — only state what you know or what the provided context supports.`;
    }

    getConfig(): ResponseVerifierConfig {
        return { ...this.config };
    }
}
