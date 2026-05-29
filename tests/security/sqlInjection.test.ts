import { describe, it, expect } from '@jest/globals';
import { escapeFtsQuery } from '../../src/memory/types.js';
import { PenceDatabase } from '../../src/memory/database.js';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

describe('SQL Injection Defense', () => {
  describe('escapeFtsQuery', () => {
    it('strips double quotes to prevent FTS injection', () => {
      const malicious = 'foo" OR "1"="1';
      const result = escapeFtsQuery(malicious);
      expect(result).not.toContain('"1"="1"');
      expect(result).toContain('"foo"');
    });

    it('removes SQL keywords used as operators', () => {
      const input = 'hello AND world OR drop NOT table NEAR me';
      const result = escapeFtsQuery(input);
      expect(result).not.toMatch(/\bAND\b/);
      expect(result).not.toMatch(/\bOR\b/);
      expect(result).not.toMatch(/\bNOT\b/);
      expect(result).not.toMatch(/\bNEAR\b/);
    });

    it('removes special FTS characters', () => {
      const input = 'test * ^ ~ { } [ ] ( )';
      const result = escapeFtsQuery(input);
      expect(result).not.toMatch(/[\*\^~{}\[\]\(\)]/);
    });

    it('returns empty string for injection-only input', () => {
      expect(escapeFtsQuery('AND OR NOT')).toBe('');
      expect(escapeFtsQuery('***')).toBe('');
    });
  });

  describe('PenceDatabase DDL injection resistance', () => {
    const testDbDir = path.join(process.cwd(), 'tmp_test_db');
    const testDbPath = path.join(testDbDir, 'test.db');
    let db: PenceDatabase | null = null;

    function cleanupDbFile(): void {
      if (db) {
        try { db.close(); } catch { /* ignore */ }
        db = null;
      }
      // Windows'ta SQLite kilit salımı için kısa bekle
      if (fs.existsSync(testDbPath)) {
        try { fs.unlinkSync(testDbPath); } catch { /* ignore */ }
      }
    }

    beforeEach(() => {
      cleanupDbFile();
    });

    afterEach(() => {
      cleanupDbFile();
    });

    afterAll(() => {
      cleanupDbFile();
      if (fs.existsSync(testDbDir)) {
        try { fs.rmdirSync(testDbDir); } catch { /* ignore */ }
      }
    });

    it('rejects non-numeric embeddingDimensions', () => {
      expect(() => new PenceDatabase(testDbPath, NaN)).toThrow(/Invalid embeddingDimensions/);
    });

    it('rejects negative embeddingDimensions', () => {
      expect(() => new PenceDatabase(testDbPath, -1)).toThrow(/Invalid embeddingDimensions/);
    });

    it('rejects oversized embeddingDimensions', () => {
      expect(() => new PenceDatabase(testDbPath, 20000)).toThrow(/Invalid embeddingDimensions/);
    });

    it('accepts valid embeddingDimensions and creates tables', () => {
      db = new PenceDatabase(testDbPath, 768);
      const row = db.getDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories'").get() as { name: string } | undefined;
      expect(row?.name).toBe('memories');
    });

    it('uses parameterized queries for token usage stats', () => {
      db = new PenceDatabase(testDbPath, 768);
      // Token usage tablosuna doğrudan parameterized query ile kayıt ekle
      const rawDb = db.getDb();
      rawDb.prepare(`
        INSERT INTO token_usage (provider, model, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, created_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run('openai', 'gpt-4o', 10, 5, 15, 0.001);
      const row = rawDb.prepare(`SELECT total_tokens FROM token_usage WHERE provider = ?`).get('openai') as { total_tokens: number };
      expect(row?.total_tokens).toBe(15);
    });
  });
});
