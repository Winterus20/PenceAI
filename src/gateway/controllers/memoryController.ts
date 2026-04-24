import type { Router } from 'express';
import express from 'express';
import { logger } from '../../utils/logger.js';
import type { MemoryManager } from '../../memory/manager.js';
import type { MessageRouter } from '../../router/index.js';
import { PageRankScorer } from '../../memory/graphRAG/PageRankScorer.js';
import { CommunityDetector } from '../../memory/graphRAG/CommunityDetector.js';
import type { MemoryGraph, GraphNode, GraphEdge } from '../../memory/types.js';
import {
  validateBody, validateQuery, validateParams,
  CreateMemorySchema, UpdateMemorySchema, MemoryIdParamSchema,
  ConversationIdParamSchema, ForkConversationSchema,
  UpdateConversationSchema, DeleteConversationsSchema,
  DeleteConversationSchema, SearchMemoriesQuerySchema,
  UsageStatsQuerySchema, MemoryGraphQuerySchema,
} from '../middleware/validate.js';

export function createMemoryController(memory: MemoryManager, router: MessageRouter, broadcastStats: () => void): Router {
  const expressRouter = express.Router();

  expressRouter.get('/stats', (_req, res) => {
      const stats = memory.getStats();
      res.json(stats);
  });

  expressRouter.get('/channels', (_req, res) => {
      res.json(router.getChannelStatus());
  });

  expressRouter.get('/conversations', (_req, res) => {
      const conversations = memory.getRecentConversations(50);
      res.json(conversations);
  });

  expressRouter.get('/conversations/:id/messages', validateParams(ConversationIdParamSchema), (req, res) => {
      const id = req.params.id as string;
      const messages = memory.getConversationHistory(id, 100);
      res.json(messages);
  });

  expressRouter.post('/conversations/:id/fork', validateParams(ConversationIdParamSchema), validateBody(ForkConversationSchema), (req, res) => {
    const id = req.params.id as string;
    const { forkFromMessageId } = req.body;

    try {
      const result = memory.forkConversation(id, forkFromMessageId);
      return res.json(result);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (err.message?.includes('not found')) {
        return res.status(404).json({ error: err.message });
      }
      logger.error({ err }, '[API] Fork conversation failed');
      return res.status(500).json({ error: 'Fork failed' });
    }
  });

  expressRouter.get('/conversations/:id/branches', validateParams(ConversationIdParamSchema), (req, res) => {
    const id = req.params.id as string;
    try {
      const branches = memory.getChildBranches(id);
      return res.json(branches);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error({ err }, '[API] Get branches failed');
      return res.status(500).json({ error: 'Failed to get branches' });
    }
  });

  expressRouter.get('/conversations/:id/branch-info', validateParams(ConversationIdParamSchema), (req, res) => {
    const id = req.params.id as string;
    try {
      const info = memory.getConversationBranchInfo(id);
      return res.json(info);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (err.message?.includes('not found')) {
        return res.status(404).json({ error: err.message });
      }
      logger.error({ err }, '[API] Get branch info failed');
      return res.status(500).json({ error: 'Failed to get branch info' });
    }
  });

  expressRouter.patch('/conversations/:id', validateParams(ConversationIdParamSchema), validateBody(UpdateConversationSchema), (req, res) => {
    const id = req.params.id as string;
    const { title } = req.body;

    try {
      memory.updateConversationTitle(id, title.trim(), true);
      res.json({ success: true, title: title.trim() });
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      res.status(500).json({ error: err.message });
    }
  });

  expressRouter.delete('/conversations/:id', validateParams(ConversationIdParamSchema), validateBody(DeleteConversationSchema), (req, res) => {
    const id = req.params.id as string;
    const { deleteBranches } = req.body;

    try {
      const branchInfo = memory.getConversationBranchInfo(id);
      if (branchInfo.hasChildren && typeof deleteBranches !== 'boolean') {
        const branches = memory.getChildBranches(id);
        return res.status(409).json({
          error: 'Conversation has child branches',
          hasChildren: true,
          branches,
        });
      }

      const deleted = memory.deleteConversation(id, deleteBranches === true);
      if (!deleted) {
        return res.status(404).json({ error: 'Konuşma bulunamadı' });
      }
      broadcastStats();
      return res.json({ success: true });
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (err.message?.includes('not found')) {
        return res.status(404).json({ error: err.message });
      }
      logger.error({ err }, '[API] Delete conversation failed');
      return res.status(500).json({ error: 'Delete failed' });
    }
  });

  expressRouter.delete('/conversations', validateBody(DeleteConversationsSchema), (req, res) => {
    const { ids } = req.body;

    try {
      const { deletedCount, results } = memory.deleteConversations(ids);
      broadcastStats();
      
      res.json({
        success: true,
        deletedCount,
        results
      });
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      res.status(500).json({ error: err.message });
    }
  });

  expressRouter.get('/memories', (_req, res) => {
      const memories = memory.getUserMemories(100);
      res.json(memories);
  });

  expressRouter.post('/memories', validateBody(CreateMemorySchema), async (req, res) => {
    const { content, category, importance } = req.body;
    try {
      const added = await memory.addMemory(content, category || 'general', importance || 5);
      broadcastStats();
      // Fetch the full memory row so the frontend receives a complete MemoryItem
      const db = memory.getDatabase();
      const memoryRow = db.prepare(`SELECT * FROM memories WHERE id = ?`).get(added.id);
      res.json({ success: true, memory: memoryRow ?? { id: added.id }, isUpdate: added.isUpdate });
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      res.status(500).json({ error: err.message });
    }
  });

  expressRouter.put('/memories/:id', validateParams(MemoryIdParamSchema), validateBody(UpdateMemorySchema), async (req, res) => {
      const id = Number(req.params.id);
      const { content, category, importance } = req.body;

      try {
          const updated = await memory.editMemory(id, content, category || 'general', importance || 5);
          if (updated) {
              res.json({ success: true });
          } else {
              res.status(404).json({ error: 'Bellek bulunamadı veya güncellenemedi' });
          }
      } catch (error: unknown) {
          const err = error instanceof Error ? error : new Error(String(error));
          res.status(500).json({ error: err.message });
      }
  });

  expressRouter.get('/memories/search', validateQuery(SearchMemoriesQuerySchema), (req, res) => {
      const q = (req.query as Record<string, string>).q;
      try {
          const results = memory.searchMemories((q || '').trim(), 20);
          res.json(results);
      } catch (error: unknown) {
          const err = error instanceof Error ? error : new Error(String(error));
          res.status(500).json({ error: err.message });
      }
  });

  expressRouter.delete('/memories/:id', validateParams(MemoryIdParamSchema), (req, res) => {
      const id = Number(req.params.id);
      try {
          const deleted = memory.deleteMemory(id);
          if (deleted) {
              broadcastStats();
              res.json({ success: true });
          } else {
              res.status(404).json({ error: 'Bellek bulunamadı' });
          }
      } catch (error: unknown) {
          const err = error instanceof Error ? error : new Error(String(error));
          res.status(500).json({ error: err.message });
      }
  });

  expressRouter.get('/memory-graph', validateQuery(MemoryGraphQuerySchema), (req, res) => {
      try {
          const parsedQuery = req.query as Record<string, string | undefined>;
          const graphLimit = Number(parsedQuery.limit) || 100;
          const includePageRank = parsedQuery.includePageRank ?? 'true';
          const includeCommunities = parsedQuery.includeCommunities ?? 'true';
          let doPageRank = includePageRank === 'true';
          let doCommunities = includeCommunities === 'true';

          const graphData = memory.getMemoryGraph();

          const limitedNodes = graphData.nodes.slice(0, graphLimit);
          const limitedNodeIds = new Set(limitedNodes.map((n: GraphNode) => n.id));
          const limitedEdges = graphData.edges.filter(
              (e: GraphEdge) => limitedNodeIds.has(typeof e.source === 'string' ? e.source : e.source) &&
                   limitedNodeIds.has(typeof e.target === 'string' ? e.target : e.target)
          );
          const limitedGraph: MemoryGraph = { nodes: limitedNodes, edges: limitedEdges };

          if (limitedNodes.length > 500) {
              doPageRank = false;
              doCommunities = false;
              logger.warn(`[Gateway] Graph > 500 node (${limitedNodes.length}). Stabilitesi için PageRank atlanıyor.`);
          }

          let pageRankScores = new Map<number, number>();
          if (doPageRank) {
              try {
                  const db = memory.getDatabase();
                  if (db) {
                      const scorer = new PageRankScorer(db);
          const allNodeIds = limitedGraph.nodes
              .filter((n: GraphNode) => n.type === 'memory' && n.rawId !== null && n.rawId !== undefined)
              .map((n: GraphNode) => n.rawId!);
                      if (allNodeIds.length > 0) {
                          pageRankScores = scorer.scoreSubgraph(allNodeIds);
                      }
                  }
              } catch (error: unknown) {
                  const err = error instanceof Error ? error : new Error(String(error));
                  logger.warn({ err }, '[API] PageRank computation failed:');
              }
          }

          const communityMap = new Map<number, string>();
          if (doCommunities) {
              try {
                  const db = memory.getDatabase();
                  if (db) {
                      const detector = new CommunityDetector(db);
                      const result = detector.detectCommunities();
                      for (const community of result.communities) {
                          for (const nodeId of community.memberNodeIds) {
                              communityMap.set(nodeId, community.id);
                          }
                      }
                  }
              } catch (error: unknown) {
                  const err = error instanceof Error ? error : new Error(String(error));
                  logger.warn({ err }, '[API] Community detection failed:');
              }
          }

          interface EnrichedNode extends GraphNode {
              pageRankScore: number;
              communityId: string | null;
              importance: number;
          }
          const enrichedNodes: EnrichedNode[] = limitedGraph.nodes.map((node: GraphNode) => {
              const rawId = node.rawId ?? 0;
              const prScore = pageRankScores.get(rawId) ?? 0;
              const communityId = communityMap.get(rawId) ?? null;
              const accessCount = node.access_count ?? 0;
              const importance = node.importance ?? 0;

              return {
                  ...node,
                  pageRankScore: prScore,
                  communityId,
                  importance: prScore * 0.5 + accessCount * 0.3 + importance * 0.2,
              };
          });

          interface EnrichedEdge extends GraphEdge {
              displayWeight: number;
          }
          const enrichedEdges: EnrichedEdge[] = limitedGraph.edges.map((edge: GraphEdge) => {
              const confidence = edge.confidence ?? 0.5;
              const weight = edge.weight ?? 1.0;
              return {
                  ...edge,
                  displayWeight: confidence * weight,
              };
          });

          const uniqueCommunities = new Set(communityMap.values());

          const nodesWithRawId = enrichedNodes.filter((n: EnrichedNode) => n.type === 'memory');
          const avgPageRank = nodesWithRawId.length > 0
              ? nodesWithRawId.reduce((sum: number, n: EnrichedNode) => sum + (n.pageRankScore ?? 0), 0) / nodesWithRawId.length
              : 0;

          res.json({
              nodes: enrichedNodes,
              edges: enrichedEdges,
              metadata: {
                  totalNodes: enrichedNodes.length,
                  totalEdges: enrichedEdges.length,
                  communityCount: uniqueCommunities.size,
                  avgPageRank,
                  includePageRank: doPageRank,
                  includeCommunities: doCommunities,
              },
          });
      } catch (error: unknown) {
          const err = error instanceof Error ? error : new Error(String(error));
          res.status(500).json({ error: err.message });
      }
  });

  expressRouter.get('/usage/stats', validateQuery(UsageStatsQuerySchema), (req, res) => {
    try {
      const parsedQuery = req.query as Record<string, string | undefined>;
      const period = parsedQuery.period ?? 'week';
      const stats = memory.getTokenUsageStats(period);
      const dailyUsage = memory.getDailyUsage(period);
      
      res.json({
        period,
        totalTokens: stats.totalTokens,
        totalCost: stats.totalCost,
        providerBreakdown: stats.providerBreakdown,
        dailyUsage,
      });
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error({ err }, '[API] Token usage stats error:');
      res.status(500).json({ error: 'Token usage stats alınamadı' });
    }
  });

  return expressRouter;
}
