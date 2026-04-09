/**
 * MCP (Model Context Protocol) — Config Watcher (Hot Reloading)
 *
 * İzleme servisi, .env dosyasındaki değişiklikleri yakalar ve
 * MCP sunucularının uygulamanın yeniden başlatılmasına gerek 
 * kalmadan senkronize edilmesini sağlar.
 */

import fs from 'fs';
import path from 'path';
import { readEnv } from '../../gateway/envUtils.js';
import { parseMCPConfig } from './config.js';
import { logger } from '../../utils/logger.js';
import type { MCPClientManager } from './client.js';

export class MCPConfigWatcher {
  private watcher: fs.FSWatcher | null = null;
  private manager: MCPClientManager;
  private debounceTimer: NodeJS.Timeout | null = null;
  private isWatching = false;

  constructor(manager: MCPClientManager) {
    this.manager = manager;
  }

  /**
   * Watcher'ı başlatır. .env dosyasını dinlemeye başlar.
   */
  start(): void {
    if (this.isWatching) return;

    const envPath = path.resolve(process.cwd(), '.env');

    if (!fs.existsSync(envPath)) {
      logger.warn(`[MCP:watcher] .env file not found at ${envPath}, cannot watch for changes.`);
      return;
    }

    try {
      this.watcher = fs.watch(envPath, (eventType) => {
        if (eventType === 'change' || eventType === 'rename') {
          this.handleFileChange();
        }
      });
      this.isWatching = true;
      logger.info(`[MCP:watcher] Started watching ${envPath} for Hot Reload`);
    } catch (error) {
      logger.error({ error }, '[MCP:watcher] Failed to start config watcher');
    }
  }

  /**
   * Watcher'ı durdurur.
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.isWatching = false;
    logger.info('[MCP:watcher] Config watcher stopped');
  }

  /**
   * Dosya değişikliklerini ele alır (Debounce ile).
   */
  private handleFileChange(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      logger.info('[MCP:watcher] .env file change detected, syncing MCP config...');
      
      this.reloadEnv();

      const { enabled, servers } = parseMCPConfig();

      if (!enabled) {
        logger.info('[MCP:watcher] MCP is disabled in new config. Shutting down servers...');
        this.manager.shutdown().catch(err => {
            logger.error({ error: err }, '[MCP:watcher] Error during shutdown');
        });
      } else {
        this.manager.sync(servers).catch(err => {
          logger.error({ error: err }, '[MCP:watcher] Failed to sync new config');
        });
      }
    }, 1000); // 1 saniye debounce
  }

  /**
   * process.env objesini .env dosyasındaki yeni değerlerle günceller.
   * Node process.env otomatik yenilenmediği için bu işlem gereklidir.
   */
  private reloadEnv(): void {
    try {
        const newEnv = readEnv();
        for (const [key, value] of Object.entries(newEnv)) {
            process.env[key] = value;
        }
    } catch (e) {
        logger.error({error: e}, '[MCP:watcher] Error reloading .env to process.env');
    }
  }
}
