import { useEffect, useMemo, useState } from 'react';
import { Activity, Save, Settings2 } from 'lucide-react';
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
import { UsageStatsCard } from '@/components/settings/UsageStatsCard';
import { ObservabilityDialog } from './ObservabilityDialog';
import { metaBadgeClassName } from '@/styles/dialog';
import { SkeletonSettingsDialog } from '@/components/ui/skeleton';
import { useSettings } from '@/hooks/queries/useSettings';
import { useLLMProviders } from '@/hooks/queries/useLLMProviders';
import { useSensitivePaths } from '@/hooks/queries/useSensitivePaths';
import { useUpdateSettings } from '@/hooks/mutations/useUpdateSettings';
import { useAddSensitivePath } from '@/hooks/mutations/useAddSensitivePath';
import { useRemoveSensitivePath } from '@/hooks/mutations/useRemoveSensitivePath';

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
  const [statusText, setStatusText] = useState<string>('');
  const [newSensitivePath, setNewSensitivePath] = useState<string>('');
  const [observabilityOpen, setObservabilityOpen] = useState(false);

  // Query hooks
  const { data: settings, isLoading: settingsLoading } = useSettings();
  const { data: providers = [], isLoading: providersLoading } = useLLMProviders();
  const { data: sensitivePaths = [], isLoading: pathsLoading } = useSensitivePaths();

  // Mutation hooks
  const updateSettings = useUpdateSettings();
  const addSensitivePath = useAddSensitivePath();
  const removeSensitivePath = useRemoveSensitivePath();

  // Form'u settings ile doldur - localStorage'dan gelen LLM ayarlarını koru
  useEffect(() => {
    if (settings) {
      // localStorage'dan kaydedilmiş LLM ayarlarını oku
      let savedProvider: string | undefined;
      let savedModel: string | undefined;
      try {
        const saved = localStorage.getItem('pence-llm-settings');
        if (saved) {
          const parsed = JSON.parse(saved);
          savedProvider = parsed.defaultLLMProvider;
          savedModel = parsed.defaultLLMModel;
        }
      } catch {
        // localStorage hatası, sessizce geç
      }

      setForm({
        ...emptyForm,
        ...settings,
        // Kullanıcının seçtiği LLM ayarlarını koru (localStorage öncelikli)
        defaultLLMProvider: savedProvider || settings.defaultLLMProvider || emptyForm.defaultLLMProvider,
        defaultLLMModel: savedModel || settings.defaultLLMModel || emptyForm.defaultLLMModel,
        allowShellExecution: !!settings.allowShellExecution,
        autonomousStepLimit: String(settings.autonomousStepLimit ?? emptyForm.autonomousStepLimit),
        memoryDecayThreshold: String(settings.memoryDecayThreshold ?? emptyForm.memoryDecayThreshold),
        semanticSearchThreshold: String(settings.semanticSearchThreshold ?? emptyForm.semanticSearchThreshold),
        temperature: String(settings.temperature ?? emptyForm.temperature),
        maxTokens: String(settings.maxTokens ?? emptyForm.maxTokens),
      });
    }
  }, [settings]);

  const modelOptions = useMemo(() => {
    const models = providers.find((provider) => provider.name === form.defaultLLMProvider)?.models ?? [];
    return models.filter((model, index) => models.indexOf(model) === index);
  }, [providers, form.defaultLLMProvider]);

  // NOT: Kullanıcının model seçimi otomatik olarak değiştirilmez.
  // localStorage'dan gelen seçim her zaman korunur.

  // Alt bileşenler için genel tip updateField wrapper'ları
  const updateLLMField = (key: string, value: string) => {
    setForm((current) => {
      const updated = { ...current, [key]: value };
      
      // LLM provider veya model değiştiğinde localStorage'a kaydet
      if (key === 'defaultLLMProvider' || key === 'defaultLLMModel') {
        try {
          localStorage.setItem('pence-llm-settings', JSON.stringify({
            defaultLLMProvider: key === 'defaultLLMProvider' ? value : updated.defaultLLMProvider,
            defaultLLMModel: key === 'defaultLLMModel' ? value : updated.defaultLLMModel,
          }));
        } catch {
          // localStorage hatası, sessizce geç
        }
      }
      
      return updated;
    });
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
    try {
      await addSensitivePath.mutateAsync(newSensitivePath.trim());
      setNewSensitivePath('');
    } catch (error) {
      console.error('Hassas dizin eklenemedi:', error);
      alert('Eklenemedi');
    }
  };

  // Hassas dizin silme
  const handleRemoveSensitivePath = async (pathToRemove: string) => {
    try {
      await removeSensitivePath.mutateAsync(pathToRemove);
    } catch (error) {
      console.error('Hassas dizin kaldırılamadı:', error);
    }
  };

  const handleSave = async () => {
    setStatusText('');
    try {
      const result = await updateSettings.mutateAsync(form);
      if (result.requiresRestart) {
        setStatusText('⚠️ Ayarlar kaydedildi. LLM provider/model değişikliklerinin etkili olması için uygulamayı yeniden başlatın.');
      } else {
        setStatusText('Ayarlar kaydedildi.');
      }
    } catch (error) {
      console.error(error);
      setStatusText('Kaydetme sırasında hata oluştu.');
    }
  };

  const content = (
    <div className="glass-panel flex h-full w-full flex-col overflow-hidden text-foreground">
      <div className="border-b border-surface bg-surface-sm px-6 py-5 sm:px-7 sm:py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-[1.7rem] font-semibold tracking-[-0.03em] text-foreground sm:text-[1.9rem]">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-purple-500/20 text-purple-400">
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setObservabilityOpen(true)}
              className="h-6 gap-1.5 rounded-full bg-blue-500/15 px-3 text-xs text-blue-400 hover:bg-blue-500/25 hover:text-blue-300"
            >
              <Activity className="h-3.5 w-3.5" />
              Observability
            </Button>
          </div>
        </div>
      </div>

      {settingsLoading || providersLoading || pathsLoading ? (
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
                pathLoading={addSensitivePath.isPending || removeSensitivePath.isPending}
                updateField={updateSecurityField}
                setNewSensitivePath={setNewSensitivePath}
                onAddSensitivePath={handleAddSensitivePath}
                onRemoveSensitivePath={handleRemoveSensitivePath}
              />

              <MemorySettings
                form={form}
                updateField={updateMemoryField}
              />

              <UsageStatsCard />
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4 border-t border-surface bg-surface px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div className="max-w-3xl text-sm leading-6 text-surface-strong">
          {statusText || 'Kaydettiğiniz değişiklikler anında uygulanır. LLM provider/model değişiklikleri yeniden başlatma gerektirir.'}
        </div>
        <Button onClick={handleSave} disabled={settingsLoading || providersLoading || pathsLoading || updateSettings.isPending} className="min-w-[190px] rounded-full px-5 bg-purple-600 text-white hover:bg-purple-500 shadow-[0_0_15px_rgba(147,51,234,0.4)] transition-all duration-300 border-0">
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
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="glass-panel flex max-h-[calc(100dvh-1.5rem)] w-[min(96vw,84rem)] max-w-[95vw] md:max-w-2xl flex-col overflow-hidden p-0 text-foreground">
          <VisuallyHidden.Root>
            <DialogTitle>Ayarlar</DialogTitle>
            <DialogDescription>Model seçimi, servis anahtarları ve çalışma davranışlarını düzenleyin.</DialogDescription>
          </VisuallyHidden.Root>
          {content}
        </DialogContent>
      </Dialog>
      <ObservabilityDialog open={observabilityOpen} onOpenChange={setObservabilityOpen} />
    </>
  );
};
