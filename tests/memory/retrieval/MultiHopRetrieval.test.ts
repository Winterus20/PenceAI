/**
 * MultiHopRetrieval Tests
 *
 * Çok adımlı bellek getirme birim testleri.
 */

import { MultiHopRetrieval } from '../../../src/memory/retrieval/MultiHopRetrieval.js';
import type { MemoryRow } from '../../../src/memory/types.js';
import type { LLMProvider } from '../../../src/llm/provider.js';
import type { CritiqueResult } from '../../../src/memory/retrieval/PassageCritique.js';

// LLM Provider mock
function createMockLLMProvider(returns: string[]): LLMProvider {
  let callIndex = 0;
  return {
    chat: jest.fn().mockImplementation(async () => {
      const content = returns[callIndex] || returns[0];
      callIndex++;
      return { content };
    }),
  } as unknown as LLMProvider;
}

function makeMemoryRow(id: number, content: string): MemoryRow {
  return {
    id,
    user_id: 'test',
    content,
    importance: 3,
    access_count: 0,
    is_archived: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    confidence: 0.7,
    memory_type: 'semantic',
    stability: 2.0,
    retrievability: 1.0,
    review_count: 0,
  } as MemoryRow;
}

describe('MultiHopRetrieval', () => {
  let llmProvider: LLMProvider;
  let critiqueFn: jest.MockedFunction<(query: string, passages: MemoryRow[]) => Promise<CritiqueResult>>;
  let multiHop: MultiHopRetrieval;

  beforeEach(() => {
    llmProvider = createMockLLMProvider([
      '<query>refined query about details</query>',
      '<query>even more specific query</query>',
    ]);

    critiqueFn = jest.fn().mockResolvedValue({
      evaluations: [],
      keptCount: 0,
      filteredCount: 0,
      overallCompleteness: 0.4,
      needsMoreRetrieval: false,
      missingInfo: [],
    });

    multiHop = new MultiHopRetrieval(llmProvider, critiqueFn, { maxHops: 3 });
  });

  describe('execute()', () => {
    it('should return initial result when no more retrieval needed', async () => {
      const initialMemories = [makeMemoryRow(1, 'Ankara başkenttir.')];
      const initialCritique: CritiqueResult = {
        evaluations: [],
        keptCount: 1,
        filteredCount: 0,
        overallCompleteness: 0.8,
        needsMoreRetrieval: false,
        missingInfo: [],
      };
      const retrieveFn = jest.fn().mockResolvedValue([]);

      const result = await multiHop.execute('test query', initialMemories, initialCritique, retrieveFn);

      expect(result.memories).toEqual(initialMemories);
      expect(result.hops).toHaveLength(0);
      expect(result.finalCompleteness).toBe(0.8);
      expect(result.exhaustedMaxHops).toBe(false);
      expect(result.totalRetrievalCalls).toBe(1);
      expect(retrieveFn).not.toHaveBeenCalled();
    });

    it('should perform one hop when needsMoreRetrieval is true then satisfied', async () => {
      const initialMemories = [makeMemoryRow(1, 'Partial info')];
      const initialCritique: CritiqueResult = {
        evaluations: [],
        keptCount: 0,
        filteredCount: 1,
        overallCompleteness: 0.3,
        needsMoreRetrieval: true,
        missingInfo: ['details missing'],
      };

      critiqueFn.mockResolvedValueOnce({
        evaluations: [],
        keptCount: 2,
        filteredCount: 0,
        overallCompleteness: 0.7,
        needsMoreRetrieval: false,
        missingInfo: [],
      });

      const newMemories = [makeMemoryRow(2, 'More details'), makeMemoryRow(3, 'Even more')];
      const retrieveFn = jest.fn().mockResolvedValue(newMemories);

      const result = await multiHop.execute('test query', initialMemories, initialCritique, retrieveFn);

      expect(result.hops).toHaveLength(1);
      expect(result.hops[0].hopNumber).toBe(1);
      expect(result.hops[0].resultsCount).toBe(2);
      expect(result.memories).toHaveLength(3);
      expect(result.finalCompleteness).toBe(0.7);
      expect(result.exhaustedMaxHops).toBe(false);
      expect(result.totalRetrievalCalls).toBe(2);
      expect(retrieveFn).toHaveBeenCalledTimes(1);
    });

    it('should perform multiple hops up to maxHops', async () => {
      const initialMemories = [makeMemoryRow(1, 'Initial')];
      const initialCritique: CritiqueResult = {
        evaluations: [],
        keptCount: 0,
        filteredCount: 0,
        overallCompleteness: 0.2,
        needsMoreRetrieval: true,
        missingInfo: ['missing A'],
      };

      // First hop still needs more
      critiqueFn.mockResolvedValueOnce({
        evaluations: [],
        keptCount: 1,
        filteredCount: 0,
        overallCompleteness: 0.4,
        needsMoreRetrieval: true,
        missingInfo: ['missing B'],
      });

      // Second hop satisfied
      critiqueFn.mockResolvedValueOnce({
        evaluations: [],
        keptCount: 2,
        filteredCount: 0,
        overallCompleteness: 0.8,
        needsMoreRetrieval: false,
        missingInfo: [],
      });

      const retrieveFn = jest.fn()
        .mockResolvedValueOnce([makeMemoryRow(2, 'Hop 1 result')])
        .mockResolvedValueOnce([makeMemoryRow(3, 'Hop 2 result')]);

      const result = await multiHop.execute('complex query', initialMemories, initialCritique, retrieveFn);

      expect(result.hops).toHaveLength(2);
      expect(result.hops[0].query).toBe('refined query about details');
      expect(result.hops[1].query).toBe('even more specific query');
      expect(result.memories).toHaveLength(3);
      expect(result.exhaustedMaxHops).toBe(false);
      expect(result.totalRetrievalCalls).toBe(3);
    });

    it('should exhaust max hops when still needsMoreRetrieval', async () => {
      const multiHopLimited = new MultiHopRetrieval(llmProvider, critiqueFn, { maxHops: 2 });

      const initialMemories = [makeMemoryRow(1, 'Initial')];
      const initialCritique: CritiqueResult = {
        evaluations: [],
        keptCount: 0,
        filteredCount: 0,
        overallCompleteness: 0.1,
        needsMoreRetrieval: true,
        missingInfo: ['missing'],
      };

      // All hops still need more retrieval
      critiqueFn.mockResolvedValue({
        evaluations: [],
        keptCount: 0,
        filteredCount: 1,
        overallCompleteness: 0.3,
        needsMoreRetrieval: true,
        missingInfo: ['still missing'],
      });

      const retrieveFn = jest.fn()
        .mockResolvedValueOnce([makeMemoryRow(2, 'Hop 1')])
        .mockResolvedValueOnce([makeMemoryRow(3, 'Hop 2')]);

      const result = await multiHopLimited.execute('query', initialMemories, initialCritique, retrieveFn);

      expect(result.hops).toHaveLength(2);
      expect(result.exhaustedMaxHops).toBe(true);
    });

    it('should deduplicate memories by ID across hops', async () => {
      const initialMemories = [makeMemoryRow(1, 'Initial'), makeMemoryRow(2, 'Existing')];
      const initialCritique: CritiqueResult = {
        evaluations: [],
        keptCount: 0,
        filteredCount: 0,
        overallCompleteness: 0.3,
        needsMoreRetrieval: true,
        missingInfo: ['more needed'],
      };

      critiqueFn.mockResolvedValueOnce({
        evaluations: [],
        keptCount: 1,
        filteredCount: 0,
        overallCompleteness: 0.7,
        needsMoreRetrieval: false,
        missingInfo: [],
      });

      // Returns overlapping IDs
      const retrieveFn = jest.fn().mockResolvedValueOnce([
        makeMemoryRow(2, 'Duplicate'),
        makeMemoryRow(3, 'New'),
      ]);

      const result = await multiHop.execute('query', initialMemories, initialCritique, retrieveFn);

      expect(result.memories).toHaveLength(3);
      expect(result.memories.map(m => m.id)).toEqual([1, 2, 3]);
    });

    it('should use escalating retriever strategies per hop', async () => {
      const initialMemories: MemoryRow[] = [];
      const initialCritique: CritiqueResult = {
        evaluations: [],
        keptCount: 0,
        filteredCount: 0,
        overallCompleteness: 0.2,
        needsMoreRetrieval: true,
        missingInfo: ['missing'],
      };

      critiqueFn.mockResolvedValueOnce({
        evaluations: [],
        keptCount: 0,
        filteredCount: 0,
        overallCompleteness: 0.3,
        needsMoreRetrieval: true,
        missingInfo: ['still missing'],
      }).mockResolvedValueOnce({
        evaluations: [],
        keptCount: 1,
        filteredCount: 0,
        overallCompleteness: 0.8,
        needsMoreRetrieval: false,
        missingInfo: [],
      });

      const retrieveFn = jest.fn()
        .mockResolvedValueOnce([makeMemoryRow(1, 'Hop 1')])
        .mockResolvedValueOnce([makeMemoryRow(2, 'Hop 2')]);

      await multiHop.execute('query', initialMemories, initialCritique, retrieveFn);

      expect(retrieveFn).toHaveBeenCalledTimes(2);
      expect(retrieveFn).toHaveBeenNthCalledWith(1, expect.any(String), ['system2']);
      expect(retrieveFn).toHaveBeenNthCalledWith(2, expect.any(String), ['graphRAG']);
    });

    it('should handle empty initial memories', async () => {
      const initialCritique: CritiqueResult = {
        evaluations: [],
        keptCount: 0,
        filteredCount: 0,
        overallCompleteness: 0,
        needsMoreRetrieval: true,
        missingInfo: ['nothing found'],
      };

      critiqueFn.mockResolvedValueOnce({
        evaluations: [],
        keptCount: 1,
        filteredCount: 0,
        overallCompleteness: 0.7,
        needsMoreRetrieval: false,
        missingInfo: [],
      });

      const retrieveFn = jest.fn().mockResolvedValueOnce([makeMemoryRow(1, 'Found something')]);

      const result = await multiHop.execute('query', [], initialCritique, retrieveFn);

      expect(result.hops).toHaveLength(1);
      expect(result.memories).toHaveLength(1);
    });

    it('should use fallback query when LLM fails', async () => {
      const failingLLM = {
        chat: jest.fn().mockRejectedValue(new Error('LLM error')),
      } as unknown as LLMProvider;

      const multiHopWithFallback = new MultiHopRetrieval(failingLLM, critiqueFn, { maxHops: 1 });

      const initialMemories: MemoryRow[] = [];
      const initialCritique: CritiqueResult = {
        evaluations: [],
        keptCount: 0,
        filteredCount: 0,
        overallCompleteness: 0,
        needsMoreRetrieval: true,
        missingInfo: ['missing'],
      };

      critiqueFn.mockResolvedValueOnce({
        evaluations: [],
        keptCount: 0,
        filteredCount: 0,
        overallCompleteness: 0.5,
        needsMoreRetrieval: false,
        missingInfo: [],
      });

      const retrieveFn = jest.fn().mockResolvedValueOnce([makeMemoryRow(1, 'Result')]);

      const result = await multiHopWithFallback.execute('original query', initialMemories, initialCritique, retrieveFn);

      expect(result.hops).toHaveLength(1);
      expect(result.hops[0].query).toContain('original query');
      expect(result.hops[0].query).toContain('more details');
    });
  });
});
