/**
 * ResponseVerifier Tests
 *
 * Yanıt doğrulama birim testleri.
 */

import { ResponseVerifier } from '../../../src/memory/retrieval/ResponseVerifier.js';
import type { MemoryRow } from '../../../src/memory/types.js';
import type { LLMProvider } from '../../../src/llm/provider.js';

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

function createMockLLMProvider(responseContent: string): LLMProvider {
  return {
    chat: jest.fn().mockResolvedValue({ content: responseContent }),
  } as unknown as LLMProvider;
}

describe('ResponseVerifier', () => {
  let verifier: ResponseVerifier;

  describe('verify()', () => {
    it('should verify a fully supported response', async () => {
      const llmResponse = JSON.stringify({
        isSupported: 'FullySupported',
        supportScore: 0.9,
        utilityScore: 5,
        hallucinations: [],
        needsRegeneration: false,
        feedback: 'All claims are backed by retrieved memories',
      });
      const llmProvider = createMockLLMProvider(llmResponse);
      verifier = new ResponseVerifier(llmProvider);

      const memories = [makeMemoryRow(1, '2+2=4tür.'), makeMemoryRow(2, 'Matematik temel işlemidir.')];
      const result = await verifier.verify('2+2 kaçtır?', '4tür.', memories);

      expect(result.isSupported).toBe('FullySupported');
      expect(result.supportScore).toBe(0.9);
      expect(result.utilityScore).toBe(5);
      expect(result.needsRegeneration).toBe(false);
      expect(result.hallucinations).toHaveLength(0);
    });

    it('should detect unsupported response', async () => {
      const llmResponse = JSON.stringify({
        isSupported: 'Unsupported',
        supportScore: 0.1,
        utilityScore: 1,
        hallucinations: ['Claim: "5tir" — no memory supports this'],
        needsRegeneration: true,
        feedback: 'Response contains hallucinations',
      });
      const llmProvider = createMockLLMProvider(llmResponse);
      verifier = new ResponseVerifier(llmProvider);

      const memories = [makeMemoryRow(1, '2+2=4tür.')];
      const result = await verifier.verify('2+2 kaçtır?', '5tir.', memories);

      expect(result.isSupported).toBe('Unsupported');
      expect(result.supportScore).toBe(0.1);
      expect(result.needsRegeneration).toBe(true);
      expect(result.hallucinations.length).toBeGreaterThan(0);
    });

    it('should handle partially supported response', async () => {
      const llmResponse = JSON.stringify({
        isSupported: 'PartiallySupported',
        supportScore: 0.65,
        utilityScore: 3,
        hallucinations: ['Minor gap in explanation'],
        needsRegeneration: false,
        feedback: 'Mostly backed by memories with minor gaps',
      });
      const llmProvider = createMockLLMProvider(llmResponse);
      verifier = new ResponseVerifier(llmProvider);

      const memories = [makeMemoryRow(1, 'Ankara başkenttir.')];
      const result = await verifier.verify('başkent neresi?', 'Ankara başkenttir ve Türkiye\'nin kalbidir.', memories);

      expect(result.isSupported).toBe('PartiallySupported');
      expect(result.supportScore).toBe(0.65);
      expect(result.utilityScore).toBe(3);
      expect(result.needsRegeneration).toBe(false);
    });

    it('should return partial result when no memories available', async () => {
      const llmProvider = createMockLLMProvider('{}');
      verifier = new ResponseVerifier(llmProvider);

      const result = await verifier.verify('any query', 'some response', []);

      expect(result.isSupported).toBe('PartiallySupported');
      expect(result.supportScore).toBe(0.5);
      expect(result.needsRegeneration).toBe(false);
      expect(result.feedback).toContain('No memories available');
    });

    it('should trigger regeneration for low support score', async () => {
      const llmResponse = JSON.stringify({
        isSupported: 'PartiallySupported',
        supportScore: 0.4,
        utilityScore: 3,
        hallucinations: [],
        needsRegeneration: false,
        feedback: 'Low support',
      });
      const llmProvider = createMockLLMProvider(llmResponse);
      verifier = new ResponseVerifier(llmProvider, { supportFloor: 0.6 });

      const memories = [makeMemoryRow(1, 'Some memory')];
      const result = await verifier.verify('query', 'response', memories);

      expect(result.supportScore).toBe(0.4);
      expect(result.needsRegeneration).toBe(true);
    });

    it('should trigger regeneration for low utility score', async () => {
      const llmResponse = JSON.stringify({
        isSupported: 'PartiallySupported',
        supportScore: 0.7,
        utilityScore: 2,
        hallucinations: [],
        needsRegeneration: false,
        feedback: 'Low utility',
      });
      const llmProvider = createMockLLMProvider(llmResponse);
      verifier = new ResponseVerifier(llmProvider, { utilityFloor: 2 });

      const memories = [makeMemoryRow(1, 'Some memory')];
      const result = await verifier.verify('query', 'response', memories);

      expect(result.utilityScore).toBe(2);
      expect(result.needsRegeneration).toBe(true);
    });

    it('should trigger regeneration when too many hallucinations', async () => {
      const llmResponse = JSON.stringify({
        isSupported: 'PartiallySupported',
        supportScore: 0.7,
        utilityScore: 3,
        hallucinations: ['Claim 1', 'Claim 2', 'Claim 3'],
        needsRegeneration: false,
        feedback: 'Many hallucinations',
      });
      const llmProvider = createMockLLMProvider(llmResponse);
      verifier = new ResponseVerifier(llmProvider);

      const memories = [makeMemoryRow(1, 'Some memory')];
      const result = await verifier.verify('query', 'response', memories);

      expect(result.hallucinations).toHaveLength(3);
      expect(result.needsRegeneration).toBe(true);
    });

    it('should normalize utility score to 1-5 range', async () => {
      const llmResponse = JSON.stringify({
        isSupported: 'FullySupported',
        supportScore: 0.8,
        utilityScore: 7,
        hallucinations: [],
        needsRegeneration: false,
        feedback: 'Good',
      });
      const llmProvider = createMockLLMProvider(llmResponse);
      verifier = new ResponseVerifier(llmProvider);

      const memories = [makeMemoryRow(1, 'Memory')];
      const result = await verifier.verify('query', 'response', memories);

      expect(result.utilityScore).toBeLessThanOrEqual(5);
      expect(result.utilityScore).toBeGreaterThanOrEqual(1);
    });

    it('should handle LLM parse failure gracefully', async () => {
      const llmProvider = createMockLLMProvider('invalid json');
      verifier = new ResponseVerifier(llmProvider);

      const memories = [makeMemoryRow(1, 'Some content')];
      const result = await verifier.verify('query', 'response', memories);

      expect(result.isSupported).toBe('PartiallySupported');
      expect(result.supportScore).toBe(0.5);
      expect(result.utilityScore).toBe(3);
      expect(result.needsRegeneration).toBe(false);
    });
  });

  describe('buildRegenerationPrompt()', () => {
    it('should build a regeneration prompt with hallucinations', () => {
      const llmProvider = createMockLLMProvider('{}');
      verifier = new ResponseVerifier(llmProvider);

      const verification = {
        isSupported: 'PartiallySupported' as const,
        supportScore: 0.5,
        utilityScore: 2,
        hallucinations: ['False claim about date'],
        needsRegeneration: true,
        feedback: 'Fix hallucinations',
      };

      const prompt = verifier.buildRegenerationPrompt('original response', verification);

      expect(prompt).toContain('SELF-EVALUATION FEEDBACK');
      expect(prompt).toContain('PartiallySupported');
      expect(prompt).toContain('Unsupported Claims');
      expect(prompt).toContain('False claim about date');
    });

    it('should build a regeneration prompt without hallucinations', () => {
      const llmProvider = createMockLLMProvider('{}');
      verifier = new ResponseVerifier(llmProvider);

      const verification = {
        isSupported: 'FullySupported' as const,
        supportScore: 0.8,
        utilityScore: 4,
        hallucinations: [],
        needsRegeneration: false,
        feedback: 'Minor improvement needed',
      };

      const prompt = verifier.buildRegenerationPrompt('original response', verification);

      expect(prompt).toContain('FullySupported');
      expect(prompt).toContain('4/5');
      expect(prompt).not.toContain('Unsupported Claims');
    });
  });

  describe('getConfig()', () => {
    it('should return current config', () => {
      const llmProvider = createMockLLMProvider('{}');
      verifier = new ResponseVerifier(llmProvider, { supportFloor: 0.7, utilityFloor: 3, maxRegenerations: 2 });

      const config = verifier.getConfig();

      expect(config.supportFloor).toBe(0.7);
      expect(config.utilityFloor).toBe(3);
      expect(config.maxRegenerations).toBe(2);
    });
  });
});
