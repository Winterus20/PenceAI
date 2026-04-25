/**
 * RetrievalOrchestrator + GraphRAG Integration Testleri.
 *
 * GraphRAG retrieval'ın retrieval orchestrator ile entegrasyonunu test eder.
 */

// Logger mock
jest.mock('../../../src/utils/logger.js', () => ({
    logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    },
}));

import {
    MemoryRetrievalOrchestrator,
    type RetrievalOrchestratorDeps,
    type PromptContextBundle,
} from '../../../src/memory/retrievalOrchestrator.js';
import { GraphRAGEngine, type GraphRAGResult } from '../../../src/memory/graphRAG/index.js';
import type { MemoryRow, GraphAwareSearchResult } from '../../../src/memory/types.js';
import { logger } from '../../../src/utils/logger.js';

// Mock GraphRAGEngine
jest.mock('../../../src/memory/graphRAG/GraphRAGEngine.js', () => ({
    GraphRAGEngine: jest.fn().mockImplementation(() => ({
        retrieve: jest.fn(),
    })),
}));

describe('RetrievalOrchestrator + GraphRAG Integration', () => {
    let mockGraphRAGEngine: jest.Mocked<GraphRAGEngine>;
    let mockDeps: RetrievalOrchestratorDeps;

    /** Helper: Test memory oluştur */
    function createMemory(id: number, content: string = 'test memory'): MemoryRow {
        return {
            id,
            user_id: 'default',
            category: 'test',
            content,
            importance: 5,
            access_count: 0,
            is_archived: 0,
            last_accessed: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            provenance_source: null,
            provenance_conversation_id: null,
            provenance_message_id: null,
            confidence: 0.7,
            review_profile: null,
            memory_type: 'semantic' as const,
            stability: null,
            retrievability: null,
            next_review_at: null,
            review_count: null,
            max_importance: null,
        };
    }

    /** Helper: GraphRAG result oluştur */
    function createGraphRAGResult(success: boolean, memories: MemoryRow[] = []): GraphRAGResult {
        return {
            success,
            memories,
            communitySummaries: [],
            graphContext: {
                expandedNodeIds: memories.map((m) => m.id),
                edgeCount: 0,
                maxHopReached: false,
                communityCount: 0,
                pageRankApplied: true,
            },
            searchMetadata: {
                duration: 100,
                cacheHit: false,
                tokenUsage: 0,
                fallbackUsed: false,
                phase: 'fusion',
            },
        };
    }

    /** Helper: GraphAwareSearch result oluştur */
    function createGraphAwareSearchResult(
        active: MemoryRow[] = [],
        archival: MemoryRow[] = [],
    ): GraphAwareSearchResult {
        return { active, archival };
    }

    beforeEach(() => {
        jest.clearAllMocks();

        // Mock GraphRAGEngine instance
        mockGraphRAGEngine = new GraphRAGEngine(
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            async () => [],
        ) as jest.Mocked<GraphRAGEngine>;

        // Default mock deps
        mockDeps = {
            graphAwareSearch: jest.fn().mockResolvedValue(createGraphAwareSearchResult([createMemory(1)])),
            getRecentConversationSummaries: jest.fn().mockReturnValue([]),
            getMemoriesDueForReview: jest.fn().mockReturnValue([]),
            getFollowUpCandidates: jest.fn().mockReturnValue([]),
            getRecentMessages: jest.fn().mockReturnValue([]),
            // wikiAdaptiveThreshold default 100 — 101 öğe döndürerek adaptive skip'i bypass et
            getUserMemories: jest.fn().mockReturnValue(new Array(101).fill(createMemory(1))),
            getMemoryNeighborsBatch: jest.fn().mockReturnValue(new Map()),
            getBehaviorDiscoveryConfig: jest.fn().mockReturnValue({ retrieval: { state: 'shadow' } }),
            prioritizeConversationMemories: jest.fn((memories) => memories),
            recordDebug: jest.fn(),
            graphRAGEngine: mockGraphRAGEngine,
        };
    });

    test('GraphRAG retrieval is called when enabled and recipe requires it', async () => {
        // GraphRAG retrieval mock
        const graphRAGMemories = [createMemory(10, 'graphRAG memory')];
        (mockGraphRAGEngine.retrieve as jest.Mock).mockResolvedValue(createGraphRAGResult(true, graphRAGMemories));

        // Analytical + exploratory sinyalleri ile GraphRAG recipe tetiklenir
        mockDeps.getRecentMessages = jest
            .fn()
            .mockReturnValue([
                {
                    role: 'user',
                    content: 'Bu konu hakkında detaylı analiz yap ve alternatifleri keşfet',
                    created_at: new Date().toISOString(),
                    conversation_title: 'test',
                },
            ]);

        const orchestrator = new MemoryRetrievalOrchestrator(mockDeps);
        const result = await orchestrator.getPromptContextBundle({
            query: 'Bu konu hakkında detaylı analiz yap ve alternatifleri keşfet',
            activeConversationId: 'test-conv',
        });

        // GraphRAG retrieval çağrıldı mı?
        expect(mockGraphRAGEngine.retrieve).toHaveBeenCalled();

        // GraphRAG results bundle'da var mı?
        expect(result.graphRAG).not.toBeNull();
        expect(result.graphRAG?.memories).toBeDefined();
    });

    test('Fallback to standard retrieval when GraphRAG fails', async () => {
        // GraphRAG error throw
        (mockGraphRAGEngine.retrieve as jest.Mock).mockRejectedValue(new Error('GraphRAG retrieval failed'));

        // GraphRAG recipe tetikleyecek sinyal
        mockDeps.getRecentMessages = jest
            .fn()
            .mockReturnValue([
                {
                    role: 'user',
                    content: 'Bu konu hakkında detaylı analiz yap ve alternatifleri keşfet',
                    created_at: new Date().toISOString(),
                    conversation_title: 'test',
                },
            ]);

        const orchestrator = new MemoryRetrievalOrchestrator(mockDeps);

        // Hata fırlatmamalı - standard retrieval'a fallback yapmalı
        const result = await orchestrator.getPromptContextBundle({
            query: 'Bu konu hakkında detaylı analiz yap ve alternatifleri keşfet',
            activeConversationId: 'test-conv',
        });

        // Result null olmamalı (standard retrieval çalıştı)
        expect(result.relevantMemories).toBeDefined();
        // GraphRAG result null olmalı (fallback)
        expect(result.graphRAG).toBeNull();
        // Warning log'lanmış olmalı
        expect(logger.warn).toHaveBeenCalled();
    });

    test('GraphRAG results are merged into bundle', async () => {
        const graphRAGMemories = [createMemory(10, 'graphRAG memory 1'), createMemory(11, 'graphRAG memory 2')];
        (mockGraphRAGEngine.retrieve as jest.Mock).mockResolvedValue(createGraphRAGResult(true, graphRAGMemories));

        mockDeps.getRecentMessages = jest
            .fn()
            .mockReturnValue([
                {
                    role: 'user',
                    content: 'Bu konu hakkında detaylı analiz yap ve alternatifleri keşfet',
                    created_at: new Date().toISOString(),
                    conversation_title: 'test',
                },
            ]);

        const orchestrator = new MemoryRetrievalOrchestrator(mockDeps);
        const result = await orchestrator.getPromptContextBundle({
            query: 'Bu konu hakkında detaylı analiz yap ve alternatifleri keşfet',
            activeConversationId: 'test-conv',
        });

        // GraphRAG results bundle'da olmalı
        expect(result.graphRAG).not.toBeNull();
        expect(result.graphRAG?.memories.length).toBe(2);
        expect(result.graphRAG?.graphContext).toBeDefined();
        expect(result.graphRAG?.graphContext.expandedNodeIds).toContain(10);
        expect(result.graphRAG?.graphContext.expandedNodeIds).toContain(11);
    });

    test('Recipe selection affects GraphRAG usage', async () => {
        // Preference cue - GraphRAG kullanmayan recipe
        mockDeps.getRecentMessages = jest
            .fn()
            .mockReturnValue([
                {
                    role: 'user',
                    content: 'Kullanıcı tercihlerini hatırla',
                    created_at: new Date().toISOString(),
                    conversation_title: 'test',
                },
            ]);

        const orchestrator = new MemoryRetrievalOrchestrator(mockDeps);
        await orchestrator.getPromptContextBundle({
            query: 'Kullanıcı tercihlerini hatırla',
            activeConversationId: 'test-conv',
        });

        // Preference recall recipe'sinde GraphRAG çağrılmamalı
        expect(mockGraphRAGEngine.retrieve).not.toHaveBeenCalled();
    });

    test('GraphRAG engine null olduğunda standard retrieval çalışır', async () => {
        // graphRAGEngine null
        mockDeps.graphRAGEngine = undefined;

        const orchestrator = new MemoryRetrievalOrchestrator(mockDeps);
        const result = await orchestrator.getPromptContextBundle({
            query: 'test query',
            activeConversationId: 'test-conv',
        });

        // Result null olmamalı
        expect(result.relevantMemories).toBeDefined();
        // GraphRAG null olmalı
        expect(result.graphRAG).toBeNull();
    });

    test('GraphRAG unsuccessful result is handled gracefully', async () => {
        (mockGraphRAGEngine.retrieve as jest.Mock).mockResolvedValue(createGraphRAGResult(false));

        mockDeps.getRecentMessages = jest
            .fn()
            .mockReturnValue([
                {
                    role: 'user',
                    content: 'Bu konu hakkında detaylı analiz yap ve alternatifleri keşfet',
                    created_at: new Date().toISOString(),
                    conversation_title: 'test',
                },
            ]);

        const orchestrator = new MemoryRetrievalOrchestrator(mockDeps);
        const result = await orchestrator.getPromptContextBundle({
            query: 'Bu konu hakkında detaylı analiz yap ve alternatifleri keşfet',
            activeConversationId: 'test-conv',
        });

        // Unsuccessful result'da graphRAG null olmalı
        expect(result.graphRAG).toBeNull();
        // Warning log'lanmış olmalı
        expect(logger.warn).toHaveBeenCalled();
    });

    test('GraphRAG function getter is resolved correctly', async () => {
        // Function getter kullan
        mockDeps.graphRAGEngine = () => mockGraphRAGEngine;

        const graphRAGMemories = [createMemory(20, 'function getter memory')];
        (mockGraphRAGEngine.retrieve as jest.Mock).mockResolvedValue(createGraphRAGResult(true, graphRAGMemories));

        mockDeps.getRecentMessages = jest
            .fn()
            .mockReturnValue([
                {
                    role: 'user',
                    content: 'Bu konu hakkında detaylı analiz yap ve alternatifleri keşfet',
                    created_at: new Date().toISOString(),
                    conversation_title: 'test',
                },
            ]);

        const orchestrator = new MemoryRetrievalOrchestrator(mockDeps);
        const result = await orchestrator.getPromptContextBundle({
            query: 'Bu konu hakkında detaylı analiz yap ve alternatifleri keşfet',
            activeConversationId: 'test-conv',
        });

        expect(mockGraphRAGEngine.retrieve).toHaveBeenCalled();
        expect(result.graphRAG).not.toBeNull();
    });

    test('GraphRAG function getter returning undefined falls back to standard', async () => {
        // Function getter undefined döndür
        mockDeps.graphRAGEngine = () => undefined;

        mockDeps.getRecentMessages = jest
            .fn()
            .mockReturnValue([
                {
                    role: 'user',
                    content: 'Bu konu hakkında detaylı analiz yap ve alternatifleri keşfet',
                    created_at: new Date().toISOString(),
                    conversation_title: 'test',
                },
            ]);

        const orchestrator = new MemoryRetrievalOrchestrator(mockDeps);
        const result = await orchestrator.getPromptContextBundle({
            query: 'Bu konu hakkında detaylı analiz yap ve alternatifleri keşfet',
            activeConversationId: 'test-conv',
        });

        // Standard retrieval çalışmalı
        expect(result.relevantMemories).toBeDefined();
        expect(result.graphRAG).toBeNull();
    });
});
