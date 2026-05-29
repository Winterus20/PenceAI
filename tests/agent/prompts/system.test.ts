import {
    BASE_SYSTEM_PROMPT,
    buildSystemPrompt,
    SystemPromptContext,
} from '../../../src/agent/prompts/system.js';

jest.mock('../../../src/gateway/config.js', () => ({
    getConfig: jest.fn().mockReturnValue({
        systemPrompt: '',
    }),
}));

describe('BASE_SYSTEM_PROMPT', () => {
    it('contains USER_NAME placeholder', () => {
        expect(BASE_SYSTEM_PROMPT).toContain('{USER_NAME}');
    });

    it('contains NOW placeholder', () => {
        expect(BASE_SYSTEM_PROMPT).toContain('{NOW}');
    });

    it('contains persona section', () => {
        expect(BASE_SYSTEM_PROMPT).toContain('<persona>');
    });
});

describe('buildSystemPrompt', () => {
    const baseContext: SystemPromptContext = {
        userName: 'TestUser',
    };

    it('replaces USER_NAME and NOW placeholders', () => {
        const result = buildSystemPrompt(baseContext);
        expect(result).toContain('TestUser');
        expect(result).not.toContain('{USER_NAME}');
        expect(result).not.toContain('{NOW}');
    });

    it('includes base rules section even with empty context', () => {
        const result = buildSystemPrompt(baseContext);
        expect(result).toContain('<kurallar>');
        expect(result).toContain('<dil>');
        expect(result).toContain('<yanit_stili>');
        expect(result).toContain('<davranis>');
        expect(result).toContain('<arac_kullanimi>');
    });

    it('includes memories section when memories provided', () => {
        const result = buildSystemPrompt({
            ...baseContext,
            memories: ['Kullanıcı kahve seviyor', 'Kullanıcı İstanbul\'da yaşıyor'],
        });
        expect(result).toContain('<kullanici_hakkinda>');
        expect(result).toContain('1. Kullanıcı kahve seviyor');
        expect(result).toContain('2. Kullanıcı İstanbul\'da yaşıyor');
    });

    it('omits memories section when memories empty', () => {
        const result = buildSystemPrompt(baseContext);
        expect(result).not.toContain('<kullanici_hakkinda>');
    });

    it('includes memory relations when provided', () => {
        const result = buildSystemPrompt({
            ...baseContext,
            memories: ['Kahve', 'Çay'],
            memoryRelations: [{
                source: 'Kahve',
                target: 'Çay',
                relation: 'related_to',
                description: 'İçecekler',
            }],
        });
        expect(result).toContain('<bilgiler_arasi_baglantilar>');
        expect(result).toContain('↔ ilişkili');
        expect(result).toContain('[Tree of Thoughts]');
    });

    it('includes conversation summaries when provided', () => {
        const result = buildSystemPrompt({
            ...baseContext,
            conversationSummaries: [
                { title: 'Test Konuşma', summary: 'Test özeti', updated_at: '2024-01-15T10:00:00Z' },
            ],
        });
        expect(result).toContain('<gecmis_konusma_ozetleri>');
        expect(result).toContain('Test Konuşma');
        expect(result).toContain('Test özeti');
    });

    it('omits conversation summaries section when single summary exceeds limit', () => {
        const longSummary = 'a'.repeat(3000);
        const result = buildSystemPrompt({
            ...baseContext,
            conversationSummaries: [
                { title: 'T1', summary: longSummary, updated_at: '2024-01-15T10:00:00Z' },
            ],
        });
        // When even the first summary exceeds the char budget, section is omitted entirely
        expect(result).not.toContain('<gecmis_konusma_ozetleri>');
    });

    it('includes recent context when provided', () => {
        const result = buildSystemPrompt({
            ...baseContext,
            recentContext: ['Son konuşmada Python\'dan bahsedildi'],
        });
        expect(result).toContain('<yakin_gecmis_baglam>');
        expect(result).toContain('Son konuşmada Python\'dan bahsedildi');
    });

    it('includes review memories when provided', () => {
        const result = buildSystemPrompt({
            ...baseContext,
            reviewMemories: ['Eski bilgi 1'],
        });
        expect(result).toContain('<hatirlatma_gerektiren_bilgiler>');
        expect(result).toContain('Eski bilgi 1');
    });

    it('includes archival memories when provided', () => {
        const result = buildSystemPrompt({
            ...baseContext,
            archivalMemories: ['Arşiv bilgisi'],
        });
        expect(result).toContain('<uzak_gecmis_arsiv>');
        expect(result).toContain('Arşiv bilgisi');
        expect(result).toContain('⚠️');
    });

    it('includes follow-up memories when provided', () => {
        const result = buildSystemPrompt({
            ...baseContext,
            followUpMemories: ['Proje X hakkında takip'],
        });
        expect(result).toContain('<proaktif_takip>');
        expect(result).toContain('Proje X hakkında takip');
        expect(result).toContain('Bu listeyi asla doğrudan kullanıcıya gösterme');
    });

    it('handles all optional fields together', () => {
        const result = buildSystemPrompt({
            userName: 'Ali',
            memories: ['M1'],
            recentContext: ['R1'],
            conversationSummaries: [{ title: 'T1', summary: 'S1', updated_at: '2024-01-01T00:00:00Z' }],
            reviewMemories: ['RV1'],
            memoryRelations: [{ source: 'A', target: 'B', relation: 'supports', description: '' }],
            archivalMemories: ['AR1'],
            followUpMemories: ['FU1'],
        });
        expect(result).toContain('Ali');
        expect(result).toContain('<kullanici_hakkinda>');
        expect(result).toContain('<yakin_gecmis_baglam>');
        expect(result).toContain('<gecmis_konusma_ozetleri>');
        expect(result).toContain('<hatirlatma_gerektiren_bilgiler>');
        expect(result).toContain('<bilgiler_arasi_baglantilar>');
        expect(result).toContain('<uzak_gecmis_arsiv>');
        expect(result).toContain('<proaktif_takip>');
    });
});
