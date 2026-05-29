import { makeFragment } from './index.js';
import type { PromptFragment } from '../types.js';

export interface MCPContextInput {
  mcpListPrompt: string | null;
}

/**
 * MCP (Model Context Protocol) araç listesini prompt'a dönüştürür.
 * Harici servisler için kullanılabilen MCP araçlarının listesi.
 * Priority: 7 (orta-yüksek — araç keşfi önemli)
 */
export function buildMCPContextFragment(input: MCPContextInput): PromptFragment {
  const { mcpListPrompt } = input;

  if (!mcpListPrompt) {
    return makeFragment('mcpContext', '', 7);
  }

  return makeFragment('mcpContext', mcpListPrompt, 7);
}
