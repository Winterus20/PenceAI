/**
 * Kurulum sonrası doğrulama — yapılandırma + isteğe bağlı LLM healthCheck.
 * Kullanım: npx tsx scripts/setup-verify.ts [--skip-llm]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConfig } from '../src/gateway/config.js';
import { registerAllProviders, LLMProviderFactory } from '../src/llm/index.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');

async function main(): Promise<void> {
  const skipLlm = process.argv.includes('--skip-llm');
  process.chdir(projectRoot);

  if (!fs.existsSync(path.join(projectRoot, '.env'))) {
    console.error('ERR .env dosyasi bulunamadi');
    process.exit(1);
  }

  const distEntry = path.join(projectRoot, 'dist', 'gateway', 'index.js');
  if (!fs.existsSync(distEntry)) {
    console.warn('WARN dist/gateway/index.js yok — npm run build tamamlanmamis olabilir');
  } else {
    console.log('OK Build ciktisi mevcut');
  }

  const dataDir = path.join(projectRoot, 'data');
  if (!fs.existsSync(dataDir)) {
    console.warn('WARN data/ dizini yok');
  } else {
    console.log('OK data/ dizini mevcut');
  }

  let config;
  try {
    config = getConfig();
    console.log(`OK Yapilandirma yuklendi (provider=${config.defaultLLMProvider}, model=${config.defaultLLMModel})`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`ERR Yapilandirma gecersiz: ${message}`);
    process.exit(1);
  }

  if (skipLlm) {
    console.log('OK Kurulum dogrulamasi tamamlandi (LLM testi atlandi)');
    return;
  }

  registerAllProviders();

  let provider;
  try {
    provider = LLMProviderFactory.create(config.defaultLLMProvider);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`ERR LLM saglayici olusturulamadi: ${message}`);
    console.error('  API anahtarini .env dosyasinda kontrol edin veya --skip-llm ile atlayin');
    process.exit(1);
  }

  process.stdout.write(`  LLM baglantisi test ediliyor (${provider.name})... `);
  const healthy = await provider.healthCheck();
  console.log('');

  if (!healthy) {
    console.error('ERR LLM API yanit vermedi — anahtar, model veya ag baglantisini kontrol edin');
    console.error('  OpenRouter ucretsiz modellerde 429 rate limit olabilir; baska model veya birkac dakika sonra tekrar deneyin');
    process.exit(1);
  }

  console.log(`OK Kurulum basarili — LLM API erisilebilir (${provider.name})`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`ERR Dogrulama basarisiz: ${message}`);
  process.exit(1);
});
