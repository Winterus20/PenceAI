import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

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
    throw new Error(`Geçersiz environment variable key formatu: ${key}`);
  }
  
  if (PROTECTED_KEYS.has(key)) {
    throw new Error(`Protected environment variable değiştirilemez: ${key}`);
  }
}

/**
 * Value escaping
 */
function escapeEnvValue(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
  
  if (value.includes('\n') || value.includes('"') || value.includes('\\')) {
    return `"${escaped}"`;
  }
  
  return value;
}

export async function secureUpdateEnv(updates: Record<string, string>): Promise<void> {
  const envPath = getEnvPath();
  
  if (!fs.existsSync(envPath)) {
    throw new Error(`.env file not found at ${envPath}`);
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
  await fs.promises.rename(tempPath, envPath);
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

