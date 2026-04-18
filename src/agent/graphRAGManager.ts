import type { MemoryRow } from '../memory/types.js';
import type { PromptContextBundle } from '../memory/manager/types.js';
import { GraphRAGEngine } from '../memory/graphRAG/GraphRAGEngine.js';
import { ShadowMode } from '../memory/graphRAG/ShadowMode.js';
import { GraphRAGConfigManager } from '../memory/graphRAG/config.js';
import { logger } from '../utils/index.js';

export interface GraphRAGRetrieveResult {
    graphRAGResult: {
        memories: MemoryRow[];
        communitySummaries: Array<{ id: string; summary: string }>;
        graphContext?: Record<string, unknown>;
    } | null;
    finalRelevantMemories: MemoryRow[];
    perfTimingGraphRAG: number | null;
    perfTimingShadow: number | null;
}

export class GraphRAGManager {
    private engine?: GraphRAGEngine;
    private shadow?: ShadowMode;

    setEngine(engine: GraphRAGEngine, shadow?: ShadowMode): void {
        this.engine = engine;
        this.shadow = shadow;
        logger.info('[GraphRAGManager] Components connected');
    }

    getEngine(): GraphRAGEngine | undefined {
        return this.engine;
    }

    getShadow(): ShadowMode | undefined {
        return this.shadow;
    }

    async retrieve(
        query: string,
        contextBundle: PromptContextBundle,
        relevantMemories: MemoryRow[],
        recentMessageCount: number,
    ): Promise<GraphRAGRetrieveResult> {
        const config = GraphRAGConfigManager.getConfig();
        if (!config.enabled) {
            return {
                graphRAGResult: null,
                finalRelevantMemories: relevantMemories,
                perfTimingGraphRAG: null,
                perfTimingShadow: null,
            };
        }

        let graphRAGResult: GraphRAGRetrieveResult['graphRAGResult'] = null;
        let perfTimingGraphRAG: number | null = null;
        let perfTimingShadow: number | null = null;

        if (contextBundle.graphRAG && contextBundle.graphRAG.memories.length > 0) {
            graphRAGResult = {
                memories: contextBundle.graphRAG.memories,
                communitySummaries: contextBundle.graphRAG.communitySummaries.map(cs => ({
                    id: cs.communityId,
                    summary: cs.summary,
                })),
                graphContext: contextBundle.graphRAG.graphContext,
            };
            logger.info('[GraphRAGManager] Results reused from context bundle (no double retrieval)');
        } else if (config.shadowMode && this.shadow) {
            const shadowStart = Date.now();
            this.shadow.runShadowQuery(query, relevantMemories)
                .catch(err => logger.error({ err }, '[GraphRAGManager] Shadow mode query error'));
            perfTimingShadow = Date.now() - shadowStart;
            logger.info(`[GraphRAGManager] Shadow query: ${perfTimingShadow}ms`);
        } else if (config.enabled && this.engine) {
            const queryLength = query.trim().length;
            const hasActiveContext = recentMessageCount >= 3;
            const shouldSkipGraphRAG = hasActiveContext
                && queryLength < 15
                && !/\b(o|bu|şu|onun|bunun|dün|geçen|önceki|hani|projeyi|konuyu)\b/i.test(query);

            if (shouldSkipGraphRAG) {
                logger.info(`[GraphRAGManager] Skipped (short response in active context: ${queryLength} chars, ${recentMessageCount} recent messages)`);
            } else if (Math.random() < config.sampleRate) {
                const start = Date.now();
                try {
                    const result = await this.engine.retrieve(query, {
                        maxHops: config.maxHops,
                        maxExpandedNodes: config.sampleRate === 1.0 ? 100 : 50,
                        minConfidence: 0.3,
                        usePageRank: config.usePageRank,
                        useCommunities: config.useCommunities,
                        useCache: true,
                        tokenBudget: config.tokenBudget,
                        communitySummaryBudget: Math.floor(config.tokenBudget * 0.25),
                        timeoutMs: config.timeoutMs,
                        fallbackToStandardSearch: config.fallbackEnabled,
                        rrfKConstant: config.rrfKConstant,
                        memoryImportanceWeight: config.memoryImportanceWeight,
                        memoryAccessCountWeight: config.memoryAccessCountWeight,
                        memoryConfidenceWeight: config.memoryConfidenceWeight,
                    });
                    perfTimingGraphRAG = Date.now() - start;

                    if (result.success) {
                        graphRAGResult = {
                            memories: result.memories,
                            communitySummaries: (result.communitySummaries || []).map(cs => ({
                                id: cs.communityId,
                                summary: cs.summary,
                            })),
                            graphContext: {
                                expandedNodeIds: result.graphContext?.expandedNodeIds ?? [],
                                communityCount: result.graphContext?.communityCount ?? 0,
                            },
                        };
                        logger.info(`[GraphRAGManager] Retrieval successful: ${perfTimingGraphRAG}ms`);
                    } else {
                        logger.warn(`[GraphRAGManager] Retrieval failed after ${perfTimingGraphRAG}ms`);
                    }
                } catch (err) {
                    perfTimingGraphRAG = Date.now() - start;
                    logger.error({ err }, `[GraphRAGManager] Retrieval error after ${perfTimingGraphRAG}ms, falling back to standard`);
                }
            } else {
                logger.info('[GraphRAGManager] Skipped (sample rate)');
            }
        }

        let finalRelevantMemories = relevantMemories;
        if (graphRAGResult && graphRAGResult.memories.length > 0) {
            const existingIds = new Set(relevantMemories.map(m => m.id));
            const missingMemories = graphRAGResult.memories.filter(gm => !existingIds.has(gm.id));
            if (missingMemories.length > 0) {
                const memoryMap = new Map<number, MemoryRow>(relevantMemories.map(m => [m.id, m]));
                for (const gm of missingMemories) {
                    memoryMap.set(gm.id, gm);
                }
                finalRelevantMemories = Array.from(memoryMap.values());
                logger.info(`[GraphRAGManager] Added ${missingMemories.length} new memories to context`);
            }
        }

        return {
            graphRAGResult,
            finalRelevantMemories,
            perfTimingGraphRAG,
            perfTimingShadow,
        };
    }

    formatCommunitySummaries(summaries: Array<{ id: string; summary: string }>): string | null {
        if (!summaries || summaries.length === 0) return null;
        return summaries
            .map(cs => `- **${cs.id}**: ${cs.summary}`)
            .join('\n');
    }

    shouldAddToSystemPrompt(graphRAGResult: GraphRAGRetrieveResult['graphRAGResult']): graphRAGResult is NonNullable<typeof graphRAGResult> {
        return graphRAGResult !== null && graphRAGResult.communitySummaries.length > 0;
    }
}