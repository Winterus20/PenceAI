import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { Loader2, ZoomIn, ZoomOut, RotateCcw, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Graph data types from API
type GraphNode = {
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
};

type GraphEdge = {
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
  confidence: number;
  description?: string;
};

type MemoryGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

// Color palettes - using CSS custom properties from index.css
const CATEGORY_COLORS: Record<string, string> = {
  preference: 'var(--category-preference)',
  fact: 'var(--category-fact)',
  habit: 'var(--category-habit)',
  project: 'var(--category-project)',
  event: 'var(--category-event)',
  general: 'var(--category-general)',
};

const ENTITY_TYPE_COLORS: Record<string, string> = {
  person: 'var(--entity-person)',
  technology: 'var(--entity-technology)',
  project: 'var(--entity-project)',
  place: 'var(--entity-place)',
  organization: 'var(--entity-organization)',
  concept: 'var(--entity-concept)',
};

const EDGE_COLORS: Record<string, string> = {
  related_to: 'var(--edge-related-to)',
  supports: 'var(--edge-supports)',
  contradicts: 'var(--edge-contradicts)',
  caused_by: 'var(--edge-caused-by)',
  part_of: 'var(--edge-part-of)',
  has_entity: 'var(--edge-has-entity)',
};

const ENTITY_ICONS: Record<string, string> = {
  person: '👤',
  technology: '💻',
  project: '📋',
  place: '📍',
  organization: '🏢',
  concept: '💡',
};

type MemoryGraphViewProps = {
  filterCategory?: string;
  onNodeClick?: (node: GraphNode) => void;
};

export const MemoryGraphView = ({ filterCategory = 'all', onNodeClick }: MemoryGraphViewProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<MemoryGraph | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const linkGroupRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const nodeGroupRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const isInitializedRef = useRef(false);

  // Fetch graph data
  const fetchGraphData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/memory-graph');
      if (!response.ok) throw new Error('Grafik verisi alınamadı');
      const data: MemoryGraph = await response.json();
      setGraphData(data);
    } catch (err) {
      console.error('Memory graph fetch error:', err);
      setError('Bellek grafiği yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchGraphData();
  }, [fetchGraphData]);

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
      links: edgesToRender.map((d) => ({ ...d }))
    };
  }, [graphData, filterCategory]);

  // Stable callback for node click
  const handleNodeClickStable = useCallback((event: MouseEvent, d: GraphNode) => {
    event.stopPropagation();
    setSelectedNode(d);
    if (onNodeClick && d.type === 'memory' && d.rawId) {
      onNodeClick(d);
    }
  }, [onNodeClick]);

  // Initialize SVG structure (only once)
  useEffect(() => {
    if (!containerRef.current || !svgRef.current) return;

    const container = containerRef.current;
    const svg = d3.select(svgRef.current);
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Only initialize once
    if (!isInitializedRef.current) {
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
      const g = svg.append('g');
      gRef.current = g;

      // Create link and node groups
      linkGroupRef.current = g.append('g').attr('class', 'links');
      nodeGroupRef.current = g.append('g').attr('class', 'nodes');

      // Zoom behavior
      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.2, 4])
        .on('zoom', (event) => {
          g.attr('transform', event.transform);
        });

      zoomRef.current = zoom;
      svg.call(zoom);

      // Initial zoom to fit
      const initialTransform = d3.zoomIdentity.translate(width / 2, height / 2).scale(0.8).translate(-width / 2, -height / 2);
      svg.transition().duration(500).call(zoom.transform, initialTransform);

      isInitializedRef.current = true;
    }

    // Handle window resize
    const handleResize = () => {
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      svg.attr('width', newWidth).attr('height', newHeight);
      if (simulationRef.current) {
        simulationRef.current.force('center', d3.forceCenter(newWidth / 2, newHeight / 2));
        simulationRef.current.alpha(0.3).restart();
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // D3 incremental rendering with join pattern
  useEffect(() => {
    if (!isInitializedRef.current || !gRef.current || !linkGroupRef.current || !nodeGroupRef.current || !containerRef.current) return;

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

    // Create or update force simulation
    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphEdge>(links)
          .id((d) => d.id)
          .distance((d) => (d.type === 'has_entity' ? 60 : 120))
          .strength((d) => (d.type === 'has_entity' ? 0.8 : d.confidence * 0.5))
      )
      .force('charge', d3.forceManyBody<GraphNode>().strength((d) => (d.type === 'entity' ? -150 : -250)))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<GraphNode>().radius((d) => (d.type === 'entity' ? 20 : 30)));

    simulationRef.current = simulation;

    // Drag behavior
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const drag: any = d3.drag()
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
    const link = linkGroupRef.current
      .selectAll<SVGLineElement, GraphEdge>('line')
      .data(links, (d) => {
        const sId = typeof d.source === 'object' ? (d.source as GraphNode).id : d.source;
        const tId = typeof d.target === 'object' ? (d.target as GraphNode).id : d.target;
        return `${sId}-${tId}`;
      });

    // Enter + Update pattern
    const linkEnter = link.enter()
      .append('line')
      .attr('stroke', (d) => EDGE_COLORS[d.type] || '#475569')
      .attr('stroke-opacity', (d) => (d.type === 'has_entity' ? 0.2 : Math.max(0.3, d.confidence * 0.8)))
      .attr('stroke-width', (d) => (d.type === 'has_entity' ? 1 : Math.max(1, d.confidence * 3)))
      .attr('stroke-dasharray', (d) =>
        d.type === 'contradicts' ? '5,5' : d.type === 'has_entity' ? '2,4' : null
      )
      .attr('marker-end', (d) => {
        if (['supports', 'caused_by', 'part_of'].includes(d.type)) return `url(#arrow-${d.type})`;
        return null;
      });

    // Update existing links
    link.merge(linkEnter)
      .transition()
      .duration(300)
      .attr('stroke', (d) => EDGE_COLORS[d.type] || '#475569')
      .attr('stroke-opacity', (d) => (d.type === 'has_entity' ? 0.2 : Math.max(0.3, d.confidence * 0.8)))
      .attr('stroke-width', (d) => (d.type === 'has_entity' ? 1 : Math.max(1, d.confidence * 3)));

    // Exit - remove old links with transition
    link.exit()
      .transition()
      .duration(200)
      .attr('stroke-opacity', 0)
      .remove();

    const linkMerge = linkEnter.merge(link);

    // Nodes - using join pattern for incremental update
    const node = nodeGroupRef.current
      .selectAll<SVGGElement, GraphNode>('g')
      .data(nodes, (d) => d.id);

    // Enter - create new node groups
    const nodeEnter = node.enter()
      .append('g')
      .style('cursor', 'pointer')
      .call(drag);

    // Memory nodes - rounded rectangles (only for new nodes)
    nodeEnter.filter((d) => d.type === 'memory')
      .append('rect')
      .attr('class', 'node-shape')
      .attr('width', 28)
      .attr('height', 28)
      .attr('x', -14)
      .attr('y', -14)
      .attr('rx', 6)
      .attr('ry', 6)
      .attr('fill', (d) => CATEGORY_COLORS[d.category || ''] || '#6366f1')
      .attr('fill-opacity', 0.8)
      .attr('stroke', (d) => CATEGORY_COLORS[d.category || ''] || '#6366f1')
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.4);

    // Entity nodes - circles (only for new nodes)
    nodeEnter.filter((d) => d.type === 'entity')
      .append('circle')
      .attr('class', 'node-shape')
      .attr('r', 12)
      .attr('fill', (d) => ENTITY_TYPE_COLORS[d.entityType || ''] || '#64748b')
      .attr('fill-opacity', 0.9)
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
    nodeEnter.filter((d) => d.type === 'memory' && (d.importance ?? 0) >= 7)
      .append('text')
      .attr('class', 'importance-indicator')
      .attr('text-anchor', 'middle')
      .attr('dy', 4)
      .attr('font-size', '12px')
      .attr('pointer-events', 'none')
      .text('⭐');

    // Entity type icon (only for new nodes)
    nodeEnter.filter((d) => d.type === 'entity')
      .append('text')
      .attr('class', 'entity-icon')
      .attr('text-anchor', 'middle')
      .attr('dy', 4)
      .attr('font-size', '10px')
      .attr('pointer-events', 'none')
      .text((d) => ENTITY_ICONS[d.entityType || ''] || '•');

    // Merge enter + update
    const nodeMerge = nodeEnter.merge(node);

    // Update existing node colors (for category changes)
    nodeMerge.each(function(d) {
      const g = d3.select(this);
      const shape = g.select<SVGElement>('.node-shape');
      if (d.type === 'memory') {
        shape
          .transition()
          .duration(300)
          .attr('fill', CATEGORY_COLORS[d.category || ''] || '#6366f1')
          .attr('stroke', CATEGORY_COLORS[d.category || ''] || '#6366f1');
      } else if (d.type === 'entity') {
        shape
          .transition()
          .duration(300)
          .attr('fill', ENTITY_TYPE_COLORS[d.entityType || ''] || '#64748b');
      }
    });

    // Exit - remove old nodes with transition
    node.exit()
      .transition()
      .duration(200)
      .attr('opacity', 0)
      .remove();

    // Hover and click interactions (using event delegation pattern)
    nodeMerge
      .on('mouseover', function (_event, d) {
        d3.select(this).raise();
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
        linkMerge.attr('stroke-opacity', (d) => (d.type === 'has_entity' ? 0.2 : Math.max(0.3, d.confidence * 0.8)));
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
  const handleZoomIn = () => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy, 1.5);
    }
  };

  const handleZoomOut = () => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy, 0.67);
    }
  };

  const handleReset = () => {
    if (svgRef.current && zoomRef.current && containerRef.current) {
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      const initialTransform = d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(0.8)
        .translate(-width / 2, -height / 2);
      d3.select(svgRef.current).transition().duration(500).call(zoomRef.current.transform, initialTransform);
    }
  };

  const handleFitToScreen = () => {
    if (svgRef.current && zoomRef.current && containerRef.current) {
      d3.select(svgRef.current).transition().duration(500).call(zoomRef.current.transform, d3.zoomIdentity.translate(0, 0).scale(1));
    }
  };

  if (loading) {
    return (
      <div className="flex h-full min-h-[400px] items-center justify-center text-white/68">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Grafik yükleniyor...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full min-h-[400px] flex-col items-center justify-center text-white/68">
        <p className="mb-4">{error}</p>
        <Button variant="outline" onClick={() => void fetchGraphData()}>
          Tekrar Dene
        </Button>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* Zoom Controls */}
      <div className="absolute right-4 top-4 z-10 flex gap-2">
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 rounded-full border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white"
          onClick={handleZoomIn}
          title="Yakınlaştır"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 rounded-full border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white"
          onClick={handleZoomOut}
          title="Uzaklaştır"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 rounded-full border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white"
          onClick={handleReset}
          title="Sıfırla"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 rounded-full border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white"
          onClick={handleFitToScreen}
          title="Ekrana Sığdır"
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-10 rounded-2xl border border-white/6 bg-black/40 p-4 backdrop-blur-sm">
        <div className="mb-3 text-caption font-medium">DÜĞÜMLER</div>
        <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
            <div key={cat} className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
              <span className="capitalize text-white/68">{cat}</span>
            </div>
          ))}
        </div>
        <div className="mb-2 text-caption font-medium">VARLIKLAR</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          {Object.entries(ENTITY_TYPE_COLORS).map(([type, color]) => (
            <div key={type} className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-white/68">
                {ENTITY_ICONS[type] || '•'} {type}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Selected Node Info Panel */}
      {selectedNode && (
        <div className="absolute bottom-4 right-4 z-10 w-80 rounded-2xl border border-white/6 bg-black/60 p-4 backdrop-blur-sm">
          <button
            className="absolute right-3 top-3 text-white/50 hover:text-white"
            onClick={() => setSelectedNode(null)}
          >
            ✕
          </button>
          {selectedNode.type === 'memory' ? (
            <>
              <div className="mb-2 flex items-center gap-2">
                <div
                  className="h-3 w-3 rounded-sm"
                  style={{ backgroundColor: CATEGORY_COLORS[selectedNode.category || ''] || '#6366f1' }}
                />
                <span className="text-caption font-medium uppercase">
                  {selectedNode.category || 'Belirsiz'}
                </span>
                {selectedNode.importance && (
                  <span className="ml-auto text-xs text-white/58">Önem: {selectedNode.importance}/10</span>
                )}
              </div>
              <p className="text-sm leading-6 text-white/86">
                {selectedNode.fullContent || selectedNode.label}
              </p>
            </>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-2">
                <div
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: ENTITY_TYPE_COLORS[selectedNode.entityType || ''] || '#64748b' }}
                />
                <span className="text-caption font-medium uppercase">
                  {ENTITY_ICONS[selectedNode.entityType || ''] || '•'} {selectedNode.entityType || 'Bilinmiyor'}
                </span>
              </div>
              <p className="text-sm font-medium text-white/86">{selectedNode.label}</p>
            </>
          )}
        </div>
      )}

      {/* Graph Container */}
      <div ref={containerRef} className="min-h-[400px] flex-1">
        <svg ref={svgRef} className="h-full w-full" />
      </div>
    </div>
  );
};
