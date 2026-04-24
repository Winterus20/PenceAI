import { useState, lazy, Suspense } from 'react';
import { Settings, BookOpen, Store, Radio, BarChart3, Menu, X, Terminal } from 'lucide-react';
import { UsageStatsCard } from '@/components/settings/UsageStatsCard';
import { AnimatePresence, motion } from 'framer-motion';
import type { ActiveView } from '../../store/agentStore';

const SettingsDialog = lazy(() => import('./SettingsDialog').then(m => ({ default: m.SettingsDialog })));
const MemoryDialog = lazy(() => import('./MemoryDialog').then(m => ({ default: m.MemoryDialog })));

interface SidebarMenuProps {
  setActiveView: (view: ActiveView) => void;
}

const MENU_ITEMS = [
  { id: 'settings', label: 'Ayarlar', icon: Settings, color: 'text-purple-400', bg: 'bg-purple-500/10 hover:bg-purple-500/20' },
  { id: 'memory', label: 'Bellek', icon: BookOpen, color: 'text-blue-400', bg: 'bg-blue-500/10 hover:bg-blue-500/20' },
  { id: 'metrics', label: 'Metrics', icon: BarChart3, color: 'text-cyan-400', bg: 'bg-cyan-500/10 hover:bg-cyan-500/20' },
  { id: 'marketplace', label: 'Marketplace', icon: Store, color: 'text-green-400', bg: 'bg-green-500/10 hover:bg-green-500/20' },
  { id: 'channels', label: 'Kanallar', icon: Radio, color: 'text-orange-400', bg: 'bg-orange-500/10 hover:bg-orange-500/20' },
  { id: 'logs', label: 'Loglar', icon: Terminal, color: 'text-gray-300', bg: 'bg-gray-500/10 hover:bg-gray-500/20' },
] as const;

export function SidebarMenu({ setActiveView }: SidebarMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeDialog, setActiveDialog] = useState<string | null>(null);

  const handleItemClick = (id: string) => {
    setIsOpen(false);
    if (id === 'channels') {
      setActiveView('channels');
      return;
    }
    if (id === 'marketplace') {
      setActiveView('mcp-marketplace');
      return;
    }
    if (id === 'metrics') {
      setActiveView('metrics');
      return;
    }
    if (id === 'logs') {
      setActiveView('logs');
      return;
    }
    setActiveDialog(id);
  };

  return (
    <>
      {/* Menu Button */}
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center justify-center gap-2 w-full rounded-xl py-2.5 text-xs font-medium text-muted-foreground transition-all hover:bg-white/10 hover:text-foreground"
        >
          <Menu className="h-4 w-4" />
          <span>Menü</span>
        </button>

        {/* Dropdown Menu */}
        <AnimatePresence>
          {isOpen && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-40"
                onClick={() => setIsOpen(false)}
              />
              {/* Menu */}
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-border/40 bg-surface/95 backdrop-blur-xl shadow-xl z-50 overflow-hidden"
              >
                <div className="p-2">
                  {MENU_ITEMS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleItemClick(item.id)}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${item.bg}`}
                      >
                        <Icon className={`h-4 w-4 ${item.color}`} />
                        <span className="text-foreground">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* Dialogs */}
      <Suspense fallback={null}><SettingsDialog open={activeDialog === 'settings'} onOpenChange={(open) => !open && setActiveDialog(null)} /></Suspense>
      <Suspense fallback={null}><MemoryDialog open={activeDialog === 'memory'} onOpenChange={(open) => !open && setActiveDialog(null)} /></Suspense>
      <DialogWrapper open={activeDialog === 'usage'} onOpenChange={(open) => !open && setActiveDialog(null)} title="Kullanım İstatistikleri">
        <UsageStatsCard />
      </DialogWrapper>
      <DialogWrapper open={activeDialog === 'marketplace'} onOpenChange={(open) => !open && setActiveDialog(null)} title="MCP Marketplace">
        <div className="text-sm text-muted-foreground">Marketplace yakında eklenecek...</div>
      </DialogWrapper>
    </>
  );
}

function DialogWrapper({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => onOpenChange(false)}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="glass-panel relative w-[min(90vw,50rem)] max-h-[80vh] rounded-2xl border border-border/40 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">{children}</div>
      </motion.div>
    </div>
  );
}
