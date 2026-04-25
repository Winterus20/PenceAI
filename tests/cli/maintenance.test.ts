import { describe, it, expect, afterEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

// CLI testleri gerçek alt process çalıştırır — timeout 30sn
const CLI_TIMEOUT_MS = 30000;
const PROJECT_ROOT = path.resolve(process.cwd());

/** Her test için benzersiz geçici DB dosyası oluşturur */
function makeTempDb(): string {
    return path.join(os.tmpdir(), `penceai-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

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
        const dbPath = makeTempDb();
        try {
            const result = execSync(
                `npx tsx ${path.join(PROJECT_ROOT, 'src/cli/maintenance.ts')} memory:lint --dry-run 2>&1`,
                {
                    cwd: PROJECT_ROOT,
                    encoding: 'utf-8',
                    env: {
                        ...process.env,
                        NODE_ENV: 'test',
                        DB_PATH: dbPath,
                        LOG_LEVEL: 'info',
                        ENABLE_MEMORY_LINT: 'true',
                        LINT_LLM_VALIDATION_ENABLED: 'false',
                        DEFAULT_LLM_PROVIDER: 'openai',
                        OPENAI_API_KEY: 'sk-test-openai-key',
                    },
                    timeout: CLI_TIMEOUT_MS,
                },
            );
            expect(result).toContain('Memory Lint Pass Result');
        } finally {
            try {
                fs.rmSync(dbPath, { force: true });
            } catch {
                /* ignore */
            }
        }
    });

    it('memory:export-md creates a markdown file', () => {
        const dbPath = makeTempDb();
        const outFile = path.join(tmpDir, 'export-md-test.md');
        try {
            const result = execSync(
                `npx tsx ${path.join(PROJECT_ROOT, 'src/cli/maintenance.ts')} memory:export-md --out ${outFile}`,
                {
                    cwd: PROJECT_ROOT,
                    encoding: 'utf-8',
                    env: {
                        ...process.env,
                        NODE_ENV: 'test',
                        DB_PATH: dbPath,
                        DEFAULT_LLM_PROVIDER: 'openai',
                        OPENAI_API_KEY: 'sk-test-openai-key',
                    },
                    timeout: CLI_TIMEOUT_MS,
                },
            );
            expect(fs.existsSync(outFile)).toBe(true);
            const content = fs.readFileSync(outFile, 'utf-8');
            expect(content).toContain('# PenceAI Memory Export');
        } finally {
            try {
                fs.rmSync(dbPath, { force: true });
            } catch {
                /* ignore */
            }
        }
    });

    it('memory:export-obsidian creates vault files', () => {
        const dbPath = makeTempDb();
        const outDir = path.join(tmpDir, 'obsidian-vault-test');
        try {
            const result = execSync(
                `npx tsx ${path.join(PROJECT_ROOT, 'src/cli/maintenance.ts')} memory:export-obsidian --out ${outDir}`,
                {
                    cwd: PROJECT_ROOT,
                    encoding: 'utf-8',
                    env: {
                        ...process.env,
                        NODE_ENV: 'test',
                        DB_PATH: dbPath,
                        DEFAULT_LLM_PROVIDER: 'openai',
                        OPENAI_API_KEY: 'sk-test-openai-key',
                    },
                    timeout: CLI_TIMEOUT_MS,
                },
            );
            expect(fs.existsSync(path.join(outDir, 'README.md'))).toBe(true);
        } finally {
            try {
                fs.rmSync(dbPath, { force: true });
            } catch {
                /* ignore */
            }
        }
    });
});
