import { logger } from '../utils/logger.js';
import { DEFAULT_AUTONOMOUS_AUTO_APPROVE_TOOLS } from '../gateway/securityDefaults.js';
import type { ConfirmCallback } from './tools.js';

export { DEFAULT_AUTONOMOUS_AUTO_APPROVE_TOOLS };

/**
 * Zamanlanmış görevler için whitelist tabanlı otomatik onay callback'i.
 * Whitelist dışındaki tool'lar (write, shell, MCP vb.) reddedilir.
 */
export function createScopedAutoConfirmCallback(
  allowedTools: readonly string[] = DEFAULT_AUTONOMOUS_AUTO_APPROVE_TOOLS,
): ConfirmCallback {
  const allowSet = new Set(allowedTools);

  return async (info) => {
    if (info.toolName.startsWith('mcp:') && !allowSet.has(info.toolName)) {
      logger.warn(
        `[Gateway] Otonom onay reddedildi (MCP whitelist dışı): ${info.toolName}`,
      );
      return false;
    }

    if (allowSet.has(info.toolName)) {
      logger.info(
        `[Gateway] Otonom onay (whitelist): ${info.toolName} — ${info.operation} ${info.path}`,
      );
      return true;
    }

    logger.warn(
      `[Gateway] Otonom onay reddedildi (whitelist dışı): ${info.toolName} — ${info.operation} ${info.path}`,
    );
    return false;
  };
}
