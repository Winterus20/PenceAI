import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as shellQuote from 'shell-quote';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import { z } from 'zod';
import { glob } from 'glob';
import { getConfig } from '../gateway/config.js';
import type { MemoryManager } from '../memory/manager.js';
import { logger } from '../utils/logger.js';
import { SmartSearchEngine } from './search/index.js';
import { createCronTools } from './mcp/tools/cronTools.js';
import { globalEventBus } from '../utils/index.js';

const execAsync = promisify(exec);

/** Shell komutlar için güvenli allowlist */
const SHELL_COMMAND_ALLOWLIST = new Set([
  'ls', 'cat', 'grep', 'find', 'git', 'npm', 'node', 'python', 'python3',
  'echo', 'pwd', 'head', 'tail', 'wc', 'diff', 'sort', 'uniq', 'awk', 'sed',
]);

/** Tehlikeli pattern'ler — kesin engel */
const DANGEROUS_COMMAND_PATTERNS: { pattern: RegExp; desc: string }[] = [
  { pattern: /\brm\s+-rf\s+\/(\s|$|--no-preserve-root)/i, desc: 'rm -rf /' },
  { pattern: /\brm\s+-r\s+\/(\s|$|--no-preserve-root)/i, desc: 'rm -r /' },
  { pattern: /\brm\s+-rf\s+\/\*/i, desc: 'rm -rf /*' },
  { pattern: /\brm\s+-r\s+\/\*/i, desc: 'rm -r /*' },
  { pattern: /\bformat\s+/i, desc: 'format' },
  { pattern: /\bdel\s+\/f\s+\/s\s+\/q/i, desc: 'del /f /s /q' },
  { pattern: /\bdel\s+\/s\s+\/q/i, desc: 'del /s /q' },
  { pattern: /\bmkfs\b/i, desc: 'mkfs' },
  { pattern: /:\s*\(\s*\)\s*\{/i, desc: 'fork bomb' },
  { pattern: /\brd\s+\/s\s+\/q/i, desc: 'rd /s /q' },
  { pattern: /\brmdir\s+\/s\s+\/q/i, desc: 'rmdir /s /q' },
  { pattern: /remove-item\s+-recurse\s+-force\s+c:/i, desc: 'remove-item C:' },
  { pattern: /remove-item\s+-recurse\s+-force\s+\//i, desc: 'remove-item /' },
  { pattern: />\s*\/dev\/sd[a-z]/i, desc: 'disk overwrite' },
  { pattern: /\bdd\s+if=\/dev\//i, desc: 'dd from /dev' },
  { pattern: /\bchmod\s+-r\s+000\s+\//i, desc: 'chmod -r 000 /' },
  { pattern: /\bchmod\s+-R\s+777\s+\//i, desc: 'chmod -R 777 /' },
  { pattern: /\bchown\s+-r\s+/i, desc: 'chown -r' },
  { pattern: /\bshutdown\b/i, desc: 'shutdown' },
  { pattern: /\breboot\b/i, desc: 'reboot' },
  { pattern: /\binit\s+0\b/i, desc: 'init 0' },
  { pattern: /\binit\s+6\b/i, desc: 'init 6' },
  { pattern: /\breg\s+delete\b/i, desc: 'reg delete' },
  { pattern: /\breg\s+add\b/i, desc: 'reg add' },
  { pattern: /\bcurl\s+.*\|\s*(sh|bash|cmd|powershell|pwsh|zsh)\b/i, desc: 'curl | shell' },
  { pattern: /\bwget\s+.*\|\s*(sh|bash|cmd|powershell|pwsh|zsh)\b/i, desc: 'wget | shell' },
  { pattern: /\bchattr\b/i, desc: 'chattr' },
  { pattern: /\biptables\b/i, desc: 'iptables' },
  { pattern: /\bfdisk\b/i, desc: 'fdisk' },
  { pattern: /\bmount\b/i, desc: 'mount' },
  { pattern: /\bumount\b/i, desc: 'umount' },
];

/** Bypass pattern'leri */
const BYPASS_PATTERNS = [
  /\|\s*(sh|bash|cmd|powershell|pwsh|zsh)\b/i,
  /\$\(.*\)/,
  /`[^`]+`/,
  /;\s*(rm|del|rd|format|mkfs|shutdown|reboot|chmod|chown|dd|curl|wget)\b/i,
  /&&\s*(rm|del|rd|format|mkfs|shutdown|reboot|chmod|chown|dd|curl|wget)\b/i,
  /\|\|\s*(rm|del|rd|format|mkfs|shutdown|reboot|chmod|chown|dd|curl|wget)\b/i,
  /\b(cmd|powershell|pwsh)\s+\/c\b/i,
  /\beval\s+/i,
  />\s*\/dev\/sd[a-z]/i,
  /\bsudo\s+rm\b/i,
  /\bsudo\s+chmod\b/i,
  /\bsudo\s+chown\b/i,
  /\bsudo\s+dd\b/i,
];

// ============================================================
// Zod Runtime Validation Schemas
// ============================================================

/**
 * Dosya okuma argümanları için Zod şeması
 */
const ReadFileArgsSchema = z.object({
  path: z.string({
    required_error: '"path" parametresi zorunludur',
    invalid_type_error: '"path" parametresi bir string olmalıdır',
  }).min(1, '"path" parametresi boş olamaz'),
});

/**
 * Dosya yazma argümanları için Zod şeması
 */
const WriteFileArgsSchema = z.object({
  path: z.string({
    required_error: '"path" parametresi zorunludur',
    invalid_type_error: '"path" parametresi bir string olmalıdır',
  }).min(1, '"path" parametresi boş olamaz'),
  content: z.string({
    required_error: '"content" parametresi zorunludur',
    invalid_type_error: '"content" parametresi bir string olmalıdır',
  }),
});

/**
 * Dizin listeleme argümanları için Zod şeması
 */
const ListDirectoryArgsSchema = z.object({
  path: z.string({
    required_error: '"path" parametresi zorunludur',
    invalid_type_error: '"path" parametresi bir string olmalıdır',
  }).min(1, '"path" parametresi boş olamaz'),
});

/**
 * Bellek arama argümanları için Zod şeması
 */
const SearchMemoryArgsSchema = z.object({
  query: z.string({
    required_error: '"query" parametresi zorunludur',
    invalid_type_error: '"query" parametresi bir string olmalıdır',
  }).min(1, '"query" parametresi boş olamaz'),
});

/**
 * Bellek silme argümanları için Zod şeması
 */
const DeleteMemoryArgsSchema = z.object({
  id: z.coerce.number({
    required_error: '"id" parametresi zorunludur',
    invalid_type_error: '"id" parametresi bir sayı olmalıdır',
  }).int('"id" parametresi tam sayı olmalıdır'),
});

/**
 * Belleğe ekleme argümanları için Zod şeması
 */
const SaveMemoryArgsSchema = z.object({
  content: z.string({
    required_error: '"content" parametresi zorunludur',
    invalid_type_error: '"content" parametresi bir string olmalıdır',
  }).min(1, '"content" parametresi boş olamaz'),
  category: z.string().optional().default('preference'),
  importance: z.coerce.number().int().min(1).max(10).optional().default(5),
});

/**
 * Konuşma arama argümanları için Zod şeması
 */
const SearchConversationArgsSchema = z.object({
  query: z.string({
    required_error: '"query" parametresi zorunludur',
    invalid_type_error: '"query" parametresi bir string olmalıdır',
  }).min(1, '"query" parametresi boş olamaz'),
});

/**
 * Web araç argümanları için Zod şeması
 */
const WebToolArgsSchema = z.object({
  url: z.string({
    required_error: '"url" parametresi zorunludur',
    invalid_type_error: '"url" parametresi bir string olmalıdır',
  }).min(1, '"url" parametresi boş olamaz'),
  mode: z.enum(['quick', 'deep'], {
    errorMap: () => ({ message: '"mode" parametresi "quick" veya "deep" olmalıdır' }),
  }).optional().default('quick'),
});

/**
 * Shell komut argümanları için Zod şeması
 */
const ExecuteShellArgsSchema = z.object({
  command: z.string({
    required_error: '"command" parametresi zorunludur',
    invalid_type_error: '"command" parametresi bir string olmalıdır',
  }).min(1, '"command" parametresi boş olamaz'),
  cwd: z.string().optional(),
});

/**
 * Dosya düzenleme argümanları için Zod şeması
 */
const EditFileArgsSchema = z.object({
  path: z.string({
    required_error: '"path" parametresi zorunludur',
    invalid_type_error: '"path" parametresi bir string olmalıdır',
  }).min(1, '"path" parametresi boş olamaz'),
  oldText: z.string({
    required_error: '"oldText" parametresi zorunludur',
    invalid_type_error: '"oldText" parametresi bir string olmalıdır',
  }).min(1, '"oldText" parametresi boş olamaz'),
  newText: z.string({
    required_error: '"newText" parametresi zorunludur',
    invalid_type_error: '"newText" parametresi bir string olmalıdır',
  }),
  replaceAll: z.boolean().optional().default(false),
});

/** Dosya arama için varsayılan maksimum sonuç sayısı */
const DEFAULT_SEARCH_MAX_RESULTS = 50;

/**
 * Dosya arama argümanları için Zod şeması
 */
const SearchFilesArgsSchema = z.object({
  pattern: z.string({
    required_error: '"pattern" parametresi zorunludur',
    invalid_type_error: '"pattern" parametresi bir string olmalıdır',
  }).min(1, '"pattern" parametresi boş olamaz'),
  directory: z.string().optional(),
  maxResults: z.coerce.number().int().min(1).max(200).default(DEFAULT_SEARCH_MAX_RESULTS),
});

/**
 * Dosya ekleme (append) argümanları için Zod şeması
 */
const AppendFileArgsSchema = z.object({
  path: z.string({
    required_error: '"path" parametresi zorunludur',
    invalid_type_error: '"path" parametresi bir string olmalıdır',
  }).min(1, '"path" parametresi boş olamaz'),
  content: z.string({
    required_error: '"content" parametresi zorunludur',
    invalid_type_error: '"content" parametresi bir string olmalıdır',
  }),
});

/**
 * Web arama argümanları için Zod şeması
 */
const WebSearchArgsSchema = z.object({
  query: z.string({
    required_error: '"query" parametresi zorunludur',
    invalid_type_error: '"query" parametresi bir string olmalıdır',
  }).min(1, '"query" parametresi boş olamaz'),
  count: z.coerce.number().int().min(1).max(10).optional().default(5),
  freshness: z.enum(['pd', 'pw', 'pm', 'py']).optional(),
});

/**
 * Zod validation hatasını Türkçe hata mesajına dönüştürür
 */
function formatZodError(error: z.ZodError): string {
  const errors = error.errors.map(err => {
    const field = err.path.join('.') || 'bilinmeyen alan';
    return `${field}: ${err.message}`;
  });
  return `⚠️ Doğrulama hatası: ${errors.join(', ')}`;
}

/**
 * Zod şeması ile argümanları doğrular
 * @returns Doğrulanmış argümanlar veya hata mesajı string'i
 */
function validateArgs<T>(schema: z.ZodSchema<T>, args: Record<string, unknown>): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(args);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: formatZodError(result.error) };
}

export interface ToolExecutor {
    name: string;
    execute(args: Record<string, unknown>, context?: { conversationId?: string }): Promise<string>;
}

/**
 * Hassas dizin işlemleri için kullanıcıdan onay isteyen callback.
 * @returns true = onaylandı, false = reddedildi
 */
export type ConfirmCallback = (info: {
    toolName: string;
    path: string;
    operation: 'write' | 'delete' | 'execute';
    description: string;
}) => Promise<boolean>;

/**
 * Verilen yolun hassas dizin listesinde olup olmadığını kontrol eder.
 */
function isSensitivePath(filePath: string, sensitivePaths: string[]): boolean {
    const resolved = path.resolve(filePath).toLowerCase();
    for (const sp of sensitivePaths) {
        const resolvedSp = path.resolve(sp).toLowerCase();
        if (resolved === resolvedSp || resolved.startsWith(resolvedSp + path.sep.toLowerCase())) {
            return true;
        }
    }
    return false;
}

/**
 * Hassas bir işlem için onay ister. Onay gelmezse hata mesajı döndürür.
 */
async function requireConfirmation(
    confirmCallback: ConfirmCallback | undefined,
    toolName: string,
    targetPath: string,
    operation: 'write' | 'delete' | 'execute',
    description: string,
    sensitivePaths: string[],
): Promise<string | null> {
    if (!confirmCallback) return null;
    if (!isSensitivePath(targetPath, sensitivePaths)) return null;

    const approved = await confirmCallback({ toolName, path: targetPath, operation, description });
    if (!approved) {
        return `⛔ Kullanıcı işlemi reddetti: ${description}`;
    }
    return null; // onaylandı, devam et
}

/**
 * Yerleşik araçları oluşturur ve döndürür.
 */
export function createBuiltinTools(
    memoryManager: MemoryManager,
    confirmCallback?: ConfirmCallback,
    mergeFn?: (oldContent: string, newContent: string) => Promise<string>
): ToolExecutor[] {
    const config = getConfig();
    const sensitivePaths = memoryManager.getSensitivePaths();

    if (!config.fsRootDir) {
        logger.info('[Tools] ℹ️  FS_ROOT_DIR tanımlanmamış — dosya sistemi erişimi kısıtlanmamış.');
    }

    const tools: ToolExecutor[] = [
      ...createCronTools(memoryManager.getDatabase()),
      // --- Dosya Okuma ---
      {
        name: 'readFile',
        async execute(args) {
          // Zod runtime validation
          const validation = validateArgs(ReadFileArgsSchema, args);
          if (!validation.success) return validation.error;
          
          const { path: filePath } = validation.data;
          validatePath(filePath);
          let handle: fs.FileHandle | null = null;
          try {
            const stats = await fs.stat(filePath);
            const MAX_BYTES = 128000;
  
            handle = await fs.open(filePath, 'r');
            const buffer = Buffer.alloc(MAX_BYTES);
            const { bytesRead } = await handle.read(buffer, 0, MAX_BYTES, 0);
            let content = buffer.toString('utf-8', 0, bytesRead);
  
            if (stats.size > MAX_BYTES) {
              content += `\n\n... [Dosya çok büyük, ilk ${MAX_BYTES} byte gösterildi. Toplam boyut: ${stats.size} bytelar]`;
            }
            return content;
          } catch (err: unknown) {
          const error = err instanceof Error ? err : new Error(String(err));
          return `Hata: Dosya okunamadı — ${error.message}`;
          } finally {
            if (handle) {
              try {
                await handle.close();
              } catch (e) {
                // Ignored
              }
            }
          }
        },
      },
  
      // --- Dosya Yazma ---
      {
        name: 'writeFile',
        async execute(args) {
          // Zod runtime validation
          const validation = validateArgs(WriteFileArgsSchema, args);
          if (!validation.success) return validation.error;
          
          const { path: filePath, content } = validation.data;
          validatePath(filePath);
  
          // Hassas dizin onay kontrolü
          const rejection = await requireConfirmation(
            confirmCallback, 'writeFile', filePath, 'write',
            `"${filePath}" dosyasına yazma`, sensitivePaths,
          );
          if (rejection) return rejection;
  
          try {
            // Dizini oluştur
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, content, 'utf-8');
            return `✅ Dosya başarıyla yazıldı: ${filePath}`;
          } catch (err: unknown) {
          const error = err instanceof Error ? err : new Error(String(err));
          return `Hata: Dosya yazılamadı — ${error.message}`;
          }
        },
      },
  
      // --- Dizin Listeleme ---
      {
        name: 'listDirectory',
        async execute(args) {
          // Zod runtime validation
          const validation = validateArgs(ListDirectoryArgsSchema, args);
          if (!validation.success) return validation.error;
          
          const { path: dirPath } = validation.data;
          validatePath(dirPath);
          try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            const lines = entries.map(e => {
              const icon = e.isDirectory() ? '📁' : '📄';
              return `${icon} ${e.name}`;
            });
            return lines.join('\n') || '(Boş dizin)';
          } catch (err: unknown) {
          const error = err instanceof Error ? err : new Error(String(err));
          return `Hata: Dizin listelenemedi — ${error.message}`;
          }
        },
      },
  
      // --- Dosya Düzenleme (Satır Bazlı Replace) ---
      {
        name: 'editFile',
        async execute(args) {
          const validation = validateArgs(EditFileArgsSchema, args);
          if (!validation.success) return validation.error;

          const { path: filePath, oldText, newText, replaceAll } = validation.data;
          validatePath(filePath);

          // Güvenlik: çok kısa oldText ile yanlışlıkla geniş kapsamlı değişiklik yapılmasını engelle
          if (oldText.length < 3) {
            return `⚠️ "oldText" çok kısa (${oldText.length} karakter). En az 3 karakter olmalı — aksi halde dosyada istenmeyen geniş kapsamlı değişiklikler oluşabilir. Daha spesifik bir metin parçası belirtin.`;
          }

          // replaceAll ile çok kısa metin kombinasyonu — ekstra uyarı
          if (replaceAll && oldText.length < 10) {
            return `⚠️ "replaceAll: true" ile ${oldText.length} karakterlik metin çok tehlikeli olabilir. Daha uzun ve spesifik bir metin parçası belirtin veya "replaceAll: false" kullanın.`;
          }

          // Hassas dizin onay kontrolü
          const rejection = await requireConfirmation(
            confirmCallback, 'editFile', filePath, 'write',
            `"${filePath}" dosyasında düzenleme`, sensitivePaths,
          );
          if (rejection) return rejection;

          try {
            const content = await fs.readFile(filePath, 'utf-8');

            if (!content.includes(oldText)) {
              return `⚠️ Belirtilen metin dosyada bulunamadı: "${oldText.substring(0, 100)}${oldText.length > 100 ? '...' : ''}"`;
            }

            const occurrences = content.split(oldText).length - 1;
            if (occurrences > 1 && !replaceAll) {
              return `⚠️ Belirtilen metin dosyada ${occurrences} kez bulundu. Tümünü değiştirmek için "replaceAll: true" kullanın veya daha spesifik bir metin parçası belirtin.`;
            }

            const newContent = replaceAll
              ? content.split(oldText).join(newText)
              : content.replace(oldText, newText);

            await fs.writeFile(filePath, newContent, 'utf-8');
            return `✅ Dosya düzenlendi: ${filePath} (${replaceAll ? occurrences : 1} değişiklik)`;
          } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            return `Hata: Dosya düzenlenemedi — ${error.message}`;
          }
        },
      },

      // --- Dosya Arama (Glob Pattern) ---
      {
        name: 'searchFiles',
        async execute(args) {
          const validation = validateArgs(SearchFilesArgsSchema, args);
          if (!validation.success) return validation.error;

          const { pattern, directory } = validation.data;
          const maxResults = validation.data.maxResults ?? DEFAULT_SEARCH_MAX_RESULTS;
          const searchDir = directory || process.cwd();

          // Her durumda yol doğrulaması yap
          try {
            validatePath(searchDir);
          } catch (e: unknown) {
            const error = e instanceof Error ? e : new Error(String(e));
            return `⛔ Erişim reddedildi: ${error.message}`;
          }

          try {
            const allFiles = glob.sync(pattern, {
              cwd: searchDir,
              nodir: true,
              absolute: true,
              ignore: [
                '**/node_modules/**',
                '**/.git/**',
                '**/dist/**',
                '**/build/**',
                '**/coverage/**',
              ],
            });

            if (allFiles.length === 0) {
              return `"${pattern}" kalıbına uygun dosya bulunamadı (${searchDir}).`;
            }

            // Sonuçları maxResults ile sınırla ve okunabilir formatta göster
            const files = allFiles.slice(0, maxResults);
            const relativeFiles = files.map((f: string) => {
              try {
                return path.relative(searchDir, f) || f;
              } catch {
                return f;
              }
            });

            const result = relativeFiles.map((f: string, i: number) => `${i + 1}. ${f}`).join('\n');

            if (allFiles.length > maxResults) {
              return `🔍 ${allFiles.length} dosya bulundu (ilk ${maxResults} gösteriliyor):\n${result}\n\n... [${allFiles.length - maxResults} dosya daha, "maxResults" değerini artırın]`;
            }

            return `🔍 ${files.length} dosya bulundu:\n${result}`;
          } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            return `Hata: Dosya araması yapılamadı — ${error.message}`;
          }
        },
      },

      // --- Dosya Ekleme (Append) ---
      {
        name: 'appendFile',
        async execute(args) {
          const validation = validateArgs(AppendFileArgsSchema, args);
          if (!validation.success) return validation.error;

          const { path: filePath, content } = validation.data;
          validatePath(filePath);

          // Hassas dizin onay kontrolü
          const rejection = await requireConfirmation(
            confirmCallback, 'appendFile', filePath, 'write',
            `"${filePath}" dosyasına ekleme`, sensitivePaths,
          );
          if (rejection) return rejection;

          try {
            // Dosya varsa sonuna ekle, yoksa oluştur
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.appendFile(filePath, content, 'utf-8');
            return `✅ Dosyaya eklendi: ${filePath}`;
          } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            return `Hata: Dosyaya eklenemedi — ${error.message}`;
          }
        },
      },

      // --- Bellek Arama (Graph-Aware: FTS + Semantik + Bağlamsal) ---
      {
        name: 'searchMemory',
        async execute(args) {
          // Zod runtime validation
          const validation = validateArgs(SearchMemoryArgsSchema, args);
          if (!validation.success) return validation.error;
          
          const { query } = validation.data;
          try {
            const result = await memoryManager.graphAwareSearch(query, 10);
            const combined = [...result.active, ...result.archival];
  
            if (combined.length === 0) {
              return 'Bellekte eşleşen kayıt bulunamadı.';
            }
            return combined.map((r, i) => `${i + 1}. [ID:${r.id}] [${r.category}] ${r.content} (önem: ${r.importance}, erişim: ${r.access_count})`).join('\n');
          } catch (err: unknown) {
          const error = err instanceof Error ? err : new Error(String(err));
          return `Hata: Arama yapılamadı — ${error.message}`;
          }
        },
      },

        // --- Bellek Silme ---
        {
          name: 'deleteMemory',
          async execute(args) {
            // Zod runtime validation
            const validation = validateArgs(DeleteMemoryArgsSchema, args);
            if (!validation.success) return validation.error;
            
            const { id: memoryId } = validation.data;
            try {
              const deleted = memoryManager.deleteMemory(memoryId);
              if (deleted) {
                return `✅ Bellek silindi (ID: ${memoryId})`;
              }
              return `⚠️ Bellek bulunamadı veya erişim reddedildi (ID: ${memoryId})`;
            } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            return `Hata: Bellek silinemedi — ${error.message}`;
            }
          },
        },
    
        // --- Belleğe Ekleme (DENEYSEL) ---
        {
          name: 'saveMemory',
          async execute(args) {
            // Zod runtime validation
            const validation = validateArgs(SaveMemoryArgsSchema, args);
            if (!validation.success) return validation.error;
            
            // Not: Deneysel olarak eklendi, ileride kaldırılabilir.
            const { content, category, importance } = validation.data;
    
            try {
              const result = await memoryManager.addMemory(content, category, importance, mergeFn);
              return `✅ Bilgi başarıyla kaydedildi/birleştirildi (ID: ${result.id})${result.isUpdate ? ' [Mevcut bilgi güncellendi]' : ''}`;
            } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            return `Hata: Bilgi kaydedilemedi — ${error.message}`;
            }
          },
        },
    
        // --- Konuşma Geçmişinde Arama (Hibrit: FTS + Semantik) ---
        {
          name: 'searchConversation',
          async execute(args) {
            // Zod runtime validation
            const validation = validateArgs(SearchConversationArgsSchema, args);
            if (!validation.success) return validation.error;
            
            const { query } = validation.data;
            try {
              const results = await memoryManager.hybridSearchMessages(query, 20);
              if (results.length === 0) {
                return 'Geçmiş konuşmalarda eşleşen mesaj bulunamadı.';
              }
              return results.map((r, i) => {
                const dateStr = typeof r.created_at === 'string' && !r.created_at.endsWith('Z') ? r.created_at.replace(' ', 'T') + 'Z' : r.created_at;
                const time = new Date(dateStr).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
                const role = r.role === 'user' ? '👤' : '🤖';
                const content = r.content.length > 200 ? r.content.substring(0, 200) + '...' : r.content;
                const sim = r.similarity > 0 ? ` [benzerlik: ${(r.similarity * 100).toFixed(0)}%]` : '';
                const title = r.conversation_title ? ` "${r.conversation_title}"` : '';
                return `${i + 1}. ${role} [${time}]${sim} (conv:${r.conversation_id.substring(0, 8)}${title})\n ${content}`;
              }).join('\n\n');
            } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            return `Hata: Konuşma araması yapılamadı — ${error.message}`;
            }
          },
        },
    
        // --- Web Okuyucu (Quick & Deep Scan) ---
        {
          name: 'webTool',
          async execute(args) {
            // Zod runtime validation
            const validation = validateArgs(WebToolArgsSchema, args);
            if (!validation.success) return validation.error;
            
            const { url, mode } = validation.data;

                try {
                    if (mode === 'deep') {
                        // Jina Reader API Fallback
                        const jinaKey = config.jinaReaderApiKey;
                        const headers: Record<string, string> = {
                            'Accept': 'text/markdown',
                        };
                        if (jinaKey) {
                            headers['Authorization'] = `Bearer ${jinaKey}`;
                        }
                        const response = await fetch(`https://r.jina.ai/${url}`, { headers });
                        if (!response.ok) {
                            return `Hata: Jina Reader API başarısız oldu — ${response.status} ${response.statusText}`;
                        }
                        const text = await response.text();
                        return text || 'Sayfadan içerik alınamadı.';
                    } else {
                        // Quick Mode: Yerel Fetch + Readability
                        const response = await fetch(url, {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                            }
                        });
                        if (!response.ok) {
                            return `Hata: Web sayfası yüklenemedi — ${response.status} ${response.statusText}`;
                        }
                        
                        const contentType = response.headers.get('content-type') || '';
                        if (!contentType.includes('text/html')) {
                            return `Hata: Bu URL bir HTML sayfası değil (${contentType}). PDF, resim veya raw data olabilir.`;
                        }

                        let html = await response.text();

                        // Event handler attribute'larını strip et (XSS önlemi)
                        html = html.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, ' ');
                        html = html.replace(/\s+on\w+\s*=\s*[^\s>]+/gi, ' ');

                        // linkedom ile DOM ağacını kur (çok hafif ve hızlı)
                        const { document } = parseHTML(html);

                        // JS tabanlı gereksiz elementleri parse öncesi temizlemek performansı artırabilir
                        const scripts = document.querySelectorAll('script');
                        const styles = document.querySelectorAll('style');
                        scripts.forEach((s: unknown) => { if (s && typeof (s as { remove?: () => void }).remove === 'function') (s as { remove: () => void }).remove(); });
                        styles.forEach((s: unknown) => { if (s && typeof (s as { remove?: () => void }).remove === 'function') (s as { remove: () => void }).remove(); });

                        const reader = new Readability(document);
                        const article = reader.parse();

                        if (!article || !article.content) {
                            return 'Hata: Sayfadan anlamlı bir makale veya içerik çıkarılamadı (belki de JS ile render oluyordur, "deep" modunu deneyin).';
                        }

                        const turndownService = new TurndownService({
                            headingStyle: 'atx',
                            codeBlockStyle: 'fenced'
                        });
                        const markdown = turndownService.turndown(article.content);

                        let finalContent = `# ${article.title}\\n\\n${markdown}`;
                        
                        // Token limitlerini korumak için çok uzun içerikleri kırp (yaklaşık 10-15 bin token)
                        if (finalContent.length > 60000) {
                            finalContent = finalContent.substring(0, 60000) + '\\n\\n... [İçerik çok uzun olduğu için güvenlik amacıyla kırpıldı]';
                        }
                        return finalContent;
                    }
                } catch (err: unknown) {
                const error = err instanceof Error ? err : new Error(String(err));
                return `Hata: webTool çalıştırılamadı — ${error.message}`;
                }
            }
        },
    ];

    // --- Kabuk Komutu ---
    if (config.allowShellExecution) {
      tools.push({
        name: 'executeShell',
        async execute(args) {
          // Zod runtime validation
          const validation = validateArgs(ExecuteShellArgsSchema, args);
          if (!validation.success) return validation.error;

          const { command, cwd } = validation.data;

          // Hassas dizin onay kontrolü (cwd + komut içindeki yollar)
          // 1) cwd kontrolü
          const checkPath = cwd || process.cwd();
          const cwdRejection = await requireConfirmation(
            confirmCallback, 'executeShell', checkPath, 'execute',
            `"${command}" komutu (dizin: ${checkPath})`, sensitivePaths,
          );
          if (cwdRejection) return cwdRejection;

          // 2) Komut içindeki yolları tara — tırnaklı ve tırnaksız yollar
          const extractedPaths = extractPathsFromCommand(command);
          for (const ep of extractedPaths) {
            const pathRejection = await requireConfirmation(
              confirmCallback, 'executeShell', ep, 'execute',
              `"${command}" komutu (hedef: ${ep})`, sensitivePaths,
            );
            if (pathRejection) return pathRejection;
          }

          // Güvenlik kontrolü — tehlikeli komutları engelle
          const normalized = command.toLowerCase().replace(/\s+/g, ' ').trim();
          for (const { pattern, desc } of DANGEROUS_COMMAND_PATTERNS) {
            if (pattern.test(normalized)) {
              return `⛔ Güvenlik: Bu komut tehlikeli olarak işaretlenmiş ve engellendi (${desc}): ${command}`;
            }
          }

          for (const pattern of BYPASS_PATTERNS) {
            if (pattern.test(command)) {
              return `⛔ Güvenlik: Tehlikeli komut kalıbı tespit edildi ve engellendi: ${command}`;
            }
          }

          // Allowlist kontrolü — base komut listede olmalı
          const baseCmd = normalized.split(/\s+/)[0];
          if (!baseCmd || !SHELL_COMMAND_ALLOWLIST.has(baseCmd)) {
            return `⛔ Güvenlik: "${baseCmd || 'Bilinmeyen'}" komutu allowlist'te yok. İzin verilen komutlar: ${Array.from(SHELL_COMMAND_ALLOWLIST).join(', ')}`;
          }

          // cwd parametresi güvenlik kontrolü
          if (cwd) {
            try {
              validatePath(cwd);
            } catch (e: unknown) {
              const error = e instanceof Error ? e : new Error(String(e));
              return `⛔ Güvenlik: cwd parametresi geçersiz — ${error.message}`;
            }
          }

          try {
            const shellTimeout = Math.min(Math.max(config.shellTimeout, 5000), 300000);
            const escapedCommand = shellQuote.quote([command]);
            const { stdout, stderr } = await execAsync(escapedCommand, {
              cwd: cwd || process.cwd(),
              timeout: shellTimeout,
              maxBuffer: 1024 * 1024, // 1MB
            });

            let result = '';
            if (stdout) result += stdout;
            if (stderr) result += `\n[stderr]: ${stderr}`;

            // Çıktıyı kırp
            if (result.length > 128000) {
              result = result.substring(0, 128000) + '\n... [Çıktı kırpıldı]';
            }

            return result || '(Komut çıktı üretmedi)';
          } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            return `Hata: Komut çalıştırılamadı — ${error.message}`;
          }
        },
      });
    }

    // --- prompt_human: Agent proaktif kullanıcıya soru sorar ---
    tools.push({
        name: 'prompt_human',
        async execute(args, context) {
            const question = String(args.question ?? '');
            const conversationId = context?.conversationId || '';

            if (!question) {
                return 'Hata: "question" alanı zorunludur.';
            }

            return new Promise<string>((resolve) => {
                const promptId = `ph_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                const timeoutMs = 300000; // 5 dakika

                const cleanup = () => {
                    globalEventBus.removeListener('prompt_human_response', handler);
                    if (timeoutRef) clearTimeout(timeoutRef);
                };

                const handler = (data: { promptId: string; answer: string }) => {
                    if (data.promptId === promptId) {
                        cleanup();
                        resolve(data.answer || '(Kullanıcı yanıt vermedi)');
                    }
                };

                globalEventBus.on('prompt_human_response', handler);

                // WebSocket üzerinden kullanıcıya soru gönder
                globalEventBus.emit('prompt_human_request', {
                    promptId,
                    conversationId,
                    question,
                });

                // Timeout — 5 dk sonra boş yanıt
                const timeoutRef = setTimeout(() => {
                    cleanup();
                    resolve('(Zaman aşımı — kullanıcı yanıt vermedi)');
                }, timeoutMs);
            });
        },
    });

    // --- Web Arama (Smart Search: Brave + DuckDuckGo + Wikipedia + HN + Reddit) ---
    tools.push({
        name: 'webSearch',
        async execute(args) {
            const validation = validateArgs(WebSearchArgsSchema, args);
            if (!validation.success) return validation.error;

            const { query, freshness } = validation.data;
            const count = validation.data.count ?? 5;

            try {
                const searchEngine = new SmartSearchEngine({
                    braveApiKey: config.braveSearchApiKey,
                });

                const result = await searchEngine.search(query, {
                    count: Math.min(count, 10),
                    freshness,
                });

                if (result.results.length === 0) {
                    return `"${query}" için sonuç bulunamadı.`;
                }

                const sourceInfo = result.sources.length > 0
                    ? ` [Kaynaklar: ${result.sources.join(', ')}${result.intent !== 'general' ? ` | Niyet: ${result.intent}` : ''}]`
                    : '';

                return `🔍 "${query}" için ${result.results.length} sonuç${sourceInfo}:\n\n${result.formatted}`;
            } catch (err: unknown) {
                return `Hata: Web araması yapılamadı — ${err instanceof Error ? err.message : String(err)}`;
            }
        },
    });

    return tools;
}

/**
 * Komut stringinden olası dosya/dizin yollarını çıkarır.
 * Tırnaklı ("C:\Program Files\...") ve tırnaksız yollar desteklenir.
 */
function extractPathsFromCommand(command: string): string[] {
    const paths: string[] = [];

    // 1) Çift tırnaklı yollar: "C:\some path\..."
    const doubleQuoted = command.matchAll(/"([^"]+)"/g);
    for (const m of doubleQuoted) {
        if (m[1] && looksLikePath(m[1])) paths.push(m[1]);
    }

    // 2) Tek tırnaklı yollar: 'C:\some path\...'
    const singleQuoted = command.matchAll(/'([^']+)'/g);
    for (const m of singleQuoted) {
        if (m[1] && looksLikePath(m[1])) paths.push(m[1]);
    }

    // 3) Tırnaksız yollar — boşluklarla veya "=" işaretiyle ayrılmış tokenlardan çıkar
    //    Windows: C:\... veya \\... 
    //    Linux: /home/... /usr/...
    //    Flags: --config=C:\... vb. durumları yakalamak için "=" de dahil edilir.
    const tokens = command.split(/[\s=]+/);
    for (const token of tokens) {
        const clean = token.replace(/^["']|["']$/g, '');
        if (looksLikePath(clean) && !paths.includes(clean)) {
            paths.push(clean);
        }
    }

    return paths;
}

/**
 * Bir stringin dosya yoluna benzeyip benzemediğini kontrol eder.
 */
function looksLikePath(s: string): boolean {
    if (!s || s.length < 3) return false;
    // Windows mutlak yol: C:\..., D:\...
    if (/^[A-Za-z]:[\\/]/.test(s)) return true;
    // Windows UNC: \\server\...
    if (s.startsWith('\\\\')) return true;
    // Unix mutlak yol: /home/..., /usr/...
    if (s.startsWith('/') && !s.startsWith('//')) return true;
    return false;
}

/**
 * Dosya yolu güvenlik kontrolü.
 * Symlink bypass'larını önlemek için fs.realpathSync kullanır.
 */
function validatePath(filePath: string): void {
    const config = getConfig();

    // Symlink bypass önlemi: realpathSync ile hedefi çöz
    let resolved: string;
    try {
        resolved = fsSync.realpathSync(path.resolve(filePath));
    } catch {
        // realpathSync başarısız olursa (dosya yok veya erişim yok) path.resolve'a düş
        resolved = path.resolve(filePath);
    }

    const root = path.resolve(config.fsRootDir || process.cwd());
    if (!resolved.toLowerCase().startsWith(root.toLowerCase())) {
        throw new Error(`Erişim reddedildi: ${filePath} — İzin verilen kök dizin: ${root}`);
    }

    // Tehlikeli yolları engelle (segment-bazlı eşleşme #7)
    const blockedAbsolute = [
        '/etc/shadow', '/etc/passwd', '/etc/sudoers', '/etc/hosts',
        'C:\\Windows\\System32\\config', 'C:\\Windows\\System32\\drivers\\etc',
    ];
    const blockedSegments = [
        '.env', '.ssh', 'id_rsa', 'id_ed25519', 'id_ecdsa',
        '.aws', '.npmrc', '.netrc', '.pgpass',
    ];
    const resolvedPath = resolved.toLowerCase();
    for (const b of blockedAbsolute) {
        if (resolvedPath.startsWith(b.toLowerCase())) {
            throw new Error(`Erişim reddedildi: Sistem dosyası korumalıdır`);
        }
    }
    // Yol segmentlerini kontrol et — tam segment eşleşmesi (.env ≠ .environment)
    const segments = resolved.replace(/\\/g, '/').split('/');
    for (const seg of segments) {
        const segLower = seg.toLowerCase();
        for (const b of blockedSegments) {
            if (segLower === b.toLowerCase()) {
                throw new Error(`Erişim reddedildi: Sistem dosyası korumalıdır`);
            }
        }
        // .aws/credentials gibi alt dosya kontrolü
        if (segLower === 'credentials' && segments.some(s => s.toLowerCase() === '.aws')) {
            throw new Error(`Erişim reddedildi: Sistem dosyası korumalıdır`);
        }
    }
}
