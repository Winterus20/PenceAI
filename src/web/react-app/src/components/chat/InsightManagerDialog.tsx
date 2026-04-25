import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { insightService, type InsightItem } from '@/services/memoryService';
import toast from 'react-hot-toast';
import { Brain, ThumbsUp, ThumbsDown, Search, RotateCcw, Check, X } from 'lucide-react';

interface InsightManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function statusLabel(status: string) {
  switch (status) {
    case 'active': return 'Aktif';
    case 'suppressed': return 'Bastırılmış';
    case 'pruned': return 'Temizlenmiş';
    default: return status;
  }
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'active': return 'default';
    case 'suppressed': return 'secondary';
    case 'pruned': return 'destructive';
    default: return 'outline';
  }
}

export function InsightManagerDialog({ open, onOpenChange }: InsightManagerDialogProps) {
  const [insights, setInsights] = useState<InsightItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');

  const loadInsights = useCallback(async () => {
    setLoading(true);
    try {
      const data = query.trim()
        ? await insightService.search(query.trim())
        : await insightService.getAll();
      setInsights(data);
    } catch {
      toast.error('Insight listesi alınamadı');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    if (open) loadInsights();
  }, [open, loadInsights]);

  const handleStatusChange = async (id: number, status: InsightItem['status']) => {
    try {
      await insightService.update(id, { status });
      setInsights(prev => prev.map(i => (i.id === id ? { ...i, status } : i)));
      toast.success('Durum güncellendi');
    } catch {
      toast.error('Güncelleme başarısız');
    }
  };

  const handleFeedback = async (id: number, isPositive: boolean) => {
    try {
      await insightService.feedback(id, isPositive);
      toast.success(isPositive ? 'Olumlu feedback kaydedildi' : 'Olumsuz feedback kaydedildi');
    } catch {
      toast.error('Feedback gönderilemedi');
    }
  };

  const startEdit = (item: InsightItem) => {
    setEditingId(item.id);
    setEditText(item.description);
  };

  const saveEdit = async (id: number) => {
    try {
      await insightService.update(id, { description: editText });
      setInsights(prev => prev.map(i => (i.id === id ? { ...i, description: editText } : i)));
      setEditingId(null);
      toast.success('Açıklama güncellendi');
    } catch {
      toast.error('Güncelleme başarısız');
    }
  };

  const handlePrune = async () => {
    try {
      const res = await insightService.prune();
      toast.success(`Prune tamamlandı: ${res.result.pruned} temizlendi, ${res.result.suppressed} bastırıldı`);
      loadInsights();
    } catch {
      toast.error('Prune başarısız');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5" />
            Insight Manager
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 mt-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Insight ara..."
              className="pl-8"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadInsights()}
            />
          </div>
          <Button variant="outline" size="icon" onClick={loadInsights} disabled={loading}>
            <RotateCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="secondary" onClick={handlePrune}>
            Prune
          </Button>
        </div>

        <ScrollArea className="flex-1 mt-4 pr-2">
          <div className="space-y-3">
            {insights.length === 0 && !loading && (
              <div className="text-center text-muted-foreground py-8">Insight bulunamadı</div>
            )}
            {insights.map(item => (
              <div key={item.id} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    {editingId === item.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={editText}
                          onChange={e => setEditText(e.target.value)}
                          className="flex-1"
                          autoFocus
                        />
                        <Button size="icon" variant="ghost" onClick={() => saveEdit(item.id)}>
                          <Check className="w-4 h-4 text-green-600" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setEditingId(null)}>
                          <X className="w-4 h-4 text-red-600" />
                        </Button>
                      </div>
                    ) : (
                      <p
                        className="text-sm font-medium cursor-pointer hover:underline"
                        onClick={() => startEdit(item)}
                        title="Düzenlemek için tıklayın"
                      >
                        {item.description}
                      </p>
                    )}
                  </div>
                  <Badge variant={statusVariant(item.status)}>{statusLabel(item.status)}</Badge>
                </div>

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center gap-3">
                    <span>Tip: {item.type}</span>
                    <span>Güven: {(item.confidence * 100).toFixed(0)}%</span>
                    <span>Hit: {item.hitCount}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={item.status}
                      onValueChange={(v: InsightItem['status']) => handleStatusChange(item.id, v)}
                    >
                      <SelectTrigger className="h-7 text-xs w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Aktif</SelectItem>
                        <SelectItem value="suppressed">Bastır</SelectItem>
                        <SelectItem value="pruned">Temizle</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => handleFeedback(item.id, true)}
                    >
                      <ThumbsUp className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => handleFeedback(item.id, false)}
                    >
                      <ThumbsDown className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
