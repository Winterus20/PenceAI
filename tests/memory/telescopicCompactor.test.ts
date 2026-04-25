jest.mock('../../src/utils/logger.js', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    },
}));

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type Database from 'better-sqlite3';
import { TelescopicCompactor } from '../../src/memory/telescopicCompactor.js';
import type { LLMProvider } from '../../src/llm/provider.js';
import type { MessageRow } from '../../src/memory/types.js';
import { logger } from '../../src/utils/logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type SummaryRow = {
    id: number;
    start_msg_id: number;
    end_msg_id: number;
    summary: string;
    created_at: string;
};

type GetSummaryRow = {
    level: number;
    start_msg_id: number;
    end_msg_id: number;
    summary: string;
};

interface MockDbConfig {
    messages?: MessageRow[];
    lastSummarizedId?: number | null;
    level1Summaries?: SummaryRow[];
    level2Summaries?: SummaryRow[];
    lastMergedEndId?: number | null;
    summaryRows?: GetSummaryRow[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * count adet sequential ID'li MessageRow dizisi üretir.
 */
function makeMessages(count: number, startId = 1): MessageRow[] {
    return Array.from({ length: count }, (_, i) => ({
        id: startId + i,
        conversation_id: 'conv-test',
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${startId + i}`,
        created_at: new Date().toISOString(),
    }));
}

/**
 * count adet SummaryRow üretir.
 * Her özet [startMsgId + i*msgSpan, startMsgId + (i+1)*msgSpan - 1] aralığını kapsar.
 */
function makeSummaryRows(count: number, startMsgId = 1, msgSpan = 10): SummaryRow[] {
    return Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        start_msg_id: startMsgId + i * msgSpan,
        end_msg_id: startMsgId + (i + 1) * msgSpan - 1,
        summary: `Test summary ${i + 1}`,
        created_at: new Date().toISOString(),
    }));
}

/**
 * Minimal LLM provider mock. shouldFail=true → chat() reject eder.
 */
function makeMockLlmProvider(shouldFail = false): LLMProvider {
    return {
        chat: shouldFail
            ? jest.fn().mockRejectedValue(new Error('LLM API error'))
            : jest.fn().mockResolvedValue({ content: 'Mock özet metni' }),
    } as unknown as LLMProvider;
}

/**
 * better-sqlite3 Database mock'u üretir.
 *
 * SQL içeriğine göre hangi sorgunun çağrıldığını ayırt eder:
 *  1. FROM messages          → compactLevel1'in mesaj sorgusu
 *  2. ORDER BY level DESC    → getSummariesForConversation sorgusu
 *  3. MAX(end_msg_id) + level = 1 (literal) → L1 son özetlenmiş ID sorgusu
 *  4. ORDER BY start_msg_id ASC → tryMergeLevel'in özet listesi sorgusu
 *  5. MAX(end_msg_id)        → tryMergeLevel'in son merge ID sorgusu
 *  6. Default                → INSERT ve diğerleri
 *
 * Tüm dallar aynı `run` mock'unu paylaşır; böylece INSERT çağrısı
 * dışarıdan doğrulanabilir.
 */
function makeMockDb(config: MockDbConfig): {
    db: Database.Database;
    run: ReturnType<typeof jest.fn>;
} {
    const run = jest.fn().mockReturnValue({ changes: 1 });

    const prepare = jest.fn().mockImplementation((sql: string) => {
        // ── 1. Ham mesaj sorgusu ────────────────────────────────────────────────
        if (sql.includes('FROM messages')) {
            return {
                all: jest.fn().mockReturnValue(config.messages ?? []),
                get: jest.fn().mockReturnValue(null),
                run,
            };
        }

        // ── 2. getSummariesForConversation — ORDER BY level DESC ───────────────
        if (sql.includes('ORDER BY level DESC')) {
            return {
                all: jest.fn().mockReturnValue(config.summaryRows ?? []),
                get: jest.fn().mockReturnValue(null),
                run,
            };
        }

        // ── 3. compactLevel1 — MAX(end_msg_id) WHERE level = 1 (literal) ───────
        if (sql.includes('MAX(end_msg_id)') && sql.includes('level = 1')) {
            return {
                get: jest.fn().mockReturnValue({ last_id: config.lastSummarizedId ?? null }),
                all: jest.fn().mockReturnValue([]),
                run,
            };
        }

        // ── 4. tryMergeLevel özet listesi — ORDER BY start_msg_id ASC ──────────
        //    .all(conversationId, sourceLevel) → level'a göre farklı dizi döner
        if (sql.includes('ORDER BY start_msg_id ASC')) {
            return {
                all: jest.fn().mockImplementation((_convId: string, level: number) => {
                    if (level === 1) return config.level1Summaries ?? [];
                    if (level === 2) return config.level2Summaries ?? [];
                    return [];
                }),
                get: jest.fn().mockReturnValue(null),
                run,
            };
        }

        // ── 5. tryMergeLevel — MAX(end_msg_id) WHERE level = ? (parameterized) ─
        if (sql.includes('MAX(end_msg_id)')) {
            return {
                get: jest.fn().mockReturnValue({ last_id: config.lastMergedEndId ?? null }),
                all: jest.fn().mockReturnValue([]),
                run,
            };
        }

        // ── 6. Default (INSERT ve bilinmeyen sorgular) ─────────────────────────
        return {
            all: jest.fn().mockReturnValue([]),
            get: jest.fn().mockReturnValue(null),
            run,
        };
    });

    return {
        db: { prepare } as unknown as Database.Database,
        run,
    };
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('TelescopicCompactor', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ══════════════════════════════════════════════════════════════════════════
    // compactSession()
    // ══════════════════════════════════════════════════════════════════════════
    describe('compactSession()', () => {
        it('messages.length (10) <= retainRecentCount (20) → false döner, INSERT çağrılmaz', async () => {
            const { db, run } = makeMockDb({
                messages: makeMessages(10),
                level1Summaries: [],
                level2Summaries: [],
            });
            const compactor = new TelescopicCompactor(db, makeMockLlmProvider());

            const result = await compactor.compactSession('conv-1', 20);

            expect(result).toBe(false);
            // compactLevel1 erken dönmeli; hiçbir INSERT gerçekleşmemeli
            expect(run).not.toHaveBeenCalled();
        });

        it('30 mesaj, retain=20 → messagesToCompact(10) threshold altında (<40) → false döner', async () => {
            const { db, run } = makeMockDb({
                messages: makeMessages(30), // IDs 1-30
                lastSummarizedId: null, // lastSummarizedId = 0
                level1Summaries: [],
                level2Summaries: [],
            });
            const compactor = new TelescopicCompactor(db, makeMockLlmProvider());

            const result = await compactor.compactSession('conv-1', 20);

            // messagesToCompact = slice(0, 30-20) = IDs 1-10 → 10 adet
            // unsummarized (id > 0) = 10 → 10 < threshold(40) → false
            expect(result).toBe(false);
            expect(run).not.toHaveBeenCalled();
        });

        it('80 mesaj, retain=20 → 60 unsummarized >= threshold(40) → LLM çağrılır, INSERT çalışır, true döner', async () => {
            const mockChat = jest.fn().mockResolvedValue({ content: 'Sıkıştırılmış özet' });
            const llm = { chat: mockChat } as unknown as LLMProvider;

            const { db, run } = makeMockDb({
                messages: makeMessages(80), // IDs 1-80
                lastSummarizedId: null,
                level1Summaries: [],
                level2Summaries: [],
            });
            const compactor = new TelescopicCompactor(db, llm);

            const result = await compactor.compactSession('conv-1', 20);

            // messagesToCompact = slice(0, 80-20) = IDs 1-60 → 60 adet
            // unsummarized (id > 0) = 60 → 60 >= threshold(40) → özet oluştur + INSERT
            expect(result).toBe(true);
            expect(mockChat).toHaveBeenCalledTimes(1);
            expect(run).toHaveBeenCalledTimes(1);
        });

        it('80 mesaj, lastSummarizedId=40 → 20 unsummarized kalır (<40) → atlanır, false döner', async () => {
            const { db, run } = makeMockDb({
                messages: makeMessages(80), // IDs 1-80
                lastSummarizedId: 40, // IDs 1-40 zaten özetlenmiş
                level1Summaries: [],
                level2Summaries: [],
            });
            const compactor = new TelescopicCompactor(db, makeMockLlmProvider());

            const result = await compactor.compactSession('conv-1', 20);

            // messagesToCompact = slice(0, 60) = IDs 1-60
            // unsummarized = filter(id > 40) = IDs 41-60 → 20 adet → 20 < threshold(40) → false
            expect(result).toBe(false);
            expect(run).not.toHaveBeenCalled();
        });

        it('LLM chat() throw eder → false döner ve logger.error çağrılır', async () => {
            const { db } = makeMockDb({
                messages: makeMessages(80),
                lastSummarizedId: null,
                level1Summaries: [],
                level2Summaries: [],
            });
            // shouldFail=true → LLM her çağrıda reject eder
            const compactor = new TelescopicCompactor(db, makeMockLlmProvider(true));

            const result = await compactor.compactSession('conv-1', 20);

            // compactSession try-catch bloğu hatayı yakalar
            expect(result).toBe(false);
            expect(jest.mocked(logger.error)).toHaveBeenCalledTimes(1);
        });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // getSummariesForConversation()
    // ══════════════════════════════════════════════════════════════════════════
    describe('getSummariesForConversation()', () => {
        it('özet satırlarını olduğu gibi döner (level DESC sıralamasıyla)', () => {
            const expectedRows: GetSummaryRow[] = [
                { level: 2, start_msg_id: 1, end_msg_id: 80, summary: 'Üst seviye özet' },
                { level: 1, start_msg_id: 1, end_msg_id: 40, summary: 'Alt seviye özet' },
            ];
            const { db } = makeMockDb({ summaryRows: expectedRows });
            const compactor = new TelescopicCompactor(db, makeMockLlmProvider());

            const result = compactor.getSummariesForConversation('conv-1', 10);

            expect(result).toEqual(expectedRows);
            expect(result).toHaveLength(2);
            // En üst seviye özet önce gelmeli
            expect(result[0].level).toBe(2);
            expect(result[1].level).toBe(1);
        });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // tryMergeLevel() — compactSession üzerinden dolaylı test
    //
    // Bu testlerde compactLevel1'in false dönmesi için az mesaj kullanılır
    // (5 <= retainRecentCount=20), böylece compactSession'ın dönüş değeri
    // yalnızca tryMergeLevel sonucunu yansıtır.
    // ══════════════════════════════════════════════════════════════════════════
    describe('tryMergeLevel() — compactSession üzerinden dolaylı test', () => {
        it('2 adet L1 özet var (minimum 3 koşulu sağlanmıyor) → merge olmaz, false döner', async () => {
            const { db, run } = makeMockDb({
                messages: makeMessages(5), // compactLevel1 da false döner (5 <= 20)
                level1Summaries: makeSummaryRows(2),
                level2Summaries: [],
            });
            const compactor = new TelescopicCompactor(db, makeMockLlmProvider());

            const result = await compactor.compactSession('conv-1', 20);

            // tryMergeLevel(sourceLevel=1): summaries.length=2 < 3 → erken dön, false
            // tryMergeLevel(sourceLevel=2): summaries.length=0 < 3 → erken dön, false
            // compactLevel1: 5 <= 20 → false
            expect(result).toBe(false);
            expect(run).not.toHaveBeenCalled();
        });

        it("3 adet L1 özet var ancak tümü zaten L2'ye merge edilmiş → false döner", async () => {
            // 3 özet oluştur: end_msg_id değerleri = 10, 20, 30
            const level1Summaries = makeSummaryRows(3, 1, 10);

            const { db, run } = makeMockDb({
                messages: makeMessages(5),
                level1Summaries,
                level2Summaries: [],
                // targetLevel=2 için MAX(end_msg_id) = 30 → tüm özetler (max 30) zaten merge edilmiş
                lastMergedEndId: 30,
            });
            const compactor = new TelescopicCompactor(db, makeMockLlmProvider());

            const result = await compactor.compactSession('conv-1', 20);

            // tryMergeLevel(sourceLevel=1):
            //   summaries.length=3 → devam et
            //   unmerged = filter(end_msg_id > 30) → boş dizi (10, 20, 30 hiçbiri > 30 değil)
            //   unmerged.length=0 < 3 → false
            // compactLevel1: 5 <= 20 → false
            expect(result).toBe(false);
            expect(run).not.toHaveBeenCalled();
        });
    });
});
