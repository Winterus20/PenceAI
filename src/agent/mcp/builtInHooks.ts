/**
 * MCP Hook Execution Engine — Built-in Hooks
 *
 * Production seviyesi hook'lar:
 * - Security Monitor: Path traversal, secret, destructive command tespiti
 * - Output Sanitizer: API key/password masking
 * - Console.log Detector: console.log tespiti ve uyarı
 * - Observation Capture: Tool call'lari otomatik observation olarak kaydet
 * - Dev Server Blocker: Dev server komutlarini uyari/blokla
 * - Context Budget Guard: Context bütçe asiminda compaction oner
 * - Session Summary: Oturum sonunda metrik ozeti
 */

import type { MCPHook, HookContext, HookResult } from './hookTypes.js';
import type { HookRegistry } from './hooks.js';
import { getConfig } from '../../gateway/config.js';
import { logger } from '../../utils/logger.js';

const SECURITY_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, name: 'OpenAI API Key' },
  { pattern: /Bearer [a-zA-Z0-9\-_]{20,}/g, name: 'Bearer Token' },
  { pattern: /password["']?\s*[:=]\s*["']?[^"'\s]+/gi, name: 'Password' },
  { pattern: /\.\.\//g, name: 'Path Traversal' },
  { pattern: /(;|\|)\s*(rm|del|format)\s+(?!.*test)/gi, name: 'Destructive Command' },
];

const OUTPUT_SANITIZER_PATTERNS: Array<{ patternSource: string; label: string }> = [
  { patternSource: '(?:api[_-]?key|apikey|access[_-]?token)\\s*[:=]\\s*[\'"]?[a-zA-Z0-9_-]{16,}', label: 'API Key' },
  { patternSource: 'sk-[a-zA-Z0-9]{20,}', label: 'OpenAI API Key' },
  { patternSource: 'AKIA[0-9A-Z]{16}', label: 'AWS Key' },
  { patternSource: 'eyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+', label: 'JWT Token' },
  { patternSource: '-----BEGIN\\s+(?:RSA\\s+)?PRIVATE\\s+KEY-----', label: 'Private Key' },
  { patternSource: 'password["\'?]\\s*[:=]\\s*["\'"]?[^"\'\\s]{8,}', label: 'Password' },
];

function registerSecurityMonitor(registry: HookRegistry): void {
  registry.register({
    name: 'security-monitor',
    event: 'PreToolUse',
    matcher: /^(Bash|Write|Edit|readFile|listFiles)$/,
    priority: 0,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      const argsStr = JSON.stringify(ctx.args);
      for (const { pattern, name } of SECURITY_PATTERNS) {
        const re = new RegExp(pattern.source, pattern.flags);
        if (re.test(argsStr)) {
          return { decision: 'block', reason: `Security: ${name} detected in tool input` };
        }
      }
      return { decision: 'approve' };
    },
  });
}

function registerOutputSanitizer(registry: HookRegistry): void {
  registry.register({
    name: 'output-sanitizer',
    event: 'PostToolUse',
    matcher: /.*/,
    priority: 10,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      const result = ctx.result;
      if (!result || typeof result !== 'string') return { decision: 'approve' };
      let sanitized = result;
      let wasSanitized = false;
      for (const { patternSource, label } of OUTPUT_SANITIZER_PATTERNS) {
        const pattern = new RegExp(patternSource, 'gi');
        const before = sanitized;
        sanitized = sanitized.replace(pattern, `[REDACTED:${label}]`);
        if (before !== sanitized) wasSanitized = true;
      }
      if (wasSanitized) {
        return { decision: 'approve', updatedInput: {}, metadata: { sanitized: true } };
      }
      return { decision: 'approve' };
    },
  });
}

function registerConsoleLogDetector(registry: HookRegistry): void {
  const config = getConfig();
  const behavior: 'ask' | 'approve' | 'block' = config.hookConsoleLogDetector;

  registry.register({
    name: 'console-log-detector',
    event: 'PreToolUse',
    matcher: /^(Write|Edit)$/,
    priority: 20,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      const content = ctx.args.content || ctx.args.newString || '';
      if (typeof content === 'string' && /console\.log\s*\(/.test(content)) {
        if (behavior === 'block') {
          return { decision: 'block', reason: 'console.log detected in code. Remove or replace with logger.' };
        }
        if (behavior === 'ask') {
          return { decision: 'ask', reason: 'console.log detected in code. Consider removing or replacing with logger.' };
        }
        return { decision: 'approve', reason: 'console.log detected but auto-approved by config' };
      }
      return { decision: 'approve' };
    },
  });
}

function registerObservationCapture(registry: HookRegistry): void {
  registry.register({
    name: 'observation-capture',
    event: 'PostToolUse',
    matcher: /.*/,
    priority: 5,
    async: true,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      const toolName = ctx.toolName;
      const argsStr = JSON.stringify(ctx.args).substring(0, 200);
      const resultStr = typeof ctx.result === 'string' ? ctx.result.substring(0, 200) : '(non-string result)';

      logger.info({
        toolName,
        callCount: ctx.callCount,
        argsPreview: argsStr,
        resultPreview: resultStr,
      }, '[Hook:Observation] Tool call observed');

      return { decision: 'approve' };
    },
  });

  registry.register({
    name: 'observation-capture-failure',
    event: 'PostToolUseFailure',
    matcher: /.*/,
    priority: 5,
    async: true,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      logger.warn({
        toolName: ctx.toolName,
        callCount: ctx.callCount,
        error: ctx.error,
      }, '[Hook:Observation] Tool call failed');

      return { decision: 'approve' };
    },
  });
}

const DEV_SERVER_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\b(npm|yarn|pnpm)\s+(run\s+)?dev\b/i, name: 'Dev Server (dev)' },
  { pattern: /\b(npm|yarn|pnpm)\s+start\b/i, name: 'Dev Server (start)' },
  { pattern: /\b(next\s+dev)\b/i, name: 'Next.js Dev' },
  { pattern: /\b(vite)\b/i, name: 'Vite Dev Server' },
  { pattern: /\bnodemon\b/i, name: 'Nodemon' },
];

function registerDevServerBlocker(registry: HookRegistry): void {
  registry.register({
    name: 'dev-server-blocker',
    event: 'PreToolUse',
    matcher: /^Bash$/,
    priority: 15,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      const command = String(ctx.args.command || ctx.args.cmd || '');
      if (!command) return { decision: 'approve' };

      for (const { pattern, name } of DEV_SERVER_PATTERNS) {
        if (pattern.test(command)) {
          return {
            decision: 'ask',
            reason: `Detected dev server command: "${name}". Dev servers should run externally, not through the agent. Consider running it in a separate terminal.`,
          };
        }
      }
      return { decision: 'approve' };
    },
  });
}

const CONTEXT_BUDGET_SOFT_LIMIT = 40;
const CONTEXT_BUDGET_HARD_LIMIT = 60;

function registerContextBudgetGuard(registry: HookRegistry): void {
  registry.register({
    name: 'context-budget-guard',
    event: 'PreCompact',
    matcher: '*',
    priority: 0,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      if (ctx.callCount >= CONTEXT_BUDGET_HARD_LIMIT) {
        logger.warn({
          callCount: ctx.callCount,
          limit: CONTEXT_BUDGET_HARD_LIMIT,
        }, '[Hook:BudgetGuard] Hard context budget limit reached — compaction required');
        return {
          decision: 'block',
          reason: `Context budget hard limit reached (${ctx.callCount} calls >= ${CONTEXT_BUDGET_HARD_LIMIT}). Compaction is required before proceeding.`,
        };
      }
      if (ctx.callCount >= CONTEXT_BUDGET_SOFT_LIMIT) {
        logger.info({
          callCount: ctx.callCount,
          limit: CONTEXT_BUDGET_SOFT_LIMIT,
        }, '[Hook:BudgetGuard] Soft context budget limit reached — compaction recommended');
        return {
          decision: 'ask',
          reason: `Approaching context budget limit (${ctx.callCount}/${CONTEXT_BUDGET_HARD_LIMIT} calls). Consider compacting context.`,
        };
      }
      return { decision: 'approve' };
    },
  });
}

function registerSessionSummary(registry: HookRegistry): void {
  registry.register({
    name: 'session-summary',
    event: 'SessionEnd',
    matcher: '*',
    priority: 100,
    async: true,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      logger.info({
        sessionId: ctx.sessionId,
        totalToolCalls: ctx.callCount,
      }, '[Hook:SessionSummary] Session ended');

      return { decision: 'approve' };
    },
  });
}

export function registerBuiltInHooks(registry: HookRegistry): void {
  const config = getConfig();

  if (!config.enableHooks) {
    logger.info('[Hooks] Hook system disabled by config');
    return;
  }

  if (config.hookSecurityMonitor) {
    registerSecurityMonitor(registry);
  }
  if (config.hookOutputSanitizer) {
    registerOutputSanitizer(registry);
  }
  registerConsoleLogDetector(registry);
  if (config.hookObservationCapture) {
    registerObservationCapture(registry);
  }
  if (config.hookDevServerBlocker) {
    registerDevServerBlocker(registry);
  }
  if (config.hookContextBudgetGuard) {
    registerContextBudgetGuard(registry);
  }
  if (config.hookSessionSummary) {
    registerSessionSummary(registry);
  }

  logger.info({
    securityMonitor: config.hookSecurityMonitor,
    outputSanitizer: config.hookOutputSanitizer,
    consoleLogDetector: config.hookConsoleLogDetector,
    observationCapture: config.hookObservationCapture,
    devServerBlocker: config.hookDevServerBlocker,
    contextBudgetGuard: config.hookContextBudgetGuard,
    sessionSummary: config.hookSessionSummary,
  }, '[Hooks] Built-in hooks registered');
}