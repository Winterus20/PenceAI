/**
 * Memory Graph Manager — İlişkisel bellek graf yönetimi.
 * Entity yönetimi, ilişki yaşam döngüsü, proximity ilişkileri ve graf traversal.
 */

import type Database from 'better-sqlite3';
import type { EmbeddingProvider } from './embeddings.js';
import type { MemoryRow, MemoryEntityRow, GraphNode, GraphEdge, MemoryGraph } from './types.js';
import { computeRetention, computeNewStability, computeNextReview, daysSinceAccess } from './ebbinghaus.js';
import { daysSince } from '../utils/datetime.js';
import { logger } from '../utils/logger.js';

export const DEFAULT_GRAPH_LIMIT = 100;

/**
 * Bellek graf yöneticisi — entity'ler, ilişkiler, proximity ve Ebbinghaus stability.
 */
export class MemoryGraphManager {
    /** Stability üst sınırı (gün) — hiçbir bellek sonsuza kadar kalmaz. */
    private static readonly MAX_STABILITY = 365;

    constructor(
        private db: Database.Database,
        private embeddingProvider: EmbeddingProvider | null
    ) { }

    // ========== Ebbinghaus Stability ==========

    /**
     * Ebbinghaus: Hatırlama anında stability'yi günceller.
     * access_count++, R hesapla → S_new = S*(1+0.9*R), next_review_at yeniden hesapla.
     */
    updateStabilityOnAccess(row: MemoryRow): void {
        const stability = row.stability ?? (row.importance * 2.0);
        const dSince = daysSinceAccess(row.last_accessed || row.created_at);

        const currentRetention = computeRetention(stability, dSince);
        const newStability = Math.min(computeNewStability(stability, currentRetention), MemoryGraphManager.MAX_STABILITY);
        const newNextReview = computeNextReview(newStability);

        const maxImp = row.max_importance ?? row.importance;
        // max_importance < importance durumunda max_importance'ı importance'a eşitle (bozuk veri düzelt)
        const effectiveMax = Math.max(maxImp, row.importance);
        const newImportance = Math.min(row.importance + 1, effectiveMax);

        this.db.prepare(`
            UPDATE memories
            SET
                access_count = access_count + 1,
                last_accessed = CURRENT_TIMESTAMP,
                stability = ?,
                retrievability = ?,
                next_review_at = ?,
                review_count = review_count + 1,
                importance = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(newStability, 1.0, newNextReview, newImportance, row.id);

        // Bağlı bellekleri de hafifçe güçlendir (graph propagation)
        this.reinforceConnectedMemories(row.id, 0.3);
    }

    /**
     * Ebbinghaus reinforceMemory: bağlı bellekleri de hafifçe güçlendirir.
     */
    reinforceConnectedMemories(memoryId: number, factor: number = 0.3): void {
        const neighbors = this.getMemoryNeighbors(memoryId, 5);
        if (neighbors.length === 0) return;

        const updateMemStmt = this.db.prepare(`
            UPDATE memories SET stability = ?, next_review_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `);

        this.db.transaction(() => {
            for (const n of neighbors) {
                const stability = n.stability ?? (n.importance * 2.0);
                const boost = stability * factor * n.confidence;
                const newStability = Math.min(stability + boost, MemoryGraphManager.MAX_STABILITY);
                const newNextReview = computeNextReview(newStability);

                updateMemStmt.run(newStability, newNextReview, n.id);
            }
        })();

        // Bağlı ilişkilerin kendisini de güçlendir (İlişki Yaşam Döngüsü)
        this.reinforceRelationsOnAccess(memoryId);
    }

    // ========== Entity Yönetimi ==========

    /**
     * Entity upsert — normalized name + type çiftine göre.
     */
    upsertEntity(name: string, type: string = 'concept'): number {
        const normalizedName = name.toLowerCase().trim().replace(/\s+/g, ' ');

        const existing = this.db.prepare(`
            SELECT id FROM memory_entities WHERE normalized_name = ? AND type = ?
        `).get(normalizedName, type) as { id: number } | undefined;

        if (existing) return existing.id;

        const result = this.db.prepare(`
            INSERT INTO memory_entities (name, type, normalized_name) VALUES (?, ?, ?)
        `).run(name.trim(), type, normalizedName);

        return Number(result.lastInsertRowid);
    }

    /**
     * Bellek-entity bağlantısı oluşturur.
     */
    linkMemoryEntity(memoryId: number, entityId: number): void {
        try {
            this.db.prepare(`
                INSERT OR IGNORE INTO memory_entity_links (memory_id, entity_id) VALUES (?, ?)
            `).run(memoryId, entityId);
        } catch (err) {
            // Ignore duplicate link
        }
    }

    /**
     * Tüm entity isimlerini döndürür (LLM'e bağlam olarak verilir).
     * KnownEntitiesStep cache'ine sadece entity adı gider (regex ile doğal metinde aranır).
     */
    getAllEntityNames(): string[] {
        const rows = this.db.prepare(`SELECT name FROM memory_entities ORDER BY name`).all() as Array<{ name: string }>;
        return rows.map(r => r.name);
    }

    /**
     * Tüm entity isimlerini ve tiplerini Map olarak döndürür (name → type).
     * Extraction pipeline'da kullanılır, entity type bilgisini korumak için.
     */
    getAllEntityNamesWithType(): Map<string, string> {
        const rows = this.db.prepare(`SELECT name, type FROM memory_entities ORDER BY name`).all() as Array<{ name: string; type: string }>;
        const entityMap = new Map<string, string>();
        for (const row of rows) {
            entityMap.set(row.name, row.type);
        }
        return entityMap;
    }

    // ========== İlişki Yönetimi ==========

    /**
     * İlişki upsert — varsa confidence güncelle, yoksa oluştur.
     */
    upsertRelation(
        sourceMemoryId: number,
        targetMemoryId: number,
        relationType: string = 'related_to',
        confidence: number = 0.5,
        description: string = '',
        decayRate: number = 0.03
    ): void {
        if (sourceMemoryId === targetMemoryId) return;

        let sId = sourceMemoryId;
        let tId = targetMemoryId;

        const isSymmetric = relationType === 'related_to' || relationType === 'contradicts' || relationType === 'shared_entity';
        if (isSymmetric) {
            if (sourceMemoryId > targetMemoryId) {
                sId = targetMemoryId;
                tId = sourceMemoryId;
            }
        }

        try {
            this.db.prepare(`
                INSERT INTO memory_relations (source_memory_id, target_memory_id, relation_type, confidence, description, last_accessed_at, access_count, decay_rate)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 0, ?)
                ON CONFLICT(source_memory_id, target_memory_id, relation_type)
                DO UPDATE SET
                    confidence = MAX(confidence, excluded.confidence),
                    description = CASE
                        WHEN LENGTH(excluded.description) > LENGTH(description) THEN excluded.description
                        ELSE description
                    END,
                    decay_rate = MIN(COALESCE(decay_rate, excluded.decay_rate), excluded.decay_rate)
            `).run(sId, tId, relationType, confidence, description, decayRate);
        } catch (err) {
            logger.warn({ err }, `[Memory] İlişki kayıt hatası (${sId}→${tId}):`);
        }
    }

    /**
     * Bir belleğin tüm bağlı edge'lerinin confidence'ını güçlendirir.
     */
    reinforceRelationsOnAccess(memoryId: number): void {
        try {
            this.db.prepare(`
                UPDATE memory_relations
                SET confidence = MIN(1.0, confidence * 1.15),
                    last_accessed_at = CURRENT_TIMESTAMP,
                    access_count = COALESCE(access_count, 0) + 1
                WHERE source_memory_id = ? OR target_memory_id = ?
            `).run(memoryId, memoryId);
        } catch (err) {
            logger.warn({ err }, `[Memory] İlişki güçlendirme hatası (id=${memoryId}):`);
        }
    }

    // ========== Graph Traversal ==========

    /**
     * Bir belleğin 1-hop komşularını döndürür (graph-aware retrieval).
     */
    getMemoryNeighbors(memoryId: number, limit: number = 10): Array<MemoryRow & { relation_type: string; confidence: number; relation_description: string }> {
        return this.db.prepare(`
            SELECT m.*, mr.relation_type, mr.confidence, mr.description as relation_description
            FROM memory_relations mr
            JOIN memories m ON (
                (mr.source_memory_id = ? AND m.id = mr.target_memory_id)
                OR
                (mr.target_memory_id = ? AND m.id = mr.source_memory_id)
            )
            WHERE m.is_archived = 0
            ORDER BY mr.confidence DESC
            LIMIT ?
        `).all(memoryId, memoryId, limit) as Array<MemoryRow & { relation_type: string; confidence: number; relation_description: string }>;
    }

    /**
     * Birden fazla belleğin 1-hop komşularını tek sorguda döndürür (N+1 optimizasyonu).
     */
    getMemoryNeighborsBatch(memoryIds: number[], limitPerNode: number = 10): Map<number, Array<MemoryRow & { relation_type: string; confidence: number; relation_description: string }>> {
        if (memoryIds.length === 0) return new Map();

        const uniqueIds = [...new Set(memoryIds)];
        const placeholders = uniqueIds.map(() => '?').join(',');

        const rows = this.db.prepare(`
            SELECT
                mr.source_memory_id as edge_source,
                mr.target_memory_id as edge_target,
                m.*,
                mr.relation_type,
                mr.confidence,
                mr.description as relation_description
            FROM memory_relations mr
            JOIN memories m ON (
                (mr.source_memory_id IN (${placeholders}) AND m.id = mr.target_memory_id)
                OR
                (mr.target_memory_id IN (${placeholders}) AND m.id = mr.source_memory_id)
            )
            WHERE m.is_archived = 0
        `).all(...uniqueIds, ...uniqueIds) as Array<MemoryRow & { edge_source: number; edge_target: number; relation_type: string; confidence: number; relation_description: string }>;

        const resultMap = new Map<number, Array<MemoryRow & { relation_type: string; confidence: number; relation_description: string }>>();

        for (const id of uniqueIds) {
            resultMap.set(id, []);
        }

        // Window function benzeri mantıkla JavaScript'te sınıflandır (Limit uygula)
        for (const row of rows) {
            const { edge_source, edge_target, ...memoryData } = row;

            // Eğer source_memory_id bizden istenen ID ise, hedefe doğru ilişki vardır
            if (resultMap.has(edge_source) && memoryData.id === edge_target) {
                const arr = resultMap.get(edge_source)!;
                if (arr.length < limitPerNode) arr.push(memoryData);
            }
            // Çift yönlü kontrol (Symmetric)
            if (resultMap.has(edge_target) && memoryData.id === edge_source) {
                const arr = resultMap.get(edge_target)!;
                if (arr.length < limitPerNode) arr.push(memoryData);
            }
        }

        // Confidence'a göre sırala
        for (const [key, arr] of resultMap.entries()) {
            arr.sort((a, b) => b.confidence - a.confidence);
            // Fazlalıkları uçur (yukarıda length check ile de büyük çoğunluğu eleniyor, ancak emin olmak için)
            resultMap.set(key, arr.slice(0, limitPerNode));
        }

        return resultMap;
    }

    /**
     * Bir belleğin ilişkili olduğu entity'leri döndürür.
     */
    getMemoryEntities(memoryId: number): MemoryEntityRow[] {
        return this.db.prepare(`
            SELECT me.* FROM memory_entities me
            JOIN memory_entity_links mel ON me.id = mel.entity_id
            WHERE mel.memory_id = ?
            ORDER BY me.name
        `).all(memoryId) as MemoryEntityRow[];
    }

    /**
     * Tüm bellek graph'ını döndürür (frontend görselleştirme için).
     * @param limit - Frontend'in aşırı RAM kullanımını önlemek için max bellek sınırı
     */
    getMemoryGraph(limit: number = DEFAULT_GRAPH_LIMIT): MemoryGraph {
        const nodes: GraphNode[] = [];
        const edges: GraphEdge[] = [];
        const nodeIds = new Set<string>();

        // 1. Tüm aktif bellekleri node olarak ekle
        const memories = this.db.prepare(`
            SELECT id, content, category, importance FROM memories
            WHERE is_archived = 0
            ORDER BY importance DESC, last_accessed DESC
            LIMIT ?
        `).all(limit) as Array<{ id: number; content: string; category: string; importance: number }>;

        if (memories.length === 0) return { nodes, edges };

        const memoryIdArray = memories.map(m => m.id);
        const placeholders = memoryIdArray.map(() => '?').join(',');

        for (const m of memories) {
            const nodeId = `memory_${m.id}`;
            nodes.push({
                id: nodeId,
                type: 'memory',
                label: m.content.length > 60 ? m.content.substring(0, 57) + '...' : m.content,
                fullContent: m.content,
                rawId: m.id,
                category: m.category,
                importance: m.importance,
            });
            nodeIds.add(nodeId);
        }

        // 2. Tüm entity'leri node olarak ekle (yalnızca seçilen belleklerdekiler)
        const entities = this.db.prepare(`
            SELECT DISTINCT me.id, me.name, me.type
            FROM memory_entities me
            JOIN memory_entity_links mel ON me.id = mel.entity_id
            WHERE mel.memory_id IN (${placeholders})
        `).all(...memoryIdArray) as Array<{ id: number; name: string; type: string }>;

        for (const e of entities) {
            const nodeId = `entity_${e.id}`;
            nodes.push({
                id: nodeId,
                type: 'entity',
                label: e.name,
                entityType: e.type,
            });
            nodeIds.add(nodeId);
        }

        // 3. Entity-memory bağlantılarını edge olarak ekle
        const entityLinks = this.db.prepare(`
            SELECT mel.memory_id, mel.entity_id
            FROM memory_entity_links mel
            WHERE mel.memory_id IN (${placeholders})
        `).all(...memoryIdArray) as Array<{ memory_id: number; entity_id: number }>;

        for (const link of entityLinks) {
            const sourceId = `memory_${link.memory_id}`;
            const targetId = `entity_${link.entity_id}`;
            if (nodeIds.has(sourceId) && nodeIds.has(targetId)) {
                edges.push({
                    source: sourceId,
                    target: targetId,
                    type: 'has_entity',
                    confidence: 1.0,
                    description: '',
                });
            }
        }

        // 4. Memory-memory ilişkilerini edge olarak ekle
        const relations = this.db.prepare(`
            SELECT mr.source_memory_id, mr.target_memory_id, mr.relation_type, mr.confidence, mr.description
            FROM memory_relations mr
            WHERE mr.source_memory_id IN (${placeholders})
              AND mr.target_memory_id IN (${placeholders})
        `).all(...memoryIdArray, ...memoryIdArray) as Array<{ source_memory_id: number; target_memory_id: number; relation_type: string; confidence: number; description: string }>;

        for (const rel of relations) {
            const sourceId = `memory_${rel.source_memory_id}`;
            const targetId = `memory_${rel.target_memory_id}`;
            if (nodeIds.has(sourceId) && nodeIds.has(targetId)) {
                edges.push({
                    source: sourceId,
                    target: targetId,
                    type: rel.relation_type,
                    confidence: rel.confidence,
                    description: rel.description,
                });
            }
        }

        return { nodes, edges };
    }

    // ========== Proximity İlişkileri ==========

    /**
     * Embedding zaten DB'de kayıtlıyken semantik yakınlık ilişkilerini oluşturur.
     */
    autoCreateProximityRelations(memoryId: number): number {
        if (!this.embeddingProvider) return 0;
        try {
            const row = this.db.prepare(
                `SELECT embedding FROM memory_embeddings WHERE rowid = CAST(? AS INTEGER)`
            ).get(BigInt(memoryId)) as { embedding: Buffer } | undefined;
            if (!row) return 0;

            const queryBuf = row.embedding;

            const neighbors = this.db.prepare(`
                SELECT
                    m.id,
                    vec_distance_cosine(e.embedding, ?) as distance
                FROM memory_embeddings e
                JOIN memories m ON m.id = e.rowid
                WHERE m.is_archived = 0
                  AND e.rowid IN (
                      SELECT rowid FROM memory_embeddings
                      WHERE embedding MATCH ? AND k = 50
                  )
                  AND m.id != ?
                ORDER BY vec_distance_cosine(e.embedding, ?) ASC
                LIMIT 15
            `).all(queryBuf, queryBuf, memoryId, queryBuf) as Array<{ id: number; distance: number }>;

            // OPT F-08: Mesafe filtresi JavaScript tarafında — cosine distance'in SQL'de 3 kez hesaplanmasını önler
            const filtered = neighbors.filter(n => n.distance > 0.15 && n.distance <= 0.4).slice(0, 5);

            for (const n of filtered) {
                const confidence = Math.max(0.3, 1 - n.distance * 2);
                this.upsertRelation(memoryId, n.id, 'related_to', confidence, 'Semantik yakınlık', 0.05);
            }

            if (filtered.length > 0) {
                logger.info(`[Memory] 🔗 Otomatik ${filtered.length} proximity ilişki oluşturuldu (id=${memoryId})`);
            }
            return filtered.length;
        } catch (err) {
            logger.warn({ err }, `[Memory] Auto proximity relation hatası (id=${memoryId}):`);
            return 0;
        }
    }

    /**
     * Aynı entity'yi paylaşan bellekler arasında otomatik "related_to" ilişkisi kurar.
     */
    async createEntityBasedRelations(memoryId: number): Promise<void> {
        const relatedMemories = this.db.prepare(`
            SELECT DISTINCT mel2.memory_id as related_id, me.name as shared_entity
            FROM memory_entity_links mel1
            JOIN memory_entity_links mel2 ON mel1.entity_id = mel2.entity_id
            JOIN memory_entities me ON me.id = mel1.entity_id
            WHERE mel1.memory_id = ? AND mel2.memory_id != ?
        `).all(memoryId, memoryId) as Array<{ related_id: number; shared_entity: string }>;

        for (const rel of relatedMemories) {
            this.upsertRelation(
                memoryId,
                rel.related_id,
                'related_to',
                0.6,
                `Ortak varlık: ${rel.shared_entity}`,
                0.04
            );
        }
    }

    // ========== Graph İşleme ==========

    /**
     * Entity'leri bellekten çıkarıp kaydeder ve ilişkileri kurar.
     */
    async processMemoryGraph(
        memoryId: number,
        content: string,
        extractFn?: (content: string, existingEntities: string[]) => Promise<{
            entities: Array<{ name: string; type: string }>;
            relations: Array<{ targetMemoryId: number; relationType: string; confidence: number; description: string }>;
        }>
    ): Promise<void> {
        if (!extractFn) return;

        try {
            // Lazy load extraction classes inside function to avoid circular deps during startup
            const { ExtractorPipeline } = await import('./extraction/pipeline.js');
            const { DateTimeStep } = await import('./extraction/steps/datetime.js');
            const { NetworkStep } = await import('./extraction/steps/network.js');
            const { KnownEntitiesStep } = await import('./extraction/steps/knownEntities.js');
            const { LLMFallbackStep } = await import('./extraction/steps/llmFallback.js');

            const existingEntities = this.getAllEntityNamesWithType();

            const extractionPipeline = new ExtractorPipeline([
                new DateTimeStep(),
                new NetworkStep(),
                new KnownEntitiesStep(),
                new LLMFallbackStep(extractFn)
            ]);

            const result = await extractionPipeline.run(content, existingEntities);

            for (const entity of result.entities) {
                // Minimum confidence threshold to prevent false positives from flooding DB
                if (entity.confidence >= 0.5) {
                    const entityId = this.upsertEntity(entity.name, entity.type);
                    this.linkMemoryEntity(memoryId, entityId);
                }
            }

            const rawLlmRelations = result.rawLlmRelations ?? [];
            for (const rel of rawLlmRelations) {
                this.upsertRelation(
                    memoryId,
                    rel.targetMemoryId,
                    rel.relationType,
                    rel.confidence,
                    rel.description,
                    0.03
                );
            }

            await this.createEntityBasedRelations(memoryId);

            logger.info(`[Memory] 🧩 Cascade Extraction tamamlandı. ${result.entities.length} Varlık bulundu (Metin: ${result.unprocessedText.length > 5 ? 'Kısmen İşlendi' : 'Tamamen Tüketildi'})`);
        } catch (err) {
            logger.warn({ err }, `[Memory] Graph işleme hatası (id=${memoryId}):`);
        }
    }

    // ========== Temizlik ==========

    /**
     * Bellek silindiğinde ilgili graph verilerini de temizler.
     */
    cleanupMemoryGraph(memoryId: number): void {
        try {
            this.db.prepare(`DELETE FROM memory_relations WHERE source_memory_id = ? OR target_memory_id = ?`).run(memoryId, memoryId);
            this.db.prepare(`DELETE FROM memory_entity_links WHERE memory_id = ?`).run(memoryId);
            this.cleanupOrphanEntities();
        } catch (err) {
            logger.warn({ err }, `[Memory] Graph temizleme hatası (id=${memoryId}):`);
        }
    }

    /**
     * Hiçbir belleğe bağlı olmayan orphan entity'leri temizler.
     */
    cleanupOrphanEntities(): void {
        try {
            const result = this.db.prepare(`
                DELETE FROM memory_entities WHERE id NOT IN (
                    SELECT DISTINCT entity_id FROM memory_entity_links
                )
            `).run();
            if (result.changes > 0) {
                logger.info(`[Memory] 🧹 ${result.changes} orphan entity temizlendi`);
            }
        } catch (err) {
            logger.warn({ err }, `[Memory] Orphan entity temizleme hatası:`);
        }
    }

    // ========== İlişki Yaşam Döngüsü ==========

    /**
     * İlişki Yaşam Döngüsü — Ebbinghaus benzeri decay mekanizması.
     */
    decayRelationships(): { checked: number; pruned: number } {
        const PRUNE_THRESHOLD = 0.3;
        const DEFAULT_BASE_RATE = 0.05;

        const relations = this.db.prepare(`
            SELECT id, confidence, decay_rate, access_count,
                   COALESCE(last_accessed_at, created_at) as last_accessed_at
            FROM memory_relations
        `).all() as Array<{
            id: number; confidence: number; decay_rate: number | null;
            access_count: number | null; last_accessed_at: string;
        }>;

        let pruned = 0;
        let decayed = 0;
        const nowMs = Date.now();

        const deleteStmt = this.db.prepare(`DELETE FROM memory_relations WHERE id = ?`);
        const updateConfStmt = this.db.prepare(`UPDATE memory_relations SET confidence = ? WHERE id = ?`);

        const BATCH_SIZE = 500;
        for (let batchStart = 0; batchStart < relations.length; batchStart += BATCH_SIZE) {
            const batch = relations.slice(batchStart, batchStart + BATCH_SIZE);
            this.db.transaction(() => {
                for (const rel of batch) {
                    const accessCount = rel.access_count ?? 0;
                    const baseRate = rel.decay_rate ?? DEFAULT_BASE_RATE;
                    const effectiveRate = baseRate / (1 + 0.1 * accessCount);

                    const dSince = daysSince(rel.last_accessed_at);

                    const effectiveConfidence = rel.confidence * Math.exp(-effectiveRate * dSince);

                    if (effectiveConfidence < PRUNE_THRESHOLD) {
                        deleteStmt.run(rel.id);
                        pruned++;
                    } else if (effectiveConfidence < rel.confidence) {
                        // Kademeli decay: confidence'ı DB'de güncelle
                        updateConfStmt.run(effectiveConfidence, rel.id);
                        decayed++;
                    }
                }
            })();
        }

        if (pruned > 0) {
            this.cleanupOrphanEntities();
        }

        if (pruned > 0 || relations.length > 50) {
            logger.info(`[Memory] 📉 İlişki decay: ${pruned} temizlendi (${relations.length} ilişki kontrol edildi)`);
        }

        return { checked: relations.length, pruned };
    }

    /**
     * Hiç ilişkisi olmayan bellekleri tespit edip semantik proximity ilişkisi oluşturur.
     */
    async ensureAllMemoryGraphRelations(): Promise<number> {
        if (!this.embeddingProvider) return 0;

        const orphanMemories = this.db.prepare(`
            SELECT m.id FROM memories m
            JOIN memory_embeddings e ON e.rowid = m.id
            WHERE m.is_archived = 0
              AND m.id NOT IN (
                  SELECT source_memory_id FROM memory_relations
                  UNION
                  SELECT target_memory_id FROM memory_relations
              )
        `).all() as Array<{ id: number }>;

        if (orphanMemories.length === 0) return 0;

        let linkedCount = 0;
        for (const mem of orphanMemories) {
            try {
                linkedCount += this.autoCreateProximityRelations(mem.id);
            } catch (err) {
                logger.warn({ err }, `[Memory] Graph backfill hatası (id=${mem.id}):`);
            }
        }

        return linkedCount;
    }
}
