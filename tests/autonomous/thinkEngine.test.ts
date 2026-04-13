import Database from 'better-sqlite3';
import {
    buildThoughtChain,
    synthesizeThoughtPrompt,
    FRESHNESS_THRESHOLD,
    MAX_HOP_DEPTH,
    MAX_ASSOCIATIONS,
    MAX_NEIGHBORS_PER_HOP,
    MIN_RELATION_CONFIDENCE,
    REFLECTION_QUESTION_TEMPLATES,
    type EmotionalContext,
    type ThoughtSeed,
    type Association,
    type ThoughtChain,
} from '../../src/autonomous/thinkEngine.js';

// ═══════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════

describe('ThinkEngine constants', () => {
    it('FRESHNESS_THRESHOLD should be 0.3', () => {
        expect(FRESHNESS_THRESHOLD).toBe(0.3);
    });

    it('MAX_HOP_DEPTH should be 2', () => {
        expect(MAX_HOP_DEPTH).toBe(2);
    });

    it('MAX_ASSOCIATIONS should be 8', () => {
        expect(MAX_ASSOCIATIONS).toBe(8);
    });

    it('MAX_NEIGHBORS_PER_HOP should be 5', () => {
        expect(MAX_NEIGHBORS_PER_HOP).toBe(5);
    });

    it('MIN_RELATION_CONFIDENCE should be 0.25', () => {
        expect(MIN_RELATION_CONFIDENCE).toBe(0.25);
    });

    it('REFLECTION_QUESTION_TEMPLATES should have 5 template groups', () => {
        expect(REFLECTION_QUESTION_TEMPLATES.length).toBe(5);
    });

    it('each template group should have exactly 3 questions', () => {
        for (const group of REFLECTION_QUESTION_TEMPLATES) {
            expect(group.length).toBe(3);
        }
    });

    it('all questions should be non-empty strings', () => {
        for (const group of REFLECTION_QUESTION_TEMPLATES) {
            for (const question of group) {
                expect(typeof question).toBe('string');
                expect(question.length).toBeGreaterThan(0);
            }
        }
    });
});

// ═══════════════════════════════════════════════════════════
//  buildThoughtChain()
// ═══════════════════════════════════════════════════════════

describe('buildThoughtChain()', () => {
    const sampleSeed: ThoughtSeed = {
        type: 'recent_memory',
        memoryId: 1,
        content: 'User asked about TypeScript generics',
        reason: 'Son erişilen taze anı',
    };

    const sampleEmotion: EmotionalContext = {
        primary: 'Meraklı',
        intensity: 'medium',
        description: 'Kullanıcı yeni bir konuyu keşfediyor',
    };

    const sampleAssociations: Association[] = [
        {
            memoryId: 2,
            content: 'TypeScript union types explanation',
            category: 'programming',
            importance: 7,
            retention: 0.8,
            hopDistance: 1,
            relationDescription: 'ilgili kavram',
            confidence: 0.9,
        },
        {
            memoryId: 3,
            content: 'Generic constraints in Rust',
            category: 'programming',
            importance: 6,
            retention: 0.6,
            hopDistance: 2,
            relationDescription: 'benzer pattern',
            confidence: 0.7,
        },
    ];

    it('should build a thought chain with associations', () => {
        const chain = buildThoughtChain(sampleSeed, sampleAssociations, sampleEmotion);

        expect(chain.seed).toBe(sampleSeed);
        expect(chain.associations).toBe(sampleAssociations);
        expect(chain.emotionalContext).toBe(sampleEmotion);
        expect(typeof chain.generatedAt).toBe('string');
        expect(chain.totalRetentionScore).toBeCloseTo(0.7, 5); // (0.8 + 0.6) / 2
    });

    it('should handle empty associations', () => {
        const chain = buildThoughtChain(sampleSeed, [], sampleEmotion);

        expect(chain.associations).toEqual([]);
        expect(chain.totalRetentionScore).toBe(0);
        expect(chain.generatedAt).toBeDefined();
    });

    it('should compute correct average retention with single association', () => {
        const chain = buildThoughtChain(sampleSeed, [sampleAssociations[0]], sampleEmotion);
        expect(chain.totalRetentionScore).toBeCloseTo(0.8, 5);
    });

    it('should compute correct average retention with multiple associations', () => {
        const assocs: Association[] = [
            { ...sampleAssociations[0], retention: 0.9 },
            { ...sampleAssociations[1], retention: 0.6 },
            { memoryId: 99, content: 'extra', category: 'x', importance: 5, retention: 0.3, hopDistance: 1, relationDescription: '', confidence: 0.5 },
        ];
        const chain = buildThoughtChain(sampleSeed, assocs, sampleEmotion);
        // (0.9 + 0.6 + 0.3) / 3 = 0.6
        expect(chain.totalRetentionScore).toBeCloseTo(0.6, 5);
    });
});

// ═══════════════════════════════════════════════════════════
//  synthesizeThoughtPrompt()
// ═══════════════════════════════════════════════════════════

describe('synthesizeThoughtPrompt()', () => {
    const sampleSeed: ThoughtSeed = {
        type: 'high_importance',
        memoryId: 10,
        content: 'User is learning React hooks',
        reason: 'Yüksek öneme sahip anı',
    };

    const sampleEmotion: EmotionalContext = {
        primary: 'Nötr',
        intensity: 'low',
        description: 'Normal düşünce modu',
    };

    const sampleChain = (associations: Association[] = []): ThoughtChain => ({
        seed: sampleSeed,
        associations,
        emotionalContext: sampleEmotion,
        generatedAt: new Date().toISOString(),
        totalRetentionScore: 0.5,
    });

    it('should include the emotional context in the output', () => {
        const prompt = synthesizeThoughtPrompt(sampleChain());
        expect(prompt).toContain(sampleEmotion.primary);
        expect(prompt).toContain(sampleEmotion.intensity);
        expect(prompt).toContain(sampleEmotion.description);
    });

    it('should include the seed content and reason', () => {
        const prompt = synthesizeThoughtPrompt(sampleChain());
        expect(prompt).toContain(sampleSeed.content);
        expect(prompt).toContain(sampleSeed.reason);
    });

    it('should include associations with formatting', () => {
        const associations: Association[] = [
            {
                memoryId: 2,
                content: 'React useEffect cleanup',
                category: 'programming',
                importance: 8,
                retention: 0.9,
                hopDistance: 1,
                relationDescription: 'related concept',
                confidence: 0.85,
            },
        ];
        const prompt = synthesizeThoughtPrompt(sampleChain(associations));
        expect(prompt).toContain('React useEffect cleanup');
        expect(prompt).toContain('1. derece bağlantı');
        expect(prompt).toContain('related concept');
    });

    it('should truncate long association content', () => {
        const longContent = 'a'.repeat(100);
        const associations: Association[] = [
            {
                memoryId: 3,
                content: longContent,
                category: 'test',
                importance: 5,
                retention: 0.5,
                hopDistance: 1,
                relationDescription: '',
                confidence: 0.5,
            },
        ];
        const prompt = synthesizeThoughtPrompt(sampleChain(associations));
        // Content should be truncated to 80 chars with '...'
        expect(prompt).toContain('...');
        expect(prompt).not.toContain(longContent);
    });

    it('should include freshness labels based on retention score', () => {
        const highRetention: Association[] = [{
            memoryId: 1, content: 'high', category: 'c', importance: 5, retention: 0.8,
            hopDistance: 1, relationDescription: '', confidence: 0.5,
        }];
        const lowRetention: Association[] = [{
            memoryId: 2, content: 'low', category: 'c', importance: 5, retention: 0.3,
            hopDistance: 1, relationDescription: '', confidence: 0.5,
        }];

        const highPrompt = synthesizeThoughtPrompt(sampleChain(highRetention));
        const lowPrompt = synthesizeThoughtPrompt(sampleChain(lowRetention));

        expect(highPrompt).toContain('çok taze');
        expect(lowPrompt).toContain('solmaya başlıyor');
    });

    it('should handle empty associations with a fallback message', () => {
        const prompt = synthesizeThoughtPrompt(sampleChain([]));
        expect(prompt).toContain('Yalnız bir düşünce');
    });

    it('should include reflection questions from a template', () => {
        const prompt = synthesizeThoughtPrompt(sampleChain(), 0);
        const questions = REFLECTION_QUESTION_TEMPLATES[0];
        expect(prompt).toContain(questions[0]);
        expect(prompt).toContain(questions[1]);
        expect(prompt).toContain(questions[2]);
    });

    it('should use specified question template index', () => {
        const prompt2 = synthesizeThoughtPrompt(sampleChain(), 2);
        const questions = REFLECTION_QUESTION_TEMPLATES[2];
        expect(prompt2).toContain(questions[0]);

        const prompt4 = synthesizeThoughtPrompt(sampleChain(), 4);
        const questions4 = REFLECTION_QUESTION_TEMPLATES[4];
        expect(prompt4).toContain(questions4[0]);
    });

    it('should wrap template index if out of bounds', () => {
        // Index 5 should wrap to 0
        const prompt5 = synthesizeThoughtPrompt(sampleChain(), 5);
        const questions0 = REFLECTION_QUESTION_TEMPLATES[0];
        expect(prompt5).toContain(questions0[0]);
    });

    it('should include JSON format instruction at the end', () => {
        const prompt = synthesizeThoughtPrompt(sampleChain());
        expect(prompt).toContain('SADECE aşağıdaki JSON formatında ver');
        expect(prompt).toContain('"relevance"');
        expect(prompt).toContain('"timeSensitivity"');
        expect(prompt).toContain('"reasoning"');
    });

    it('should have correct structure with markdown headers', () => {
        const prompt = synthesizeThoughtPrompt(sampleChain());
        expect(prompt).toContain('## İç Ses Notu (Dahili Düşünce)');
        expect(prompt).toContain("### Düşüncenin Başlangıç Noktası");
        expect(prompt).toContain('### Çağrışım Zinciri');
    });
});
