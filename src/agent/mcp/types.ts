/**
 * MCP (Model Context Protocol) — Temel Tipler
 *
 * Bu dosya, PenceAI'ın MCP protokolü ile etkileşimi için gerekli
 * tüm TypeScript tip tanımlamalarını içerir.
 */

import { z } from 'zod';
import { ALLOWED_COMMANDS } from './command-validator.js';

// ============================================================
// MCP Server Config Schema
// ============================================================

/**
 * Tek bir MCP server'ın config tanımı için Zod şeması.
 * Örnek: { "name": "filesystem", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/allowed/path"] }
 */
export const MCPServerConfigSchema = z.object({
  /** Server adı (unique identifier, tool prefix olarak kullanılır) */
  name: z.string({
    required_error: 'MCP server "name" alanı zorunludur',
    invalid_type_error: '"name" alanı bir string olmalıdır',
  }).min(1, 'Server adı boş olamaz').regex(/^[a-zA-Z0-9_-]+$/, 'Server adı sadece harf, rakam, tire ve alt çizgi içerebilir'),

  /** Çalıştırılacak komut (örn: "npx", "node", "python") */
  command: z.string({
    required_error: 'MCP server "command" alanı zorunludur',
    invalid_type_error: '"command" alanı bir string olmalıdır',
  }).min(1, 'Komut boş olamaz').refine(
    (cmd) => (ALLOWED_COMMANDS as readonly string[]).includes(cmd),
    { message: `Komut allowlist'te olmalı: ${ALLOWED_COMMANDS.join(', ')}` }
  ),

  /** Komut argümanları */
  args: z.array(z.string()).default([]),

  /** Ortam değişkenleri (opsiyonel) */
  env: z.record(z.string(), z.string()).optional(),

  /** Çalışma dizini (opsiyonel) */
  cwd: z.string().optional(),

  /** Timeout (ms) — varsayılan 30000 */
  timeout: z.number().int().min(1000).max(300000).optional().default(30000),
});

export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;

// ============================================================
// MCP Tool Tanımları
// ============================================================

/**
 * MCP protokolüne göre bir araç tanımı.
 * MCP SDK'daki Tool tipinden türetilmiştir, ek metadata içerir.
 */
export interface MCPToolDefinition {
  /** Araç adı (unique within server) */
  name: string;

  /** Araç açıklaması (LLM prompt'unda kullanılır) */
  description: string;

  /** JSON Schema formatında parametre tanımı */
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };

  /** Bu aracın ait olduğu MCP server adı */
  serverName: string;

  /** Tam nitelikli araç adı (örn: "mcp:filesystem:readFile") */
  fullyQualifiedName: string;
}

// ============================================================
// MCP Tool Call & Result
// ============================================================

/**
 * MCP araç çağrısı için argümanlar.
 */
export type MCPToolCallArgs = Record<string, unknown>;

/**
 * MCP araç çağrısı sonucu.
 */
export interface MCPToolCallResult {
  /** Başarılı sonuç (text content) */
  content?: Array<{
    type: 'text' | 'image' | 'resource' | 'audio' | 'prompt';
    text?: string;
    data?: string;
    mimeType?: string;
    uri?: string;
  }>;

  /** Hata durumu */
  isError?: boolean;

  /** Hata mesajı (varsa) */
  error?: string;
}

// ============================================================
// MCP Client Manager
// ============================================================

/**
 * MCP server bağlantı durumu.
 */
export type MCPServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * MCP server durumu bilgisi.
 */
export interface MCPServerStatusInfo {
  /** Server adı */
  name: string;

  /** Bağlantı durumu */
  status: MCPServerStatus;

  /** Bağlantı zamanı (timestamp) */
  connectedAt?: number;

  /** Hata mesajı (varsa) */
  error?: string;

  /** Kullanılabilir araç sayısı */
  toolCount: number;
}

// ============================================================
// MCP Event Types
// ============================================================

/**
 * MCP client event türleri.
 */
export type MCPEventType =
  | 'server_connected'
  | 'server_disconnected'
  | 'server_error'
  | 'tool_call_start'
  | 'tool_call_end'
  | 'tool_call_error';

/** Server connected event data */
export interface MCPEventServerConnectedData {
  toolCount: number;
  transportType?: 'stdio' | 'sse';
}

/** Server error event data */
export interface MCPEventServerErrorData {
  error: string;
}

/** Tool call event data */
export interface MCPEventToolCallData {
  toolName: string;
  arguments?: Record<string, unknown>;
  result?: string;
  error?: string;
}

/** MCP event data union type */
export type MCPEventData = MCPEventServerConnectedData | MCPEventServerErrorData | MCPEventToolCallData | Record<string, unknown>;

/**
 * MCP client event.
 */
export interface MCPEvent {
  type: MCPEventType;
  serverName: string;
  timestamp: number;
  data: MCPEventData;
}

/**
 * MCP event callback tipi.
 */
export type MCPEventCallback = (event: MCPEvent) => void;

// ============================================================
// Unified Tool Registry
// ============================================================

/**
 * Birleştirilmiş araç tanımı (built-in + MCP).
 * Agent runtime'ın beklediği formata uygun.
 */
export interface UnifiedToolDefinition {
  /** Araç adı (unique) */
  name: string;

  /** Araç açıklaması */
  description: string;

  /** JSON Schema parametreleri */
  parameters: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };

  /** Araç kaynağı */
  source: 'builtin' | 'mcp';

  /** MCP server adı (sadece MCP araçları için) */
  mcpServerName?: string;

  /** Tam nitelikli ad (MCP araçları için) */
  fullyQualifiedName?: string;
}

/**
 * Birleştirilmiş araç executor.
 */
export interface UnifiedToolExecutor {
  name: string;
  source: 'builtin' | 'mcp';
  execute(args: Record<string, unknown>): Promise<string>;
}

// ============================================================
// MCP Runtime Integration
// ============================================================

/**
 * MCP runtime options.
 */
export interface MCPRuntimeOptions {
  /** MCP'yi etkinleştir (feature flag) */
  enabled: boolean;

  /** Maksimum araç çağrı süresi (ms) */
  defaultTimeout: number;

  /** Maksimum paralel araç çağrısı */
  maxConcurrentCalls: number;

  /** Tool call logging */
  enableLogging: boolean;
}

/**
 * Varsayılan runtime options.
 */
export const DEFAULT_MCP_RUNTIME_OPTIONS: MCPRuntimeOptions = {
  enabled: false,
  defaultTimeout: 30000,
  maxConcurrentCalls: 5,
  enableLogging: true,
};
