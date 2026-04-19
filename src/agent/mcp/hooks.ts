/**
 * MCP Hook Execution Engine — Registry & Execution
 *
 * Hook'lar tool call lifecycle event'lerini yakalar.
 * Priority-based execution, input modification, block short-circuit,
 * async fire-and-forget desteği.
 *
 * Fail-open: Hook hatası durumunda tool call engellenmez.
 */

import type { MCPHook, HookEvent, HookContext, HookResult, HookExecutionReport } from './hookTypes.js';
import { logger } from '../../utils/logger.js';

export class HookRegistry {
  private hooks: MCPHook[] = [];
  private executing = false;

  register(hook: MCPHook): void {
    if (this.executing) {
      logger.warn({ hookName: hook.name, event: hook.event }, '[HookRegistry] Cannot register hook during execution');
      return;
    }
    this.hooks.push(hook);
    this.hooks.sort((a, b) => a.priority - b.priority);
    logger.info({ hookName: hook.name, event: hook.event, priority: hook.priority }, '[HookRegistry] Hook registered');
  }

  unregister(name: string): void {
    const before = this.hooks.length;
    this.hooks = this.hooks.filter(h => h.name !== name);
    if (this.hooks.length < before) {
      logger.info({ hookName: name }, '[HookRegistry] Hook unregistered');
    }
  }

  async executePhase(
    event: HookEvent,
    context: HookContext,
  ): Promise<HookExecutionReport> {
    const matchingHooks = this.hooks
      .filter(h => h.event === event)
      .filter(h => this.matchesTool(h.matcher, context.toolName));

    const startTime = Date.now();
    const results: HookResult[] = [];
    let modifiedArgs: Record<string, unknown> | undefined;
    let finalDecision: HookResult['decision'] = 'approve';

    this.executing = true;
    try {
      for (const hook of matchingHooks) {
        try {
          let result: HookResult;

          if (hook.async) {
            hook.handler(context).catch(err => {
              logger.debug({ hookName: hook.name, error: err }, '[HookRegistry] Async hook completed');
            });
            result = { decision: 'approve' };
          } else {
            result = await hook.handler(context);
          }

          results.push(result);

          if (event === 'PreToolUse') {
            if (result.decision === 'block') {
              logger.warn(
                { hookName: hook.name, toolName: context.toolName, reason: result.reason },
                '[HookRegistry] Tool blocked by hook',
              );
              finalDecision = 'block';
              break;
            }

            if (result.decision === 'ask') {
              finalDecision = 'ask';
            }

            if (result.updatedInput) {
              context.args = { ...context.args, ...result.updatedInput };
              modifiedArgs = { ...context.args };
            }
          }
        } catch (error) {
          logger.error({ hookName: hook.name, error }, '[HookRegistry] Hook execution failed');
          results.push({
            decision: 'approve',
            reason: `Hook ${hook.name} failed, allowing by default`,
          });
        }
      }
    } finally {
      this.executing = false;
    }

    if (finalDecision === 'block') {
      const blocked = results.find(r => r.decision === 'block');
      finalDecision = 'block';
      return {
        event,
        toolName: context.toolName,
        results,
        finalDecision: 'block',
        modifiedArgs,
        durationMs: Date.now() - startTime,
        reason: blocked?.reason,
      } as HookExecutionReport & { reason?: string };
    }

    return {
      event,
      toolName: context.toolName,
      results,
      finalDecision: finalDecision as 'approve' | 'ask',
      modifiedArgs,
      durationMs: Date.now() - startTime,
    };
  }

  getRegisteredHooks(): ReadonlyArray<MCPHook> {
    return [...this.hooks];
  }

  hasHook(name: string): boolean {
    return this.hooks.some(h => h.name === name);
  }

  clear(): void {
    this.hooks = [];
    this.executing = false;
  }

  private matchesTool(matcher: string | RegExp, toolName: string): boolean {
    if (typeof matcher === 'string') {
      return matcher === toolName || matcher === '*';
    }
    return matcher.test(toolName);
  }
}

let _registry: HookRegistry | null = null;

export function getHookRegistry(): HookRegistry {
  if (!_registry) {
    _registry = new HookRegistry();
  }
  return _registry;
}

export function resetHookRegistry(): void {
  if (_registry) {
    _registry.clear();
  }
  _registry = null;
}