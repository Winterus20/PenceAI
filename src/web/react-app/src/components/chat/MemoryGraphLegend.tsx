import {
  CATEGORY_COLORS,
  ENTITY_TYPE_COLORS,
  ENTITY_ICONS,
} from '@/hooks/useMemoryGraph';

/**
 * Grafik lejantı bileşeni
 * Düğüm tipleri ve varlık türleri için renk açıklamaları
 */
export function MemoryGraphLegend() {
  return (
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
  );
}
