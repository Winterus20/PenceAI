import { MultiHopRetrieval } from '../../../src/memory/retrieval/MultiHopRetrieval.js';
import { PassageCritique } from '../../../src/memory/retrieval/PassageCritique.js';
import type { LLMProvider } from '../../../src/llm/provider.js';

describe('MultiHopRetrieval Engine', () => {
    let mockLlmProvider: jest.Mocked<LLMProvider>;
    let mockCritique: jest.Mocked<PassageCritique>;
    let retrieveFn: jest.Mock;

    beforeEach(() => {
        mockLlmProvider = {
            name: 'mock',
            supportedModels: ['mock'],
            chat: jest.fn(),
            stream: jest.fn(),
        } as any;

        mockCritique = {
            evaluate: jest.fn(),
            getConfig: jest.fn(),
        } as any;

        retrieveFn = jest.fn();
    });

    test('should NOT hop if initial critique says no more retrieval needed', async () => {
        const engine = new MultiHopRetrieval(mockLlmProvider, mockCritique, { maxHops: 3 });

        const result = await engine.execute(
            'Test query',
            [{ id: 1, content: 'Complete info', type: 'semantic', timestamp: 0 }] as any,
            { needsMoreRetrieval: false, missingInfo: [], overallCompleteness: 0.9 } as any,
            retrieveFn
        );

        expect(result.hops).toHaveLength(0); // Hiç çalışmamalı
        expect(result.memories).toHaveLength(1);
        expect(retrieveFn).not.toHaveBeenCalled();
        expect(mockLlmProvider.chat).not.toHaveBeenCalled();
    });

    test('should hop and fetch new query if info is missing', async () => {
        const engine = new MultiHopRetrieval(mockLlmProvider, mockCritique, { maxHops: 2 });

        // İlk LLM araması (Refined Query oluşturma cevabı)
        mockLlmProvider.chat.mockResolvedValueOnce({
            content: 'What is the color of the apple?',
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            model: 'mock'
        });

        // Hop 1 için sahte retrieval cevabı
        retrieveFn.mockResolvedValueOnce([
            { id: 2, content: 'Apple is red', type: 'semantic', timestamp: 0 }
        ]);

        // Hop 1 için sahte critique cevabı (artık bulduk, bırak)
        mockCritique.evaluate.mockResolvedValueOnce({
            needsMoreRetrieval: false,
            overallCompleteness: 0.8,
            missingInfo: [],
            evaluations: [
                { memoryId: 2, keep: true }
            ]
        } as any);

        const result = await engine.execute(
            'Apple details',
            [{ id: 1, content: 'Apple is a fruit', type: 'semantic', timestamp: 0 }] as any,
            { needsMoreRetrieval: true, missingInfo: ['Color of the apple is missing'], overallCompleteness: 0.4 } as any,
            retrieveFn
        );

        expect(result.hops).toHaveLength(1); // 1 kere atladı ve buldu
        expect(result.memories).toHaveLength(2); // Başlangıçtaki id:1 ve yeni gelen id:2
        expect(result.hops[0].query).toBe('What is the color of the apple?');
        expect(result.exhaustedMaxHops).toBe(false);
    });

    test('should stop at maxHops despite missing info', async () => {
        const engine = new MultiHopRetrieval(mockLlmProvider, mockCritique, { maxHops: 2 });

        // LLM - Refined Query 2 kere çağrılacak
        mockLlmProvider.chat.mockResolvedValue({
            content: 'More details',
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            model: 'mock'
        });

        retrieveFn.mockResolvedValue([]);

        // Critique hep "eksik" diyecek (bu yüzden tükenene kadar loopta kalmalı)
        mockCritique.evaluate.mockResolvedValue({
            needsMoreRetrieval: true,
            overallCompleteness: 0.1,
            missingInfo: ['Still missing'],
            evaluations: []
        } as any);

        const result = await engine.execute(
            'Hard query',
            [],
            { needsMoreRetrieval: true, missingInfo: ['Start missing'], overallCompleteness: 0.0 } as any,
            retrieveFn
        );

        expect(result.hops).toHaveLength(2); // 2 defa denedi ve limit doldu (maxHops=2)
        expect(result.exhaustedMaxHops).toBe(true);
        expect(retrieveFn).toHaveBeenCalledTimes(2);
    });
});