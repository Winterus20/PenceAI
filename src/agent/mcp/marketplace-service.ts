/**
 * MCP Marketplace — Catalog Servisi
 *
 * Local catalog'dan server'ları yükleme, registry API'den
 * server'ları çekme ve catalog-to-config dönüşüm işlemleri.
 */

import type { MCPServerCatalogEntry } from './marketplace-types.js';
import type { MCPServerConfig } from './types.js';
import { logger } from '../../utils/logger.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { validateRegistryCommand, sanitizeRegistryUrl } from './command-validator.js';

// ============================================================
// Catalog Cache (TTL-based)
// ============================================================

const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 dakika
let _cachedCatalog: MCPServerCatalogEntry[] | null = null;
let _cacheTimestamp: number = 0;

// ============================================================
// Registry API Response Types
// ============================================================

interface RegistryServerResponse {
  server?: {
    name?: string;
    description?: string;
    version?: string;
    repository?: {
      source?: string;
      url?: string;
    };
    remotes?: Array<{
      type?: string;
      url?: string;
    }>;
    _meta?: Record<string, unknown> & { 'io.modelcontextprotocol.registry/publisher-provided'?: { keywords?: string[] } };
    icons?: Array<{ src?: string }>;
    websiteUrl?: string;
  };
}

interface RegistryResponse {
  servers?: RegistryServerResponse[];
}

const PROJECT_ROOT = process.cwd();

/**
 * Local catalog'dan server'ları yükle.
 *
 * @returns MCPServerCatalogEntry array'i
 */
export function loadLocalCatalog(): MCPServerCatalogEntry[] {
  try {
    // __dirname compiled JS dosyasının dizinini gösterir (dist/agent/mcp veya src/agent/mcp)
    // JSON dosyası aynı dizinde olmalı
    // Production build output (dist/agent/mcp)
    let catalogPath = join(PROJECT_ROOT, 'dist', 'agent', 'mcp', 'marketplace-catalog.json');
    
    // Development source directory
    if (!existsSync(catalogPath)) {
      catalogPath = join(PROJECT_ROOT, 'src', 'agent', 'mcp', 'marketplace-catalog.json');
    }
    
    if (!existsSync(catalogPath)) {
      logger.warn({ catalogPath }, '[MCP:marketplace] marketplace-catalog.json not found, returning empty array');
      return [];
    }
    
    logger.info({ catalogPath }, '[MCP:marketplace] Loading catalog from');
    const raw = readFileSync(catalogPath, 'utf-8');
    const data = JSON.parse(raw);
    const servers = (data.servers ?? []) as MCPServerCatalogEntry[];
    logger.info(`[MCP:marketplace] Loaded ${servers.length} servers from catalog`);
    return servers;
  } catch (err) {
    logger.error({ err }, '[MCP:marketplace] Failed to load local catalog');
    return [];
  }
}

/**
 * MCP Registry API'den server'ları çek (opsiyonel sync).
 * Registry verileri farklı formatta olduğu için dönüştürme yapılır.
 *
 * @returns MCPServerCatalogEntry array'i (hata durumunda boş array)
 */
export async function fetchFromRegistry(): Promise<MCPServerCatalogEntry[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch('https://registry.modelcontextprotocol.io/v0/servers', {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    
    if (!response.ok) {
      logger.warn(`[MCP:marketplace] Registry API returned ${response.status}`);
      return [];
    }
    const data = await response.json();
    
    // Registry verilerini MCPServerCatalogEntry formatına dönüştür
    const registryServers = (data.servers ?? []).map((s: RegistryServerResponse) => {
      const server = s.server;
      if (!server) return null;
      
      // Remote URL'den command ve args oluştur
      const remote = server.remotes?.[0];
      // GÜVENLİ: Command allowlist kontrolü
      const command = validateRegistryCommand(
        remote?.type === 'streamable-http' ? 'curl' : 'npx'
      );
      // GÜVENLİ: URL sanitization
      const args = remote?.url ? ['-X', 'POST', sanitizeRegistryUrl(remote.url)] : [];
      
      return {
        name: server.name || 'unknown',
        description: server.description || '',
        version: server.version || '1.0.0',
        author: server.repository?.source || 'registry',
        tags: server._meta?.['io.modelcontextprotocol.registry/publisher-provided']?.keywords || [],
        icon: server.icons?.[0]?.src,
        command,
        defaultArgs: args,
        defaultEnv: {},
        sourceUrl: server.repository?.url || server.websiteUrl || '',
        npmPackage: undefined,
        tools: [],
        rating: undefined,
        installCount: undefined,
      } as MCPServerCatalogEntry;
    }).filter(Boolean) as MCPServerCatalogEntry[];
    
    return registryServers;
  } catch (error) {
    // Ağ hatası veya timeout — sessizce boş dön
    logger.debug('[MCP:marketplace] Registry unavailable, using local catalog only');
    return [];
  }
}

/**
 * Tüm catalog'u getir (local + registry merge).
 *
 * @returns Birleştirilmiş MCPServerCatalogEntry array'i
 */
export async function getMarketplaceCatalog(): Promise<MCPServerCatalogEntry[]> {
  // Cache kontrolü
  const now = Date.now();
  if (_cachedCatalog && (now - _cacheTimestamp) < CATALOG_CACHE_TTL_MS) {
    logger.debug(`[MCP:marketplace] Returning cached catalog (${_cachedCatalog.length} servers, age: ${Math.round((now - _cacheTimestamp) / 1000)}s)`);
    return _cachedCatalog;
  }

  try {
    const local = loadLocalCatalog();

    // Registry'den çekmeyi dene, başarısız olursa local ile devam et
    let registry: MCPServerCatalogEntry[] = [];
    try {
      registry = await fetchFromRegistry();
    } catch {
      // Registry unavailable — sadece local catalog kullan
    }

    // Merge: registry'deki yeni server'ları ekle (isim çakışmasını önle)
    const localNames = new Set(local.map(s => s.name));
    const newServers = registry.filter(s => s.name && !localNames.has(s.name));

    // Registry'de de duplicate'ler olabilir, bunları da temizle
    const seenNames = new Set<string>();
    const uniqueNewServers: MCPServerCatalogEntry[] = [];
    for (const server of newServers) {
      if (!seenNames.has(server.name)) {
        seenNames.add(server.name);
        uniqueNewServers.push(server);
      }
    }

    const merged = [...local, ...uniqueNewServers];
    logger.info(`[MCP:marketplace] Total catalog: ${merged.length} servers (${local.length} local + ${uniqueNewServers.length} registry)`);

    // Cache'e yaz
    _cachedCatalog = merged;
    _cacheTimestamp = now;

    return merged;
  } catch (err) {
    logger.error({ err }, '[MCP:marketplace] Failed to get marketplace catalog');
    return [];
  }
}

/**
 * Catalog'dan server ara.
 *
 * @param query - Arama sorgusu (name, description, tags)
 * @returns Eşleşen MCPServerCatalogEntry array'i
 */
export async function searchCatalog(query: string): Promise<MCPServerCatalogEntry[]> {
  const catalog = await getMarketplaceCatalog();
  const q = query.toLowerCase();
  return catalog.filter(s =>
    s.name.toLowerCase().includes(q) ||
    s.description.toLowerCase().includes(q) ||
    s.tags.some(t => t.toLowerCase().includes(q))
  );
}

/**
 * Catalog entry'den MCPServerConfig oluştur.
 *
 * @param entry - Catalog entry
 * @param customArgs - Özel argümanlar (opsiyonel)
 * @returns MCPServerConfig
 */
export function catalogToConfig(entry: MCPServerCatalogEntry, customArgs?: string[]): MCPServerConfig {
  // GÜVENLİ: Command allowlist kontrolü
  const safeCommand = validateRegistryCommand(entry.command);
  
  return {
    name: entry.name,
    command: safeCommand,
    args: customArgs ?? entry.defaultArgs,
    env: entry.defaultEnv,
    timeout: 30000,
  };
}
