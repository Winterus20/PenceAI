import express, { Router } from 'express';
import { logger } from '../../utils/logger.js';
import type { MemoryManager } from '../../memory/manager.js';
import type { MessageRouter } from '../../router/index.js';
import { PageRankScorer } from '../../memory/graphRAG/PageRankScorer.js';
import { CommunityDetector } from '../../memory/graphRAG/CommunityDetector.js';
import type { MemoryGraph, GraphNode, GraphEdge } from '../../memory/types.js';

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

  expressRouter.get('/conversations/:id/messages', (req, res) => {
      const messages = memory.getConversationHistory(req.params.id, 100);
      res.json(messages);
  });

  expressRouter.post('/conversations/:id/fork', (req, res) => {
    const { id } = req.params;
    const { forkFromMessageId } = req.body;

    if (!forkFromMessageId || typeof forkFromMessageId !== 'number') {
      return res.status(400).json({ error: 'forkFromMessageId is required and must be a number' });
    }

    try {
      const result = memory.forkConversation(id, forkFromMessageId);
      return res.json(result);
    } catch (err: any) {
      if (err.message?.includes('not found')) {
        return res.status(404).json({ error: err.message });
      }
      logger.error({ err }, '[API] Fork conversation failed');
      return res.status(500).json({ error: 'Fork failed' });
    }
  });

  expressRouter.get('/conversations/:id/branches', (req, res) => {
    const { id } = req.params;
    try {
      const branches = memory.getChildBranches(id);
      return res.json(branches);
    } catch (err: any) {
      logger.error({ err }, '[API] Get branches failed');
      return res.status(500).json({ error: 'Failed to get branches' });
    }
  });

  expressRouter.get('/conversations/:id/branch-info', (req, res) => {
    const { id } = req.params;
    try {
      const info = memory.getConversationBranchInfo(id);
      return res.json(info);
    } catch (err: any) {
      logger.error({ err }, '[API] Get branch info failed');
      return res.status(500).json({ error: 'Failed to get branch info' });
    }
  });

  expressRouter.patch('/conversations/:id', (req, res) => {
    const { id } = req.params;
    const { title } = req.body;

    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'Başlık zorunludur' });
    }

    if (title.length > 200) {
      return res.status(400).json({ error: 'Başlık maksimum 200 karakter olabilir' });
    }

    try {
      memory.updateConversationTitle(id, title.trim(), true);
      res.json({ success: true, title: title.trim() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  expressRouter.delete('/conversations/:id', (req, res) => {
    const { id } = req.params;
    const { deleteBranches } = req.body;

    try {
      const branchInfo = memory.getConversationBranchInfo(id);
      if (branchInfo.hasChildren && !deleteBranches) {
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
      res.json({ success: true });
    } catch (err: any) {
      logger.error({ err }, '[API] Delete conversation failed');
      res.status(500).json({ error: 'Delete failed' });
    }
  });

  expressRouter.delete('/conversations', (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Silinecek ID\'ler (ids) bir dizi olarak verilmelidir' });
    }

    try {
      const { deletedCount, results } = memory.deleteConversations(ids);
      broadcastStats();
      
      res.json({
        success: true,
        deletedCount,
        results
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  expressRouter.get('/memories', (_req, res) => {
      const memories = memory.getUserMemories(100);
      res.json(memories);
  });

  expressRouter.post('/memories', async (req, res) => {
    const { content, category, importance } = req.body;
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'İçerik (content) zorunludur' });
    }
    try {
      const added = await memory.addMemory(content, category || 'general', importance || 5);
      broadcastStats();
      // Fetch the full memory row so the frontend receives a complete MemoryItem
      const db = memory.getDatabase();
      const memoryRow = db.prepare(`SELECT * FROM memories WHERE id = ?`).get(added.id);
      res.json({ success: true, memory: memoryRow ?? { id: added.id }, isUpdate: added.isUpdate });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  expressRouter.put('/memories/:id', async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: 'Geçersiz bellek ID' });

      const { content, category, importance } = req.body;
      if (!content || typeof content !== 'string') {
          return res.status(400).json({ error: 'İçerik (content) zorunludur' });
      }

      try {
          const updated = await memory.editMemory(id, content, category || 'general', importance || 5);
          if (updated) {
              res.json({ success: true });
          } else {
              res.status(404).json({ error: 'Bellek bulunamadı veya güncellenemedi' });
          }
      } catch (err: any) {
          res.status(500).json({ error: err.message });
      }
  });

  expressRouter.get('/memories/search', (req, res) => {
      const q = req.query.q as string;
      if (!q || typeof q !== 'string' || q.trim().length < 2) {
          return res.status(400).json({ error: 'Arama sorgusu en az 2 karakter olmalı' });
      }
      try {
          const results = memory.searchMemories(q.trim(), 20);
          res.json(results);
      } catch (err: any) {
          res.status(500).json({ error: err.message });
      }
  });

  expressRouter.delete('/memories/:id', (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: 'Geçersiz bellek ID' });
      try {
          const deleted = memory.deleteMemory(id);
          if (deleted) {
              broadcastStats();
              res.json({ success: true });
          } else {
              res.status(404).json({ error: 'Bellek bulunamadı' });
          }
      } catch (err: any) {
          res.status(500).json({ error: err.message });
      }
  });

  expressRouter.get('/memory-graph', (req, res) => {
      try {
          const {
              limit = 100,
              includePageRank = 'true',
              includeCommunities = 'true',
          } = req.query;

          const graphLimit = parseInt(limit as string, 10);
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
                          .filter((n: GraphNode) => n.type === 'memory' && n.rawId != null)
                          .map((n: GraphNode) => n.rawId!);
                      if (allNodeIds.length > 0) {
                          pageRankScores = scorer.scoreSubgraph(allNodeIds);
                      }
                  }
              } catch (err) {
                  logger.warn({ err }, '[API] PageRank computation failed:');
              }
          }

          let communityMap = new Map<number, string>();
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
              } catch (err) {
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
      } catch (err: any) {
          res.status(500).json({ error: err.message });
      }
  });

  expressRouter.get('/usage/stats', (req, res) => {
    try {
      const period = (req.query.period as string) || 'week';
      const stats = memory.getTokenUsageStats(period);
      const dailyUsage = memory.getDailyUsage(period);
      
      res.json({
        period,
        totalTokens: stats.totalTokens,
        totalCost: stats.totalCost,
        providerBreakdown: stats.providerBreakdown,
        dailyUsage,
      });
    } catch (err: any) {
      logger.error({ err }, '[API] Token usage stats error:');
      res.status(500).json({ error: 'Token usage stats alınamadı' });
    }
  });

  return expressRouter;
}
