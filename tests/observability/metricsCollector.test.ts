/**
 * Metrics Collector Tests
 * 
 * SQLite tabanlı metrics toplama ve sorgulama birim testleri.
 */

import { metricsCollector, type MessageMetrics } from '../../src/observability/metricsCollector.js';
import Database from 'better-sqlite3';

// In-memory database oluştur
function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      message_id TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      performance_json TEXT NOT NULL,
      cost_json TEXT NOT NULL,
      context_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_metrics_conversation ON metrics(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp);
    CREATE INDEX IF NOT EXISTS idx_metrics_message ON metrics(message_id);
  `);
  return db;
}

// Helper: Test metrics verisi oluştur
function createTestMetrics(overrides: Partial<MessageMetrics> = {}): MessageMetrics {
  return {
    conversationId: 'test-conv-1',
    messageId: 'test-msg-1',
    timestamp: new Date().toISOString(),
    performance: {
      total: 1500,
      retrieval: 200,
      graphRAG: 100,
      llmCalls: [
        { key: 'gpt-4o', ms: 800, inputTokens: 500, outputTokens: 300, cost: 0.012 },
        { key: 'gpt-4o', ms: 400, inputTokens: 300, outputTokens: 200, cost: 0.009 }
      ],
      agentic: { retrievalDecision: 50, passageCritique: 30, responseVerification: 20 },
      tools: 150,
      toolCalls: 2,
    },
    cost: {
      total: 0.021,
      totalTokens: 1300,
      promptTokens: 800,
      completionTokens: 500,
    },
    context: {
      historyTokens: 2000,
      userMessageTokens: 100,
      systemPromptTokens: 500,
    },
    ...overrides,
  };
}

// Test dosyası
describe('MetricsCollector', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    metricsCollector.setDatabase(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('recordMetrics()', () => {
    it('should record metrics to SQLite successfully', async () => {
      const metrics = createTestMetrics();
      await metricsCollector.recordMetrics(metrics);

      const row = db.prepare('SELECT COUNT(*) as count FROM metrics').get() as { count: number };
      expect(row.count).toBe(1);
    });

    it('should store all fields correctly', async () => {
      const metrics = createTestMetrics();
      await metricsCollector.recordMetrics(metrics);

      const row = db.prepare('SELECT * FROM metrics LIMIT 1').get() as Record<string, unknown>;
      expect(row.conversation_id).toBe('test-conv-1');
      expect(row.message_id).toBe('test-msg-1');
      
      const perf = JSON.parse(row.performance_json as string);
      expect(perf.total).toBe(1500);
      expect(perf.llmCalls).toHaveLength(2);

      const cost = JSON.parse(row.cost_json as string);
      expect(cost.total).toBe(0.021);
      expect(cost.totalTokens).toBe(1300);
    });

    it('should handle null messageId', async () => {
      const metrics = createTestMetrics({ messageId: undefined });
      await metricsCollector.recordMetrics(metrics);

      const row = db.prepare('SELECT message_id FROM metrics LIMIT 1').get() as { message_id: string | null };
      expect(row.message_id).toBeNull();
    });

    it('should handle errors gracefully', async () => {
      metricsCollector.setDatabase(null as unknown as Database.Database);
      
      // Hata loglanmalı, exception fırlatmamalı
      await expect(metricsCollector.recordMetrics(createTestMetrics())).resolves.not.toThrow();
    });
  });

  describe('getConversationMetrics()', () => {
    it('should return metrics for a specific conversation', async () => {
      await metricsCollector.recordMetrics(createTestMetrics({ conversationId: 'conv-1' }));
      await metricsCollector.recordMetrics(createTestMetrics({ conversationId: 'conv-1', messageId: 'msg-2' }));
      await metricsCollector.recordMetrics(createTestMetrics({ conversationId: 'conv-2' }));

      const results = metricsCollector.getConversationMetrics('conv-1');
      expect(results).toHaveLength(2);
      expect(results[0].conversationId).toBe('conv-1');
    });

    it('should return empty array for non-existent conversation', () => {
      const results = metricsCollector.getConversationMetrics('non-existent');
      expect(results).toEqual([]);
    });

    it('should order by timestamp DESC', async () => {
      const now = new Date();
      await metricsCollector.recordMetrics(createTestMetrics({ 
        conversationId: 'conv-1', 
        timestamp: new Date(now.getTime() - 1000).toISOString(),
        messageId: 'old'
      }));
      await metricsCollector.recordMetrics(createTestMetrics({ 
        conversationId: 'conv-1', 
        timestamp: now.toISOString(),
        messageId: 'new'
      }));

      const results = metricsCollector.getConversationMetrics('conv-1');
      expect(results[0].messageId).toBe('new');
      expect(results[1].messageId).toBe('old');
    });
  });

  describe('getAllMetrics()', () => {
    it('should return all metrics with limit', async () => {
      for (let i = 0; i < 5; i++) {
        await metricsCollector.recordMetrics(createTestMetrics({ messageId: `msg-${i}` }));
      }

      const results = metricsCollector.getAllMetrics(3);
      expect(results).toHaveLength(3);
    });

    it('should order by timestamp DESC', async () => {
      const now = new Date();
      await metricsCollector.recordMetrics(createTestMetrics({ timestamp: new Date(now.getTime() - 2000).toISOString(), messageId: 'oldest' }));
      await metricsCollector.recordMetrics(createTestMetrics({ timestamp: new Date(now.getTime() - 1000).toISOString(), messageId: 'older' }));
      await metricsCollector.recordMetrics(createTestMetrics({ timestamp: now.toISOString(), messageId: 'newest' }));

      const results = metricsCollector.getAllMetrics(10);
      expect(results[0].messageId).toBe('newest');
      expect(results[2].messageId).toBe('oldest');
    });
  });

  describe('getAggregatedMetrics()', () => {
    beforeEach(async () => {
      for (let i = 0; i < 3; i++) {
        await metricsCollector.recordMetrics(createTestMetrics({ messageId: `msg-${i}` }));
      }
    });

    it('should calculate correct totals', () => {
      const agg = metricsCollector.getAggregatedMetrics(1);
      
      expect(agg.totalQueries).toBe(3);
      expect(agg.totalTokens).toBe(1300 * 3);
      expect(agg.totalCost).toBeCloseTo(0.021 * 3, 4);
    });

    it('should calculate correct averages', () => {
      const agg = metricsCollector.getAggregatedMetrics(1);
      
      expect(agg.avgResponseTime).toBe(1500);
      expect(agg.avgTokensPerQuery).toBe(1300);
    });

    it('should calculate provider breakdown correctly', () => {
      const agg = metricsCollector.getAggregatedMetrics(1);
      
      expect(agg.byProvider['gpt-4o']).toBeDefined();
      expect(agg.byProvider['gpt-4o'].calls).toBe(6); // 2 per metrics * 3 entries
      expect(agg.byProvider['gpt-4o'].totalTime).toBe(1200 * 3); // 800+400 per metrics * 3
    });

    it('should return empty metrics when no data', () => {
      const emptyDb = new Database(':memory:');
      emptyDb.exec(`
        CREATE TABLE IF NOT EXISTS metrics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id TEXT NOT NULL,
          message_id TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          performance_json TEXT NOT NULL,
          cost_json TEXT NOT NULL,
          context_json TEXT
        );
      `);
      metricsCollector.setDatabase(emptyDb);

      const agg = metricsCollector.getAggregatedMetrics(1);
      expect(agg.totalQueries).toBe(0);
      expect(agg.totalTokens).toBe(0);
      expect(agg.totalCost).toBe(0);
      
      emptyDb.close();
    });
  });

  describe('getProviderStats()', () => {
    beforeEach(async () => {
      await metricsCollector.recordMetrics(createTestMetrics({ messageId: 'msg-1' }));
      await metricsCollector.recordMetrics(createTestMetrics({ messageId: 'msg-2' }));
    });

    it('should return correct provider counts', () => {
      const stats = metricsCollector.getProviderStats(7);
      
      expect(stats['gpt-4o']).toBeDefined();
      expect(stats['gpt-4o'].count).toBe(4); // 2 per metrics * 2 entries
    });

    it('should calculate average latency correctly', () => {
      const stats = metricsCollector.getProviderStats(7);
      
      expect(stats['gpt-4o'].avgLatency).toBe(600); // (800+400)/2
    });
  });

  describe('getErrorStats()', () => {
    it('should return placeholder values', () => {
      const stats = metricsCollector.getErrorStats();
      
      expect(stats.totalTraces).toBe(0);
      expect(stats.errorTraces).toBe(0);
      expect(stats.errorRate).toBe(0);
    });
  });

  describe('database not initialized', () => {
    it('should return empty array when database is not set', () => {
      metricsCollector.setDatabase(null as unknown as Database.Database);

      // getConversationMetrics DB yokken graceful şekilde empty array döndürür
      const results = metricsCollector.getConversationMetrics('test');
      expect(results).toEqual([]);
    });

    it('should return empty aggregated metrics when database is not set', () => {
      metricsCollector.setDatabase(null as unknown as Database.Database);

      const agg = metricsCollector.getAggregatedMetrics(1);
      expect(agg.totalQueries).toBe(0);
      expect(agg.totalTokens).toBe(0);
      expect(agg.totalCost).toBe(0);
    });

    it('should return empty provider stats when database is not set', () => {
      metricsCollector.setDatabase(null as unknown as Database.Database);

      const stats = metricsCollector.getProviderStats(7);
      expect(stats).toEqual({});
    });
  });
});
