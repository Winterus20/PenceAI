import { FullConfig } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const TEST_DB_PATH = path.resolve(__dirname, '../../data/test-e2e.db');
const TEST_ENV_PATH = path.resolve(__dirname, '../../.env.test');

async function globalSetup(config: FullConfig) {
  console.log('[E2E GlobalSetup] Starting test environment setup...');

  // Test data dizinini oluştur
  const dataDir = path.dirname(TEST_DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Mevcut test DB'sini temizle
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
    console.log('[E2E GlobalSetup] Cleaned existing test database');
  }

  // Mevcut test .env dosyasını temizle
  if (fs.existsSync(TEST_ENV_PATH)) {
    fs.unlinkSync(TEST_ENV_PATH);
    console.log('[E2E GlobalSetup] Cleaned existing test .env file');
  }

  // Test .env dosyası oluştur
  const testEnvContent = `
PORT=3001
HOST=localhost
DB_PATH=${TEST_DB_PATH}
DEFAULT_LLM_PROVIDER=openai
DEFAULT_LLM_MODEL=gpt-4o
ALLOW_SHELL_EXECUTION=false
LOG_LEVEL=error
ENABLE_MCP=true
`;
  fs.writeFileSync(TEST_ENV_PATH, testEnvContent.trim());
  console.log('[E2E GlobalSetup] Created test .env file');

  // Environment variable'ları set et
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = TEST_DB_PATH;
  process.env.PORT = '3001';

  console.log(`[E2E GlobalSetup] Test DB: ${TEST_DB_PATH}`);
  console.log(`[E2E GlobalSetup] Backend will run on port 3001`);
  console.log('[E2E GlobalSetup] Setup complete');
}

export default globalSetup;
