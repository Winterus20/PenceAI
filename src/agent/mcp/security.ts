/**
 * MCP (Model Context Protocol) — Security Layer
 *
 * Tool call validation, output sanitization, rate limiting
 * ve concurrency limiting için güvenlik katmanı.
 */

import { z } from 'zod';
import { logger } from '../../utils/logger.js';

// ============================================================
// Tool Call Validation Schema
// ============================================================

/**
 * MCP tool call argümanları için genel validation schema.
 * Tehlikeli pattern'leri engeller.
 */
const DangerousPatternSchema = z.object({
  /** Maksimum argüman boyutu (bytes) */
  maxArgSize: z.number().int().min(100).default(65536),

  /** Maksimum nested depth */
  maxDepth: z.number().int().min(1).default(10),

  /** Engellenecek regex pattern'leri */
  blockedPatterns: z.array(z.string()).default([
    // Path traversal
    '\\.\\.[\\/\\\\]',
    // Null byte injection (JSON string'inde \\u0000 olarak görünür)
    '(?:\\\\x00|\\\\u0000|\\x00)',
    // Command injection (daha spesifik — shell context'inde olmalı)
    '(?:^|\\s)[;|&](?:\\s|$)',
    // Backtick command substitution
    '`[^`]+`',
    // $(command) substitution
    '\\$\\([^)]+\\)',
    // SQL injection (basic) — (?i) JS'de desteklenmez, 'i' flag zaten ekleniyor
    '(union\\s+select|drop\\s+table|insert\\s+into|delete\\s+from)',
    // XSS (basic)
    '<script[^>]*>',
    // Eval ve benzeri
    '\\beval\\b|\\bFunction\\b|\\bsetTimeout\\b|\\bsetInterval\\b',
  ]),
});

export type DangerousPatternConfig = z.infer<typeof DangerousPatternSchema>;

// ============================================================
// Concurrency Limiter
// ============================================================

/**
 * Semaphore-based concurrency limiter.
 * maxConcurrentCalls ayarını uygular.
 */
export class ConcurrencyLimiter {
  private running = 0;
  private queue: Array<() => void> = [];
  private maxConcurrent: number;

  constructor(maxConcurrent: number = 5) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Bir slot al. Slot doluysa promise ile bekler.
   */
  async acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  /**
   * Slot'u serbest bırak ve sıradaki bekleyeni çalıştır.
   */
  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }

  /**
   * Mevcut çalışan sayısını döndürür.
   */
  get currentRunning(): number {
    return this.running;
  }

  /**
   * Sırada bekleyen sayısını döndürür.
   */
  get queueLength(): number {
    return this.queue.length;
  }

  /**
   * Sıfırla.
   */
  reset(): void {
    this.running = 0;
    // Sıradaki tüm bekleyenleri resolve et
    while (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

// ============================================================
// Rate Limiter
// ============================================================

/**
 * Basit sliding window rate limiter.
 */
export class RateLimiter {
  private calls: Map<string, number[]> = new Map();
  private maxCalls: number;
  private windowMs: number;
  private lastCleanup: number;

  constructor(maxCalls: number = 60, windowMs: number = 60000) {
    this.maxCalls = maxCalls;
    this.windowMs = windowMs;
    this.lastCleanup = Date.now();
  }

  /**
   * Rate limit kontrolü yapar.
   * @returns true = izin ver, false = reddet
   */
  check(key: string): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Periyodik cleanup (her 5 dakikada bir)
    if (now - this.lastCleanup > 300000) {
      this.cleanup(now);
      this.lastCleanup = now;
    }

    const calls = this.calls.get(key) ?? [];
    const recentCalls = calls.filter((t) => t > windowStart);

    if (recentCalls.length >= this.maxCalls) {
      logger.warn(`[MCP:security] Rate limit exceeded for ${key} (${recentCalls.length}/${this.maxCalls})`);
      return false;
    }

    recentCalls.push(now);
    this.calls.set(key, recentCalls);
    return true;
  }

  /**
   * Eski call loglarını temizler.
   */
  private cleanup(now: number): void {
    const windowStart = now - this.windowMs;
    for (const [key, timestamps] of this.calls.entries()) {
      const recentCalls = timestamps.filter((t) => t > windowStart);
      if (recentCalls.length === 0) {
        this.calls.delete(key);
      } else {
        this.calls.set(key, recentCalls);
      }
    }
  }

  /**
   * Rate limiter'ı sıfırlar.
   */
  reset(key?: string): void {
    if (key) {
      this.calls.delete(key);
    } else {
      this.calls.clear();
    }
  }
}

// ============================================================
// Output Sanitizer
// ============================================================

/**
 * MCP tool çıktısını sanitize eder.
 * NOT: sensitivePatterns her iterasyonda yeni bir `RegExp` (gi flag'leriyle)
 * örneği oluşturularak kullanılır. Böylece 'g' flag'inin `lastIndex` state'i 
 * tutup sonraki çağrılarda pattern atlamasına (bug) sebep olması engellenir.
 */
export class OutputSanitizer {
  /** Maksimum çıktı boyutu (karakter) */
  private maxOutputLength: number;

  /** Hassas bilgi pattern source'ları (flag'siz) */
  private sensitivePatternSources: string[];

  constructor(maxOutputLength: number = 128000) {
    this.maxOutputLength = maxOutputLength;

    // Pattern'ları source olarak sakla, her sanitize çağrısında yeni RegExp oluşturulacak
    this.sensitivePatternSources = [
      // API keys (generic) — key: value format
      '(?:api[_-]?key|apikey|access[_-]?token)\\s*[:=]\\s*[\'"]?[a-zA-Z0-9_-]{16,}',
      // API keys (sk- prefix for OpenAI-style keys)
      'sk-[a-zA-Z0-9]{20,}',
      // AWS keys
      'AKIA[0-9A-Z]{16}',
      // Private keys
      '-----BEGIN\\s+(?:RSA\\s+)?PRIVATE\\s+KEY-----[\\s\\S]*?-----END\\s+(?:RSA\\s+)?PRIVATE\\s+KEY-----',
      // Passwords in URLs
      ':\\/\\/[^:]+:([^@]+)@',
      // JWT tokens
      'eyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+',
      // Email addresses
      '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}',
      // SSN (US-style)
      '\\b\\d{3}-\\d{2}-\\d{4}\\b',
      // Credit cards (basic regex for common issuers)
      '\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|6(?:011|5[0-9]{2})[0-9]{12}|(?:2131|1800|35\\d{3})\\d{11})\\b',
      // Phone numbers (basic international / US formats)
      '(?:\\+?1[-.\\s]?)?\\(?\\d{3}\\)?[-.\\s]?\\d{3}[-.\\s]?\\d{4}',
    ];
  }

  /**
   * Çıktıyı sanitize eder.
   */
  sanitize(output: string): string {
    let sanitized = output;

    // Her çağrıda yeni regex oluştur — lastIndex sorunu önlenir
    for (const source of this.sensitivePatternSources) {
      const pattern = new RegExp(source, 'gi');
      sanitized = sanitized.replace(pattern, (match) => {
        // URL password kısmını maskele
        if (match.startsWith('://')) {
          return match.replace(/:\/\/[^:]+:([^@]+)@/, '://***:***@');
        }
        return `[REDACTED: ${match.substring(0, 8)}...]`;
      });
    }

    // Çıktıyı kırp
    if (sanitized.length > this.maxOutputLength) {
      sanitized = sanitized.substring(0, this.maxOutputLength) + '\n\n... [Çıktı kırpıldı]';
    }

    return sanitized;
  }
}

// ============================================================
// Tool Call Validator
// ============================================================

/**
 * MCP tool call'larını validate eder.
 */
export class ToolCallValidator {
  private config: DangerousPatternConfig;
  private blockedPatterns: RegExp[];

  constructor(config?: Partial<DangerousPatternConfig>) {
    this.config = DangerousPatternSchema.parse(config ?? {});
    this.blockedPatterns = this.config.blockedPatterns.map((p) => new RegExp(p, 'i'));
  }

  /**
   * Tool call argümanlarını validate eder.
   * @returns { valid: boolean, error?: string }
   */
  validateArgs(toolName: string, args: Record<string, unknown>): { valid: boolean; error?: string } {
    // Boyut kontrolü
    const jsonSize = JSON.stringify(args).length;
    if (jsonSize > this.config.maxArgSize) {
      return {
        valid: false,
        error: `Argüman boyutu çok büyük: ${jsonSize} bytes (max: ${this.config.maxArgSize})`,
      };
    }

    // Depth kontrolü
    const depth = this.calculateDepth(args);
    if (depth > this.config.maxDepth) {
      return {
        valid: false,
        error: `Argüman nesting depth çok yüksek: ${depth} (max: ${this.config.maxDepth})`,
      };
    }

    // Pattern kontrolü
    const jsonString = JSON.stringify(args);
    for (const pattern of this.blockedPatterns) {
      if (pattern.test(jsonString)) {
        return {
          valid: false,
          error: `Tehlikeli pattern tespit edildi: ${pattern.source}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Nested object depth hesaplar (iterative BFS ile stack overflow önlenmiş).
   */
  private calculateDepth(obj: unknown, currentDepth: number = 0): number {
    if (obj === null || typeof obj !== 'object') {
      return currentDepth;
    }

    const MAX_DEPTH = 100;
    const MAX_QUEUE_SIZE = 10000;

    let maxDepth = currentDepth;
    const queue: Array<{ value: unknown; depth: number }> = [{ value: obj, depth: currentDepth }];

    while (queue.length > 0) {
      if (queue.length > MAX_QUEUE_SIZE) {
        logger.warn('[MCP:security] calculateDepth: Large object detected, capping depth');
        return Math.max(maxDepth, MAX_DEPTH);
      }

      const { value, depth } = queue.shift()!;

      if (depth >= MAX_DEPTH) {
        return MAX_DEPTH;
      }

      if (value === null || typeof value !== 'object') {
        continue;
      }

      const children = Array.isArray(value)
        ? value
        : Object.values(value as Record<string, unknown>);

      for (const child of children) {
        queue.push({ value: child, depth: depth + 1 });
        maxDepth = Math.max(maxDepth, depth + 1);
      }
    }

    return maxDepth;
  }
}

// ============================================================
// Security Manager (Singleton)
// ============================================================

/**
 * MCP güvenlik yöneticisi.
 * Rate limiter, output sanitizer, tool call validator ve concurrency limiter içerir.
 */
export class MCPSecurityManager {
  private static instance: MCPSecurityManager | null = null;

  public rateLimiter: RateLimiter;
  public sanitizer: OutputSanitizer;
  public validator: ToolCallValidator;
  public concurrencyLimiter: ConcurrencyLimiter;

  private constructor() {
    this.rateLimiter = new RateLimiter(60, 60000); // 60 calls/minute
    this.sanitizer = new OutputSanitizer(128000);
    this.validator = new ToolCallValidator();
    this.concurrencyLimiter = new ConcurrencyLimiter(5); // max 5 paralel çağrı
  }

  static getInstance(): MCPSecurityManager {
    if (!MCPSecurityManager.instance) {
      MCPSecurityManager.instance = new MCPSecurityManager();
    }
    return MCPSecurityManager.instance;
  }

  static resetInstance(): void {
    if (MCPSecurityManager.instance) {
      MCPSecurityManager.instance.concurrencyLimiter.reset();
    }
    MCPSecurityManager.instance = null;
  }
}
