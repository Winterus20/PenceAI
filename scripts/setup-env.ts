/**
 * Kurulum sihirbazı — .env güncellemeleri (secureUpdateEnv).
 * Kullanım: npx tsx scripts/setup-env.ts --file /path/to/updates.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { secureUpdateEnv } from '../src/gateway/envUtils.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');

function parseArgs(argv: string[]): Record<string, string> {
  const updates: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--file' && argv[i + 1]) {
      const filePath = path.resolve(argv[++i]!);
      const raw = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '').trim();
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('JSON dosyasi bir nesne olmali (key -> value)');
      }
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value !== 'string') {
          throw new Error(`Gecersiz deger turu: ${key}`);
        }
        updates[key] = value;
      }
      continue;
    }
    if (arg === '--set' && argv[i + 1]) {
      const pair = argv[++i]!;
      const eq = pair.indexOf('=');
      if (eq <= 0) {
        throw new Error(`Gecersiz --set formati (KEY=value bekleniyor): ${pair}`);
      }
      updates[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
  }
  return updates;
}

async function main(): Promise<void> {
  const updates = parseArgs(process.argv.slice(2));
  if (Object.keys(updates).length === 0) {
    console.error('Kullanim: npx tsx scripts/setup-env.ts --file updates.json');
    console.error('   veya: npx tsx scripts/setup-env.ts --set KEY=value [--set KEY2=value2]');
    process.exit(1);
  }

  process.chdir(projectRoot);

  const envPath = path.join(projectRoot, '.env');
  if (!fs.existsSync(envPath)) {
    console.error(`.env bulunamadi: ${envPath}`);
    process.exit(1);
  }

  await secureUpdateEnv(updates);
  const keys = Object.keys(updates).join(', ');
  console.log(`OK .env guncellendi (${keys})`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`ERR .env guncellenemedi: ${message}`);
  process.exit(1);
});
