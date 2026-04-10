/**
 * ConversationManager - Konuşma CRUD işlemleri.
 * 
 * Sorumluluklar:
 * - Konuşma oluşturma, bulma, silme
 * - Mesaj ekleme ve geçmiş yönetimi
 * - Konuşma başlığı ve özet güncelleme
 * - Konuşma bağlamı ve transcript oluşturma
 */

import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { ConversationMessage, ChannelType } from '../../router/types.js';
import { logger } from '../../utils/logger.js';
import {
  CONVERSATION_TIMEOUT_MS,
  DEFAULT_USER_ID,
  DEFAULT_USER_NAME,
  type ConversationRow,
  type MessageRow,
  type RecentConversationRow,
} from '../types.js';
import { buildConversationTranscript } from '../contextUtils.js';
import type {
  ConversationTurnBundle,
  ConversationTranscriptBundle,
  ConversationSummary,
} from './types.js';

export class ConversationManager {
  constructor(private db: Database.Database) {}

  /**
   * Yeni konuşma oluşturur veya mevcut konuşmayı döndürür.
   * 2 saatten uzun süredir sessiz kalan konuşmalar yerine yenisi başlatılır.
   * Timeout tetiklendiğinde previousConversationId ile eski konuşma ID'si döndürülür.
   */
  getOrCreateConversation(
    channelType: ChannelType,
    channelId: string,
    userName?: string
  ): { conversationId: string; previousConversationId?: string } {
    const resolvedUserName = userName || DEFAULT_USER_NAME;
    // Son aktif konuşmayı bul
    const existing = this.db.prepare(`
      SELECT id, updated_at FROM conversations
      WHERE channel_type = ? AND channel_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(channelType, channelId) as { id: string; updated_at: string } | undefined;

    if (existing) {
      // SQLite CURRENT_TIMESTAMP is always UTC but may lack 'Z' or 'T'.
      // Normalize to ISO 8601 before parsing to avoid local-timezone pitfalls.
      const raw = existing.updated_at;
      const dateStr = raw.includes('T')
        ? (raw.endsWith('Z') ? raw : raw + 'Z')
        : raw.replace(' ', 'T') + 'Z';
      const lastUpdate = new Date(dateStr).getTime();
      const now = Date.now();

      // Timeout kontrolü — 2 saatten eskiyse yeni konuşma başlat
      if (now - lastUpdate < CONVERSATION_TIMEOUT_MS) {
        this.db.prepare(`UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(existing.id);
        return { conversationId: existing.id };
      }
    }

    // Yeni oluştur
    const id = uuidv4();
    this.db.prepare(`
      INSERT INTO conversations (id, channel_type, channel_id, user_id, user_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, channelType, channelId, DEFAULT_USER_ID, resolvedUserName);

    return {
      conversationId: id,
      previousConversationId: existing?.id,
    };
  }

  /**
   * Runtime'ın bir kullanıcı turu için ihtiyaç duyduğu konuşma başlangıç adımlarını tekleştirir.
   * Konuşma bulma/açma, kullanıcı mesajını ekleme, ilk başlık atama ve history çekme burada yapılır.
   */
  beginConversationTurn(
    channelType: ChannelType,
    channelId: string,
    userName: string | undefined,
    message: ConversationMessage,
    historyLimit: number = 100,
    onEmbeddingCompute?: (messageId: number, content: string) => Promise<void>
  ): ConversationTurnBundle {
    const { conversationId, previousConversationId } = this.getOrCreateConversation(
      channelType,
      channelId,
      userName,
    );

    this.addMessage(conversationId, message, onEmbeddingCompute);

    const history = this.getConversationHistory(conversationId, historyLimit);
    const userMessages = history.filter(entry => entry.role === 'user');
    if (userMessages.length === 1) {
      const title = message.content.substring(0, 80).replace(/\n/g, ' ');
      this.updateConversationTitle(conversationId, title);
    }

    return {
      conversationId,
      previousConversationId,
      history,
    };
  }

  /**
   * Konuşmaya mesaj ekler.
   */
  addMessage(
    conversationId: string,
    message: ConversationMessage,
    onEmbeddingCompute?: (messageId: number, content: string) => Promise<void>
  ): void {
    const result = this.db.prepare(`
      INSERT INTO messages (conversation_id, role, content, tool_calls, tool_results, attachments)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      conversationId,
      message.role,
      message.content,
      message.toolCalls ? JSON.stringify(message.toolCalls) : null,
      message.toolResults ? JSON.stringify(message.toolResults) : null,
      message.attachments && message.attachments.length > 0 ? JSON.stringify(message.attachments) : null
    );

    // Konuşma updated_at güncelle
    this.db.prepare(`UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(conversationId);

    // Embedding hesapla — user/assistant, anlamlı uzunlukta içerikler
    if (onEmbeddingCompute && (message.role === 'user' || message.role === 'assistant') && message.content.length > 20) {
      const msgId = Number(result.lastInsertRowid);
      onEmbeddingCompute(msgId, message.content).catch(err => {
        logger.warn({ err: err }, `[Memory] Mesaj embedding başarısız (id=${msgId}):`);
      });
    }
  }

  /**
   * Konuşma geçmişini döndürür — son N mesajı kronolojik sırada.
   */
  getConversationHistory(conversationId: string, limit: number = 50): ConversationMessage[] {
    // Son N mesajı al, sonra kronolojik sıraya koy
    const rows = this.db.prepare(`
      SELECT * FROM (
        SELECT id, role, content, tool_calls, tool_results, attachments, created_at
        FROM messages
        WHERE conversation_id = ?
        ORDER BY id DESC
        LIMIT ?
      ) ORDER BY id ASC
    `).all(conversationId, limit) as MessageRow[];

    return rows.map(row => ({
      role: row.role as ConversationMessage['role'],
      content: row.content,
      timestamp: new Date(row.created_at.endsWith('Z') ? row.created_at : row.created_at.replace(' ', 'T') + 'Z'),
      toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
      toolResults: row.tool_results ? JSON.parse(row.tool_results) : undefined,
      attachments: row.attachments ? JSON.parse(row.attachments) : undefined,
    }));
  }

  /**
   * Tam konuşma bağlamını oluşturur.
   */
  getConversationContext(conversationId: string): import('../../router/types.js').ConversationContext | null {
    const conv = this.db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(conversationId) as ConversationRow | undefined;
    if (!conv) return null;

    const history = this.getConversationHistory(conversationId);

    return {
      conversationId: conv.id,
      channelType: conv.channel_type as ChannelType,
      channelId: conv.channel_id,
      userId: conv.user_id,
      userName: conv.user_name,
      history,
    };
  }

  /**
   * Son konuşmaları listeler (başlık ve mesaj sayısı ile).
   * LEFT JOIN + GROUP BY ile — correlated subquery yerine tek tarama.
   */
  getRecentConversations(limit: number = 20): RecentConversationRow[] {
    // OPT-4: message_count artık trigger ile sürdürülüyor, correlated subquery kaldırıldı.
    // OPT F-18: SELECT * yerine sadece gerekli sütunları çek (summary gibi uzun text'ler atlanır).
    return this.db.prepare(`
      SELECT
        c.id, c.title, c.channel_type, c.channel_id, c.user_id, c.user_name,
        c.created_at, c.updated_at, c.message_count, c.is_summarized,
        (SELECT content FROM messages WHERE conversation_id = c.id AND role = 'user' ORDER BY id ASC LIMIT 1) as first_message
      FROM conversations c
      ORDER BY c.updated_at DESC
      LIMIT ?
    `).all(limit) as RecentConversationRow[];
  }

  /**
   * Konuşma başlığını günceller.
   * @param isCustom - true ise kullanıcı manuel değiştirmiş (LLM üzerine yazamaz)
   */
  updateConversationTitle(conversationId: string, title: string, isCustom: boolean = false): void {
    if (isCustom) {
      // Manuel güncelleme: is_title_custom = 1
      this.db.prepare(`
        UPDATE conversations SET title = ?, is_title_custom = 1 WHERE id = ?
      `).run(title, conversationId);
    } else {
      // LLM güncellemesi: sadece is_title_custom = 0 ise güncelle
      this.db.prepare(`
        UPDATE conversations SET title = ? WHERE id = ? AND is_title_custom = 0
      `).run(title, conversationId);
    }
  }

  /**
   * Konuşmanın özetini kaydeder ve is_summarized bayrağını ayarlar.
   */
  updateConversationSummary(conversationId: string, summary: string): void {
    this.db.prepare(`
      UPDATE conversations
      SET summary = ?, is_summarized = 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(summary, conversationId);
  }

  /**
   * Özetlenmiş son N konuşmayı döndürür.
   * Sistem promptuna konuşma geçmişi bağlamı olarak enjekte edilir.
   */
  getRecentConversationSummaries(limit: number = 5): ConversationSummary[] {
    return this.db.prepare(`
      SELECT id, title, summary, updated_at
      FROM conversations
      WHERE is_summarized = 1 AND summary != ''
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(limit) as ConversationSummary[];
  }

  /**
   * Konuşmayı LLM tüketimi için normalize eder.
   * Runtime, history + userName + düzleştirilmiş transcript'i tek niyet tabanlı çağrı ile alır.
   */
  getConversationTranscriptBundle(conversationId: string, limit: number = 100): ConversationTranscriptBundle | null {
    const conv = this.db.prepare(`
      SELECT user_name
      FROM conversations
      WHERE id = ?
    `).get(conversationId) as Pick<ConversationRow, 'user_name'> | undefined;

    if (!conv) {
      return null;
    }

    const history = this.getConversationHistory(conversationId, limit);
    return buildConversationTranscript(history, conv.user_name);
  }

  /**
   * Konuşmayı siler.
   * @returns silme başarılıysa true, konuşma bulunamadıysa false
   */
  deleteConversation(conversationId: string): boolean {
    // Önce silinecek mesajların ID'lerini al → message_embeddings temizliği için
    const msgIds = this.db.prepare(
      `SELECT id FROM messages WHERE conversation_id = ?`
    ).all(conversationId) as Array<{ id: number }>;

    // Orphan message embedding'lerini temizle
    if (msgIds.length > 0) {
      try {
        const deleteEmbStmt = this.db.prepare(`DELETE FROM message_embeddings WHERE rowid = CAST(? AS INTEGER)`);
        const cleanupEmbeddings = this.db.transaction((ids: Array<{ id: number }>) => {
          for (const { id } of ids) {
            deleteEmbStmt.run(BigInt(id));
          }
        });
        cleanupEmbeddings(msgIds);
      } catch (err) {
        logger.warn({ err: err }, `[Memory] Mesaj embedding temizleme başarısız (conv=${conversationId}):`);
      }
    }

    const { changes: deletedMsgs } = this.db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).run(conversationId);
    const { changes: deletedConvs } = this.db.prepare(`DELETE FROM conversations WHERE id = ?`).run(conversationId);

    if (deletedMsgs > 0 || deletedConvs > 0) {
      logger.info(`[Memory] Silindi: ${deletedMsgs} mesaj, ${deletedConvs} konuşma (conv=${conversationId})`);
    }

    return deletedConvs > 0;
  }

  /**
   * Birden çok konuşmayı tek bir transaction içinde siler.
   */
  deleteConversations(conversationIds: string[]): { deletedCount: number, results: { id: string, deleted: boolean }[] } {
    if (!conversationIds || conversationIds.length === 0) return { deletedCount: 0, results: [] };

    const results: { id: string; deleted: boolean }[] = [];
    
    const runBulkDelete = this.db.transaction((ids: string[]) => {
      for (const id of ids) {
        let deleted = false;
        try {
          const msgIds = this.db.prepare(`SELECT id FROM messages WHERE conversation_id = ?`).all(id) as Array<{ id: number }>;

          if (msgIds.length > 0) {
            const deleteEmbStmt = this.db.prepare(`DELETE FROM message_embeddings WHERE rowid = CAST(? AS INTEGER)`);
            for (const { id: mId } of msgIds) {
              deleteEmbStmt.run(BigInt(mId));
            }
          }

          this.db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).run(id);
          const { changes: deletedConvs } = this.db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
          deleted = deletedConvs > 0;
        } catch (err) {
          logger.warn({ err }, `[Memory] Toplu silme sırasında hata (conv=${id})`);
        }
        results.push({ id, deleted });
      }
    });

    runBulkDelete(conversationIds);

    const deletedCount = results.filter(r => r.deleted).length;
    if (deletedCount > 0) {
      logger.info(`[Memory] Toplu silme tamamlandı: ${deletedCount}/${conversationIds.length} konuşma silindi.`);
    }

    return { deletedCount, results };
  }
}
