import React from 'react';
import { Bot, KeyRound, UserRound, Thermometer } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { fieldClassName, selectClassName, textareaClassName } from '@/styles/dialog';

const sectionClassName = 'section-surface rounded-xl border-surface';
const labelClassName = 'space-y-2 text-sm text-surface-strong';

const SettingsSection = ({ title, description, icon, children }: { title: string; description: string; icon: React.ReactNode; children: React.ReactNode }) => (
  <section className={sectionClassName}>
    <div className="flex items-start gap-3 px-5 pb-4 pt-5 sm:px-6">
      <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-foreground">
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

const SecretField = ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) => (
  <label className={labelClassName}>
    <span>{label}</span>
    <Input type="password" autoComplete="off" className={fieldClassName} value={value} onChange={(e) => onChange(e.target.value)} />
  </label>
);

export interface LLMSettingsProps {
  form: {
    defaultLLMProvider: string;
    defaultLLMModel: string;
    defaultUserName: string;
    ollamaBaseUrl: string;
    systemPrompt: string;
    openaiApiKey: string;
    anthropicApiKey: string;
    minimaxApiKey: string;
    githubToken: string;
    groqApiKey: string;
    mistralApiKey: string;
    nvidiaApiKey: string;
    braveSearchApiKey: string;
    temperature: string;
    maxTokens: string;
  };
  providers: Array<{ name: string; models: string[] }>;
  modelOptions: string[];
  updateField: (key: string, value: string) => void;
}

export const LLMSettings: React.FC<LLMSettingsProps> = ({
  form,
  providers,
  modelOptions,
  updateField,
}) => {
  return (
    <div className="space-y-6">
      <SettingsSection
        title="Kimlik ve Model"
        description="Kullanıcı kimliği, varsayılan sağlayıcı ve temel model tercihlerini aynı akışta düzenleyin. Sık kullanılan alanlar üstte ve daha sade bir blok yapısında tutuldu."
        icon={<Bot className="h-4 w-4" />}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className={labelClassName}>
            <span className="inline-flex items-center gap-2"><UserRound className="h-4 w-4 text-surface" /> Kullanıcı adı</span>
            <Input className={fieldClassName} value={form.defaultUserName} onChange={(e) => updateField('defaultUserName', e.target.value)} />
          </label>
          <label className={labelClassName}>
            <span>Ollama URL</span>
            <Input className={fieldClassName} value={form.ollamaBaseUrl} onChange={(e) => updateField('ollamaBaseUrl', e.target.value)} />
          </label>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className={labelClassName}>
            <span>LLM sağlayıcı</span>
            <select
              className={selectClassName}
              value={form.defaultLLMProvider}
              onChange={(e) => updateField('defaultLLMProvider', e.target.value)}
            >
              {providers.map((provider) => (
                <option key={provider.name} value={provider.name}>{provider.name}</option>
              ))}
            </select>
          </label>
          <label className={labelClassName}>
            <span>Model</span>
            <select
              className={selectClassName}
              value={form.defaultLLMModel}
              onChange={(e) => updateField('defaultLLMModel', e.target.value)}
            >
              {modelOptions.map((model, index) => (
                <option key={`${model}-${index}`} value={model}>{model}</option>
              ))}
              {!modelOptions.length ? <option value="">Model bulunamadı</option> : null}
            </select>
          </label>
        </div>
        <label className={labelClassName}>
          <span>Sistem prompt'u</span>
          <Textarea
            rows={9}
            className={textareaClassName}
            value={form.systemPrompt}
            onChange={(e) => updateField('systemPrompt', e.target.value)}
          />
        </label>
      </SettingsSection>

      <SettingsSection
        title="API Anahtarları"
        description="Harici servis erişim alanları tek bir güvenlik bölümünde toplandı. Maskeli alanlar yüksek kontrast yerine daha dengeli giriş yüzeyleriyle sunuldu."
        icon={<KeyRound className="h-4 w-4" />}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <SecretField label="OpenAI" value={form.openaiApiKey} onChange={(value) => updateField('openaiApiKey', value)} />
          <SecretField label="Anthropic" value={form.anthropicApiKey} onChange={(value) => updateField('anthropicApiKey', value)} />
          <SecretField label="MiniMax" value={form.minimaxApiKey} onChange={(value) => updateField('minimaxApiKey', value)} />
          <SecretField label="GitHub Models" value={form.githubToken} onChange={(value) => updateField('githubToken', value)} />
          <SecretField label="Groq" value={form.groqApiKey} onChange={(value) => updateField('groqApiKey', value)} />
          <SecretField label="Mistral" value={form.mistralApiKey} onChange={(value) => updateField('mistralApiKey', value)} />
          <SecretField label="NVIDIA" value={form.nvidiaApiKey} onChange={(value) => updateField('nvidiaApiKey', value)} />
          <SecretField label="Brave Search" value={form.braveSearchApiKey} onChange={(value) => updateField('braveSearchApiKey', value)} />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Model Parametreleri"
        description="LLM davranışını ince ayarla kontrol edin. Temperature yanıtların yaratıcılığını, Max Tokens ise maksimum yanıt uzunluğunu belirler."
        icon={<Thermometer className="h-4 w-4" />}
      >
        <div className="grid gap-6 sm:grid-cols-2">
          <label className={labelClassName}>
            <span className="flex items-center justify-between">
              <span>Temperature</span>
              <span className="rounded-lg bg-surface-xl px-2.5 py-1 text-xs font-medium text-surface">{form.temperature}</span>
            </span>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={form.temperature}
              onChange={(e) => updateField('temperature', e.target.value)}
              className="slider-surface h-2.5 w-full cursor-pointer appearance-none rounded-full bg-surface-lg transition-all"
            />
            <div className="flex justify-between text-[11px] text-surface-muted">
              <span>Kesin (0.0)</span>
              <span>Yaratıcı (2.0)</span>
            </div>
            </label>
            <label className={labelClassName}>
            <span>Max Tokens</span>
            <Input
              type="number"
              min="256"
              max="128000"
              step="256"
              className={fieldClassName}
              value={form.maxTokens}
              onChange={(e) => updateField('maxTokens', e.target.value)}
            />
            <span className="text-[11px] text-surface-muted">Yanıt başına maksimum token sayısı (256-128000)</span>
          </label>
        </div>
      </SettingsSection>
    </div>
  );
};
