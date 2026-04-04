import { useEffect, useMemo, useState, useCallback } from 'react';
import { BrainCircuit, Clock3, Filter, List, Loader2, Network, PencilLine, Plus, Save, Search, Tag, Trash2 } from 'lucide-react';
import {
Dialog,
DialogContent,
DialogTitle,
DialogDescription,
} from '@/components/ui/dialog';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { MemoryGraphView } from './MemoryGraphView';
import { fieldClassName, selectClassName, textareaClassName, badgeClassName, surfaceLabelClassName } from '@/styles/dialog';
import { useMemories } from '@/hooks/queries/useMemories';
import { useCreateMemory } from '@/hooks/mutations/useCreateMemory';
import { useUpdateMemory } from '@/hooks/mutations/useUpdateMemory';
import { useDeleteMemory } from '@/hooks/mutations/useDeleteMemory';
import type { MemoryItem } from '@/services/memoryService';

const defaultMemory = {
  id: null as number | null,
  content: '',
  category: 'general',
  importance: 5,
};

const categoryOptions = ['all', 'general', 'preference', 'fact', 'habit', 'project', 'event'];
const editorCategoryOptions = categoryOptions.filter((item) => item !== 'all');

const formatDate = (value?: string) => value ? new Date(value).toLocaleDateString('tr-TR') : 'Tarih yok';

const getImportanceTone = (importance: number) => {
  if (importance >= 8) return 'bg-white/90 text-black';
  if (importance >= 6) return 'bg-white/12 text-white/88';
  return 'bg-white/[0.05] text-white/58';
};

type ViewMode = 'list' | 'graph';

export const MemoryDialog = ({ open, onOpenChange, inline = false }: { open: boolean, onOpenChange: (o: boolean) => void, inline?: boolean }) => {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editor, setEditor] = useState(defaultMemory);
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  // Debounce query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  // React Query hooks
  const { data: memories = [], isLoading } = useMemories({
    searchQuery: debouncedQuery,
    enabled: open,
  });

  const createMemory = useCreateMemory();
  const updateMemory = useUpdateMemory();
  const deleteMemory = useDeleteMemory();

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCategory('all');
  }, [open]);

  const filteredMemories = useMemo(() => {
    if (category === 'all') return memories;
    return memories.filter((memory) => (memory.category || 'general') === category);
  }, [memories, category]);

  const categoryCounts = useMemo(() => {
    return editorCategoryOptions.reduce<Record<string, number>>((acc, item) => {
      acc[item] = memories.filter((memory) => (memory.category || 'general') === item).length;
      return acc;
    }, {});
  }, [memories]);

  const openEditor = useCallback((memory?: MemoryItem) => {
    if (!memory) {
      setEditor(defaultMemory);
    } else {
      setEditor({
        id: memory.id,
        content: memory.content,
        category: memory.category || 'general',
        importance: memory.importance || 5,
      });
    }
    setEditorOpen(true);
  }, []);

  const saveMemory = useCallback(async () => {
    if (!editor.content.trim()) return;

    if (editor.id) {
      await updateMemory.mutateAsync({
        id: editor.id,
        data: { content: editor.content, category: editor.category, importance: editor.importance },
      });
    } else {
      await createMemory.mutateAsync({
        content: editor.content,
        category: editor.category,
        importance: editor.importance,
      });
    }

    setEditorOpen(false);
    setEditor(defaultMemory);
  }, [editor, createMemory, updateMemory]);

  const handleDeleteMemory = useCallback(async (memoryId: number) => {
    if (!window.confirm('Bu bellek silinsin mi?')) return;
    await deleteMemory.mutateAsync(memoryId);
  }, [deleteMemory]);

  const content = (
    <div className="glass-panel flex h-full w-full flex-col overflow-hidden text-foreground">
      <div className="border-b border-white/6 bg-white/[0.015] px-6 py-5 sm:px-7 sm:py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-[1.7rem] font-semibold tracking-[-0.03em] text-foreground sm:text-[1.9rem]">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-purple-500/20 text-purple-400">
                <BrainCircuit className="h-5 w-5" />
              </span>
              Bellek Merkezi
            </div>
            <p className="max-w-3xl text-sm leading-6 text-white/62 sm:text-[15px]">
              Bellek kayıtlarını arayın, filtreleyin ve düzenleyin.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 lg:max-w-md lg:justify-end">
            <span className={badgeClassName}>{filteredMemories.length} görünür kayıt</span>
            <span className={badgeClassName}>{viewMode === 'graph' ? 'Grafik görünümü' : 'Liste görünümü'}</span>
          </div>
        </div>
      </div>

      {/* View Mode Tabs */}
      <div className="flex border-b border-white/6 bg-white/[0.01]">
        <button
          className={`flex items-center gap-2 px-6 py-3.5 text-sm font-medium transition ${
            viewMode === 'list'
              ? 'border-b-2 border-white/80 text-white/92'
              : 'text-white/52 hover:text-white/72'
          }`}
          onClick={() => setViewMode('list')}
        >
          <List className="h-4 w-4" />
          Liste
        </button>
        <button
          className={`flex items-center gap-2 px-6 py-3.5 text-sm font-medium transition ${
            viewMode === 'graph'
              ? 'border-b-2 border-white/80 text-white/92'
              : 'text-white/52 hover:text-white/72'
          }`}
          onClick={() => setViewMode('graph')}
        >
          <Network className="h-4 w-4" />
          Grafik
        </button>
      </div>

      {viewMode === 'graph' ? (
        /* Graph View */
        <div className="min-h-[500px] flex-1">
          <MemoryGraphView
            filterCategory={category === 'all' ? 'all' : category}
            onNodeClick={(node) => {
              if (node.rawId) {
                openEditor({
                  id: node.rawId,
                  content: node.fullContent || node.label,
                  category: node.category,
                  importance: node.importance,
                });
              }
            }}
          />
        </div>
      ) : (
        /* List View */
        <div className="grid min-h-0 flex-1 gap-0 xl:grid-cols-[368px_minmax(0,1fr)]">
          <aside className="min-h-0 border-b border-white/6 bg-white/[0.012] xl:border-b-0 xl:border-r xl:border-white/6">
            <div className="subtle-scrollbar h-full min-h-0 overflow-y-auto px-5 py-5 sm:px-6">
              <div className="space-y-5">
                <div className="section-surface rounded-[26px] p-5">
                  <div className={surfaceLabelClassName}>
                    <Filter className="h-3.5 w-3.5" />
                    Kontroller
                  </div>
                  <div className="space-y-3.5">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" />
                      <Input
                        className={`${fieldClassName} pl-10.5`}
                        placeholder="Bellek ara..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                    <select className={selectClassName} value={category} onChange={(e) => setCategory(e.target.value)}>
                      {categoryOptions.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                    <Button className="h-11 w-full rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-foreground transition-all duration-300" variant="outline" onClick={() => openEditor()}>
                      <Plus className="h-4 w-4" />
                      Yeni Bellek
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="section-surface rounded-[22px] p-4">
                    <div className="text-caption">Toplam</div>
                    <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{memories.length}</div>
                  </div>
                  <div className="section-surface rounded-[22px] p-4">
                    <div className="text-caption">Filtrelenen</div>
                    <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{filteredMemories.length}</div>
                  </div>
                </div>

                <div className="section-surface rounded-[26px] p-5">
                  <div className="mb-3 text-caption">Kategori yoğunluğu</div>
                  <div className="flex flex-wrap gap-2">
                    {editorCategoryOptions.map((item) => (
                      <span key={item} className="rounded-full border border-white/6 bg-white/[0.025] px-3 py-1.5 text-xs capitalize text-white/68">
                        {item} <span className="text-white/88">{categoryCounts[item] || 0}</span>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="section-surface rounded-[26px] p-5">
                  <div className="mb-4 flex items-center justify-between gap-2">
                    <div className="text-caption">
                      {editor.id ? 'Belleği düzenle' : 'Yeni bellek oluştur'}
                    </div>
                    <span className="rounded-full border border-white/6 bg-white/[0.025] px-2.5 py-1 text-caption">
                      {editorOpen ? 'Aktif' : 'Pasif'}
                    </span>
                  </div>

                  {editorOpen ? (
                    <div className="space-y-4">
                      <Textarea
                        rows={8}
                        className={textareaClassName}
                        value={editor.content}
                        onChange={(e) => setEditor((current) => ({ ...current, content: e.target.value }))}
                        placeholder="Hatırlanmasını istediğiniz bilgiyi yazın..."
                      />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <select
                          className={selectClassName}
                          value={editor.category}
                          onChange={(e) => setEditor((current) => ({ ...current, category: e.target.value }))}
                        >
                          {editorCategoryOptions.map((item) => (
                            <option key={item} value={item}>{item}</option>
                          ))}
                        </select>
                        <Input
                          className={fieldClassName}
                          type="number"
                          min={1}
                          max={10}
                          value={editor.importance}
                          onChange={(e) => setEditor((current) => ({ ...current, importance: Number(e.target.value) }))}
                        />
                      </div>
                      <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                        <Button className="h-11 flex-1 rounded-full bg-purple-600 text-white hover:bg-purple-500 shadow-[0_0_15px_rgba(147,51,234,0.4)] transition-all duration-300 border-0" onClick={() => void saveMemory()}>
                          <Save className="h-4 w-4" />
                          Kaydet
                        </Button>
                        <Button variant="ghost" className="h-11 rounded-full border border-white/6 bg-white/[0.02] text-white/82 hover:border-white/12 hover:bg-white/[0.035] hover:text-white transition-all duration-300" onClick={() => setEditorOpen(false)}>
                          Vazgeç
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-[24px] border border-dashed border-white/6 bg-white/[0.012] p-4 text-sm leading-6 text-white/58">
                      Sol alandaki kontrolleri kullanarak yeni kayıt başlatabilir veya listedeki bir belleği düzenlemeye açabilirsiniz.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </aside>

          <div className="subtle-scrollbar min-h-0 overflow-y-auto bg-gradient-to-b from-white/[0.01] to-transparent px-5 py-5 sm:px-6">
            <div className="mb-5 flex flex-wrap items-center gap-2 text-caption">
              <span className={badgeClassName}>{category === 'all' ? 'Tüm kategoriler' : category}</span>
              <span className={badgeClassName}>{query.trim() ? `Arama: ${query.trim()}` : 'Arama filtresi yok'}</span>
            </div>

            {isLoading ? (
              <div className="section-surface flex min-h-[420px] items-center justify-center rounded-[28px] text-white/68">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Bellekler yükleniyor...
              </div>
            ) : filteredMemories.length === 0 ? (
              <div className="section-surface flex min-h-[420px] flex-col items-center justify-center rounded-[28px] px-6 text-center text-white/78">
                <BrainCircuit className="mb-3 h-5 w-5 text-white/46" />
                <p className="max-w-md text-sm leading-6">Bu filtre için bellek bulunamadı. Arama terimini temizleyin veya yeni bir kayıt oluşturun.</p>
              </div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {filteredMemories.map((memory) => {
                  const importance = memory.importance || 5;
                  return (
                    <article key={memory.id} className="section-surface group rounded-[28px] p-5 transition-all duration-200 hover:border-white/10 hover:bg-white/[0.028] hover:shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
                      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/6 pb-4">
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/6 bg-white/[0.025] px-3 py-1 text-caption">
                              <Tag className="h-3.5 w-3.5" />
                              {memory.category || 'general'}
                            </span>
                            <span className={`inline-flex rounded-full px-3 py-1 text-label-sm font-medium uppercase ${getImportanceTone(importance)}`}>
                              önem {importance}/10
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-white/68">
                            <Clock3 className="h-3.5 w-3.5" />
                            {formatDate(memory.created_at)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 opacity-80 transition group-hover:opacity-100">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-9 rounded-full border-white/8 bg-white/[0.03] px-3 text-white/82 hover:border-white/12 hover:bg-white/[0.05] hover:text-white"
                            onClick={() => openEditor(memory)}
                          >
                            <PencilLine className="h-4 w-4" />
                            Düzenle
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 rounded-full border border-white/8 bg-white/[0.025] text-destructive/75 hover:border-destructive/20 hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => void handleDeleteMemory(memory.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-white/86">{memory.content}</p>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  if (inline) {
    return content;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-panel flex max-h-[calc(100dvh-1.5rem)] w-[min(96vw,84rem)] max-w-7xl flex-col overflow-hidden p-0 text-foreground">
      <VisuallyHidden.Root>
      <DialogTitle>Bellek Merkezi</DialogTitle>
      <DialogDescription>Bellek kayıtlarını arayın, filtreleyin ve düzenleyin.</DialogDescription>
      </VisuallyHidden.Root>
      {content}
      </DialogContent>
    </Dialog>
  );
};
