import { PassageCritique } from '../../../src/memory/retrieval/PassageCritique.js';
import type { LLMProvider } from '../../../src/llm/provider.js';

describe('PassageCritique Engine', () => {
    let mockLlmProvider: jest.Mocked<LLMProvider>;

    beforeEach(() => {
        mockLlmProvider = {
            name: 'mock',
            supportedModels: ['mock'],
            chat: jest.fn(),
            stream: jest.fn(),
        } as any;
    });

    test('should keep relevant passages and drop irrelevant ones', async () => {
        // Gelen sahte yanıt: 1. passage geçerli, 2. passage değil
        mockLlmProvider.chat.mockResolvedValueOnce({
            content: `[
                {
                    "memoryId": 100,
                    "relevance": "Relevant",
                    "relevanceScore": 0.9,
                    "completeness": "Complete",
                    "completenessScore": 0.8,
                    "issues": []
                },
                {
                    "memoryId": 101,
                    "relevance": "Irrelevant",
                    "relevanceScore": 0.2,
                    "completeness": "Insufficient",
                    "completenessScore": 0.1,
                    "issues": ["Off-topic"]
                }
            ]`,
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            model: 'mock'
        });

        const critique = new PassageCritique(mockLlmProvider, {
            relevanceFloor: 0.5,
            completenessFloor: 0.3
        });

        const result = await critique.evaluate('How does AI work?', [
            { id: 100, content: 'AI works by using neural networks.', type: 'semantic', timestamp: Date.now() },
            { id: 101, content: 'I like apples.', type: 'episodic', timestamp: Date.now() }
        ] as any);

        expect(result.evaluations).toHaveLength(2);
        expect(result.keptCount).toBe(1);
        expect(result.filteredCount).toBe(1);
        
        // 100 kalmalı, 101 elenmeli
        const eval100 = result.evaluations.find(e => e.memoryId === 100);
        const eval101 = result.evaluations.find(e => e.memoryId === 101);
        
        expect(eval100?.keep).toBe(true);
        expect(eval101?.keep).toBe(false);
        
        // Eksik bilgi kontrolü
        expect(result.missingInfo).toContain('Off-topic');
    });

    test('should handle empty passages gracefully', async () => {
        const critique = new PassageCritique(mockLlmProvider);
        const result = await critique.evaluate('Test', []);

        expect(result.evaluations).toHaveLength(0);
        expect(result.keptCount).toBe(0);
        expect(result.needsMoreRetrieval).toBe(true);
        expect(mockLlmProvider.chat).not.toHaveBeenCalled();
    });

    test('should fallback safely if LLM returns invalid JSON', async () => {
        mockLlmProvider.chat.mockResolvedValueOnce({
            content: 'Hello I am an AI, I cannot help you with that.',
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            model: 'mock'
        });

        const critique = new PassageCritique(mockLlmProvider);
        const result = await critique.evaluate('Test fallback', [
            { id: 50, content: 'Valid info assumed.', type: 'semantic', timestamp: Date.now() }
        ] as any);

        // Parsing fail olursa fallback devreye girmeli
        expect(result.evaluations[0].keep).toBe(true);
        expect(result.filteredCount).toBe(0);
        expect(result.needsMoreRetrieval).toBe(false);
        expect(result.evaluations[0].issues).toContain('Critique engine bypassed/failed- fallback used.');
    });
});