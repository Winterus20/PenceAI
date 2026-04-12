import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import { z } from 'zod';
import { getConfig } from '../gateway/config.js';
import { MemoryManager } from '../memory/manager.js';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

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
 * Web arama argümanları için Zod şeması
 */
const WebSearchArgsSchema = z.object({
  query: z.string({
    required_error: '"query" parametresi zorunludur',
    invalid_type_error: '"query" parametresi bir string olmalıdır',
  }).min(1, '"query" parametresi boş olamaz'),
  count: z.coerce.number().int().min(1).max(10).optional().default(5),
  freshness: z.string().optional(),
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
    execute(args: Record<string, unknown>): Promise<string>;
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

                        const html = await response.text();

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
                const dangerous = [
                    'rm -rf /', 'rm -r /', 'rm -rf /*', 'rm -r /*',
                    'format ', 'del /f /s /q', 'del /s /q',
                    'mkfs', ':(){', 'fork bomb',
                    'rd /s /q', 'rmdir /s /q',
                    'remove-item -recurse -force c:',
                    'remove-item -recurse -force /',
                    '> /dev/sda', 'dd if=/dev/',
                    'chmod -r 000 /', 'chown -r ',
                    'shutdown', 'reboot', 'init 0', 'init 6',
                    'reg delete', 'reg add',
                    // wget ve curl kaldırıldı — legit kullanımlar var, pipe-to-shell dangerousPatterns ile yakalanıyor
                ];
                const normalized = command.toLowerCase().replace(/\s+/g, ' ').trim();
                for (const d of dangerous) {
                    if (normalized.includes(d.toLowerCase())) {
                        return `⛔ Güvenlik: Bu komut tehlikeli olarak işaretlenmiş ve engellendi: ${command}`;
                    }
                }

                // Gelişmiş bypass kontrolleri
                const dangerousPatterns = [
                    /\|\s*(sh|bash|cmd|powershell|pwsh|zsh)\b/i,    // pipe ile kabuk çağrısı
                    /\$\(.*\)/,                                       // $(...) subshell
                    /`[^`]+`/,                                        // backtick command substitution
                    /;\s*(rm|del|rd|format|mkfs|shutdown|reboot)\b/i, // chain ile tehlikeli komut
                    /&&\s*(rm|del|rd|format|mkfs|shutdown|reboot)\b/i,// && ile tehlikeli komut
                    /\|\|\s*(rm|del|rd|format|mkfs|shutdown|reboot)\b/i,// || ile tehlikeli komut
                    /\b(cmd|powershell|pwsh)\s+\/c\b/i,              // cmd /c bypass
                    /\beval\s+/i,                                     // eval komutu
                    />\s*\/dev\/sd[a-z]/i,                            // disk yazma
                    /\bsudo\s+rm\b/i,                                 // sudo rm
                ];
                for (const pattern of dangerousPatterns) {
                    if (pattern.test(command)) {
                        return `⛔ Güvenlik: Tehlikeli komut kalıbı tespit edildi ve engellendi: ${command}`;
                    }
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
                    const { stdout, stderr } = await execAsync(command, {
                        cwd: cwd || process.cwd(),
                        timeout: 30000, // 30 saniye zaman aşımı
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

    // --- Web Arama (Brave Search) ---
    if (config.braveSearchApiKey) {
      tools.push({
        name: 'webSearch',
        async execute(args) {
          // Zod runtime validation
          const validation = validateArgs(WebSearchArgsSchema, args);
          if (!validation.success) return validation.error;
          
          const { query, freshness } = validation.data;
          const count = validation.data.count ?? 5;
          const safeCount = Math.min(count, 10);
  
          try {
            const params = new URLSearchParams({
              q: query,
              count: String(safeCount),
              search_lang: 'tr',
            });
            if (freshness) params.set('freshness', freshness);

                    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
                        headers: {
                            'Accept': 'application/json',
                            'Accept-Encoding': 'gzip',
                            'X-Subscription-Token': config.braveSearchApiKey!,
                        },
                    });

                    if (!response.ok) {
                        return `Hata: Brave Search API ${response.status} — ${response.statusText}`;
                    }

                    // Brave Search API response Zod schema
                    const BraveSearchResult = z.object({
                        web: z.object({
                            results: z.array(z.object({
                                title: z.string(),
                                url: z.string(),
                                description: z.string().optional(),
                                age: z.string().optional(),
                            })).optional(),
                        }).optional(),
                    });

                    const raw = await response.json();
                    const data = BraveSearchResult.safeParse(raw);
                    if (!data.success) {
                        return 'Hata: Brave Search API yanıtı parse edilemedi';
                    }

                    const results = data.data?.web?.results;

                    if (!results || results.length === 0) {
                        return `"${query}" için sonuç bulunamadı.`;
                    }

                    const formatted = results.map((r, i: number) => {
                        let entry = `${i + 1}. **${r.title}**\n   ${r.url}`;
                        if (r.description) entry += `\n   ${r.description}`;
                        if (r.age) entry += ` (${r.age})`;
                        return entry;
                    }).join('\n\n');

                    return `🔍 "${query}" için ${results.length} sonuç:\n\n${formatted}`;
                } catch (err: unknown) {
                    return `Hata: Web araması yapılamadı — ${err instanceof Error ? err.message : String(err)}`;
                }
            },
        });
    }

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
        if (looksLikePath(m[1])) paths.push(m[1]);
    }

    // 2) Tek tırnaklı yollar: 'C:\some path\...'
    const singleQuoted = command.matchAll(/'([^']+)'/g);
    for (const m of singleQuoted) {
        if (looksLikePath(m[1])) paths.push(m[1]);
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
    if (/^[A-Za-z]:[\\\/]/.test(s)) return true;
    // Windows UNC: \\server\...
    if (s.startsWith('\\\\')) return true;
    // Unix mutlak yol: /home/..., /usr/...
    if (s.startsWith('/') && !s.startsWith('//')) return true;
    return false;
}

/**
 * Dosya yolu güvenlik kontrolü.
 */
function validatePath(filePath: string): void {
    const config = getConfig();

    if (config.fsRootDir) {
        const resolved = path.resolve(filePath);
        const root = path.resolve(config.fsRootDir);
        if (!resolved.startsWith(root)) {
            throw new Error(`Erişim reddedildi: ${filePath} — İzin verilen kök dizin: ${config.fsRootDir}`);
        }
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
    const resolvedPath = path.resolve(filePath).toLowerCase();
    for (const b of blockedAbsolute) {
        if (resolvedPath.startsWith(b.toLowerCase())) {
            throw new Error(`Erişim reddedildi: Sistem dosyası korumalıdır`);
        }
    }
    // Yol segmentlerini kontrol et — tam segment eşleşmesi (.env ≠ .environment)
    const segments = filePath.replace(/\\/g, '/').split('/');
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
