/**
 * MCP Marketplace — Frontend Service
 *
 * Backend MCP Marketplace API'si ile iletişim kuran servis katmanı.
 */

import { api } from '../lib/api-client';

export interface MCPServerCatalogEntry {
  name: string;
  description: string;
  version: string;
  author: string;
  tags: string[];
  icon?: string;
  command: string;
  defaultArgs: string[];
  tools: string[];
  rating?: number;
  installCount?: number;
}

export interface MCPServerRecord {
  name: string;
  description: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  status: 'available' | 'installed' | 'active' | 'disabled' | 'error';
  version: string;
  source: string;
  toolCount: number;
  installedAt?: number;
  lastError?: string;
}

export interface MarketplaceCatalogResponse {
  success: boolean;
  catalog: MCPServerCatalogEntry[];
  error?: string;
}

export interface InstalledServersResponse {
  success: boolean;
  servers: MCPServerRecord[];
  summary: {
    total: number;
    active: number;
    disabled: number;
    error: number;
  };
  error?: string;
}

export interface ServerActionResult {
  success: boolean;
  server?: MCPServerRecord;
  error?: string;
}

export interface InstallServerRequest {
  name: string;
  description: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ToggleServerRequest {
  action: 'enable' | 'disable';
}

export interface ServerToolsResponse {
  success: boolean;
  tools: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  error?: string;
}

export const mcpService = {
  /**
   * Marketplace catalog'unu getir.
   */
  getMarketplace: (query?: string) =>
    api.get<MarketplaceCatalogResponse>('/mcp/marketplace', {
      query: query ? { query } : undefined,
    }),

  /**
   * Kurulu server'ları getir.
   */
  getInstalledServers: () =>
    api.get<InstalledServersResponse>('/mcp/servers'),

  /**
   * Yeni server kur.
   */
  installServer: (data: {
    name: string;
    description: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
  }) =>
    api.post<InstallServerRequest, ServerActionResult>('/mcp/servers', data),

  /**
   * Server'ı aktif/pasif et.
   */
  toggleServer: (name: string, action: 'enable' | 'disable') =>
    api.patch<ToggleServerRequest, ServerActionResult>(`/mcp/servers/${name}/toggle`, { action }),

  /**
   * Server'ı kaldır.
   */
  uninstallServer: (name: string) =>
    api.delete<ServerActionResult>(`/mcp/servers/${name}`),

  /**
   * Server'ın araçlarını getir.
   */
  getServerTools: (name: string) =>
    api.get<ServerToolsResponse>(`/mcp/servers/${name}/tools`),

  /**
   * Server durumunu getir.
   */
  getServerStatus: (name: string) =>
    api.get<{ success: boolean; server: MCPServerRecord }>(`/mcp/servers/${name}/status`),
};
