import { describe, it, expect, beforeEach } from '@jest/globals';
import { buildBasePromptFragment, BASE_SYSTEM_PROMPT } from '../../../../src/agent/prompts/builders/basePrompt.js';

jest.mock('../../../../src/gateway/config.js', () => ({
  getConfig: jest.fn().mockReturnValue({
    systemPrompt: '',
  }),
}));

describe('BASE_SYSTEM_PROMPT', () => {
  it('contains USER_NAME placeholder', () => {
    expect(BASE_SYSTEM_PROMPT).toContain('{USER_NAME}');
  });

  it('contains NOW placeholder', () => {
    expect(BASE_SYSTEM_PROMPT).toContain('{NOW}');
  });

  it('contains persona section', () => {
    expect(BASE_SYSTEM_PROMPT).toContain('<persona>');
  });
});

describe('buildBasePromptFragment', () => {
  it('replaces USER_NAME placeholder', () => {
    const result = buildBasePromptFragment('TestUser');
    expect(result.text).toContain('TestUser');
    expect(result.text).not.toContain('{USER_NAME}');
  });

  it('replaces NOW placeholder', () => {
    const result = buildBasePromptFragment('TestUser');
    expect(result.text).not.toContain('{NOW}');
    expect(result.text.length).toBeGreaterThan(BASE_SYSTEM_PROMPT.length - 20);
  });

  it('has priority 10 (mandatory)', () => {
    const result = buildBasePromptFragment('TestUser');
    expect(result.priority).toBe(10);
  });

  it('has positive estimatedTokens', () => {
    const result = buildBasePromptFragment('TestUser');
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });

  it('uses custom prompt when provided', () => {
    const custom = 'Custom prompt for {USER_NAME} at {NOW}';
    const result = buildBasePromptFragment('Ali', custom);
    expect(result.text).toContain('Ali');
    expect(result.text).not.toContain('{NOW}');
    expect(result.text).not.toContain('PençeAI');
  });

  it('id is basePrompt', () => {
    const result = buildBasePromptFragment('TestUser');
    expect(result.id).toBe('basePrompt');
  });
});
