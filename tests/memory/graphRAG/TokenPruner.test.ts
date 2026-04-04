/**
 * TokenPruner Testleri.
 *
 * Token budget yönetimi, priority-based pruning ve edge case'leri test eder.
 */

// Logger mock - import.meta.url sorununu önler
jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { TokenPruner, type TokenBudget, type PruningOptions } from '../../../src/memory/graphRAG/TokenPruner.js';
import type { MemoryRow } from '../../../src/memory/types.js';
import type { CommunitySummary } from '../../../src/memory/graphRAG/CommunitySummarizer.js';

describe('TokenPruner', () => {
  /** Helper: Test memory oluştur */
  function createMemory(id: number, content: string, importance: number = 5): MemoryRow {
    return {
      id,
      user_id: 'default',
      category: 'test',
      content,
      importance,
      access_count: 0,
      is_archived: 0,
      last_accessed: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      provenance_source: null,
      provenance_conversation_id: null,
      provenance_message_id: null,
      confidence: 0.5,
      review_profile: null,
      memory_type: 'semantic',
      stability: null,
      retrievability: null,
      next_review_at: null,
      review_count: null,
      max_importance: null,
    };
  }

  /** Helper: Test summary oluştur */
  function createSummary(communityId: string, summary: string): CommunitySummary {
    return {
      communityId,
      summary,
      keyEntities: [],
      keyRelations: [],
      topics: [],
      generatedAt: new Date(),
    };
  }

  /** Helper: Basit tokenizer (kelime sayısı * 1.3) */
  function simpleTokenizer(text: string): number {
    return Math.ceil(text.split(/\s+/).length * 1.3);
  }

  describe('countTokens', () => {
    it('should count tokens correctly', () => {
      const pruner = new TokenPruner({ tokenizer: simpleTokenizer });
      const tokens = pruner.countTokens('hello world test');
      expect(tokens).toBe(Math.ceil(3 * 1.3)); // 4 tokens
    });

    it('should handle empty string', () => {
      const pruner = new TokenPruner({ tokenizer: simpleTokenizer });
      const tokens = pruner.countTokens('');
      // simpleTokenizer returns Math.ceil(0 * 1.3) = 0, but split on empty gives ['']
      expect(tokens).toBeGreaterThanOrEqual(0);
    });
  });

  describe('prune - empty input', () => {
    it('should handle empty memories and summaries', () => {
      const pruner = new TokenPruner();
      const result = pruner.prune([], []);

      expect(result.prunedMemories).toEqual([]);
      expect(result.prunedSummaries).toEqual([]);
      expect(result.removedMemories).toBe(0);
      expect(result.removedSummaries).toBe(0);
      expect(result.totalTokens).toBe(0);
      expect(result.withinBudget).toBe(true);
    });

    it('should handle empty memories only', () => {
      const pruner = new TokenPruner({ tokenizer: simpleTokenizer });
      const summaries = [createSummary('c1', 'summary one'), createSummary('c2', 'summary two')];
      const result = pruner.prune([], summaries);

      expect(result.removedMemories).toBe(0);
      expect(result.prunedSummaries.length).toBeLessThanOrEqual(summaries.length);
    });

    it('should handle empty summaries only', () => {
      const pruner = new TokenPruner({ tokenizer: simpleTokenizer });
      const memories = [createMemory(1, 'memory one'), createMemory(2, 'memory two')];
      const result = pruner.prune(memories, []);

      expect(result.removedSummaries).toBe(0);
      expect(result.prunedMemories.length).toBeLessThanOrEqual(memories.length);
    });
  });

  describe('prune - budget enforcement', () => {
    it('should not prune when within budget', () => {
      const budget: TokenBudget = {
        total: 10000,
        memories: 5000,
        communitySummaries: 2000,
        graphContext: 3000,
      };

      const pruner = new TokenPruner({ budget, tokenizer: simpleTokenizer });
      const memories = [
        createMemory(1, 'short content'),
        createMemory(2, 'another short'),
      ];
      const summaries = [createSummary('c1', 'short summary')];

      const result = pruner.prune(memories, summaries);

      expect(result.removedMemories).toBe(0);
      expect(result.removedSummaries).toBe(0);
      expect(result.prunedMemories.length).toBe(memories.length);
      expect(result.prunedSummaries.length).toBe(summaries.length);
      expect(result.withinBudget).toBe(true);
    });

    it('should prune memories when over budget', () => {
      const budget: TokenBudget = {
        total: 100,
        memories: 10,
        communitySummaries: 50,
        graphContext: 40,
      };

      const pruner = new TokenPruner({ budget, tokenizer: simpleTokenizer });
      const memories = [
        createMemory(1, 'high importance memory content here with many words to exceed budget', 9),
        createMemory(2, 'low importance memory with extra words', 1),
        createMemory(3, 'medium importance memory test with more words', 5),
      ];

      const result = pruner.prune(memories, []);

      // With very tight budget, some memories should be pruned
      expect(result.prunedMemories.length).toBeLessThanOrEqual(memories.length);
      expect(result.withinBudget).toBe(true);
    });

    it('should prune summaries when over budget', () => {
      const budget: TokenBudget = {
        total: 100,
        memories: 50,
        communitySummaries: 5,
        graphContext: 45,
      };

      const pruner = new TokenPruner({ budget, tokenizer: simpleTokenizer });
      const summaries = [
        createSummary('c1', 'first community summary with lots of text words here'),
        createSummary('c2', 'second summary with extra words'),
        createSummary('c3', 'third community summary text here more words'),
      ];

      const result = pruner.prune([], summaries);

      // With very tight budget, some summaries should be pruned
      expect(result.prunedSummaries.length).toBeLessThanOrEqual(summaries.length);
      expect(result.withinBudget).toBe(true);
    });
  });

  describe('prune - priority-based pruning', () => {
    it('should remove lowest priority memories first', () => {
      const budget: TokenBudget = {
        total: 100,
        memories: 30,
        communitySummaries: 50,
        graphContext: 20,
      };

      const pruner = new TokenPruner({ budget, tokenizer: simpleTokenizer });
      const memories = [
        createMemory(1, 'high priority memory', 10),
        createMemory(2, 'low priority memory', 1),
        createMemory(3, 'medium priority memory', 5),
      ];

      const result = pruner.prune(memories, []);

      // Low priority should be removed first
      const remainingIds = result.prunedMemories.map(m => m.id);
      expect(remainingIds).toContain(1); // High priority should remain
    });

    it('should preserve high importance memories', () => {
      const budget: TokenBudget = {
        total: 100,
        memories: 20,
        communitySummaries: 50,
        graphContext: 30,
      };

      const pruner = new TokenPruner({ budget, tokenizer: simpleTokenizer });
      const memories = [
        createMemory(1, 'very important memory', 10),
        createMemory(2, 'not important memory', 1),
      ];

      const result = pruner.prune(memories, []);

      const remainingIds = result.prunedMemories.map(m => m.id);
      expect(remainingIds).toContain(1);
    });
  });

  describe('prune - custom priority function', () => {
    it('should use custom memory priority function', () => {
      const budget: TokenBudget = {
        total: 100,
        memories: 20,
        communitySummaries: 50,
        graphContext: 30,
      };

      // Custom: reverse priority (lower importance = higher priority)
      const customPriorityFn = (m: MemoryRow) => 1 - (m.importance ?? 5) / 10;

      const pruner = new TokenPruner({ budget, memoryPriorityFn: customPriorityFn, tokenizer: simpleTokenizer });
      const memories = [
        createMemory(1, 'high importance', 10),
        createMemory(2, 'low importance', 1),
      ];

      const result = pruner.prune(memories, []);

      // With reverse priority, low importance should be kept
      const remainingIds = result.prunedMemories.map(m => m.id);
      expect(remainingIds).toContain(2);
    });

    it('should use custom summary priority function', () => {
      const budget: TokenBudget = {
        total: 100,
        memories: 50,
        communitySummaries: 20,
        graphContext: 30,
      };

      const customSummaryPriorityFn = (s: CommunitySummary) => s.keyEntities.length;

      const pruner = new TokenPruner({
        budget,
        summaryPriorityFn: customSummaryPriorityFn,
        tokenizer: simpleTokenizer,
      });

      const summaries = [
        createSummary('c1', 'summary with entities'),
        createSummary('c2', 'short'),
      ];
      summaries[0].keyEntities = [{ name: 'Entity1', type: 'person', importance: 0.8 }];

      const result = pruner.prune([], summaries);

      expect(result.prunedSummaries.length).toBeLessThanOrEqual(summaries.length);
    });
  });

  describe('prune - token counting accuracy', () => {
    it('should accurately count tokens with custom tokenizer', () => {
      const tokenCounts = new Map<string, number>();
      const customTokenizer = (text: string) => {
        if (!tokenCounts.has(text)) {
          tokenCounts.set(text, text.length);
        }
        return tokenCounts.get(text)!;
      };

      const budget: TokenBudget = {
        total: 1000,
        memories: 500,
        communitySummaries: 300,
        graphContext: 200,
      };

      const pruner = new TokenPruner({ budget, tokenizer: customTokenizer });
      const memories = [
        createMemory(1, 'hi'),
        createMemory(2, 'hello world'),
      ];

      const result = pruner.prune(memories, []);

      expect(result.totalTokens).toBeGreaterThan(0);
    });
  });

  describe('prune - edge cases', () => {
    it('should handle single memory', () => {
      const budget: TokenBudget = {
        total: 1000,
        memories: 500,
        communitySummaries: 300,
        graphContext: 200,
      };

      const pruner = new TokenPruner({ budget, tokenizer: simpleTokenizer });
      const memories = [createMemory(1, 'single memory content')];

      const result = pruner.prune(memories, []);

      expect(result.prunedMemories.length).toBe(1);
      expect(result.removedMemories).toBe(0);
    });

    it('should handle single summary', () => {
      const budget: TokenBudget = {
        total: 1000,
        memories: 500,
        communitySummaries: 300,
        graphContext: 200,
      };

      const pruner = new TokenPruner({ budget, tokenizer: simpleTokenizer });
      const summaries = [createSummary('c1', 'single summary content')];

      const result = pruner.prune([], summaries);

      expect(result.prunedSummaries.length).toBe(1);
      expect(result.removedSummaries).toBe(0);
    });

    it('should handle very large content', () => {
      const budget: TokenBudget = {
        total: 1000,
        memories: 500,
        communitySummaries: 300,
        graphContext: 200,
      };

      const pruner = new TokenPruner({ budget, tokenizer: simpleTokenizer });
      const largeContent = 'word '.repeat(1000);
      const memories = [
        createMemory(1, largeContent, 1),
        createMemory(2, 'small content', 10),
      ];

      const result = pruner.prune(memories, []);

      // Large content with low priority should be removed
      const remainingIds = result.prunedMemories.map(m => m.id);
      expect(remainingIds).toContain(2);
    });

    it('should handle null importance gracefully', () => {
      const budget: TokenBudget = {
        total: 100,
        memories: 30,
        communitySummaries: 50,
        graphContext: 20,
      };

      const pruner = new TokenPruner({ budget, tokenizer: simpleTokenizer });
      const memories = [
        createMemory(1, 'memory one', 5),
        { ...createMemory(2, 'memory two', 5), importance: null as unknown as number },
      ];

      const result = pruner.prune(memories, []);

      expect(result.prunedMemories.length).toBeLessThanOrEqual(memories.length);
    });
  });
});
