/**
 * MCP (Model Context Protocol) — Config Parsing ve Validation
 *
 * Environment variable'larından MCP server config'lerini okur,
 * validate eder ve runtime options'ları sağlar.
 */

import { z } from 'zod';
import type { MCPServerConfig, MCPRuntimeOptions} from './types.js';
import { MCPServerConfigSchema, DEFAULT_MCP_RUNTIME_OPTIONS } from './types.js';
import { isCommandSafe } from './command-validator.js';
import { logger } from '../../utils/logger.js';

// ============================================================
// Environment Variable Schema
// ============================================================

/**
 * MCP ile ilgili tüm environment variable'larının Zod şeması.
 */
const MCPEnvSchema = z.object({
  /** MCP'yi etkinleştir */
  ENABLE_MCP: z.string().transform((val) => val.toLowerCase() === 'true').default('false'),

  /** MCP server'ları (JSON array string) */
  MCP_SERVERS: z.string().optional(),

  /** Varsayılan timeout (ms) */
  MCP_TIMEOUT: z.string().optional(),

  /** Maksimum paralel araç çağrısı */
  MCP_MAX_CONCURRENT: z.string().optional(),

  /** MCP logging */
  MCP_LOGGING: z.string().transform((val) => val.toLowerCase() === 'true').default('true'),
});

// ============================================================
// Config Parser
// ============================================================

/**
 * Environment variable'larından MCP config'lerini parse eder.
 * 
 * @returns Parse edilmiş server config'leri ve runtime options
 */
export function parseMCPConfig(): {
  enabled: boolean;
  servers: MCPServerConfig[];
  runtimeOptions: MCPRuntimeOptions;
} {
  const env = {
    ENABLE_MCP: process.env.ENABLE_MCP ?? 'false',
    MCP_SERVERS: process.env.MCP_SERVERS,
    MCP_TIMEOUT: process.env.MCP_TIMEOUT,
    MCP_MAX_CONCURRENT: process.env.MCP_MAX_CONCURRENT,
    MCP_LOGGING: process.env.MCP_LOGGING ?? 'true',
  };

  // Environment validation
  const parsedEnv = MCPEnvSchema.safeParse(env);
  if (!parsedEnv.success) {
    logger.error({ errors: parsedEnv.error.errors }, '[MCP] ❌ Environment validation başarısız, defaults kullanılıyor:');
    // Validation başarısızsa MCP'yi devre dışı bırak
    return {
      enabled: false,
      servers: [],
      runtimeOptions: { ...DEFAULT_MCP_RUNTIME_OPTIONS, enabled: false },
    };
  }

  const { ENABLE_MCP, MCP_SERVERS, MCP_TIMEOUT, MCP_MAX_CONCURRENT, MCP_LOGGING } = parsedEnv.data;

  // MCP disabled ise boş config dön
  if (!ENABLE_MCP) {
    logger.info('[MCP] ℹ️  MCP devre dışı (ENABLE_MCP=false)');
    return {
      enabled: false,
      servers: [],
      runtimeOptions: { ...DEFAULT_MCP_RUNTIME_OPTIONS, enabled: false },
    };
  }

  // Server config'lerini parse et
  const servers = parseServerConfigs(MCP_SERVERS);

  // Runtime options
  const runtimeOptions: MCPRuntimeOptions = {
    enabled: true,
    defaultTimeout: parseInt(MCP_TIMEOUT ?? '30000', 10) || DEFAULT_MCP_RUNTIME_OPTIONS.defaultTimeout,
    maxConcurrentCalls: parseInt(MCP_MAX_CONCURRENT ?? '5', 10) || DEFAULT_MCP_RUNTIME_OPTIONS.maxConcurrentCalls,
    enableLogging: MCP_LOGGING,
  };

  logger.info(`[MCP] ✅ MCP etkin — ${servers.length} server yapılandırıldı`);
  logger.debug({ servers, runtimeOptions }, '[MCP] Config detayları:');

  return { enabled: true, servers, runtimeOptions };
}

/**
 * JSON string'den server config'lerini parse eder ve validate eder.
 */
function parseServerConfigs(jsonString: string | undefined): MCPServerConfig[] {
  if (!jsonString || jsonString.trim() === '') {
    logger.warn('[MCP] ⚠️ MCP_SERVERS environment variable tanımlanmamış');
    return [];
  }

  let rawConfigs: unknown[];
  try {
    rawConfigs = JSON.parse(jsonString);
  } catch (error) {
    logger.error({ error }, '[MCP] ❌ MCP_SERVERS JSON parse hatası:');
    return [];
  }

  if (!Array.isArray(rawConfigs)) {
    logger.error('[MCP] ❌ MCP_SERVERS bir array olmalıdır');
    return [];
  }

  const validConfigs: MCPServerConfig[] = [];

  for (let i = 0; i < rawConfigs.length; i++) {
    const raw = rawConfigs[i];

    // Zod validation
    const result = MCPServerConfigSchema.safeParse(raw);
    if (!result.success) {
      logger.error(
        { errors: result.error.errors, index: i },
        `[MCP] ❌ Server config #${i} validation hatası:`,
      );
      continue;
    }

    const config = result.data;

    // Güvenlik kontrolü — komut allowlist
    if (!isCommandSafe(config.command)) {
      logger.error(
        { command: config.command, serverName: config.name },
        `[MCP] ❌ Server "${config.name}" — komut allowlist'te değil: ${config.command}`,
      );
      continue;
    }

    validConfigs.push(config);
  }

  return validConfigs;
}

// ============================================================
// Config Helper Functions
// ============================================================

/**
 * MCP'nin etkin olup olmadığını kontrol eder.
 */
export function isMCPEnabled(): boolean {
  return (process.env.ENABLE_MCP ?? 'false').toLowerCase() === 'true';
}

/**
 * Belirli bir server config'ini environment'dan parse eder.
 * Test ve debug amaçlı kullanılır.
 */
export function getMCPServerConfig(name: string): MCPServerConfig | null {
  const { servers } = parseMCPConfig();
  return servers.find((s) => s.name === name) ?? null;
}

/**
 * Tüm server config'lerini döndürür.
 */
export function getAllMCPServerConfigs(): MCPServerConfig[] {
  const { servers } = parseMCPConfig();
  return servers;
}
