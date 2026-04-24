/**
 * MCP (Model Context Protocol) — Unified Tool Registry
 *
 * Built-in araçlar ile MCP araçlarını tek bir registry'de birleştiren sınıf.
 *
 * Özellikler:
 * - Built-in araçları MCP formatına adapte eder
 * - MCP araçlarını registry'ye ekler
 * - Tool name çakışmalarını önler (mcp:{server}:{tool} namespace)
 * - Tek bir executeTool() interface'i sağlar
 */

import type { MCPClientManager } from './client.js';
import { createBuiltinTools, type ToolExecutor } from '../tools.js';
import { getBuiltinToolDefinitions } from '../prompt.js';
import type { MemoryManager } from '../../memory/manager.js';
import type { ConfirmCallback } from '../tools.js';
import type { LLMToolDefinition } from '../../router/types.js';
import type { UnifiedToolDefinition, UnifiedToolExecutor } from './types.js';
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

/**
 * UnifiedToolRegistry — Built-in ve MCP araçlarını tek registry'de birleştirir.
 */
export class UnifiedToolRegistry {
  /** Built-in tool executors */
  private builtinExecutors: Map<string, ToolExecutor> = new Map();

  /** MCP tool executors (MCPClientManager üzerinden) */
  private mcpManager: MCPClientManager | null = null;

  /** Memory manager (built-in tools için gerekli) */
  private memoryManager: MemoryManager | null = null;

  /** Confirm callback (hassas işlemler için) */
  private confirmCallback?: ConfirmCallback;

  /** Merge function (memory birleştirme için) */
  private mergeFn?: (oldContent: string, newContent: string) => Promise<string>;

  /**
   * Registry'yi başlatır.
   */
  constructor() {}

  /**
   * Built-in araçları registry'ye ekler.
   */
  registerBuiltins(
    memoryManager: MemoryManager,
    confirmCallback?: ConfirmCallback,
    mergeFn?: (oldContent: string, newContent: string) => Promise<string>,
  ): void {
    this.memoryManager = memoryManager;
    this.confirmCallback = confirmCallback;
    this.mergeFn = mergeFn;

    const tools = createBuiltinTools(memoryManager, confirmCallback, mergeFn);
    this.builtinExecutors.clear();
    for (const tool of tools) {
      this.builtinExecutors.set(tool.name, tool);
    }
    logger.info(`[MCP:registry] ✅ ${tools.length} built-in tools registered`);
  }

  /**
   * MCP Client Manager'ı bağlar.
   */
  async registerMCPManager(manager: MCPClientManager): Promise<void> {
    this.mcpManager = manager;
    const toolCount = manager.totalToolCount;
    logger.info(`[MCP:registry] ✅ MCP manager registered — ${toolCount} MCP tools available`);
  }

  /**
   * Tüm araç tanımlarını döndürür (LLM prompt'u için).
   * Built-in + MCP araçlarını birleştirir.
   */
  getAllToolDefinitions(): LLMToolDefinition[] {
    const definitions: LLMToolDefinition[] = [];

    // Built-in tool tanımları
    const builtinDefs = getBuiltinToolDefinitions();
    definitions.push(...builtinDefs);

    // MCP tool tanımları
    if (this.mcpManager) {
      const mcpTools = this.mcpManager.listTools();
      for (const tool of mcpTools) {
        definitions.push({
          name: tool.name,
          description: tool.description,
          llmDescription: tool.llmDescription,
          parameters: tool.parameters,
          llmParameters: tool.llmParameters,
        });
      }
    }

    return definitions;
  }

  /**
   * Bir aracı çalıştırır. Önce built-in, sonra MCP araçlarını dener.
   */
  async executeTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    // 1. Built-in araçları dene
    const builtin = this.builtinExecutors.get(toolName);
    if (builtin) {
      return builtin.execute(args);
    }

    // 2. MCP aracını dene
    if (this.mcpManager && toolName.startsWith('mcp:')) {
      if (this.mcpManager.hasTool(toolName)) {
        return this.mcpManager.callTool(toolName, args);
      }
    }

    return `Hata: Bilinmeyen araç: ${toolName}`;
  }

  /**
   * Bir aracın var olup olmadığını kontrol eder.
   */
  hasTool(toolName: string): boolean {
    if (this.builtinExecutors.has(toolName)) return true;
    if (this.mcpManager && toolName.startsWith('mcp:') && this.mcpManager.hasTool(toolName)) return true;
    return false;
  }

  /**
   * Kayıtlı araç sayısını döndürür.
   */
  get toolCount(): number {
    const builtinCount = this.builtinExecutors.size;
    const mcpCount = this.mcpManager?.totalToolCount ?? 0;
    return builtinCount + mcpCount;
  }

  /**
   * Registry'yi temizler.
   */
  clear(): void {
    this.builtinExecutors.clear();
    this.mcpManager = null;
    this.memoryManager = null;
    this.confirmCallback = undefined;
    this.mergeFn = undefined;
  }
}

// Singleton instance
let _registry: UnifiedToolRegistry | null = null;

export function getUnifiedToolRegistry(): UnifiedToolRegistry {
  if (!_registry) {
    _registry = new UnifiedToolRegistry();
  }
  return _registry;
}

export function resetUnifiedToolRegistry(): void {
  if (_registry) {
    _registry.clear();
  }
  _registry = null;
}
