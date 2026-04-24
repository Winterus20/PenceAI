import { ZoomIn, ZoomOut, RotateCcw, Maximize2, Network, GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MemoryGraphControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onFitToScreen: () => void;
  includePageRank?: boolean;
  includeCommunities?: boolean;
  onIncludePageRankChange?: (checked: boolean) => void;
  onIncludeCommunitiesChange?: (checked: boolean) => void;
}

/**
 * Zoom kontrol butonları bileşeni
 * MemoryGraphView için yakınlaştırma, uzaklaştırma, sıfırlama ve ekrana sığdırma kontrolleri
 */
export function MemoryGraphControls({
  onZoomIn,
  onZoomOut,
  onReset,
  onFitToScreen,
  includePageRank = true,
  includeCommunities = true,
  onIncludePageRankChange,
  onIncludeCommunitiesChange,
}: MemoryGraphControlsProps) {
  return (
    <div className="absolute right-4 top-4 z-10 flex gap-2">
      <Button
        variant="outline"
        size="icon"
        className="h-9 w-9 rounded-full border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white"
        onClick={onZoomIn}
        title="Yakınlaştır"
      >
        <ZoomIn className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="h-9 w-9 rounded-full border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white"
        onClick={onZoomOut}
        title="Uzaklaştır"
      >
        <ZoomOut className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="h-9 w-9 rounded-full border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white"
        onClick={onReset}
        title="Sıfırla"
      >
        <RotateCcw className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="h-9 w-9 rounded-full border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white"
        onClick={onFitToScreen}
        title="Ekrana Sığdır"
      >
        <Maximize2 className="h-4 w-4" />
      </Button>
      {onIncludePageRankChange && (
        <Button
          variant="outline"
          size="icon"
          className={`h-9 w-9 rounded-full border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white ${
            includePageRank ? 'ring-2 ring-blue-500/50' : ''
          }`}
          onClick={() => onIncludePageRankChange(!includePageRank)}
          title="PageRank Scores"
        >
          <Network className="h-4 w-4" />
        </Button>
      )}
      {onIncludeCommunitiesChange && (
        <Button
          variant="outline"
          size="icon"
          className={`h-9 w-9 rounded-full border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white ${
            includeCommunities ? 'ring-2 ring-green-500/50' : ''
          }`}
          onClick={() => onIncludeCommunitiesChange(!includeCommunities)}
          title="Community Detection"
        >
          <GitBranch className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
