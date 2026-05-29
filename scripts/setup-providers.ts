/**
 * Kurulum sihirbazı sağlayıcı listesi — config.ts validLLMProviders ile hizalı.
 * setup.ps1 / setup.sh menüsünü bu dosyayla senkron tutun.
 */
export type SetupProviderKind = 'apiKey' | 'ollama' | 'custom';

export interface SetupProvider {
  label: string;
  envKey: string;
  providerId: string;
  defaultModel: string;
  kind: SetupProviderKind;
}

export const SETUP_PROVIDERS: readonly SetupProvider[] = [
  { label: 'OpenAI (varsayilan)', envKey: 'OPENAI_API_KEY', providerId: 'openai', defaultModel: 'gpt-4o', kind: 'apiKey' },
  { label: 'Anthropic (Claude)', envKey: 'ANTHROPIC_API_KEY', providerId: 'anthropic', defaultModel: 'claude-sonnet-4-20250514', kind: 'apiKey' },
  { label: 'Groq', envKey: 'GROQ_API_KEY', providerId: 'groq', defaultModel: 'llama-3.3-70b-versatile', kind: 'apiKey' },
  { label: 'Mistral', envKey: 'MISTRAL_API_KEY', providerId: 'mistral', defaultModel: 'mistral-large-latest', kind: 'apiKey' },
  { label: 'MiniMax', envKey: 'MINIMAX_API_KEY', providerId: 'minimax', defaultModel: 'MiniMax-Text-01', kind: 'apiKey' },
  { label: 'NVIDIA', envKey: 'NVIDIA_API_KEY', providerId: 'nvidia', defaultModel: 'meta/llama-3.1-70b-instruct', kind: 'apiKey' },
  { label: 'GitHub Models', envKey: 'GITHUB_TOKEN', providerId: 'github', defaultModel: 'gpt-4o', kind: 'apiKey' },
  { label: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', providerId: 'openrouter', defaultModel: 'openai/gpt-4o-mini', kind: 'apiKey' },
  { label: 'Custom OpenAI (LiteLLM vb.)', envKey: 'CUSTOM_OPENAI_API_KEY', providerId: 'custom', defaultModel: '', kind: 'custom' },
  { label: 'Ollama (yerel)', envKey: 'OLLAMA_BASE_URL', providerId: 'ollama', defaultModel: 'llama3.2', kind: 'ollama' },
] as const;
