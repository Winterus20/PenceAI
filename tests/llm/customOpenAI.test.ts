import { normalizeOpenAICompatibleBaseUrl, parseOpenAIModelIds } from '../../src/llm/customOpenAI.js';
import { LLMError } from '../../src/errors/LLMError.js';

describe('normalizeOpenAICompatibleBaseUrl', () => {
    it('trailing slash kaldırır ve /v1 ekler', () => {
        expect(normalizeOpenAICompatibleBaseUrl('https://api.example.com/')).toBe('https://api.example.com/v1');
    });

    it('zaten /v1 ile bitiyorsa dokunmaz', () => {
        expect(normalizeOpenAICompatibleBaseUrl('https://openrouter.ai/api/v1')).toBe('https://openrouter.ai/api/v1');
    });

    it('openai/v1 yolunu korur', () => {
        expect(normalizeOpenAICompatibleBaseUrl('https://api.groq.com/openai/v1')).toBe('https://api.groq.com/openai/v1');
    });

    it('boş URL için hata fırlatır', () => {
        expect(() => normalizeOpenAICompatibleBaseUrl('   ')).toThrow(LLMError);
    });
});

describe('parseOpenAIModelIds', () => {
    it('embedding ve ses modellerini filtreler', () => {
        const ids = parseOpenAIModelIds([
            { id: 'gpt-4o', object: 'model' },
            { id: 'text-embedding-3-small', object: 'model' },
            { id: 'whisper-1', object: 'model' },
            { id: 'llama-3', object: 'model' },
        ]);
        expect(ids).toEqual(['gpt-4o', 'llama-3']);
    });
});
