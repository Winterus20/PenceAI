import type { ToolCall } from '../router/types.js';

export interface FallbackToolCallResult {
    calls: ToolCall[];
    rawMatches: string[];
}

export function extractFallbackToolCalls(content: string, knownToolNames: Set<string>): FallbackToolCallResult {
    const results: ToolCall[] = [];
    const rawMatches: string[] = [];

    const toolCodeBlockRegex = /```tool_code\s*([\s\S]*?)```/gi;
    for (const m of content.matchAll(toolCodeBlockRegex)) {
        const innerCalls = parseFunctionCallsFromText(m[1], knownToolNames);
        results.push(...innerCalls.calls);
        rawMatches.push(m[0]);
    }

    const toolCodeInlineRegex = /tool_code\s*\[?\s*([\s\S]*?)\s*\]?\s*(?:\n|$)/gi;
    if (results.length === 0) {
        for (const m of content.matchAll(toolCodeInlineRegex)) {
            const innerCalls = parseFunctionCallsFromText(m[1], knownToolNames);
            results.push(...innerCalls.calls);
            rawMatches.push(m[0]);
        }
    }

    if (results.length > 0) return { calls: results, rawMatches };

    const jsonBlockRegex = /\{[^{}]*\}/g;
    for (const m of content.matchAll(jsonBlockRegex)) {
        try {
            const parsed = JSON.parse(m[0]);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                const toolName = parsed.name || (parsed.type === 'function' && parsed.function?.name);
                if (toolName && knownToolNames.has(toolName)) {
                    const toolArgs = parsed.arguments || parsed.parameters || parsed.function?.arguments || {};
                    results.push({
                        id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                        name: toolName,
                        arguments: typeof toolArgs === 'string' ? safeJsonParse(toolArgs) : toolArgs,
                    });
                    rawMatches.push(m[0]);
                }
            }
        } catch {
        }
    }

    if (results.length === 0) {
        const greedyJsonRegex = /\{[\s\S]*?\}/g;
        for (const m of content.matchAll(greedyJsonRegex)) {
            try {
                const escaped = m[0].replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
                const parsed = JSON.parse(escaped);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    const toolName = parsed.name || (parsed.type === 'function' && parsed.function?.name);
                    if (toolName && knownToolNames.has(toolName)) {
                        const toolArgs = parsed.arguments || parsed.parameters || parsed.function?.arguments || {};
                        results.push({
                            id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                            name: toolName,
                            arguments: typeof toolArgs === 'string' ? safeJsonParse(toolArgs) : toolArgs,
                        });
                        rawMatches.push(m[0]);
                    }
                }
            } catch {
            }
        }
    }

    if (results.length > 0) return { calls: results, rawMatches };

    const functionResult = parseFunctionCallsFromText(content, knownToolNames);
    results.push(...functionResult.calls);
    rawMatches.push(...functionResult.rawMatches);

    return { calls: results, rawMatches };
}

export function parseFunctionCallsFromText(text: string, knownToolNames: Set<string>): FallbackToolCallResult {
    const results: ToolCall[] = [];
    const rawMatches: string[] = [];
    const toolNamePattern = Array.from(knownToolNames).join('|');
    const callStartRegex = new RegExp(`(${toolNamePattern})\\s*\\(`, 'g');

    let startMatch: RegExpExecArray | null;
    while ((startMatch = callStartRegex.exec(text)) !== null) {
        const toolName = startMatch[1];
        const argsStartIdx = startMatch.index + startMatch[0].length;
        let depth = 1;
        let idx = argsStartIdx;
        while (idx < text.length && depth > 0) {
            if (text[idx] === '(') depth++;
            else if (text[idx] === ')') depth--;
            idx++;
        }
        if (depth !== 0) continue;

        const rawMatchString = text.substring(startMatch.index, idx);
        const argsString = text.substring(argsStartIdx, idx - 1).trim();
        const parsedArgs = parseFallbackArgs(toolName, argsString);
        results.push({
            id: `call_${Date.now()}_func_${Math.random().toString(36).substring(2, 6)}`,
            name: toolName,
            arguments: parsedArgs,
        });
        rawMatches.push(rawMatchString);
    }
    return { calls: results, rawMatches };
}

export function parseFallbackArgs(toolName: string, argsString: string): Record<string, unknown> {
    if (!argsString.trim()) return {};

    if (argsString.trim().startsWith('{')) {
        try {
            return JSON.parse(argsString);
        } catch {
            try {
                const escaped = argsString.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
                return JSON.parse(escaped);
            } catch { }
        }
    }

    const kvPairs: Record<string, string> = {};
    const kvRegex = /([a-zA-Z0-9_]+)\s*=\s*(?:"([^"]*?)"|'([^']*?)')/g;
    let kvMatch: RegExpExecArray | null;
    while ((kvMatch = kvRegex.exec(argsString)) !== null) {
        kvPairs[kvMatch[1]] = kvMatch[2] ?? kvMatch[3];
    }
    if (Object.keys(kvPairs).length > 0) return kvPairs;

    const simpleKvMatch = argsString.match(/^([a-zA-Z0-9_]+)\s*=\s*(.+)$/s);
    if (simpleKvMatch) {
        return { [simpleKvMatch[1]]: simpleKvMatch[2].replace(/^["']|["']$/g, '').trim() };
    }

    const primaryParam = getPrimaryParam(toolName);
    return { [primaryParam]: argsString.replace(/^["']|["']$/g, '').trim() };
}

export function getPrimaryParam(toolName: string): string {
    if (toolName === 'listDirectory' || toolName === 'readFile' || toolName === 'writeFile' || toolName === 'editFile' || toolName === 'appendFile') return 'path';
    if (toolName === 'searchFiles') return 'pattern';
    if (toolName === 'executeShell') return 'command';
    if (toolName === 'searchConversation' || toolName === 'webSearch' || toolName === 'searchMemory') return 'query';
    if (toolName === 'deleteMemory') return 'id';
    if (toolName === 'saveMemory') return 'content';
    return 'path';
}

export function safeJsonParse(str: string): Record<string, unknown> {
    try { return JSON.parse(str); } catch {  }
    try { return JSON.parse(str.replace(/\\(?!["\\/bfnrtu])/g, '\\\\')); } catch {  }
    return {};
}