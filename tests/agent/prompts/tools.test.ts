import { getBuiltinToolDefinitions } from '../../../src/agent/prompts/tools.js';
import type { LLMToolDefinition } from '../../../src/router/types.js';

jest.mock('../../../src/gateway/config.js', () => ({
    getConfig: jest.fn(),
}));

import { getConfig } from '../../../src/gateway/config.js';

const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;

describe('getBuiltinToolDefinitions', () => {
    beforeEach(() => {
        mockedGetConfig.mockReset();
    });

    it('returns an array of LLMToolDefinition objects', () => {
        mockedGetConfig.mockReturnValue({ allowShellExecution: false } as any);
        const tools = getBuiltinToolDefinitions();
        expect(Array.isArray(tools)).toBe(true);
        expect(tools.length).toBeGreaterThan(0);
        tools.forEach((tool: LLMToolDefinition) => {
            expect(tool).toHaveProperty('name');
            expect(tool).toHaveProperty('description');
            expect(tool).toHaveProperty('parameters');
            expect(tool).toHaveProperty('llmParameters');
        });
    });

    it('includes webSearch tool unconditionally', () => {
        mockedGetConfig.mockReturnValue({ allowShellExecution: false } as any);
        const tools = getBuiltinToolDefinitions();
        const webSearch = tools.find(t => t.name === 'webSearch');
        expect(webSearch).toBeDefined();
        expect(webSearch?.llmDescription).toBe("Web'de ara (çoklu kaynak — genel bilgi toplama)");
    });

    it('includes executeShell when allowShellExecution is true', () => {
        mockedGetConfig.mockReturnValue({ allowShellExecution: true } as any);
        const tools = getBuiltinToolDefinitions();
        const shell = tools.find(t => t.name === 'executeShell');
        expect(shell).toBeDefined();
        expect(tools.length).toBe(18);
    });

    it('excludes executeShell when allowShellExecution is false', () => {
        mockedGetConfig.mockReturnValue({ allowShellExecution: false } as any);
        const tools = getBuiltinToolDefinitions();
        const shell = tools.find(t => t.name === 'executeShell');
        expect(shell).toBeUndefined();
        expect(tools.length).toBe(17);
    });

    it('has llmParameters that are a subset of parameters for all tools', () => {
        mockedGetConfig.mockReturnValue({ allowShellExecution: true } as any);
        const tools = getBuiltinToolDefinitions();
        tools.forEach((tool: LLMToolDefinition) => {
            expect(tool.llmParameters).toBeDefined();
            expect(tool.parameters).toBeDefined();
            expect(tool.llmParameters!.type).toBe('object');
        });
    });

    it('contains expected core tools', () => {
        mockedGetConfig.mockReturnValue({ allowShellExecution: false } as any);
        const tools = getBuiltinToolDefinitions();
        const names = tools.map(t => t.name);
        const expected = [
            'readFile', 'editFile', 'appendFile', 'searchFiles',
            'writeFile', 'listDirectory', 'searchMemory', 'deleteMemory',
            'saveMemory', 'searchConversation', 'webTool',
            'wake_me_in', 'wake_me_every', 'cancel_timer', 'list_timers',
            'prompt_human', 'webSearch',
        ];
        expected.forEach(name => {
            expect(names).toContain(name);
        });
    });
});
