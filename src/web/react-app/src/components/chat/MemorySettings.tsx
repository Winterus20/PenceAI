import React from 'react';
import { Sparkles } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { fieldClassName } from '@/styles/dialog';

const sectionClassName = 'section-surface rounded-[26px] border-surface';
const labelClassName = 'space-y-2 text-sm text-surface-strong';

const SettingsSection = ({ title, description, icon, children }: { title: string; description: string; icon: React.ReactNode; children: React.ReactNode }) => (
  <section className={sectionClassName}>
    <div className="flex items-start gap-3 px-5 pb-4 pt-5 sm:px-6">
      <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl bg-surface-xl text-surface">
        {icon}
      </div>
      <div className="space-y-1.5">
        <div className="text-sm font-medium tracking-[-0.01em] text-surface-emphasis">{title}</div>
        <p className="max-w-2xl text-sm leading-6 text-surface-strong">{description}</p>
      </div>
    </div>
    <div className="space-y-4 border-t border-surface px-5 py-5 sm:px-6">{children}</div>
  </section>
);

export interface MemorySettingsProps {
  form: {
    autonomousStepLimit: string;
    memoryDecayThreshold: string;
    semanticSearchThreshold: string;
  };
  updateField: (key: string, value: string) => void;
}

export const MemorySettings: React.FC<MemorySettingsProps> = ({
  form,
  updateField,
}) => {
  return (
    <SettingsSection
      title="Gelişmiş Eşikler"
      description="İnce ayar alanları ayrı tutulur; günlük kullanım alanlarından ayrışırken aynı sade yüzey sistemi içinde kalır."
      icon={<Sparkles className="h-4 w-4" />}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={labelClassName}>
          <span>Autonomous step limit</span>
          <Input className={fieldClassName} value={form.autonomousStepLimit} onChange={(e) => updateField('autonomousStepLimit', e.target.value)} />
        </label>
        <label className={labelClassName}>
          <span>Memory decay threshold</span>
          <Input className={fieldClassName} value={form.memoryDecayThreshold} onChange={(e) => updateField('memoryDecayThreshold', e.target.value)} />
        </label>
        <label className={labelClassName}>
          <span>Semantic search threshold</span>
          <Input className={fieldClassName} value={form.semanticSearchThreshold} onChange={(e) => updateField('semanticSearchThreshold', e.target.value)} />
        </label>
      </div>
    </SettingsSection>
  );
};
