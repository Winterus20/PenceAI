/**
 * Cost Calculator Tests
 *
 * LLM provider bazlı maliyet hesaplama birim testleri.
 */

import { calculateCost, calculateCostBreakdown, getModelPricing, getSupportedProviders, normalizeModelName } from '../../src/utils/costCalculator.js';

describe('CostCalculator', () => {
  describe('getModelPricing()', () => {
    it('should return pricing map for openai provider', () => {
      const pricing = getModelPricing('openai');
      expect(pricing['gpt-4o']).toBeDefined();
      expect(pricing['gpt-4o'].promptPer1K).toBeGreaterThan(0);
      expect(pricing['gpt-4o'].completionPer1K).toBeGreaterThan(pricing['gpt-4o'].promptPer1K);
    });

    it('should return pricing map for anthropic provider', () => {
      const pricing = getModelPricing('anthropic');
      expect(pricing['claude-sonnet-4-20250514']).toBeDefined();
      expect(pricing['claude-sonnet-4-20250514'].promptPer1K).toBe(0.003);
      expect(pricing['claude-sonnet-4-20250514'].completionPer1K).toBe(0.015);
    });

    it('should return empty object for unknown provider', () => {
      const pricing = getModelPricing('unknown-provider-xyz');
      expect(pricing).toEqual({});
    });

    it('should return pricing for ollama provider with zero costs', () => {
      const pricing = getModelPricing('ollama');
      expect(pricing['default']).toBeDefined();
      expect(pricing['default'].promptPer1K).toBe(0);
      expect(pricing['default'].completionPer1K).toBe(0);
    });
  });

  describe('calculateCost()', () => {
    it('should calculate GPT-4o cost correctly', () => {
      const cost = calculateCost('openai', 'gpt-4o', 1000, 500);
      expect(cost).toBeGreaterThan(0);
    });

    it('should calculate cost for large token counts', () => {
      const cost = calculateCost('openai', 'gpt-4o', 1_000_000, 500_000);
      // gpt-4o: promptPer1K: 0.0025, completionPer1K: 0.01
      // input: 1000 * 0.0025 = 2.5, output: 500 * 0.01 = 5.0
      expect(cost).toBeCloseTo(7.5, 2);
    });

    it('should return zero cost for Ollama models', () => {
      const cost = calculateCost('ollama', 'default', 10000, 5000);
      expect(cost).toBe(0);
    });

    it('should handle zero tokens', () => {
      const cost = calculateCost('openai', 'gpt-4o', 0, 0);
      expect(cost).toBe(0);
    });

    it('should be case-insensitive for provider matching', () => {
      const cost1 = calculateCost('OPENAI', 'gpt-4o', 1000, 500);
      const cost2 = calculateCost('openai', 'gpt-4o', 1000, 500);
      expect(cost1).toBe(cost2);
    });

    it('should use fallback pricing for unknown model', () => {
      const cost = calculateCost('openai', 'unknown-model', 1000, 500);
      // Fallback: promptPer1K: 0.001, completionPer1K: 0.003
      // input: 1 * 0.001 = 0.001, output: 0.5 * 0.003 = 0.0015
      expect(cost).toBeCloseTo(0.0025, 4);
    });

    it('should use default model pricing for provider when model not found', () => {
      const cost = calculateCost('ollama', 'nonexistent-model', 1000, 500);
      expect(cost).toBe(0); // ollama default is 0
    });

    it('should calculate Anthropic Claude cost correctly', () => {
      const cost = calculateCost('anthropic', 'claude-sonnet-4-20250514', 1000, 500);
      // promptPer1K: 0.003, completionPer1K: 0.015
      // input: 1 * 0.003 = 0.003, output: 0.5 * 0.015 = 0.0075
      expect(cost).toBeCloseTo(0.0105, 4);
    });

    it('should clamp negative prompt tokens to 0', () => {
      const cost = calculateCost('openai', 'gpt-4o', -100, 500);
      const expectedCost = calculateCost('openai', 'gpt-4o', 0, 500);
      expect(cost).toBe(expectedCost);
    });

    it('should clamp negative completion tokens to 0', () => {
      const cost = calculateCost('openai', 'gpt-4o', 1000, -200);
      const expectedCost = calculateCost('openai', 'gpt-4o', 1000, 0);
      expect(cost).toBe(expectedCost);
    });

    it('should handle both negative tokens', () => {
      const cost = calculateCost('openai', 'gpt-4o', -50, -100);
      expect(cost).toBe(0);
    });

    it('should handle versioned model names (gpt-4o-2024-08-06)', () => {
      const costVersioned = calculateCost('openai', 'gpt-4o-2024-08-06', 1000, 500);
      const costBase = calculateCost('openai', 'gpt-4o', 1000, 500);
      expect(costVersioned).toBe(costBase);
    });

    it('should handle gpt-4o-mini versioned names', () => {
      const costVersioned = calculateCost('openai', 'gpt-4o-mini-latest', 1000, 500);
      const costBase = calculateCost('openai', 'gpt-4o-mini', 1000, 500);
      expect(costVersioned).toBe(costBase);
    });

    it('should handle claude-3-5-sonnet versioned names', () => {
      const costVersioned = calculateCost('anthropic', 'claude-3-5-sonnet-latest', 1000, 500);
      const costBase = calculateCost('anthropic', 'claude-3-5-sonnet-20241022', 1000, 500);
      expect(costVersioned).toBe(costBase);
    });
  });

  describe('calculateCostBreakdown()', () => {
    it('should return correct structure', () => {
      const breakdown = calculateCostBreakdown('openai', 'gpt-4o', 1000, 500);
      expect(breakdown).toHaveProperty('total');
      expect(breakdown).toHaveProperty('promptCost');
      expect(breakdown).toHaveProperty('completionCost');
      expect(breakdown).toHaveProperty('pricing');
      expect(breakdown.pricing).toHaveProperty('promptPer1K');
      expect(breakdown.pricing).toHaveProperty('completionPer1K');
    });

    it('should return correct cost values', () => {
      const breakdown = calculateCostBreakdown('openai', 'gpt-4o', 1000, 500);
      // promptPer1K: 0.0025, completionPer1K: 0.01
      expect(breakdown.promptCost).toBeCloseTo(0.0025, 4);
      expect(breakdown.completionCost).toBeCloseTo(0.005, 4);
      expect(breakdown.total).toBeCloseTo(0.0075, 4);
    });

    it('should total equals promptCost + completionCost (rounded)', () => {
      const breakdown = calculateCostBreakdown('openai', 'gpt-4o', 1234, 567);
      expect(breakdown.total).toBeCloseTo(breakdown.promptCost + breakdown.completionCost, 4);
    });
  });

  describe('getSupportedProviders()', () => {
    it('should return all supported providers', () => {
      const providers = getSupportedProviders();

      expect(providers).toContain('openai');
      expect(providers).toContain('anthropic');
      expect(providers).toContain('ollama');
      expect(providers).toContain('groq');
      expect(providers).toContain('mistral');
    });

    it('should return at least 8 providers', () => {
      const providers = getSupportedProviders();
      expect(providers.length).toBeGreaterThanOrEqual(8);
    });
  });

  describe('normalizeModelName()', () => {
    it('should strip version suffix from gpt-4o', () => {
      expect(normalizeModelName('gpt-4o-2024-08-06')).toBe('gpt-4o');
      expect(normalizeModelName('gpt-4o-latest')).toBe('gpt-4o');
    });

    it('should strip version suffix from gpt-4o-mini', () => {
      expect(normalizeModelName('gpt-4o-mini-2024-07-18')).toBe('gpt-4o-mini');
    });

    it('should strip version suffix from gpt-4-turbo', () => {
      expect(normalizeModelName('gpt-4-turbo-2024-04-09')).toBe('gpt-4-turbo');
    });

    it('should strip version suffix from gpt-3.5-turbo', () => {
      expect(normalizeModelName('gpt-3.5-turbo-0125')).toBe('gpt-3.5-turbo');
      expect(normalizeModelName('gpt-3.5-turbo-instruct')).toBe('gpt-3.5-turbo');
    });

    it('should map claude-3-5-sonnet variants', () => {
      expect(normalizeModelName('claude-3-5-sonnet-20241022')).toBe('claude-3-5-sonnet-20241022');
      expect(normalizeModelName('claude-3-5-sonnet-latest')).toBe('claude-3-5-sonnet-20241022');
    });

    it('should map claude-3-5-haiku variants', () => {
      expect(normalizeModelName('claude-3-5-haiku-20241022')).toBe('claude-3-5-haiku-20241022');
      expect(normalizeModelName('claude-3-5-haiku-latest')).toBe('claude-3-5-haiku-20241022');
    });

    it('should map llama-3 variants to closest match', () => {
      expect(normalizeModelName('llama-3-70b')).toBe('llama-3-70b');
      expect(normalizeModelName('llama-3-8b')).toBe('llama-3-8b');
      expect(normalizeModelName('llama-3-70b-instruct')).toBe('llama-3-70b');
    });

    it('should return original name for unknown patterns', () => {
      expect(normalizeModelName('unknown-model')).toBe('unknown-model');
      expect(normalizeModelName('some-random-model')).toBe('some-random-model');
    });

    it('should handle case-insensitive matching', () => {
      expect(normalizeModelName('GPT-4O-2024-08-06')).toBe('gpt-4o');
      expect(normalizeModelName('GPT-4o-MINI')).toBe('gpt-4o-mini');
    });

    it('should return empty string for empty input', () => {
      expect(normalizeModelName('')).toBe('');
    });
  });
});
