/**
 * ContradictionDetector — Karpathy LLM Wiki Faz 1
 * Hybrid tespit: Deterministic ön filtre + LLM doğrulama.
 */

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';
import type {
  ContradictionCandidate,
  ContradictionDetectionType,
  ContradictionStatus,
} from './types.js';
import type { LLMProvider } from '../../llm/provider.js';
import type { LLMMessage } from '../../router/types.js';

export interface ContradictionDetectorDeps {
  db: Database.Database;
  llm: LLMProvider;
  config: {
    deterministicThresholdJaccard: number;
    llmValidationEnabled: boolean;
  };
}

interface MemoryPair {
  idA: number;
  contentA: string;
  idB: number;
  contentB: string;
  detectionType: ContradictionDetectionType;
  confidence: number;
  description: string;
}

interface PhaseAResult {
  candidates: MemoryPair[];
  screenedPairs: number;
  falsePositivesFiltered: number;
}

type LLMValidationOutcome = 'CONTRADICTORY' | 'OUTDATED' | 'SUPERSEDED' | 'CONSISTENT';

export class ContradictionDetector {
  private db: Database.Database;
  private llm: LLMProvider;
  private config: ContradictionDetectorDeps['config'];

  constructor(deps: ContradictionDetectorDeps) {
    this.db = deps.db;
    this.llm = deps.llm;
    this.config = deps.config;
  }

  /**
   * Phase A — Deterministic screening (LLM'siz, hafif).
   * 1. Jaccard similarity > threshold olan çiftler.
   * 2. Aynı entity'yi paylaşan ve relation_type='contradicts' olan edge'ler.
   * 3. (Optional) Semantic similarity yüksek ama importance/category farklı olanlar.
   */
  private async runPhaseA(): Promise<PhaseAResult> {
    const candidates: MemoryPair[] = [];
    const added = new Set<string>();
    let screenedPairs = 0;
    let falsePositivesFiltered = 0;

    // 0. Fetch cursor
    const cursorRow = this.db.prepare("SELECT value FROM settings WHERE key = 'wiki_last_lint_cursor'").get() as { value: string } | undefined;
    const lastCursor = cursorRow ? cursorRow.value : '1970-01-01T00:00:00.000Z';

    const allMemories = this.db
      .prepare(`SELECT id, content, category, importance FROM memories WHERE is_archived = 0`)
      .all() as Array<{ id: number; content: string; category: string; importance: number }>;

    const updatedMemories = this.db
      .prepare(`SELECT id, content, category, importance FROM memories WHERE is_archived = 0 AND updated_at > ?`)
      .all(lastCursor) as Array<{ id: number; content: string; category: string; importance: number }>;

    const tokenize = (t: string) => new Set(
      t.toLowerCase()
       .replace(/[^\p{L}\p{N}\s]/gu, '')
       .split(/\s+/)
       .filter((w) => w.length > 2)
    );

    // 1. Jaccard & Semantic screening: updatedMemories vs allMemories
    for (const a of updatedMemories) {
      for (const b of allMemories) {
        if (a.id === b.id) continue;
        const normalizedKey = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        if (added.has(normalizedKey)) continue;

        screenedPairs++;

        const setA = tokenize(a.content);
        const setB = tokenize(b.content);
        const intersection = [...setA].filter((x) => setB.has(x)).length;
        const union = setA.size + setB.size - intersection;
        const jaccard = union > 0 ? intersection / union : 0;

        if (jaccard >= this.config.deterministicThresholdJaccard) {
          added.add(normalizedKey);
          candidates.push({
            idA: a.id,
            contentA: a.content,
            idB: b.id,
            contentB: b.content,
            detectionType: 'jaccard',
            confidence: jaccard,
            description: `Jaccard similarity = ${jaccard.toFixed(2)}`,
          });
        } else {
          falsePositivesFiltered++;
        }
      }

      // Semantic Search
      const embeddingRow = this.db.prepare('SELECT embedding FROM memory_embeddings WHERE rowid = ?').get(a.id) as { embedding: Buffer } | undefined;
      if (embeddingRow) {
        const threshold = 0.2; // Distance < 0.2 means cosine similarity > 0.8
        const matched = this.db.prepare(`
          SELECT rowid, vec_distance_cosine(embedding, ?) as distance
          FROM memory_embeddings
          WHERE embedding MATCH ? AND k = 20
        `).all(embeddingRow.embedding, embeddingRow.embedding) as Array<{ rowid: number, distance: number }>;

        for (const match of matched) {
          if (match.rowid === a.id || match.distance >= threshold) continue;
          const normalizedKey = a.id < match.rowid ? `${a.id}|${match.rowid}` : `${match.rowid}|${a.id}`;
          if (added.has(normalizedKey)) continue;

          const bRow = allMemories.find(m => m.id === match.rowid);
          if (!bRow) continue;

          added.add(normalizedKey);
          candidates.push({
            idA: a.id,
            contentA: a.content,
            idB: bRow.id,
            contentB: bRow.content,
            detectionType: 'semantic',
            confidence: 1 - match.distance,
            description: `Semantic similarity = ${(1 - match.distance).toFixed(2)}`,
          });
        }
      }
    }

    // 2. Entity overlap + relation_contradicts screening
    const relationRows = this.db
      .prepare(
        `SELECT mr.source_memory_id, mr.target_memory_id, mr.relation_type, mr.description
         FROM memory_relations mr
         WHERE mr.relation_type = 'contradicts'`
      )
      .all() as Array<{
        source_memory_id: number;
        target_memory_id: number;
        relation_type: string;
        description: string;
      }>;

    for (const row of relationRows) {
      const idA = row.source_memory_id;
      const idB = row.target_memory_id;
      const normalizedKey = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
      if (added.has(normalizedKey)) continue;

      const memA = this.db.prepare('SELECT content FROM memories WHERE id = ?').get(idA) as
        | { content: string }
        | undefined;
      const memB = this.db.prepare('SELECT content FROM memories WHERE id = ?').get(idB) as
        | { content: string }
        | undefined;
      if (!memA || !memB) continue;

      added.add(normalizedKey);
      candidates.push({
        idA,
        contentA: memA.content,
        idB,
        contentB: memB.content,
        detectionType: 'relation_contradicts',
        confidence: 0.9,
        description: `Explicit relation 'contradicts': ${row.description || 'no description'}`,
      });
    }

    // 3. Entity overlap heuristic: aynı entity'ye bağlı ama farklı içerik
    const entityOverlapRows = this.db
      .prepare(
        `SELECT mel1.memory_id as idA, mel2.memory_id as idB, me.name as entity_name
         FROM memory_entity_links mel1
         JOIN memory_entity_links mel2 ON mel1.entity_id = mel2.entity_id
         JOIN memory_entities me ON me.id = mel1.entity_id
         WHERE mel1.memory_id < mel2.memory_id`
      )
      .all() as Array<{ idA: number; idB: number; entity_name: string }>;

    for (const row of entityOverlapRows) {
      const normalizedKey = `${row.idA}|${row.idB}`;
      if (added.has(normalizedKey)) continue;

      const memA = this.db.prepare('SELECT content FROM memories WHERE id = ?').get(row.idA) as
        | { content: string }
        | undefined;
      const memB = this.db.prepare('SELECT content FROM memories WHERE id = ?').get(row.idB) as
        | { content: string }
        | undefined;
      if (!memA || !memB) continue;

      const setA = tokenize(memA.content);
      const setB = tokenize(memB.content);
      const intersection = [...setA].filter((x) => setB.has(x)).length;
      const union = setA.size + setB.size - intersection;
      const jaccard = union > 0 ? intersection / union : 0;

      // Aynı entity ama düşük kelime örtüşmesi => potansiyel çelişki
      if (jaccard < 0.5 && jaccard > 0.1) {
        added.add(normalizedKey);
        candidates.push({
          idA: row.idA,
          contentA: memA.content,
          idB: row.idB,
          contentB: memB.content,
          detectionType: 'entity_overlap',
          confidence: 0.6,
          description: `Shared entity "${row.entity_name}" with low content overlap (jaccard=${jaccard.toFixed(2)})`,
        });
      }
    }

    logger.info(`[ContradictionDetector] Phase A: ${candidates.length} candidates from ${screenedPairs} screened pairs`);
    return { candidates, screenedPairs, falsePositivesFiltered };
  }

  /**
   * Phase B — LLM Validation (Hybrid).
   * Phase A'dan gelen çiftler tek bir batch prompt olarak LLM'e sorulur.
   * Sadece CONSISTENT olmayanlar contradiction olarak işaretlenir.
   */
  private async runPhaseB(candidates: MemoryPair[]): Promise<MemoryPair[]> {
    if (candidates.length === 0) return [];
    if (!this.config.llmValidationEnabled) {
      logger.info('[ContradictionDetector] LLM validation disabled — treating all Phase A candidates as valid');
      return candidates;
    }

    const validated: MemoryPair[] = [];

    // Batch processing: her seferinde 20 çift
    const batchSize = 20;
    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);
      const prompt = this.buildLLMPrompt(batch);

      const messages: LLMMessage[] = [
        { role: 'system', content: 'You are a contradiction detection assistant. Analyze each memory pair and classify exactly as CONTRADICTORY, OUTDATED, SUPERSEDED, or CONSISTENT.' },
        { role: 'user', content: prompt },
      ];

      try {
        const response = await this.llm.chat(messages, { temperature: 0.1, maxTokens: 2048 });
        const text = response.content || '';
        const parsed = this.parseLLMResponse(text, batch.length);

        for (let k = 0; k < batch.length; k++) {
          const { outcome, explanation } = parsed[k]!;
          if (outcome === 'CONSISTENT') {
            logger.debug(`[ContradictionDetector] LLM filtered pair ${batch[k]!.idA}-${batch[k]!.idB} as consistent`);
            continue;
          }
          const pair = batch[k]!;
          // LLM'in belirttiği duruma göre confidence ayarla
          const confidence = outcome === 'CONTRADICTORY' ? 0.95 : 0.85;
          const descPrefix = explanation ? `${explanation} | ` : '';
          validated.push({
            ...pair,
            detectionType: outcome === 'CONTRADICTORY' ? pair.detectionType : 'llm_flagged',
            confidence,
            description: `${descPrefix}${pair.description} | LLM outcome: ${outcome}`,
          });
        }
      } catch (err) {
        logger.warn({ err }, '[ContradictionDetector] LLM batch validation failed, falling back to deterministic only');
        // LLM hata verirse tüm batch'i deterministic olarak kabul et
        validated.push(...batch);
      }
    }

    logger.info(`[ContradictionDetector] Phase B: ${validated.length} / ${candidates.length} confirmed after LLM validation`);
    return validated;
  }

  private buildLLMPrompt(batch: MemoryPair[]): string {
    const lines = batch.map((p, idx) => {
      return `Pair ${idx + 1}:\nA: ${p.contentA}\nB: ${p.contentB}`;
    });
    return (
      lines.join('\n\n') +
      '\n\nFor each pair, respond in this exact format (one per line):\n' +
      '1: [Brief 10-word explanation] | OUTCOME: [CONTRADICTORY/OUTDATED/SUPERSEDED/CONSISTENT]\n' +
      '2: [Brief 10-word explanation] | OUTCOME: [CONTRADICTORY/OUTDATED/SUPERSEDED/CONSISTENT]\n...\n' +
      'Valid outcomes: CONTRADICTORY, OUTDATED, SUPERSEDED, CONSISTENT.'
    );
  }

  private parseLLMResponse(text: string, expectedCount: number): Array<{outcome: LLMValidationOutcome, explanation: string}> {
    const outcomes: Array<{outcome: LLMValidationOutcome, explanation: string}> = [];
    const lines = text.split('\n');
    const regex = /^(\d+)\s*[:.)-]?\s*(.*?)\s*\|\s*OUTCOME:\s*(CONTRADICTORY|OUTDATED|SUPERSEDED|CONSISTENT)/i;
    const fallbackRegex = /^(\d+)\s*[:.)-]?\s*(CONTRADICTORY|OUTDATED|SUPERSEDED|CONSISTENT)/i;

    for (const line of lines) {
      let match = regex.exec(line.trim());
      if (match) {
        const idx = parseInt(match[1]!, 10) - 1;
        const explanation = match[2]?.trim() || '';
        const outcome = match[3]!.toUpperCase() as LLMValidationOutcome;
        if (idx >= 0 && idx < expectedCount) {
          outcomes[idx] = { outcome, explanation };
        }
        continue;
      }

      match = fallbackRegex.exec(line.trim());
      if (match) {
        const idx = parseInt(match[1]!, 10) - 1;
        const outcome = match[2]!.toUpperCase() as LLMValidationOutcome;
        if (idx >= 0 && idx < expectedCount) {
          outcomes[idx] = { outcome, explanation: '' };
        }
      }
    }

    // Missing entries default to CONSISTENT (conservative)
    for (let i = 0; i < expectedCount; i++) {
      if (!outcomes[i]) {
        outcomes[i] = { outcome: 'CONSISTENT', explanation: 'No LLM outcome parsed' };
      }
    }
    return outcomes;
  }

  /**
   * Tam pipeline: Phase A + Phase B.
   * Sonuç olarak ContradictionCandidate[] döndürür (henüz DB'ye yazılmaz).
   */
  async detect(): Promise<{
    candidates: Array<Omit<ContradictionCandidate, 'id' | 'detectedAt' | 'resolvedAt' | 'resolutionNotes'>>;
    screenedPairs: number;
    falsePositivesFiltered: number;
  }> {
    const start = Date.now();
    const phaseA = await this.runPhaseA();
    const validated = await this.runPhaseB(phaseA.candidates);

    const mapped = validated.map((v) => ({
      memoryAId: v.idA,
      memoryBId: v.idB,
      detectionType: v.detectionType,
      status: 'open' as ContradictionStatus,
      confidence: v.confidence,
      description: v.description,
    }));

    logger.info(
      `[ContradictionDetector] Detection completed in ${Date.now() - start}ms: ${mapped.length} contradictions from ${phaseA.screenedPairs} pairs`
    );

    return {
      candidates: mapped,
      screenedPairs: phaseA.screenedPairs,
      falsePositivesFiltered: phaseA.falsePositivesFiltered,
    };
  }
}
