import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { PencilLine, Trash2, X, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateMemory } from '@/hooks/mutations/useUpdateMemory';
import { useDeleteMemory } from '@/hooks/mutations/useDeleteMemory';
import {
  CATEGORY_COLORS,
  ENTITY_TYPE_COLORS,
  ENTITY_ICONS,
  type GraphNode,
} from '@/hooks/useMemoryGraph';

interface MemoryNodeDetailsProps {
  node: GraphNode;
  onClose: () => void;
  onMemoryUpdated?: () => void;
}

const categoryOptions = ['general', 'preference', 'fact', 'habit', 'project', 'event'];

/**
 * Seçili düğüm detay paneli bileşeni
 * Memory düğümüne tıklandığında Edit/Delete eylemleri sunar
 * Entity düğümleri için sadece bilgi gösterir
 */
export function MemoryNodeDetails({ node, onClose, onMemoryUpdated }: MemoryNodeDetailsProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(node.fullContent || node.label);
  const [editCategory, setEditCategory] = useState(node.category || 'general');
  const [editImportance, setEditImportance] = useState(node.importance ?? 5);
  const [isDeleting, setIsDeleting] = useState(false);

  const updateMemory = useUpdateMemory();
  const deleteMemory = useDeleteMemory();

  const handleSave = useCallback(async () => {
    if (!node.rawId || !editContent.trim()) return;

    await updateMemory.mutateAsync({
      id: node.rawId,
      data: {
        content: editContent.trim(),
        category: editCategory,
        importance: editImportance,
      },
    });

    setIsEditing(false);
    onMemoryUpdated?.();
  }, [node.rawId, editContent, editCategory, editImportance, updateMemory, onMemoryUpdated]);

  const handleDelete = useCallback(async () => {
    if (!node.rawId) return;

    setIsDeleting(true);
    try {
      await deleteMemory.mutateAsync(node.rawId);
      onMemoryUpdated?.();
      onClose();
    } catch {
      setIsDeleting(false);
    }
  }, [node.rawId, deleteMemory, onMemoryUpdated, onClose]);

  const isMemory = node.type === 'memory';
  const isSaving = updateMemory.isPending;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.96 }}
      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      className="absolute bottom-4 right-4 z-10 w-80 rounded-2xl border border-white/8 bg-black/70 backdrop-blur-md shadow-2xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        {isMemory ? (
          <div className="flex items-center gap-2">
            <div
              className="h-3 w-3 rounded-sm"
              style={{ backgroundColor: CATEGORY_COLORS[node.category || ''] || '#6366f1' }}
            />
            <span className="text-caption font-medium uppercase">
              {node.category || 'Belirsiz'}
            </span>
            {node.importance != null && (
              <span className="ml-auto text-xs text-white/50">Önem: {Math.round(node.importance)}/10</span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: ENTITY_TYPE_COLORS[node.entityType || ''] || '#64748b' }}
            />
            <span className="text-caption font-medium uppercase">
              {ENTITY_ICONS[node.entityType || ''] || '•'} {node.entityType || 'Bilinmiyor'}
            </span>
          </div>
        )}

        <button
          className="text-white/40 hover:text-white transition-colors p-0.5 rounded"
          onClick={onClose}
          aria-label="Kapat"
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="px-4 pb-3">
        {isEditing && isMemory ? (
          /* Edit Mode */
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-2.5"
          >
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="min-h-[80px] text-sm bg-white/[0.04] border-white/8 rounded-xl resize-none focus:border-purple-500/30 focus:ring-1 focus:ring-purple-500/20"
              rows={4}
            />
            <div className="flex gap-2">
              <select
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value)}
                className="flex-1 h-8 text-xs rounded-lg bg-white/[0.04] border border-white/8 text-foreground/80 px-2"
              >
                {categoryOptions.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={10}
                value={editImportance}
                onChange={(e) => setEditImportance(Number(e.target.value))}
                className="w-16 h-8 text-xs text-center rounded-lg bg-white/[0.04] border border-white/8 text-foreground/80"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1 h-8 rounded-lg bg-purple-600 text-white hover:bg-purple-500 text-xs border-0"
                onClick={() => void handleSave()}
                disabled={isSaving || !editContent.trim()}
              >
                {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                <span className="ml-1">Kaydet</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 rounded-lg border border-white/8 text-xs text-white/60 hover:text-white hover:bg-white/5"
                onClick={() => {
                  setIsEditing(false);
                  setEditContent(node.fullContent || node.label);
                  setEditCategory(node.category || 'general');
                  setEditImportance(node.importance ?? 5);
                }}
              >
                Vazgeç
              </Button>
            </div>
          </motion.div>
        ) : (
          /* View Mode */
          <>
            <p className="text-sm leading-6 text-white/86 mb-3">{node.fullContent || node.label}</p>

            {/* Actions — only for memory nodes with rawId */}
            {isMemory && node.rawId && (
              <div className="flex items-center gap-2 pt-2 border-t border-white/6">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2.5 rounded-lg text-xs text-white/60 hover:text-white hover:bg-white/8 transition-colors"
                  onClick={() => setIsEditing(true)}
                >
                  <PencilLine size={12} className="mr-1" />
                  Düzenle
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2.5 rounded-lg text-xs text-destructive/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
                  onClick={() => {
                    if (window.confirm('Bu belleği silmek istediğinize emin misiniz?')) {
                      void handleDelete();
                    }
                  }}
                  disabled={isDeleting}
                >
                  {isDeleting ? (
                    <Loader2 size={12} className="animate-spin mr-1" />
                  ) : (
                    <Trash2 size={12} className="mr-1" />
                  )}
                  Sil
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}

