import { useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMemoryGraph, type GraphNode } from '@/hooks/useMemoryGraph';
import { MemoryGraphControls } from './MemoryGraphControls';
import { MemoryGraphLegend } from './MemoryGraphLegend';
import { MemoryNodeDetails } from './MemoryNodeDetails';

interface MemoryGraphViewProps {
  filterCategory?: string;
  onNodeClick?: (node: GraphNode) => void;
  limit?: number;
}

/**
 * Bellek grafiği görünümü bileşeni
 * D3.js ile force-directed graph render eder
 * Mantık useMemoryGraph hook'una taşınmıştır
 */
export const MemoryGraphView = ({
  filterCategory = 'all',
  onNodeClick,
  limit = 100,
}: MemoryGraphViewProps) => {
  const [includePageRank, setIncludePageRank] = useState(true);
  const [includeCommunities, setIncludeCommunities] = useState(true);

  const handleIncludePageRankChange = useCallback((checked: boolean) => {
    setIncludePageRank(checked);
  }, []);

  const handleIncludeCommunitiesChange = useCallback((checked: boolean) => {
    setIncludeCommunities(checked);
  }, []);

  const {
    containerRef,
    svgRef,
    loading,
    error,
    selectedNode,
    setSelectedNode,
    handleZoomIn,
    handleZoomOut,
    handleReset,
    handleFitToScreen,
    refetch,
    metadata,
  } = useMemoryGraph({
    filterCategory,
    onNodeClick,
    limit,
    includePageRank,
    includeCommunities,
  });

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
        <Button variant="outline" onClick={() => void refetch()}>
          Tekrar Dene
        </Button>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* Zoom Controls */}
      <MemoryGraphControls
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onReset={handleReset}
        onFitToScreen={handleFitToScreen}
        includePageRank={includePageRank}
        includeCommunities={includeCommunities}
        onIncludePageRankChange={handleIncludePageRankChange}
        onIncludeCommunitiesChange={handleIncludeCommunitiesChange}
      />

      {/* Legend */}
      <MemoryGraphLegend metadata={metadata} />

      {/* Selected Node Info Panel */}
      {selectedNode && (
        <MemoryNodeDetails
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
        />
      )}

      {/* Graph Container */}
      <div ref={containerRef} className="min-h-[400px] flex-1">
        <svg ref={svgRef} className="h-full w-full" />
      </div>
    </div>
  );
};
