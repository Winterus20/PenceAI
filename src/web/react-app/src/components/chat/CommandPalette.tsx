import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  BrainCircuit,
  Globe,
  FileText,
  Terminal,
  Database,
  MessageSquare,
  Zap,
  Sparkles,
  ArrowRight,
  Command,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/* ─── Types ─── */

export interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  category: 'memory' | 'tools' | 'navigation' | 'quick';
  action: () => void;
  keywords?: string[];
}

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onAction: (content: string) => void;
  extraCommands?: CommandItem[];
}

/* ─── Default Commands ─── */

function buildDefaultCommands(onAction: (content: string) => void): CommandItem[] {
  return [
    {
      id: 'search-memory',
      label: 'Bellekte Ara',
      description: 'Kaydedilmiş anıları arayın',
      icon: <BrainCircuit size={16} />,
      category: 'memory',
      action: () => onAction('/bellek ara '),
      keywords: ['memory', 'search', 'bellek', 'ara', 'hatırla'],
    },
    {
      id: 'save-memory',
      label: 'Belleğe Kaydet',
      description: 'Yeni bilgi belleğe kaydet',
      icon: <Database size={16} />,
      category: 'memory',
      action: () => onAction('/bellek kaydet '),
      keywords: ['save', 'memory', 'kaydet', 'hatırla', 'not'],
    },
    {
      id: 'web-search',
      label: 'Web Araması',
      description: 'İnternette güncel bilgi ara',
      icon: <Globe size={16} />,
      category: 'tools',
      action: () => onAction('Web\'de şunu ara: '),
      keywords: ['web', 'search', 'internet', 'ara', 'google'],
    },
    {
      id: 'read-file',
      label: 'Dosya Oku',
      description: 'Bir dosyanın içeriğini oku',
      icon: <FileText size={16} />,
      category: 'tools',
      action: () => onAction('Şu dosyayı oku: '),
      keywords: ['file', 'read', 'dosya', 'oku'],
    },
    {
      id: 'run-command',
      label: 'Komut Çalıştır',
      description: 'Terminal komutu çalıştır',
      icon: <Terminal size={16} />,
      category: 'tools',
      action: () => onAction('Şu komutu çalıştır: '),
      keywords: ['command', 'terminal', 'shell', 'komut', 'çalıştır'],
    },
    {
      id: 'summarize',
      label: 'Özetle',
      description: 'Bu konuşmayı veya bir metni özetle',
      icon: <Sparkles size={16} />,
      category: 'quick',
      action: () => onAction('Bu konuşmayı özetle'),
      keywords: ['summarize', 'özetle', 'özet'],
    },
    {
      id: 'explain',
      label: 'Açıkla',
      description: 'Son cevabı daha detaylı açıkla',
      icon: <MessageSquare size={16} />,
      category: 'quick',
      action: () => onAction('Bunu daha basit bir şekilde açıkla'),
      keywords: ['explain', 'açıkla', 'detay'],
    },
    {
      id: 'think-deep',
      label: 'Derin Düşün',
      description: 'Konuyu daha derinlemesine analiz et',
      icon: <Zap size={16} />,
      category: 'quick',
      action: () => onAction('Bu konu hakkında derin analiz yap ve adım adım düşün'),
      keywords: ['think', 'analyze', 'düşün', 'analiz'],
    },
  ];
}

/* ─── Category Labels ─── */

const CATEGORY_LABELS: Record<string, string> = {
  memory: 'Bellek',
  tools: 'Araçlar',
  navigation: 'Navigasyon',
  quick: 'Hızlı İşlemler',
};

/* ─── Main Component ─── */

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onAction,
  extraCommands = [],
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const defaultCommands = useMemo(() => buildDefaultCommands(onAction), [onAction]);
  const allCommands = useMemo(() => [...defaultCommands, ...extraCommands], [defaultCommands, extraCommands]);

  const filteredCommands = useMemo(() => {
    if (!query.trim()) return allCommands;
    const lowered = query.toLowerCase();
    return allCommands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(lowered) ||
        cmd.description?.toLowerCase().includes(lowered) ||
        cmd.keywords?.some((k) => k.includes(lowered)),
    );
  }, [query, allCommands]);

  // Group by category
  const grouped = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {};
    for (const cmd of filteredCommands) {
      if (!groups[cmd.category]) groups[cmd.category] = [];
      groups[cmd.category].push(cmd);
    }
    return groups;
  }, [filteredCommands]);

  // Flatten for keyboard navigation
  const flatList = useMemo(() => filteredCommands, [filteredCommands]);

  // Reset when opening
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-cmd-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % flatList.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + flatList.length) % flatList.length);
          break;
        case 'Enter':
          e.preventDefault();
          if (flatList[selectedIndex]) {
            flatList[selectedIndex].action();
            onClose();
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [flatList, selectedIndex, onClose],
  );

  let flatIndex = -1;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Palette Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -10 }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            className="fixed top-[18%] left-1/2 -translate-x-1/2 z-[81] w-full max-w-lg"
          >
            <div className="glass-panel rounded-2xl overflow-hidden shadow-2xl">
              {/* Search input */}
              <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.06]">
                <Search size={16} className="text-muted-foreground/60 flex-shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSelectedIndex(0);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Komut ara veya yaz..."
                  className="flex-1 bg-transparent border-0 outline-none text-[15px] text-foreground/90 placeholder:text-muted-foreground/50"
                />
                <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/60 bg-white/5 border border-white/10 rounded">
                  ESC
                </kbd>
              </div>

              {/* Command list */}
              <div ref={listRef} className="max-h-[320px] overflow-y-auto subtle-scrollbar py-2">
                {flatList.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground/50">
                    Sonuç bulunamadı
                  </div>
                )}

                {Object.entries(grouped).map(([category, items]) => (
                  <div key={category} className="mb-1">
                    <div className="px-4 py-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/40 font-semibold">
                      {CATEGORY_LABELS[category] || category}
                    </div>
                    {items.map((cmd) => {
                      flatIndex++;
                      const isSelected = flatIndex === selectedIndex;
                      const currentIndex = flatIndex;
                      return (
                        <button
                          key={cmd.id}
                          data-cmd-index={currentIndex}
                          type="button"
                          className={cn(
                            'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors duration-100',
                            isSelected
                              ? 'bg-white/[0.06] text-foreground'
                              : 'text-foreground/70 hover:bg-white/[0.03]',
                          )}
                          onClick={() => {
                            cmd.action();
                            onClose();
                          }}
                          onMouseEnter={() => setSelectedIndex(currentIndex)}
                        >
                          <span
                            className={cn(
                              'flex-shrink-0 p-1.5 rounded-lg transition-colors',
                              isSelected ? 'bg-purple-500/20 text-purple-300' : 'bg-white/5 text-muted-foreground/60',
                            )}
                          >
                            {cmd.icon}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-medium truncate">{cmd.label}</div>
                            {cmd.description && (
                              <div className="text-[11px] text-muted-foreground/50 truncate">
                                {cmd.description}
                              </div>
                            )}
                          </div>
                          {isSelected && (
                            <ArrowRight size={14} className="flex-shrink-0 text-muted-foreground/40" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* Footer hint */}
              <div className="px-4 py-2.5 border-t border-white/[0.06] flex items-center gap-4 text-[10px] text-muted-foreground/40">
                <span className="flex items-center gap-1">
                  <kbd className="px-1 py-0.5 bg-white/5 border border-white/10 rounded text-[9px]">↑↓</kbd>
                  gezin
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1 py-0.5 bg-white/5 border border-white/10 rounded text-[9px]">↵</kbd>
                  seç
                </span>
                <span className="flex items-center gap-1">
                  <Command size={9} />
                  <kbd className="px-1 py-0.5 bg-white/5 border border-white/10 rounded text-[9px]">K</kbd>
                  aç/kapat
                </span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

CommandPalette.displayName = 'CommandPalette';
