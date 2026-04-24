import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { ValidationError } from '../errors/ValidationError.js';

/**
 * Environment variable key format regex
 */
const ENV_KEY_REGEX = /^[A-Z_][A-Z0-9_]*$/;

/**
 * Protected keys — bunlar değiştirilemez (sistem değişkenleri)
 * API key'leri kullanıcı tarafından UI'dan güncellenebilir olmalı
 */
const PROTECTED_KEYS = new Set([
  'PATH', 'HOME', 'USER', 'SHELL', 'NODE_ENV',
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
  const envPath = getEnvPath();

  if (!fs.existsSync(envPath)) {
    throw new ValidationError(`.env file not found at ${envPath}`);
  }

  let content = await fs.promises.readFile(envPath, 'utf-8');

  for (const [key, value] of Object.entries(updates)) {
    validateEnvKey(key);
    const safeValue = escapeEnvValue(value);
    const regex = new RegExp(`^${key}=.*$`, 'm');

    if (value === '') {
      content = content.replace(regex, '').replace(/\n{2,}/g, '\n');
    } else {
      if (regex.test(content)) {
        content = content.replace(regex, `${key}=${safeValue}`);
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
  } catch (err: any) {
      // Windows'ta rename() EPERM verebilir, fallback kullan
      if (err.code === 'EPERM' || err.code === 'EBUSY') {
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
                }
                env[key] = value;
            }
        }
    }
    return env;
}
