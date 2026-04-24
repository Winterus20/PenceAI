import type Database from 'better-sqlite3';
import type { LLMProvider } from '../llm/provider.js';
import { logger } from '../utils/logger.js';
import type { MessageRow } from './types.js';

export class TelescopicCompactor {
    constructor(
        private db: Database.Database,
        private llmProvider: LLMProvider
    ) {}

    /**
     * Konuşmanın çok uzun olup olmadığını kontrol eder ve gerekiyorsa sıkıştırma yapar.
     * @param conversationId Sıkıştırılacak konuşma ID'si
     * @param retainRecentCount Sıkıştırılmayıp ham olarak bırakılacak en son mesaj sayısı
     * @returns Sıkıştırma yapıldıysa true, yapılmadıysa false
     */
    async compactSession(conversationId: string, retainRecentCount: number = 20): Promise<boolean> {
        try {
            // Konuşmadaki tüm mesajları ID sırasına göre al
            const messages = this.db.prepare(`
                SELECT id, role, content, created_at 
                FROM messages 
                WHERE conversation_id = ? 
                ORDER BY id ASC
            `).all(conversationId) as MessageRow[];

            if (messages.length <= retainRecentCount) {
                return false; // Sıkıştırmaya gerek yok
            }

            // Sıkıştırılacak mesajları ayır
            const messagesToCompact = messages.slice(0, messages.length - retainRecentCount);
            
            // Eğer daha önce zaten sıkıştırılmış kısımlar varsa, onları tekrar sıkıştırmayalım.
            // Bunun için telescopic_summaries tablosundan en büyük end_msg_id'yi bulalım.
            const lastSummary = this.db.prepare(`
                SELECT MAX(end_msg_id) as last_id 
                FROM telescopic_summaries 
                WHERE conversation_id = ?
            `).get(conversationId) as { last_id: number | null };

            const lastSummarizedId = lastSummary?.last_id || 0;
            
            // Sadece daha önce sıkıştırılmamış olanları al
            const unsummarizedToCompact = messagesToCompact.filter(m => m.id > lastSummarizedId);

            if (unsummarizedToCompact.length < 5) { // En az 5 mesaj birikmişse özetle
                return false;
            }

            const startMsgId = unsummarizedToCompact[0]!.id;
            const endMsgId = unsummarizedToCompact[unsummarizedToCompact.length - 1]!.id;

            logger.info(`[TelescopicCompactor] Konuşma ${conversationId} için ${unsummarizedToCompact.length} mesaj sıkıştırılıyor (Msg ID: ${startMsgId}-${endMsgId})...`);

            const summary = await this.generateSummary(unsummarizedToCompact);

            this.db.prepare(`
                INSERT INTO telescopic_summaries (conversation_id, start_msg_id, end_msg_id, summary, level)
                VALUES (?, ?, ?, ?, ?)
            `).run(conversationId, startMsgId, endMsgId, summary, 1);

            logger.info(`[TelescopicCompactor] Sıkıştırma başarılı: ${conversationId}`);
            return true;
        } catch (error) {
            logger.error({ err: error }, `[TelescopicCompactor] Sıkıştırma hatası: ${conversationId}`);
            return false;
        }
    }

    private async generateSummary(messages: MessageRow[]): Promise<string> {
        const transcript = messages.map(m => `[${m.role.toUpperCase()}] (${m.id}): ${m.content}`).join('\n\n');
        
        const prompt = `Sen bir Telescopic Memory (Kademeli Bellek) özetleyicisisin.
Aşağıdaki sohbet geçmişini özetleyerek bağlamı korumalısın.

ÖNEMLİ KURALLAR:
1. Tüm mesajlara eşit ağırlık VERME. 
2. Kullanıcının istekleri, kararları, projeyle ilgili detayları, teknik spesifikasyonlar ve verilen sözler/kararlar ÇOK ÖNEMLİDİR, bu detayları asla kaybetme.
3. Selamlaşma, basit onaylar ("tamam", "anlıyorum") ve hata mesajları gibi önemsiz detayları tamamen sil.
4. Özet, diğer bir AI ajanı tarafından okunup ana bağlamı anlaması için kullanılacaktır. Bu yüzden teknik detayları net ve yapılandırılmış (örneğin madde işaretli) olarak yaz.
5. "Kullanıcı dedi ki", "Asistan dedi ki" gibi girişler yerine, doğrudan konuşmanın geldiği noktayı ve alınan kararları özetle.

SOHBET GEÇMİŞİ:
${transcript}`;

        const response = await this.llmProvider.chat([
            { role: 'system', content: 'You are an expert context compressor for AI agents. Keep high-value information, drop low-value chatter.' },
            { role: 'user', content: prompt }
        ], { temperature: 0.3 }); // Daha stabil özetler için düşük sıcaklık

        return response.content.trim();
    }
}
