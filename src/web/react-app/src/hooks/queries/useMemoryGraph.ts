import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export const MEMORY_GRAPH_QUERY_KEY = 'memoryGraph';

export interface GraphNode {
  id: string;
  type: 'memory' | 'entity';
  label: string;
  fullContent?: string;
  rawId?: number;
  category?: string;
  importance?: number;
  entityType?: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  // Enriched fields
  pageRankScore?: number;
  communityId?: string | null;
}

export interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
  confidence: number;
  description?: string;
  // Enriched fields
  displayWeight?: number;
  weight?: number;
}

export interface MemoryGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface MemoryGraphMetadata {
  totalNodes: number;
  totalEdges: number;
  communityCount: number;
  avgPageRank: number;
  includePageRank: boolean;
  includeCommunities: boolean;
}

export interface EnrichedMemoryGraph extends MemoryGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: MemoryGraphMetadata;
}

export interface UseMemoryGraphQueryOptions {
  limit?: number;
  includePageRank?: boolean;
  includeCommunities?: boolean;
}

export function useMemoryGraphQuery(options?: UseMemoryGraphQueryOptions) {
  const {
    limit = 100,
    includePageRank = true,
    includeCommunities = true,
  } = options ?? {};

  return useQuery({
    queryKey: [MEMORY_GRAPH_QUERY_KEY, limit, includePageRank, includeCommunities],
    queryFn: () => api.get<EnrichedMemoryGraph>('/memory-graph', {
      query: { limit, includePageRank, includeCommunities },
    }),
    staleTime: 1000 * 60 * 10, // 10 dakika - graph nadir değişir
    refetchOnWindowFocus: false,
  });
}
