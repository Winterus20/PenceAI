import {
  CATEGORY_COLORS,
  ENTITY_TYPE_COLORS,
  ENTITY_ICONS,
  type GraphNode,
} from '@/hooks/useMemoryGraph';

interface MemoryNodeDetailsProps {
  node: GraphNode;
  onClose: () => void;
}

/**
 * Seçili düğüm detay paneli bileşeni
 * Memory veya Entity düğümüne tıklandığında detaylarını gösterir
 */
export function MemoryNodeDetails({ node, onClose }: MemoryNodeDetailsProps) {
  return (
    <div className="absolute bottom-4 right-4 z-10 w-80 rounded-2xl border border-white/6 bg-black/60 p-4 backdrop-blur-sm">
      <button
        className="absolute right-3 top-3 text-white/50 hover:text-white"
        onClick={onClose}
        aria-label="Kapat"
      >
        ✕
      </button>
      {node.type === 'memory' ? (
        <>
          <div className="mb-2 flex items-center gap-2">
            <div
              className="h-3 w-3 rounded-sm"
              style={{ backgroundColor: CATEGORY_COLORS[node.category || ''] || '#6366f1' }}
            />
            <span className="text-caption font-medium uppercase">
              {node.category || 'Belirsiz'}
            </span>
            {node.importance && (
              <span className="ml-auto text-xs text-white/58">Önem: {node.importance}/10</span>
            )}
          </div>
          <p className="text-sm leading-6 text-white/86">
            {node.fullContent || node.label}
          </p>
        </>
      ) : (
        <>
          <div className="mb-2 flex items-center gap-2">
            <div
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: ENTITY_TYPE_COLORS[node.entityType || ''] || '#64748b' }}
            />
            <span className="text-caption font-medium uppercase">
              {ENTITY_ICONS[node.entityType || ''] || '•'} {node.entityType || 'Bilinmiyor'}
            </span>
          </div>
          <p className="text-sm font-medium text-white/86">{node.label}</p>
        </>
      )}
    </div>
  );
}
