import fs from 'fs';
import os from 'os';
import path from 'path';
import { secureUpdateEnv, readEnv } from '../../src/gateway/envUtils.js';

describe('setup-env integration', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'penceai-setup-env-'));
    process.chdir(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.env'),
      'OPENAI_API_KEY=\nDEFAULT_LLM_PROVIDER=openai\nDEFAULT_LLM_MODEL=gpt-4o\n',
      'utf-8',
    );
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('secureUpdateEnv updates keys used by setup wizard', async () => {
    await secureUpdateEnv({
      OPENROUTER_API_KEY: 'sk-test-key',
      DEFAULT_LLM_PROVIDER: 'openrouter',
      DEFAULT_LLM_MODEL: 'openai/gpt-4o-mini',
    });

    const env = readEnv();
    expect(env.OPENROUTER_API_KEY).toBe('sk-test-key');
    expect(env.DEFAULT_LLM_PROVIDER).toBe('openrouter');
    expect(env.DEFAULT_LLM_MODEL).toBe('openai/gpt-4o-mini');
  });
});
