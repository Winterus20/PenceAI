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
import { UsageStatsCard } from '@/components/settings/UsageStatsCard';
import { metaBadgeClassName } from '@/styles/dialog';
import { SkeletonSettingsDialog } from '@/components/ui/skeleton';
import { useSettings } from '@/hooks/queries/useSettings';
import { useLLMProviders } from '@/hooks/queries/useLLMProviders';
import { useSensitivePaths } from '@/hooks/queries/useSensitivePaths';
import { useUpdateSettings } from '@/hooks/mutations/useUpdateSettings';
import { useDiscoverCustomModels } from '@/hooks/mutations/useDiscoverCustomModels';
import { useDiscoverOpenRouterModels } from '@/hooks/mutations/useDiscoverOpenRouterModels';
import { useAddSensitivePath } from '@/hooks/mutations/useAddSensitivePath';
import { useRemoveSensitivePath } from '@/hooks/mutations/useRemoveSensitivePath';
import { ApiError } from '@/lib/api-client';

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
  customOpenaiApiKey: string;
  customOpenaiBaseUrl: string;
  openrouterApiKey: string;
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
  hookApprovalMode: string;
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
  customOpenaiApiKey: '',
  customOpenaiBaseUrl: '',
  openrouterApiKey: '',
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
  hookApprovalMode: 'ask',
};

export const SettingsDialog = ({ open, onOpenChange, inline = false }: { open: boolean, onOpenChange: (o: boolean) => void, inline?: boolean }) => {
  const [form, setForm] = useState<SettingsForm>(emptyForm);
  const [statusText, setStatusText] = useState<string>('');
  const [newSensitivePath, setNewSensitivePath] = useState<string>('');
  const [customModelsOverride, setCustomModelsOverride] = useState<string[]>([]);
  const [customModelsError, setCustomModelsError] = useState<string>('');

  // Query hooks
  const { data: settings, isLoading: settingsLoading } = useSettings();
  const { data: providers = [], isLoading: providersLoading } = useLLMProviders();
  const { data: sensitivePaths = [], isLoading: pathsLoading } = useSensitivePaths();

  // Mutation hooks
  const updateSettings = useUpdateSettings();
  const discoverCustomModels = useDiscoverCustomModels();
  const discoverOpenRouterModels = useDiscoverOpenRouterModels();
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
        hookApprovalMode: settings.hookApprovalMode || emptyForm.hookApprovalMode,
      });
    }
  }, [settings]);

  const isDynamicModelProvider =
    form.defaultLLMProvider === 'custom' || form.defaultLLMProvider === 'openrouter';

  const modelOptions = useMemo(() => {
    if (isDynamicModelProvider && customModelsOverride.length > 0) {
      return customModelsOverride;
    }
    const models = providers.find((provider) => provider.name === form.defaultLLMProvider)?.models ?? [];
    return models.filter((model, index) => models.indexOf(model) === index);
  }, [providers, form.defaultLLMProvider, customModelsOverride, isDynamicModelProvider]);

  useEffect(() => {
    if (!isDynamicModelProvider) {
      setCustomModelsOverride([]);
      setCustomModelsError('');
    }
  }, [form.defaultLLMProvider, isDynamicModelProvider]);

  useEffect(() => {
    if (isDynamicModelProvider) {
      const fromProviders = providers.find((p) => p.name === form.defaultLLMProvider)?.models ?? [];
      if (fromProviders.length > 0) {
        setCustomModelsOverride(fromProviders);
      }
    }
  }, [form.defaultLLMProvider, providers, isDynamicModelProvider]);

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

  const handleDiscoverCustomModels = async () => {
    setCustomModelsError('');
    try {
      const payload: { baseUrl?: string; apiKey?: string } = {};
      if (form.customOpenaiBaseUrl.trim()) payload.baseUrl = form.customOpenaiBaseUrl.trim();
      if (form.customOpenaiApiKey.trim() && !form.customOpenaiApiKey.includes('***') && !form.customOpenaiApiKey.includes('••••')) {
        payload.apiKey = form.customOpenaiApiKey.trim();
      }
      const result = await discoverCustomModels.mutateAsync(payload);
      setCustomModelsOverride(result.models);
      if (result.models.length > 0 && !result.models.includes(form.defaultLLMModel)) {
        updateLLMField('defaultLLMModel', result.models[0]!);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Model listesi alınamadı';
      setCustomModelsError(message);
    }
  };

  const handleDiscoverOpenRouterModels = async () => {
    setCustomModelsError('');
    try {
      const payload: { apiKey?: string } = {};
      if (form.openrouterApiKey.trim() && !form.openrouterApiKey.includes('***') && !form.openrouterApiKey.includes('••••')) {
        payload.apiKey = form.openrouterApiKey.trim();
      }
      const result = await discoverOpenRouterModels.mutateAsync(payload);
      setCustomModelsOverride(result.models);
      if (result.models.length > 0 && !result.models.includes(form.defaultLLMModel)) {
        updateLLMField('defaultLLMModel', result.models[0]!);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Model listesi alınamadı';
      setCustomModelsError(message);
    }
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
      const detail =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Kaydetme sırasında hata oluştu.';
      setStatusText(detail);
    }
  };

  const content = (
    <div className="glass-panel flex h-full w-full flex-col overflow-hidden text-foreground">
      <div className="border-b border-border/30 bg-card px-6 py-5 sm:px-7 sm:py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-[1.7rem] font-semibold tracking-[-0.03em] text-foreground sm:text-[1.9rem]">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-foreground">
                <Settings2 className="h-5 w-5" />
              </span>
              Ayarlar
            </div>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-[15px]">
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

      {settingsLoading || providersLoading || pathsLoading ? (
        <SkeletonSettingsDialog />
      ) : (
        <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-muted/5 to-transparent">
          <div className="grid gap-5 px-6 py-6 sm:px-7 xl:grid-cols-[1.12fr_0.88fr]">
            <LLMSettings
              form={form}
              providers={providers}
              modelOptions={modelOptions}
              updateField={updateLLMField}
              onDiscoverCustomModels={handleDiscoverCustomModels}
              onDiscoverOpenRouterModels={handleDiscoverOpenRouterModels}
              customModelsLoading={discoverCustomModels.isPending || discoverOpenRouterModels.isPending}
              customModelsError={customModelsError}
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

      <div className="flex flex-col gap-4 border-t border-border/30 bg-muted/10 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div className="max-w-3xl text-sm leading-6 text-foreground">
          {statusText || 'Kaydettiğiniz değişiklikler anında uygulanır. LLM provider/model değişiklikleri yeniden başlatma gerektirir.'}
        </div>
        <Button onClick={handleSave} disabled={settingsLoading || providersLoading || pathsLoading || updateSettings.isPending} className="min-w-[190px] px-5">
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
        <DialogContent className="glass-panel flex max-h-[calc(100dvh-1.5rem)] w-[min(96vw,120rem)] max-w-[95vw] md:max-w-4xl flex-col overflow-hidden p-0 text-foreground">
          <VisuallyHidden.Root>
            <DialogTitle>Ayarlar</DialogTitle>
            <DialogDescription>Model seçimi, servis anahtarları ve çalışma davranışlarını düzenleyin.</DialogDescription>
          </VisuallyHidden.Root>
          {content}
        </DialogContent>
      </Dialog>
    </>
  );
};
