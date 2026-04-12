/**
 * PassageCritique Tests
 *
 * Metin parçaları eleştirel değerlendirme birim testleri.
 */

import { PassageCritique } from '../../../src/memory/retrieval/PassageCritique.js';
import type { MemoryRow } from '../../../src/memory/types.js';
import type { LLMProvider } from '../../../src/llm/provider.js';

function makeMemoryRow(id: number, content: string, category = 'general'): MemoryRow {
  return {
    id,
    user_id: 'test',
    content,
    category,
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

function createMockLLMProvider(responseContent: string): LLMProvider {
  return {
    chat: jest.fn().mockResolvedValue({ content: responseContent }),
  } as unknown as LLMProvider;
}

describe('PassageCritique', () => {
  let critique: PassageCritique;

  describe('evaluate()', () => {
    it('should evaluate passages with high relevance', async () => {
      const llmResponse = JSON.stringify([
        {
          memoryId: 1,
          relevance: 'Relevant',
          relevanceScore: 0.9,
          completeness: 'Complete',
          completenessScore: 0.85,
          issues: [],
          keep: true,
        },
      ]);
      const llmProvider = createMockLLMProvider(llmResponse);
      critique = new PassageCritique(llmProvider);

      const passages = [makeMemoryRow(1, "Türkiye'nin başkenti Ankara'dır.")];
      const result = await critique.evaluate('Türkiye başkent', passages);

      expect(result.evaluations).toHaveLength(1);
      expect(result.evaluations[0].relevance).toBe('Relevant');
      expect(result.evaluations[0].relevanceScore).toBe(0.9);
      expect(result.keptCount).toBe(1);
      expect(result.overallCompleteness).toBe(0.85);
      expect(result.needsMoreRetrieval).toBe(false);
    });

    it('should filter out low relevance passages', async () => {
      const llmResponse = JSON.stringify([
        {
          memoryId: 1,
          relevance: 'Irrelevant',
          relevanceScore: 0.2,
          completeness: 'Insufficient',
          completenessScore: 0.1,
          issues: ['Not related to query'],
          keep: false,
        },
      ]);
      const llmProvider = createMockLLMProvider(llmResponse);
      critique = new PassageCritique(llmProvider);

      const passages = [makeMemoryRow(1, 'Kediler evcil hayvanlardır.')];
      const result = await critique.evaluate('programlama dilleri', passages);

      expect(result.evaluations[0].keep).toBe(false);
      expect(result.keptCount).toBe(0);
      expect(result.filteredCount).toBe(1);
      expect(result.needsMoreRetrieval).toBe(true);
    });

    it('should handle empty passages list', async () => {
      const llmProvider = createMockLLMProvider('[]');
      critique = new PassageCritique(llmProvider);

      const result = await critique.evaluate('test query', []);

      expect(result.evaluations).toHaveLength(0);
      expect(result.keptCount).toBe(0);
      expect(result.overallCompleteness).toBe(0);
      expect(result.needsMoreRetrieval).toBe(true);
      expect(result.missingInfo).toContain('No passages retrieved');
    });

    it('should calculate completeness scores correctly', async () => {
      const llmResponse = JSON.stringify([
        {
          memoryId: 1,
          relevance: 'Relevant',
          relevanceScore: 0.8,
          completeness: 'Partial',
          completenessScore: 0.5,
          issues: ['Missing specifics'],
          keep: true,
        },
        {
          memoryId: 2,
          relevance: 'Relevant',
          relevanceScore: 0.85,
          completeness: 'Complete',
          completenessScore: 0.9,
          issues: [],
          keep: true,
        },
      ]);
      const llmProvider = createMockLLMProvider(llmResponse);
      critique = new PassageCritique(llmProvider);

      const passages = [
        makeMemoryRow(1, 'Ankara başkenttir.'),
        makeMemoryRow(2, 'Ankara Türkiye\'nin başkentidir, 2023 nüfusu 5.8 milyondur.'),
      ];
      const result = await critique.evaluate('Ankara hakkında bilgi ver', passages);

      expect(result.evaluations).toHaveLength(2);
      expect(result.evaluations[0].completenessScore).toBe(0.5);
      expect(result.evaluations[1].completenessScore).toBe(0.9);
      expect(result.overallCompleteness).toBeCloseTo(0.7, 1);
    });

    it('should handle LLM response parse failure gracefully', async () => {
      const llmProvider = createMockLLMProvider('invalid json response');
      critique = new PassageCritique(llmProvider);

      const passages = [makeMemoryRow(1, 'Some content')];
      const result = await critique.evaluate('test', passages);

      expect(result.evaluations).toHaveLength(1);
      expect(result.evaluations[0].keep).toBe(true);
      expect(result.evaluations[0].relevanceScore).toBe(0.5);
      expect(result.evaluations[0].completenessScore).toBe(0.5);
      expect(result.keptCount).toBe(1);
    });

    it('should handle malformed JSON array gracefully', async () => {
      const llmProvider = createMockLLMProvider('not an array but { valid json }');
      critique = new PassageCritique(llmProvider);

      const passages = [makeMemoryRow(1, 'Test passage')];
      const result = await critique.evaluate('query', passages);

      expect(result.evaluations).toHaveLength(1);
      expect(result.evaluations[0].keep).toBe(true);
    });

    it('should extract missing info when all passages rejected', async () => {
      const llmResponse = JSON.stringify([
        {
          memoryId: 1,
          relevance: 'Irrelevant',
          relevanceScore: 0.1,
          completeness: 'Insufficient',
          completenessScore: 0.1,
          issues: ['Wrong topic'],
          keep: false,
        },
      ]);
      const llmProvider = createMockLLMProvider(llmResponse);
      critique = new PassageCritique(llmProvider);

      const passages = [makeMemoryRow(1, 'Irrelevant content')];
      const result = await critique.evaluate('specific question about TypeScript', passages);

      expect(result.keptCount).toBe(0);
      expect(result.needsMoreRetrieval).toBe(true);
      expect(result.missingInfo.length).toBeGreaterThan(0);
    });

    it('should detect when all kept passages are only partially relevant', async () => {
      const llmResponse = JSON.stringify([
        {
          memoryId: 1,
          relevance: 'PartiallyRelevant',
          relevanceScore: 0.6,
          completeness: 'Partial',
          completenessScore: 0.4,
          issues: ['Tangential'],
          keep: true,
        },
      ]);
      const llmProvider = createMockLLMProvider(llmResponse);
      critique = new PassageCritique(llmProvider);

      const passages = [makeMemoryRow(1, 'Somewhat related content')];
      const result = await critique.evaluate('specific query', passages);

      expect(result.needsMoreRetrieval).toBe(true);
      expect(result.missingInfo.some(m => m.includes('partially relevant'))).toBe(true);
    });

    it('should limit passages to maxPassagesPerCritique', async () => {
      const llmProvider = createMockLLMProvider('[]');
      critique = new PassageCritique(llmProvider, { maxPassagesPerCritique: 3 });

      const passages = Array.from({ length: 10 }, (_, i) => makeMemoryRow(i + 1, `Content ${i}`));
      await critique.evaluate('test', passages);

      const chatCall = (llmProvider.chat as jest.Mock).mock.calls[0];
      // chat is called with [messagesArray, options]
      const messages = chatCall[0];
      const userMessage = messages.find((m: { role: string }) => m.role === 'user');
      expect(userMessage).toBeDefined();
      // Only first 3 passages should be included
      expect(userMessage.content).toContain('[Passage 1]');
      expect(userMessage.content).toContain('[Passage 3]');
      expect(userMessage.content).not.toContain('[Passage 4]');
    });

    it('should normalize relevanceScore and completenessScore to 0-1 range', async () => {
      const llmResponse = JSON.stringify([
        {
          memoryId: 1,
          relevance: 'Relevant',
          relevanceScore: 1.5,
          completeness: 'Complete',
          completenessScore: -0.3,
          issues: [],
          keep: true,
        },
      ]);
      const llmProvider = createMockLLMProvider(llmResponse);
      critique = new PassageCritique(llmProvider);

      const passages = [makeMemoryRow(1, 'Test')];
      const result = await critique.evaluate('query', passages);

      expect(result.evaluations[0].relevanceScore).toBeLessThanOrEqual(1);
      expect(result.evaluations[0].relevanceScore).toBeGreaterThanOrEqual(0);
      expect(result.evaluations[0].completenessScore).toBeGreaterThanOrEqual(0);
      expect(result.evaluations[0].completenessScore).toBeLessThanOrEqual(1);
    });

    it('should handle very long passage content', async () => {
      const longContent = 'a'.repeat(5000);
      const llmResponse = JSON.stringify([
        {
          memoryId: 1,
          relevance: 'PartiallyRelevant',
          relevanceScore: 0.5,
          completeness: 'Partial',
          completenessScore: 0.5,
          issues: ['Very long passage'],
          keep: true,
        },
      ]);
      const llmProvider = createMockLLMProvider(llmResponse);
      critique = new PassageCritique(llmProvider);

      const passages = [makeMemoryRow(1, longContent)];
      const result = await critique.evaluate('test', passages);

      expect(result.evaluations).toHaveLength(1);
      expect(result.evaluations[0].keep).toBe(true);
    });

    it('should apply config floors for keep decision', async () => {
      const llmResponse = JSON.stringify([
        {
          memoryId: 1,
          relevance: 'Relevant',
          relevanceScore: 0.6,
          completeness: 'Partial',
          completenessScore: 0.2,
          issues: [],
          keep: true,
        },
      ]);
      const llmProvider = createMockLLMProvider(llmResponse);
      critique = new PassageCritique(llmProvider, { completenessFloor: 0.3 });

      const passages = [makeMemoryRow(1, 'Some content')];
      const result = await critique.evaluate('query', passages);

      expect(result.evaluations[0].keep).toBe(false);
      expect(result.filteredCount).toBe(1);
    });
  });
});
