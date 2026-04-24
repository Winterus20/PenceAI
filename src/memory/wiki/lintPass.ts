/**
 * MemoryLintPass — Karpathy LLM Wiki Faz 1
 * Global çelişki tespiti ve DB'ye kayıt.
 */

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';
import { ContradictionDetector } from './contradictionDetector.js';
import type { LintPassResult } from './types.js';
import type { LLMProvider } from '../../llm/provider.js';

export interface LintPassConfig {
  deterministicThresholdJaccard: number;
  llmValidationEnabled: boolean;
  maxLLMPairsPerRun: number;
}

export interface MemoryLintPassDeps {
  db: Database.Database;
  llm: LLMProvider;
  config: LintPassConfig;
}

export class MemoryLintPass {
  private db: Database.Database;
  private llm: LLMProvider;
  private config: LintPassConfig;

  constructor(deps: MemoryLintPassDeps) {
    this.db = deps.db;
    this.llm = deps.llm;
    this.config = deps.config;
  }

  /**
   * Bellek çelişki lint pass çalıştırır.
   * @param options.dryRun — Sadece tespit edilen çiftleri loglar, DB'ye yazmaz.
   */
  async runLintPass(options: { dryRun?: boolean } = {}): Promise<LintPassResult> {
    const start = Date.now();
    logger.info(`[MemoryLintPass] Starting lint pass (dryRun=${options.dryRun ?? false})`);

    const detector = new ContradictionDetector({
      db: this.db,
      llm: this.llm,
      config: {
        deterministicThresholdJaccard: this.config.deterministicThresholdJaccard,
        llmValidationEnabled: this.config.llmValidationEnabled,
      },
    });

    const detection = await detector.detect();

    if (options.dryRun) {
      logger.info(
        `[MemoryLintPass] Dry run: ${detection.candidates.length} contradictions would be written (scanned ${detection.screenedPairs} pairs)`
      );
      for (const c of detection.candidates.slice(0, 10)) {
        logger.info(`  [DryRun] ${c.memoryAId} vs ${c.memoryBId}: ${c.detectionType} (conf=${c.confidence.toFixed(2)})`);
      }
      return {
        scannedPairs: detection.screenedPairs,
        contradictionsFound: detection.candidates.length,
        falsePositivesFiltered: detection.falsePositivesFiltered,
        durationMs: Date.now() - start,
      };
    }

    // DB insert/update with dedup via UNIQUE constraint
    const insertStmt = this.db.prepare(`
      INSERT INTO memory_contradictions (
        memory_a_id, memory_b_id, detection_type, status, confidence, description, detected_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(memory_a_id, memory_b_id, detection_type) DO UPDATE SET
        confidence = excluded.confidence,
        description = excluded.description,
        status = excluded.status,
        detected_at = excluded.detected_at
    `);

    const archiveStmt = this.db.prepare(`
      UPDATE memories SET is_archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `);

    const runInserts = this.db.transaction((candidates: typeof detection.candidates) => {
      let insertedCount = 0;
      for (const candidate of candidates) {
        let status = candidate.status;
        let desc = candidate.description;
        
        // Auto-Resolution for OUTDATED / SUPERSEDED
        if (
          desc.includes('LLM outcome: SUPERSEDED') ||
          desc.includes('LLM outcome: OUTDATED')
        ) {
          // Assume memoryAId is the older memory (since idA < idB)
          archiveStmt.run(candidate.memoryAId);
          status = 'resolved';
          desc += ' [Auto-resolved: Memory A archived]';
        }

        insertStmt.run(
          candidate.memoryAId,
          candidate.memoryBId,
          candidate.detectionType,
          status,
          candidate.confidence,
          desc
        );
        insertedCount++;
      }
      return insertedCount;
    });

    let inserted = 0;
    try {
      inserted = runInserts(detection.candidates);
    } catch (err) {
      logger.error({ err }, `[MemoryLintPass] Transaction failed during insert`);
    }

    // Update cursor
    this.db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('wiki_last_lint_cursor', datetime('now'), CURRENT_TIMESTAMP)").run();

    logger.info(
      `[MemoryLintPass] Completed in ${Date.now() - start}ms: ${inserted} contradictions written (scanned ${detection.screenedPairs} pairs)`
    );

    return {
      scannedPairs: detection.screenedPairs,
      contradictionsFound: inserted,
      falsePositivesFiltered: detection.falsePositivesFiltered,
      durationMs: Date.now() - start,
    };
  }
}
