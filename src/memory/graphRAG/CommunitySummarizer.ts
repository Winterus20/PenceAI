/**
 * CommunitySummarizer — LLM Tabanlı Community Özetleme.
 * 
 * Her community'yi LLM ile özetler. Bu özetler, retrieval sırasında
 * context olarak kullanılır.
 * 
 * Özellikler:
 * - LLM ile otomatik özet generation
 * - Rate limiting (max 3 paralel çağrı)
 * - Retry logic (max 2 retry)
 * - Fallback: Entity isimlerini birleştirme
 */

import type Database from 'better-sqlite3';
import type { LLMProvider } from '../../llm/provider.js';
import type { LLMMessage } from '../../router/types.js';
import { logger } from '../../utils/logger.js';
import type { Community } from './CommunityDetector.js';
import type { MemoryRow } from '../types.js';

/** Community summary yapısı */
export interface CommunitySummary {
  communityId: string;
  summary: string;
  keyEntities: { name: string; type: string; importance: number }[];
  keyRelations: { source: string; target: string; type: string }[];
  topics: string[];
  generatedAt: Date;
}

/** Summarization seçenekleri */
export interface SummarizationOptions {
  maxSummaryLength: number;     // Default: 500 karakter
  maxKeyEntities: number;       // Default: 10
  maxKeyRelations: number;      // Default: 5
  llmProvider?: string;         // null ise default provider
}

/** Veritabanı summary satırı */
interface CommunitySummaryRow {
  community_id: string;
  summary: string;
  key_entities: string;
  key_relations: string;
  topics: string;
  generated_at: string;
}

/** Default ayarlar */
const DEFAULT_MAX_SUMMARY_LENGTH = 500;
const DEFAULT_MAX_KEY_ENTITIES = 10;
const DEFAULT_MAX_KEY_RELATIONS = 5;
const MAX_PARALLEL_CALLS = 3;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

export class CommunitySummarizer {
  constructor(
    private db: Database.Database,
    private llmProvider: LLMProvider,
  ) {}

  /**
   * Tek community özetleme.
   * 
   * @param communityId - Community ID
   * @param options - Summarization seçenekleri
   * @returns CommunitySummary
   */
  async summarizeCommunity(
    communityId: string,
    options?: Partial<SummarizationOptions>,
  ): Promise<CommunitySummary | null> {
    const opts = this.normalizeOptions(options);

    // Community bilgisini getir
    const community = this.loadCommunity(communityId);
    if (!community) {
      logger.warn(`[CommunitySummarizer] Community not found: ${communityId}`);
      return null;
    }

    // Community üyelerini getir
    const members = this.loadCommunityMembers(community.memberNodeIds);
    if (members.length === 0) {
      logger.warn(`[CommunitySummarizer] No members found for community: ${communityId}`);
      return this.generateFallbackSummary(community, []);
    }

    // LLM ile özet oluştur
    const summary = await this.generateLLMSummary(community, members, opts);
    if (summary) {
      // Veritabanına kaydet
      this.saveSummary(summary);
      return summary;
    }

    // LLM başarısız → fallback
    logger.warn(`[CommunitySummarizer] LLM summary generation failed, using fallback for community: ${communityId}`);
    const fallbackSummary = this.generateFallbackSummary(community, members);
    this.saveSummary(fallbackSummary);
    return fallbackSummary;
  }

  /**
   * Tüm community'leri özetleme (batch).
   * Rate limiting uygular (max 3 paralel çağrı).
   * 
   * @param options - Summarization seçenekleri
   * @returns CommunitySummary[]
   */
  async summarizeAllCommunities(
    options?: Partial<SummarizationOptions>,
  ): Promise<CommunitySummary[]> {
    // Tüm community'leri getir
    const communities = this.loadAllCommunities();
    if (communities.length === 0) {
      logger.info('[CommunitySummarizer] No communities to summarize');
      return [];
    }

    logger.info(`[CommunitySummarizer] Summarizing ${communities.length} communities (max ${MAX_PARALLEL_CALLS} parallel)`);

    const results: CommunitySummary[] = [];
    const errors: string[] = [];

    // Batch processing ile rate limiting
    for (let i = 0; i < communities.length; i += MAX_PARALLEL_CALLS) {
      const batch = communities.slice(i, i + MAX_PARALLEL_CALLS);
      const batchPromises = batch.map(async (community) => {
        try {
          const summary = await this.summarizeCommunity(community.id, options);
          if (summary) return summary;
        } catch (err) {
          errors.push(`Community ${community.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
        return null;
      });

      const batchResults = await Promise.all(batchPromises);
      for (const result of batchResults) {
        if (result) results.push(result);
      }

      // Batch arası kısa bekleme
      if (i + MAX_PARALLEL_CALLS < communities.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    if (errors.length > 0) {
      logger.warn(`[CommunitySummarizer] ${errors.length} communities failed to summarize`);
    }

    logger.info(`[CommunitySummarizer] Summarization complete: ${results.length}/${communities.length} successful`);
    return results;
  }

  /**
   * Özet'i veritabanından getir.
   * 
   * @param communityId - Community ID
   * @returns CommunitySummary | null
   */
  getSummary(communityId: string): CommunitySummary | null {
    try {
      const row = this.db.prepare(`
        SELECT community_id, summary, key_entities, key_relations, topics, generated_at
        FROM graph_community_summaries
        WHERE community_id = ?
      `).get(communityId) as CommunitySummaryRow | undefined;

      if (!row) return null;

      return {
        communityId: row.community_id,
        summary: row.summary,
        keyEntities: JSON.parse(row.key_entities),
        keyRelations: JSON.parse(row.key_relations),
        topics: JSON.parse(row.topics),
        generatedAt: new Date(row.generated_at),
      };
    } catch (err) {
      logger.warn({ err }, '[CommunitySummarizer] getSummary hatası:');
      return null;
    }
  }

  /**
   * Özet'i veritabanına kaydet.
   */
  private saveSummary(summary: CommunitySummary): void {
    try {
      const generatedAt = summary.generatedAt.toISOString().replace('T', ' ').substring(0, 19);

      this.db.prepare(`
        INSERT OR REPLACE INTO graph_community_summaries
        (community_id, summary, key_entities, key_relations, topics, generated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        summary.communityId,
        summary.summary,
        JSON.stringify(summary.keyEntities),
        JSON.stringify(summary.keyRelations),
        JSON.stringify(summary.topics),
        generatedAt,
      );

      logger.debug(`[CommunitySummarizer] Summary saved for community: ${summary.communityId}`);
    } catch (err) {
      logger.warn({ err }, '[CommunitySummarizer] saveSummary hatası:');
    }
  }

  /**
   * LLM ile özet oluştur.
   * Retry logic içerir (max 2 retry).
   */
  private async generateLLMSummary(
    community: Community,
    members: MemoryRow[],
    options: SummarizationOptions,
  ): Promise<CommunitySummary | null> {
    const prompt = this.buildSummaryPrompt(community, members, options);

    const messages: LLMMessage[] = [
      { role: 'system', content: 'Sen bir bilgi grafiği analiz uzmanısın. Verilen entity ve ilişkilerden oluşan bir topluluğu özetlersin.' },
      { role: 'user', content: prompt },
    ];

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          logger.debug(`[CommunitySummarizer] Retry attempt ${attempt}/${MAX_RETRIES}`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
        }

        const response = await this.llmProvider.chat(messages, {
          temperature: 0.3,
          maxTokens: 1000,
        });

        const content = response.content?.trim();
        if (!content) {
          throw new Error('Empty response from LLM');
        }

        return this.parseLLMResponse(content, community, members);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn({ err: lastError, attempt }, '[CommunitySummarizer] LLM call failed:');
      }
    }

    logger.error(`[CommunitySummarizer] All ${MAX_RETRIES + 1} LLM attempts failed`);
    return null;
  }

  /**
   * LLM response'u parse et.
   */
  private parseLLMResponse(
    content: string,
    community: Community,
    members: MemoryRow[],
  ): CommunitySummary {
    // Basit parsing: JSON formatı beklenir
    let parsed: {
      summary?: string;
      keyEntities?: Array<{ name: string; type: string; importance?: number }>;
      keyRelations?: Array<{ source: string; target: string; type: string }>;
      topics?: string[];
    } = {};

    try {
      // JSON block'u bul
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                        content.match(/```\s*([\s\S]*?)\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;
      parsed = JSON.parse(jsonStr);
    } catch {
      // JSON parse başarısız → metin olarak kullan
      logger.warn('[CommunitySummarizer] JSON parse failed, using text fallback');
    }

    const summary = parsed.summary || content.substring(0, 500);
    const keyEntities = (parsed.keyEntities || [])
      .slice(0, 10)
      .map(e => ({
        name: e.name || '',
        type: e.type || 'unknown',
        importance: e.importance ?? 0.5,
      }));
    const keyRelations = (parsed.keyRelations || [])
      .slice(0, 5)
      .map(r => ({
        source: r.source || '',
        target: r.target || '',
        type: r.type || 'related_to',
      }));
    const topics = parsed.topics || [];

    return {
      communityId: community.id,
      summary: summary.substring(0, 500),
      keyEntities,
      keyRelations,
      topics,
      generatedAt: new Date(),
    };
  }

  /**
   * Fallback özet oluştur (LLM başarısız olduğunda).
   * Entity isimlerini birleştirir.
   */
  private generateFallbackSummary(
    community: Community,
    members: MemoryRow[],
  ): CommunitySummary {
    // Entity'leri topla
    const entityNames = new Set<string>();
    const categories = new Map<string, number>();

    for (const member of members) {
      // İçerikten ilk 100 karakteri al
      const contentPreview = member.content.substring(0, 100);
      entityNames.add(contentPreview);

      // Kategori say
      const cat = member.category || 'unknown';
      categories.set(cat, (categories.get(cat) ?? 0) + 1);
    }

    // En yaygın kategorileri bul
    const topCategories = Array.from(categories.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([cat]) => cat);

    // Basit özet
    const summary = `Bu topluluk ${members.length} bellek içeriyor. ` +
      `Ana kategoriler: ${topCategories.join(', ')}. ` +
      `Toplam ${entityNames.size} farklı entity var.`;

    // Key entities
    const keyEntities = members
      .slice(0, 10)
      .map(m => ({
        name: m.content.substring(0, 50),
        type: m.category || 'unknown',
        importance: (m.importance ?? 5) / 10,
      }));

    return {
      communityId: community.id,
      summary: summary.substring(0, 500),
      keyEntities,
      keyRelations: [],
      topics: topCategories,
      generatedAt: new Date(),
    };
  }

  /**
   * Özet oluşturma prompt'u.
   */
  private buildSummaryPrompt(
    community: Community,
    members: MemoryRow[],
    options: SummarizationOptions,
  ): string {
    const entityList = members
      .slice(0, 20)
      .map(m => `- [${m.category || 'unknown'}]: ${m.content.substring(0, 150)}`)
      .join('\n');

    // İlişkileri getir
    const memberIds = members.map(m => m.id);
    const idPlaceholders = memberIds.map(() => '?').join(',');
    const relations = this.db.prepare(`
      SELECT mr.relation_type, m1.content as source_content, m2.content as target_content
      FROM memory_relations mr
      JOIN memories m1 ON m1.id = mr.source_memory_id
      JOIN memories m2 ON m2.id = mr.target_memory_id
      WHERE mr.source_memory_id IN (${idPlaceholders})
        AND mr.target_memory_id IN (${idPlaceholders})
      ORDER BY mr.confidence DESC
      LIMIT 10
    `).all(...memberIds, ...memberIds) as Array<{
      relation_type: string;
      source_content: string;
      target_content: string;
    }>;

    const relationList = relations
      .map(r => `- [${r.source_content.substring(0, 50)}] → [${r.target_content.substring(0, 50)}] (${r.relation_type})`)
      .join('\n');

    return `Sen bir bilgi grafiği analiz uzmanısın. Aşağıdaki entity ve ilişkilerden oluşan bir topluluğu özetle.

Entity'ler (${members.length} adet):
${entityList}

İlişkiler (${relations.length} adet):
${relationList}

Lütfen aşağıdaki formatta JSON olarak özet üret:
{
  "summary": "Topluluk özeti (max ${options.maxSummaryLength} karakter)",
  "keyEntities": [
    {"name": "Entity adı", "type": "tip", "importance": 0.8}
  ],
  "keyRelations": [
    {"source": "Kaynak", "target": "Hedef", "type": "ilişki tipi"}
  ],
  "topics": ["konu1", "konu2", "konu3"]
}

Önemli kurallar:
1. summary max ${options.maxSummaryLength} karakter olmalı
2. keyEntities en fazla ${options.maxKeyEntities} adet olmalı
3. keyRelations en fazla ${options.maxKeyRelations} adet olmalı
4. topics 3-5 adet olmalı
5. Sadece JSON döndür, başka açıklama ekleme`;
  }

  /**
   * Community bilgisini yükle.
   */
  private loadCommunity(communityId: string): Community | null {
    try {
      const row = this.db.prepare(`
        SELECT id, modularity_score, dominant_relation_types, created_at
        FROM graph_communities
        WHERE id = ?
      `).get(communityId) as {
        id: string;
        modularity_score: number | null;
        dominant_relation_types: string | null;
        created_at: string;
      } | undefined;

      if (!row) return null;

      const members = this.db.prepare(`
        SELECT node_id FROM graph_community_members WHERE community_id = ?
      `).all(communityId) as Array<{ node_id: number }>;

      return {
        id: row.id,
        memberNodeIds: members.map(m => m.node_id),
        modularityScore: row.modularity_score ?? 0,
        dominantRelationTypes: row.dominant_relation_types
          ? JSON.parse(row.dominant_relation_types)
          : [],
        createdAt: new Date(row.created_at),
      };
    } catch (err) {
      logger.warn({ err }, '[CommunitySummarizer] loadCommunity hatası:');
      return null;
    }
  }

  /**
   * Community üyelerini yükle.
   */
  private loadCommunityMembers(memberIds: number[]): MemoryRow[] {
    if (memberIds.length === 0) return [];

    const placeholders = memberIds.map(() => '?').join(',');
    try {
      return this.db.prepare(`
        SELECT * FROM memories WHERE id IN (${placeholders}) AND is_archived = 0
      `).all(...memberIds) as MemoryRow[];
    } catch (err) {
      logger.warn({ err }, '[CommunitySummarizer] loadCommunityMembers hatası:');
      return [];
    }
  }

  /**
   * Tüm community'leri yükle.
   */
  private loadAllCommunities(): Community[] {
    try {
      const communities = this.db.prepare(`
        SELECT id, modularity_score, dominant_relation_types, created_at
        FROM graph_communities
        ORDER BY modularity_score DESC
      `).all() as Array<{
        id: string;
        modularity_score: number | null;
        dominant_relation_types: string | null;
        created_at: string;
      }>;

      const result: Community[] = [];
      for (const row of communities) {
        const members = this.db.prepare(`
          SELECT node_id FROM graph_community_members WHERE community_id = ?
        `).all(row.id) as Array<{ node_id: number }>;

        result.push({
          id: row.id,
          memberNodeIds: members.map(m => m.node_id),
          modularityScore: row.modularity_score ?? 0,
          dominantRelationTypes: row.dominant_relation_types
            ? JSON.parse(row.dominant_relation_types)
            : [],
          createdAt: new Date(row.created_at),
        });
      }

      return result;
    } catch (err) {
      logger.warn({ err }, '[CommunitySummarizer] loadAllCommunities hatası:');
      return [];
    }
  }

  /**
   * Seçenekleri normalize et.
   */
  private normalizeOptions(options?: Partial<SummarizationOptions>): SummarizationOptions {
    return {
      maxSummaryLength: options?.maxSummaryLength ?? DEFAULT_MAX_SUMMARY_LENGTH,
      maxKeyEntities: options?.maxKeyEntities ?? DEFAULT_MAX_KEY_ENTITIES,
      maxKeyRelations: options?.maxKeyRelations ?? DEFAULT_MAX_KEY_RELATIONS,
      llmProvider: options?.llmProvider,
    };
  }
}
