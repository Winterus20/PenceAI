import { useEffect, useState, useMemo, useCallback } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api-client';

/**
 * Ayarlar form tipi
 */
export interface SettingsForm {
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
  temperature: string;
  maxTokens: string;
}

/**
 * Provider tipi
 */
export interface Provider {
  name: string;
  models: string[];
}

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
  temperature: '0.7',
  maxTokens: '4096',
};

export interface UseSettingsFormReturn {
  form: SettingsForm;
  providers: Provider[];
  loading: boolean;
  saving: boolean;
  statusText: string;
  sensitivePaths: string[];
  newSensitivePath: string;
  pathLoading: boolean;
  modelOptions: string[];
  updateField: (key: string, value: string | boolean) => void;
  setNewSensitivePath: (path: string) => void;
  handleSave: () => Promise<void>;
  handleAddSensitivePath: () => Promise<void>;
  handleRemoveSensitivePath: (path: string) => Promise<void>;
}

/**
 * Ayarlar form yönetimi için custom hook
 * Form state, API yükleme, kaydetme ve hassas dizin yönetimi
 */
export function useSettingsForm(open: boolean): UseSettingsFormReturn {
  // localStorage'dan kaydedilmiş LLM ayarlarını yükle
  const loadSavedLLMSettings = (): Partial<SettingsForm> => {
    try {
      const saved = localStorage.getItem('pence-llm-settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          defaultLLMProvider: parsed.defaultLLMProvider || emptyForm.defaultLLMProvider,
          defaultLLMModel: parsed.defaultLLMModel || emptyForm.defaultLLMModel,
        };
      }
    } catch {
      // localStorage hatası, varsayılanı kullan
    }
    return {};
  };

  const savedLLMSettings = useMemo(() => loadSavedLLMSettings(), []);
  const [form, setForm] = useState<SettingsForm>({ ...emptyForm, ...savedLLMSettings });
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusText, setStatusText] = useState<string>('');
  const [sensitivePaths, setSensitivePaths] = useState<string[]>([]);
  const [newSensitivePath, setNewSensitivePath] = useState<string>('');
  const [pathLoading, setPathLoading] = useState(false);

  // Veri yükle
  useEffect(() => {
    if (!open) return;

    const loadData = async () => {
      setLoading(true);
      setStatusText('');

      try {
        const [providersResult, settingsResult, sensitivePathsResult] = await Promise.allSettled([
          api.get('/llm/providers'),
          api.get('/settings'),
          api.get('/settings/sensitive-paths'),
        ]);
  
        const providersData = providersResult.status === 'fulfilled' ? providersResult.value : [];
        const settingsData = settingsResult.status === 'fulfilled' ? settingsResult.value : {};
        const sensitivePathsData = sensitivePathsResult.status === 'fulfilled' ? sensitivePathsResult.value : [];

        setProviders(providersData);
        setSensitivePaths(Array.isArray(sensitivePathsData) ? sensitivePathsData : []);
        // localStorage'dan gelen LLM ayarlarını API'den gelenlere tercih et
        // savedLLMSettings useMemo ile başlangıçta hesaplanır, stale closure sorunu yoktur
        const savedProvider = savedLLMSettings.defaultLLMProvider;
        const savedModel = savedLLMSettings.defaultLLMModel;
        
        setForm({
          ...emptyForm,
          ...settingsData,
          // Kullanıcının seçtiği LLM ayarlarını koru (localStorage öncelikli)
          defaultLLMProvider: savedProvider || settingsData.defaultLLMProvider || emptyForm.defaultLLMProvider,
          defaultLLMModel: savedModel || settingsData.defaultLLMModel || emptyForm.defaultLLMModel,
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

  // Model seçenekleri
  const modelOptions = useMemo(() => {
    const models = providers.find((provider) => provider.name === form.defaultLLMProvider)?.models ?? [];
    return models.filter((model, index) => models.indexOf(model) === index);
  }, [providers, form.defaultLLMProvider]);

  // NOT: Kullanıcının model seçimi otomatik olarak değiştirilmez.
  // localStorage'dan gelen seçim her zaman korunur.

  // Alan güncelle - LLM ayarlarını localStorage'a da kaydet
  const updateField = useCallback((key: string, value: string | boolean) => {
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
  }, []);

  // Kaydet
  const handleSave = useCallback(async () => {
    setSaving(true);
    setStatusText('');

    try {
      const result = await api.post<SettingsForm, { success: boolean; requiresRestart?: boolean }>('/settings', form);
  
      if (result.requiresRestart) {
        toast.success('Ayarlar kaydedildi.', { icon: '⚠️' });
        toast('Yapılan değişikliklerin etkili olması için arka uç yeniden başlatılmalıdır.', { duration: 6000, icon: '🔄' });
        setStatusText('Ayarlar kaydedildi. Yeniden başlatma gerekiyor.');
      } else {
        setStatusText('Ayarlar kaydedildi.');
      }
    } catch (error) {
      console.error(error);
      setStatusText('Kaydetme sırasında hata oluştu.');
    } finally {
      setSaving(false);
    }
  }, [form]);

  // Hassas dizin ekle
  const handleAddSensitivePath = useCallback(async () => {
    if (!newSensitivePath.trim()) return;
    setPathLoading(true);
    try {
      const paths = await api.post<{ path: string }, string[]>('/settings/sensitive-paths', { path: newSensitivePath.trim() });
      setSensitivePaths(Array.isArray(paths) ? paths : []);
      setNewSensitivePath('');
    } catch (error: any) {
      alert(error?.data?.error || 'Eklenemedi');
    } finally {
      setPathLoading(false);
    }
  }, [newSensitivePath]);

  // Hassas dizin sil
  const handleRemoveSensitivePath = useCallback(async (pathToRemove: string) => {
    setPathLoading(true);
    try {
      const paths = await api.delete<{ path: string }, string[]>('/settings/sensitive-paths', { path: pathToRemove });
      setSensitivePaths(Array.isArray(paths) ? paths : []);
    } catch (error) {
      console.error('Hassas dizin kaldırılamadı:', error);
    } finally {
      setPathLoading(false);
    }
  }, []);

  return {
    form,
    providers,
    loading,
    saving,
    statusText,
    sensitivePaths,
    newSensitivePath,
    pathLoading,
    modelOptions,
    updateField,
    setNewSensitivePath,
    handleSave,
    handleAddSensitivePath,
    handleRemoveSensitivePath,
  };
}
