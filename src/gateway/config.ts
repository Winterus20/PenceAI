import dotenv from 'dotenv';
import path from 'path';
import os from 'os';
import { logger, updateLogLevel } from '../utils/logger.js';
import { z } from 'zod';

dotenv.config();

const PROJECT_ROOT = process.cwd();

/**
 * Ortam değişkeni string değerlerini güvenli bir şekilde boolean'a çevirir.
 * 'false', 'FALSE', '0', 'no', '' → false
 * 'true', 'TRUE', '1', 'yes' → true
 * z.coerce.boolean()'ın non-empty string'i true kabul etme hatasını önler.
 */
function booleanFromEnv(defaultValue: boolean) {
  return z.preprocess(
    (val) => {
      if (typeof val === 'boolean') return val;
      if (typeof val === 'string') {
        const lower = val.trim().toLowerCase();
        if (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on') return true;
        if (lower === 'false' || lower === '0' || lower === 'no' || lower === 'off' || lower === '') return false;
      }
      return defaultValue;
    },
    z.boolean().default(defaultValue),
  );
}

const validLLMProviders = ['openai', 'anthropic', 'ollama', 'minimax', 'github', 'groq', 'mistral', 'nvidia'] as const;
const validEmbeddingProviders = ['minimax', 'openai', 'voyage', 'none'] as const;

const ConfigSchema = z.object({
  port: z.coerce.number().default(3001),
  host: z.string().default('0.0.0.0'),
  dbPath: z.string().optional(),
  projectRoot: z.string().optional(),
  defaultUserName: z.string().default('Kullanıcı'),

  // LLM
  defaultLLMProvider: z.enum(validLLMProviders).catch('openai').default('openai'),
  defaultLLMModel: z.string().default('gpt-4o'),
  openaiApiKey: z.string().optional(),
  anthropicApiKey: z.string().optional(),
  minimaxApiKey: z.string().optional(),
  githubToken: z.string().optional(),
  groqApiKey: z.string().optional(),
  mistralApiKey: z.string().optional(),
  nvidiaApiKey: z.string().optional(),
  ollamaBaseUrl: z.string().default('http://localhost:11434'),
  enableOllamaTools: booleanFromEnv(false),
  enableNvidiaTools: booleanFromEnv(false),

  // Embedding
  embeddingProvider: z.enum(validEmbeddingProviders).catch('openai').default('openai'),
  embeddingModel: z.string().default('text-embedding-3-small'),
  voyageApiKey: z.string().optional(),

  // Channels
  telegramBotToken: z.string().optional(),
  telegramAllowedUsers: z.preprocess(
    (val) => (typeof val === 'string' && val ? val.split(',').map(s => s.trim()) : []),
    z.array(z.string()).default([])
  ),
  discordBotToken: z.string().optional(),
  discordAllowedUsers: z.preprocess(
    (val) => (typeof val === 'string' && val ? val.split(',').map(s => s.trim()) : []),
    z.array(z.string()).default([])
  ),
  whatsappEnabled: booleanFromEnv(false),

  // Security
  allowShellExecution: booleanFromEnv(false),
  shellTimeout: z.coerce.number().min(5000).max(300000).catch(30000).default(30000),
  fsRootDir: z.string().optional(),
  dashboardPassword: z.string().optional(),
  braveSearchApiKey: z.string().optional(),
  jinaReaderApiKey: z.string().optional(),
  sensitivePaths: z.preprocess(
    (val) => {
        if (typeof val === 'string' && val) return val.split(',').map(s => s.trim()).filter(Boolean);
        const isWindows = os.platform() === 'win32';
        return isWindows
            ? [
                'C:\\Windows',
                'C:\\Program Files',
                'C:\\Program Files (x86)',
                path.join(os.homedir(), 'AppData'),
                'C:\\ProgramData',
              ]
            : ['/etc', '/usr', '/var', '/boot', '/root', '/home'];
    },
    z.array(z.string())
  ),

  // Advanced Settings
  systemPrompt: z.string().optional(),
  autonomousStepLimit: z.coerce.number().default(5),
  memoryDecayThreshold: z.coerce.number().default(30),
  semanticSearchThreshold: z.coerce.number().default(0.7),
  logLevel: z.enum(['debug', 'info', 'error']).catch('info').default('info'),
  temperature: z.coerce.number().min(0).max(2).catch(0.7).default(0.7),
  maxTokens: z.coerce.number().min(256).max(128000).catch(4096).default(4096),

  // Hooks
  enableHooks: z.coerce.boolean().default(true),
  hookSecurityMonitor: z.coerce.boolean().default(true),
  hookOutputSanitizer: z.coerce.boolean().default(true),
  hookConsoleLogDetector: z.enum(['ask', 'approve', 'block']).catch('ask').default('ask'),
  hookObservationCapture: z.coerce.boolean().default(true),
  hookDevServerBlocker: z.coerce.boolean().default(true),
  hookContextBudgetGuard: z.coerce.boolean().default(true),
  hookSessionSummary: z.coerce.boolean().default(true),
  hookApprovalMode: z.enum(['ask', 'approve']).default('ask'),

  // Context Compaction
  compactEnabled: z.coerce.boolean().default(true),
  compactTokenThreshold: z.coerce.number().min(10000).max(200000).catch(100000).default(100000),
  compactPreserveRecentMessages: z.coerce.number().min(2).max(50).catch(10).default(10),
  compactPreserveFileAttachments: z.coerce.boolean().default(true),
  compactMaxFileAttachmentBytes: z.coerce.number().min(1024).max(102400).catch(51200).default(51200),

  // LLM Cache
  llmCacheEnabled: z.coerce.boolean().default(true),
  llmCacheTtlHours: z.coerce.number().min(1).max(720).catch(24).default(24),
  llmCacheMaxEntries: z.coerce.number().min(10).max(100000).catch(1000).default(1000),

  // Agentic RAG
  agenticRAGEnabled: z.coerce.boolean().default(true),
  agenticRAGMaxHops: z.coerce.number().min(1).max(5).default(3),
  agenticRAGDecisionConfidence: z.coerce.number().min(0).max(1).default(0.5),
  agenticRAGCritiqueRelevanceFloor: z.coerce.number().min(0).max(1).default(0.5),
  agenticRAGCritiqueCompletenessFloor: z.coerce.number().min(0).max(1).default(0.3),
  agenticRAGVerificationSupportFloor: z.coerce.number().min(0).max(1).default(0.6),
  agenticRAGVerificationUtilityFloor: z.coerce.number().min(1).max(5).default(2),
  agenticRAGMaxRegenerations: z.coerce.number().min(0).max(3).default(1),

  // Karpathy LLM Wiki Feature Flags
  enableMemoryLint: z.coerce.boolean().default(true),
  lintPassIntervalHours: z.coerce.number().min(1).max(720).default(168),
  lintLLMValidationEnabled: z.coerce.boolean().default(true),
  lintDeterministicThresholdJaccard: z.coerce.number().min(0).max(1).default(0.8),
  lintMaxLLMPairsPerRun: z.coerce.number().min(0).max(100).default(20),
  enableProvenanceTracking: z.coerce.boolean().default(true),
  wikiExportDir: z.string().default('./exports'),
  wikiAdaptiveThreshold: z.coerce.number().min(0).max(10000).default(100),
  autonomousScheduleCron: z.string().default('*/5 * * * *'),

  // Insight Engine
  insightEngineEnabled: z.coerce.boolean().default(true),
  insightMinConfidence: z.coerce.number().min(0).max(1).default(0.5),
  insightDynamicTTL: z.coerce.boolean().default(true),
  insightDefaultTTLDays: z.coerce.number().min(1).max(365).default(30),

  // Memory Consolidation
  memoryConsolidationEnabled: booleanFromEnv(true),
  memoryConsolidationThreshold: z.coerce.number().min(5).max(100).default(20),

  // MCP
  enableMcp: booleanFromEnv(false),
  mcpServers: z.string().optional(),
  mcpTimeout: z.coerce.number().min(1000).max(300000).catch(30000).default(30000),
  mcpMaxConcurrent: z.coerce.number().min(1).max(50).catch(5).default(5),
  mcpLogging: booleanFromEnv(true),
});

export type AppConfig = z.infer<typeof ConfigSchema> & {
  dbPath: string;
  projectRoot: string;
};

export function loadConfig(): AppConfig {
    const rawConfig = {
        port: process.env.PORT,
        host: process.env.HOST,
        dbPath: process.env.DB_PATH,
        defaultUserName: process.env.DEFAULT_USER_NAME,
        defaultLLMProvider: process.env.DEFAULT_LLM_PROVIDER,
        defaultLLMModel: process.env.DEFAULT_LLM_MODEL,
        openaiApiKey: process.env.OPENAI_API_KEY,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        minimaxApiKey: process.env.MINIMAX_API_KEY,
        githubToken: process.env.GITHUB_TOKEN,
        groqApiKey: process.env.GROQ_API_KEY,
        mistralApiKey: process.env.MISTRAL_API_KEY,
        nvidiaApiKey: process.env.NVIDIA_API_KEY,
        ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
        enableOllamaTools: process.env.ENABLE_OLLAMA_TOOLS,
        enableNvidiaTools: process.env.ENABLE_NVIDIA_TOOLS,
        embeddingProvider: process.env.EMBEDDING_PROVIDER,
        embeddingModel: process.env.EMBEDDING_MODEL,
        voyageApiKey: process.env.VOYAGE_API_KEY,
        telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
        telegramAllowedUsers: process.env.TELEGRAM_ALLOWED_USERS,
        discordBotToken: process.env.DISCORD_BOT_TOKEN,
        discordAllowedUsers: process.env.DISCORD_ALLOWED_USERS,
        whatsappEnabled: process.env.WHATSAPP_ENABLED,
        allowShellExecution: process.env.ALLOW_SHELL_EXECUTION,
        shellTimeout: process.env.SHELL_TIMEOUT,
        fsRootDir: process.env.FS_ROOT_DIR,
        dashboardPassword: process.env.DASHBOARD_PASSWORD,
        braveSearchApiKey: process.env.BRAVE_SEARCH_API_KEY,
        jinaReaderApiKey: process.env.JINA_READER_API_KEY,
        sensitivePaths: process.env.SENSITIVE_PATHS,
        systemPrompt: process.env.SYSTEM_PROMPT,
        autonomousStepLimit: process.env.AUTONOMOUS_STEP_LIMIT,
        memoryDecayThreshold: process.env.MEMORY_DECAY_THRESHOLD,
        semanticSearchThreshold: process.env.SEMANTIC_SEARCH_THRESHOLD,
        logLevel: process.env.LOG_LEVEL,
        temperature: process.env.TEMPERATURE,
        maxTokens: process.env.MAX_TOKENS,

        // Hooks
        enableHooks: process.env.ENABLE_HOOKS,
        hookSecurityMonitor: process.env.HOOK_SECURITY_MONITOR,
        hookOutputSanitizer: process.env.HOOK_OUTPUT_SANITIZER,
        hookConsoleLogDetector: process.env.HOOK_CONSOLE_LOG_DETECTOR,
        hookObservationCapture: process.env.HOOK_OBSERVATION_CAPTURE,
        hookDevServerBlocker: process.env.HOOK_DEV_SERVER_BLOCKER,
        hookContextBudgetGuard: process.env.HOOK_CONTEXT_BUDGET_GUARD,
        hookSessionSummary: process.env.HOOK_SESSION_SUMMARY,
        hookApprovalMode: process.env.HOOK_APPROVAL_MODE,

        // Context Compaction
        compactEnabled: process.env.COMPACT_ENABLED,
        compactTokenThreshold: process.env.COMPACT_TOKEN_THRESHOLD,
        compactPreserveRecentMessages: process.env.COMPACT_PRESERVE_RECENT_MESSAGES,
        compactPreserveFileAttachments: process.env.COMPACT_PRESERVE_FILE_ATTACHMENTS,
        compactMaxFileAttachmentBytes: process.env.COMPACT_MAX_FILE_ATTACHMENT_BYTES,

        // Agentic RAG
        // LLM Cache
        llmCacheEnabled: process.env.LLM_CACHE_ENABLED,
        llmCacheTtlHours: process.env.LLM_CACHE_TTL_HOURS,
        llmCacheMaxEntries: process.env.LLM_CACHE_MAX_ENTRIES,

        // Agentic RAG
        agenticRAGEnabled: process.env.AGENTIC_RAG_ENABLED,
        agenticRAGMaxHops: process.env.AGENTIC_RAG_MAX_HOPS,
        agenticRAGDecisionConfidence: process.env.AGENTIC_RAG_DECISION_CONFIDENCE,
        agenticRAGCritiqueRelevanceFloor: process.env.AGENTIC_RAG_CRITIQUE_RELEVANCE_FLOOR,
        agenticRAGCritiqueCompletenessFloor: process.env.AGENTIC_RAG_CRITIQUE_COMPLETENESS_FLOOR,
        agenticRAGVerificationSupportFloor: process.env.AGENTIC_RAG_VERIFICATION_SUPPORT_FLOOR,
        agenticRAGVerificationUtilityFloor: process.env.AGENTIC_RAG_VERIFICATION_UTILITY_FLOOR,
        agenticRAGMaxRegenerations: process.env.AGENTIC_RAG_MAX_REGENERATIONS,

        // Karpathy LLM Wiki Feature Flags
        enableMemoryLint: process.env.ENABLE_MEMORY_LINT,
        lintPassIntervalHours: process.env.LINT_PASS_INTERVAL_HOURS,
        lintLLMValidationEnabled: process.env.LINT_LLM_VALIDATION_ENABLED,
        lintDeterministicThresholdJaccard: process.env.LINT_DETERMINISTIC_THRESHOLD_JACCARD,
        lintMaxLLMPairsPerRun: process.env.LINT_MAX_LLM_PAIRS_PER_RUN,
        enableProvenanceTracking: process.env.ENABLE_PROVENANCE_TRACKING,
        wikiExportDir: process.env.WIKI_EXPORT_DIR,
        wikiAdaptiveThreshold: process.env.WIKI_ADAPTIVE_THRESHOLD,
        autonomousScheduleCron: process.env.AUTONOMOUS_SCHEDULE_CRON,

        // Insight Engine
        insightEngineEnabled: process.env.INSIGHT_ENGINE_ENABLED,
        insightMinConfidence: process.env.INSIGHT_MIN_CONFIDENCE,
        insightDynamicTTL: process.env.INSIGHT_DYNAMIC_TTL,
        insightDefaultTTLDays: process.env.INSIGHT_DEFAULT_TTL_DAYS,

        // Memory Consolidation
        memoryConsolidationEnabled: process.env.MEMORY_CONSOLIDATION_ENABLED,
        memoryConsolidationThreshold: process.env.MEMORY_CONSOLIDATION_THRESHOLD,

        // MCP
        enableMcp: process.env.ENABLE_MCP,
        mcpServers: process.env.MCP_SERVERS,
        mcpTimeout: process.env.MCP_TIMEOUT,
        mcpMaxConcurrent: process.env.MCP_MAX_CONCURRENT,
        mcpLogging: process.env.MCP_LOGGING,
    };

    const parsed = ConfigSchema.safeParse(rawConfig);

    if (!parsed.success) {
        logger.error({ errors: parsed.error.format() }, '[Config] Geçersiz ortam değişkenleri (Invalid environment variables)');
        process.exit(1);
    }

    const validConfig = parsed.data;

    return {
        ...validConfig,
        projectRoot: PROJECT_ROOT,
        dbPath: validConfig.dbPath
            ? path.resolve(PROJECT_ROOT, validConfig.dbPath)
            : path.join(PROJECT_ROOT, 'data', 'penceai.db'),
    } as AppConfig;
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
    // Hot-reload log level when config changes
    updateLogLevel(_config.logLevel);
}
