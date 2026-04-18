/**
 * MCP (Model Context Protocol) — Transport Abstraction Layer
 *
 * MCP SDK'nın transport katmanını soyutlar. Stdio ve SSE transport'larını
 * destekler. Yeni transport tipleri kolayca eklenebilir.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { z } from 'zod';
import type { MCPServerConfig, MCPEvent, MCPEventCallback } from './types.js';
import { isStdioRuntime } from './command-validator.js';
import { logger } from '../../utils/logger.js';

// ============================================================
// Transport Types
// ============================================================

/**
 * Desteklenen transport tipleri.
 */
export type TransportType = 'stdio' | 'sse';

/**
 * Transport oluşturmak için factory fonksiyonu.
 * Server config'e göre uygun transport'u oluşturur.
 */
export async function createTransport(
  config: MCPServerConfig,
  onEvent?: MCPEventCallback,
  onStatusChange?: (status: 'connected' | 'disconnected' | 'error') => void,
): Promise<{ transport: StdioClientTransport | SSEClientTransport; type: TransportType }> {
  // Stdio transport (local process — command allowlist'te olmalı)
  if (isStdioRuntime(config.command)) {
    return createStdioTransport(config, onEvent, onStatusChange);
  }

  // SSE transport (HTTP endpoint)
  if (isHttpUrl(config.command)) {
    return createSSETransport(config, onEvent, onStatusChange);
  }

  // Güvenlik: Tanınmayan komutlar için stdio fallback kaldırıldı.
  // MCPServerConfigSchema allowlist doğrulaması transport'a gelmeden önce yapılmalıdır.
  throw new Error(
    `[MCP:transport] Tanınmayan komut: "${config.command}". ` +
    `İzin verilen komutlar: npx, node, python, python3, curl. ` +
    `SSE transport için HTTP/HTTPS URL kullanın.`
  );
}

/**
 * Child process'e aktarılmaması gereken environment variable pattern'leri
 */
const SENSITIVE_ENV_PATTERNS = [
  'API_KEY', 'APIKEY', 'API_SECRET', 'SECRET_KEY',
  'TOKEN', 'ACCESS_TOKEN', 'REFRESH_TOKEN', 'AUTH_TOKEN', 'BEARER',
  'PASSWORD', 'PASSWD', 'PWD',
  'DATABASE_URL', 'DB_URL', 'MONGO_URI', 'REDIS_URL', 'CONNECTION_STRING',
  'AWS_SECRET', 'AWS_ACCESS_KEY', 'AZURE_CLIENT_SECRET', 'GCP_SERVICE_ACCOUNT',
  'PRIVATE_KEY', 'SSH_KEY',
  'MCP_SERVERS',
  'CREDENTIAL', 'CRED',
];

/**
 * Child process'e aktarılması GÜVENLİ olan environment variable prefix'leri
 */
const SAFE_ENV_PREFIXES = [
  'NODE_',
  'HOME',
  'LANG',
  'LC_',
  'TERM',
  'TMPDIR',
  'TEMP',
  'TMP',
  'XDG_',
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'COLORTERM',
  'EDITOR',
  'PAGER',
];

/**
 * Process env'i sanitize eder — sadece güvenli değişkenleri döndürür
 */
function sanitizeProcessEnv(): Record<string, string> {
  const safeEnv: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    
    const isSafePrefix = SAFE_ENV_PREFIXES.some(
      prefix => key === prefix || key.startsWith(prefix)
    );
    
    if (isSafePrefix) {
      safeEnv[key] = value;
      continue;
    }
    
    const isSensitive = SENSITIVE_ENV_PATTERNS.some(
      pattern => key.toUpperCase().includes(pattern)
    );
    
    if (!isSensitive) {
      safeEnv[key] = value;
    }
  }
  
  return safeEnv;
}

/**
 * Config env değerlerini validate et
 */
const EnvValueSchema = z.string()
  .max(10000, 'Env value too long')
  .refine(
    val => !/[;|&$`\\]/.test(val),
    'Env value contains shell meta characters'
  );

const BLOCKED_ENV_KEYS = [
  'PATH', 'PATHS',
  'USER', 'USERNAME', 'USERPROFILE',
  'SHELL', 'BASH', 'ZSH_NAME',
  'HOME', 'HOMEDRIVE', 'HOMEPATH',
  'SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE',
];

function validateConfigEnv(env: Record<string, string>): void {
  for (const [key, value] of Object.entries(env)) {
    // Kritik sistem değişkenlerini engelle
    const upperKey = key.toUpperCase();
    if (BLOCKED_ENV_KEYS.some(blocked => upperKey === blocked || upperKey.startsWith(blocked))) {
      throw new Error(`Environment variable '${key}' is blocked for security reasons`);
    }
    EnvValueSchema.parse(value);
  }
}

/**
 * Stdio transport oluşturur.
 * Local process olarak çalışan MCP server'ları için kullanılır.
 */
async function createStdioTransport(
  config: MCPServerConfig,
  onEvent?: MCPEventCallback,
  onStatusChange?: (status: 'connected' | 'disconnected' | 'error') => void,
): Promise<{ transport: StdioClientTransport; type: 'stdio' }> {
  // GÜVENLİ: Sadece güvenli env değişkenlerini al
  const safeProcessEnv = sanitizeProcessEnv();
  
  // Config env validation
  if (config.env) {
    validateConfigEnv(config.env);
  }

  const env: Record<string, string> = {
    ...safeProcessEnv,
    ...(config.env ?? {}),
  };

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args ?? [],
    env,
    cwd: config.cwd,
    stderr: 'pipe',
  });

  // Stderr logging
  transport.onerror = (error) => {
    logger.error({ error, serverName: config.name }, `[MCP:transport] Stdio error (${config.name}):`);
    onEvent?.({
      type: 'server_error',
      serverName: config.name,
      timestamp: Date.now(),
      data: { error: error.message },
    });
  };

  transport.onclose = () => {
    logger.info(`[MCP:transport] Transport closed for server: ${config.name}`);
    onStatusChange?.('disconnected');
    onEvent?.({
      type: 'server_disconnected',
      serverName: config.name,
      timestamp: Date.now(),
      data: {},
    });
  };

  return { transport, type: 'stdio' };
}

/**
 * SSE transport oluşturur.
 * HTTP endpoint üzerinden bağlanan MCP server'ları için kullanılır.
 */
async function createSSETransport(
  config: MCPServerConfig,
  onEvent?: MCPEventCallback,
  onStatusChange?: (status: 'connected' | 'disconnected' | 'error') => void,
): Promise<{ transport: SSEClientTransport; type: 'sse' }> {
  const url = new URL(config.command);

  const transport = new SSEClientTransport(url);

  // Error handling
  transport.onerror = (error) => {
    logger.error({ error, serverName: config.name }, `[MCP:transport] SSE error (${config.name}):`);
    onEvent?.({
      type: 'server_error',
      serverName: config.name,
      timestamp: Date.now(),
      data: { error: error instanceof Error ? error.message : String(error) },
    });
  };

  transport.onclose = () => {
    logger.info(`[MCP:transport] SSE transport closed for server: ${config.name}`);
    onStatusChange?.('disconnected');
    onEvent?.({
      type: 'server_disconnected',
      serverName: config.name,
      timestamp: Date.now(),
      data: {},
    });
  };

  return { transport, type: 'sse' };
}

// ============================================================
// Helper Functions
// ============================================================

// isStdioRuntime → command-validator.ts'den import edilir (merkezi allowlist)

/**
 * Komutun bir HTTP URL olup olmadığını kontrol eder.
 */
function isHttpUrl(command: string): boolean {
  try {
    const url = new URL(command);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// ============================================================
// Client Lifecycle Management
// ============================================================

/**
 * MCP Client'ı başlatır ve server'a bağlanır.
 */
export async function connectClient(
  client: Client,
  transport: StdioClientTransport | SSEClientTransport,
  serverName: string,
  timeout: number = 30000,
  onEvent?: MCPEventCallback,
): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    logger.info(`[MCP:transport] Connecting to server: ${serverName}...`);

    const connectPromise = client.connect(transport);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`MCP connection timeout for server "${serverName}" after ${timeout}ms`));
      }, timeout);
    });

    await Promise.race([connectPromise, timeoutPromise]);

    logger.info(`[MCP:transport] ✅ Connected to server: ${serverName}`);
    onEvent?.({
      type: 'server_connected',
      serverName,
      timestamp: Date.now(),
      data: { transportType: transport instanceof StdioClientTransport ? 'stdio' : 'sse' },
    });
  } catch (error) {
    logger.error({ error, serverName }, `[MCP:transport] ❌ Failed to connect to server ${serverName}:`);
    onEvent?.({
      type: 'server_error',
      serverName,
      timestamp: Date.now(),
      data: { error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/**
 * MCP Client'ı kapatır.
 */
export async function disconnectClient(
  client: Client,
  transport: StdioClientTransport | SSEClientTransport,
  serverName: string,
): Promise<void> {
  try {
    await client.close();
  } catch (error) {
    logger.warn({ error, serverName }, `[MCP:transport] Error closing client from ${serverName}:`);
  }

  try {
    await transport.close();
    logger.info(`[MCP:transport] Disconnected from server: ${serverName}`);
  } catch (error) {
    logger.warn({ error, serverName }, `[MCP:transport] Error closing transport from ${serverName}:`);
  }
}
