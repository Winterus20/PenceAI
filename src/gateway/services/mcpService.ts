/**
 * MCP Marketplace — Gateway Service
 *
 * Marketplace catalog, kurulu server'lar ve lifecycle yönetimi
 * için gateway katmanı servisi.
 */

import { z } from 'zod';
import { MCPServerConfigSchema } from '../../agent/mcp/types.js';
import { MCPServerRecord, MCPServerLifecycleStatus } from '../../agent/mcp/marketplace-types.js';
import { getMarketplaceCatalog, searchCatalog, catalogToConfig } from '../../agent/mcp/marketplace-service.js';
import { MCPClientManager } from '../../agent/mcp/client.js';
import { getUnifiedToolRegistry } from '../../agent/mcp/registry.js';
import { getMCPEventBus } from '../../agent/mcp/eventBus.js';
import { logger } from '../../utils/logger.js';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// ============================================================
// Database Row Type & Schema Validation
// ============================================================

interface MCPServerRow {
  name: string;
  description: string;
  command: string;
  args: string;
  env: string;
  cwd: string | null;
  timeout: number;
  status: string;
  version: string;
  source: string;
  source_url: string | null;
  installed_at: string | null;
  last_activated: string | null;
  last_error: string | null;
  tool_count: number;
  metadata: string;
}

const MCPServerRowSchema = z.object({
  name: z.string(),
  description: z.string(),
  command: z.string(),
  args: z.string(),
  env: z.string(),
  cwd: z.string().nullable(),
  timeout: z.number(),
  status: z.string(),
  version: z.string(),
  source: z.enum(['local', 'marketplace', 'npm', 'github']),
  source_url: z.string().nullable(),
  installed_at: z.string().nullable(),
  last_activated: z.string().nullable(),
  last_error: z.string().nullable(),
  tool_count: z.number(),
  metadata: z.string(),
});

// In-memory store
const installedServers: Map<string, MCPServerRecord> = new Map();
let mcpManager: MCPClientManager | null = null;
let mcpManagerPromise: Promise<MCPClientManager> | null = null;
let db: Database.Database | null = null;

/**
 * Veritabanı bağlantısını başlat ve tablo oluştur.
 */
function initDatabase(dbPath: string): void {
  try {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    // Tablo oluştur (yoksa)
    db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        name TEXT PRIMARY KEY NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        command TEXT NOT NULL,
        args TEXT NOT NULL DEFAULT '[]',
        env TEXT NOT NULL DEFAULT '{}',
        cwd TEXT,
        timeout INTEGER NOT NULL DEFAULT 30000,
        status TEXT NOT NULL DEFAULT 'installed',
        version TEXT NOT NULL DEFAULT '1.0.0',
        source TEXT NOT NULL DEFAULT 'marketplace',
        source_url TEXT,
        installed_at TEXT,
        last_activated TEXT,
        last_error TEXT,
        tool_count INTEGER NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}'
      )
    `);

    logger.info('[MCP:service] Database initialized with mcp_servers table');
  } catch (error) {
    logger.error({ error }, '[MCP:service] Failed to initialize database');
  }
}

/**
 * Server'ı veritabanına kaydet.
 */
function saveServerToDB(server: MCPServerRecord): void {
  if (!db) return;
  try {
    db.prepare(`
      INSERT INTO mcp_servers (name, description, command, args, env, cwd, timeout, status, version, source, installed_at, last_activated, last_error, tool_count, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        description = excluded.description,
        command = excluded.command,
        args = excluded.args,
        env = excluded.env,
        cwd = excluded.cwd,
        timeout = excluded.timeout,
        status = excluded.status,
        version = excluded.version,
        source = excluded.source,
        source_url = excluded.source_url,
        last_activated = excluded.last_activated,
        last_error = excluded.last_error,
        tool_count = excluded.tool_count,
        metadata = excluded.metadata
    `).run(
      server.name,
      server.description,
      server.command,
      JSON.stringify(server.args),
      JSON.stringify(server.env),
      server.cwd ?? null,
      server.timeout,
      server.status,
      server.version,
      server.source,
      server.installedAt ? new Date(server.installedAt).toISOString() : null,
      server.lastActivated ? new Date(server.lastActivated).toISOString() : null,
      server.lastError ?? null,
      server.toolCount,
      JSON.stringify(server.metadata)
    );
  } catch (error) {
    logger.error({ error }, `[MCP:service] Failed to save server '${server.name}' to database`);
  }
}

/**
 * Server'ı veritabanından sil.
 */
function deleteServerFromDB(name: string): void {
  if (!db) return;
  try {
    db.prepare('DELETE FROM mcp_servers WHERE name = ?').run(name);
  } catch (error) {
    logger.error({ error }, `[MCP:service] Failed to delete server '${name}' from database`);
  }
}

/**
 * Tüm server'ları veritabanından yükle.
 */
function loadServersFromDB(): MCPServerRecord[] {
  if (!db) return [];
  try {
    const rows = db.prepare('SELECT * FROM mcp_servers').all() as unknown as MCPServerRow[];
    const results: MCPServerRecord[] = [];
    for (const row of rows) {
      const parseResult = MCPServerRowSchema.safeParse(row);
      if (!parseResult.success) {
        logger.warn({ name: (row as any)?.name, errors: parseResult.error.issues }, '[MCP:service] Skipping invalid server row');
        continue;
      }
      const validated = parseResult.data;
      results.push({
        name: validated.name,
        description: validated.description,
        command: validated.command,
        args: JSON.parse(validated.args) as string[],
        env: JSON.parse(validated.env) as Record<string, string>,
        cwd: validated.cwd ?? undefined,
        timeout: validated.timeout,
        status: validated.status as MCPServerLifecycleStatus,
        version: validated.version,
        source: validated.source as 'local' | 'marketplace' | 'npm' | 'github',
        sourceUrl: validated.source_url ?? undefined,
        installedAt: validated.installed_at ? new Date(validated.installed_at).getTime() : undefined,
        lastActivated: validated.last_activated ? new Date(validated.last_activated).getTime() : undefined,
        lastError: validated.last_error ?? undefined,
        toolCount: validated.tool_count,
        metadata: JSON.parse(validated.metadata) as Record<string, unknown>,
      });
    }
    return results;
  } catch (error) {
    logger.error({ error }, '[MCP:service] Failed to load servers from database');
    return [];
  }
}

/**
 * MCP Manager instance'ını getir veya oluştur.
 *
 * Öncelik sırası:
 * 1. runtime.ts'den setMCPManager() ile set edilmiş manager
 * 2. Lazy initialization (runtime set edilmemişse)
 *
 * Bu sayede frontend'den yüklenen MCP server'lar, runtime'dan gelen
 * manager'a eklenir ve tüm araçlar LLM'e görünür olur.
 */
async function getOrCreateMCPManager(): Promise<MCPClientManager> {
  // 1. Runtime'dan set edilmiş manager'ı kullan (singleton pattern)
  if (mcpManager) return mcpManager;
  
  // 2. Lazy initialization — runtime set edilmemişse
  if (!mcpManagerPromise) {
    mcpManagerPromise = (async () => {
      logger.info('[MCP:service] Creating new MCPClientManager (lazy init — no runtime manager)');
      const manager = new MCPClientManager();
      mcpManager = manager;
      return manager;
    })();
  }
  
  return mcpManagerPromise;
}

/**
 * MCP Manager'ı set et (runtime.ts'den event bus ile çağrılır).
 *
 * @param manager - MCPClientManager instance
 */
export function setMCPManager(manager: MCPClientManager): void {
  mcpManager = manager;
  mcpManagerPromise = null; // Önceki promise'i temizle — runtime'dan gelen manager öncelikli
  logger.info('[MCP:service] MCP Manager set (singleton)');
}

/**
 * Mevcut MCP Manager'ı getir (sync, null olabilir)
 */
export function getMCPManagerSync(): MCPClientManager | null {
  return mcpManager;
}

/**
 * Event bus listener — runtime'dan gelen event'leri dinler.
 * Bu fonksiyon gateway başlangıcında register edilir.
 */
export function registerMCPEventListeners(): void {
  const eventBus = getMCPEventBus();

  eventBus.on('server:activated', ({ name, toolCount }) => {
    logger.info(`[MCP:service] Event: server:activated — ${name} (${toolCount} tools)`);
  });

  eventBus.on('server:deactivated', ({ name }) => {
    logger.info(`[MCP:service] Event: server:deactivated — ${name}`);
  });

  eventBus.on('server:installed', ({ name }) => {
    logger.info(`[MCP:service] Event: server:installed — ${name}`);
  });

  eventBus.on('server:uninstalled', ({ name }) => {
    logger.info(`[MCP:service] Event: server:uninstalled — ${name}`);
  });

  eventBus.on('tools:discovered', ({ serverName, tools }) => {
    logger.info(`[MCP:service] Event: tools:discovered — ${serverName}: ${tools.join(', ')}`);
  });

  eventBus.on('error', ({ serverName, error }) => {
    logger.error(`[MCP:service] Event: error — ${serverName}: ${error}`);
  });
}

/**
 * Marketplace catalog'unu getir.
 *
 * @param query - Opsiyonel arama sorgusu
 * @returns Catalog entry'leri
 */
export async function getMarketplace(query?: string) {
  if (query) {
    return searchCatalog(query);
  }
  return getMarketplaceCatalog();
}

/**
 * Kurulu server'ları getir.
 *
 * @returns MCPServerRecord array'i
 */
export function getInstalledServers(): MCPServerRecord[] {
  return Array.from(installedServers.values());
}

/**
 * Server kur.
 *
 * @param config - Server konfigürasyonu
 * @returns İşlem sonucu
 */
export async function installServer(config: {
  name: string;
  description: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeout?: number;
}): Promise<{ success: boolean; server?: MCPServerRecord; error?: string }> {
  // Güvenlik: MCPServerConfigSchema ile command allowlist doğrulaması
  const configValidation = MCPServerConfigSchema.safeParse({
    name: config.name,
    command: config.command,
    args: config.args,
    env: config.env,
    cwd: config.cwd,
    timeout: config.timeout,
  });
  if (!configValidation.success) {
    const errors = configValidation.error.issues.map(i => i.message).join('; ');
    logger.warn({ name: config.name, command: config.command, errors }, '[MCP:service] installServer: config validation failed');
    return { success: false, error: `Geçersiz MCP server konfigürasyonu: ${errors}` };
  }

  // Duplicate check
  if (installedServers.has(config.name)) {
    return { success: false, error: `Server '${config.name}' zaten kurulu` };
  }

  const server: MCPServerRecord = {
    name: config.name,
    description: config.description,
    command: config.command,
    args: config.args,
    env: config.env ?? {},
    cwd: config.cwd,
    timeout: config.timeout ?? 30000,
    status: 'installed',
    version: '1.0.0',
    source: 'marketplace',
    installedAt: Date.now(),
    toolCount: 0,
    metadata: {},
  };

  installedServers.set(config.name, server);
  saveServerToDB(server);
  logger.info(`[MCP:service] Server '${config.name}' installed (status: installed — activate manually)`);

  // Event bus emit
  const eventBus = getMCPEventBus();
  eventBus.emit('server:installed', { name: config.name });

  return { success: true, server };
}

/**
 * Server'ı aktif et.
 *
 * @param name - Server adı
 * @returns İşlem sonucu
 */
export async function activateServer(name: string): Promise<{ success: boolean; server?: MCPServerRecord; error?: string }> {
  const server = installedServers.get(name);
  if (!server) {
    return { success: false, error: `Server '${name}' bulunamadı` };
  }

  // Güvenlik: Aktive etmeden önce command allowlist doğrulaması
  const configValidation = MCPServerConfigSchema.safeParse({
    name: server.name,
    command: server.command,
    args: server.args,
    env: server.env,
    cwd: server.cwd,
    timeout: server.timeout,
  });
  if (!configValidation.success) {
    const errors = configValidation.error.issues.map(i => i.message).join('; ');
    logger.warn({ name: server.name, command: server.command, errors }, '[MCP:service] activateServer: config validation failed');
    return { success: false, error: `Geçersiz MCP server konfigürasyonu: ${errors}` };
  }

  // Lazy initialization - mcpManager yoksa oluştur
  const manager = await getOrCreateMCPManager();

  try {
    const config = {
      name: server.name,
      command: server.command,
      args: server.args,
      env: server.env,
      cwd: server.cwd,
      timeout: server.timeout,
    };

    await manager.connectServer(config);
    server.status = 'active';
    server.lastActivated = Date.now();
    server.toolCount = manager.getServerTools(name).length;

    // ✅ Registry'yi güncelle — LLM yeni araçları görebilsin
    const registry = getUnifiedToolRegistry();
    await registry.registerMCPManager(manager);
    logger.info(`[MCP:service] Registry updated — ${registry.toolCount} total tools available`);

    // MCP_SERVERS environment variable'ını guncelle
    updateMCPServersEnv();

    installedServers.set(name, server);
    saveServerToDB(server);
    logger.info(`[MCP:service] Server '${name}' activated — ${server.toolCount} tools`);

    // Event bus emit
    const eventBus = getMCPEventBus();
    eventBus.emit('server:activated', { name, toolCount: server.toolCount });

    return { success: true, server };
  } catch (error) {
    server.status = 'error';
    server.lastError = error instanceof Error ? error.message : String(error);
    installedServers.set(name, server);
    saveServerToDB(server);
    logger.error({ error }, `[MCP:service] Failed to activate '${name}'`);
    return { success: false, error: server.lastError };
  }
}

/**
 * Server'ı devre dışı bırak.
 *
 * @param name - Server adı
 * @returns İşlem sonucu
 */
export async function deactivateServer(name: string): Promise<{ success: boolean; error?: string }> {
  const server = installedServers.get(name);
  if (!server) {
    return { success: false, error: `Server '${name}' bulunamadı` };
  }

  // mcpManager yoksa, server zaten bağlı değildir
  if (!mcpManager) {
    server.status = 'disabled';
    server.toolCount = 0;
    installedServers.set(name, server);
    saveServerToDB(server);
    updateMCPServersEnv();
    logger.info(`[MCP:service] Server '${name}' marked as disabled (no active manager)`);
    return { success: true };
  }

  try {
    await mcpManager.disconnectServer(name);
    server.status = 'disabled';
    server.toolCount = 0;
    installedServers.set(name, server);
    saveServerToDB(server);
    updateMCPServersEnv();
    logger.info(`[MCP:service] Server '${name}' deactivated`);

    // Event bus emit
    const eventBus = getMCPEventBus();
    eventBus.emit('server:deactivated', { name });

    return { success: true };
  } catch (error) {
    logger.error({ error }, `[MCP:service] Failed to deactivate '${name}'`);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Server'ı kaldır.
 *
 * @param name - Server adı
 * @returns İşlem sonucu
 */
export async function uninstallServer(name: string): Promise<{ success: boolean; error?: string }> {
  const server = installedServers.get(name);
  if (!server) {
    return { success: false, error: `Server '${name}' bulunamadı` };
  }

  // Önce devre dışı bırak
  if (server.status === 'active' && mcpManager) {
    try {
      await mcpManager.disconnectServer(name);
    } catch (e) {
      logger.warn({ error: e }, `[MCP:service] Error disconnecting '${name}' during uninstall`);
    }
  }

  installedServers.delete(name);
  deleteServerFromDB(name);
  
  // MCP_SERVERS environment variable'ını guncelle
  updateMCPServersEnv();
  
  // Eğer hiç server kalmadıysa manager'ı da temizle
  if (installedServers.size === 0 && mcpManager) {
    await mcpManager.shutdown();
    mcpManager = null;
    mcpManagerPromise = null;
    logger.info('[MCP:service] All servers uninstalled, MCP manager cleared');
  }
  
  // Event bus emit
  const eventBus = getMCPEventBus();
  eventBus.emit('server:uninstalled', { name });
  
  logger.info(`[MCP:service] Server '${name}' uninstalled`);
  return { success: true };
}

/**
 * Server'ın araçlarını getir.
 *
 * @param name - Server adı
 * @returns Araç listesi
 */
export function getServerTools(name: string) {
  if (!mcpManager) return [];
  return mcpManager.getServerTools(name);
}

/**
 * Server durumunu getir.
 *
 * @param name - Server adı
 * @returns Server kaydı veya null
 */
export function getServerStatus(name: string): MCPServerRecord | null {
  return installedServers.get(name) ?? null;
}

/**
 * Server'ları senkronize eder. (Artık .env dosyasına YAZILMIYOR)
 * Bütün yapılandırma veritabanında saklanır.
 */
function updateMCPServersEnv(): void {
  const activeServersCount = Array.from(installedServers.values()).filter(s => s.status === 'active').length;
  logger.info(`[MCP:service] Registry synchronized. Active servers: ${activeServersCount}`);
}

/**
 * Veritabanını başlat ve kayıtlı server'ları yükle.
 * Backend başlangıcında çağrılır.
 */
export async function initMCPPersistence(dbPath: string): Promise<void> {
  initDatabase(dbPath);
  const savedServers = loadServersFromDB();
  for (const server of savedServers) {
    installedServers.set(server.name, server);
  }
  logger.info(`[MCP:service] Loaded ${savedServers.length} servers from database`);

  // MCP_SERVERS environment variable'ını guncelle
  updateMCPServersEnv();
}

/**
 * MCP servisini kapat ve tüm kaynakları temizle.
 * Process shutdown sırasında çağrılmalı.
 */
export async function shutdownMCPService(): Promise<void> {
  if (mcpManager) {
    try {
      await mcpManager.shutdown();
    } catch (error) {
      logger.error({ error }, '[MCP:service] Error during MCP manager shutdown');
    }
    mcpManager = null;
    mcpManagerPromise = null;
  }
  
  installedServers.clear();
  logger.info('[MCP:service] MCP service shut down and resources cleared');
}
