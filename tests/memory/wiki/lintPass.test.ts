import { describe, it, expect, beforeEach } from '@jest/globals';
import Database from 'better-sqlite3';
import { MemoryLintPass } from '../../../src/memory/wiki/lintPass.js';
import type { LLMProvider } from '../../../src/llm/provider.js';
import type { LLMResponse, LLMMessage } from '../../../src/router/types.js';

function createMockLLM(responseText: string): LLMProvider {
  return {
    name: 'mock',
    supportedModels: ['mock-model'],
    defaultModel: 'mock-model',
    async chat(_messages: LLMMessage[]): Promise<LLMResponse> {
      return {
        content: responseText,
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: 'stop',
      };
    },
    async healthCheck(): Promise<boolean> { return true; },
  } as unknown as LLMProvider;
}

describe('MemoryLintPass', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        importance INTEGER DEFAULT 5,
        is_archived INTEGER DEFAULT 0
      );
      CREATE TABLE memory_contradictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_a_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        memory_b_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        detection_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        confidence REAL DEFAULT 0.5,
        description TEXT DEFAULT '',
        detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME,
        resolution_notes TEXT DEFAULT '',
        UNIQUE(memory_a_id, memory_b_id, detection_type)
      );
      CREATE TABLE memory_relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_memory_id INTEGER NOT NULL,
        target_memory_id INTEGER NOT NULL,
        relation_type TEXT NOT NULL DEFAULT 'related_to',
        description TEXT DEFAULT ''
      );
      CREATE TABLE memory_entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'concept',
        normalized_name TEXT NOT NULL
      );
      CREATE TABLE memory_entity_links (
        memory_id INTEGER NOT NULL,
        entity_id INTEGER NOT NULL,
        PRIMARY KEY (memory_id, entity_id)
      );
    `);
  });

  it('dry-run reports candidates without writing', async () => {
    db.prepare("INSERT INTO memories (content) VALUES (?)").run('A');
    db.prepare("INSERT INTO memories (content) VALUES (?)").run('B');

    const lint = new MemoryLintPass({
      db,
      llm: createMockLLM('1: CONSISTENT'),
      config: { deterministicThresholdJaccard: 0.8, llmValidationEnabled: true, maxLLMPairsPerRun: 20 },
    });

    const result = await lint.runLintPass({ dryRun: true });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.scannedPairs).toBe(1);

    const rows = db.prepare("SELECT COUNT(*) as c FROM memory_contradictions").get() as { c: number };
    expect(rows.c).toBe(0);
  });

  it('inserts and dedups contradictions on conflict', async () => {
    db.prepare("INSERT INTO memories (content) VALUES (?)").run('Same content here');
    db.prepare("INSERT INTO memories (content) VALUES (?)").run('Same content here');

    const lint = new MemoryLintPass({
      db,
      llm: createMockLLM('1: CONTRADICTORY'),
      config: { deterministicThresholdJaccard: 0.5, llmValidationEnabled: false, maxLLMPairsPerRun: 20 },
    });

    const r1 = await lint.runLintPass({ dryRun: false });
    expect(r1.contradictionsFound).toBe(1);

    const r2 = await lint.runLintPass({ dryRun: false });
    expect(r2.contradictionsFound).toBe(1); // re-insert with ON CONFLICT update

    const rows = db.prepare("SELECT COUNT(*) as c FROM memory_contradictions").get() as { c: number };
    expect(rows.c).toBe(1);
  });
});
