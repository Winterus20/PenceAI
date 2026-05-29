/**
 * MCP (Model Context Protocol) — Config Parsing ve Validation
 *
 * Environment variable'larından MCP server config'lerini okur,
 * validate eder ve runtime options'ları sağlar.
 */

import type { MCPServerConfig, MCPRuntimeOptions } from './types.js';
import { DEFAULT_MCP_RUNTIME_OPTIONS, MCPServerConfigSchema } from './types.js';
import { isCommandSafe } from './command-validator.js';
import { getConfig } from '../../gateway/config.js';
import { logger } from '../../utils/logger.js';

// ============================================================
// Config Parser
// ============================================================

/**
 * Merkezi config'den MCP config'lerini parse eder.
 * NEVER read process.env directly — AGENTS.md kuralına uygun.
 *
 * @returns Parse edilmiş server config'leri ve runtime options
 */
export function parseMCPConfig(): {
  enabled: boolean;
  servers: MCPServerConfig[];
  runtimeOptions: MCPRuntimeOptions;
} {
  const config = getConfig();

  // MCP disabled ise boş config dön
  if (!config.enableMcp) {
    logger.info('[MCP] ℹ️  MCP devre dışı (enableMcp=false)');
    return {
      enabled: false,
      servers: [],
      runtimeOptions: { ...DEFAULT_MCP_RUNTIME_OPTIONS, enabled: false },
    };
  }

  // Server config'lerini parse et
  const servers = parseServerConfigs(config.mcpServers);

  // Runtime options
  const runtimeOptions: MCPRuntimeOptions = {
    enabled: true,
    defaultTimeout: config.mcpTimeout,
    maxConcurrentCalls: config.mcpMaxConcurrent,
    enableLogging: config.mcpLogging,
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

    // Güvenlik kontrolü — komut allowlist veya geçerli SSE URL
    const isHttpUrl = config.command.startsWith('http://') || config.command.startsWith('https://');
    if (!isCommandSafe(config.command) && !isHttpUrl) {
      logger.error(
        { command: config.command, serverName: config.name },
        `[MCP] ❌ Server "${config.name}" — komut allowlist'te değil ve geçerli URL değil: ${config.command}`,
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
 * NEVER read process.env directly — AGENTS.md kuralına uygun.
 */
export function isMCPEnabled(): boolean {
  return getConfig().enableMcp;
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
