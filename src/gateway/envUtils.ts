import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * Environment variable key format regex
 */
const ENV_KEY_REGEX = /^[A-Z_][A-Z0-9_]*$/;

/**
 * Protected keys — bunlar değiştirilemez
 */
const PROTECTED_KEYS = new Set([
  'PATH', 'HOME', 'USER', 'SHELL', 'NODE_ENV',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GROQ_API_KEY',
  'MISTRAL_API_KEY', 'NVIDIA_API_KEY', 'MINIMAX_API_KEY',
  'GITHUB_TOKEN', 'BRAVE_SEARCH_API_KEY', 'JINA_READER_API_KEY',
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

/**
 * Secure .env dosyası güncelleme — atomic write ile
 */
export async function secureUpdateEnvFile(key: string, value: string): Promise<void> {
  validateEnvKey(key);
  
  const envPath = path.resolve(process.cwd(), '.env');
  
  if (!fs.existsSync(envPath)) {
    throw new Error(`.env file not found at ${envPath}`);
  }
  
  const content = await fs.promises.readFile(envPath, 'utf-8');
  const safeValue = escapeEnvValue(value);
  
  // Safe regex: key zaten validate edildi
  const regex = new RegExp(`^${key}=.*$`, 'm');
  
  let newContent: string;
  if (value === '') {
    newContent = content.replace(regex, '').replace(/\n{2,}/g, '\n');
  } else {
    if (regex.test(content)) {
      newContent = content.replace(regex, `${key}=${safeValue}`);
    } else {
      newContent = content.trimEnd() + `\n${key}=${safeValue}\n`;
    }
  }
  
  // Atomic write: temp dosyaya yaz, sonra rename
  const tempPath = `${envPath}.${uuidv4()}.tmp`;
  await fs.promises.writeFile(tempPath, newContent, 'utf-8');
  await fs.promises.rename(tempPath, envPath);
}

export function getEnvPath(): string {
    // Return path to .env file in project root
    return process.cwd() + '/.env';
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

export function updateEnv(updates: Record<string, string>): boolean {
    const envPath = getEnvPath();
    if (!fs.existsSync(envPath)) return false;

    const content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split('\n');
    const newLines: string[] = [];
    const updatedKeys = new Set<string>();

    for (let line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const splitIndex = trimmed.indexOf('=');
            if (splitIndex > -1) {
                const key = trimmed.substring(0, splitIndex).trim();
                if (key in updates) {
                    // Update value
                    let val = updates[key];
                    // e.g handle quotes if needed or just dump
                    line = `${key}=${val}`;
                    updatedKeys.add(key);
                }
            }
        }
        newLines.push(line);
    }

    // Append any keys that were not found in the existing .env
    for (const [key, val] of Object.entries(updates)) {
        if (!updatedKeys.has(key)) {
            newLines.push(`${key}=${val}`);
        }
    }

    fs.writeFileSync(envPath, newLines.join('\n'));
    return true;
}

