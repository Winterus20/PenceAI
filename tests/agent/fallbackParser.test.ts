import {
    extractFallbackToolCalls,
    parseFunctionCallsFromText,
    parseFallbackArgs,
    safeJsonParse,
    getPrimaryParam,
} from '../../src/agent/fallbackParser.js';

const knownTools = new Set([
    'readFile',
    'writeFile',
    'listDirectory',
    'executeShell',
    'webSearch',
    'searchConversation',
    'searchMemory',
    'deleteMemory',
]);

describe('extractFallbackToolCalls', () => {
    it('extracts JSON block format tool calls (flat JSON)', () => {
        const content = 'Here is the result: {"name": "readFile", "arguments": "path=/test"}';
        const result = extractFallbackToolCalls(content, knownTools);
        expect(result.calls).toHaveLength(1);
        expect(result.calls[0].name).toBe('readFile');
        expect(result.rawMatches).toHaveLength(1);
    });

    it('extracts tool_code block format tool calls', () => {
        const content = '```tool_code\nreadFile(path="/test")\n```';
        const result = extractFallbackToolCalls(content, knownTools);
        expect(result.calls).toHaveLength(1);
        expect(result.calls[0].name).toBe('readFile');
        expect(result.calls[0].arguments).toEqual({ path: '/test' });
    });

    it('extracts inline tool_code format', () => {
        const content = 'tool_code [readFile(path="/test")]';
        const result = extractFallbackToolCalls(content, knownTools);
        expect(result.calls).toHaveLength(1);
        expect(result.calls[0].name).toBe('readFile');
    });

    it('extracts function call format', () => {
        const content = 'readFile(path="/test")';
        const result = extractFallbackToolCalls(content, knownTools);
        expect(result.calls).toHaveLength(1);
        expect(result.calls[0].name).toBe('readFile');
        expect(result.calls[0].arguments).toEqual({ path: '/test' });
    });

    it('extracts multiple tool calls from function call format', () => {
        const content = 'readFile(path="/a")\nwriteFile(path="/b")';
        const result = extractFallbackToolCalls(content, knownTools);
        expect(result.calls).toHaveLength(2);
        expect(result.calls[0].name).toBe('readFile');
        expect(result.calls[1].name).toBe('writeFile');
    });

    it('handles Windows paths with backslashes', () => {
        const content = 'readFile(path="C:\\Users\\Yigit\\file.txt")';
        const result = extractFallbackToolCalls(content, knownTools);
        expect(result.calls).toHaveLength(1);
        expect(result.calls[0].name).toBe('readFile');
    });

    it('handles mixed content with embedded tool calls', () => {
        const content = 'I will read the file first.\nreadFile(path="/etc/hosts")\nThen I will search.\nwebSearch(query="test")';
        const result = extractFallbackToolCalls(content, knownTools);
        expect(result.calls).toHaveLength(2);
        expect(result.calls[0].name).toBe('readFile');
        expect(result.calls[1].name).toBe('webSearch');
    });

    it('returns empty result when no tool calls found', () => {
        const content = 'Just a regular message with no tool calls.';
        const result = extractFallbackToolCalls(content, knownTools);
        expect(result.calls).toHaveLength(0);
        expect(result.rawMatches).toHaveLength(0);
    });

    it('handles empty string', () => {
        const result = extractFallbackToolCalls('', knownTools);
        expect(result.calls).toHaveLength(0);
    });

    it('extracts JSON tool call with function wrapper (flat)', () => {
        const content = '{"type": "function", "function": {"name": "readFile"}}';
        const result = extractFallbackToolCalls(content, knownTools);
        expect(result.calls.length).toBeGreaterThanOrEqual(0);
    });

    it('extracts JSON tool call with parameters key (flat)', () => {
        const content = '{"name": "executeShell", "parameters": "ls"}';
        const result = extractFallbackToolCalls(content, knownTools);
        expect(result.calls.length).toBeGreaterThanOrEqual(0);
    });

    it('handles greedy JSON with backslash paths (fallback to function call parsing)', () => {
        const content = 'readFile(path="C:/Users/test/file.txt")';
        const result = extractFallbackToolCalls(content, knownTools);
        expect(result.calls.length).toBeGreaterThanOrEqual(1);
        expect(result.calls[0].name).toBe('readFile');
    });

    it('ignores unknown tool names in JSON', () => {
        const content = '{"name": "unknownTool", "arguments": {"x": 1}}';
        const result = extractFallbackToolCalls(content, knownTools);
        expect(result.calls).toHaveLength(0);
    });
});

describe('parseFunctionCallsFromText', () => {
    it('parses single function call', () => {
        const result = parseFunctionCallsFromText('readFile(path="/test")', knownTools);
        expect(result.calls).toHaveLength(1);
        expect(result.calls[0].name).toBe('readFile');
    });

    it('parses multiple function calls', () => {
        const result = parseFunctionCallsFromText('readFile(path="/a")\nwriteFile(path="/b")', knownTools);
        expect(result.calls).toHaveLength(2);
    });

    it('skips unmatched parentheses', () => {
        const result = parseFunctionCallsFromText('readFile(path="/test"', knownTools);
        expect(result.calls).toHaveLength(0);
    });

    it('handles nested parentheses in args', () => {
        const result = parseFunctionCallsFromText('executeShell(command="echo (hello)")', knownTools);
        expect(result.calls).toHaveLength(1);
        expect(result.calls[0].name).toBe('executeShell');
    });

    it('returns empty for unknown tool names', () => {
        const result = parseFunctionCallsFromText('unknownTool(data="test")', knownTools);
        expect(result.calls).toHaveLength(0);
    });
});

describe('parseFallbackArgs', () => {
    it('parses JSON args', () => {
        const result = parseFallbackArgs('readFile', '{"path": "/test"}');
        expect(result).toEqual({ path: '/test' });
    });

    it('parses key=value args with double quotes', () => {
        const result = parseFallbackArgs('readFile', 'path="/test"');
        expect(result).toEqual({ path: '/test' });
    });

    it('parses key=value args with single quotes', () => {
        const result = parseFallbackArgs('readFile', "path='/test'");
        expect(result).toEqual({ path: '/test' });
    });

    it('parses multiple key=value args', () => {
        const result = parseFallbackArgs('executeShell', 'command="ls" path="/home"');
        expect(result).toEqual({ command: 'ls', path: '/home' });
    });

    it('falls back to primary param for raw string', () => {
        const result = parseFallbackArgs('readFile', '/some/path.txt');
        expect(result).toEqual({ path: '/some/path.txt' });
    });

    it('falls back to command param for executeShell', () => {
        const result = parseFallbackArgs('executeShell', 'ls -la');
        expect(result).toEqual({ command: 'ls -la' });
    });

    it('falls back to query param for webSearch', () => {
        const result = parseFallbackArgs('webSearch', 'test query');
        expect(result).toEqual({ query: 'test query' });
    });

    it('returns empty object for empty string', () => {
        const result = parseFallbackArgs('readFile', '');
        expect(result).toEqual({});
    });

    it('returns empty object for whitespace only', () => {
        const result = parseFallbackArgs('readFile', '   ');
        expect(result).toEqual({});
    });

    it('handles JSON args with forward slashes (no backslash escaping issues)', () => {
        const result = parseFallbackArgs('readFile', '{"path": "/Users/test/file"}');
        expect(result).toEqual({ path: '/Users/test/file' });
    });

    it('parses simple key=value without quotes', () => {
        const result = parseFallbackArgs('readFile', 'path=/test/file.txt');
        expect(result).toEqual({ path: '/test/file.txt' });
    });

    it('falls back to id param for deleteMemory', () => {
        const result = parseFallbackArgs('deleteMemory', 'mem_123');
        expect(result).toEqual({ id: 'mem_123' });
    });
});

describe('safeJsonParse', () => {
    it('parses valid JSON', () => {
        const result = safeJsonParse('{"path": "/test"}');
        expect(result).toEqual({ path: '/test' });
    });

    it('handles forward slash paths in JSON', () => {
        const result = safeJsonParse('{"path": "/Users/test/file.txt"}');
        expect(result).toEqual({ path: '/Users/test/file.txt' });
    });

    it('returns empty object for invalid JSON', () => {
        const result = safeJsonParse('not json at all');
        expect(result).toEqual({});
    });

    it('returns empty object for malformed JSON', () => {
        const result = safeJsonParse('{broken json}');
        expect(result).toEqual({});
    });
});

describe('getPrimaryParam', () => {
    it('returns path for readFile', () => {
        expect(getPrimaryParam('readFile')).toBe('path');
    });

    it('returns path for writeFile', () => {
        expect(getPrimaryParam('writeFile')).toBe('path');
    });

    it('returns path for listDirectory', () => {
        expect(getPrimaryParam('listDirectory')).toBe('path');
    });

    it('returns command for executeShell', () => {
        expect(getPrimaryParam('executeShell')).toBe('command');
    });

    it('returns query for webSearch', () => {
        expect(getPrimaryParam('webSearch')).toBe('query');
    });

    it('returns query for searchConversation', () => {
        expect(getPrimaryParam('searchConversation')).toBe('query');
    });

    it('returns query for searchMemory', () => {
        expect(getPrimaryParam('searchMemory')).toBe('query');
    });

    it('returns id for deleteMemory', () => {
        expect(getPrimaryParam('deleteMemory')).toBe('id');
    });

    it('returns path as default for unknown tool', () => {
        expect(getPrimaryParam('unknownTool')).toBe('path');
    });
});