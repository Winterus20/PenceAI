import { api } from '@/lib/api-client';

export interface AppConfig {
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
  baseSystemPrompt?: string;
  allowShellExecution: boolean;
  braveSearchApiKey: string;
  embeddingProvider: string;
  embeddingModel: string;
  autonomousStepLimit: string;
  memoryDecayThreshold: string;
  semanticSearchThreshold: string;
  logLevel: string;
  temperature: string;
  hookApprovalMode?: string;
  maxTokens: string;
}

export interface UpdateSettingsResponse {
  success: boolean;
  requiresRestart?: boolean;
  message?: string;
}

export interface LLMProvider {
  name: string;
  models: string[];
}

export const settingsService = {
  get: () => api.get<AppConfig>('/settings'),
  update: (data: Partial<AppConfig>) => api.post<Partial<AppConfig>, UpdateSettingsResponse>('/settings', data),
  getSensitivePaths: () => api.get<string[]>('/settings/sensitive-paths'),
  addSensitivePath: (path: string) => api.post<{ path: string }, string[]>('/settings/sensitive-paths', { path }),
  removeSensitivePath: (path: string) => api.delete<{ path: string }, string[]>('/settings/sensitive-paths', { path }),
  getLLMProviders: () => api.get<LLMProvider[]>('/llm/providers'),
};
