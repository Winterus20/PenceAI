import path from 'path';
import fs from 'fs';

const TEST_DB_PATH = path.resolve(__dirname, '../../data/test-e2e.db');
const TEST_ENV_PATH = path.resolve(__dirname, '../../.env.test');

async function globalTeardown() {
  console.log('[E2E GlobalTeardown] Cleaning up test artifacts...');

  // Test DB'yi sil
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
    console.log('[E2E GlobalTeardown] Deleted test database');
  }

  // Test .env dosyasını sil
  if (fs.existsSync(TEST_ENV_PATH)) {
    fs.unlinkSync(TEST_ENV_PATH);
    console.log('[E2E GlobalTeardown] Deleted test .env file');
  }

  console.log('[E2E GlobalTeardown] Cleanup complete');
}

export default globalTeardown;
