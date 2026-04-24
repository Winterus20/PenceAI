import type { LLMToolDefinition, ToolCall } from '../router/types.js';
import type { ToolExecutor, ConfirmCallback } from './tools.js';
import type { AgentEventCallback } from './runtime.js';
import { createBuiltinTools } from './tools.js';
import { getBuiltinToolDefinitions } from './prompt.js';
import { getUnifiedToolRegistry } from './mcp/registry.js';
import { isMCPEnabled } from './mcp/config.js';
import { getHookRegistry } from './mcp/hooks.js';
import { getConfig } from '../gateway/config.js';
import type { HookContext } from './mcp/hookTypes.js';
import type { MemoryManager } from '../memory/manager.js';
import type { MetricsTracker } from './metricsTracker.js';
import { logger } from '../utils/index.js';

export class ToolManager {
    private tools: Map<string, ToolExecutor> = new Map();
    private toolDefinitions: LLMToolDefinition[] = getBuiltinToolDefinitions();
    private _mcpEnabled: boolean;
    private _mcpToolsRegistered: boolean = false;
    private _lastToolHash: string | null = null;
    private _lastToolPayload: LLMToolDefinition[] | null = null;
    private _lastMcpListHash: string | null = null;
    private _lastMcpListPrompt: string | null = null;
    private _lastConfirmCallback?: ConfirmCallback;
    private static readonly MAX_TOOLS_IN_CONTEXT = 20;

    private _sessionTotalToolTime = 0;
    private _sessionToolCallCount = 0;
    private _sessionId = '';
    private _hookCallCounter = 0;

    constructor(mcpEnabled?: boolean) {
        this._mcpEnabled = mcpEnabled ?? isMCPEnabled();
        if (this._mcpEnabled) {
            logger.info('[ToolManager] MCP integration enabled');
        }
    }

    /** Set session ID for hook context */
    setSessionId(sessionId: string): void {
        this._sessionId = sessionId;
        this._hookCallCounter = 0;
    }

    ensureTools(memory: MemoryManager, confirmCallback: ConfirmCallback | undefined, mergeFn: (old: string, new_: string) => Promise<string>): void {
        if (!this._lastConfirmCallback || this._lastConfirmCallback !== confirmCallback) {
            const builtinTools = createBuiltinTools(memory, confirmCallback, mergeFn);
            this.tools.clear();
            for (const tool of builtinTools) {
                this.tools.set(tool.name, tool);
            }
            this._lastConfirmCallback = confirmCallback;

            if (this._mcpEnabled) {
                const registry = getUnifiedToolRegistry();
                registry.registerBuiltins(memory, confirmCallback, mergeFn);
                this.registerMCPTools(registry);
            }
        }

        if (this._mcpEnabled && !this._mcpToolsRegistered) {
            const registry = getUnifiedToolRegistry();
            this.registerMCPTools(registry);
        }
    }

    getEffectiveToolDefinitions(): LLMToolDefinition[] {
        if (this._mcpEnabled) {
            try {
                const registry = getUnifiedToolRegistry();
                const allTools = registry.getAllToolDefinitions();

                const currentHash = this.computeToolHash(allTools);

                if (currentHash === this._lastToolHash && this._lastToolPayload) {
                    return this._lastToolPayload;
                }

                const compressed = this.compressToolDefinitions(allTools);
                const pruned = this.pruneExcessTools(compressed);

                this._lastToolHash = currentHash;
                this._lastToolPayload = pruned;
                this.toolDefinitions = pruned;
                this._mcpToolsRegistered = true;

                logger.info(`[ToolManager] Tool cache miss — ${pruned.length} tools (${this._lastToolHash})`);
                return pruned;
            } catch (error: unknown) {
                logger.warn({ err: error }, '[ToolManager] Failed to get MCP tools, falling back to built-in tools');
            }
        }
        return this.toolDefinitions;
    }

    async executeToolsWithEvents(
        toolCalls: ToolCall[],
        onEvent?: AgentEventCallback,
        metricsTracker?: MetricsTracker,
        confirmCallback?: ConfirmCallback,
    ): Promise<Array<{ toolCallId: string; name: string; result: string; isError: boolean }>> {
        const config = getConfig();
        const hookRegistry = config.enableHooks ? getHookRegistry() : null;

        const promises = toolCalls.map(async (tc) => {
            let result: string;
            let isError = false;
            const toolCallIndex = metricsTracker
                ? metricsTracker.incrementToolCallCount()
                : ++this._sessionToolCallCount;

            // PreToolUse Hook
            if (hookRegistry) {
                const hookContext: HookContext = {
                    toolName: tc.name,
                    args: tc.arguments,
                    sessionId: this._sessionId,
                    callCount: this._hookCallCounter++,
                };
                const hookReport = await hookRegistry.executePhase('PreToolUse', hookContext);

                if (hookReport.finalDecision === 'block') {
                    const blockedResult = hookReport.results.find(r => r.decision === 'block');
                    const reason = blockedResult?.reason || 'Blocked by security hook';
                    logger.warn({ toolName: tc.name, reason }, '[ToolManager] Tool call blocked by hook');
                    result = `⛔ ${reason}`;
                    isError = true;
                    onEvent?.({
                        type: 'tool_end',
                        data: { name: tc.name, result: result.substring(0, 500), isError },
                    });
                    return { toolCallId: tc.id, name: tc.name, result, isError };
                }

                // Input modification from hooks
                if (hookReport.modifiedArgs) {
                    tc = { ...tc, arguments: hookReport.modifiedArgs };
                    logger.info({ toolName: tc.name }, '[ToolManager] Tool input modified by hook');
                }

                if (hookReport.finalDecision === 'ask') {
                    logger.info({ toolName: tc.name }, '[ToolManager] Hook recommends user approval (ask)');
                    if (config.hookApprovalMode === 'approve') {
                        logger.info({ toolName: tc.name }, '[ToolManager] Auto-approving hook due to hookApprovalMode=approve');
                    } else if (confirmCallback) {
                        const approved = await confirmCallback({
                            toolName: tc.name,
                            path: 'hook_approval',
                            operation: 'execute',
                            description: `Güvenlik kancası (hook) onayı: ${tc.name} aracı için izin istiyor.`,
                        });
                        if (!approved) {
                            result = `⛔ Kullanıcı işlemi reddetti (Hook ask).`;
                            isError = true;
                            onEvent?.({
                                type: 'tool_end',
                                data: { name: tc.name, result: result.substring(0, 500), isError },
                            });
                            return { toolCallId: tc.id, name: tc.name, result, isError };
                        }
                    } else {
                        logger.warn('[ToolManager] Confirm callback not available, proceeding without approval');
                    }
                }
            }

            onEvent?.({
                type: 'tool_start',
                data: { name: tc.name, arguments: tc.arguments },
            });

            const toolStart = Date.now();
            try {
                if (this._mcpEnabled && tc.name.startsWith('mcp:')) {
                    const registry = getUnifiedToolRegistry();
                    logger.info(`[ToolManager]   → [MCP] ${tc.name}(${JSON.stringify(tc.arguments).substring(0, 100)})`);
                    result = await registry.executeTool(tc.name, tc.arguments);
                } else {
                    const tool = this.tools.get(tc.name);
                    if (!tool) {
                        result = `Hata: Bilinmeyen araç: ${tc.name}`;
                        isError = true;
                    } else {
                        logger.info(`[ToolManager]   → ${tc.name}(${JSON.stringify(tc.arguments).substring(0, 100)})`);
                        result = await tool.execute(tc.arguments);
                    }
                }
            } catch (err: unknown) {
                result = `Hata: ${err instanceof Error ? err.message : String(err)}`;
                isError = true;

                // PostToolUseFailure Hook
                if (hookRegistry) {
                    await hookRegistry.executePhase('PostToolUseFailure', {
                        toolName: tc.name,
                        args: tc.arguments,
                        sessionId: this._sessionId,
                        callCount: toolCallIndex,
                        error: result,
                    });
                }
            }

            // PostToolUse Hook
            if (hookRegistry && !isError) {
                await hookRegistry.executePhase('PostToolUse', {
                    toolName: tc.name,
                    args: tc.arguments,
                    sessionId: this._sessionId,
                    callCount: toolCallIndex,
                    result,
                });
            }

            const duration = Date.now() - toolStart;
            this._sessionTotalToolTime += duration;
            if (metricsTracker) {
                metricsTracker.addToolTime(duration);
            }
            logger.info(`[ToolManager] 🔧 tool #${toolCallIndex}: ${tc.name} completed in ${duration}ms | ${result.length} chars`);

            onEvent?.({
                type: 'tool_end',
                data: {
                    name: tc.name,
                    result: result.substring(0, 500),
                    isError,
                },
            });

            return {
                toolCallId: tc.id,
                name: tc.name,
                result,
                isError,
            };
        });

        const settled = await Promise.allSettled(promises);
        return settled.map((s, idx) => {
            if (s.status === 'fulfilled') return s.value;
            const failedTc = toolCalls[idx];
            return {
                toolCallId: failedTc?.id ?? '',
                name: failedTc?.name ?? '',
                result: `Hata: ${(s.reason as Error)?.message || 'Bilinmeyen hata'}`,
                isError: true,
            };
        });
    }

    getMcpListPrompt(allTools: LLMToolDefinition[]): string | null {
        const mcpTools = allTools.filter(t => t.name.startsWith('mcp:'));
        if (mcpTools.length === 0) return null;

        const currentMcpHash = this.computeMcpListHash(mcpTools);

        if (currentMcpHash === this._lastMcpListHash && this._lastMcpListPrompt) {
            return this._lastMcpListPrompt;
        }

        const serverMap = new Map<string, string[]>();
        for (const tool of mcpTools) {
            const parts = tool.name.split(':');
            const serverName = parts[1];
            if (!serverName) continue;
            if (!serverMap.has(serverName)) serverMap.set(serverName, []);
            serverMap.get(serverName)!.push(tool.name);
        }
        const mcpList = Array.from(serverMap.entries())
            .map(([server, tools]) => `  - **${server}**: ${tools.length} araç (${tools.map(t => `\`${t}\``).join(', ')})`)
            .join('\n');
        const mcpPrompt = `\n\n## Aktif MCP Sunucuları\nŞu anda bağlı MCP sunucuları ve araçları:\n${mcpList}\n\nKullanıcı "hangi MCP sunucuları var?" diye sorarsa, yukarıdaki listeyi aynen kullanıcıya ilet.`;

        this._lastMcpListHash = currentMcpHash;
        this._lastMcpListPrompt = mcpPrompt;
        return mcpPrompt;
    }

    private computeToolHash(tools: LLMToolDefinition[]): string {
        const sig = tools.map(t => `${t.name}|${t.description ?? ''}|${t.llmDescription ?? ''}`).join(';');
        let hash = 0;
        for (let i = 0; i < sig.length; i++) {
            hash = ((hash << 5) - hash) + sig.charCodeAt(i);
            hash |= 0;
        }
        return hash.toString(36);
    }

    private computeMcpListHash(mcpTools: LLMToolDefinition[]): string {
        const sig = mcpTools.map(t => t.name).join(',');
        let hash = 0;
        for (let i = 0; i < sig.length; i++) {
            hash = ((hash << 5) - hash) + sig.charCodeAt(i);
            hash |= 0;
        }
        return hash.toString(36);
    }

    private compressToolDefinitions(tools: LLMToolDefinition[]): LLMToolDefinition[] {
        return tools.map(tool => {
            const compressed: LLMToolDefinition = {
                name: tool.name,
                description: tool.llmDescription ?? tool.description,
                parameters: tool.llmParameters ?? tool.parameters,
            };
            return compressed;
        });
    }

    private pruneExcessTools(tools: LLMToolDefinition[]): LLMToolDefinition[] {
        const maxTools = ToolManager.MAX_TOOLS_IN_CONTEXT;
        if (tools.length <= maxTools) return tools;

        const builtin = tools.filter(t => !t.name.startsWith('mcp:'));
        const mcp = tools.filter(t => t.name.startsWith('mcp:'));

        const keepCount = Math.max(0, maxTools - builtin.length);
        const prunedMcp = mcp.slice(0, keepCount);

        if (mcp.length > keepCount) {
            const removed = mcp.slice(keepCount).map(t => t.name);
            logger.warn(`[ToolManager] ⚠️ Tool count (${tools.length}) exceeds limit (${maxTools}), pruning: ${removed.join(', ')}`);
        }

        return [...builtin, ...prunedMcp];
    }

    private registerMCPTools(registry: ReturnType<typeof getUnifiedToolRegistry>): void {
        try {
            const allTools = registry.getAllToolDefinitions();
            this.toolDefinitions = allTools;
            this._mcpToolsRegistered = true;

            this._lastToolHash = null;
            this._lastToolPayload = null;
            this._lastMcpListHash = null;
            this._lastMcpListPrompt = null;

            const mcpToolCount = allTools.length - getBuiltinToolDefinitions().length;
            logger.info(`[ToolManager] MCP tools registered — ${allTools.length} total tools (${mcpToolCount} MCP tools)`);
        } catch (error: unknown) {
            logger.error({ err: error }, '[ToolManager] Failed to register MCP tools');
        }
    }

    get sessionTotalToolTime(): number { return this._sessionTotalToolTime; }
    get sessionToolCallCount(): number { return this._sessionToolCallCount; }
    resetSessionTracking(): void { this._sessionTotalToolTime = 0; this._sessionToolCallCount = 0; }
}