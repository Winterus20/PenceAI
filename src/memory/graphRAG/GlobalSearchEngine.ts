/**
 * GlobalSearchEngine — Map-Reduce Tabanlı Holistik Arama Motoru.
 * 
 * Microsoft GraphRAG mimarisinden ilham alarak, tüm topluluk özetlerini
 * tarayarak geniş kapsamlı, analitik sorulara cevap veren arama mekanizması.
 * 
 * Optimizasyonlar:
 * - Parallel Map (Promise.all): Tüm topluluk çağrıları eşzamanlı
 * - Top-K Community Filtering: Yalnızca en alakalı toplulukları seç
 * - Pre-generated Summaries: Arka planda hazır özetleri kullan (anlık LLM çağrısı yok)
 * 
 * Kullanım:
 *   const engine = new GlobalSearchEngine(db, llmProvider, communityDetector);
 *   const result = await engine.globalSearch("Ana projelerim ve ilgi alanlarım neler?");
 */

import type Database from 'better-sqlite3';
import type { LLMProvider } from '../../llm/provider.js';
import type { LLMMessage } from '../../router/types.js';
import type { EmbeddingProvider } from '../embeddings.js';
import { logger } from '../../utils/logger.js';
import type { CommunityDetector } from './CommunityDetector.js';
import type { CommunitySummary } from './CommunitySummarizer.js';

/** Global Search sonucu */
export interface GlobalSearchResult {
  success: boolean;
  answer: string;
  /** Map aşamasında üretilen ara cevaplar */
  intermediateAnswers: string[];
  /** Kullanılan topluluk özetleri */
  usedSummaries: CommunitySummary[];
  /** Performans metrikleri */
  metadata: {
    totalCommunities: number;
    filteredCommunities: number;
    mapDurationMs: number;
    reduceDurationMs: number;
    totalDurationMs: number;
    level: number;
  };
  error?: string;
}

/** Global Search seçenekleri */
export interface GlobalSearchOptions {
  /** Hangi hiyerarşi seviyesindeki özetler taranacak (default: 1 — süper topluluklar) */
  level: number;
  /** Top-K: En alakalı kaç topluluk seçilecek (default: 5) */
  topK: number;
  /** Map aşamasında paralel çağrı limiti (default: 5) */
  maxParallelCalls: number;
  /** Reduce aşamasında max token */
  maxReduceTokens: number;
}

/** Default ayarlar */
const DEFAULT_OPTIONS: GlobalSearchOptions = {
  level: 1,
  topK: 5,
  maxParallelCalls: 5,
  maxReduceTokens: 2000,
};

/** Veritabanı summary satırı */
interface SummaryRow {
  community_id: string;
  summary: string;
  key_entities: string;
  key_relations: string;
  topics: string;
  generated_at: string;
}

export class GlobalSearchEngine {
  private embeddingProvider?: EmbeddingProvider;

  constructor(
    private db: Database.Database,
    private llmProvider: LLMProvider,
    private communityDetector: CommunityDetector,
  ) {}

  /**
   * Embedding sağlayıcıyı bağla — semantic Top-K filtreleme için gerekli.
   * Bağlanmazsa keyword-based filtreleme (mevcut davranış) kullanılır.
   */
  setEmbeddingProvider(provider: EmbeddingProvider): void {
    this.embeddingProvider = provider;
  }

  /**
   * Ana giriş noktası: Global Search (Map-Reduce).
   * 
   * 1. Belirli hiyerarşi seviyesindeki topluluk özetlerini yükle
   * 2. Top-K filtreleme ile en alakalı toplulukları seç
   * 3. Map: Her topluluk için LLM'den ara cevap al (Promise.all — paralel)
   * 4. Reduce: Ara cevapları birleştirip nihai cevabı üret
   * 
   * @param query - Kullanıcının sorusu
   * @param options - Global Search seçenekleri
   * @returns GlobalSearchResult
   */
  async globalSearch(
    query: string,
    options?: Partial<GlobalSearchOptions>,
  ): Promise<GlobalSearchResult> {
    const startTime = Date.now();
    const opts = { ...DEFAULT_OPTIONS, ...options };

    try {
      // 1. Topluluk özetlerini yükle (önce üst Level, yoksa Level 0'a düş)
      let summaries = this.loadSummariesByLevel(opts.level);
      if (summaries.length === 0 && opts.level > 0) {
        logger.info(`[GlobalSearch] No Level ${opts.level} summaries found, falling back to Level 0`);
        summaries = this.loadSummariesByLevel(0);
      }

      if (summaries.length === 0) {
        logger.warn('[GlobalSearch] No community summaries available for global search');
        return this.buildEmptyResult(startTime, 'No community summaries available');
      }

      logger.info(`[GlobalSearch] Found ${summaries.length} community summaries at target level`);

      // 2. Top-K filtreleme: Semantic (embedding) varsa onu kullan, yoksa keyword-based fallback
      const filtered = this.embeddingProvider
        ? await this.filterTopKSemantic(query, summaries, opts.topK)
        : this.filterTopK(query, summaries, opts.topK);
      logger.info(`[GlobalSearch] Top-K filtering: ${summaries.length} → ${filtered.length} communities (method: ${this.embeddingProvider ? 'semantic' : 'keyword'})`);

      // 3. Map aşaması: Paralel LLM çağrıları (Promise.all)
      const mapStart = Date.now();
      const intermediateAnswers = await this.mapPhase(query, filtered, opts.maxParallelCalls);
      const mapDuration = Date.now() - mapStart;

      // Boş ara cevapları filtrele
      const validAnswers = intermediateAnswers.filter(a => a.trim().length > 0);
      if (validAnswers.length === 0) {
        logger.warn('[GlobalSearch] Map phase produced no valid answers');
        return this.buildEmptyResult(startTime, 'Map phase produced no valid answers');
      }

      // 4. Reduce aşaması: Nihai cevabı üret
      const reduceStart = Date.now();
      const finalAnswer = await this.reducePhase(query, validAnswers, opts.maxReduceTokens);
      const reduceDuration = Date.now() - reduceStart;

      const totalDuration = Date.now() - startTime;
      logger.info(`[GlobalSearch] Completed in ${totalDuration}ms (map: ${mapDuration}ms, reduce: ${reduceDuration}ms)`);

      return {
        success: true,
        answer: finalAnswer,
        intermediateAnswers: validAnswers,
        usedSummaries: filtered,
        metadata: {
          totalCommunities: summaries.length,
          filteredCommunities: filtered.length,
          mapDurationMs: mapDuration,
          reduceDurationMs: reduceDuration,
          totalDurationMs: totalDuration,
          level: opts.level,
        },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({ err }, '[GlobalSearch] Global search failed:');
      return this.buildEmptyResult(startTime, errorMsg);
    }
  }

  /**
   * Semantic Top-K filtreleme: Sorgu embedding'i ile topluluk özetlerinin
   * cos similarity'sini hesaplayarak en alakalı toplulukları seç.
   * Keyword-based yönteme göre Türkçe morfoloji ve eşanlamlılar için çok daha iyi.
   *
   * Optimizasyon: Tüm metinleri tek batch'te embed eder → 1 API çağrısı.
   */
  private async filterTopKSemantic(
    query: string,
    summaries: CommunitySummary[],
    topK: number,
  ): Promise<CommunitySummary[]> {
    if (summaries.length <= topK) return summaries;
    if (!this.embeddingProvider) return this.filterTopK(query, summaries, topK);

    try {
      // Tüm metinleri hazırla: sorgu + her topluluk özeti
      const texts = [
        query,
        ...summaries.map(s => [
          s.summary,
          ...s.topics,
          ...s.keyEntities.map(e => e.name),
        ].join(' ')),
      ];

      // Tek batch API çağrısı ile tüm embedding'leri al
      const allEmbeddings = await this.embeddingProvider.embed(texts);
      const queryEmbedding = allEmbeddings[0];
      if (!queryEmbedding) return this.filterTopK(query, summaries, topK);

      type ScoredSummary = { summary: CommunitySummary; score: number };
      const scored: ScoredSummary[] = summaries.map((summary, i) => {
        const summaryEmbedding = allEmbeddings[i + 1];
        const score = summaryEmbedding
          ? this.cosineSimilarity(queryEmbedding, summaryEmbedding)
          : 0;
        return { summary, score };
      });

      scored.sort((a, b) => b.score - a.score);
      const result = scored.slice(0, topK);
      return result.map(s => s.summary);
    } catch (err) {
      logger.warn({ err }, '[GlobalSearch] Semantic Top-K failed, falling back to keyword-based');
      return this.filterTopK(query, summaries, topK);
    }
  }

  /** Cosine similarity hesapla. */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  /**
   * Top-K filtreleme: Basit keyword + topic eşleşmesi ile en alakalı toplulukları seç.
   * Vektörel embedding kullanmadan hafif ve hızlı bir ön-filtreleme (fallback).
   */
  private filterTopK(
    query: string,
    summaries: CommunitySummary[],
    topK: number,
  ): CommunitySummary[] {
    if (summaries.length <= topK) return summaries;

    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

    type ScoredSummary = { summary: CommunitySummary; score: number };
    const scored: ScoredSummary[] = summaries.map(summary => {
      let score = 0;
      const summaryText = (summary.summary + ' ' + summary.topics.join(' ')).toLowerCase();

      // Keyword eşleşme skoru
      for (const word of queryWords) {
        if (summaryText.includes(word)) score += 1;
      }

      // Entity eşleşme bonusu
      for (const entity of summary.keyEntities) {
        const entityName = entity.name.toLowerCase();
        for (const word of queryWords) {
          if (entityName.includes(word)) score += 2;
        }
      }

      // Topic eşleşme bonusu
      for (const topic of summary.topics) {
        const topicLower = topic.toLowerCase();
        for (const word of queryWords) {
          if (topicLower.includes(word)) score += 1.5;
        }
      }

      return { summary, score };
    });

    // Score'a göre sırala, en yüksek Top-K'yı al
    scored.sort((a, b) => b.score - a.score);

    // Minimum 1 puan alan veya Top-K sınırına kadar olanları al
    const result = scored.slice(0, topK);

    // Hiçbiri eşleşmezse (tüm skorlar 0), tüm toplulukları dahil et (genel soru)
    if (result.every(s => s.score === 0)) {
      return summaries.slice(0, topK);
    }

    return result.map(s => s.summary);
  }

  /**
   * Map aşaması: Her topluluk özeti için LLM'den paralel olarak ara cevap al.
   * Promise.all ile tüm çağrıları eşzamanlı ateşler → ~%80 hız kazancı.
   */
  private async mapPhase(
    query: string,
    summaries: CommunitySummary[],
    maxParallel: number,
  ): Promise<string[]> {
    const results: string[] = [];

    // Batch processing ile rate limiting
    for (let i = 0; i < summaries.length; i += maxParallel) {
      const batch = summaries.slice(i, i + maxParallel);

      const batchPromises = batch.map(async (summary) => {
        try {
          return await this.mapSingleCommunity(query, summary);
        } catch (err) {
          logger.warn({ err }, `[GlobalSearch] Map failed for community: ${summary.communityId}`);
          return '';
        }
      });

      // 🔧 Optimizasyon: Promise.all — paralel çağrı
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Tek bir topluluk için Map çağrısı: Topluluk özetini ve soruyu LLM'e gönder.
   */
  private async mapSingleCommunity(
    query: string,
    summary: CommunitySummary,
  ): Promise<string> {
    const entityNames = summary.keyEntities.map(e => e.name).join(', ');
    const topics = summary.topics.join(', ');

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: 'Sen bir bilgi analisti olarak çalışıyorsun. Verilen topluluk özeti bağlamında kullanıcının sorusunu cevapla. Kısa ve öz ol. Eğer bu bağlamda cevap yoksa "BU BAĞLAMDA İLGİLİ BİLGİ YOK" yaz.',
      },
      {
        role: 'user',
        content: `Topluluk Özeti:
${summary.summary}

Önemli Varlıklar: ${entityNames}
Konular: ${topics}

Soru: ${query}

Bu topluluk bağlamında soruyu kısaca cevapla:`,
      },
    ];

    const response = await this.llmProvider.chat(messages, {
      temperature: 0.2,
      maxTokens: 500,
    });

    const content = response.content?.trim() ?? '';

    // "İlgili bilgi yok" kontrolü
    if (content.includes('İLGİLİ BİLGİ YOK') || content.includes('ilgili bilgi yok')) {
      return '';
    }

    return content;
  }

  /**
   * Reduce aşaması: Ara cevapları birleştirerek nihai kapsamlı cevabı üret.
   */
  private async reducePhase(
    query: string,
    intermediateAnswers: string[],
    maxTokens: number,
  ): Promise<string> {
    const answersText = intermediateAnswers
      .map((answer, i) => `[Kaynak ${i + 1}]: ${answer}`)
      .join('\n\n');

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: 'Sen bir bilgi sentez uzmanısın. Birden fazla kaynaktan gelen bilgileri birleştirerek kapsamlı, tutarlı ve detaylı bir cevap oluşturursun. Tekrar eden bilgileri eleme ve çelişkileri belirt.',
      },
      {
        role: 'user',
        content: `Aşağıda farklı bilgi topluluklarından gelen ara cevaplar var. Bunları birleştirerek kullanıcının sorusunu kapsamlı olarak cevapla.

Soru: ${query}

Ara Cevaplar:
${answersText}

Tüm kaynakları birleştirerek kapsamlı, düzenli ve detaylı bir nihai cevap oluştur:`,
      },
    ];

    const response = await this.llmProvider.chat(messages, {
      temperature: 0.3,
      maxTokens,
    });

    return response.content?.trim() ?? 'Cevap üretilemedi.';
  }

  /**
   * Belirli seviyedeki topluluk özetlerini veritabanından yükle.
   * Pre-generated summaries kullanılır — anlık LLM çağrısı yapılmaz.
   */
  private loadSummariesByLevel(level: number): CommunitySummary[] {
    try {
      // Belirtilen seviyedeki topluluk ID'lerini al
      const communityIds = this.db.prepare(`
        SELECT id FROM graph_communities WHERE level = ? ORDER BY modularity_score DESC
      `).all(level) as Array<{ id: string }>;

      if (communityIds.length === 0) return [];

      const summaries: CommunitySummary[] = [];
      for (const { id } of communityIds) {
        const row = this.db.prepare(`
          SELECT community_id, summary, key_entities, key_relations, topics, generated_at
          FROM graph_community_summaries
          WHERE community_id = ?
        `).get(id) as SummaryRow | undefined;

        if (row) {
          summaries.push({
            communityId: row.community_id,
            summary: row.summary,
            keyEntities: JSON.parse(row.key_entities),
            keyRelations: JSON.parse(row.key_relations),
            topics: JSON.parse(row.topics),
            generatedAt: new Date(row.generated_at),
            level,
          });
        }
      }

      return summaries;
    } catch (err) {
      logger.warn({ err }, '[GlobalSearch] loadSummariesByLevel hatası:');
      return [];
    }
  }

  /**
   * Boş sonuç builder.
   */
  private buildEmptyResult(startTime: number, error: string): GlobalSearchResult {
    return {
      success: false,
      answer: '',
      intermediateAnswers: [],
      usedSummaries: [],
      metadata: {
        totalCommunities: 0,
        filteredCommunities: 0,
        mapDurationMs: 0,
        reduceDurationMs: 0,
        totalDurationMs: Date.now() - startTime,
        level: 0,
      },
      error,
    };
  }
}
