/**
 * RetrievalService - Bellek arama ve getirme işlemleri.
 * 
 * Sorumluluklar:
 * - FTS (tam metin) arama
 * - Semantik (embedding) arama
 * - Hibrit arama (FTS + Semantik + RRF)
 * - Graph-aware arama
 * - Mesaj arama
 * - Review ve follow-up adayları getirme
 */

import type Database from 'better-sqlite3';
import crypto from 'crypto';
import { getConfig } from '../../gateway/config.js';
import { logger } from '../../utils/logger.js';
import { computeReviewPriority } from '../contextUtils.js';
import {
  escapeFtsQuery,
  type MemoryRow,
  type MessageRow,
  type MessageSearchRow,
  type GraphAwareSearchResult,
} from '../types.js';
import { rrfFusion, applyRetentionToRrfWithExplain, applyRecencyWeighting } from '../contextUtils.js';
import { computeNextReview } from '../ebbinghaus.js';
import type { EmbeddingProvider } from '../embeddings.js';
import type { TaskQueue } from '../../autonomous/queue.js';
import type { RecentMessage, PromptContextBundle, PromptContextOptions } from './types.js';
import type { GraphExpander } from '../graphRAG/GraphExpander.js';
import type { PageRankScorer } from '../graphRAG/PageRankScorer.js';
import type { CommunityDetector } from '../graphRAG/CommunityDetector.js';
import type { CommunitySummarizer } from '../graphRAG/CommunitySummarizer.js';
import type { CommunitySummary } from '../graphRAG/CommunitySummarizer.js';

export interface RetrievalDeps {
  db: Database.Database;
  embeddingProvider: EmbeddingProvider | null;
  taskQueue: TaskQueue | null;
  graphManager: {
    getMemoryNeighborsBatch: (memoryIds: number[], limitPerNode?: number) => Map<number, MemoryRow[]>;
    updateStabilityOnAccess: (memory: MemoryRow) => void;
    autoCreateProximityRelations: (memoryId: number) => void;
  };
  enqueueEbbinghausToWorker: (memoryIds: number[]) => void;
  getRecentConversationSummaries: (limit: number) => Array<{ id: string; title: string; summary: string; updated_at: string }>;
  getMemoriesDueForReview: (limit: number) => MemoryRow[];
  getFollowUpCandidates: (days: number, limit: number) => MemoryRow[];
  getRecentMessages: (hours: number, limit: number, excludeConversationId?: string) => RecentMessage[];
  getUserMemories: (limit: number) => MemoryRow[];
  prioritizeConversationMemories: (
    memories: MemoryRow[],
    recentMessages: RecentMessage[],
    activeConversationId: string,
    limit: number
  ) => MemoryRow[];
}

export class RetrievalService {
  private lastRetrievalDebug: Map<string, unknown> = new Map();
  /** TaskQueue — MemoryManager.setTaskQueue() ile sonradan bağlanır */
  taskQueue: TaskQueue | null = null;

  constructor(private deps: RetrievalDeps) {}

  /**
   * TaskQueue referansını günceller (MemoryManager.setTaskQueue tarafından çağrılır).
   */
  setTaskQueue(queue: TaskQueue): void {
    this.deps.taskQueue = queue;
  }

  // ========== Bellek Arama ==========

  /**
   * Belleklerde tam metin arama yapar (iç kullanım — stability güncellemesi yapmaz).
   * hybridSearch gibi metotlar bunu kullanır, böylece Ebbinghaus ağırlıklandırması
   * erişim öncesi değerlerle çalışabilir.
   */
  private _searchMemoriesRaw(query: string, limit: number = 10): MemoryRow[] {
    const ftsQuery = escapeFtsQuery(query);
    if (!ftsQuery) return [];

    return this.deps.db.prepare(`
      SELECT m.* FROM memories m
      JOIN memories_fts fts ON m.id = fts.rowid
      WHERE memories_fts MATCH ? AND m.is_archived = 0
      ORDER BY bm25(memories_fts)
      LIMIT ?
    `).all(ftsQuery, limit) as MemoryRow[];
  }

  /**
   * Belleklerde tam metin arama yapar.
   * Doğrudan kullanıcıya sunulacak aramalar için.
   * Ebbinghaus stability güncellemesi BackgroundWorker'a ertelenir (kullanıcı uyurken yapılır).
   */
  searchMemories(query: string, limit: number = 10): MemoryRow[] {
    const rows = this._searchMemoriesRaw(query, limit);
    // Stability güncellemeyi BackgroundWorker'a ertele — ana thread'i bloklamaz
    this.deps.enqueueEbbinghausToWorker(rows.map(r => r.id));
    return rows;
  }

  /**
   * Query embedding'i cache'li şekilde getirir.
   * Aynı query 1 saat boyunca tekrar embed edilmez (embedding_cache tablosu).
   */
  private async getQueryEmbedding(query: string): Promise<number[]> {
    if (!this.deps.embeddingProvider) throw new Error('No embedding provider');

    const queryHash = crypto.createHash('md5').update(query).digest('hex');

    // Cache hit kontrolü
    const cached = this.deps.db.prepare(
      'SELECT embedding FROM embedding_cache WHERE query_hash = ? AND created_at > datetime(\'now\', \'-1 hour\')'
    ).get(queryHash) as { embedding: Buffer } | undefined;

    if (cached) {
      return Array.from(new Float32Array(cached.embedding.buffer.slice(cached.embedding.byteOffset, cached.embedding.byteOffset + cached.embedding.byteLength)));
    }

    // Cache miss — embed hesapla
    const [queryEmbedding] = await this.deps.embeddingProvider.embed([query]);
    if (!queryEmbedding) throw new Error('Embedding failed');

    // Cache'e kaydet
    try {
      this.deps.db.prepare(
        'INSERT OR REPLACE INTO embedding_cache (query_hash, embedding) VALUES (?, ?)'
      ).run(queryHash, Buffer.from(new Float32Array(queryEmbedding).buffer));
    } catch (err) {
      logger.warn({ msg: '[EmbeddingCache] Failed to save to cache', err });
    }

    return queryEmbedding;
  }

  /**
   * Semantik benzerlik araması — sorgu metnini embed eder,
   * sqlite-vec ile cosine similarity hesaplar.
   */
  async semanticSearch(query: string, limit: number = 10): Promise<(MemoryRow & { similarity: number })[]> {
    if (!this.deps.embeddingProvider) return [];

    try {
      const queryEmbedding = await this.getQueryEmbedding(query);
      const queryArrayBuffer = Buffer.from(new Float32Array(queryEmbedding).buffer);

      const threshold = getConfig().semanticSearchThreshold;
      const results = this.deps.db.prepare(`
        WITH matched AS (
          SELECT rowid, vec_distance_cosine(embedding, ?) as distance
          FROM memory_embeddings
          WHERE embedding MATCH ? AND k = 50
        )
        SELECT
          m.*,
          (1 - w.distance) as similarity
        FROM matched w
        JOIN memories m ON m.id = w.rowid
        WHERE m.is_archived = 0
        AND (1 - w.distance) >= ?
        ORDER BY w.distance ASC
        LIMIT ?
      `).all(queryArrayBuffer, queryArrayBuffer, threshold, limit) as (MemoryRow & { similarity: number })[];

      this.deps.enqueueEbbinghausToWorker(results.map(r => r.id));
      return results;
    } catch (err) {
      logger.warn({ err: err }, '[Memory] Semantik arama hatası:');
      return [];
    }
  }

  /**
   * Hibrit arama — FTS (kelime eşleşmesi) + Semantik (anlam benzerliği) sonuçlarını birleştirir.
   * Reciprocal Rank Fusion (RRF) ile sıralama yapar.
   * Sonuçlar Ebbinghaus retrievability değeriyle ağırlıklandırılır.
   */
  async hybridSearch(query: string, limit: number = 10): Promise<MemoryRow[]> {
    // 1. FTS senkron arama → ardından semantic async arama
    // FTS anında tamamlanır (sync), semantic ise API çağrısı gerektirir (async)
    const ftsResults = this._searchMemoriesRaw(query, limit);
    const semanticResults = await this.semanticSearch(query, limit);

    // 2. Sonuçları birleştir

    if (semanticResults.length === 0) {
      this.recordRetrievalDebug('hybridSearch', { query, limit, strategy: 'fts_only', ftsCount: ftsResults.length, semanticCount: 0, resultIds: ftsResults.map(item => item.id) });
      return ftsResults;
    }
    if (ftsResults.length === 0) {
      this.recordRetrievalDebug('hybridSearch', { query, limit, strategy: 'semantic_only', ftsCount: 0, semanticCount: semanticResults.length, resultIds: semanticResults.map(item => item.id) });
      return semanticResults;
    }

    // 3. OPT F-02: Jenerik RRF fusion ile birleştir
    const fusedResults = rrfFusion(
      ftsResults, semanticResults,
      (m) => m.id, (m) => m, limit,
    );

    const retained = applyRetentionToRrfWithExplain(fusedResults.scoreEntries, limit);
    const merged = retained.results;
    const explainById = new Map(retained.explain.map(entry => [entry.id, entry]));

    this.recordRetrievalDebug('hybridSearch', {
      query,
      limit,
      strategy: 'hybrid_rrf',
      ftsCount: ftsResults.length,
      semanticCount: semanticResults.length,
      explain: (fusedResults.explain ?? []).map(entry => ({
        ...entry,
        retentionWeight: explainById.get(entry.id)?.retentionWeight,
        finalScore: explainById.get(entry.id)?.finalScore,
      })),
      resultIds: merged.map(item => item.id),
    });

    this.deps.enqueueEbbinghausToWorker(merged.map(m => m.id));
    return merged;
  }

  // ========== Mesaj Arama ==========

  /**
   * Mesajlarda tam metin arama yapar.
   */
  searchMessages(query: string, limit: number = 20): MessageRow[] {
    const ftsQuery = escapeFtsQuery(query);
    if (!ftsQuery) return [];

    return this.deps.db.prepare(`
      SELECT m.* FROM messages m
      JOIN messages_fts fts ON m.id = fts.rowid
      WHERE messages_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit) as MessageRow[];
  }

  /**
   * Mesajlarda semantik benzerlik araması — sorgu metnini embed eder,
   * sqlite-vec ile cosine similarity hesaplar ve konuşma bilgisiyle zenginleştirir.
   */
  async semanticSearchMessages(query: string, limit: number = 10): Promise<MessageSearchRow[]> {
    if (!this.deps.embeddingProvider) return [];

    try {
      const queryEmbedding = await this.getQueryEmbedding(query);
      const queryBuf = Buffer.from(new Float32Array(queryEmbedding).buffer);

      const results = this.deps.db.prepare(`
        WITH matched AS (
          SELECT rowid, vec_distance_cosine(embedding, ?) as distance
          FROM message_embeddings
          WHERE embedding MATCH ? AND k = 50
        )
        SELECT
          m.*,
          (1 - w.distance) as similarity,
          COALESCE(c.title, '') as conversation_title,
          c.channel_type
        FROM matched w
        JOIN messages m ON m.id = w.rowid
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.role IN ('user', 'assistant')
        AND w.distance <= 0.75
        ORDER BY w.distance ASC
        LIMIT ?
      `).all(queryBuf, queryBuf, limit) as MessageSearchRow[];

      return results;
    } catch (err) {
      logger.warn({ err: err }, '[Memory] Mesaj semantik arama hatası:');
      return [];
    }
  }

  /**
   * Mesajlarda hibrit arama — FTS (kelime eşleşmesi) + Semantik (anlam benzerliği).
   * Reciprocal Rank Fusion (RRF) ile sıralama yapar.
   * Sonuçlar mesaj tarihinin yakınlığına göre ağırlıklandırılır (recency weighting).
   */
  async hybridSearchMessages(query: string, limit: number = 10): Promise<MessageSearchRow[]> {
    // 1. FTS senkron arama → ardından semantic async arama
    const ftsQuery = escapeFtsQuery(query);
    const ftsResults: MessageSearchRow[] = ftsQuery ? (this.deps.db.prepare(`
      SELECT m.*, 0.0 as similarity, COALESCE(c.title, '') as conversation_title, c.channel_type
      FROM messages m
      JOIN messages_fts fts ON m.id = fts.rowid
      JOIN conversations c ON c.id = m.conversation_id
      WHERE messages_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit) as MessageSearchRow[]) : [];
    const semanticResults = await this.semanticSearchMessages(query, limit);

    if (semanticResults.length === 0) {
      this.recordRetrievalDebug('hybridSearchMessages', { query, limit, strategy: 'fts_only', ftsCount: ftsResults.length, semanticCount: 0, resultIds: ftsResults.map(item => item.id) });
      return ftsResults;
    }
    if (ftsResults.length === 0) {
      this.recordRetrievalDebug('hybridSearchMessages', { query, limit, strategy: 'semantic_only', ftsCount: 0, semanticCount: semanticResults.length, resultIds: semanticResults.map(item => item.id) });
      return semanticResults;
    }

    // 3. OPT F-02: Jenerik RRF fusion
    const fused = rrfFusion(
      ftsResults, semanticResults,
      (m) => m.id, (m) => m, limit,
    );

    // 4. Recency weighting — son 24 saatteki mesajlara %30 bonus,
    // son 7 gündekilere %15 bonus, eskilere bonus yok
    const recencyScored = applyRecencyWeighting(fused.scoreEntries, limit);

    this.recordRetrievalDebug('hybridSearchMessages', {
      query,
      limit,
      strategy: 'hybrid_rrf_recency',
      ftsCount: ftsResults.length,
      semanticCount: semanticResults.length,
      explain: fused.explain ?? [],
      resultIds: recencyScored.map(item => item.id),
    });
    return recencyScored;
  }

  // ========== Graph-Aware Arama ==========

  /**
   * Graph-aware hibrit arama — standart hibrit arama sonuçlarının
   * 1-hop komşularını da dahil eder.
   *
   * Archival Fallback: Aktif sonuçlar kalite eşiğinin altındaysa
   * arşivlenen belleklerde de arar ve düşük importance ile yeniden aktif eder (re-learning).
   *
   * Stability Reinforcement: Context'e giren tüm aktif bellekler için
   * updateStabilityOnAccess çağrılır — Ebbinghaus spaced repetition.
   */
  async graphAwareSearch(query: string, limit: number = 10, maxDepth: number = 1): Promise<GraphAwareSearchResult> {
    const QUALITY_MIN_RESULTS = 3;
    const ARCHIVAL_LIMIT = 5;

    // 1. Standart hibrit arama
    const directResults = await this.hybridSearch(query, Math.min(limit, 7));

    if (directResults.length === 0) {
      // Aktif bellekte hiç sonuç yok — arşive bak
      const archivalResults = await this.archivalSearch(query, ARCHIVAL_LIMIT);
      if (archivalResults.length > 0) {
        this.dearchiveMemories(archivalResults);
      }
      this.recordRetrievalDebug('graphAwareSearch', { query, limit, maxDepth, directCount: 0, neighborCount: 0, archivalCount: archivalResults.length, expandedFromIds: [], activeIds: [], archivalIds: archivalResults.map(item => item.id) });
      return { active: [], archival: archivalResults };
    }

    // 2. Her sonucun komşularını topla (Çok Sekmeli / Multi-hop BFS)
    const resultIds = new Set(directResults.map(m => m.id));
    const neighborMemories: MemoryRow[] = [];
    const expandedMemoryIds = new Set<number>();

    let currentWave = directResults.slice(0, 3); // 5 → 3 (context patlamasını önle)
    for (let depth = 0; depth < maxDepth; depth++) {
      const nextWave: MemoryRow[] = [];
      // OPT F-01: Batch komşu sorgusu — N+1 yerine tek sorgu
      const waveIds = currentWave.map(m => m.id);
      const batchNeighbors = this.deps.graphManager.getMemoryNeighborsBatch(waveIds, 3);
      for (const mem of currentWave) {
        const neighbors = batchNeighbors.get(mem.id) || [];
        for (const n of neighbors) {
          if (!resultIds.has(n.id) && (n.confidence ?? 0) >= 0.4) {
            resultIds.add(n.id);
            neighborMemories.push(n);
            expandedMemoryIds.add(mem.id);
            nextWave.push(n);
          }
        }
      }
      currentWave = nextWave.slice(0, 3); // Context patlamasını önle
    }

    // 3. İlişki güçlendirme artık Ebbinghaus worker'a bırakılıyor (adım 5).
    // Daha önce burada yapılan reinforceRelationsOnAccess çağrısı,
    // updateStabilityOnAccess → reinforceConnectedMemories ile TEKRAR çalışıyordu (double boost bug).

    // 4. Birleştir: direkt sonuçlar önce, komşular sonra
    const combined = [...directResults, ...neighborMemories].slice(0, limit);

    // 5. Ebbinghaus Reinforcement — context'e giren bellekler için TaskQueue'ya ertele
    this.deps.enqueueEbbinghausToWorker(combined.map(m => m.id));

    // 6. Archival Fallback — aktif sonuç kalitesi düşükse arşive bak
    let archivalResults: MemoryRow[] = [];
    if (directResults.length < QUALITY_MIN_RESULTS) {
      archivalResults = await this.archivalSearch(query, ARCHIVAL_LIMIT);
      if (archivalResults.length > 0) {
        this.dearchiveMemories(archivalResults);
      }
    }

    this.recordRetrievalDebug('graphAwareSearch', {
      query,
      limit,
      maxDepth,
      directCount: directResults.length,
      neighborCount: neighborMemories.length,
      archivalCount: archivalResults.length,
      expandedFromIds: [...expandedMemoryIds],
      activeIds: combined.map(item => item.id),
      archivalIds: archivalResults.map(item => item.id),
    });

    return { active: combined, archival: archivalResults };
  }

  // ========== Archival Memory Search ==========

  /**
   * Arşivlenen belleklerde FTS tam metin araması (iç kullanım).
   */
  private _searchMemoriesRawArchival(query: string, limit: number = 5): MemoryRow[] {
    const ftsQuery = escapeFtsQuery(query);
    if (!ftsQuery) return [];

    return this.deps.db.prepare(`
      SELECT m.* FROM memories m
      JOIN memories_fts fts ON m.id = fts.rowid
      WHERE memories_fts MATCH ? AND m.is_archived = 1
      ORDER BY bm25(memories_fts)
      LIMIT ?
    `).all(ftsQuery, limit) as MemoryRow[];
  }

  /**
   * Arşivlenen belleklerde semantik benzerlik araması.
   */
  private async semanticSearchArchival(query: string, limit: number = 5): Promise<(MemoryRow & { similarity: number })[]> {
    if (!this.deps.embeddingProvider) return [];

    try {
      const queryEmbedding = await this.getQueryEmbedding(query);
      const queryArrayBuffer = Buffer.from(new Float32Array(queryEmbedding).buffer);

      return this.deps.db.prepare(`
        WITH matched AS (
          SELECT rowid, vec_distance_cosine(embedding, ?) as distance
          FROM memory_embeddings
          WHERE embedding MATCH ? AND k = 50
        )
        SELECT
          m.*,
          (1 - w.distance) as similarity
        FROM matched w
        JOIN memories m ON m.id = w.rowid
        WHERE m.is_archived = 1
        AND w.distance <= 0.30
        ORDER BY w.distance ASC
        LIMIT ?
      `).all(queryArrayBuffer, queryArrayBuffer, limit) as (MemoryRow & { similarity: number })[];
    } catch (err) {
      logger.warn({ err: err }, '[Memory] Archival semantik arama hatası:');
      return [];
    }
  }

  /**
   * Arşivlenen belleklerde hibrit arama — FTS + Semantik + RRF.
   * Aktif hybridSearch ile aynı mantık, is_archived = 1 filtresi ile.
   */
  private async archivalSearch(query: string, limit: number = 5): Promise<MemoryRow[]> {
    // FTS senkron arama → ardından semantic async arama
    const ftsResults = this._searchMemoriesRawArchival(query, limit);
    const semanticResults = await this.semanticSearchArchival(query, limit);

    if (semanticResults.length === 0) return ftsResults;
    if (ftsResults.length === 0) return semanticResults;

    // OPT F-02: Jenerik RRF fusion
    return rrfFusion(
      ftsResults, semanticResults,
      (m) => m.id, (m) => m, limit,
    ).results;
  }

  /**
   * Arşivden geri getirme (De-archive) + Re-learning mekanizması.
   * importance = 1 (en düşük), stability = 2.0 (kırılgan), graph ilişkileri yeniden oluşturulur.
   * max_importance korunur — importance artışı bununla cap'lenir.
   */
  private dearchiveMemories(memories: MemoryRow[]): void {
    const RE_LEARN_STABILITY = 2.0;
    const RE_LEARN_IMPORTANCE = 1;
    const nextReview = computeNextReview(RE_LEARN_STABILITY);

    const dearchiveStmt = this.deps.db.prepare(`
      UPDATE memories
      SET is_archived = 0,
        importance = ?,
        stability = ?,
        retrievability = 1.0,
        next_review_at = ?,
        review_count = 0,
        last_accessed = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    const runDearchive = this.deps.db.transaction(() => {
      for (const mem of memories) {
        dearchiveStmt.run(RE_LEARN_IMPORTANCE, RE_LEARN_STABILITY, nextReview, mem.id);
      }
    });

    runDearchive();

    // Graph ilişkilerini yeniden oluştur (eski ilişkiler decay ile silinmiş olabilir)
    for (const mem of memories) {
      this.deps.graphManager.autoCreateProximityRelations(mem.id);
    }

    logger.info(`[Memory] 📦 ${memories.length} bellek arşivden geri getirildi (importance=${RE_LEARN_IMPORTANCE}, stability=${RE_LEARN_STABILITY})`);
  }

  // ========== Review ve Follow-up ==========

  /**
   * Review zamanı gelmiş bellekleri döndürür.
   * next_review_at <= şu an, retrievability'ye göre öncelik sıralanır (en düşük önce).
   * Sistem promptuna enjekte edilir; bu enjeksiyon stability'yi tetiklemez.
   */
  getMemoriesDueForReview(limit: number = 5): MemoryRow[] {
    const nowSec = Math.floor(Date.now() / 1000);
    const dueMemories = this.deps.db.prepare(`
      SELECT * FROM memories
      WHERE is_archived = 0
      AND next_review_at IS NOT NULL
      AND next_review_at <= ?
      LIMIT ?
    `).all(nowSec, Math.max(limit * 3, limit)) as MemoryRow[];

    return dueMemories
      .sort((a, b) => computeReviewPriority(b, nowSec) - computeReviewPriority(a, nowSec))
      .slice(0, limit);
  }

  /**
   * Yakın geçmişteki (varsayılan: son 14 gün) "event" veya "project" kategorisindeki bellekleri döndürür.
   * Bu bilgiler asistanın yeni bir sohbete proaktif olarak (inisiyatif alıp konuyu açarak) başlaması için kullanılır.
   */
  getFollowUpCandidates(days: number = 14, limit: number = 3): MemoryRow[] {
    return this.deps.db.prepare(`
      SELECT * FROM memories
      WHERE is_archived = 0
      AND category IN ('event', 'project')
      AND updated_at >= datetime('now', '-' || ? || ' days')
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(days, limit) as MemoryRow[];
  }

  // ========== Kullanıcı Bellekleri ve Mesajlar ==========

  /**
   * Kullanıcının belleklerini önem ve kullanım skoruna göre döndürür.
   * Scoring: importance * 2 + access_count
   */
  getUserMemories(limit: number = 50): MemoryRow[] {
    return this.deps.db.prepare(`
      SELECT * FROM memories
      WHERE is_archived = 0
      ORDER BY (importance * 2 + access_count) DESC, updated_at DESC
      LIMIT ?
    `).all(limit) as MemoryRow[];
  }

  // ========== Autonomous Engine Helpers ==========

  /**
   * Otonom düşünme motoru için "tohum" bellek bulur.
   * Rastgele, en son seçilmiş tohumu hariç tutarak ve cooldown mantığıyla filtreler.
   */
  getAutonomousSeedMemories(limit: number, excludedSeedId?: number, cooldownMinutes: number = 2): MemoryRow[] {
    if (excludedSeedId) {
      return this.deps.db.prepare(`
        SELECT * FROM memories
        WHERE is_archived = 0
        AND importance >= 4
        AND id != ?
        AND (last_accessed < datetime('now', '-' || ? || ' minutes') OR last_accessed IS NULL)
        ORDER BY RANDOM()
        LIMIT ?
      `).all(excludedSeedId, cooldownMinutes, limit) as MemoryRow[];
    } else {
      return this.deps.db.prepare(`
        SELECT * FROM memories
        WHERE is_archived = 0
        AND importance >= 4
        AND (last_accessed < datetime('now', '-' || ? || ' minutes') OR last_accessed IS NULL)
        ORDER BY RANDOM()
        LIMIT ?
      `).all(cooldownMinutes, limit) as MemoryRow[];
    }
  }

  /**
   * Otonom Graph Walk işlemi için bir belleğin komşularını güven skoruna göre getirir.
   */
  getAutonomousGraphWalkNeighbors(seedId: number, confidenceThreshold: number = 0.5, limit: number = 5): Array<MemoryRow & { relation_description?: string, relation_confidence?: number }> {
    return this.deps.db.prepare(`
      SELECT m.*, mr.description as relation_description, mr.confidence as relation_confidence
      FROM memory_relations mr
      JOIN memories m ON (
          (mr.source_memory_id = ? AND m.id = mr.target_memory_id)
          OR
          (mr.target_memory_id = ? AND m.id = mr.source_memory_id)
      )
      WHERE m.is_archived = 0 AND mr.confidence >= ?
      ORDER BY mr.confidence DESC
      LIMIT ?
    `).all(seedId, seedId, confidenceThreshold, limit) as Array<MemoryRow & { relation_description?: string, relation_confidence?: number }>;
  }

  /**
   * Son N saat içindeki kullanıcı mesajlarını döndürür (tüm konuşmalardan).
   * Günlük bağlam oluşturmak için kullanılır — bellekte saklanmayan kısa vadeli bilgiler.
   */
  getRecentMessages(hours: number = 48, limit: number = 30, excludeConversationId?: string): RecentMessage[] {
    if (excludeConversationId) {
      return this.deps.db.prepare(`
        SELECT m.role, m.content, m.created_at, COALESCE(c.title, '') as conversation_title
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.role IN ('user', 'assistant')
        AND m.created_at >= datetime('now', '-' || ? || ' hours')
        AND m.conversation_id != ?
        ORDER BY m.created_at DESC
        LIMIT ?
      `).all(hours, excludeConversationId, limit) as RecentMessage[];
    }
    return this.deps.db.prepare(`
      SELECT m.role, m.content, m.created_at, COALESCE(c.title, '') as conversation_title
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.role IN ('user', 'assistant')
      AND m.created_at >= datetime('now', '-' || ? || ' hours')
      ORDER BY m.created_at DESC
      LIMIT ?
    `).all(hours, limit) as RecentMessage[];
  }

  // ========== Embedding Backfill ==========

  /**
   * Embedding'i hesaplanmamış bellekleri bulur ve batch olarak hesaplar.
   */
  async ensureAllEmbeddings(): Promise<number> {
    return this._ensureEmbeddingsGeneric(
      `SELECT m.id, m.content FROM memories m
       LEFT JOIN memory_embeddings me ON m.id = me.rowid
       WHERE me.rowid IS NULL`,
      'memory_embeddings',
      'bellek',
    );
  }

  /**
   * Embedding'i hesaplanmamış mesajları bulur ve batch olarak hesaplar.
   */
  async ensureAllMessageEmbeddings(): Promise<number> {
    return this._ensureEmbeddingsGeneric(
      `SELECT m.id, m.content FROM messages m
       LEFT JOIN message_embeddings me ON m.id = me.rowid
       WHERE me.rowid IS NULL
       AND m.role IN ('user', 'assistant')
       AND LENGTH(m.content) > 20`,
      'message_embeddings',
      'mesaj',
    );
  }

  private async _ensureEmbeddingsGeneric(
    findMissingSql: string,
    table: 'memory_embeddings' | 'message_embeddings',
    label: string,
  ): Promise<number> {
    if (!this.deps.embeddingProvider) return 0;

    const missing = this.deps.db.prepare(findMissingSql).all() as Array<{ id: number; content: string }>;
    if (missing.length === 0) return 0;

    logger.info(`[Memory] ${missing.length} ${label} için embedding hesaplanıyor...`);

    const batchSize = 50;
    let processed = 0;

    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      try {
        const texts = batch.map(m => m.content);
        const embeddings = await this.deps.embeddingProvider.embed(texts);

        // sqlite-vec sanal tablosu OR REPLACE desteklemez → DELETE + INSERT
        const deleteSql = table === 'memory_embeddings'
          ? 'DELETE FROM memory_embeddings WHERE rowid = CAST(? AS INTEGER)'
          : 'DELETE FROM message_embeddings WHERE rowid = CAST(? AS INTEGER)';
        const insertSql = table === 'memory_embeddings'
          ? 'INSERT INTO memory_embeddings (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)'
          : 'INSERT INTO message_embeddings (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)';
        const deleteStmt = this.deps.db.prepare(deleteSql);
        const insertStmt = this.deps.db.prepare(insertSql);

        const insertMany = this.deps.db.transaction((items: Array<{ id: number; embedding: number[] }>) => {
          for (const item of items) {
            const idBig = BigInt(item.id);
            deleteStmt.run(idBig);
            insertStmt.run(idBig, Buffer.from(new Float32Array(item.embedding).buffer));
          }
        });

        insertMany(batch.map((m, idx) => ({ id: Number(m.id), embedding: embeddings[idx] ?? [] })));
        processed += batch.length;
        logger.info(`[Memory] → ${processed}/${missing.length} ${label} embedding hesaplandı`);
      } catch (err) {
        logger.error({ err: err }, `[Memory] Batch ${label} embedding hatası (${i}-${i + batch.length}):`);
      }
    }

    return processed;
  }

  // ========== GraphRAG Search ==========

  /**
   * GraphRAG-style hibrit arama.
   *
   * 1. Standard hybrid search ile initial results
   * 2. Graph expansion: Initial results'ın komşularını bul
   * 3. PageRank scoring ile node'ları skorla
   * 4. Community bilgisi ekle
   * 5. RRF fusion ile final ranking
   */
  async graphRAGSearch(options: {
    query: string;
    maxResults?: number;
    maxHops?: number;
    useCommunities?: boolean;
    usePageRank?: boolean;
    minConfidence?: number;
  }): Promise<{
    memories: MemoryRow[];
    communitySummaries: CommunitySummary[];
    graphContext: {
      expandedNodeIds: number[];
      edgeCount: number;
      maxHopReached: boolean;
    };
    searchMetadata: {
      duration: number;
      cacheHit: boolean;
      communityCount: number;
    };
  }> {
    const startTime = Date.now();
    const {
      query,
      maxResults = 10,
      maxHops = 2,
      useCommunities = true,
      usePageRank = true,
      minConfidence = 0.3,
    } = options;

    // GraphRAG bileşenleri deps'ten alınmalı
    const graphExpander = (this.deps as any).graphExpander as GraphExpander | undefined;
    const pageRankScorer = (this.deps as any).pageRankScorer as PageRankScorer | undefined;
    const communityDetector = (this.deps as any).communityDetector as CommunityDetector | undefined;
    const communitySummarizer = (this.deps as any).communitySummarizer as CommunitySummarizer | undefined;

    if (!graphExpander) {
      logger.warn('[RetrievalService] GraphRAG search called but GraphExpander not available');
      const fallbackResults = await this.hybridSearch(query, maxResults);
      return {
        memories: fallbackResults,
        communitySummaries: [],
        graphContext: { expandedNodeIds: [], edgeCount: 0, maxHopReached: false },
        searchMetadata: { duration: Date.now() - startTime, cacheHit: false, communityCount: 0 },
      };
    }

    // 1. Standard hybrid search ile initial results
    const initialResults = await this.hybridSearch(query, maxResults);
    if (initialResults.length === 0) {
      return {
        memories: [],
        communitySummaries: [],
        graphContext: { expandedNodeIds: [], edgeCount: 0, maxHopReached: false },
        searchMetadata: { duration: Date.now() - startTime, cacheHit: false, communityCount: 0 },
      };
    }

    // 2. Graph expansion: Initial results'ın komşularını bul
    const seedNodeIds = initialResults.map(m => m.id);
    const expansion = graphExpander.expand({
      seedNodeIds,
      maxDepth: maxHops,
      maxNodes: maxResults * 3,
      minConfidence,
      useCache: true,
    });

    // 3. PageRank scoring ile node'ları skorla
    const scores = new Map<number, number>();
    if (usePageRank && pageRankScorer) {
      const expandedNodeIds = expansion.nodes.map(n => n.id);
      const pageRankScores = pageRankScorer.scoreSubgraph(expandedNodeIds);
      for (const [nodeId, score] of pageRankScores) {
        scores.set(nodeId, score);
      }
    }

    // 4. Community bilgisi ekle
    const communitySummaries: CommunitySummary[] = [];
    if (useCommunities && communitySummarizer) {
      const expandedNodeIds = expansion.nodes.map(n => n.id);
      const communities = communityDetector?.detectLocalCommunity(expandedNodeIds, maxHops) ?? [];
      
      // Her community için summary getir
      for (const community of communities.slice(0, 3)) {
        const summary = communitySummarizer.getSummary(community.id);
        if (summary) {
          communitySummaries.push(summary);
        }
      }
    }

    // 5. RRF fusion ile final ranking
    const allNodes = [...initialResults, ...expansion.nodes];
    const uniqueNodes = Array.from(new Map(allNodes.map(n => [n.id, n])).values());
    
    // Score'a göre sırala
    const scoredNodes = uniqueNodes.map(node => ({
      node,
      score: scores.get(node.id) ?? 0,
      isInitial: seedNodeIds.includes(node.id),
    }));

    // Initial results önce, sonra expanded nodes (score'a göre)
    const finalResults = scoredNodes
      .sort((a, b) => {
        if (a.isInitial && !b.isInitial) return -1;
        if (!a.isInitial && b.isInitial) return 1;
        return b.score - a.score;
      })
      .map(s => s.node)
      .slice(0, maxResults);

    const elapsed = Date.now() - startTime;

    this.recordRetrievalDebug('graphRAGSearch', {
      query,
      maxResults,
      maxHops,
      initialCount: initialResults.length,
      expandedCount: expansion.nodes.length,
      finalCount: finalResults.length,
      communityCount: communitySummaries.length,
      duration: elapsed,
    });

    return {
      memories: finalResults,
      communitySummaries,
      graphContext: {
        expandedNodeIds: expansion.nodes.map(n => n.id),
        edgeCount: expansion.edges.length,
        maxHopReached: expansion.maxHopReached,
      },
      searchMetadata: {
        duration: elapsed,
        cacheHit: false,
        communityCount: communitySummaries.length,
      },
    };
  }

  // ========== Debug ==========

  getRetrievalDebugSnapshot(flow: 'hybridSearch' | 'hybridSearchMessages' | 'graphAwareSearch' | 'graphRAGSearch' | 'promptContextBundle'): unknown {
    return this.lastRetrievalDebug.get(flow) ?? null;
  }

  private recordRetrievalDebug(flow: 'hybridSearch' | 'hybridSearchMessages' | 'graphAwareSearch' | 'graphRAGSearch' | 'promptContextBundle', payload: unknown): void {
    this.lastRetrievalDebug.set(flow, {
      capturedAt: new Date().toISOString(),
      ...((payload && typeof payload === 'object') ? payload as Record<string, unknown> : { payload }),
    });
    logger.debug({ flow, payload: this.lastRetrievalDebug.get(flow) }, '[Memory] Retrieval debug snapshot updated');
  }
}
