import { jest } from '@jest/globals';

jest.mock('../../src/gateway/config.js', () => ({
    getConfig: jest.fn(),
}));

import { getConfig } from '../../src/gateway/config.js';
import { OpenRouterProvider, OPENROUTER_BASE_URL } from '../../src/llm/openrouter.js';
import { LLMError } from '../../src/errors/LLMError.js';

const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;

describe('OPENROUTER_BASE_URL', () => {
    it('OpenRouter API v1 kökünü kullanır', () => {
        expect(OPENROUTER_BASE_URL).toBe('https://openrouter.ai/api/v1');
    });
});

describe('OpenRouterProvider', () => {
    beforeEach(() => {
        mockGetConfig.mockReset();
    });

    it('OPENROUTER_API_KEY yoksa hata fırlatır', () => {
        mockGetConfig.mockReturnValue({
            openrouterApiKey: undefined,
            openrouterHttpReferer: undefined,
            openrouterAppTitle: undefined,
        } as ReturnType<typeof getConfig>);
        expect(() => new OpenRouterProvider()).toThrow(LLMError);
        expect(() => new OpenRouterProvider()).toThrow(/OPENROUTER_API_KEY/);
    });

    it('anahtar ile oluşturulur', () => {
        mockGetConfig.mockReturnValue({
            openrouterApiKey: 'sk-or-test',
            openrouterHttpReferer: 'http://localhost:3001',
            openrouterAppTitle: 'PenceAI',
        } as ReturnType<typeof getConfig>);
        const provider = new OpenRouterProvider();
        expect(provider.name).toBe('openrouter');
        expect(provider.supportedModels).toEqual([]);
    });
});
