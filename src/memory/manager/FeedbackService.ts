/**
 * FeedbackService - Kullanıcı feedback yönetimi.
 * 
 * Sorumluluklar:
 * - Feedback kaydetme (positive/negative)
 * - Konuşma bazlı feedback listeleme
 * - Mesaj bazlı feedback sorgulama
 */

import type Database from 'better-sqlite3';
import type { FeedbackRow, FeedbackInput } from '../types.js';

export class FeedbackService {
  constructor(private db: Database.Database) {}

  /**
   * Kullanıcı feedback'ini kaydeder.
   */
  saveFeedback(input: FeedbackInput): FeedbackRow {
    const stmt = this.db.prepare(`
      INSERT INTO feedback (message_id, conversation_id, type, comment, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      input.messageId,
      input.conversationId,
      input.type,
      input.comment || null,
      input.timestamp
    );

    return {
      id: Number(result.lastInsertRowid),
      message_id: input.messageId,
      conversation_id: input.conversationId,
      type: input.type,
      comment: input.comment || null,
      created_at: input.timestamp,
    };
  }

  /**
   * Bir konuşmaya ait tüm feedback'leri getirir.
   */
  getFeedbacks(conversationId: string): FeedbackRow[] {
    const stmt = this.db.prepare(`
      SELECT id, message_id, conversation_id, type, comment, created_at
      FROM feedback
      WHERE conversation_id = ?
      ORDER BY created_at DESC
    `);
    return stmt.all(conversationId) as FeedbackRow[];
  }

  /**
   * Bir mesaja ait feedback'i getirir.
   */
  getFeedbackByMessageId(messageId: string): FeedbackRow | null {
    const stmt = this.db.prepare(`
      SELECT id, message_id, conversation_id, type, comment, created_at
      FROM feedback
      WHERE message_id = ?
      LIMIT 1
    `);
    return stmt.get(messageId) as FeedbackRow | null;
  }
}
