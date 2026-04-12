/**
 * Cost Calculator Tests
 * 
 * LLM provider bazlı maliyet hesaplama birim testleri.
 */

import { calculateCost, getModelPricing, getSupportedProviders } from '../../src/utils/costCalculator.js';

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
});
