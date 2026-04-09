/**
 * MCP (Model Context Protocol) — Tool Adapter
 *
 * MCP araçlarını mevcut ToolExecutor interface'ine adapte eder.
 * Bu sayede MCP araçları mevcut runtime ile uyumlu çalışır.
 */

import type { ToolExecutor } from '../tools.js';
import type { MCPClientManager } from './client.js';
import { logger } from '../../utils/logger.js';

/**
 * MCP aracını ToolExecutor interface'ine adapte eder.
 * Bu sayede MCP araçları mevcut runtime ile uyumlu çalışır.
 */
export function createMCPToolAdapter(
  mcpManager: MCPClientManager,
  serverName: string,
  toolName: string,
  description: string,
): ToolExecutor {
  const fullyQualifiedName = `mcp:${serverName}:${toolName}`;

  return {
    name: fullyQualifiedName,
    async execute(args: Record<string, unknown>): Promise<string> {
      try {
        logger.info(`[MCP:adapter] Calling ${fullyQualifiedName}(${JSON.stringify(args).substring(0, 100)})`);
        return await mcpManager.callTool(fullyQualifiedName, args);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ error, tool: fullyQualifiedName }, '[MCP:adapter] Tool execution error:');
        return `Hata: MCP araç çağrısı başarısız (${fullyQualifiedName}) — ${message}`;
      }
    },
  };
}

/**
 * Tüm MCP araçlarını ToolExecutor array'ine dönüştürür.
 */
export function convertMCPToolsToExecutors(mcpManager: MCPClientManager): ToolExecutor[] {
  const executors: ToolExecutor[] = [];

  for (const tool of mcpManager.listTools()) {
    if (tool.mcpServerName) {
      const prefix = `mcp:${tool.mcpServerName}:`;
      if (tool.name.startsWith(prefix)) {
        const rawToolName = tool.name.slice(prefix.length);
        executors.push(createMCPToolAdapter(mcpManager, tool.mcpServerName, rawToolName, tool.description));
      } else {
        logger.warn(`[MCP:adapter] Tool "${tool.name}" does not start with expected prefix "${prefix}"`);
      }
    }
  }

  return executors;
}
