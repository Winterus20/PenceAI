import React from 'react';
import { Shield, AlertTriangle, Workflow, Loader2, Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { fieldClassName, selectClassName } from '@/styles/dialog';

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

export interface SecuritySettingsProps {
  form: {
    embeddingProvider: string;
    embeddingModel: string;
    logLevel: string;
    allowShellExecution: boolean;
  };
  sensitivePaths: string[];
  newSensitivePath: string;
  pathLoading: boolean;
  updateField: (key: string, value: string | boolean) => void;
  setNewSensitivePath: (value: string) => void;
  onAddSensitivePath: () => void;
  onRemoveSensitivePath: (path: string) => void;
}

export const SecuritySettings: React.FC<SecuritySettingsProps> = ({
  form,
  sensitivePaths,
  newSensitivePath,
  pathLoading,
  updateField,
  setNewSensitivePath,
  onAddSensitivePath,
  onRemoveSensitivePath,
}) => {
  return (
    <div className="space-y-6">
      <SettingsSection
        title="Embedding ve Runtime"
        description="Embedding ayarları ve operasyonel izinler aynı panel dilinde, daha düşük parlaklık ve daha net blok ayrımlarıyla sunulur."
        icon={<Workflow className="h-4 w-4" />}
      >
        <label className={labelClassName}>
          <span>Embedding sağlayıcı</span>
          <Input className={fieldClassName} value={form.embeddingProvider} onChange={(e) => updateField('embeddingProvider', e.target.value)} />
        </label>
        <label className={labelClassName}>
          <span>Embedding modeli</span>
          <Input className={fieldClassName} value={form.embeddingModel} onChange={(e) => updateField('embeddingModel', e.target.value)} />
        </label>
        <label className={labelClassName}>
          <span>Log seviyesi</span>
          <select className={selectClassName} value={form.logLevel} onChange={(e) => updateField('logLevel', e.target.value)}>
            {['trace', 'debug', 'info', 'warn', 'error'].map((level) => (
              <option key={level} value={level}>{level}</option>
            ))}
          </select>
        </label>
        <label className="section-surface flex items-start gap-3 rounded-[22px] border-surface px-4 py-4 text-sm text-surface-strong shadow-none transition-colors hover:bg-surface-sm">
          <input
            className="mt-1 h-4 w-4 rounded border-surface bg-transparent accent-current"
            type="checkbox"
            checked={form.allowShellExecution}
            onChange={(e) => updateField('allowShellExecution', e.target.checked)}
          />
          <span className="space-y-1.5">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
              <Shield className="h-4 w-4 text-surface" />
              Shell komutlarına izin ver
            </span>
            <span className="block text-sm leading-6 text-surface-strong">Araç çağrılarında terminal ve dosya sistemi işlemlerine yetki tanır.</span>
          </span>
        </label>
      </SettingsSection>

      <SettingsSection
        title="Hassas Dizinler"
        description="Bu listedeki dizinlere yazma veya komut çalıştırma işlemi yapılmak istendiğinde sizden onay istenir. Okuma işlemleri serbesttir."
        icon={<AlertTriangle className="h-4 w-4" />}
      >
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              className={fieldClassName}
              placeholder="Dizin yolu ekleyin... (ör: C:\\Windows)"
              value={newSensitivePath}
              onChange={(e) => setNewSensitivePath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onAddSensitivePath();
                }
              }}
            />
            <Button
              onClick={() => onAddSensitivePath()}
              disabled={pathLoading || !newSensitivePath.trim()}
              className="h-11 min-w-[100px] rounded-2xl px-4"
            >
              {pathLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Ekle
            </Button>
          </div>
          <div className="max-h-[200px] overflow-y-auto rounded-xl border border-surface bg-surface-xs">
          {sensitivePaths.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-surface-muted">
              Henüz hassas dizin eklenmemiş.
            </div>
          ) : (
            <div className="divide-y divide-surface">
              {sensitivePaths.map((path) => (
              <div
                key={path}
                className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface"
              >
                <span className="truncate text-sm text-surface-strong">{path}</span>
                <Button
                variant="ghost"
                size="sm"
                onClick={() => onRemoveSensitivePath(path)}
                disabled={pathLoading}
                className="h-8 w-8 rounded-lg p-0 text-surface-muted hover:bg-red-500/10 hover:text-red-400"
                >
                <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              ))}
            </div>
          )}
          </div>
        </div>
      </SettingsSection>
    </div>
  );
};
