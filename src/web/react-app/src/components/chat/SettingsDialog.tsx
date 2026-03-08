import { useEffect, useMemo, useState } from 'react';
import { Bot, KeyRound, Loader2, Save, Settings2, Shield, Sparkles, UserRound, Workflow } from 'lucide-react';
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
};

const fieldClassName = 'field-surface h-11 rounded-2xl border-white/6 bg-white/[0.02] text-sm text-white/92 shadow-none placeholder:text-white/42 focus:border-white/12 focus:bg-white/[0.028]';
const selectClassName = 'field-surface flex h-11 w-full rounded-2xl border-white/6 bg-white/[0.02] px-3.5 text-sm text-white/92 shadow-none outline-none transition focus:border-white/12 focus:bg-white/[0.028] focus:ring-2 focus:ring-white/10 [&>option]:bg-[hsl(0,0%,10%)] [&>option]:text-white';
const textareaClassName = 'field-surface min-h-[220px] rounded-[24px] border-white/6 bg-white/[0.02] text-sm leading-7 text-white/92 shadow-none placeholder:text-white/42 focus:border-white/12 focus:bg-white/[0.028]';
const sectionClassName = 'section-surface rounded-[26px] border-white/6';
const labelClassName = 'space-y-2 text-sm text-white/88';
const metaBadgeClassName = 'rounded-full border border-white/6 bg-white/[0.025] px-3 py-1 text-[11px] tracking-[0.02em] text-white/62';

type SettingsSectionProps = {
    title: string;
    description: string;
    icon: React.ReactNode;
    children: React.ReactNode;
};

const SettingsSection = ({ title, description, icon, children }: SettingsSectionProps) => (
    <section className={sectionClassName}>
        <div className="flex items-start gap-3 px-5 pb-4 pt-5 sm:px-6">
            <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl bg-white/[0.04] text-white/72">
                {icon}
            </div>
            <div className="space-y-1.5">
                <div className="text-sm font-medium tracking-[-0.01em] text-white/92">{title}</div>
                <p className="max-w-2xl text-sm leading-6 text-white/78">{description}</p>
            </div>
        </div>
        <div className="space-y-4 border-t border-white/6 px-5 py-5 sm:px-6">{children}</div>
    </section>
);

const SecretField = ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) => (
    <label className={labelClassName}>
        <span>{label}</span>
        <Input type="password" autoComplete="off" className={fieldClassName} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
);

export const SettingsDialog = ({ open, onOpenChange }: { open: boolean, onOpenChange: (o: boolean) => void }) => {
    const [form, setForm] = useState<SettingsForm>(emptyForm);
    const [providers, setProviders] = useState<Array<{ name: string; models: string[] }>>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [statusText, setStatusText] = useState<string>('');

    useEffect(() => {
        if (!open) return;

        const loadData = async () => {
            setLoading(true);
            setStatusText('');

            try {
                const [providersRes, settingsRes] = await Promise.all([
                    fetch('/api/llm/providers'),
                    fetch('/api/settings'),
                ]);

                const providersData = providersRes.ok ? await providersRes.json() : [];
                const settingsData = settingsRes.ok ? await settingsRes.json() : {};

                setProviders(providersData);
                setForm({
                    ...emptyForm,
                    ...settingsData,
                    allowShellExecution: !!settingsData.allowShellExecution,
                    autonomousStepLimit: String(settingsData.autonomousStepLimit ?? emptyForm.autonomousStepLimit),
                    memoryDecayThreshold: String(settingsData.memoryDecayThreshold ?? emptyForm.memoryDecayThreshold),
                    semanticSearchThreshold: String(settingsData.semanticSearchThreshold ?? emptyForm.semanticSearchThreshold),
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

    const updateField = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => {
        setForm((current) => ({ ...current, [key]: value }));
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

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="glass-panel flex max-h-[calc(100dvh-1.5rem)] w-[min(96vw,84rem)] max-w-7xl flex-col overflow-hidden p-0 text-foreground">
                <DialogHeader className="border-b border-white/6 bg-white/[0.015] px-6 py-5 sm:px-7 sm:py-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div className="space-y-3">
                            <DialogTitle className="flex items-center gap-3 text-[1.7rem] font-semibold tracking-[-0.03em] text-foreground sm:text-[1.9rem]">
                                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.04] text-white/78">
                                    <Settings2 className="h-5 w-5" />
                                </span>
                                Ayarlar
                            </DialogTitle>
                            <DialogDescription className="max-w-3xl text-sm leading-6 text-white/62 sm:text-[15px]">
                                Model seçimi, servis anahtarları ve çalışma davranışlarını daha sakin yüzeyler ve daha net bir hiyerarşi içinde düzenleyin.
                            </DialogDescription>
                        </div>
                        <div className="flex flex-wrap gap-2 lg:max-w-md lg:justify-end">
                            <span className={metaBadgeClassName}>{form.defaultLLMProvider || 'Sağlayıcı yok'}</span>
                            <span className={metaBadgeClassName}>{form.defaultLLMModel || 'Model yok'}</span>
                            <span className={metaBadgeClassName}>{providers.length} sağlayıcı</span>
                        </div>
                    </div>
                </DialogHeader>

                {loading ? (
                    <div className="flex min-h-0 flex-1 items-center justify-center bg-gradient-to-b from-white/[0.012] to-transparent text-white/82">
                        <div className="section-surface flex items-center gap-3 rounded-[24px] px-5 py-4">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Ayarlar yükleniyor...
                        </div>
                    </div>
                ) : (
                    <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-white/[0.01] to-transparent">
                        <div className="grid gap-5 px-6 py-6 sm:px-7 xl:grid-cols-[1.12fr_0.88fr]">
                            <div className="space-y-6">
                                <SettingsSection
                                    title="Kimlik ve Model"
                                    description="Kullanıcı kimliği, varsayılan sağlayıcı ve temel model tercihlerini aynı akışta düzenleyin. Sık kullanılan alanlar üstte ve daha sade bir blok yapısında tutuldu."
                                    icon={<Bot className="h-4 w-4" />}
                                >
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <label className={labelClassName}>
                                            <span className="inline-flex items-center gap-2"><UserRound className="h-4 w-4 text-white/72" /> Kullanıcı adı</span>
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
                                        <span>Sistem prompt’u</span>
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
                            </div>

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
                                    <label className="section-surface flex items-start gap-3 rounded-[22px] border-white/6 px-4 py-4 text-sm text-white/86 shadow-none transition-colors hover:bg-white/[0.03]">
                                        <input
                                            className="mt-1 h-4 w-4 rounded border-white/20 bg-transparent accent-current"
                                            type="checkbox"
                                            checked={form.allowShellExecution}
                                            onChange={(e) => updateField('allowShellExecution', e.target.checked)}
                                        />
                                        <span className="space-y-1.5">
                                            <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                                                <Shield className="h-4 w-4 text-white/72" />
                                                Shell komutlarına izin ver
                                            </span>
                                            <span className="block text-sm leading-6 text-white/78">Araç çağrılarında terminal ve dosya sistemi işlemlerine yetki tanır.</span>
                                        </span>
                                    </label>
                                </SettingsSection>

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
                            </div>
                        </div>
                    </div>
                )}

                <div className="flex flex-col gap-4 border-t border-white/6 bg-white/[0.02] px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
                    <div className="max-w-3xl text-sm leading-6 text-white/78">
                        {statusText || 'Kaydettiğiniz değişiklikler mevcut oturum davranışını anında etkileyebilir.'}
                    </div>
                    <Button onClick={handleSave} disabled={loading || saving} className="min-w-[190px] rounded-2xl px-5 shadow-[0_12px_24px_rgba(0,0,0,0.24)]">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Kaydet ve Uygula
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};
