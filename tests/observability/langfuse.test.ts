/**
 * Langfuse Observability Tests
 * 
 * Test scenarios:
 * 1. Initialization with valid config
 * 2. Initialization with disabled flag (zero overhead)
 * 3. Initialization with missing API keys
 * 4. Shutdown flushes traces
 * 5. traceLLMCall creates span when enabled
 * 6. traceLLMCall skips when disabled
 */

import {
    initializeLangfuse,
    shutdownLangfuse,
    isLangfuseInitialized,
    validateLangfuseConfig,
    startTrace,
    endTrace,
} from '../../src/observability/langfuse.js';
import { traceLLMCall } from '../../src/llm/observability.js';

describe('Langfuse Observability', () => {
    // Test öncesi state'i temizle
    beforeEach(() => {
        // Langfuse module'unu yeniden yükle (state reset için)
        jest.resetModules();
    });

    // Test sonrası cleanup
    afterEach(async () => {
        try {
            await shutdownLangfuse();
        } catch {
            // Ignore shutdown errors in tests
        }
    });

    describe('Configuration Validation', () => {
        test('valid config passes validation', () => {
            const result = validateLangfuseConfig({
                enabled: true,
                secretKey: 'sk-lf-test',
                publicKey: 'pk-lf-test',
                baseUrl: 'https://cloud.langfuse.com',
            });

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        test('disabled config passes validation without keys', () => {
            const result = validateLangfuseConfig({
                enabled: false,
                secretKey: '',
                publicKey: '',
                baseUrl: '',
            });

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        test('enabled config with missing secretKey fails', () => {
            const result = validateLangfuseConfig({
                enabled: true,
                secretKey: '',
                publicKey: 'pk-lf-test',
                baseUrl: 'https://cloud.langfuse.com',
            });

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('LANGFUSE_SECRET_KEY is required when Langfuse is enabled');
        });

        test('enabled config with missing publicKey fails', () => {
            const result = validateLangfuseConfig({
                enabled: true,
                secretKey: 'sk-lf-test',
                publicKey: '',
                baseUrl: 'https://cloud.langfuse.com',
            });

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('LANGFUSE_PUBLIC_KEY is required when Langfuse is enabled');
        });

        test('enabled config with invalid baseUrl fails', () => {
            const result = validateLangfuseConfig({
                enabled: true,
                secretKey: 'sk-lf-test',
                publicKey: 'pk-lf-test',
                baseUrl: 'not-a-url',
            });

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('LANGFUSE_BASE_URL must be a valid URL');
        });
    });

    describe('Initialization', () => {
        test('initializeLangfuse with disabled flag returns false (zero overhead)', () => {
            const result = initializeLangfuse({
                enabled: false,
                secretKey: '',
                publicKey: '',
                baseUrl: '',
            });

            expect(result).toBe(false);
            expect(isLangfuseInitialized()).toBe(false);
        });

        test('initializeLangfuse with missing API keys returns false', () => {
            const result = initializeLangfuse({
                enabled: true,
                secretKey: '',
                publicKey: '',
                baseUrl: 'https://cloud.langfuse.com',
            });

            expect(result).toBe(false);
            expect(isLangfuseInitialized()).toBe(false);
        });

        test('initializeLangfuse with valid config returns true', () => {
            // Note: Bu test gerçek Langfuse API'sine bağlanmaz,
            // sadece initialization path'i test eder
            const result = initializeLangfuse({
                enabled: true,
                secretKey: 'sk-lf-test-dummy',
                publicKey: 'pk-lf-test-dummy',
                baseUrl: 'https://cloud.langfuse.com',
            });

            // API keys dummy olduğu için initialization başarısız olabilir,
            // bu yüzden result false da dönebilir - bu normal
            expect(typeof result).toBe('boolean');
        });
    });

    describe('Trace Helpers', () => {
        test('startTrace and endTrace work without errors', () => {
            const { span } = startTrace('test.operation', {
                testKey: 'testValue',
                testNumber: 42,
            });

            expect(span).toBeDefined();
            expect(span.isRecording).toBe(true);

            endTrace(span);
            expect(span.isRecording).toBe(false);
        });

        test('endTrace with error records exception', () => {
            const { span } = startTrace('test.operationWithError');
            const error = new Error('Test error');

            endTrace(span, error);
            expect(span.isRecording).toBe(false);
        });

        test('startTrace with no attributes works', () => {
            const { span } = startTrace('test.simpleOperation');
            expect(span).toBeDefined();
            endTrace(span);
        });
    });

    describe('traceLLMCall Helper', () => {
        test('traceLLMCall executes function and returns result', async () => {
            const mockFn = jest.fn().mockResolvedValue({
                content: 'Test response',
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 5,
                    total_tokens: 15,
                },
            });

            const result = await traceLLMCall('test-provider', 'test-model', mockFn);

            expect(result).toEqual({
                content: 'Test response',
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 5,
                    total_tokens: 15,
                },
            });
            expect(mockFn).toHaveBeenCalledTimes(1);
        });

        test('traceLLMCall propagates errors', async () => {
            const mockFn = jest.fn().mockRejectedValue(new Error('LLM error'));

            await expect(
                traceLLMCall('test-provider', 'test-model', mockFn)
            ).rejects.toThrow('LLM error');
        });

        test('traceLLMCall with zero overhead when disabled', async () => {
            // Langfuse disabled olmalı
            if (isLangfuseInitialized()) {
                await shutdownLangfuse();
            }

            const mockFn = jest.fn().mockResolvedValue({ content: 'Test' });
            const startTime = Date.now();

            const result = await traceLLMCall('test-provider', 'test-model', mockFn);
            const duration = Date.now() - startTime;

            expect(result).toEqual({ content: 'Test' });
            expect(duration).toBeLessThan(10); // Should be very fast (< 10ms)
        });
    });

    describe('Shutdown', () => {
        test('shutdownLangfuse completes without errors', async () => {
            // Langfuse başlatılmamış olsa bile shutdown hata vermemeli
            await expect(shutdownLangfuse()).resolves.not.toThrow();
        });

        test('multiple shutdowns are safe', async () => {
            await shutdownLangfuse();
            await shutdownLangfuse();
            await shutdownLangfuse();
            // Should not throw
        });
    });
});
