import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { GraphRAGManager } from '../../src/agent/graphRAGManager.js';
import type { GraphRAGRetrieveResult } from '../../src/agent/graphRAGManager.js';
import type { PromptContextBundle } from '../../src/memory/manager/types.js';
import type { MemoryRow } from '../../src/memory/types.js';

jest.mock('../../src/memory/graphRAG/GraphRAGEngine.js');
jest.mock('../../src/memory/graphRAG/ShadowMode.js');
jest.mock('../../src/memory/graphRAG/config.js', () => ({
    GraphRAGConfigManager: {
        getConfig: jest.fn(),
    },
}));
jest.mock('../../src/utils/index.js', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    },
}));

import { GraphRAGConfigManager } from '../../src/memory/graphRAG/config.js';
import { GraphRAGEngine } from '../../src/memory/graphRAG/GraphRAGEngine.js';
import { ShadowMode } from '../../src/memory/graphRAG/ShadowMode.js';

function makeMemoryRow(id: number, content: string): MemoryRow {
    return {
        id,
        content,
        type: 'episodic',
        category: 'fact',
        importance: 5,
        confidence: 0.9,
        access_count: 1,
       created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        embedding: null,
        metadata: null,
    } as MemoryRow;
}

function makeContextBundle(overrides?: Partial<PromptContextBundle>): PromptContextBundle {
    return {
        relevantMemories: [],
        archivalMemories: [],
        supplementalMemories: [],
        conversationSummaries: [],
        reviewMemories: [],
        followUpCandidates: [],
        recentMessages: [],
        graphRAG: null,
        ...overrides,
    };
}

describe('GraphRAGManager', () => {
    let manager: GraphRAGManager;

    beforeEach(() => {
        jest.clearAllMocks();
        manager = new GraphRAGManager();
    });

    describe('retrieve()', () => {
        it('returns null result when config disabled', async () => {
            (GraphRAGConfigManager.getConfig as jest.Mock).mockReturnValue({ enabled: false });

            const result = await manager.retrieve(
                'test query',
                makeContextBundle(),
                [],
                0,
            );

            expect(result.graphRAGResult).toBeNull();
            expect(result.finalRelevantMemories).toEqual([]);
            expect(result.perfTimingGraphRAG).toBeNull();
            expect(result.perfTimingShadow).toBeNull();
        });

        it('reuses context bundle GraphRAG results when available', async () => {
            const memories = [makeMemoryRow(1, 'memory 1')];
            (GraphRAGConfigManager.getConfig as jest.Mock).mockReturnValue({ enabled: true });

            const contextBundle = makeContextBundle({
                graphRAG: {
                    memories: memories,
                    communitySummaries: [{ communityId: 'c1', summary: 'summary 1' }],
                    graphContext: { expandedNodeIds: [1] },
                },
            });

            const result = await manager.retrieve(
                'test query',
                contextBundle,
                [],
                0,
            );

            expect(result.graphRAGResult).not.toBeNull();
            expect(result.graphRAGResult!.memories).toEqual(memories);
            expect(result.graphRAGResult!.communitySummaries).toEqual([
                { id: 'c1', summary: 'summary 1' },
            ]);
            expect(result.graphRAGResult!.graphContext).toEqual({ expandedNodeIds: [1] });
        });

        it('skips for short messages in active context', async () => {
            (GraphRAGConfigManager.getConfig as jest.Mock).mockReturnValue({
                enabled: true,
                shadowMode: false,
                sampleRate: 1.0,
            });

            const engine = new GraphRAGEngine({} as any);
            manager.setEngine(engine);

            const result = await manager.retrieve(
                'ok',
                makeContextBundle(),
                [],
                5,
            );

            expect(result.graphRAGResult).toBeNull();
            expect(engine.retrieve as jest.Mock).not.toHaveBeenCalled();
        });

        it('skips based on sample rate', async () => {
            (GraphRAGConfigManager.getConfig as jest.Mock).mockReturnValue({
                enabled: true,
                shadowMode: false,
                sampleRate: 0,
            });

            const engine = new GraphRAGEngine({} as any);
            manager.setEngine(engine);

            const result = await manager.retrieve(
                'This is a longer query that would not be skipped by length',
                makeContextBundle(),
                [],
                0,
            );

            expect(result.graphRAGResult).toBeNull();
            expect(engine.retrieve as jest.Mock).not.toHaveBeenCalled();
        });

        it('calls engine.retrieve when enabled and query passes pre-checks', async () => {
            const mockMemories = [makeMemoryRow(10, 'graph memory 1')];
            const engine = new GraphRAGEngine({} as any);
            (engine.retrieve as jest.Mock).mockResolvedValue({
                success: true,
                memories: mockMemories,
                communitySummaries: [{ communityId: 'c2', summary: 'community summary' }],
                graphContext: { expandedNodeIds: [10, 20], communityCount: 1 },
            });
            manager.setEngine(engine);

            (GraphRAGConfigManager.getConfig as jest.Mock).mockReturnValue({
                enabled: true,
                shadowMode: false,
                sampleRate: 1.0,
                maxHops: 2,
                usePageRank: true,
                useCommunities: true,
                tokenBudget: 32000,
                timeoutMs: 5000,
                fallbackEnabled: true,
                rrfKConstant: 60,
                memoryImportanceWeight: 0.5,
                memoryAccessCountWeight: 0.3,
                memoryConfidenceWeight: 0.2,
            });

            const result = await manager.retrieve(
                'This is a longer query that should not be skipped',
                makeContextBundle(),
                [],
                0,
            );

            expect(result.graphRAGResult).not.toBeNull();
            expect(result.graphRAGResult!.memories).toEqual(mockMemories);
            expect(result.perfTimingGraphRAG).not.toBeNull();
        });

        it('runs shadow query in shadow mode', async () => {
            (GraphRAGConfigManager.getConfig as jest.Mock).mockReturnValue({
                enabled: true,
                shadowMode: true,
            });

            const shadow = new ShadowMode({} as any, {} as any);
            (shadow.runShadowQuery as jest.Mock).mockResolvedValue(null);
            manager.setEngine({} as any, shadow);

            const result = await manager.retrieve(
                'test query',
                makeContextBundle(),
                [],
                0,
            );

            expect(result.graphRAGResult).toBeNull();
            expect(result.perfTimingShadow).not.toBeNull();
        });

        it('merges GraphRAG memories with relevant memories deduplicating', async () => {
            const existing = [makeMemoryRow(1, 'mem 1'), makeMemoryRow(2, 'mem 2')];
            const graphMemories = [makeMemoryRow(2, 'mem 2'), makeMemoryRow(3, 'mem 3')];

            const engine = new GraphRAGEngine({} as any);
            (engine.retrieve as jest.Mock).mockResolvedValue({
                success: true,
                memories: graphMemories,
                communitySummaries: [],
                graphContext: { expandedNodeIds: [], communityCount: 0 },
            });
            manager.setEngine(engine);

            (GraphRAGConfigManager.getConfig as jest.Mock).mockReturnValue({
                enabled: true,
                shadowMode: false,
                sampleRate: 1.0,
                maxHops: 2,
                usePageRank: true,
                useCommunities: true,
                tokenBudget: 32000,
                timeoutMs: 5000,
                fallbackEnabled: true,
                rrfKConstant: 60,
                memoryImportanceWeight: 0.5,
                memoryAccessCountWeight: 0.3,
                memoryConfidenceWeight: 0.2,
            });

            const result = await manager.retrieve(
                'This is a long enough query to not be skipped',
                makeContextBundle(),
                existing,
                0,
            );

            const ids = result.finalRelevantMemories.map(m => m.id);
            expect(ids).toContain(1);
            expect(ids).toContain(2);
            expect(ids).toContain(3);
            expect(ids.length).toBe(3);
        });
    });

    describe('formatCommunitySummaries()', () => {
        it('formats summaries correctly', () => {
            const result = manager.formatCommunitySummaries([
                { id: 'c1', summary: 'First community' },
                { id: 'c2', summary: 'Second community' },
            ]);
            expect(result).toBe('- **c1**: First community\n- **c2**: Second community');
        });

        it('returns null for empty array', () => {
            expect(manager.formatCommunitySummaries([])).toBeNull();
        });
    });

    describe('shouldAddToSystemPrompt()', () => {
        it('returns true when community summaries exist', () => {
            const result = manager.shouldAddToSystemPrompt({
                memories: [],
                communitySummaries: [{ id: 'c1', summary: 'test' }],
            });
            expect(result).toBe(true);
        });

        it('returns false when community summaries are empty', () => {
            const result = manager.shouldAddToSystemPrompt({
                memories: [],
                communitySummaries: [],
            });
            expect(result).toBe(false);
        });

        it('returns false when graphRAGResult is null', () => {
            expect(manager.shouldAddToSystemPrompt(null)).toBe(false);
        });
    });
});