/**
 * Memory Consolidation & Data Loss Fix - Integration Test
 * 
 * Bu test, MemoryStore'un yeni konsolidasyon ve veri kaybı önleme mantığını doğrular.
 */

import { jest } from '@jest/globals';
import type Database from 'better-sqlite3';
import { MemoryStore } from '../../src/memory/manager/MemoryStore.js';
import { PenceDatabase } from '../../src/memory/database.js';
import type { EmbeddingProvider } from '../../src/memory/embeddings.js';

describe('MemoryStore Consolidation & Data Loss Fix', () => {
    let db: Database.Database;
    let penceDb: PenceDatabase;
    let memoryStore: MemoryStore;
    let mockEmbeddingProvider: jest.Mocked<EmbeddingProvider>;
    let mockGraphManager: any;

    beforeEach(() => {
        // In-memory DB setup
        penceDb = new PenceDatabase(':memory:');
        db = penceDb.getDb();
        
        mockEmbeddingProvider = {
            embed: jest.fn<any>().mockImplementation(async (texts: string[]) => {
                // Her metin için dummy 1536 boyutlu embedding
                return texts.map(() => new Array(1536).fill(0).map(() => Math.random()));
            }),
            dimensions: 1536,
            name: 'mock-provider'
        } as any;

        mockGraphManager = {
            autoCreateProximityRelations: jest.fn(),
            updateStabilityOnAccess: jest.fn(),
            cleanupMemoryGraph: jest.fn()
        };

        memoryStore = new MemoryStore(db, mockEmbeddingProvider, null, mockGraphManager);
    });

    afterEach(() => {
        penceDb.close();
    });

    test('Test 1: Episodik belleklerde veri kaybını önlemeli (insert_new)', async () => {
        // 1. İlk episodik belleği ekle
        const first = await memoryStore.addMemory(
            "John ile toplantı yaptım", 
            "event", 
            5, 
            undefined, 
            { confidence: 0.9, memoryType: 'episodic' }
        );
        
        // 2. Benzer ama farklı bir episodik bellek ekle
        // Semantik benzerlik yüksek olsa bile (mock embedding'ler benzer çıkabilir) 
        // episodic olduğu için yeni kayıt açmalı.
        const second = await memoryStore.addMemory(
            "Sarah ile toplantı yaptım", 
            "event", 
            5, 
            undefined, 
            { confidence: 0.9, memoryType: 'episodic' }
        );

        expect(first.id).not.toBe(second.id);
        expect(second.isUpdate).toBe(false);

        // DB'de her iki kaydın da olduğunu doğrula
        const count = db.prepare("SELECT COUNT(*) as count FROM memories WHERE category = 'event'").get() as { count: number };
        expect(count.count).toBe(2);
    });

    test('Test 2: Semantik belleklerde olgu güncellemesi yapmalı (update)', async () => {
        const factEmbedding = new Array(1536).fill(0.1);
        mockEmbeddingProvider.embed.mockResolvedValue([factEmbedding]);

        // 1. İlk semantik belleği ekle
        const first = await memoryStore.addMemory(
            "Kullanıcı 21 yaşında", 
            "user_fact", 
            8, 
            undefined, 
            { confidence: 0.9, memoryType: 'semantic' }
        );

        // 2. Güncel olgu ekle
        // semanticSimilarity 1.0 (aynı embedding), structuredVariance true (rakam değişti)
        const second = await memoryStore.addMemory(
            "Kullanıcı 22 yaşında", 
            "user_fact", 
            8, 
            undefined, 
            { confidence: 0.9, memoryType: 'semantic' }
        );

        expect(first.id).toBe(second.id);
        expect(second.isUpdate).toBe(true);

        // İçeriğin güncellendiğini doğrula
        const row = db.prepare("SELECT content FROM memories WHERE id = ?").get(first.id) as { content: string };
        expect(row.content).toBe("Kullanıcı 22 yaşında");
    });

    test('Test 3: Anlamsal çelişkileri ayrı kayıt olarak tutmalı (insert_new)', async () => {
        const prefEmbedding = new Array(1536).fill(0.3);
        mockEmbeddingProvider.embed.mockResolvedValue([prefEmbedding]);

        // 1. İlk tercihi ekle
        const first = await memoryStore.addMemory(
            "Kullanıcı kahveyi çok sever", 
            "preference", 
            7, 
            undefined, 
            { confidence: 0.9, memoryType: 'semantic' }
        );

        // 2. Anlamsal zıtlık ekle
        // Düşük confidence (floor altı) -> insert_new tetikler
        const second = await memoryStore.addMemory(
            "Kullanıcı kahveden nefret eder", 
            "preference", 
            7, 
            undefined, 
            { confidence: 0.5, memoryType: 'semantic' } 
        );

        expect(first.id).not.toBe(second.id);
        
        const count = db.prepare("SELECT COUNT(*) as count FROM memories WHERE category = 'preference'").get() as { count: number };
        expect(count.count).toBe(2);
    });

    test('Test 4: Birebir aynı bilgi geldiğinde metadata güncellemeli (skip)', async () => {
        const sameEmbedding = new Array(1536).fill(0.2);
        mockEmbeddingProvider.embed.mockResolvedValue([sameEmbedding]);

        const first = await memoryStore.addMemory("Aynı bilgi", "general", 5, undefined, { confidence: 0.9 });
        
        // İlk kayıtta access_count 0 olmalı (default)
        const rowBefore = db.prepare("SELECT access_count FROM memories WHERE id = ?").get(first.id) as { access_count: number };
        expect(rowBefore.access_count).toBe(0);

        const second = await memoryStore.addMemory("Aynı bilgi", "general", 5, undefined, { confidence: 0.9 });

        expect(first.id).toBe(second.id);
        expect(second.isUpdate).toBe(false); // Update content değil, metadata touch

        const rowAfter = db.prepare("SELECT access_count FROM memories WHERE id = ?").get(first.id) as { access_count: number };
        expect(rowAfter.access_count).toBe(1); // 0 + 1
    });

    test('Test 5: Anlamsal çelişki (Zıt fikir) durumunda yenisi eskini ezip geçmeli ve tarihçe tutmalı', async () => {
        const coffeeEmbedding = new Array(1536).fill(0.4);
        mockEmbeddingProvider.embed.mockResolvedValue([coffeeEmbedding]);

        // 1. Kullanıcı kahveyi sever
        const first = await memoryStore.addMemory(
            "Kullanıcı kahveyi sever", 
            "preference", 
            5, 
            undefined, 
            { confidence: 0.9 }
        );

        // 2. Kullanıcı fikrini değiştirdi: Kahveden nefret eder
        // Semantik benzerlik çok yüksek (tek kelime farkı) -> update tetiklenir
        const second = await memoryStore.addMemory(
            "Kullanıcı kahveden nefret eder", 
            "preference", 
            5, 
            undefined, 
            { confidence: 0.9 }
        );

        expect(first.id).toBe(second.id);
        expect(second.isUpdate).toBe(true);

        // DB'de yeni içerik olmalı
        const row = db.prepare("SELECT content FROM memories WHERE id = ?").get(first.id) as { content: string };
        expect(row.content).toBe("Kullanıcı kahveden nefret eder");

        // Tarihçede eski içerik olmalı
        const revision = db.prepare("SELECT content FROM memory_revisions WHERE memory_id = ? ORDER BY revision_number DESC LIMIT 1").get(first.id) as { content: string };
        expect(revision.content).toBe("Kullanıcı kahveyi sever");
    });

    test('Test 6: Detaylandırma (Enrichment) durumunda yeni içerik korunmalı', async () => {
        const detailEmbedding = new Array(1536).fill(0.5);
        mockEmbeddingProvider.embed.mockResolvedValue([detailEmbedding]);

        await memoryStore.addMemory("Ahmet bir yazılımcı", "user_fact", 5, undefined, { confidence: 0.9 });
        
        // Daha detaylı bilgi geldi
        const second = await memoryStore.addMemory(
            "Ahmet, Berlin'de yaşayan bir frontend yazılımcısıdır", 
            "user_fact", 
            5, 
            undefined, 
            { confidence: 0.9 }
        );

        // Yeni olan korunmalı (latest is truth)
        const row = db.prepare("SELECT content FROM memories ORDER BY id DESC LIMIT 1").get() as { content: string };
        expect(row.content).toBe("Ahmet, Berlin'de yaşayan bir frontend yazılımcısıdır");
    });
});
