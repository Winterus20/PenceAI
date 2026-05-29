import {
    EXTRACTION_CATEGORIES,
    EXTRACTION_EXAMPLES,
    EXTRACTION_IMPORTANCE_SCORING,
    EXTRACTION_MEMORY_CONTROL,
    EXTRACTION_RESPONSE_FORMAT,
} from '../../../src/agent/prompts/constants.js';

describe('extraction constants', () => {
    it('EXTRACTION_CATEGORIES contains all 6 category definitions', () => {
        expect(EXTRACTION_CATEGORIES).toContain('preference');
        expect(EXTRACTION_CATEGORIES).toContain('fact');
        expect(EXTRACTION_CATEGORIES).toContain('habit');
        expect(EXTRACTION_CATEGORIES).toContain('project');
        expect(EXTRACTION_CATEGORIES).toContain('event');
        expect(EXTRACTION_CATEGORIES).toContain('other');
    });

    it('EXTRACTION_IMPORTANCE_SCORING covers 1-10 range', () => {
        expect(EXTRACTION_IMPORTANCE_SCORING).toContain('10:');
        expect(EXTRACTION_IMPORTANCE_SCORING).toContain('1:');
        expect(EXTRACTION_IMPORTANCE_SCORING).toContain('HAYATİ');
    });

    it('EXTRACTION_MEMORY_CONTROL describes 3 states', () => {
        expect(EXTRACTION_MEMORY_CONTROL).toContain('ATLA');
        expect(EXTRACTION_MEMORY_CONTROL).toContain('GÜNCELLE');
        expect(EXTRACTION_MEMORY_CONTROL).toContain('EKLE');
        expect(EXTRACTION_MEMORY_CONTROL).toContain('TEKRARLARINI');
    });

    it('EXTRACTION_EXAMPLES contains correct and incorrect samples', () => {
        expect(EXTRACTION_EXAMPLES).toContain('✅ DOĞRU');
        expect(EXTRACTION_EXAMPLES).toContain('❌ YANLIŞ');
        expect(EXTRACTION_EXAMPLES).toContain('tekrar çıkarma');
    });

    it('EXTRACTION_RESPONSE_FORMAT specifies JSON array output', () => {
        expect(EXTRACTION_RESPONSE_FORMAT).toContain('[');
        expect(EXTRACTION_RESPONSE_FORMAT).toContain('content');
        expect(EXTRACTION_RESPONSE_FORMAT).toContain('category');
        expect(EXTRACTION_RESPONSE_FORMAT).toContain('importance');
        expect(EXTRACTION_RESPONSE_FORMAT).toContain('Bilgi yoksa: []');
    });
});
