import { describe, it, expect, beforeEach } from '@jest/globals';
import Database from 'better-sqlite3';
import { ProvenanceTracker } from '../../../src/memory/wiki/provenance.js';

describe('ProvenanceTracker', () => {
  let db: Database.Database;
  let tracker: ProvenanceTracker;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        importance INTEGER DEFAULT 5
      );
      CREATE TABLE memory_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        revision_number INTEGER NOT NULL,
        content TEXT NOT NULL,
        category TEXT NOT NULL,
        importance INTEGER NOT NULL,
        provenance_source TEXT,
        provenance_model TEXT,
        provenance_prompt_hash TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_revisions_memory ON memory_revisions(memory_id, revision_number DESC);
    `);
    tracker = new ProvenanceTracker({ db });
  });

  it('stores revisions with auto-incrementing revision_number', () => {
    db.prepare("INSERT INTO memories (content, category, importance) VALUES (?, ?, ?)").run('v0', 'gen', 3);
    const memId = Number((db.prepare("SELECT id FROM memories WHERE content = 'v0'").get() as { id: number }).id);

    tracker.storeRevision(memId, { content: 'v0', category: 'gen', importance: 3 });
    tracker.storeRevision(memId, { content: 'v1', category: 'gen', importance: 4 });

    const revs = tracker.getRevisions(memId);
    expect(revs.length).toBe(2);
    expect(revs[0]!.revisionNumber).toBe(1);
    expect(revs[0]!.content).toBe('v0');
    expect(revs[1]!.revisionNumber).toBe(2);
    expect(revs[1]!.content).toBe('v1');
  });

  it('getLatestRevision returns the most recent', () => {
    db.prepare("INSERT INTO memories (content) VALUES ('base')").run();
    const memId = Number((db.prepare("SELECT id FROM memories").get() as { id: number }).id);

    tracker.storeRevision(memId, { content: 'base', category: 'gen', importance: 5 });
    tracker.storeRevision(memId, { content: 'updated', category: 'gen', importance: 6 }, { provenanceSource: 'user', provenanceModel: 'test-model' });

    const latest = tracker.getLatestRevision(memId);
    expect(latest).not.toBeNull();
    expect(latest!.content).toBe('updated');
    expect(latest!.provenanceSource).toBe('user');
    expect(latest!.provenanceModel).toBe('test-model');
  });

  it('getProvenanceTrace aggregates metadata', () => {
    db.prepare("INSERT INTO memories (content) VALUES ('base')").run();
    const memId = Number(db.prepare("SELECT id FROM memories").get()!.id);

    tracker.storeRevision(memId, { content: 'base', category: 'gen', importance: 5 }, { provenanceSource: 'llm', provenancePromptHash: 'abc123' });

    const trace = tracker.getProvenanceTrace(memId);
    expect(trace.revisionCount).toBe(1);
    expect(trace.source).toBe('llm');
    expect(trace.promptHash).toBe('abc123');
  });

  it('returns empty trace for unknown memory', () => {
    const trace = tracker.getProvenanceTrace(9999);
    expect(trace.revisionCount).toBe(0);
    expect(trace.source).toBeNull();
  });
});
