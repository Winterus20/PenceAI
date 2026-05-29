import { DEFAULT_STRICT_MODELS } from '../../src/llm/openai.js';
import { GroqProvider } from '../../src/llm/groq.js';
import { MistralProvider } from '../../src/llm/mistral.js';
import { NvidiaProvider } from '../../src/llm/nvidia.js';
import { GitHubProvider } from '../../src/llm/github.js';

describe('Strict Mode Model Mapping', () => {
    describe('DEFAULT_STRICT_MODELS', () => {
        test('should contain only truly strict models', () => {
            const expected = new Set([
                'gemma',
                'mixtral-8x22b',
                'codestral-22b-instruct-v0.1',
                'gpt-oss',
                'llama3.3',
                'llama3.1',
                'codellama',
            ]);
            expect(DEFAULT_STRICT_MODELS).toEqual(expected);
        });

        test('should NOT contain llama or mistral (they are native on most platforms)', () => {
            expect(DEFAULT_STRICT_MODELS.has('llama')).toBe(false);
            expect(DEFAULT_STRICT_MODELS.has('mistral')).toBe(false);
        });
    });

    describe('GroqProvider', () => {
        const provider = new (class extends GroqProvider {
            constructor() { super(); }
            getTestStrictModels() { return this.getStrictModels(); }
        })();

        test('should have empty strict models set (Groq docs: "All models support tool use")', () => {
            const strictModels = provider.getTestStrictModels();
            expect(strictModels.size).toBe(0);
        });

        test('should allow all Groq models to use native tool calling', () => {
            const strictModels = provider.getTestStrictModels();
            const allModels = [
                'llama-3.3-70b-versatile',
                'llama-3.1-8b-instant',
                'openai/gpt-oss-120b',
                'openai/gpt-oss-20b',
                'meta-llama/llama-4-scout-17b-16e-instruct',
                'qwen/qwen3-32b',
                'moonshotai/kimi-k2-instruct-0905',
            ];
            for (const model of allModels) {
                const isStrict = strictModels.has(model) || [...strictModels].some(s => model.includes(s));
                expect(isStrict).toBe(false);
            }
        });
    });

    describe('MistralProvider', () => {
        const provider = new (class extends MistralProvider {
            constructor() { super(); }
            getTestStrictModels() { return this.getStrictModels(); }
        })();

        test('should have open-mistral-nemo as strict (not listed in function calling docs)', () => {
            const strictModels = provider.getTestStrictModels();
            expect(strictModels.has('open-mistral-nemo')).toBe(true);
        });

        test('should allow frontier models to use native tool calling', () => {
            const strictModels = provider.getTestStrictModels();
            const nativeModels = [
                'mistral-large-latest',
                'mistral-medium-latest',
                'mistral-small-latest',
                'ministral-8b-latest',
                'ministral-3b-latest',
                'magistral-medium-latest',
                'magistral-small-latest',
                'codestral-latest',
                'devstral-latest',
            ];
            for (const model of nativeModels) {
                const isStrict = strictModels.has(model) || [...strictModels].some(s => model.includes(s));
                expect(isStrict).toBe(false);
            }
        });
    });

    describe('NvidiaProvider', () => {
        const provider = new (class extends NvidiaProvider {
            constructor() { super(); }
            getTestStrictModels() { return this.getStrictModels(); }
        })();

        test('should have gemma, mixtral, codestral, gpt-oss as strict', () => {
            const strictModels = provider.getTestStrictModels();
            expect(strictModels.has('gemma')).toBe(true);
            expect(strictModels.has('mixtral-8x22b')).toBe(true);
            expect(strictModels.has('codestral-22b-instruct-v0.1')).toBe(true);
            expect(strictModels.has('gpt-oss')).toBe(true);
        });

        test('should allow llama and mistral models to use native tool calling', () => {
            const strictModels = provider.getTestStrictModels();
            const nativeModels = [
                'meta/llama-4-maverick-17b-128e-instruct',
                'meta/llama-3.3-70b-instruct',
                'mistralai/mistral-large-3-675b-instruct-2512',
                'mistralai/mistral-small-4-119b-2603',
            ];
            for (const model of nativeModels) {
                const isStrict = strictModels.has(model) || [...strictModels].some(s => model.includes(s));
                expect(isStrict).toBe(false);
            }
        });

        test('should mark gemma models as strict', () => {
            const strictModels = provider.getTestStrictModels();
            const gemmaModels = ['google/gemma-4-31b-it', 'google/gemma-3-27b-it'];
            for (const model of gemmaModels) {
                const isStrict = strictModels.has(model) || [...strictModels].some(s => model.includes(s));
                expect(isStrict).toBe(true);
            }
        });
    });

    describe('GitHubProvider', () => {
        const provider = new (class extends GitHubProvider {
            constructor() { super(); }
            getTestStrictModels() { return this.getStrictModels(); }
        })();

        test('should have empty strict models set (all support native tool calling)', () => {
            const strictModels = provider.getTestStrictModels();
            expect(strictModels.size).toBe(0);
        });
    });
});
