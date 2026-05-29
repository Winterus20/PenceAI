import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { ValidationError } from '../errors/ValidationError.js';

/**
 * Environment variable key format regex
 */
const ENV_KEY_REGEX = /^[A-Z_][A-Z0-9_]*$/;

/** .env dosyası yazma mutex'i — eşzamanlı yazma çakışmalarını önler */
let envWriteMutex: Promise<void> = Promise.resolve();

function acquireEnvMutex(): Promise<() => void> {
  let releaseFn: () => void;
  const acquired = new Promise<void>(resolve => { releaseFn = resolve; });
  const chain = envWriteMutex.then(() => releaseFn!);
  envWriteMutex = envWriteMutex.then(() => acquired);
  return chain;
}

/**
 * Protected keys — bunlar değiştirilemez (sistem değişkenleri)
 * API key'leri kullanıcı tarafından UI'dan güncellenebilir olmalı
 */
const PROTECTED_KEYS = new Set([
  'PATH', 'HOME', 'USER', 'SHELL', 'NODE_ENV', 'PORT', 'HOST',
  'COMPUTERNAME', 'USERNAME', 'SystemRoot', 'windir', 'TEMP', 'TMP',
]);

/**
 * Key validation
 */
function validateEnvKey(key: string): void {
  if (!ENV_KEY_REGEX.test(key)) {
    throw new ValidationError(`Geçersiz environment variable key formatu: ${key}`);
  }

  if (PROTECTED_KEYS.has(key)) {
    throw new ValidationError(`Protected environment variable değiştirilemez: ${key}`);
  }
}

/**
 * Value escaping — prevents shell injection and comment injection in .env files.
 * Always quotes values that contain special characters.
 */
function escapeEnvValue(value: string): string {
  const needsQuote = /[\s"'\\#$&|<>;`]/.test(value);
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');

  if (needsQuote || value.includes('\n') || value.includes('"') || value.includes("'") || value.includes('\\') || value.includes('#')) {
    return `"${escaped}"`;
  }

  return value;
}

export async function secureUpdateEnv(updates: Record<string, string>): Promise<void> {
  // Eşzamanlı yazma çakışmalarını önlemek için mutex
  const release = await acquireEnvMutex();
  try {
    await _secureUpdateEnvInner(updates);
  } finally {
    release();
  }
}

async function _secureUpdateEnvInner(updates: Record<string, string>): Promise<void> {
  const envPath = getEnvPath();

  if (!fs.existsSync(envPath)) {
    throw new ValidationError(`.env file not found at ${envPath}`);
  }

  let content = await fs.promises.readFile(envPath, 'utf-8');

  for (const [key, value] of Object.entries(updates)) {
    validateEnvKey(key);
    const safeValue = escapeEnvValue(value);

    if (value === '') {
      // Satır bazlı silme — regex yerine string matching (ReDoS güvenli)
      const lines = content.split('\n');
      content = lines.filter(line => !line.startsWith(`${key}=`)).join('\n').replace(/\n{2,}/g, '\n');
    } else {
      // Satır bazlı güncelleme
      const lines = content.split('\n');
      let found = false;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.startsWith(`${key}=`)) {
          lines[i] = `${key}=${safeValue}`;
          found = true;
          break;
        }
      }
      if (found) {
        content = lines.join('\n');
      } else {
        content = content.trimEnd() + `\n${key}=${safeValue}\n`;
      }
    }
  }

  // Atomic write: temp dosyaya yaz, sonra rename
  const tempPath = `${envPath}.${uuidv4()}.tmp`;
  await fs.promises.writeFile(tempPath, content, 'utf-8');
  try {
      await fs.promises.rename(tempPath, envPath);
  } catch (err: unknown) {
      // Windows'ta rename() EPERM verebilir, fallback kullan
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'EPERM' || nodeErr.code === 'EBUSY') {
          await fs.promises.copyFile(tempPath, envPath);
          await fs.promises.unlink(tempPath).catch((e) => {
              // Temp dosya silinemezse kritik değil — OS tarafından temizlenecek
              logger.debug({ tempPath, err: e instanceof Error ? e.message : e }, '[envUtils] Failed to delete temp file, will be cleaned by OS');
          });
      } else {
          throw err;
      }
  }
}

/**
 * Secure .env dosyası güncelleme — atomic write ile
 */
export async function secureUpdateEnvFile(key: string, value: string): Promise<void> {
  await secureUpdateEnv({ [key]: value });
}

export function getEnvPath(): string {
    // Return path to .env file in project root
    return path.resolve(process.cwd(), '.env');
}

export function readEnv(): Record<string, string> {
    const envPath = getEnvPath();
    if (!fs.existsSync(envPath)) return {};

    const content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split('\n');
    const env: Record<string, string> = {};

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const splitIndex = trimmed.indexOf('=');
            if (splitIndex > -1) {
                const key = trimmed.substring(0, splitIndex).trim();
                let value = trimmed.substring(splitIndex + 1).trim();
                // Remove surrounding quotes if any
                if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.substring(1, value.length - 1);
                    // Escape sequence'leri geri çöz (escapeEnvValue ile simetri)
                    value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\\\/g, '\\');
                }
                env[key] = value;
            }
        }
    }
    return env;
}
