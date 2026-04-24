import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { api } from '@/lib/api-client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

type OnboardingDialogProps = {
  open: boolean;
  onCompleted: () => void;
};

export const OnboardingDialog = ({ open, onCompleted }: OnboardingDialogProps) => {
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim() || !bio.trim()) return;

    setSaving(true);
    try {
      await api.post('/settings', { defaultUserName: name.trim() });

      await api.post('/onboarding/process', { bio: bio.trim(), userName: name.trim() });

      onCompleted();
    } catch (error) {
      console.error('Onboarding kaydedilemedi:', error);
      onCompleted();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent className="max-w-2xl border-border/60 bg-card sm:rounded-none [&>button]:hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-label">
            <Sparkles className="h-4 w-4" />
            İlk Kurulum
          </DialogTitle>
          <DialogDescription>
            PençeAI’ın sizi daha iyi tanıyabilmesi için kısa bir isim ve biyografi paylaşın. Eski dashboard’daki onboarding akışı React arayüzüne taşındı.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="space-y-2 text-sm">
            <span>Size nasıl hitap edeyim?</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Örn. Yiğit" />
          </label>
          <label className="space-y-2 text-sm">
            <span>Kendinizden biraz bahsedin</span>
            <Textarea rows={8} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="İlgi alanlarınız, çalıştığınız projeler, sevdiğiniz teknolojiler..." />
          </label>
        </div>

        <div className="flex justify-end">
          <Button className="rounded-none" onClick={handleSubmit} disabled={saving || !name.trim() || !bio.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Tanışalım
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};