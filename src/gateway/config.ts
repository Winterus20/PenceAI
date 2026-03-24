import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

export interface AppConfig {
    port: number;
    host: string;
    dbPath: string;
    projectRoot: string;
    defaultUserName: string;

    // LLM
    defaultLLMProvider: 'openai' | 'anthropic' | 'ollama' | 'minimax' | 'github' | 'groq' | 'mistral' | 'nvidia';
    defaultLLMModel: string;
    openaiApiKey?: string;
    anthropicApiKey?: string;
    minimaxApiKey?: string;
    githubToken?: string;
    groqApiKey?: string;
    mistralApiKey?: string;
    nvidiaApiKey?: string;
    ollamaBaseUrl: string;
    enableOllamaTools: boolean; // Ollama server'da --enable-auto-tool-choice flag'i gerektirir
    enableNvidiaTools: boolean; // NVIDIA NIM modellerin çoğu tool_choice:"auto" desteklemez

    // Embedding
    embeddingProvider: 'minimax' | 'openai' | 'none';
    embeddingModel: string;

    // Channels
    telegramBotToken?: string;
    telegramAllowedUsers: string[];
    discordBotToken?: string;
    discordAllowedChannels: string[];
    whatsappEnabled: boolean;

    // Security
    allowShellExecution: boolean;
    fsRootDir?: string;
    dashboardPassword?: string;
    braveSearchApiKey?: string;
    jinaReaderApiKey?: string;
    sensitivePaths: string[];

    // Advanced Settings
      systemPrompt?: string;
      autonomousStepLimit: number;
      memoryDecayThreshold: number;
      semanticSearchThreshold: number;
      logLevel: 'debug' | 'info' | 'error';
      // Gelişmiş Model Ayarları
      temperature: number;
      maxTokens: number;
    }

export function loadConfig(): AppConfig {
    const dbPath = process.env.DB_PATH
        ? path.resolve(PROJECT_ROOT, process.env.DB_PATH)
        : path.join(PROJECT_ROOT, 'data', 'penceai.db');

    return {
        port: (() => { const p = parseInt(process.env.PORT || '3000', 10); return isNaN(p) ? 3000 : p; })(),
        host: process.env.HOST || 'localhost',
        dbPath,
        projectRoot: PROJECT_ROOT,
        defaultUserName: process.env.DEFAULT_USER_NAME || 'Kullanıcı',

        defaultLLMProvider: (() => {
            const validLLMProviders = ['openai', 'anthropic', 'ollama', 'minimax', 'github', 'groq', 'mistral', 'nvidia'] as const;
            const raw = process.env.DEFAULT_LLM_PROVIDER;
            if (raw && (validLLMProviders as readonly string[]).includes(raw)) {
                return raw as AppConfig['defaultLLMProvider'];
            }
            if (raw) logger.warn(`[Config] Geçersiz DEFAULT_LLM_PROVIDER: "${raw}". Geçerli değerler: ${validLLMProviders.join(', ')}. Varsayılan: openai`);
            return 'openai' as AppConfig['defaultLLMProvider'];
        })(),
        defaultLLMModel: process.env.DEFAULT_LLM_MODEL || 'gpt-4o',
        openaiApiKey: process.env.OPENAI_API_KEY || undefined,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
        minimaxApiKey: process.env.MINIMAX_API_KEY || undefined,
        githubToken: process.env.GITHUB_TOKEN || undefined,
        groqApiKey: process.env.GROQ_API_KEY || undefined,
        mistralApiKey: process.env.MISTRAL_API_KEY || undefined,
        nvidiaApiKey: process.env.NVIDIA_API_KEY || undefined,
        ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
        enableOllamaTools: process.env.ENABLE_OLLAMA_TOOLS === 'true',
        enableNvidiaTools: process.env.ENABLE_NVIDIA_TOOLS === 'true',

        embeddingProvider: (() => {
            const validEmbeddingProviders = ['minimax', 'openai', 'none'] as const;
            const raw = process.env.EMBEDDING_PROVIDER;
            if (raw && (validEmbeddingProviders as readonly string[]).includes(raw)) {
                return raw as AppConfig['embeddingProvider'];
            }
            if (raw) logger.warn(`[Config] Geçersiz EMBEDDING_PROVIDER: "${raw}". Geçerli değerler: ${validEmbeddingProviders.join(', ')}. Varsayılan: minimax`);
            return 'minimax' as AppConfig['embeddingProvider'];
        })(),
        embeddingModel: process.env.EMBEDDING_MODEL || 'embo-01',

        telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || undefined,
        telegramAllowedUsers: process.env.TELEGRAM_ALLOWED_USERS
            ? process.env.TELEGRAM_ALLOWED_USERS.split(',').map(s => s.trim())
            : [],
        discordBotToken: process.env.DISCORD_BOT_TOKEN || undefined,
        discordAllowedChannels: process.env.DISCORD_ALLOWED_CHANNELS
            ? process.env.DISCORD_ALLOWED_CHANNELS.split(',').map(s => s.trim())
            : [],
        whatsappEnabled: process.env.WHATSAPP_ENABLED === 'true',

        allowShellExecution: process.env.ALLOW_SHELL_EXECUTION === 'true',
        fsRootDir: process.env.FS_ROOT_DIR || undefined,
        dashboardPassword: process.env.DASHBOARD_PASSWORD || undefined,
        braveSearchApiKey: process.env.BRAVE_SEARCH_API_KEY || undefined,
        jinaReaderApiKey: process.env.JINA_READER_API_KEY || undefined,
        sensitivePaths: process.env.SENSITIVE_PATHS
            ? process.env.SENSITIVE_PATHS.split(',').map(s => s.trim()).filter(Boolean)
            : [
                'C:\\Windows',
                'C:\\Program Files',
                'C:\\Program Files (x86)',
                'C:\\Users\\Yigit\\AppData',
                'C:\\ProgramData',
                '/etc', '/usr', '/var', '/boot', '/root',
            ],

        systemPrompt: process.env.SYSTEM_PROMPT || undefined,
        autonomousStepLimit: (() => { const p = parseInt(process.env.AUTONOMOUS_STEP_LIMIT || '5', 10); return isNaN(p) ? 5 : p; })(),
        memoryDecayThreshold: (() => { const p = parseInt(process.env.MEMORY_DECAY_THRESHOLD || '30', 10); return isNaN(p) ? 30 : p; })(),
        semanticSearchThreshold: (() => { const p = parseFloat(process.env.SEMANTIC_SEARCH_THRESHOLD || '0.7'); return isNaN(p) ? 0.7 : p; })(),
        logLevel: (() => {
            const valid = ['debug', 'info', 'error'] as const;
            const raw = process.env.LOG_LEVEL;
            if (raw && (valid as readonly string[]).includes(raw)) return raw as AppConfig['logLevel'];
            return 'info';
          })(),
          // Gelişmiş Model Ayarları
          temperature: (() => { const p = parseFloat(process.env.TEMPERATURE || '0.7'); return isNaN(p) ? 0.7 : Math.max(0, Math.min(2, p)); })(),
          maxTokens: (() => { const p = parseInt(process.env.MAX_TOKENS || '4096', 10); return isNaN(p) ? 4096 : Math.max(256, Math.min(128000, p)); })(),
          };
        }

// Singleton config
let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
    if (!_config) {
        _config = loadConfig();
    }
    return _config;
}

export function reloadConfig(): void {
    _config = loadConfig();
}
