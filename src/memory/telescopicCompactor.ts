import type Database from 'better-sqlite3';
import type { LLMProvider } from '../llm/provider.js';
import { logger } from '../utils/logger.js';
import type { MessageRow } from './types.js';

/** Seviye başına mesaj eşik değerleri — bu sayıda mesaj birikince üst seviyeye merge edilir */
const LEVEL_THRESHOLDS: Record<number, number> = {
    1: 40,   // Level 1: 40+ mesaj olunca özetle
    2: 120,  // Level 2: 120+ mesajlık özet olunca merge et
    3: 360,  // Level 3: 360+ mesajlık özet olunca merge et
};

/** Her seviyede retain edilecek ham mesaj sayısı */
const LEVEL_RETAIN: Record<number, number> = {
    1: 20,
    2: 30,
    3: 50,
};

/** Maksimum telescopic seviye */
const MAX_LEVEL = 3;

export class TelescopicCompactor {
    constructor(
        private db: Database.Database,
        private llmProvider: LLMProvider
    ) {}

    /**
     * Konuşmanın çok uzun olup olmadığını kontrol eder ve gerekiyorsa sıkıştırma yapar.
     * Çok seviyeli (Level 1→2→3) telescopic merge uygular.
     * 
     * Level 1: Ham mesajları özetle (en sık)
     * Level 2: Level 1 özetlerini merge et (daha seyrek)
     * Level 3: Level 2 özetlerini merge et (en seyrek, en yoğun)
     * 
     * @param conversationId Sıkıştırılacak konuşma ID'si
     * @param retainRecentCount Sıkıştırılmayıp ham olarak bırakılacak en son mesaj sayısı
     * @returns Sıkıştırma yapıldıysa true, yapılmadıysa false
     */
    async compactSession(conversationId: string, retainRecentCount: number = 20): Promise<boolean> {
        try {
            // ── LEVEL MERGE: Üst seviyelerdeki özetleri kontrol et ──
            let didMerge = false;
            for (let level = MAX_LEVEL - 1; level >= 1; level--) {
                const merged = await this.tryMergeLevel(conversationId, level);
                if (merged) didMerge = true;
            }

            // ── LEVEL 1: Ham mesajları özetle ──
            const compacted = await this.compactLevel1(conversationId, retainRecentCount);

            return didMerge || compacted;
        } catch (error) {
            logger.error({ err: error }, `[TelescopicCompactor] Sıkıştırma hatası: ${conversationId}`);
            return false;
        }
    }

    /**
     * Level 1 sıkıştırma — ham mesajları özetle.
     */
    private async compactLevel1(conversationId: string, retainRecentCount: number): Promise<boolean> {
        const messages = this.db.prepare(`
            SELECT id, role, content, created_at 
            FROM messages 
            WHERE conversation_id = ? 
            ORDER BY id ASC
        `).all(conversationId) as MessageRow[];

        if (messages.length <= retainRecentCount) {
            return false;
        }

        const messagesToCompact = messages.slice(0, messages.length - retainRecentCount);
        
        // Daha önce zaten sıkıştırılmış kısımları atla
        const lastSummary = this.db.prepare(`
            SELECT MAX(end_msg_id) as last_id 
            FROM telescopic_summaries 
            WHERE conversation_id = ? AND level = 1
        `).get(conversationId) as { last_id: number | null };

        const lastSummarizedId = lastSummary?.last_id || 0;
        const unsummarizedToCompact = messagesToCompact.filter(m => m.id > lastSummarizedId);

        const threshold = LEVEL_THRESHOLDS[1] ?? 40;
        if (unsummarizedToCompact.length < threshold) {
            return false; // Yeterli mesaj yok — threshold altında sıkıştırma anlamsız
        }

        const startMsgId = unsummarizedToCompact[0]!.id;
        const endMsgId = unsummarizedToCompact[unsummarizedToCompact.length - 1]!.id;

        logger.info(`[TelescopicCompactor] L1: ${conversationId} — ${unsummarizedToCompact.length} mesaj sıkıştırılıyor (Msg ID: ${startMsgId}-${endMsgId})...`);

        const summary = await this.generateSummary(unsummarizedToCompact, 1);

        this.db.prepare(`
            INSERT INTO telescopic_summaries (conversation_id, start_msg_id, end_msg_id, summary, level)
            VALUES (?, ?, ?, ?, 1)
        `).run(conversationId, startMsgId, endMsgId, summary);

        // Özetlenmiş mesajları archive olarak işaretle (silme!)
        // messages tablosunda bir is_archived kolonu yoksa, silmek yerine bırakıyoruz.
        // Telescopic summary varsa, context yüklenirken bu mesajlar atlanır.
        logger.info(`[TelescopicCompactor] L1 sıkıştırma başarılı: ${conversationId}`);
        return true;
    }

    /**
     * Üst seviye merge — alt seviye özetlerini birleştirerek üst seviye özet oluştur.
     * Level N özetlerini → Level N+1 özetine merge eder.
     */
    private async tryMergeLevel(conversationId: string, sourceLevel: number): Promise<boolean> {
        const targetLevel = sourceLevel + 1;
        const threshold = LEVEL_THRESHOLDS[targetLevel] ?? 100;

        // Bu seviyedeki özetleri al
        const summaries = this.db.prepare(`
            SELECT id, start_msg_id, end_msg_id, summary, created_at
            FROM telescopic_summaries 
            WHERE conversation_id = ? AND level = ?
            ORDER BY start_msg_id ASC
        `).all(conversationId, sourceLevel) as Array<{
            id: number; start_msg_id: number; end_msg_id: number; summary: string; created_at: string;
        }>;

        if (summaries.length < 3) {
            return false; // Merge için yeterli özet yok
        }

        // Zaten merge edilmiş özetleri atla — target level'da aynı range var mı kontrol et
        const lastMerged = this.db.prepare(`
            SELECT MAX(end_msg_id) as last_id 
            FROM telescopic_summaries 
            WHERE conversation_id = ? AND level = ?
        `).get(conversationId, targetLevel) as { last_id: number | null };

        const lastMergedEndId = lastMerged?.last_id || 0;
        const unmergedSummaries = summaries.filter(s => s.end_msg_id > lastMergedEndId);

        if (unmergedSummaries.length < 3) {
            return false;
        }

        // Gruplama: threshold sayıda mesajı kapsayan özetleri birleştir
        // Her merge grubu en az threshold mesaj aralığını kapsamalı
        let didMerge = false;
        let groupStart = 0;

        while (groupStart < unmergedSummaries.length) {
            let groupEnd = groupStart;
            let coveredMsgCount = 0;

            // Threshold'u geçen kadar özeti grupla
            while (groupEnd < unmergedSummaries.length && coveredMsgCount < threshold) {
                coveredMsgCount += unmergedSummaries[groupEnd]!.end_msg_id - unmergedSummaries[groupEnd]!.start_msg_id + 1;
                groupEnd++;
            }

            // En az 3 özet birleşmeli
            if (groupEnd - groupStart < 3) break;

            const group = unmergedSummaries.slice(groupStart, groupEnd);
            const startMsgId = group[0]!.start_msg_id;
            const endMsgId = group[group.length - 1]!.end_msg_id;

            logger.info(`[TelescopicCompactor] L${sourceLevel}→L${targetLevel}: ${conversationId} — ${group.length} özet merge ediliyor (Msg ID: ${startMsgId}-${endMsgId})...`);

            const mergedSummary = await this.generateSummaryFromSummaries(group, targetLevel);

            this.db.prepare(`
                INSERT INTO telescopic_summaries (conversation_id, start_msg_id, end_msg_id, summary, level)
                VALUES (?, ?, ?, ?, ?)
            `).run(conversationId, startMsgId, endMsgId, mergedSummary, targetLevel);

            didMerge = true;
            groupStart = groupEnd;
        }

        return didMerge;
    }

    /**
     * Ham mesajlardan Level 1 özet üretir.
     */
    private async generateSummary(messages: MessageRow[], level: number): Promise<string> {
        const transcript = messages.map(m => `[${m.role.toUpperCase()}] (${m.id}): ${m.content}`).join('\n\n');
        return this.callLLMForSummary(transcript, level, messages.length);
    }

    /**
     * Alt seviye özetlerinden üst seviye özet üretir.
     */
    private async generateSummaryFromSummaries(
        summaries: Array<{ summary: string; start_msg_id: number; end_msg_id: number }>,
        level: number
    ): Promise<string> {
        const combined = summaries.map((s, i) =>
            `--- Bölüm ${i + 1} (Mesaj ${s.start_msg_id}-${s.end_msg_id}) ---\n${s.summary}`
        ).join('\n\n');

        return this.callLLMForSummary(combined, level, summaries.length);
    }

    /**
     * LLM çağrısı ile özet üretir.
     */
    private async callLLMForSummary(content: string, level: number, segmentCount: number): Promise<string> {
        const levelDescriptions: Record<number, string> = {
            1: 'ilk seviye detaylı özet — tüm önemli kararları, teknik spesifikasyonları ve kullanıcı tercihlerini koru',
            2: 'ikinci seviye birleştirilmiş özet — alt özetleri tutarlı bir anlatıda birleştir, tekrarları elee',
            3: 'en üst seviye yoğun özet — sadece en kritik kararları, sonuçları ve uzun vadeli bağlamı koru',
        };

        const levelDesc = levelDescriptions[level] ?? 'özet';

        const prompt = `Sen bir Telescopic Memory (Kademeli Bellek) özetleyicisisin.
Şu an Level ${level} (${levelDesc}) özeti üreteceksin. ${segmentCount} segment birleştirilecek.

ÖNEMLİ KURALLAR:
1. Tüm mesajlara eşit ağırlık VERME.
2. Kullanıcının istekleri, kararları, projeyle ilgili detayları, teknik spesifikasyonlar ve verilen sözler/kararlar ÇOK ÖNEMLİDİR — bunları asla kaybetme.
3. Selamlaşma, basit onaylar ("tamam", "anlıyorum") ve hata mesajları gibi önemsiz detayları tamamen sil.
4. Özet, diğer bir AI ajanı tarafından okunup ana bağlamı anlaması için kullanılacaktır.
5. ${level >= 2 ? 'Alt özetlerdeki tekrarlanan bilgileri birleştir, sadece en güncel halini koru.' : 'Doğrudan konuşmanın geldiği noktayı ve alınan kararları özetle.'}
6. Madde işaretli, yapılandırılmış format kullan.

İÇERİK:
${content}`;

        const response = await this.llmProvider.chat([
            { role: 'system', content: 'You are an expert context compressor for AI agents. Keep high-value information, drop low-value chatter.' },
            { role: 'user', content: prompt }
        ], { temperature: 0.3 });

        return response.content.trim();
    }

    /**
     * Bir konuşma için tüm seviyelerdeki telescopic özetleri döndürür.
     * Context yüklenirken çağrılır — ham mesajlar yerine özetler kullanılır.
     */
    getSummariesForConversation(conversationId: string, limit: number = 10): Array<{
        level: number; start_msg_id: number; end_msg_id: number; summary: string;
    }> {
        // En üst seviyedeki özetleri öncelikle döndür
        return this.db.prepare(`
            SELECT level, start_msg_id, end_msg_id, summary
            FROM telescopic_summaries
            WHERE conversation_id = ?
            ORDER BY level DESC, start_msg_id DESC
            LIMIT ?
        `).all(conversationId, limit) as Array<{
            level: number; start_msg_id: number; end_msg_id: number; summary: string;
        }>;
    }
}
