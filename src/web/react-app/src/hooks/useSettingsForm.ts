import { useEffect, useState, useMemo, useCallback } from 'react';

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
  const [form, setForm] = useState<SettingsForm>(emptyForm);
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

  // Model seçenekleri
  const modelOptions = useMemo(() => {
    const models = providers.find((provider) => provider.name === form.defaultLLMProvider)?.models ?? [];
    return models.filter((model, index) => models.indexOf(model) === index);
  }, [providers, form.defaultLLMProvider]);

  // Model seçimi otomatik güncelle
  useEffect(() => {
    if (!modelOptions.length) return;
    if (!modelOptions.includes(form.defaultLLMModel)) {
      setForm((current) => ({ ...current, defaultLLMModel: modelOptions[0] }));
    }
  }, [modelOptions, form.defaultLLMModel]);

  // Alan güncelle
  const updateField = useCallback((key: string, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  // Kaydet
  const handleSave = useCallback(async () => {
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
  }, [form]);

  // Hassas dizin ekle
  const handleAddSensitivePath = useCallback(async () => {
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
  }, [newSensitivePath]);

  // Hassas dizin sil
  const handleRemoveSensitivePath = useCallback(async (pathToRemove: string) => {
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
