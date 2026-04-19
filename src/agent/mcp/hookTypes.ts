/**
 * MCP Hook Execution Engine — Type Definitions
 *
 * Claude Code ilhamli hook sistemi. TypeScript-native handler'lar
 * ile tool call lifecycle event'lerini yakalama, engelleme ve
 * modification yetenegi saglar.
 */

export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'SessionEnd'
  | 'PreCompact'
  | 'PostCompact'
  | 'Stop'
  | 'StopFailure'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PermissionRequest'
  | 'PermissionDenied';

export type HookDecision = 'approve' | 'block' | 'ask';

export interface HookContext {
  toolName: string;
  args: Record<string, unknown>;
  sessionId: string;
  callCount: number;
  workingDirectory?: string;
  result?: unknown;
  error?: string;
  compactReason?: string;
}

export interface HookResult {
  decision: HookDecision;
  reason?: string;
  updatedInput?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  async?: boolean;
}

export interface MCPHook {
  name: string;
  matcher: string | RegExp;
  event: HookEvent;
  handler: (context: HookContext) => Promise<HookResult>;
  priority: number;
  async?: boolean;
}

export interface HookExecutionReport {
  event: HookEvent;
  toolName: string;
  results: HookResult[];
  finalDecision: HookDecision;
  modifiedArgs?: Record<string, unknown>;
  durationMs: number;
}