/**
 * MCP Contracts — Interface tanımlamaları
 * Test ve mock için kullanılır, tight coupling'i azaltır.
 *
 * Bu interface'ler gerçek implementasyonlarla uyumlu olacak şekilde
 * güncellenmiştir. MCPClientManager ve UnifiedToolRegistry bu
 * contract'ları referans alır.
 */
import type { MCPServerConfig, MCPToolCallArgs, MCPServerStatusInfo, UnifiedToolDefinition } from './types.js';
import type { LLMToolDefinition } from '../../router/types.js';

/**
 * MCP Manager Contract — MCPClientManager ile uyumlu.
 */
export interface MCPManagerContract {
  initialize(configs: MCPServerConfig[]): Promise<number>;
  shutdown(): Promise<void>;
  get isInitialized(): boolean;
  connectServer(config: MCPServerConfig): Promise<void>;
  disconnectServer(name: string): Promise<void>;
  listTools(): UnifiedToolDefinition[];
  getServerTools(serverName: string): UnifiedToolDefinition[];
  callTool(name: string, args: MCPToolCallArgs): Promise<string>;
  hasTool(fullyQualifiedName: string): boolean;
  getServerStatus(name: string): MCPServerStatusInfo | null;
  getAllServerStatuses(): MCPServerStatusInfo[];
  get connectedServerCount(): number;
  get totalToolCount(): number;
}

/**
 * Tool Registry Contract — UnifiedToolRegistry ile uyumlu.
 */
export interface ToolRegistryContract {
  getAllToolDefinitions(): LLMToolDefinition[];
  executeTool(toolName: string, args: Record<string, unknown>): Promise<string>;
  hasTool(toolName: string): boolean;
  get toolCount(): number;
  clear(): void;
}

/**
 * Transport Contract — Transport fonksiyonları için.
 */
export interface TransportContract {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}
