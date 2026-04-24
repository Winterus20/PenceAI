import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { select, type Selection } from 'd3-selection';
import 'd3-transition';
import { zoom as d3Zoom, zoomIdentity } from 'd3-zoom';
import type { ZoomBehavior } from 'd3-zoom';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force';
import type { Simulation } from 'd3-force';
import { drag } from 'd3-drag';
import { useMemoryGraphQuery, type GraphNode as QueryGraphNode, type GraphEdge as QueryGraphEdge, type MemoryGraph as QueryMemoryGraph, type EnrichedMemoryGraph, type MemoryGraphMetadata } from '@/hooks/queries/useMemoryGraph';

// Re-export types for backward compatibility
export type GraphNode = QueryGraphNode;
export type GraphEdge = QueryGraphEdge;
export type MemoryGraph = QueryMemoryGraph;
export type { EnrichedMemoryGraph, MemoryGraphMetadata };

// Color palettes - using CSS custom properties from index.css
export const CATEGORY_COLORS: Record<string, string> = {
  preference: 'var(--category-preference)',
  fact: 'var(--category-fact)',
  habit: 'var(--category-habit)',
  project: 'var(--category-project)',
  event: 'var(--category-event)',
  general: 'var(--category-general)',
};

export const ENTITY_TYPE_COLORS: Record<string, string> = {
  person: 'var(--entity-person)',
  technology: 'var(--entity-technology)',
  project: 'var(--entity-project)',
  place: 'var(--entity-place)',
  organization: 'var(--entity-organization)',
  concept: 'var(--entity-concept)',
};

// Community colors - dynamic palette
const COMMUNITY_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'];

export const EDGE_COLORS: Record<string, string> = {
  related_to: 'var(--edge-related-to)',
  supports: 'var(--edge-supports)',
  contradicts: 'var(--edge-contradicts)',
  caused_by: 'var(--edge-caused-by)',
  part_of: 'var(--edge-part-of)',
  has_entity: 'var(--edge-has-entity)',
};

export const ENTITY_ICONS: Record<string, string> = {
  person: '👤',
  technology: '💻',
  project: '📋',
  place: '📍',
  organization: '🏢',
  concept: '💡',
};

export interface UseMemoryGraphOptions {
  filterCategory?: string;
  onNodeClick?: (node: GraphNode) => void;
  limit?: number;
  includePageRank?: boolean;
  includeCommunities?: boolean;
}

export interface UseMemoryGraphReturn {
  containerRef: React.RefObject<HTMLDivElement | null>;
  svgRef: React.RefObject<SVGSVGElement | null>;
  loading: boolean;
  error: string | null;
  selectedNode: GraphNode | null;
  graphData: EnrichedMemoryGraph | null;
  metadata: MemoryGraphMetadata | null;
  setSelectedNode: (node: GraphNode | null) => void;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleReset: () => void;
  handleFitToScreen: () => void;
  refetch: () => Promise<void>;
}

/**
 * Custom hook for managing D3 memory graph visualization
 * Handles data fetching, filtering, simulation, and zoom/pan controls
 */
export function useMemoryGraph({
  filterCategory = 'all',
  onNodeClick,
  limit = 100,
  includePageRank = true,
  includeCommunities = true,
}: UseMemoryGraphOptions = {}): UseMemoryGraphReturn {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Gözlemci: Ekran boyutu 0'dan büyük olana kadar D3.js'i beklet
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          setIsReady(true);
        }
      }
    });
    observer.observe(containerRef.current);
    // İlk render'da zaten boyutu varsa hemen hazır et
    if (containerRef.current.clientWidth > 0 && containerRef.current.clientHeight > 0) {
      setIsReady(true);
    }
    return () => observer.disconnect();
  }, []);

  // React Query'den graph verisini al (with enriched options)
  const { data: graphData, isLoading: loading, error: fetchError, refetch: rqRefetch } = useMemoryGraphQuery({
    limit,
    includePageRank,
    includeCommunities,
  });
  
  const error = fetchError ? 'Bellek grafiği yüklenemedi' : null;

  // D3 refs for simulation and zoom
  const simulationRef = useRef<Simulation<GraphNode, GraphEdge> | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const gRef = useRef<Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const linkGroupRef = useRef<Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const nodeGroupRef = useRef<Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const isInitializedRef = useRef(false);

  // Community color mapper
  const communityColorMap = useMemo(() => {
    const colorMap = new Map<string, string>();
    let colorIndex = 0;
    return (communityId: string | null | undefined) => {
      if (!communityId) return '#6b7280'; // Gri for no community
      if (!colorMap.has(communityId)) {
        colorMap.set(communityId, COMMUNITY_COLORS[colorIndex % COMMUNITY_COLORS.length]);
        colorIndex++;
      }
      return colorMap.get(communityId)!;
    };
  }, []);

  // Helper: Node size based on importance
  const getNodeSize = useCallback((node: GraphNode) => {
    const baseSize = node.type === 'entity' ? 12 : 14;
    const importanceMultiplier = 8;
    const importance = node.importance ?? 0;
    return baseSize + importance * importanceMultiplier;
  }, []);

  // Helper: Node opacity based on pageRank
  const getNodeOpacity = useCallback((node: GraphNode) => {
    const prScore = node.pageRankScore ?? 0;
    return 0.4 + prScore * 0.6;
  }, []);

  // Helper: Edge width based on displayWeight
  const getEdgeWidth = useCallback((edge: GraphEdge) => {
    const displayWeight = edge.displayWeight ?? edge.confidence ?? 0.5;
    return 1 + displayWeight * 3;
  }, []);

  // Memoized filtered data - prevents unnecessary recalculations
  const filteredData = useMemo(() => {
    if (!graphData) return { nodes: [], links: [] };

    let nodesToRender = graphData.nodes || [];
    let edgesToRender = graphData.edges || [];

    if (filterCategory !== 'all' && nodesToRender.length > 0) {
      const keptMemories = new Set(
        nodesToRender
          .filter((n) => n.type === 'memory' && n.category === filterCategory)
          .map((n) => n.id)
      );

      edgesToRender = edgesToRender.filter((e) => {
        const sId = typeof e.source === 'object' ? (e.source as GraphNode).id : e.source;
        const tId = typeof e.target === 'object' ? (e.target as GraphNode).id : e.target;

        if (sId.startsWith('memory_') && tId.startsWith('memory_')) {
          return keptMemories.has(sId) && keptMemories.has(tId);
        }
        if (sId.startsWith('memory_')) return keptMemories.has(sId);
        if (tId.startsWith('memory_')) return keptMemories.has(tId);
        return false;
      });

      const keptNodes = new Set([...keptMemories]);
      edgesToRender.forEach((e) => {
        keptNodes.add(typeof e.source === 'object' ? (e.source as GraphNode).id : e.source);
        keptNodes.add(typeof e.target === 'object' ? (e.target as GraphNode).id : e.target);
      });

      nodesToRender = nodesToRender.filter((n) => keptNodes.has(n.id));
    }

    return {
      nodes: nodesToRender.map((d) => ({ ...d })),
      links: edgesToRender.map((d) => ({ ...d })),
    };
  }, [graphData, filterCategory]);

  // Stable callback for node click
  const handleNodeClickStable = useCallback(
    (event: MouseEvent, d: GraphNode) => {
      event.stopPropagation();
      setSelectedNode(d);
      if (onNodeClick && d.type === 'memory' && d.rawId) {
        onNodeClick(d);
      }
    },
    [onNodeClick]
  );

  // Initialize SVG structure (only once)
  useEffect(() => {
    if (!containerRef.current || !svgRef.current || isInitializedRef.current) return;

    const container = containerRef.current;
    const svg = select(svgRef.current);
    const width = container.clientWidth;
    const height = container.clientHeight;

    // KESİN ÇÖZÜM: Ekran boyutu 0 iken (sekme kapalıyken) D3'ün yüklenmesini YASAKLA!
    if (width === 0 || height === 0) return;

    svg.selectAll('*').remove();

    // Set SVG dimensions
    svg.attr('width', width).attr('height', height);

    // Create defs for arrow markers
    const defs = svg.append('defs');
    ['supports', 'contradicts', 'caused_by', 'part_of'].forEach((type) => {
      defs
        .append('marker')
        .attr('id', `arrow-${type}`)
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 25)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', EDGE_COLORS[type] || '#475569');
    });

    // Create container group for zoom/pan
    const g = svg.append('g').attr('class', 'zoom-group');
    gRef.current = g;

    // Create link and node groups inside g
    linkGroupRef.current = g.append('g').attr('class', 'links');
    nodeGroupRef.current = g.append('g').attr('class', 'nodes');

    // Zoom behavior - NO transitions for instant camera positioning
    const zoomBehavior = d3Zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    zoomRef.current = zoomBehavior;
    svg.call(zoomBehavior);

    // Initial zoom - instant, no animation (critical for hidden container first render)
    const initialTransform = zoomIdentity
      .translate(width / 2, height / 2)
      .scale(0.8)
      .translate(-width / 2, -height / 2);
    svg.call(zoomRef.current!.transform, initialTransform);

    isInitializedRef.current = true;

    // Handle window resize
    let lastWidth = width;
    let lastHeight = height;

    const handleResize = () => {
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;

      if (newWidth === 0 || newHeight === 0) return;

      svg.attr('width', newWidth).attr('height', newHeight);

      // If opening from a hidden state (0x0), update the zoom camera to the new center
      // Use .call(zoom.transform, ...) without transition for instant update
      if (lastWidth === 0 || lastHeight === 0) {
        const recalcTransform = zoomIdentity
          .translate(newWidth / 2, newHeight / 2)
          .scale(0.8)
          .translate(-newWidth / 2, -newHeight / 2);
        
        // CRITICAL: Pass null as transition to disable interpolation (no flying animation)
        svg.call(zoomRef.current!.transform, recalcTransform);
      }

      if (simulationRef.current) {
        // Move the center of gravity to the new screen center
        simulationRef.current.force('center', forceCenter(newWidth / 2, newHeight / 2));
        simulationRef.current.alpha(0.3).restart();
      }

      lastWidth = newWidth;
      lastHeight = newHeight;
    };

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [loading, isReady]);

  // D3 incremental rendering with join pattern
  useEffect(() => {
    if (
      !isInitializedRef.current ||
      !gRef.current ||
      !linkGroupRef.current ||
      !nodeGroupRef.current ||
      !containerRef.current
    )
      return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Handle empty state
    if (filteredData.nodes.length === 0) {
      // Clear existing content and show empty message
      linkGroupRef.current.selectAll('line').remove();
      nodeGroupRef.current.selectAll('g').remove();

      // Add empty message if not exists
      const existingEmptyMsg = gRef.current.select<SVGTextElement>('.empty-message');
      if (existingEmptyMsg.empty()) {
        gRef.current
          .append('text')
          .attr('class', 'empty-message')
          .attr('x', 0)
          .attr('y', 0)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('fill', '#64748b')
          .attr('font-size', '14px')
          .text('Bu filtre için bellek bulunamadı');
      }
      return;
    }

    // Remove empty message if exists
    gRef.current.select('.empty-message').remove();

    // Stop previous simulation
    if (simulationRef.current) {
      simulationRef.current.stop();
    }

    const nodes = filteredData.nodes;
    const links = filteredData.links;

    // İlk açılışta düğümlerin (0,0) noktasından sol üst köşeden uçarak gelmesini engellemek için
    // onları doğrudan ekranın tam ortasında (merkezde) başlatıyoruz.
    nodes.forEach(node => {
      if (node.x === undefined || node.y === undefined) {
        // Eğer daha önce hesaplanmış bir konumu yoksa, tam ortadan doğsun
        node.x = width > 0 ? width / 2 : 400;
        node.y = height > 0 ? height / 2 : 300;
      }
    });

    // Create or update force simulation
    const simulation = forceSimulation<GraphNode>(nodes)
      .force(
        'link',
        forceLink<GraphNode, GraphEdge>(links)
          .id((d) => d.id)
          .distance((d) => (d.type === 'has_entity' ? 60 : 120))
          .strength((d) => (d.type === 'has_entity' ? 0.8 : d.confidence * 0.5))
      )
      .force(
        'charge',
        forceManyBody<GraphNode>().strength((d) => (d.type === 'entity' ? -150 : -250))
      )
      .force('center', forceCenter(width / 2, height / 2))
      .force(
        'collision',
        forceCollide<GraphNode>().radius((d) => (d.type === 'entity' ? 20 : 30))
      );

    simulationRef.current = simulation;

    // Drag behavior
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dragBehavior: any = drag()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('start', (event: any, d: any) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('drag', (event: any, d: any) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('end', (event: any, d: any) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    // Links - using join pattern for incremental update
    const link = linkGroupRef.current.selectAll<SVGLineElement, GraphEdge>('line').data(links, (d) => {
      const sId = typeof d.source === 'object' ? (d.source as GraphNode).id : d.source;
      const tId = typeof d.target === 'object' ? (d.target as GraphNode).id : d.target;
      return `${sId}-${tId}`;
    });

    // Enter + Update pattern
    const linkEnter = link
      .enter()
      .append('line')
      .attr('stroke', (d) => EDGE_COLORS[d.type] || '#475569')
      .attr('stroke-opacity', (d) => (d.type === 'has_entity' ? 0.2 : Math.max(0.3, d.confidence * 0.8)))
      .attr('stroke-width', (d) => getEdgeWidth(d))
      .attr('stroke-dasharray', (d) =>
        d.type === 'contradicts' ? '5,5' : d.type === 'has_entity' ? '2,4' : null
      )
      .attr('marker-end', (d) => {
        if (['supports', 'caused_by', 'part_of'].includes(d.type)) return `url(#arrow-${d.type})`;
        return null;
      });

    // Update existing links - NO transition on initial render to prevent flying from corner
    link
      .merge(linkEnter)
      .attr('stroke', (d) => EDGE_COLORS[d.type] || '#475569')
      .attr('stroke-opacity', (d) => (d.type === 'has_entity' ? 0.2 : Math.max(0.3, d.confidence * 0.8)))
      .attr('stroke-width', (d) => getEdgeWidth(d));

    // Exit - remove old links with transition
    link.exit().transition().duration(200).attr('stroke-opacity', 0).remove();

    const linkMerge = linkEnter.merge(link);

    // Nodes - using join pattern for incremental update
    const node = nodeGroupRef.current.selectAll<SVGGElement, GraphNode>('g').data(nodes, (d) => d.id);

    // Enter - create new node groups
    const nodeEnter = node.enter().append('g').style('cursor', 'pointer').call(dragBehavior);

    // Memory nodes - rounded rectangles (only for new nodes)
    nodeEnter
      .filter((d) => d.type === 'memory')
      .append('rect')
      .attr('class', 'node-shape')
      .attr('width', (d) => getNodeSize(d) * 2)
      .attr('height', (d) => getNodeSize(d) * 2)
      .attr('x', (d) => -getNodeSize(d))
      .attr('y', (d) => -getNodeSize(d))
      .attr('rx', 6)
      .attr('ry', 6)
      .attr('fill', (d) => {
        // Use community color if available, otherwise fall back to category
        if (d.communityId) return communityColorMap(d.communityId);
        return CATEGORY_COLORS[d.category || ''] || '#6366f1';
      })
      .attr('fill-opacity', (d) => getNodeOpacity(d))
      .attr('stroke', (d) => {
        if (d.communityId) return communityColorMap(d.communityId);
        return CATEGORY_COLORS[d.category || ''] || '#6366f1';
      })
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.4);

    // Entity nodes - circles (only for new nodes)
    nodeEnter
      .filter((d) => d.type === 'entity')
      .append('circle')
      .attr('class', 'node-shape')
      .attr('r', (d) => getNodeSize(d))
      .attr('fill', (d) => {
        // Use community color if available, otherwise fall back to entity type
        if (d.communityId) return communityColorMap(d.communityId);
        return ENTITY_TYPE_COLORS[d.entityType || ''] || '#64748b';
      })
      .attr('fill-opacity', (d) => getNodeOpacity(d))
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.6);

    // Labels (only for new nodes)
    nodeEnter
      .append('text')
      .attr('class', 'node-label')
      .attr('dy', (d) => (d.type === 'entity' ? 24 : 26))
      .attr('text-anchor', 'middle')
      .attr('font-size', (d) => (d.type === 'entity' ? '10px' : '11px'))
      .attr('fill', '#94a3b8')
      .attr('pointer-events', 'none')
      .text((d) => {
        const maxLen = d.type === 'entity' ? 20 : 25;
        return d.label.length > maxLen ? d.label.substring(0, maxLen - 2) + '…' : d.label;
      });

    // Importance indicator for memory nodes (only for new nodes)
    nodeEnter
      .filter((d) => d.type === 'memory' && (d.importance ?? 0) >= 7)
      .append('text')
      .attr('class', 'importance-indicator')
      .attr('text-anchor', 'middle')
      .attr('dy', 4)
      .attr('font-size', '12px')
      .attr('pointer-events', 'none')
      .text('⭐');

    // Entity type icon (only for new nodes)
    nodeEnter
      .filter((d) => d.type === 'entity')
      .append('text')
      .attr('class', 'entity-icon')
      .attr('text-anchor', 'middle')
      .attr('dy', 4)
      .attr('font-size', '10px')
      .attr('pointer-events', 'none')
      .text((d) => ENTITY_ICONS[d.entityType || ''] || '•');

    // Merge enter + update
    const nodeMerge = nodeEnter.merge(node);

    // Update existing node colors (for category changes) - instant, no animation
    nodeMerge.each(function (d) {
      const g = select(this);
      const shape = g.select<SVGElement>('.node-shape');
      if (d.type === 'memory') {
        shape
          .attr('fill', CATEGORY_COLORS[d.category || ''] || '#6366f1')
          .attr('stroke', CATEGORY_COLORS[d.category || ''] || '#6366f1');
      } else if (d.type === 'entity') {
        shape
          .attr('fill', ENTITY_TYPE_COLORS[d.entityType || ''] || '#64748b');
      }
    });

    // Exit - remove old nodes with transition
    node.exit().transition().duration(200).attr('opacity', 0).remove();

    // Hover and click interactions (using event delegation pattern)
    nodeMerge
      .on('mouseover', function (_event, d) {
        select(this).raise();
        linkMerge.attr('stroke-opacity', (l) => {
          const sourceId = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source;
          const targetId = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target;
          if (sourceId === d.id || targetId === d.id) return 1;
          return 0.1;
        });
        nodeMerge.style('opacity', (n) => {
          if (n.id === d.id) return 1;
          const connected = links.some((l) => {
            const sourceId = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source;
            const targetId = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target;
            return (sourceId === d.id && targetId === n.id) || (targetId === d.id && sourceId === n.id);
          });
          return connected ? 1 : 0.2;
        });
      })
      .on('mouseout', function () {
        linkMerge.attr('stroke-opacity', (d) =>
          d.type === 'has_entity' ? 0.2 : Math.max(0.3, d.confidence * 0.8)
        );
        nodeMerge.style('opacity', 1);
      })
      .on('click', handleNodeClickStable);

    // Tick function - optimized for incremental updates
    simulation.on('tick', () => {
      linkMerge
        .attr('x1', (d) => (d.source as GraphNode).x ?? 0)
        .attr('y1', (d) => (d.source as GraphNode).y ?? 0)
        .attr('x2', (d) => (d.target as GraphNode).x ?? 0)
        .attr('y2', (d) => (d.target as GraphNode).y ?? 0);

      nodeMerge.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => {
      simulation.stop();
    };
  }, [filteredData, handleNodeClickStable]);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    if (svgRef.current && zoomRef.current) {
      select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy, 1.5);
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    if (svgRef.current && zoomRef.current) {
      select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy, 0.67);
    }
  }, []);

  const handleReset = useCallback(() => {
    if (svgRef.current && zoomRef.current && containerRef.current) {
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      const initialTransform = zoomIdentity
        .translate(width / 2, height / 2)
        .scale(0.8)
        .translate(-width / 2, -height / 2);
      select(svgRef.current).transition().duration(500).call(zoomRef.current.transform, initialTransform);
    }
  }, []);

  const handleFitToScreen = useCallback(() => {
    if (svgRef.current && zoomRef.current && containerRef.current) {
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      select(svgRef.current)
        .transition()
        .duration(500)
        .call(
          zoomRef.current.transform,
          zoomIdentity
            .translate(width / 2, height / 2)
            .scale(1)
            .translate(-width / 2, -height / 2)
        );
    }
  }, []);

  return {
    containerRef,
    svgRef,
    loading,
    error,
    selectedNode,
    graphData: graphData ?? null,
    metadata: graphData?.metadata ?? null,
    setSelectedNode,
    handleZoomIn,
    handleZoomOut,
    handleReset,
    handleFitToScreen,
    refetch: () => rqRefetch().then(() => {}),
  };
}
