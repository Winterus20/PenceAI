import { useEffect, useState } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type ConfirmDialogProps = {
  open: boolean;
  confirmRequest: {
    id: string;
    toolName: string;
    path?: string;
    operation?: string;
    description?: string;
  } | null;
  onApprove: () => void;
  onDeny: () => void;
};

export const ConfirmDialog = ({ open, confirmRequest, onApprove, onDeny }: ConfirmDialogProps) => {
  const [remaining, setRemaining] = useState(60);

  useEffect(() => {
    if (!open || !confirmRequest) return;

    setRemaining(60);
    const interval = window.setInterval(() => {
      setRemaining((current) => {
        if (current <= 1) {
          window.clearInterval(interval);
          onDeny();
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [open, confirmRequest, onDeny]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onDeny()}>
      <DialogContent className="max-w-xl border-border/60 bg-card sm:rounded-none">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm uppercase tracking-[0.24em]">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            Araç Onayı Gerekli
          </DialogTitle>
          <DialogDescription>
            PençeAI hassas bir işlem yapmak istiyor. Devam etmeden önce onay vermeniz gerekiyor.
          </DialogDescription>
        </DialogHeader>

        {confirmRequest ? (
          <div className="space-y-4 border border-border/60 bg-background/40 p-4 text-sm">
            <div><span className="text-muted-foreground">Araç:</span> {confirmRequest.toolName}</div>
            <div><span className="text-muted-foreground">İşlem:</span> {confirmRequest.operation || 'Belirtilmedi'}</div>
            <div><span className="text-muted-foreground">Hedef:</span> {confirmRequest.path || 'Belirtilmedi'}</div>
            <div className="whitespace-pre-wrap text-foreground/80">{confirmRequest.description || 'Açıklama yok'}</div>
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Otomatik red: {remaining}s</div>
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" className="rounded-none" onClick={onDeny}>
            <X className="h-4 w-4" />
            Reddet
          </Button>
          <Button className="rounded-none" onClick={onApprove}>
            <Check className="h-4 w-4" />
            Onayla
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};