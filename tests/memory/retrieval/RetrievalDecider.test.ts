/**
 * RetrievalDecider Tests
 *
 * Retrieval karar mekanizması birim testleri.
 */

import { RetrievalDecider } from '../../../src/memory/retrieval/RetrievalDecider.js';
import type { LLMProvider } from '../../../src/llm/provider.js';
import type { RetrievalIntentSignals } from '../../../src/memory/retrieval/types.js';

function makeSignals(overrides: Partial<RetrievalIntentSignals> = {}): RetrievalIntentSignals {
  return {
    hasQuestion: false,
    hasPreferenceCue: false,
    hasFollowUpCue: false,
    hasRecallCue: false,
    hasConstraintCue: false,
    hasRecentContext: false,
    hasAnalyticalCue: false,
    hasExploratoryCue: false,
    hasPersonalReference: false,
    hasContextualQuestion: false,
    queryLength: 50,
    clauseCount: 1,
    ...overrides,
  };
}

function createMockLLMProvider(responseContent: string): LLMProvider {
  return {
    chat: jest.fn().mockResolvedValue({ content: responseContent }),
  } as unknown as LLMProvider;
}

describe('RetrievalDecider', () => {
  let decider: RetrievalDecider;

  describe('decide()', () => {
    it('should decide to retrieve when LLM says Retrieve', async () => {
      const llmResponse = `<decision>Retrieve</decision>
<confidence>0.85</confidence>
<reason>User is asking about personal information</reason>
<retrievers>system2, memory</retrievers>`;
      const llmProvider = createMockLLMProvider(llmResponse);
      decider = new RetrievalDecider(llmProvider);

      const signals = makeSignals({ hasRecallCue: true });
      const result = await decider.decide('What did we discuss yesterday?', signals, []);

      expect(result.needsRetrieval).toBe(true);
      expect(result.confidence).toBe(0.85);
      expect(result.reason).toContain('personal information');
      expect(result.suggestedRetrievers).toContain('system2');
      expect(result.suggestedRetrievers).toContain('memory');
    });

    it('should decide not to retrieve when LLM says NoRetrieve', async () => {
      const llmResponse = `<decision>NoRetrieve</decision>
<confidence>0.9</confidence>
<reason>General knowledge question that any LLM can answer</reason>
<retrievers></retrievers>`;
      const llmProvider = createMockLLMProvider(llmResponse);
      decider = new RetrievalDecider(llmProvider);

      const signals = makeSignals();
      const result = await decider.decide('What is the capital of France?', signals, []);

      expect(result.needsRetrieval).toBe(false);
      expect(result.confidence).toBe(0.9);
      // Default retriever is system1 even for NoRetrieve when retrievers tag is empty
      expect(result.suggestedRetrievers).toContain('system1');
    });

    it('should fallback to NoRetrieve when confidence below threshold', async () => {
      const llmResponse = `<decision>Retrieve</decision>
<confidence>0.3</confidence>
<reason>Uncertain if retrieval needed</reason>
<retrievers>system1</retrievers>`;
      const llmProvider = createMockLLMProvider(llmResponse);
      decider = new RetrievalDecider(llmProvider, { minConfidence: 0.5 });

      const signals = makeSignals();
      const result = await decider.decide('ambiguous query', signals, []);

      expect(result.needsRetrieval).toBe(false);
      expect(result.confidence).toBe(0.3);
      expect(result.skipReason).toContain('below threshold');
      expect(result.suggestedRetrievers).toHaveLength(0);
    });

    it('should respect custom minConfidence threshold', async () => {
      const llmResponse = `<decision>Retrieve</decision>
<confidence>0.6</confidence>
<reason>Some reason</reason>
<retrievers>system1</retrievers>`;
      const llmProvider = createMockLLMProvider(llmResponse);
      decider = new RetrievalDecider(llmProvider, { minConfidence: 0.7 });

      const signals = makeSignals();
      const result = await decider.decide('query', signals, []);

      expect(result.needsRetrieval).toBe(false);
    });

    it('should allow retrieval when confidence meets threshold', async () => {
      const llmResponse = `<decision>Retrieve</decision>
<confidence>0.7</confidence>
<reason>Needs context</reason>
<retrievers>system2</retrievers>`;
      const llmProvider = createMockLLMProvider(llmResponse);
      decider = new RetrievalDecider(llmProvider, { minConfidence: 0.5 });

      const signals = makeSignals({ hasRecallCue: true });
      const result = await decider.decide('query', signals, []);

      expect(result.needsRetrieval).toBe(true);
      expect(result.confidence).toBe(0.7);
    });

    it('should handle context-aware decision with recent messages', async () => {
      const llmResponse = `<decision>Retrieve</decision>
<confidence>0.75</confidence>
<reason>Follow-up in ongoing conversation</reason>
<retrievers>system1, system2</retrievers>`;
      const llmProvider = createMockLLMProvider(llmResponse);
      decider = new RetrievalDecider(llmProvider);

      const signals = makeSignals({
        hasRecentContext: true,
        hasFollowUpCue: true,
        queryLength: 30,
        clauseCount: 2,
      });
      const recentMessages = [
        { role: 'user', content: 'What do you think about my project?' },
        { role: 'assistant', content: 'Your project looks promising.' },
        { role: 'user', content: 'Can you elaborate on the timeline?' },
      ];

      const result = await decider.decide('Can you elaborate?', signals, recentMessages);

      expect(result.needsRetrieval).toBe(true);
      expect(result.confidence).toBe(0.75);
      expect(result.suggestedRetrievers).toContain('system1');
      expect(result.suggestedRetrievers).toContain('system2');
    });

    it('should handle missing context gracefully', async () => {
      const llmResponse = `<decision>NoRetrieve</decision>
<confidence>0.8</confidence>
<reason>Simple greeting</reason>
<retrievers></retrievers>`;
      const llmProvider = createMockLLMProvider(llmResponse);
      decider = new RetrievalDecider(llmProvider);

      const signals = makeSignals();
      const result = await decider.decide('Hello!', signals, []);

      expect(result.needsRetrieval).toBe(false);
      expect(result.confidence).toBe(0.8);
    });

    it('should normalize confidence to 0-1 range', async () => {
      const llmResponse = `<decision>Retrieve</decision>
<confidence>1.5</confidence>
<reason>Test</reason>
<retrievers>system1</retrievers>`;
      const llmProvider = createMockLLMProvider(llmResponse);
      decider = new RetrievalDecider(llmProvider);

      const signals = makeSignals();
      const result = await decider.decide('query', signals, []);

      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
    });

    it('should handle invalid confidence value', async () => {
      const llmResponse = `<decision>Retrieve</decision>
<confidence>abc</confidence>
<reason>Test</reason>
<retrievers>system1</retrievers>`;
      const llmProvider = createMockLLMProvider(llmResponse);
      decider = new RetrievalDecider(llmProvider);

      const signals = makeSignals();
      const result = await decider.decide('query', signals, []);

      expect(result.confidence).toBe(0.5);
    });

    it('should filter invalid retriever types', async () => {
      const llmResponse = `<decision>Retrieve</decision>
<confidence>0.7</confidence>
<reason>Test</reason>
<retrievers>system1, system2, memory</retrievers>`;
      const llmProvider = createMockLLMProvider(llmResponse);
      decider = new RetrievalDecider(llmProvider);

      const signals = makeSignals();
      const result = await decider.decide('query', signals, []);

      expect(result.suggestedRetrievers).toContain('system1');
      expect(result.suggestedRetrievers).toContain('system2');
      expect(result.suggestedRetrievers).toContain('memory');
      expect(result.suggestedRetrievers).toHaveLength(3);
    });

    it('should default to system1 when no retrievers specified', async () => {
      const llmResponse = `<decision>Retrieve</decision>
<confidence>0.7</confidence>
<reason>Test</reason>
<retrievers></retrievers>`;
      const llmProvider = createMockLLMProvider(llmResponse);
      decider = new RetrievalDecider(llmProvider);

      const signals = makeSignals();
      const result = await decider.decide('query', signals, []);

      expect(result.suggestedRetrievers).toContain('system1');
    });

    it('should handle malformed LLM response', async () => {
      const llmProvider = createMockLLMProvider('completely invalid response');
      decider = new RetrievalDecider(llmProvider);

      const signals = makeSignals();
      const result = await decider.decide('query', signals, []);

      expect(result.needsRetrieval).toBe(false);
      expect(result.reason).toBe('Unknown');
      // Default retriever when no match
      expect(result.suggestedRetrievers).toContain('system1');
    });

    it('should handle partial LLM response tags', async () => {
      const llmResponse = `<decision>Retrieve</decision>`;
      const llmProvider = createMockLLMProvider(llmResponse);
      decider = new RetrievalDecider(llmProvider);

      const signals = makeSignals();
      const result = await decider.decide('query', signals, []);

      expect(result.needsRetrieval).toBe(true);
      expect(result.confidence).toBe(0.5);
      expect(result.reason).toBe('Unknown');
    });
  });
});
