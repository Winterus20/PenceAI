import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

// CLI testleri gerçek alt process çalıştırır — timeout 30sn
const CLI_TIMEOUT_MS = 30000;
const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

describe('CLI maintenance commands', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'penceai-cli-test-'));

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('memory:lint --dry-run exits with code 0', () => {
    const result = execSync(
      `node --experimental-specifier-resolution=node ${path.join(PROJECT_ROOT, 'src/cli/maintenance.ts')} memory:lint --dry-run`,
      {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DB_PATH: ':memory:',
          ENABLE_MEMORY_LINT: 'true',
          LINT_LLM_VALIDATION_ENABLED: 'false',
          DEFAULT_LLM_PROVIDER: 'openai',
          OPENAI_API_KEY: 'sk-test-openai-key',
        },
        timeout: CLI_TIMEOUT_MS,
      }
    );
    expect(result).toContain('Memory Lint Pass Result');
  });

  it('memory:export-md creates a markdown file', () => {
    const outFile = path.join(tmpDir, 'export-md-test.md');
    const result = execSync(
      `node --experimental-specifier-resolution=node ${path.join(PROJECT_ROOT, 'src/cli/maintenance.ts')} memory:export-md --out ${outFile}`,
      {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DB_PATH: ':memory:',
          DEFAULT_LLM_PROVIDER: 'openai',
          OPENAI_API_KEY: 'sk-test-openai-key',
        },
        timeout: CLI_TIMEOUT_MS,
      }
    );
    expect(fs.existsSync(outFile)).toBe(true);
    const content = fs.readFileSync(outFile, 'utf-8');
    expect(content).toContain('# PenceAI Memory Export');
  });

  it('memory:export-obsidian creates vault files', () => {
    const outDir = path.join(tmpDir, 'obsidian-vault-test');
    const result = execSync(
      `node --experimental-specifier-resolution=node ${path.join(PROJECT_ROOT, 'src/cli/maintenance.ts')} memory:export-obsidian --out ${outDir}`,
      {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DB_PATH: ':memory:',
          DEFAULT_LLM_PROVIDER: 'openai',
          OPENAI_API_KEY: 'sk-test-openai-key',
        },
        timeout: CLI_TIMEOUT_MS,
      }
    );
    expect(fs.existsSync(path.join(outDir, 'README.md'))).toBe(true);
  });
});
