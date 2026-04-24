import { useState } from 'react';
import type { MemoryGraphMetadata } from '@/hooks/useMemoryGraph';
import {
  CATEGORY_COLORS,
  ENTITY_TYPE_COLORS,
  ENTITY_ICONS,
} from '@/hooks/useMemoryGraph';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface MemoryGraphLegendProps {
  metadata?: MemoryGraphMetadata | null;
}

/**
 * Grafik lejantı bileşeni
 * Düğüm tipleri ve varlık türleri için renk açıklamaları
 */
export function MemoryGraphLegend({ metadata }: MemoryGraphLegendProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className="absolute bottom-0 left-4 z-10 max-h-[80vh] overflow-y-auto rounded-2xl border border-white/6 bg-black/40 p-4 backdrop-blur-sm">
      {/* Collapsible Header */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="mb-3 text-caption font-medium">GRAFİK LEJANTI</div>
        {isCollapsed ? (
          <ChevronDown className="h-4 w-4 text-white/68" />
        ) : (
          <ChevronUp className="h-4 w-4 text-white/68" />
        )}
      </button>

      {/* Collapsible Content */}
      <div
        className={`grid overflow-hidden transition-all duration-300 ease-in-out ${
          isCollapsed ? 'max-h-0 opacity-0' : 'max-h-[80vh] opacity-100'
        }`}
      >
        <div>
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

          {/* Metadata section - shows when enriched data is available */}
          {metadata && (
            <>
              <div className="my-3 border-t border-white/10 pt-3">
                <div className="mb-2 text-caption font-medium">GRAF METRİKLERİ</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-white/68">Toplam Düğüm:</span>
                    <span className="text-white">{metadata.totalNodes}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-white/68">Toplam Kenar:</span>
                    <span className="text-white">{metadata.totalEdges}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-white/68">Topluluklar:</span>
                    <span className="text-white">{metadata.communityCount}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-white/68">Ort. PageRank:</span>
                    <span className="text-white">{metadata.avgPageRank.toFixed(3)}</span>
                  </div>
                </div>
              </div>

              {metadata.includePageRank && (
                <div className="mb-3 border-t border-white/10 pt-3">
                  <div className="mb-2 text-caption font-medium">PAGERANK SKORU</div>
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 rounded-full bg-blue-500 opacity-40" />
                    <span className="text-xs text-white/68">Düşük (0)</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-4 w-4 rounded-full bg-blue-500 opacity-100" />
                    <span className="text-xs text-white/68">Yüksek (1)</span>
                  </div>
                </div>
              )}

              {metadata.includeCommunities && metadata.communityCount > 0 && (
                <div className="mb-3 border-t border-white/10 pt-3">
                  <div className="mb-2 text-caption font-medium">TOPLULUKLAR</div>
                  <div className="text-xs text-white/68">
                    <span>{metadata.communityCount} topluluk tespit edildi</span>
                  </div>
                  <div className="mt-2 text-xs text-white/40">
                    <span>Düğümler topluluk renklerine göre boyanmıştır</span>
                  </div>
                </div>
              )}

              <div className="border-t border-white/10 pt-3">
                <div className="mb-2 text-caption font-medium">KENAR AĞIRLIĞI</div>
                <div className="flex items-center gap-2">
                  <div className="h-0.5 w-8 bg-gray-400" />
                  <span className="text-xs text-white/68">Zayıf (0)</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1 w-8 bg-gray-400" />
                  <span className="text-xs text-white/68">Güçlü (1)</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
