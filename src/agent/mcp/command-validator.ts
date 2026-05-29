/**
 * Command Validator — Registry'den gelen command ve URL'leri validate eder.
 * OWASP CWE-78: OS Command Injection koruması.
 *
 * Bu dosya tüm MCP modülü için TEK KAYNAK (single source of truth) olan
 * komut allowlist'ini ve güvenlik kurallarını tanımlar.
 */
import { z } from 'zod';
import { DANGEROUS_COMMAND_PATTERNS } from '../securityPatterns.js';

export { DANGEROUS_COMMAND_PATTERNS } from '../securityPatterns.js';

// ============================================================
// Merkezi Allowlist — Tüm MCP dosyaları bu listeden okur
// ============================================================

/**
 * Allowlist: MCP server'lar tarafından çalıştırılabilecek güvenli komutlar.
 * Yeni bir komut eklemek için SADECE bu listeyi güncelle.
 */
export const ALLOWED_COMMANDS = ['npx', 'node', 'python', 'python3', 'curl'] as const;
export type AllowedCommand = (typeof ALLOWED_COMMANDS)[number];

/**
 * Stdio transport olarak algılanacak komutlar / runtime'lar.
 * Bu liste ALLOWED_COMMANDS'ın üst kümesidir — ek olarak
 * deno, bun, tsx gibi yerel process çalıştırıcıları içerir.
 */
export const STDIO_RUNTIMES = [
  ...ALLOWED_COMMANDS,
  'deno',
  'bun',
  'tsx',
] as const;

// ============================================================
// Zod Schemas
// ============================================================

/**
 * Zod schema ile command validation.
 */
export const SafeCommandSchema = z.enum(ALLOWED_COMMANDS);

/**
 * URL validation schema.
 */
export const SafeUrlSchema = z.string()
  .url('Geçersiz URL formatı')
  .regex(/^https?:\/\//, 'Sadece HTTP/HTTPS URL\'lere izin verilir')
  .max(2048, 'URL çok uzun');

// ============================================================
// Validation Functions
// ============================================================

/**
 * Komutun güvenli olup olmadığını kontrol eder.
 * Hem dangerous pattern kontrolü hem allowlist kontrolü yapar.
 */
export function isCommandSafe(command: string): boolean {
  // Tehlikeli pattern'leri kontrol et
  for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return false;
    }
  }

  // Allowlist kontrolü — sadece executable ismini kontrol et
  const baseCommand = command.split(/\s+/)[0] || '';

  // Path traversal koruması: sadece dosya ismini al
  const pathParts = baseCommand.replace(/^(?:\.\/|\.\\)?/, '').split(/[\\/]/);
  const executableName = (pathParts[pathParts.length - 1] || '').toLowerCase();

  // Boş executable name kontrolü
  if (!executableName) {
    return false;
  }

  return (ALLOWED_COMMANDS as readonly string[]).includes(executableName);
}

/**
 * Komutun bir stdio process olup olmadığını kontrol eder.
 * STDIO_RUNTIMES listesini kullanır.
 * NOT: .js/.ts/.py uzantılı dosyalar command olarak verilemez;
 * bunlar node/python aracılığıyla çalıştırılmalıdır.
 */
export function isStdioRuntime(command: string): boolean {
  const baseCommand = command.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  return (STDIO_RUNTIMES as readonly string[]).includes(baseCommand);
}

/**
 * Registry'den gelen command'i validate et.
 */
export function validateRegistryCommand(command: unknown): string {
  return SafeCommandSchema.parse(command);
}

/**
 * Registry'den gelen URL'yi sanitize et.
 */
export function sanitizeRegistryUrl(url: unknown): string {
  const validated = SafeUrlSchema.parse(url);
  // Ek sanitization: shell meta karakterlerini reddet
  if (/[;&$`|\\<>]/.test(validated)) {
    throw new Error(`URL shell meta karakterleri içeriyor: ${validated}`);
  }
  // URL-encoded shell chars kontrolü
  try {
    const decoded = decodeURIComponent(validated);
    if (/[;&$`|\\<>]/.test(decoded)) {
      throw new Error(`URL encoded shell meta karakterleri içeriyor: ${validated}`);
    }
  } catch (decodeErr) {
    if (decodeErr instanceof URIError) {
      throw new Error(`Geçersiz URL encoding: ${validated}`);
    }
    throw decodeErr;
  }
  return validated;
}
