import { useEffect, useMemo, useState } from 'react';
import { Save, Settings2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { Button } from '@/components/ui/button';
import { LLMSettings } from './LLMSettings';
import { SecuritySettings } from './SecuritySettings';
import { MemorySettings } from './MemorySettings';
import { metaBadgeClassName } from '@/styles/dialog';
import { SkeletonSettingsDialog } from '@/components/ui/skeleton';

type SettingsForm = {
  defaultLLMProvider: string;
  defaultLLMModel: string;
  defaultUserName: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  minimaxApiKey: string;
  githubToken: string;
  groqApiKey: string;
  mistralApiKey: string;
  nvidiaApiKey: string;
  ollamaBaseUrl: string;
  systemPrompt: string;
  allowShellExecution: boolean;
  braveSearchApiKey: string;
  embeddingProvider: string;
  embeddingModel: string;
  autonomousStepLimit: string;
  memoryDecayThreshold: string;
  semanticSearchThreshold: string;
  logLevel: string;
  // Gelişmiş Model Ayarları
  temperature: string;
  maxTokens: string;
};

const emptyForm: SettingsForm = {
  defaultLLMProvider: 'openai',
  defaultLLMModel: '',
  defaultUserName: '',
  openaiApiKey: '',
  anthropicApiKey: '',
  minimaxApiKey: '',
  githubToken: '',
  groqApiKey: '',
  mistralApiKey: '',
  nvidiaApiKey: '',
  ollamaBaseUrl: 'http://localhost:11434',
  systemPrompt: '',
  allowShellExecution: false,
  braveSearchApiKey: '',
  embeddingProvider: 'openai',
  embeddingModel: 'text-embedding-3-small',
  autonomousStepLimit: '5',
  memoryDecayThreshold: '30',
  semanticSearchThreshold: '0.7',
  logLevel: 'info',
  // Gelişmiş Model Ayarları
  temperature: '0.7',
  maxTokens: '4096',
};

export const SettingsDialog = ({ open, onOpenChange, inline = false }: { open: boolean, onOpenChange: (o: boolean) => void, inline?: boolean }) => {
  const [form, setForm] = useState<SettingsForm>(emptyForm);
  const [providers, setProviders] = useState<Array<{ name: string; models: string[] }>>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusText, setStatusText] = useState<string>('');
  // Hassas dizinler state
  const [sensitivePaths, setSensitivePaths] = useState<string[]>([]);
  const [newSensitivePath, setNewSensitivePath] = useState<string>('');
  const [pathLoading, setPathLoading] = useState(false);

  useEffect(() => {
    if (!open) return;

    const loadData = async () => {
      setLoading(true);
      setStatusText('');

      try {
        const [providersRes, settingsRes, sensitivePathsRes] = await Promise.all([
          fetch('/api/llm/providers'),
          fetch('/api/settings'),
          fetch('/api/settings/sensitive-paths'),
        ]);

        const providersData = providersRes.ok ? await providersRes.json() : [];
        const settingsData = settingsRes.ok ? await settingsRes.json() : {};
        const sensitivePathsData = sensitivePathsRes.ok ? await sensitivePathsRes.json() : [];

        setProviders(providersData);
        setSensitivePaths(Array.isArray(sensitivePathsData) ? sensitivePathsData : []);
        setForm({
          ...emptyForm,
          ...settingsData,
          allowShellExecution: !!settingsData.allowShellExecution,
          autonomousStepLimit: String(settingsData.autonomousStepLimit ?? emptyForm.autonomousStepLimit),
          memoryDecayThreshold: String(settingsData.memoryDecayThreshold ?? emptyForm.memoryDecayThreshold),
          semanticSearchThreshold: String(settingsData.semanticSearchThreshold ?? emptyForm.semanticSearchThreshold),
          temperature: String(settingsData.temperature ?? emptyForm.temperature),
          maxTokens: String(settingsData.maxTokens ?? emptyForm.maxTokens),
        });
      } catch (error) {
        console.error('Ayarlar yüklenemedi:', error);
        setStatusText('Ayarlar yüklenemedi.');
      } finally {
        setLoading(false);
      }
    };

    void loadData();
  }, [open]);

  const modelOptions = useMemo(() => {
    const models = providers.find((provider) => provider.name === form.defaultLLMProvider)?.models ?? [];
    return models.filter((model, index) => models.indexOf(model) === index);
  }, [providers, form.defaultLLMProvider]);

  useEffect(() => {
    if (!modelOptions.length) return;
    if (!modelOptions.includes(form.defaultLLMModel)) {
      setForm((current) => ({ ...current, defaultLLMModel: modelOptions[0] }));
    }
  }, [modelOptions, form.defaultLLMModel]);

  // Alt bileşenler için genel tip updateField wrapper'ları
  const updateLLMField = (key: string, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const updateSecurityField = (key: string, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const updateMemoryField = (key: string, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  // Hassas dizin ekleme
  const handleAddSensitivePath = async () => {
    if (!newSensitivePath.trim()) return;
    setPathLoading(true);
    try {
      const response = await fetch('/api/settings/sensitive-paths', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newSensitivePath.trim() }),
      });
      if (response.ok) {
        const paths = await response.json();
        setSensitivePaths(Array.isArray(paths) ? paths : []);
        setNewSensitivePath('');
      } else {
        const err = await response.json();
        alert(err.error || 'Eklenemedi');
      }
    } catch (error) {
      console.error('Hassas dizin eklenemedi:', error);
    } finally {
      setPathLoading(false);
    }
  };

  // Hassas dizin silme
  const handleRemoveSensitivePath = async (pathToRemove: string) => {
    setPathLoading(true);
    try {
      const response = await fetch('/api/settings/sensitive-paths', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pathToRemove }),
      });
      if (response.ok) {
        const paths = await response.json();
        setSensitivePaths(Array.isArray(paths) ? paths : []);
      }
    } catch (error) {
      console.error('Hassas dizin kaldırılamadı:', error);
    } finally {
      setPathLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setStatusText('');

    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (!response.ok) {
        throw new Error('Ayarlar kaydedilemedi.');
      }

      setStatusText('Ayarlar kaydedildi.');
    } catch (error) {
      console.error(error);
      setStatusText('Kaydetme sırasında hata oluştu.');
    } finally {
      setSaving(false);
    }
  };

  const content = (
    <div className="glass-panel flex h-full w-full flex-col overflow-hidden text-foreground">
      <div className="border-b border-surface bg-surface-sm px-6 py-5 sm:px-7 sm:py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-[1.7rem] font-semibold tracking-[-0.03em] text-foreground sm:text-[1.9rem]">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-xl text-surface-strong">
                <Settings2 className="h-5 w-5" />
              </span>
              Ayarlar
            </div>
            <p className="max-w-3xl text-sm leading-6 text-surface-subtle sm:text-[15px]">
              Model seçimi, servis anahtarları ve çalışma davranışlarını düzenleyin.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 lg:max-w-md lg:justify-end">
            <span className={metaBadgeClassName}>{form.defaultLLMProvider || 'Sağlayıcı yok'}</span>
            <span className={metaBadgeClassName}>{form.defaultLLMModel || 'Model yok'}</span>
            <span className={metaBadgeClassName}>{providers.length} sağlayıcı</span>
          </div>
        </div>
      </div>

      {loading ? (
        <SkeletonSettingsDialog />
      ) : (
        <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-surface-xs to-transparent">
          <div className="grid gap-5 px-6 py-6 sm:px-7 xl:grid-cols-[1.12fr_0.88fr]">
            <LLMSettings
              form={form}
              providers={providers}
              modelOptions={modelOptions}
              updateField={updateLLMField}
            />

            <div className="space-y-6">
              <SecuritySettings
                form={form}
                sensitivePaths={sensitivePaths}
                newSensitivePath={newSensitivePath}
                pathLoading={pathLoading}
                updateField={updateSecurityField}
                setNewSensitivePath={setNewSensitivePath}
                onAddSensitivePath={handleAddSensitivePath}
                onRemoveSensitivePath={handleRemoveSensitivePath}
              />

              <MemorySettings
                form={form}
                updateField={updateMemoryField}
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4 border-t border-surface bg-surface px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div className="max-w-3xl text-sm leading-6 text-surface-strong">
          {statusText || 'Kaydettiğiniz değişiklikler mevcut oturum davranışını anında etkileyebilir.'}
        </div>
        <Button onClick={handleSave} disabled={loading || saving} className="min-w-[190px] rounded-2xl px-5 shadow-[0_12px_24px_rgba(0,0,0,0.24)]">
        <Save className="h-4 w-4" />
        Kaydet ve Uygula
        </Button>
      </div>
    </div>
  );

  if (inline) {
    return content;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-panel flex max-h-[calc(100dvh-1.5rem)] w-[min(96vw,84rem)] max-w-[95vw] md:max-w-2xl flex-col overflow-hidden p-0 text-foreground">
        <VisuallyHidden.Root>
          <DialogTitle>Ayarlar</DialogTitle>
          <DialogDescription>Model seçimi, servis anahtarları ve çalışma davranışlarını düzenleyin.</DialogDescription>
        </VisuallyHidden.Root>
        {content}
      </DialogContent>
    </Dialog>
  );
};
