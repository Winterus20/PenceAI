/**
 * ClaimExtractorStep — Olgusal İddia Çıkarma Pipeline Adımı.
 * 
 * Metinden spesifik iddiaları (claims/covariates) çıkarır:
 * - Kim/Ne (Subject)
 * - Ne yaptı/ne oldu (Predicate)  
 * - Kime/Neye (Object)
 * - Durum (active/historical/uncertain)
 * - Tarih aralığı (opsiyonel)
 * 
 * Bu iddialar daha sonra memory_claims tablosuna kaydedilerek
 * bilgi grafiğinin olgusal derinliğini artırır.
 */

import type { ExtractionContext, ExtractorStep, ExtractedClaim } from '../types.js';
import type { LLMProvider } from '../../../llm/provider.js';
import type { LLMMessage } from '../../../router/types.js';
import { logger } from '../../../utils/logger.js';

/** Minimum metin uzunluğu — çok kısa metinlerden claim çıkarmaya değmez */
const MIN_TEXT_LENGTH = 30;

/** Max claim sayısı per text */
const MAX_CLAIMS_PER_TEXT = 10;

export class ClaimExtractorStep implements ExtractorStep {
  name = 'ClaimExtractor';

  constructor(private llmProvider: LLMProvider) {}

  async extract(context: ExtractionContext): Promise<ExtractionContext> {
    const text = context.unprocessedText || context.originalText;

    // Çok kısa metinlerden claim çıkarmaya gerek yok
    if (text.length < MIN_TEXT_LENGTH) {
      logger.debug('[ClaimExtractor] Text too short, skipping');
      return context;
    }

    try {
      const claims = await this.extractClaims(text);
      context.claims.push(...claims);
      logger.debug(`[ClaimExtractor] Extracted ${claims.length} claims from text`);
    } catch (err) {
      logger.warn({ err }, '[ClaimExtractor] Claim extraction failed, skipping');
    }

    return context;
  }

  /**
   * LLM ile metinden iddiaları çıkar.
   */
  private async extractClaims(text: string): Promise<ExtractedClaim[]> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `Sen bir bilgi çıkarma uzmanısın. Verilen metinden olgusal iddiaları (claims) çıkarırsın.
Her iddia şu yapıda olmalıdır:
- subject: İddia sahibi varlık
- predicate: İddia fiili/eylemi
- object: İddia nesnesi
- status: "active" (güncel), "historical" (geçmişte), "uncertain" (belirsiz)
- startDate: Başlangıç tarihi (varsa, ISO format)
- endDate: Bitiş tarihi (varsa, ISO format)
- confidence: Güven skoru (0.0-1.0)

Sadece JSON array döndür. Eğer iddia yoksa boş array [] döndür.`,
      },
      {
        role: 'user',
        content: `Aşağıdaki metinden olgusal iddiaları çıkar:

"${text.substring(0, 500)}"

JSON formatında döndür:
[{"subject": "...", "predicate": "...", "object": "...", "status": "active", "startDate": null, "endDate": null, "confidence": 0.8}]

Önemli: ÇIKTI SADECE JSON ARRAY OLMALIDIR. Başka hiçbir metin ekleme.`,
      },
    ];

    const response = await this.llmProvider.chat(messages, {
      temperature: 0.1,
      maxTokens: 800,
    });

    const content = response.content?.trim() ?? '';
    return this.parseClaims(content, text);
  }

  /**
   * LLM çıktısını parse et.
   */
  private parseClaims(content: string, sourceText: string): ExtractedClaim[] {
    let parsed: any[] = [];

    // 1. Direkt JSON
    try {
      parsed = JSON.parse(content);
    } catch {
      // 2. Markdown JSON block
      const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[1]);
        } catch { /* devam et */ }
      }
    }

    // 3. Son çare: [ ve ] arasını parse et
    if (!Array.isArray(parsed) || parsed.length === 0) {
      const startIdx = content.indexOf('[');
      const endIdx = content.lastIndexOf(']');
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        try {
          parsed = JSON.parse(content.slice(startIdx, endIdx + 1));
        } catch { /* boş döndür */ }
      }
    }

    if (!Array.isArray(parsed)) return [];

    // Validate ve normalize et
    return parsed
      .slice(0, MAX_CLAIMS_PER_TEXT)
      .filter((c: any) => c?.subject && c?.predicate && c?.object)
      .map((c: any) => ({
        subject: String(c.subject).substring(0, 200),
        predicate: String(c.predicate).substring(0, 200),
        object: String(c.object).substring(0, 200),
        status: ['active', 'historical', 'uncertain'].includes(c.status) ? c.status : 'active',
        startDate: c.startDate || undefined,
        endDate: c.endDate || undefined,
        confidence: typeof c.confidence === 'number' ? Math.min(1, Math.max(0, c.confidence)) : 0.7,
        source: sourceText.substring(0, 100),
      })) as ExtractedClaim[];
  }
}
