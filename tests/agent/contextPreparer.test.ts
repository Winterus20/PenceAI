import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { ContextPreparer } from '../../src/agent/contextPreparer.js';
import type { PreparedContext } from '../../src/agent/contextPreparer.js';
import type { MemoryRow } from '../../src/memory/types.js';
import type { ConversationMessage, LLMToolDefinition } from '../../src/router/types.js';

jest.mock('../../src/memory/manager/index.js', () => ({
    MemoryManager: jest.fn().mockImplementation(() => ({
        getMemoryNeighborsBatch: jest.fn(),
    })),
}));

jest.mock('../../src/memory/graphRAG/config.js', () => ({
    GraphRAGConfigManager: {
        getConfig: jest.fn().mockReturnValue({ sampleRate: 0.5 }),
    },
}));

jest.mock('../../src/agent/prompt.js', () => ({
    buildSystemPrompt: jest.fn().mockReturnValue('MOCK_SYSTEM_PROMPT'),
}));

jest.mock('../../src/agent/toolPromptBuilder.js', () => ({
    injectFallbackToolDirectives: jest.fn((prompt: string, _tools: unknown[]) => prompt + '\n[FALLBACK_INJECTED]'),
}));

jest.mock('../../src/agent/runtimeContext.js', () => ({
    formatRecentContextMessages: jest.fn().mockReturnValue(['[10:00] Kullanıcı: Merhaba']),
}));

jest.mock('../../src/utils/index.js', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    },
}));

import { MemoryManager } from '../../src/memory/manager/index.js';
import { buildSystemPrompt } from '../../src/agent/prompt.js';
import { injectFallbackToolDirectives } from '../../src/agent/toolPromptBuilder.js';
import { formatRecentContextMessages } from '../../src/agent/runtimeContext.js';
import { GraphRAGConfigManager } from '../../src/memory/graphRAG/config.js';

function makeMemoryRow(id: number, content: string): MemoryRow {
    return {
        id,
        user_id: 'default',
        category: 'fact',
        content,
        importance: 5,
        access_count: 1,
        is_archived: 0,
        last_accessed: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        provenance_source: null,
        provenance_conversation_id: null,
        provenance_message_id: null,
        confidence: null,
        review_profile: null,
        memory_type: 'semantic',
        stability: null,
        retrievability: null,
        next_review_at: null,
        review_count: null,
        max_importance: null,
    };
}

function makeConversationMessage(role: 'user' | 'assistant' | 'tool', content: string): ConversationMessage {
    return {
        role,
        content,
        timestamp: new Date(),
    };
}

describe('ContextPreparer', () => {
    let preparer: ContextPreparer;
    let mockMemory: jest.Mocked<MemoryManager>;

    beforeEach(() => {
        jest.clearAllMocks();
        mockMemory = new MemoryManager() as jest.Mocked<MemoryManager>;
        mockMemory.getMemoryNeighborsBatch = jest.fn().mockReturnValue(new Map());
        preparer = new ContextPreparer(mockMemory);
    });

    describe('getMemoryRelationsForPrompt()', () => {
        it('returns empty array for < 2 memories', () => {
            const result = preparer.getMemoryRelationsForPrompt([makeMemoryRow(1, 'test')]);
            expect(result).toEqual([]);
        });

        it('returns empty array for empty memories', () => {
            const result = preparer.getMemoryRelationsForPrompt([]);
            expect(result).toEqual([]);
        });

        it('returns relation strings for connected memories', () => {
            const memories = [makeMemoryRow(1, 'Kullanıcı Python seviyor'), makeMemoryRow(2, 'Kullanıcı FastAPI projesi var')];

            const neighbors = new Map<number, Array<{ id: number; content: string; relation_type: string; relation_description: string }>>();
            neighbors.set(1, [{ id: 2, content: 'Kullanıcı FastAPI projesi var', relation_type: 'related_to', relation_description: 'Python ve FastAPI ilişkili', confidence: 0.8 }]);
            neighbors.set(2, []);

            mockMemory.getMemoryNeighborsBatch = jest.fn().mockReturnValue(neighbors);

            const result = preparer.getMemoryRelationsForPrompt(memories);

            expect(result.length).toBeGreaterThan(0);
            expect(result[0].source).toContain('Kullanıcı Python');
            expect(result[0].target).toContain('Kullanıcı FastAPI');
            expect(result[0].relation).toBe('related_to');
        });

        it('deduplicates relations with canonical key check', () => {
            const memories = [makeMemoryRow(1, 'Memory 1'), makeMemoryRow(2, 'Memory 2')];

            const neighbors = new Map<number, Array<{ id: number; content: string; relation_type: string; relation_description: string }>>();
            neighbors.set(1, [{ id: 2, content: 'Memory 2', relation_type: 'related_to', relation_description: 'desc1' }]);
            neighbors.set(2, [{ id: 1, content: 'Memory 1', relation_type: 'related_to', relation_description: 'desc2' }]);

            mockMemory.getMemoryNeighborsBatch = jest.fn().mockReturnValue(neighbors);

            const result = preparer.getMemoryRelationsForPrompt(memories);

            const pairCount = result.filter(r =>
                (r.source.includes('Memory 1') || r.source.includes('Memory 2')) &&
                (r.target.includes('Memory 1') || r.target.includes('Memory 2'))
            ).length;
            expect(pairCount).toBeLessThanOrEqual(1);
        });

        it('limits relations to 15', () => {
            const memories = Array.from({ length: 20 }, (_, i) => makeMemoryRow(i + 1, `Memory ${i + 1}`));

            const neighbors = new Map<number, Array<{ id: number; content: string; relation_type: string; relation_description: string }>>();
            for (let i = 1; i <= 20; i++) {
                const related = [];
                for (let j = 1; j <= 20; j++) {
                    if (i !== j) {
                        related.push({ id: j, content: `Memory ${j}`, relation_type: 'related_to', relation_description: '' });
                    }
                }
                neighbors.set(i, related);
            }

            mockMemory.getMemoryNeighborsBatch = jest.fn().mockReturnValue(neighbors);

            const result = preparer.getMemoryRelationsForPrompt(memories);
            expect(result.length).toBeLessThanOrEqual(15);
        });
    });

    describe('prepare()', () => {
        function defaultParams(overrides?: Record<string, unknown>) {
            return {
                senderName: 'TestUser',
                userMessage: 'Merhaba',
                relevantMemories: [] as MemoryRow[],
                supplementalMemories: [] as MemoryRow[],
                archivalMemories: [] as MemoryRow[],
                reviewMemories: [] as MemoryRow[],
                followUpCandidates: [] as MemoryRow[],
                conversationSummaries: [] as Array<{ title: string; summary: string; updated_at: string }>,
                recentMessages: [] as Array<{ role: string; content: string; created_at: string; conversation_title: string }>,
                history: [] as ConversationMessage[],
                graphRAGCommunitySummaries: [] as Array<{ id: string; summary: string }>,
                shouldAddCommunitySummaries: false,
                communitySummariesFormatted: null as string | null,
                allTools: [] as LLMToolDefinition[],
                mcpListPrompt: null as string | null,
                requiresFallback: false,
                messageContent: {
                    content: 'Merhaba',
                    attachments: [] as Array<{ type: string; data: Buffer | string; fileName?: string; mimeType: string; size: number }>,
                },
                getBase64: (_buf: unknown) => undefined as string | undefined,
                ...overrides,
            };
        }

        it('builds system prompt with memories', () => {
            const memories = [makeMemoryRow(1, 'Kullanıcı kahve seviyor')];
            const result = preparer.prepare(defaultParams({
                relevantMemories: memories,
            }));

            expect(buildSystemPrompt).toHaveBeenCalled();
            expect(result.systemPrompt).toBe('MOCK_SYSTEM_PROMPT');
            expect(result.finalSystemPrompt).toBe('MOCK_SYSTEM_PROMPT');
        });

        it('trims memory strings to token budget', () => {
            const longMemories = Array.from({ length: 200 }, (_, i) => makeMemoryRow(i + 1, 'Kullanıcı çok uzun bir bellek içeriği var ' + ' Lorem ipsum '.repeat(20)));

            const result = preparer.prepare(defaultParams({
                relevantMemories: longMemories,
            }));

            expect(result.trimmedMemories.length).toBeLessThan(longMemories.length);
            expect(result.memoryTokensUsed).toBeGreaterThan(0);
        });

        it('appends community summaries when provided', () => {
            const result = preparer.prepare(defaultParams({
                shouldAddCommunitySummaries: true,
                communitySummariesFormatted: '- **Community1**: Test summary',
            }));

            expect(result.systemPrompt).toContain('GraphRAG Community Context');
            expect(result.systemPrompt).toContain('Test summary');
        });

        it('does not append community summaries when flag is false', () => {
            const result = preparer.prepare(defaultParams({
                shouldAddCommunitySummaries: false,
                communitySummariesFormatted: null,
            }));

            expect(result.systemPrompt).toBe('MOCK_SYSTEM_PROMPT');
        });

        it('appends MCP prompt when provided', () => {
            const result = preparer.prepare(defaultParams({
                mcpListPrompt: '\n## MCP Tools\n- tool1',
            }));

            expect(result.systemPrompt).toContain('MCP Tools');
        });

        it('injects fallback directives when requiresFallback is true', () => {
            const result = preparer.prepare(defaultParams({
                requiresFallback: true,
                allTools: [{ name: 'testTool', description: 'A test tool', parameters: {} }],
            }));

            expect(injectFallbackToolDirectives).toHaveBeenCalled();
            expect(result.finalSystemPrompt).toContain('FALLBACK_INJECTED');
        });

        it('does not inject fallback directives when requiresFallback is false', () => {
            const result = preparer.prepare(defaultParams({
                requiresFallback: false,
            }));

            expect(injectFallbackToolDirectives).not.toHaveBeenCalled();
            expect(result.finalSystemPrompt).toBe(result.systemPrompt);
        });

        it('counts context tokens correctly', () => {
            const result = preparer.prepare(defaultParams({
                history: [
                    makeConversationMessage('user', 'Merhaba'),
                    makeConversationMessage('assistant', 'Selam!'),
                ],
                messageContent: {
                    content: 'Nasılsın?',
                    attachments: [],
                },
            }));

            expect(result.contextTokenInfo.systemPromptTokens).toBeGreaterThan(0);
            expect(typeof result.contextTokenInfo.userMsgTokens).toBe('number');
            expect(typeof result.contextTokenInfo.pastHistoryTokens).toBe('number');
        });

        it('handles image attachments in LLM messages', () => {
            const fakeBase64 = 'fakeBase64ImageData';
            const getBase64Mock = jest.fn().mockReturnValue(fakeBase64);

            const result = preparer.prepare(defaultParams({
                history: [
                    makeConversationMessage('user', 'Resmi gör'),
                ],
                messageContent: {
                    content: 'Resmi gör',
                    attachments: [{
                        type: 'image',
                        data: Buffer.from('image-data'),
                        fileName: 'test.png',
                        mimeType: 'image/png',
                        size: 100,
                    }],
                },
                getBase64: getBase64Mock,
            }));

            const lastUserMsg = result.llmMessages.find(m => m.role === 'user');
            expect(lastUserMsg).toBeDefined();
            expect(lastUserMsg!.imageBlocks).toBeDefined();
            expect(lastUserMsg!.imageBlocks!.length).toBe(1);
            expect(lastUserMsg!.imageBlocks![0].mimeType).toBe('image/png');
        });

        it('uses higher MAX_MEMORY_TOKENS when sampleRate is 1.0', () => {
            (GraphRAGConfigManager.getConfig as jest.Mock).mockReturnValue({ sampleRate: 1.0 });

            const result = preparer.prepare(defaultParams());
            expect(result.maxMemoryTokens).toBe(2500);

            (GraphRAGConfigManager.getConfig as jest.Mock).mockReturnValue({ sampleRate: 0.5 });
        });

        it('builds LLM messages from history', () => {
            const history = [
                makeConversationMessage('user', 'Hi'),
                makeConversationMessage('assistant', 'Hello!'),
                makeConversationMessage('user', 'How are you?'),
            ];

            const result = preparer.prepare(defaultParams({ history }));

            expect(result.llmMessages.length).toBe(3);
            expect(result.llmMessages[0].role).toBe('user');
            expect(result.llmMessages[0].content).toBe('Hi');
            expect(result.llmMessages[1].role).toBe('assistant');
            expect(result.llmMessages[2].content).toBe('How are you?');
        });

        it('passes formatRecentContextMessages result to buildSystemPrompt', () => {
            const recentMessages = [{ role: 'user', content: 'Merhaba', created_at: '2024-01-01T10:00:00Z', conversation_title: 'Test' }];

            preparer.prepare(defaultParams({ recentMessages }));

            expect(formatRecentContextMessages).toHaveBeenCalledWith(recentMessages);
        });
    });
});