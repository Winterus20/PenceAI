import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { MemoryExtractor } from '../../src/agent/memoryExtractor.js';

jest.mock('../../src/agent/prompt.js', () => ({
    buildLightExtractionPrompt: jest.fn().mockReturnValue('MOCK_LIGHT_PROMPT'),
    buildDeepExtractionPrompt: jest.fn().mockReturnValue('MOCK_DEEP_PROMPT'),
    buildSummarizationPrompt: jest.fn().mockReturnValue('MOCK_SUMMARIZATION_PROMPT'),
    buildEntityExtractionPrompt: jest.fn().mockReturnValue('MOCK_ENTITY_PROMPT'),
}));

jest.mock('../../src/utils/index.js', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    },
}));

const mockLLMChat = jest.fn();
const mockLLM: any = {
    name: 'mock',
    supportedModels: ['mock-model'],
    chat: mockLLMChat,
    chatStream: undefined,
    supportsNativeToolCalling: false,
    healthCheck: jest.fn().mockResolvedValue(true),
};

const mockAddMemory = jest.fn();
const mockSemanticSearch = jest.fn();
const mockGetUserMemories = jest.fn();
const mockGetConversationTranscriptBundle = jest.fn();
const mockUpdateConversationSummary = jest.fn();
const mockUpdateConversationTitle = jest.fn();
const mockHybridSearch = jest.fn();
const mockProcessMemoryGraph = jest.fn();

const mockMemory: any = {
    addMemory: mockAddMemory,
    semanticSearch: mockSemanticSearch,
    getUserMemories: mockGetUserMemories,
    getConversationTranscriptBundle: mockGetConversationTranscriptBundle,
    updateConversationSummary: mockUpdateConversationSummary,
    updateConversationTitle: mockUpdateConversationTitle,
    hybridSearch: mockHybridSearch,
    processMemoryGraph: mockProcessMemoryGraph,
};

describe('MemoryExtractor', () => {
    let extractor: MemoryExtractor;

    beforeEach(() => {
        jest.clearAllMocks();
        extractor = new MemoryExtractor(mockLLM, mockMemory);
    });

    describe('createMergeFn()', () => {
        it('returns a function that merges old and new content via LLM', async () => {
            mockLLMChat.mockResolvedValue({ content: ' merged result ' });

            const mergeFn = extractor.createMergeFn('Ahmet');
            const result = await mergeFn('old info', 'new info');

            expect(result).toBe('merged result');
            expect(mockLLMChat).toHaveBeenCalledTimes(1);
            const call = mockLLMChat.mock.calls[0];
            expect(call[0][0].role).toBe('user');
            expect(call[0][0].content).toContain('new info');
            expect(call[0][0].content).toContain('old info');
            expect(call[1].systemPrompt).toContain('bellek yöneticisisin');
        });

        it('uses default userName when not provided', async () => {
            mockLLMChat.mockResolvedValue({ content: 'result' });

            const mergeFn = extractor.createMergeFn();
            await mergeFn('old', 'new');

            const call = mockLLMChat.mock.calls[0];
            expect(call[0][0].content).toContain('Kullanıcı');
        });
    });

    describe('parseExtractionResponse()', () => {
        it('parses valid JSON array', () => {
            const input = JSON.stringify([
                { content: 'likes running', category: 'habit', importance: 7 },
                { content: 'lives in Istanbul', category: 'fact', importance: 5 },
            ]);

            const result = extractor.parseExtractionResponse(input);

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ content: 'likes running', category: 'habit', importance: 7 });
            expect(result[1]).toEqual({ content: 'lives in Istanbul', category: 'fact', importance: 5 });
        });

        it('returns empty array for empty array input', () => {
            const result = extractor.parseExtractionResponse('[]');
            expect(result).toEqual([]);
        });

        it('handles markdown-wrapped JSON', () => {
            const json = JSON.stringify([
                { content: 'likes cats', category: 'preference', importance: 8 },
            ]);
            const input = '```json\n' + json + '\n```';

            const result = extractor.parseExtractionResponse(input);

            expect(result).toHaveLength(1);
            expect(result[0].content).toBe('likes cats');
        });

        it('returns empty array for invalid JSON', () => {
            const result = extractor.parseExtractionResponse('this is not json');
            expect(result).toEqual([]);
        });

        it('clamps importance to 1-10 range', () => {
            const input = JSON.stringify([
                { content: 'a', category: 'fact', importance: 15 },
                { content: 'b', category: 'fact', importance: -3 },
            ]);

            const result = extractor.parseExtractionResponse(input);

            expect(result[0].importance).toBe(10);
            expect(result[1].importance).toBe(1);
        });

        it('defaults unknown category to "other"', () => {
            const input = JSON.stringify([
                { content: 'something', category: 'unknown_cat', importance: 5 },
            ]);

            const result = extractor.parseExtractionResponse(input);

            expect(result[0].category).toBe('other');
        });

        it('defaults missing importance to 5', () => {
            const input = JSON.stringify([
                { content: 'something', category: 'fact' },
            ]);

            const result = extractor.parseExtractionResponse(input);

            expect(result[0].importance).toBe(5);
        });

        it('filters out items without valid content', () => {
            const input = JSON.stringify([
                { content: '', category: 'fact', importance: 5 },
                { content: 123, category: 'fact', importance: 5 },
                { content: 'valid', category: 'fact', importance: 5 },
            ]);

            const result = extractor.parseExtractionResponse(input);

            expect(result).toHaveLength(1);
            expect(result[0].content).toBe('valid');
        });
    });

    describe('pushExtractionContext() and checkAndPrepareExtraction()', () => {
        it('does not trigger extraction before INTERVAL messages', () => {
            extractor.pushExtractionContext({ user: 'hello', assistant: 'hi', prevAssistant: '', userName: 'Test' });

            const result = extractor.checkAndPrepareExtraction();

            expect(result.shouldExtract).toBe(false);
        });

        it('triggers extraction after INTERVAL messages', () => {
            extractor.pushExtractionContext({ user: 'msg1', assistant: 'resp1', prevAssistant: 'prev1', userName: 'Ahmet' });
            extractor.pushExtractionContext({ user: 'msg2', assistant: 'resp2', prevAssistant: '', userName: 'Ayse' });
            const result1 = extractor.checkAndPrepareExtraction();
            expect(result1.shouldExtract).toBe(false);

            extractor.pushExtractionContext({ user: 'msg3', assistant: 'resp3', prevAssistant: 'prev3', userName: 'Ahmet' });
            const result2 = extractor.checkAndPrepareExtraction();
            expect(result2.shouldExtract).toBe(true);
            expect(result2.combinedUser).toBe('msg1\nmsg2\nmsg3');
            expect(result2.combinedAssistant).toBe('resp1\nresp2\nresp3');
            expect(result2.combinedPrev).toBe('prev1\nprev3');
            expect(result2.contextUserName).toBe('Ahmet');
        });

        it('resets counter after extraction', () => {
            for (let i = 0; i < MemoryExtractor.EXTRACTION_INTERVAL; i++) {
                extractor.pushExtractionContext({ user: `msg${i}`, assistant: `resp${i}`, prevAssistant: '', userName: 'Test' });
            }
            const result = extractor.checkAndPrepareExtraction();
            expect(result.shouldExtract).toBe(true);

            const nextResult = extractor.checkAndPrepareExtraction();
            expect(nextResult.shouldExtract).toBe(false);
        });
    });

    describe('extractMemoriesLight()', () => {
        it('skips extraction for very short messages without previous context', async () => {
            await extractor.extractMemoriesLight('hi', '', '', 'Test');

            expect(mockLLMChat).not.toHaveBeenCalled();
        });

        it('proceeds with short messages if previous context exists', async () => {
            mockSemanticSearch.mockResolvedValue([]);
            mockLLMChat.mockResolvedValue({ content: '[]' });

            await extractor.extractMemoriesLight('short', 'response', 'prev context', 'Test');

            expect(mockLLMChat).toHaveBeenCalledTimes(1);
        });

        it('extracts and stores memories', async () => {
            mockSemanticSearch.mockResolvedValue([]);
            mockLLMChat.mockResolvedValue({
                content: JSON.stringify([
                    { content: 'likes tea', category: 'preference', importance: 7 },
                ]),
            });
            mockAddMemory.mockResolvedValue({ id: 42 });
            mockHybridSearch.mockResolvedValue([]);

            await extractor.extractMemoriesLight('I really love drinking tea every morning', 'Great choice!', '', 'Ahmet');

            expect(mockAddMemory).toHaveBeenCalledTimes(1);
            expect(mockAddMemory).toHaveBeenCalledWith('likes tea', 'preference', 7, expect.any(Function));
        });
    });

    describe('extractMemoriesDeep()', () => {
        it('skips extraction for short conversations', async () => {
            mockGetConversationTranscriptBundle.mockReturnValue({
                history: [{ content: 'one' }],
                conversationText: 'one',
                userName: 'Test',
            });

            await extractor.extractMemoriesDeep('conv-123');

            expect(mockLLMChat).not.toHaveBeenCalled();
        });

        it('extracts memories from full conversations', async () => {
            mockGetConversationTranscriptBundle.mockReturnValue({
                history: [{ content: 'hello' }, { content: 'hi' }],
                conversationText: 'User: hello\nAssistant: hi',
                userName: 'TestUser',
            });
            mockSemanticSearch.mockResolvedValue([]);
            mockLLMChat.mockResolvedValue({
                content: JSON.stringify([
                    { content: 'test fact', category: 'fact', importance: 5 },
                ]),
            });
            mockAddMemory.mockResolvedValue({ id: 1 });
            mockHybridSearch.mockResolvedValue([]);

            await extractor.extractMemoriesDeep('conv-456');

            expect(mockLLMChat).toHaveBeenCalledTimes(1);
            expect(mockAddMemory).toHaveBeenCalledTimes(1);
        });
    });

    describe('formatExistingMemoriesForLLM()', () => {
        it('formats memories with similarity', () => {
            const memories = [
                { id: 1, content: 'likes coffee', similarity: 0.85 },
                { id: 2, content: 'works at home', similarity: 0.78 },
            ];

            const result = (extractor as any).formatExistingMemoriesForLLM(memories);

            expect(result).toContain('likes coffee');
            expect(result).toContain('works at home');
            expect(result).toContain('85%');
            expect(result).toContain('78%');
            expect(result).toContain('Bellekte Zaten Kayıtlı Benzer Bilgiler');
        });

        it('filters out low similarity memories', () => {
            const memories = [
                { id: 1, content: 'low sim', similarity: 0.5 },
            ];

            const result = (extractor as any).formatExistingMemoriesForLLM(memories);

            expect(result.trim()).toBe('');
        });

        it('returns empty string for empty memories', () => {
            const result = (extractor as any).formatExistingMemoriesForLLM([]);

            expect(result).toBe('');
        });
    });

    describe('summarizeConversation()', () => {
        it('skips summarization for short conversations', async () => {
            mockGetConversationTranscriptBundle.mockReturnValue({
                history: [{ content: 'one' }],
                conversationText: 'one',
                userName: 'Test',
            });

            await extractor.summarizeConversation('conv-short');

            expect(mockLLMChat).not.toHaveBeenCalled();
        });

        it('summarizes conversation and updates title', async () => {
            mockGetConversationTranscriptBundle.mockReturnValue({
                history: [{ content: 'hello' }, { content: 'hi' }],
                conversationText: 'User: hello\nAssistant: hi',
                userName: 'Test',
            });
            mockLLMChat.mockResolvedValue({
                content: JSON.stringify({ summary: 'A greeting', title: 'Greetings' }),
            });

            await extractor.summarizeConversation('conv-abc');

            expect(mockUpdateConversationSummary).toHaveBeenCalledWith('conv-abc', 'A greeting');
            expect(mockUpdateConversationTitle).toHaveBeenCalledWith('conv-abc', 'Greetings', false);
        });

        it('falls back to plain text if JSON parse fails', async () => {
            mockGetConversationTranscriptBundle.mockReturnValue({
                history: [{ content: 'hello' }, { content: 'hi' }],
                conversationText: 'User: hello\nAssistant: hi',
                userName: 'Test',
            });
            mockLLMChat.mockResolvedValue({
                content: 'Just a plain summary',
            });

            await extractor.summarizeConversation('conv-plain');

            expect(mockUpdateConversationSummary).toHaveBeenCalledWith('conv-plain', 'Just a plain summary');
            expect(mockUpdateConversationTitle).not.toHaveBeenCalled();
        });
    });

    describe('processRawTextForMemories()', () => {
        it('extracts memories from raw text', async () => {
            mockLLMChat.mockResolvedValue({
                content: JSON.stringify([
                    { content: 'user loves science', category: 'fact', importance: 6 },
                ]),
            });
            mockAddMemory.mockResolvedValue({ id: 99 });
            mockHybridSearch.mockResolvedValue([]);

            await extractor.processRawTextForMemories('I love science', 'Bob');

            expect(mockAddMemory).toHaveBeenCalledTimes(1);
            expect(mockAddMemory).toHaveBeenCalledWith('user loves science', 'fact', 6, expect.any(Function));
        });

        it('handles LLM returning no memories', async () => {
            mockLLMChat.mockResolvedValue({ content: '[]' });

            await extractor.processRawTextForMemories('nothing interesting', 'Test');

            expect(mockAddMemory).not.toHaveBeenCalled();
        });
    });

    describe('enqueueGraphTask()', () => {
        it('enqueues and executes a task', async () => {
            const task = jest.fn().mockResolvedValue(undefined);
            jest.useFakeTimers();

            extractor.enqueueGraphTask(task);

            await jest.runAllTimersAsync();

            expect(task).toHaveBeenCalledTimes(1);

            jest.useRealTimers();
        });
    });
});