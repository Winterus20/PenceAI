/**
 * MCP (Model Context Protocol) — Client Manager
 *
 * Birden fazla MCP server'ını yöneten, araç keşfi yapan
 * ve araç çağrılarını yönlendiren merkezi yönetici sınıfı.
 *
 * Kullanım:
 * ```typescript
 * const manager = new MCPClientManager();
 * await manager.initialize(serverConfigs);
 * const tools = manager.listTools();
 * const result = await manager.callTool('mcp:filesystem:readFile', { path: '/tmp/test.txt' });
 * await manager.shutdown();
 * ```
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Tool, CallToolResult, ListToolsResult } from '@modelcontextprotocol/sdk/types.js';

import {
  MCPServerConfig,
  MCPToolDefinition,
  MCPToolCallArgs,
  MCPToolCallResult,
  MCPServerStatus,
  MCPServerStatusInfo,
  MCPEvent,
  MCPEventCallback,
  UnifiedToolDefinition,
} from './types.js';
import { createTransport, connectClient, disconnectClient } from './transport.js';
import { MCPSecurityManager } from './security.js';
import { logger } from '../../utils/logger.js';

/**
 * JSON schema properties nesnesinden tüm description alanlarını recursive olarak kaldırır.
 * LLM token optimizasyonu icin kullanilir.
 */
function stripDescriptions(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return {};

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'description') continue;
    if (key === 'properties' && typeof value === 'object' && value !== null) {
      const strippedProps: Record<string, unknown> = {};
      for (const [propKey, propValue] of Object.entries(value as Record<string, unknown>)) {
        if (typeof propValue === 'object' && propValue !== null) {
          strippedProps[propKey] = stripDescriptions(propValue as Record<string, unknown>);
        } else {
          strippedProps[propKey] = propValue;
        }
      }
      result[key] = strippedProps;
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ============================================================
// Server Entry — Tek bir MCP server'ın runtime durumu
// ============================================================

interface ServerEntry {
  /** Server config */
  config: MCPServerConfig;

  /** MCP Client instance */
  client: Client;

  /** Transport instance */
  transport: StdioClientTransport | SSEClientTransport | null;

  /** Bağlantı durumu */
  status: MCPServerStatus;

  /** Keşfedilen araçlar */
  tools: Tool[];

  /** Bağlantı zamanı */
  connectedAt?: number;

  /** Hata mesajı */
  error?: string;

  /** Reconnect attempt sayısı */
  reconnectAttempts: number;
}

// ============================================================
// Reconnection Constants
// ============================================================

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 2000;
const RECONNECT_MAX_DELAY_MS = 60000;

// ============================================================
// MCP Client Manager
// ============================================================

/**
 * Birden fazla MCP server'ını yöneten merkezi sınıf.
 *
 * Özellikler:
 * - Çoklu server desteği
 * - Otomatik araç keşfi
 * - Namespaced tool isimleri (mcp:{server}:{tool})
 * - Hata izolasyonu (bir server çökerse diğerleri etkilenmez)
 * - Event callback sistemi
 * - Security entegrasyonu (rate limit, validation, sanitization)
 * - Otomatik reconnection (exponential backoff)
 */
export class MCPClientManager {
  /** Aktif server entry'leri */
  private servers: Map<string, ServerEntry> = new Map();

  /** Event callback'leri */
  private eventCallbacks: Set<MCPEventCallback> = new Set();

  /** Manager başlatıldı mı? */
  private initialized = false;

  /** Initialization lock — paralel initialize çağrılarını önler */
  private _initLock: Promise<number> | null = null;

  /** Security manager */
  private security = MCPSecurityManager.getInstance();

  /** Aktif reconnection timer'ları */
  private reconnectTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /**
   * Event callback kaydet.
   */
  onEvent(callback: MCPEventCallback): void {
    this.eventCallbacks.add(callback);
  }

  /**
   * Event callback kaldır.
   */
  offEvent(callback: MCPEventCallback): void {
    this.eventCallbacks.delete(callback);
  }

  /**
   * Event yayınlama.
   */
  private emitEvent(event: MCPEvent): void {
    for (const callback of this.eventCallbacks) {
      try {
        callback(event);
      } catch (error) {
        logger.error({ error }, '[MCP:client] Event callback error:');
      }
    }
  }

  /**
   * Manager'ın başlatılıp başlatılmadığını kontrol eder.
   */
  get isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Tüm server'ları başlatır ve bağlanır.
   * Mutex ile korunur — paralel çağrılarda güvenlidir.
   *
   * @param configs - Server config array'i
   * @returns Başarıyla bağlanan server sayısı
   */
  async initialize(configs: MCPServerConfig[]): Promise<number> {
    // Mutex: eğer bir initialize zaten çalışıyorsa sonucunu bekle
    if (this._initLock) {
      logger.warn('[MCP:client] Initialize already in progress, waiting...');
      return this._initLock;
    }

    this._initLock = this._doInitialize(configs);
    try {
      return await this._initLock;
    } finally {
      this._initLock = null;
    }
  }

  /**
   * Asıl initialize işlemi (mutex tarafından korunur).
   */
  private async _doInitialize(configs: MCPServerConfig[]): Promise<number> {
    // Eğer zaten initialized ise önce shutdown yap
    if (this.initialized && this.servers.size > 0) {
      logger.warn('[MCP:client] Re-initializing — shutting down first');
      await this.shutdown();
    }

    if (configs.length === 0) {
      logger.info('[MCP:client] No server configs provided');
      return 0;
    }

    logger.info(`[MCP:client] Initializing ${configs.length} MCP server(s)...`);

    let connectedCount = 0;

    for (const config of configs) {
      try {
        await this.connectServer(config);
        connectedCount++;
      } catch (error) {
        logger.error(
          { error, serverName: config.name },
          `[MCP:client] Failed to connect to server "${config.name}":`,
        );
        // Diğer server'lara devam et
      }
    }

    // Hiçbir server bağlanamazsa initialized=false bırak
    if (connectedCount === 0) {
      logger.error('[MCP:client] ❌ No servers connected successfully, marking as not initialized');
      return 0;
    }

    this.initialized = true;
    logger.info(`[MCP:client] ✅ Initialization complete — ${connectedCount}/${configs.length} servers connected`);

    return connectedCount;
  }

  /**
   * Mevcut aktif sunucular ile yeni yapılandırmayı karşılaştırır ve eşitler.
   * "Hot Reload" yeteneği sağlar.
   */
  async sync(configs: MCPServerConfig[]): Promise<void> {
    if (!this.initialized) {
      logger.info('[MCP:client] Sync called but not initialized. Initializing...');
      await this.initialize(configs);
      return;
    }

    logger.info(`[MCP:client] Syncing ${configs.length} MCP server configs...`);

    const newConfigMap = new Map<string, MCPServerConfig>();
    for (const config of configs) {
      newConfigMap.set(config.name, config);
    }

    const currentServerNames = Array.from(this.servers.keys());

    // 1. Artık listede olmayanları kapat
    for (const name of currentServerNames) {
      if (!newConfigMap.has(name)) {
        logger.info(`[MCP:client] Server "${name}" removed from config, disconnecting...`);
        await this.disconnectServer(name);
      }
    }

    // 2. Yeni olanları veya değişenleri bağla
    for (const newConfig of configs) {
      const existingEntry = this.servers.get(newConfig.name);

      if (!existingEntry) {
        // Yeni sunucu
        logger.info(`[MCP:client] New server "${newConfig.name}" detected in config, connecting...`);
        this.connectServer(newConfig).catch(e => {
            logger.error({ error: e, serverName: newConfig.name }, `[MCP:client] Sync connect failed:`);
        });
      } else {
        // Zaten var, konfigürasyonu değişmiş mi kontrol et
        const oldConfig = existingEntry.config;
        if (this.hasConfigChanged(oldConfig, newConfig)) {
           logger.info(`[MCP:client] Configuration changed for server "${newConfig.name}", restarting...`);
           await this.disconnectServer(newConfig.name);
           this.connectServer(newConfig).catch(e => {
                logger.error({ error: e, serverName: newConfig.name }, `[MCP:client] Sync restart failed:`);
           });
        }
      }
    }
    
    // Registry'yi de güncelle (unified registry) -> done outside or via event bus?
    // Tools list naturally updates because listTools() fetches from map.
  }

  private hasConfigChanged(oldConfig: MCPServerConfig, newConfig: MCPServerConfig): boolean {
    if (oldConfig.command !== newConfig.command) return true;
    if (oldConfig.cwd !== newConfig.cwd) return true;
    if (oldConfig.timeout !== newConfig.timeout) return true;

    // Check args
    const oldArgs = oldConfig.args || [];
    const newArgs = newConfig.args || [];
    if (oldArgs.length !== newArgs.length || !oldArgs.every((val, index) => val === newArgs[index])) return true;

    // Check env
    const oldEnv = oldConfig.env || {};
    const newEnv = newConfig.env || {};
    if (Object.keys(oldEnv).length !== Object.keys(newEnv).length) return true;
    for (const key of Object.keys(oldEnv)) {
      if (oldEnv[key] !== newEnv[key]) return true;
    }

    return false;
  }

  /**
   * Tek bir server'a bağlanır.
   */
  async connectServer(config: MCPServerConfig): Promise<void> {
    if (this.servers.has(config.name)) {
      logger.warn(`[MCP:client] Server "${config.name}" already connected, reconnecting...`);
      await this.disconnectServer(config.name);
    }

    const entry: ServerEntry = {
      config,
      client: new Client(
        {
          name: 'penceai',
          version: '0.1.0',
        },
        {
          capabilities: {
            sampling: {},
            roots: { listChanged: true },
          },
        },
      ),
      transport: null,
      status: 'connecting',
      tools: [],
      reconnectAttempts: 0,
    };

    this.servers.set(config.name, entry);

    try {
      // Transport oluştur
      const { transport } = await createTransport(
        config,
        (event) => this.emitEvent(event),
        (status) => {
          entry.status = status;
          // Beklenmedik disconnect durumunda reconnect dene
          if (status === 'disconnected' && this.initialized) {
            this.scheduleReconnect(config.name);
          }
        },
      );
      entry.transport = transport;

      // Client'ı bağla
      await connectClient(entry.client, transport, config.name, config.timeout, (event) => this.emitEvent(event));

      // Araçları keşfet (pagination desteği ile)
      const toolsResult = await this.listToolsWithPagination(entry.client);
      entry.tools = toolsResult;
      entry.status = 'connected';
      entry.connectedAt = Date.now();
      entry.reconnectAttempts = 0; // Başarılı bağlantıda sıfırla

      logger.info(
        `[MCP:client] ✅ Server "${config.name}" connected — ${entry.tools.length} tools discovered`,
      );

      this.emitEvent({
        type: 'server_connected',
        serverName: config.name,
        timestamp: Date.now(),
        data: { toolCount: entry.tools.length },
      });
    } catch (error) {
      entry.status = 'error';
      entry.error = error instanceof Error ? error.message : String(error);

      // Resource cleanup on failure
      try {
        if (entry.transport) {
          await disconnectClient(entry.client, entry.transport, config.name);
        }
      } catch (cleanupError) {
        logger.warn(
          { error: cleanupError, serverName: config.name },
          `[MCP:client] Error during cleanup after connection failure:`,
        );
      }
      this.servers.delete(config.name);

      logger.error(
        { error, serverName: config.name },
        `[MCP:client] ❌ Server "${config.name}" connection failed:`,
      );

      this.emitEvent({
        type: 'server_error',
        serverName: config.name,
        timestamp: Date.now(),
        data: { error: entry.error },
      });

      throw error;
    }
  }

  /**
   * Otomatik reconnection planlar (exponential backoff).
   */
  private scheduleReconnect(serverName: string): void {
    // Mevcut timer varsa temizle
    const existingTimer = this.reconnectTimers.get(serverName);
    if (existingTimer) clearTimeout(existingTimer);

    // Config'i kaydet (disconnect sonrası server entry silinmiş olabilir)
    const entry = this.servers.get(serverName);
    const config = entry?.config;
    if (!config) return;

    const attempts = entry?.reconnectAttempts ?? 0;
    if (attempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.error(`[MCP:client] ❌ Server "${serverName}" max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) exceeded, giving up`);
      return;
    }

    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** attempts, RECONNECT_MAX_DELAY_MS);
    logger.info(`[MCP:client] 🔄 Scheduling reconnect for "${serverName}" in ${delay}ms (attempt ${attempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(serverName);
      try {
        // Eski entry'yi temizle
        if (this.servers.has(serverName)) {
          this.servers.delete(serverName);
        }
        await this.connectServer(config);
        logger.info(`[MCP:client] ✅ Reconnection successful for "${serverName}"`);
      } catch (error) {
        logger.warn({ error }, `[MCP:client] Reconnect attempt ${attempts + 1} failed for "${serverName}"`);
        // Entry'nin reconnect sayısını güncelle
        const newEntry = this.servers.get(serverName);
        if (newEntry) {
          newEntry.reconnectAttempts = attempts + 1;
        } else {
          // Entry silinmişse, config'i hatırlayarak tekrar planla
          this.servers.set(serverName, {
            config,
            client: new Client({ name: 'penceai', version: '0.1.0' }),
            transport: null,
            status: 'error',
            tools: [],
            reconnectAttempts: attempts + 1,
          });
        }
        this.scheduleReconnect(serverName);
      }
    }, delay);

    this.reconnectTimers.set(serverName, timer);
  }

  /**
   * Bir server'ın bağlantısını keser.
   */
  async disconnectServer(name: string): Promise<void> {
    // Reconnect timer'ını temizle
    const timer = this.reconnectTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(name);
    }

    const entry = this.servers.get(name);
    if (!entry) {
      logger.warn(`[MCP:client] Server "${name}" not found, skipping disconnect`);
      return;
    }

    try {
      if (entry.transport) {
        await disconnectClient(entry.client, entry.transport, name);
      }
      logger.info(`[MCP:client] Disconnected from server: ${name}`);
    } catch (error) {
      logger.warn({ error, serverName: name }, `[MCP:client] Error disconnecting ${name}:`);
    } finally {
      this.servers.delete(name);

      this.emitEvent({
        type: 'server_disconnected',
        serverName: name,
        timestamp: Date.now(),
        data: {},
      });
    }
  }

  /**
   * Tüm server'ların bağlantısını keser.
   */
  async shutdown(): Promise<void> {
    logger.info('[MCP:client] Shutting down all MCP servers...');

    // Tüm reconnect timer'ları temizle
    for (const [name, timer] of this.reconnectTimers.entries()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    const serverNames = Array.from(this.servers.keys());
    for (const name of serverNames) {
      await this.disconnectServer(name);
    }

    this.initialized = false;
    this.eventCallbacks.clear();

    logger.info('[MCP:client] All MCP servers shut down');
  }

  /**
   * Belirli bir server'ın durumunu döndürür.
   */
  getServerStatus(name: string): MCPServerStatusInfo | null {
    const entry = this.servers.get(name);
    if (!entry) return null;

    return {
      name: entry.config.name,
      status: entry.status,
      connectedAt: entry.connectedAt,
      error: entry.error,
      toolCount: entry.tools.length,
    };
  }

  /**
   * Tüm server'ların durumunu döndürür.
   */
  getAllServerStatuses(): MCPServerStatusInfo[] {
    return Array.from(this.servers.values()).map((entry) => ({
      name: entry.config.name,
      status: entry.status,
      connectedAt: entry.connectedAt,
      error: entry.error,
      toolCount: entry.tools.length,
    }));
  }

  /**
   * MCP SDK input schema'sını UnifiedToolDefinition formatına normalize eder.
   */
  private normalizeInputSchema(schema: unknown): { type: 'object'; properties?: Record<string, unknown>; required?: string[] } {
    if (schema && typeof schema === 'object' && 'type' in schema) {
      const obj = schema as Record<string, unknown>;
      return {
        type: (obj.type === 'object' ? 'object' : 'object') as 'object',
        properties: (obj.properties as Record<string, unknown> | undefined) ?? {},
        required: Array.isArray(obj.required) ? (obj.required as string[]) : undefined,
      };
    }
    return { type: 'object', properties: {} };
  }

  /**
   * Tüm araçları listeler (namespaced isimlerle).
   *
   * @returns UnifiedToolDefinition array'i
   */
  listTools(): UnifiedToolDefinition[] {
    const tools: UnifiedToolDefinition[] = [];

    for (const entry of this.servers.values()) {
      if (entry.status !== 'connected') continue;

      for (const tool of entry.tools) {
        const namespacedName = `mcp:${entry.config.name}:${tool.name}`;
        const inputSchema = this.normalizeInputSchema(tool.inputSchema);

        tools.push({
          name: namespacedName,
          description: tool.description ?? `MCP tool from ${entry.config.name}: ${tool.name}`,
          llmDescription: `${tool.name}: ${entry.config.name}`,
          parameters: inputSchema,
          llmParameters: {
            type: 'object',
            properties: stripDescriptions(inputSchema.properties),
            ...(inputSchema.required ? { required: inputSchema.required } : {}),
          },
          source: 'mcp' as const,
          mcpServerName: entry.config.name,
          fullyQualifiedName: namespacedName,
        });
      }
    }

    return tools;
  }

  /**
   * Belirli bir server'ın araçlarını listeler.
   */
  getServerTools(serverName: string): UnifiedToolDefinition[] {
    const entry = this.servers.get(serverName);
    if (!entry || entry.status !== 'connected') return [];

    return entry.tools.map((tool) => {
      const namespacedName = `mcp:${serverName}:${tool.name}`;
      const inputSchema = this.normalizeInputSchema(tool.inputSchema);
      return {
        name: namespacedName,
        description: tool.description ?? `MCP tool from ${serverName}: ${tool.name}`,
        llmDescription: `${tool.name}: ${serverName}`,
        parameters: inputSchema,
        llmParameters: {
          type: 'object',
          properties: stripDescriptions(inputSchema.properties),
          ...(inputSchema.required ? { required: inputSchema.required } : {}),
        },
        source: 'mcp' as const,
        mcpServerName: serverName,
        fullyQualifiedName: namespacedName,
      };
    });
  }

  /**
   * Bir aracı çağırır.
   * Security entegrasyonu: Rate limiter, argument validation, output sanitization.
   *
   * @param fullyQualifiedName - Tam nitelikli araç adı (örn: "mcp:filesystem:readFile")
   * @param args - Araç argümanları
   * @returns Araç sonucu (text string)
   */
  async callTool(fullyQualifiedName: string, args: MCPToolCallArgs): Promise<string> {
    // FQN parse: mcp:{server}:{tool}
    const parts = fullyQualifiedName.split(':');
    if (parts.length < 3 || parts[0] !== 'mcp') {
      throw new Error(`Invalid tool name format: ${fullyQualifiedName}. Expected: mcp:{server}:{tool}`);
    }

    const serverName = parts[1]!;
    const toolName = parts.slice(2).join(':'); // Tool adı içinde : olabilir

    const entry = this.servers.get(serverName);
    if (!entry) {
      throw new Error(`MCP server "${serverName}" not found`);
    }

    if (entry.status !== 'connected') {
      throw new Error(`MCP server "${serverName}" is not connected (status: ${entry.status})`);
    }

    // ── Security: Rate Limiting ──
    if (!this.security.rateLimiter.check(fullyQualifiedName)) {
      throw new Error(`Rate limit exceeded for tool "${fullyQualifiedName}". Please slow down.`);
    }

    // ── Security: Argument Validation ──
    const validation = this.security.validator.validateArgs(fullyQualifiedName, args);
    if (!validation.valid) {
      throw new Error(`Tool call validation failed for "${fullyQualifiedName}": ${validation.error}`);
    }

    // ── Security: Tool Input Schema Validation (best-effort) ──
    const resolvedToolName = toolName || '';
    const toolMeta = entry.tools.find(t => t.name === resolvedToolName);
    if (toolMeta?.inputSchema && typeof toolMeta.inputSchema === 'object') {
      const schemaObj = toolMeta.inputSchema as Record<string, unknown>;
      if (schemaObj.type === 'object' && schemaObj.properties && typeof schemaObj.properties === 'object') {
        const requiredFields = Array.isArray(schemaObj.required) ? schemaObj.required as string[] : [];
        for (const req of requiredFields) {
          if (!(req in args)) {
            throw new Error(`Tool call validation failed for "${fullyQualifiedName}": missing required argument "${req}"`);
          }
        }
      }
    }

    // ── Security: Concurrency Limiting ──
    await this.security.concurrencyLimiter.acquire();

    const safeServerName = serverName || '';
    const safeToolName = toolName || '';

    // Tool call start event
    this.emitEvent({
      type: 'tool_call_start',
      serverName: safeServerName,
      timestamp: Date.now(),
      data: { toolName: safeToolName, arguments: args },
    });

    const timeout = entry.config.timeout ?? 30000;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      // Timeout wrapper
      const toolCallPromise = entry.client.callTool({
        name: toolName,
        arguments: args,
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`MCP tool call timeout (${serverName}:${toolName}) — ${timeout}ms exceeded`));
        }, timeout);
      });

      const result = await Promise.race([toolCallPromise, timeoutPromise]) as CallToolResult;

      // Result'u text'e çevir (SDK tipi ile uyumlu)
      let textResult = this.formatToolResultFromSDK(result);

      // ── Security: Output Sanitization ──
      textResult = this.security.sanitizer.sanitize(textResult);

      // Tool call end event
      this.emitEvent({
        type: 'tool_call_end',
        serverName: safeServerName,
        timestamp: Date.now(),
        data: { toolName: safeToolName, result: textResult.substring(0, 500) },
      });

      return textResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // ── Security: Sanitize error messages that may contain secrets ──
      const sanitizedErrorMessage = this.security.sanitizer.sanitize(errorMessage);

      // Tool call error event
      this.emitEvent({
        type: 'tool_call_error',
        serverName: safeServerName,
        timestamp: Date.now(),
        data: { toolName: safeToolName, error: sanitizedErrorMessage },
      });

      throw new Error(`MCP tool call failed (${safeServerName}:${safeToolName}): ${sanitizedErrorMessage}`);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      this.security.concurrencyLimiter.release();
    }
  }

  /**
   * SDK CallToolResult tipini doğrular — type-safe narrowing.
   */
  private isValidContent(item: unknown): item is Record<string, unknown> {
    return typeof item === 'object' && item !== null && 'type' in item;
  }

  /**
   * MCP SDK resultunu text string'e çevirir.
   * SDK'nın CallToolResult tipi ile uyumlu çalışır.
   */
  private formatToolResultFromSDK(result: CallToolResult): string {
    const content = Array.isArray(result.content) ? result.content : [];
    const isError = result.isError === true;

    if (content.length === 0) {
      if (isError) {
        return `⚠️ MCP tool error: ${typeof result.error === 'string' ? result.error : 'Bilinmeyen hata'}`;
      }
      return '(MCP tool sonuç üretmedi)';
    }

    const texts: string[] = [];

    for (const item of content) {
      if (!this.isValidContent(item)) continue;

      const type = typeof item.type === 'string' ? item.type : 'unknown';

      switch (type) {
        case 'text':
          if ('text' in item && typeof item.text === 'string') {
            texts.push(item.text);
          }
          break;
        case 'image':
          texts.push(`[Görsel: ${'mimeType' in item && typeof item.mimeType === 'string' ? item.mimeType : 'unknown'}]`);
          break;
        case 'audio':
          texts.push(`[Ses: ${'mimeType' in item && typeof item.mimeType === 'string' ? item.mimeType : 'unknown'}]`);
          break;
        case 'resource':
          texts.push(`[Kaynak: ${'uri' in item && typeof item.uri === 'string' ? item.uri : 'unknown'}]`);
          break;
        case 'resource_link':
          texts.push(`[Kaynak bağlantısı: ${'uri' in item && typeof item.uri === 'string' ? item.uri : 'unknown'}]`);
          break;
        default:
          texts.push(`[Bilinmeyen içerik tipi: ${type}]`);
      }
    }

    return texts.join('\n\n') || '(MCP tool boş sonuç döndürdü)';
  }

  /**
   * Bir aracın var olup olmadığını kontrol eder.
   */
  hasTool(fullyQualifiedName: string): boolean {
    const parts = fullyQualifiedName.split(':');
    if (parts.length < 3 || parts[0] !== 'mcp') return false;

    const serverName = parts[1]!;
    const toolName = parts.slice(2).join(':');

    const entry = this.servers.get(serverName);
    if (!entry || entry.status !== 'connected') return false;

    return entry.tools.some((t) => t.name === (toolName || ''));
  }

  /**
   * Bağlı server sayısını döndürür.
   */
  get connectedServerCount(): number {
    return Array.from(this.servers.values()).filter((e) => e.status === 'connected').length;
  }

  /**
   * Toplam araç sayısını döndürür.
   */
  get totalToolCount(): number {
    return this.listTools().length;
  }

  /**
   * Pagination desteği ile tool listesi getirir.
   */
  private async listToolsWithPagination(client: Client): Promise<Tool[]> {
    const allTools: Tool[] = [];
    let cursor: string | undefined;

    do {
      const result = await client.listTools({ cursor }) as ListToolsResult;
      allTools.push(...(result.tools ?? []));
      cursor = result.nextCursor;
    } while (cursor);

    return allTools;
  }
}
