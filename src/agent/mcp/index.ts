/**
 * MCP (Model Context Protocol) — Public API
 *
 * Bu dosya, MCP modülünün tüm public export'larını tek bir yerden sağlar.
 * Diğer modüller bu dosyayı import ederek MCP fonksiyonlarına erişebilir.
 *
 * Kullanım:
 * ```typescript
 * import { parseMCPConfig, isMCPEnabled, MCPClientManager } from '../agent/mcp/index.js';
 * ```
 */

// ============================================================
// Types
// ============================================================

export type {
  // Server Config
  MCPServerConfig,

  // Tool Definitions
  MCPToolDefinition,
  MCPToolCallArgs,
  MCPToolCallResult,

  // Client Manager
  MCPServerStatus,
  MCPServerStatusInfo,

  // Events
  MCPEventType,
  MCPEvent,
  MCPEventCallback,

  // Unified Registry
  UnifiedToolDefinition,
  UnifiedToolExecutor,

  // Runtime
  MCPRuntimeOptions,
} from './types.js';

// ============================================================
// Contracts (Interface-based design)
// ============================================================

export type {
  MCPManagerContract,
  ToolRegistryContract,
  TransportContract,
} from './contracts.js';

// ============================================================
// Result Pattern (Error handling)
// ============================================================

export {
  Result,
  success,
  error,
  isSuccess,
  isError,
  unwrap,
  unwrapOr,
  tryAsync,
} from './result.js';

// ============================================================
// Event Bus (Loose coupling)
// ============================================================

export {
  getMCPEventBus,
  resetMCPEventBus,
  MCPEventBus,
} from './eventBus.js';

// Event bus'tan MCPEventType (types.js'den zaten export ediliyor)
export type {
  MCPEventType as MCPEventBusEventType,
  MCPEventPayload,
  MCPEvents,
} from './eventBus.js';

// ============================================================
// Config
// ============================================================

export {
  parseMCPConfig,
  isMCPEnabled,
  getMCPServerConfig,
  getAllMCPServerConfigs,
} from './config.js';

// ============================================================
// Zod Schemas (validation için dışa aktarılır)
// ============================================================

export {
  MCPServerConfigSchema,
} from './types.js';

// ============================================================
// Constants
// ============================================================

export {
  DEFAULT_MCP_RUNTIME_OPTIONS,
} from './types.js';

// ============================================================
// MCP Client Manager (Faz 2 — Tamamlandı)
// ============================================================

export { MCPClientManager } from './client.js';

// ============================================================
// Transport Helpers (Faz 2) — Internal use only
// ============================================================
// Not: Bu export'lar internal kullanım içindir.
// Dış modüller doğrudan MCPClientManager kullanmalıdır.

export {
  createTransport,
  connectClient,
  disconnectClient,
} from './transport.js';

export type {
  TransportType,
} from './transport.js';

// ============================================================
// Unified Tool Registry (Faz 3 — Tamamlandı)
// ============================================================

export {
  UnifiedToolRegistry,
  getUnifiedToolRegistry,
  resetUnifiedToolRegistry,
} from './registry.js';

// ============================================================
// MCP Runtime Integration (Faz 3 — Tamamlandı)
// ============================================================

export {
  initializeMCP,
  shutdownMCP,
} from './runtime.js';

export { MCPConfigWatcher } from './watcher.js';

// ============================================================
// MCP Tool Adapter (Faz 3 — Tamamlandı)
// ============================================================

export {
  createMCPToolAdapter,
  convertMCPToolsToExecutors,
} from './adapter.js';

// ============================================================
// Security Layer (Faz 5 — Tamamlandı)
// ============================================================

export {
  RateLimiter,
  OutputSanitizer,
  ToolCallValidator,
  ConcurrencyLimiter,
  MCPSecurityManager,
} from './security.js';

export type {
  DangerousPatternConfig,
} from './security.js';

// ============================================================
// Command Validator — Merkezi Allowlist (Faz 5+)
// ============================================================

export {
  ALLOWED_COMMANDS,
  STDIO_RUNTIMES,
  DANGEROUS_COMMAND_PATTERNS,
  isCommandSafe,
  isStdioRuntime,
  validateRegistryCommand,
  sanitizeRegistryUrl,
} from './command-validator.js';
