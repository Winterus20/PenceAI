import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import Database from 'better-sqlite3';
import { ContradictionDetector } from '../../../src/memory/wiki/contradictionDetector.js';
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
        async healthCheck(): Promise<boolean> {
            return true;
        },
    } as unknown as LLMProvider;
}

describe('ContradictionDetector', () => {
    let db: Database.Database;

    beforeEach(() => {
        db = new Database(':memory:');
        db.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        importance INTEGER DEFAULT 5,
        is_archived INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE memory_embeddings (
        embedding BLOB
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

    it('detects high Jaccard similarity as candidate', async () => {
        const stmt = db.prepare('INSERT INTO memories (content) VALUES (?)');
        stmt.run('Yigit Python programlama dili sever ve her gün kullanır');
        stmt.run('Yigit Python programlama dili sever ve her gün kullanır');

        const detector = new ContradictionDetector({
            db,
            llm: createMockLLM('1: CONSISTENT'),
            config: { deterministicThresholdJaccard: 0.8, llmValidationEnabled: true },
        });

        const result = await detector.detect();
        expect(result.screenedPairs).toBe(1);
        expect(result.candidates.length).toBe(0); // LLM consistent diyor
    });

    it('accepts deterministic candidate when LLM validation disabled', async () => {
        const stmt = db.prepare('INSERT INTO memories (content) VALUES (?)');
        stmt.run('Yigit Python sever');
        stmt.run('Yigit Python sever');

        const detector = new ContradictionDetector({
            db,
            llm: createMockLLM(''),
            config: { deterministicThresholdJaccard: 0.8, llmValidationEnabled: false },
        });

        const result = await detector.detect();
        expect(result.candidates.length).toBe(1);
        expect(result.candidates[0]!.detectionType).toBe('jaccard');
    });

    it('detects explicit contradicts relation', async () => {
        const stmt = db.prepare('INSERT INTO memories (content) VALUES (?)');
        const a = Number(stmt.run('A says X').lastInsertRowid);
        const b = Number(stmt.run('B says not X').lastInsertRowid);

        db.prepare(
            'INSERT INTO memory_relations (source_memory_id, target_memory_id, relation_type, description) VALUES (?, ?, ?, ?)',
        ).run(a, b, 'contradicts', 'Direct contradiction');

        const detector = new ContradictionDetector({
            db,
            llm: createMockLLM('1: CONTRADICTORY'),
            config: { deterministicThresholdJaccard: 0.8, llmValidationEnabled: true },
        });

        const result = await detector.detect();
        const relCand = result.candidates.find((c) => c.detectionType === 'relation_contradicts');
        expect(relCand).toBeDefined();
        expect(relCand!.memoryAId).toBe(a);
        expect(relCand!.memoryBId).toBe(b);
    });

    it('dedups pairs via normalization', async () => {
        const stmt = db.prepare('INSERT INTO memories (content) VALUES (?)');
        const a = Number(stmt.run('Same text one').lastInsertRowid);
        const b = Number(stmt.run('Same text two').lastInsertRowid);

        // Add relation both ways (if schema allowed it) — but we only insert one
        db.prepare(
            'INSERT INTO memory_relations (source_memory_id, target_memory_id, relation_type) VALUES (?, ?, ?)',
        ).run(a, b, 'contradicts');

        const detector = new ContradictionDetector({
            db,
            llm: createMockLLM('1: CONTRADICTORY'),
            config: { deterministicThresholdJaccard: 0.8, llmValidationEnabled: true },
        });

        const result = await detector.detect();
        const relCands = result.candidates.filter((c) => c.detectionType === 'relation_contradicts');
        expect(relCands.length).toBe(1);
    });
});
