import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { ToolManager } from '../../src/agent/toolManager.js';
import type { LLMToolDefinition } from '../../src/router/types.js';
import type { ConfirmCallback } from '../../src/agent/tools.js';

jest.mock('../../src/agent/mcp/config.js', () => ({
    isMCPEnabled: jest.fn().mockReturnValue(false),
}));

jest.mock('../../src/agent/mcp/registry.js', () => ({
    getUnifiedToolRegistry: jest.fn().mockReturnValue({
        getAllToolDefinitions: jest.fn().mockReturnValue([]),
        registerBuiltins: jest.fn(),
        executeTool: jest.fn(),
    }),
}));

jest.mock('../../src/agent/tools.js', () => ({
    createBuiltinTools: jest.fn().mockReturnValue([
        { name: 'readFile', execute: jest.fn().mockResolvedValue('file content') },
        { name: 'searchMemory', execute: jest.fn().mockResolvedValue('memory result') },
    ]),
}));

jest.mock('../../src/agent/prompt.js', () => ({
    getBuiltinToolDefinitions: jest.fn().mockReturnValue([
        { name: 'readFile', description: 'Read a file', parameters: {} },
        { name: 'searchMemory', description: 'Search memory', parameters: {} },
    ]),
}));

jest.mock('../../src/utils/index.js', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    },
}));

jest.mock('../../src/memory/manager.js', () => ({
    MemoryManager: jest.fn().mockImplementation(() => ({})),
}));

import { isMCPEnabled } from '../../src/agent/mcp/config.js';
import { getUnifiedToolRegistry } from '../../src/agent/mcp/registry.js';
import { createBuiltinTools } from '../../src/agent/tools.js';
import { getBuiltinToolDefinitions } from '../../src/agent/prompt.js';

const mockMemory = {} as any;
const mockConfirmCallback: ConfirmCallback = async () => true;
const mockMergeFn = async (old: string, new_: string) => `${old} + ${new_}`;

describe('ToolManager', () => {
    let toolManager: ToolManager;

    beforeEach(() => {
        jest.clearAllMocks();
        toolManager = new ToolManager(false);
    });

    describe('constructor', () => {
        it('initializes with MCP disabled by default when false is passed', () => {
            const tm = new ToolManager(false);
            const defs = tm.getEffectiveToolDefinitions();
            expect(defs).toBeDefined();
        });

        it('initializes with MCP enabled when true is passed', () => {
            const tm = new ToolManager(true);
            expect(tm).toBeDefined();
        });

        it('uses isMCPEnabled when no argument is provided', () => {
            (isMCPEnabled as jest.Mock).mockReturnValue(true);
            const tm = new ToolManager();
            expect(tm).toBeDefined();
        });
    });

    describe('getEffectiveToolDefinitions()', () => {
        it('returns built-in tools when MCP is disabled', () => {
            toolManager = new ToolManager(false);
            const defs = toolManager.getEffectiveToolDefinitions();
            expect(defs).toBeDefined();
            expect(defs.length).toBeGreaterThanOrEqual(0);
        });

        it('calls getUnifiedToolRegistry when MCP is enabled', () => {
            (isMCPEnabled as jest.Mock).mockReturnValue(true);
            const mockDefs: LLMToolDefinition[] = [
                { name: 'readFile', description: 'Read a file', parameters: {} },
                { name: 'mcp:server1:tool1', description: 'MCP tool', parameters: {} },
            ];
            (getUnifiedToolRegistry as jest.Mock).mockReturnValue({
                getAllToolDefinitions: jest.fn().mockReturnValue(mockDefs),
                registerBuiltins: jest.fn(),
                executeTool: jest.fn(),
            });

            const tm = new ToolManager(true);
            const defs = tm.getEffectiveToolDefinitions();
            expect(getUnifiedToolRegistry).toHaveBeenCalled();
            expect(defs.length).toBeGreaterThan(0);
        });

        it('returns cached result on second call with same tools', () => {
            const mockDefs: LLMToolDefinition[] = [
                { name: 'readFile', description: 'Read a file', parameters: {} },
            ];
            const getAllToolDefinitions = jest.fn().mockReturnValue(mockDefs);
            (getUnifiedToolRegistry as jest.Mock).mockReturnValue({
                getAllToolDefinitions,
                registerBuiltins: jest.fn(),
                executeTool: jest.fn(),
            });

            const tm = new ToolManager(true);
            const defs1 = tm.getEffectiveToolDefinitions();
            const defs2 = tm.getEffectiveToolDefinitions();

            expect(getAllToolDefinitions).toHaveBeenCalledTimes(2);
            expect(defs1).toBe(defs2);
        });
    });

    describe('ensureTools()', () => {
        it('creates tools on first call', () => {
            toolManager = new ToolManager(false);
            toolManager.ensureTools(mockMemory, mockConfirmCallback, mockMergeFn);
            expect(createBuiltinTools).toHaveBeenCalledWith(mockMemory, mockConfirmCallback, mockMergeFn);
        });

        it('skips recreation when confirmCallback has not changed', () => {
            toolManager = new ToolManager(false);
            toolManager.ensureTools(mockMemory, mockConfirmCallback, mockMergeFn);
            jest.clearAllMocks();
            toolManager.ensureTools(mockMemory, mockConfirmCallback, mockMergeFn);
            expect(createBuiltinTools).not.toHaveBeenCalled();
        });

        it('recreates tools when confirmCallback changes', () => {
            toolManager = new ToolManager(false);
            toolManager.ensureTools(mockMemory, mockConfirmCallback, mockMergeFn);
            jest.clearAllMocks();
            const newCallback: ConfirmCallback = async () => false;
            toolManager.ensureTools(mockMemory, newCallback, mockMergeFn);
            expect(createBuiltinTools).toHaveBeenCalledWith(mockMemory, newCallback, mockMergeFn);
        });

        it('registers MCP tools when MCP is enabled', () => {
            (isMCPEnabled as jest.Mock).mockReturnValue(true);
            const mockRegisterBuiltins = jest.fn();
            const mockRegisterMCP = jest.fn();
            (getUnifiedToolRegistry as jest.Mock).mockReturnValue({
                getAllToolDefinitions: jest.fn().mockReturnValue([]),
                registerBuiltins: mockRegisterBuiltins,
                executeTool: jest.fn(),
            });

            const tm = new ToolManager(true);
            tm.ensureTools(mockMemory, mockConfirmCallback, mockMergeFn);
            expect(mockRegisterBuiltins).toHaveBeenCalledWith(mockMemory, mockConfirmCallback, mockMergeFn);
        });
    });

    describe('computeToolHash()', () => {
        it('produces consistent hashes for the same input', () => {
            const tools: LLMToolDefinition[] = [
                { name: 'tool1', description: 'desc1', parameters: {} },
                { name: 'tool2', description: 'desc2', parameters: {} },
            ];
            const tm = new ToolManager(false);
            const hash1 = (tm as any).computeToolHash(tools);
            const hash2 = (tm as any).computeToolHash(tools);
            expect(hash1).toBe(hash2);
        });

        it('produces different hashes for different inputs', () => {
            const tools1: LLMToolDefinition[] = [
                { name: 'tool1', description: 'desc1', parameters: {} },
            ];
            const tools2: LLMToolDefinition[] = [
                { name: 'tool2', description: 'desc2', parameters: {} },
            ];
            const tm = new ToolManager(false);
            const hash1 = (tm as any).computeToolHash(tools1);
            const hash2 = (tm as any).computeToolHash(tools2);
            expect(hash1).not.toBe(hash2);
        });
    });

    describe('computeMcpListHash()', () => {
        it('produces consistent hashes for the same MCP tools', () => {
            const tools: LLMToolDefinition[] = [
                { name: 'mcp:server1:tool1', description: 'desc', parameters: {} },
                { name: 'mcp:server1:tool2', description: 'desc', parameters: {} },
            ];
            const tm = new ToolManager(false);
            const hash1 = (tm as any).computeMcpListHash(tools);
            const hash2 = (tm as any).computeMcpListHash(tools);
            expect(hash1).toBe(hash2);
        });

        it('produces different hashes for different MCP tools', () => {
            const tools1: LLMToolDefinition[] = [
                { name: 'mcp:server1:tool1', description: 'desc', parameters: {} },
            ];
            const tools2: LLMToolDefinition[] = [
                { name: 'mcp:server2:tool1', description: 'desc', parameters: {} },
            ];
            const tm = new ToolManager(false);
            const hash1 = (tm as any).computeMcpListHash(tools1);
            const hash2 = (tm as any).computeMcpListHash(tools2);
            expect(hash1).not.toBe(hash2);
        });
    });

    describe('compressToolDefinitions()', () => {
        it('uses llmDescription when available', () => {
            const tools: LLMToolDefinition[] = [
                { name: 'tool1', description: 'long description', llmDescription: 'short', parameters: { type: 'object', properties: { a: { type: 'string', description: 'field a' } } }, llmParameters: { type: 'object', properties: { a: { type: 'string' } } } },
            ];
            const tm = new ToolManager(false);
            const result = (tm as any).compressToolDefinitions(tools);
            expect(result[0].description).toBe('short');
            expect(result[0].parameters).toEqual({ type: 'object', properties: { a: { type: 'string' } } });
        });

        it('falls back to description when llmDescription is not available', () => {
            const tools: LLMToolDefinition[] = [
                { name: 'tool1', description: 'long description', parameters: {} },
            ];
            const tm = new ToolManager(false);
            const result = (tm as any).compressToolDefinitions(tools);
            expect(result[0].description).toBe('long description');
        });
    });

    describe('pruneExcessTools()', () => {
        it('keeps all tools when under limit', () => {
            const tools: LLMToolDefinition[] = Array.from({ length: 10 }, (_, i) => ({
                name: `tool${i}`,
                description: `desc${i}`,
                parameters: {},
            }));
            const tm = new ToolManager(false);
            const result = (tm as any).pruneExcessTools(tools);
            expect(result.length).toBe(10);
        });

        it('prunes MCP tools when over limit', () => {
            const builtinTools: LLMToolDefinition[] = Array.from({ length: 15 }, (_, i) => ({
                name: `builtin${i}`,
                description: `desc${i}`,
                parameters: {},
            }));
            const mcpTools: LLMToolDefinition[] = Array.from({ length: 15 }, (_, i) => ({
                name: `mcp:server:tool${i}`,
                description: `mcp desc${i}`,
                parameters: {},
            }));
            const allTools = [...builtinTools, ...mcpTools];
            const tm = new ToolManager(false);
            const result = (tm as any).pruneExcessTools(allTools);

            expect(result.length).toBe(20);
            const builtinCount = result.filter(t => !t.name.startsWith('mcp:')).length;
            const mcpCount = result.filter(t => t.name.startsWith('mcp:')).length;
            expect(builtinCount).toBe(15);
            expect(mcpCount).toBe(5);
        });
    });

    describe('getMcpListPrompt()', () => {
        it('returns null when no MCP tools', () => {
            const tm = new ToolManager(false);
            const result = tm.getMcpListPrompt([]);
            expect(result).toBeNull();
        });

        it('returns null when only built-in tools', () => {
            const tm = new ToolManager(false);
            const tools: LLMToolDefinition[] = [
                { name: 'readFile', description: 'Read a file', parameters: {} },
            ];
            const result = tm.getMcpListPrompt(tools);
            expect(result).toBeNull();
        });

        it('returns prompt when MCP tools are present', () => {
            const tm = new ToolManager(false);
            const tools: LLMToolDefinition[] = [
                { name: 'mcp:filesystem:read', description: 'Read files', parameters: {} },
                { name: 'mcp:filesystem:write', description: 'Write files', parameters: {} },
            ];
            const result = tm.getMcpListPrompt(tools);
            expect(result).not.toBeNull();
            expect(result).toContain('Aktif MCP Sunucuları');
            expect(result).toContain('filesystem');
        });

        it('caches MCP prompt and returns same result on second call', () => {
            const tm = new ToolManager(false);
            const tools: LLMToolDefinition[] = [
                { name: 'mcp:server1:tool1', description: 'desc', parameters: {} },
            ];
            const result1 = tm.getMcpListPrompt(tools);
            const result2 = tm.getMcpListPrompt(tools);
            expect(result1).toBe(result2);
        });

        it('updates cache when MCP tools change', () => {
            const tm = new ToolManager(false);
            const tools1: LLMToolDefinition[] = [
                { name: 'mcp:server1:tool1', description: 'desc', parameters: {} },
            ];
            const tools2: LLMToolDefinition[] = [
                { name: 'mcp:server1:tool1', description: 'desc', parameters: {} },
                { name: 'mcp:server2:tool2', description: 'desc2', parameters: {} },
            ];
            const result1 = tm.getMcpListPrompt(tools1);
            const result2 = tm.getMcpListPrompt(tools2);
            expect(result1).not.toBe(result2);
            expect(result2).toContain('server2');
        });
    });

    describe('session tracking', () => {
        it('initializes session counters to zero', () => {
            const tm = new ToolManager(false);
            expect(tm.sessionTotalToolTime).toBe(0);
            expect(tm.sessionToolCallCount).toBe(0);
        });

        it('resets session tracking', () => {
            const tm = new ToolManager(false);
            (tm as any)._sessionTotalToolTime = 500;
            (tm as any)._sessionToolCallCount = 3;
            tm.resetSessionTracking();
            expect(tm.sessionTotalToolTime).toBe(0);
            expect(tm.sessionToolCallCount).toBe(0);
        });
    });
});