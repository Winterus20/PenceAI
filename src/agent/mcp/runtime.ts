/**
 * MCP (Model Context Protocol) — Runtime Integration
 *
 * Agent runtime'a MCP entegrasyonu için helper fonksiyonlar.
 * Uygulama başlangıcında initializeMCP() ve kapanışında shutdownMCP() çağrılır.
 *
 * NOT: Circular dependency'yi önlemek için gateway/mcpService yerine
 * event bus pattern kullanılır. Gateway bu event'leri dinleyerek
 * gerekli işlemleri yapar.
 */

import { MCPClientManager } from './client.js';
import { parseMCPConfig, isMCPEnabled } from './config.js';
import { getUnifiedToolRegistry } from './registry.js';
import { getMCPEventBus } from './eventBus.js';
import { setMCPManager } from '../../gateway/services/mcpService.js';
import { MCPConfigWatcher } from './watcher.js';
import { getHookRegistry } from './hooks.js';
import { registerBuiltInHooks } from './builtInHooks.js';
import { logger } from '../../utils/logger.js';

/** Module-level MCP manager instance */
let _mcpManager: MCPClientManager | null = null;
/** Module-level MCP config watcher */
let _mcpWatcher: MCPConfigWatcher | null = null;
/** Module-level hook registry initialization flag */
let _hooksInitialized = false;

import type { MCPServerConfig } from './types.js';

/**
 * MCP runtime başlatma fonksiyonu.
 * Uygulama başlangıcında çağrılır.
 *
 * @param activeServers - Veritabanından yüklenen aktif MCP server yapılandırmaları
 * @returns MCPClientManager instance veya null (MCP sunucu yoksa)
 */
export async function initializeMCP(activeServers: MCPServerConfig[] = []): Promise<MCPClientManager | null> {
  if (activeServers.length === 0) {
    logger.info('[MCP:runtime] MCP is disabled or no active servers');
    return null;
  }

  const servers = activeServers;


  logger.info(`[MCP:runtime] Initializing MCP with ${servers.length} server(s)...`);

  const manager = new MCPClientManager();

  // Event logging
  manager.onEvent((event) => {
    logger.debug({ event }, `[MCP:runtime] Event: ${event.type}`);
  });

  try {
    const connectedCount = await manager.initialize(servers);
    logger.info(`[MCP:runtime] ✅ MCP initialized — ${connectedCount}/${servers.length} servers connected`);

    // Registry'ye kaydet
    const registry = getUnifiedToolRegistry();
    await registry.registerMCPManager(manager);

    // Gateway'e manager'ı bildir (singleton pattern — frontend'den yüklenen server'lar
    // bu manager'ı kullanacak, böylece tüm araçlar LLM'e görünür olacak)
    setMCPManager(manager);

    // Event bus ile gateway'e bildir (circular dependency önlenir)
    const eventBus = getMCPEventBus();
    eventBus.emit('server:activated', { name: 'runtime-init', toolCount: connectedCount });

    // Store manager instance for shutdown
    _mcpManager = manager;

    // Watcher başlat (hot reload için)
    _mcpWatcher = new MCPConfigWatcher(manager);
    _mcpWatcher.start();

    // Hook Execution Engine başlat
    if (!_hooksInitialized) {
      const hookRegistry = getHookRegistry();
      registerBuiltInHooks(hookRegistry);

      // Event bus ile hook'ları bağla
      const eventBus = getMCPEventBus();

      eventBus.on('tool:call_start', (payload) => {
        eventBus.emit('hook:preToolUse', {
          toolName: payload.toolName,
          args: payload.arguments ?? {},
          sessionId: payload.serverName,
          callCount: 0,
        });
      });

      eventBus.on('tool:call_end', (payload) => {
        eventBus.emit('hook:postToolUse', {
          toolName: payload.toolName,
          args: {},
          sessionId: payload.serverName,
          callCount: 0,
          result: payload.result,
        });
      });

      eventBus.on('tool:call_error', (payload) => {
        eventBus.emit('hook:postToolUseFailure', {
          toolName: payload.toolName,
          args: {},
          sessionId: payload.serverName,
          callCount: 0,
          error: payload.error,
        });
      });

      _hooksInitialized = true;
      logger.info('[MCP:runtime] Hook Execution Engine initialized');
    }

    return manager;
  } catch (error) {
    logger.error({ error }, '[MCP:runtime] ❌ MCP initialization failed:');
    return null;
  }
}

/**
 * MCP runtime kapatma fonksiyonu.
 * Uygulama kapanışında çağrılır.
 */
export async function shutdownMCP(): Promise<void> {
  if (_mcpWatcher) {
    _mcpWatcher.stop();
    _mcpWatcher = null;
  }

  if (_mcpManager) {
    try {
      await _mcpManager.shutdown();
      logger.info('[MCP:runtime] ✅ MCP manager shut down');
    } catch (error) {
      logger.error({ error }, '[MCP:runtime] Error during MCP shutdown:');
    }
    _mcpManager = null;
  }

  // Registry'yi temizle
  getUnifiedToolRegistry().clear();

  logger.info('[MCP:runtime] MCP shutdown complete');
}
