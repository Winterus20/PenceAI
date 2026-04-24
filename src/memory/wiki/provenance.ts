/**
 * ProvenanceTracker — Bellek revizyon geçmişi ve kaynak izlenebilirliği.
 * Her editMemory() çağrısı öncesi otomatik snapshot kaydeder.
 */

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';
import type { MemoryRevision, ProvenanceTrace } from './types.js';

export interface ProvenanceTrackerDeps {
  db: Database.Database;
}

export interface StoreRevisionMetadata {
  provenanceSource?: string | null;
  provenanceModel?: string | null;
  provenancePromptHash?: string | null;
}

export class ProvenanceTracker {
  private db: Database.Database;

  constructor(deps: ProvenanceTrackerDeps) {
    this.db = deps.db;
  }

  /**
   * Mevcut bellek satırının snapshot'ını memory_revisions tablosuna kaydeder.
   * revision_number otomatik artar (max + 1).
   */
  storeRevision(
    memoryId: number,
    currentRow: {
      content: string;
      category: string;
      importance: number;
    },
    metadata: StoreRevisionMetadata = {}
  ): number {
    try {
      const maxRow = this.db
        .prepare(
          `SELECT COALESCE(MAX(revision_number), 0) as max_rev FROM memory_revisions WHERE memory_id = ?`
        )
        .get(memoryId) as { max_rev: number } | undefined;
      const nextRev = (maxRow?.max_rev ?? 0) + 1;

      const result = this.db
        .prepare(
          `INSERT INTO memory_revisions (
            memory_id, revision_number, content, category, importance,
            provenance_source, provenance_model, provenance_prompt_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          memoryId,
          nextRev,
          currentRow.content,
          currentRow.category,
          currentRow.importance,
          metadata.provenanceSource ?? null,
          metadata.provenanceModel ?? null,
          metadata.provenancePromptHash ?? null
        );

      logger.debug(`[Provenance] Revision #${nextRev} stored for memory ${memoryId}`);
      return Number(result.lastInsertRowid);
    } catch (err) {
      logger.error({ err }, `[Provenance] Failed to store revision for memory ${memoryId}`);
      return -1;
    }
  }

  /**
   * Bir belleğin tüm revizyonlarını kronolojik (eski→yeni) sırada döndürür.
   */
  getRevisions(memoryId: number): MemoryRevision[] {
    const rows = this.db
      .prepare(
        `SELECT id, memory_id, revision_number, content, category, importance,
                provenance_source, provenance_model, provenance_prompt_hash, created_at
         FROM memory_revisions
         WHERE memory_id = ?
         ORDER BY revision_number ASC`
      )
      .all(memoryId) as Array<{
        id: number;
        memory_id: number;
        revision_number: number;
        content: string;
        category: string;
        importance: number;
        provenance_source: string | null;
        provenance_model: string | null;
        provenance_prompt_hash: string | null;
        created_at: string;
      }>;

    return rows.map((r) => ({
      id: r.id,
      memoryId: r.memory_id,
      revisionNumber: r.revision_number,
      content: r.content,
      category: r.category,
      importance: r.importance,
      provenanceSource: r.provenance_source,
      provenanceModel: r.provenance_model,
      provenancePromptHash: r.provenance_prompt_hash,
      createdAt: r.created_at,
    }));
  }

  /**
   * En son revizyonu döndürür.
   */
  getLatestRevision(memoryId: number): MemoryRevision | null {
    const row = this.db
      .prepare(
        `SELECT id, memory_id, revision_number, content, category, importance,
                provenance_source, provenance_model, provenance_prompt_hash, created_at
         FROM memory_revisions
         WHERE memory_id = ?
         ORDER BY revision_number DESC
         LIMIT 1`
      )
      .get(memoryId) as
      | {
          id: number;
          memory_id: number;
          revision_number: number;
          content: string;
          category: string;
          importance: number;
          provenance_source: string | null;
          provenance_model: string | null;
          provenance_prompt_hash: string | null;
          created_at: string;
        }
      | undefined;

    if (!row) return null;
    return {
      id: row.id,
      memoryId: row.memory_id,
      revisionNumber: row.revision_number,
      content: row.content,
      category: row.category,
      importance: row.importance,
      provenanceSource: row.provenance_source,
      provenanceModel: row.provenance_model,
      provenancePromptHash: row.provenance_prompt_hash,
      createdAt: row.created_at,
    };
  }

  /**
   * Hızlı özet: provenance kaynağı, model, prompt hash ve toplam revizyon sayısı.
   */
  getProvenanceTrace(memoryId: number): ProvenanceTrace {
    const row = this.db
      .prepare(
        `SELECT provenance_source, provenance_model, provenance_prompt_hash,
                COUNT(*) as revision_count
         FROM memory_revisions
         WHERE memory_id = ?
         ORDER BY revision_number DESC
         LIMIT 1`
      )
      .get(memoryId) as
      | {
          provenance_source: string | null;
          provenance_model: string | null;
          provenance_prompt_hash: string | null;
          revision_count: number;
        }
      | undefined;

    if (!row) {
      return { source: null, model: null, promptHash: null, revisionCount: 0 };
    }
    return {
      source: row.provenance_source,
      model: row.provenance_model,
      promptHash: row.provenance_prompt_hash,
      revisionCount: row.revision_count,
    };
  }
}
