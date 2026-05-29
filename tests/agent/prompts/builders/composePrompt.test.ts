import { describe, it, expect } from '@jest/globals';
import { composePrompt, composePromptUnlimited, makeFragment } from '../../../../src/agent/prompts/builders/index.js';
import type { PromptFragment } from '../../../../src/agent/prompts/types.js';

describe('composePrompt', () => {
  it('returns empty prompt for empty fragments', () => {
    const result = composePrompt([], 1000);
    expect(result.prompt).toBe('');
    expect(result.usedTokens).toBe(0);
    expect(result.droppedFragments).toEqual([]);
  });

  it('filters out empty text fragments', () => {
    const fragments: PromptFragment[] = [
      { id: 'empty', text: '', priority: 5, estimatedTokens: 0 },
      { id: 'whitespace', text: '   ', priority: 5, estimatedTokens: 1 },
      { id: 'valid', text: 'Hello world', priority: 5, estimatedTokens: 3 },
    ];
    const result = composePrompt(fragments, 1000);
    expect(result.prompt).toContain('Hello world');
    expect(result.prompt).not.toContain('empty');
    expect(result.droppedFragments).toEqual([]);
  });

  it('includes all fragments when under budget', () => {
    const fragments: PromptFragment[] = [
      { id: 'base', text: 'Base prompt', priority: 10, estimatedTokens: 10 },
      { id: 'memory', text: 'Memory content', priority: 9, estimatedTokens: 10 },
      { id: 'rules', text: 'Rules here', priority: 10, estimatedTokens: 10 },
    ];
    const result = composePrompt(fragments, 1000);
    expect(result.prompt).toContain('Base prompt');
    expect(result.prompt).toContain('Memory content');
    expect(result.prompt).toContain('Rules here');
    expect(result.droppedFragments).toEqual([]);
  });

  it('drops lower priority fragments when token budget exceeded', () => {
    const fragments: PromptFragment[] = [
      { id: 'base', text: 'Base '.repeat(100), priority: 10, estimatedTokens: 100 },
      { id: 'memory', text: 'Memory '.repeat(200), priority: 9, estimatedTokens: 200 },
      { id: 'archival', text: 'Archival '.repeat(200), priority: 4, estimatedTokens: 200 },
    ];

    const result = composePrompt(fragments, 350);

    expect(result.prompt).toContain('Base');
    expect(result.prompt).toContain('Memory');
    expect(result.prompt).not.toContain('Archival');
    expect(result.droppedFragments).toContain('archival');
  });

  it('sorts fragments by priority (high to low)', () => {
    const fragments: PromptFragment[] = [
      { id: 'low', text: 'LOW', priority: 1, estimatedTokens: 5 },
      { id: 'high', text: 'HIGH', priority: 10, estimatedTokens: 5 },
      { id: 'mid', text: 'MID', priority: 5, estimatedTokens: 5 },
    ];

    const result = composePrompt(fragments, 1000);

    const highIdx = result.prompt.indexOf('HIGH');
    const midIdx = result.prompt.indexOf('MID');
    const lowIdx = result.prompt.indexOf('LOW');

    expect(highIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(lowIdx);
  });

  it('respects exact token budget boundary', () => {
    const fragments: PromptFragment[] = [
      { id: 'a', text: 'AAAA', priority: 10, estimatedTokens: 100 },
      { id: 'b', text: 'BBBB', priority: 5, estimatedTokens: 100 },
    ];

    const result = composePrompt(fragments, 200);
    expect(result.usedTokens).toBe(200);
    expect(result.droppedFragments).toEqual([]);
  });

  it('drops fragment that would exceed budget by 1 token', () => {
    const fragments: PromptFragment[] = [
      { id: 'a', text: 'AAAA', priority: 10, estimatedTokens: 100 },
      { id: 'b', text: 'BBBB', priority: 5, estimatedTokens: 101 },
    ];

    const result = composePrompt(fragments, 200);
    expect(result.usedTokens).toBe(100);
    expect(result.droppedFragments).toContain('b');
  });

  it('logs dropped fragments for observability', () => {
    const fragments: PromptFragment[] = [
      { id: 'base', text: 'Base '.repeat(100), priority: 10, estimatedTokens: 100 },
      { id: 'archival', text: 'Archival '.repeat(200), priority: 4, estimatedTokens: 200 },
    ];

    const result = composePrompt(fragments, 150);
    expect(result.droppedFragments).toContain('archival');
  });
});

describe('composePromptUnlimited', () => {
  it('includes all non-empty fragments regardless of size', () => {
    const fragments: PromptFragment[] = [
      { id: 'a', text: 'A'.repeat(1000), priority: 1, estimatedTokens: 250 },
      { id: 'b', text: 'B'.repeat(1000), priority: 10, estimatedTokens: 250 },
    ];

    const result = composePromptUnlimited(fragments);
    expect(result.prompt).toContain('A'.repeat(100));
    expect(result.prompt).toContain('B'.repeat(100));
    expect(result.totalTokens).toBe(500);
  });

  it('sorts by priority even without budget', () => {
    const fragments: PromptFragment[] = [
      { id: 'low', text: 'LOW', priority: 1, estimatedTokens: 1 },
      { id: 'high', text: 'HIGH', priority: 10, estimatedTokens: 1 },
    ];

    const result = composePromptUnlimited(fragments);
    expect(result.prompt.indexOf('HIGH')).toBeLessThan(result.prompt.indexOf('LOW'));
  });

  it('filters empty fragments', () => {
    const fragments: PromptFragment[] = [
      { id: 'empty', text: '', priority: 5, estimatedTokens: 0 },
      { id: 'valid', text: 'VALID', priority: 5, estimatedTokens: 2 },
    ];

    const result = composePromptUnlimited(fragments);
    expect(result.prompt).toContain('VALID');
    expect(result.prompt).not.toContain('empty');
  });
});

describe('makeFragment', () => {
  it('creates fragment with estimated tokens', () => {
    const result = makeFragment('test', 'Hello world', 5);
    expect(result.id).toBe('test');
    expect(result.text).toBe('Hello world');
    expect(result.priority).toBe(5);
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });

  it('estimates tokens using character/4 heuristic', () => {
    const text = 'A'.repeat(40);
    const result = makeFragment('test', text, 5);
    expect(result.estimatedTokens).toBe(10);
  });

  it('returns 0 tokens for empty text', () => {
    const result = makeFragment('test', '', 5);
    expect(result.estimatedTokens).toBe(0);
  });
});
