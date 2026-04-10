/**
 * GraphRAG Rollback Manager — FULL phase'ten geri alma mekanizması.
 *
 * FULL phase'te sorun oluştuğunda hızlıca PARTIAL veya OFF phase'e
 * geri dönmek için kullanılır.
 *
 * Rollback Stratejileri:
 * 1. Emergency Rollback: Acil olarak PARTIAL phase'e dön
 * 2. Gradual Rollback: Kademeli olarak geri çekil (FULL → PARTIAL → SHADOW → OFF)
 * 3. Timed Rollback: Belirli bir süre sonra otomatik rollback
 */

import { GraphRAGConfigManager, GraphRAGRolloutPhase } from './config.js';
import { logger } from '../../utils/logger.js';

/** Rollback reason enum */
export enum RollbackReason {
  HIGH_ERROR_RATE = 'high_error_rate',
  TIMEOUT_ISSUES = 'timeout_issues',
  MEMORY_PRESSURE = 'memory_pressure',
  PERFORMANCE_DEGRADATION = 'performance_degradation',
  MANUAL_TRIGGER = 'manual_trigger',
  UNKNOWN = 'unknown',
}

/** Rollback event interface */
export interface RollbackEvent {
  timestamp: Date;
  fromPhase: GraphRAGRolloutPhase;
  toPhase: GraphRAGRolloutPhase;
  reason: RollbackReason;
  triggeredBy: string;
  metadata?: Record<string, unknown>;
}

/**
 * GraphRAG Rollback Manager.
 */
export class GraphRAGRollbackManager {
  private static rollbackHistory: RollbackEvent[] = [];
  private static lastRollbackTime: Date | null = null;
  private static cooldownMs: number = 30 * 60 * 1000; // 30 dakika cooldown
  private static cooldownUntilTimestamp: number = 0;

  /**
   * Acil geri alma — FULL → PARTIAL.
   *
   * @param reason - Rollback nedeni
   * @param triggeredBy - Kimin tetiklediği
   */
  static async emergencyRollback(
    reason: RollbackReason = RollbackReason.UNKNOWN,
    triggeredBy: string = 'system',
  ): Promise<void> {
    const currentPhase = GraphRAGConfigManager.getCurrentPhase();

    if (currentPhase === GraphRAGRolloutPhase.OFF) {
      logger.warn('[GraphRAGRollback] Already at OFF phase, no rollback needed');
      return;
    }

    // Cooldown kontrolü
    if (this.isOnCooldown()) {
      logger.warn('[GraphRAGRollback] Cooldown active, ignoring emergency rollback');
      return;
    }

    const targetPhase = GraphRAGRolloutPhase.PARTIAL;

    // Rollback'i kaydet
    this.recordRollbackEvent(currentPhase, targetPhase, reason, triggeredBy);

    // Phase'i değiştir
    GraphRAGConfigManager.setRolloutPhase(targetPhase);

    // Cooldown başlat
    this.startCooldown();

    logger.error({
      msg: 'EMERGENCY ROLLBACK: GraphRAG returned to PARTIAL phase',
      from: GraphRAGRolloutPhase[currentPhase],
      to: GraphRAGRolloutPhase[targetPhase],
      reason,
      triggeredBy,
    });
  }

  /**
   * Kademeli geri alma — belirtilen adım sayısı kadar geri çekil.
   *
   * @param steps - Kaç adım geri çekileceği (default: 1)
   * @param reason - Rollback nedeni
   * @param triggeredBy - Kimin tetiklediği
   */
  static async gradualRollback(
    steps: number = 1,
    reason: RollbackReason = RollbackReason.UNKNOWN,
    triggeredBy: string = 'system',
  ): Promise<void> {
    const current = GraphRAGConfigManager.getCurrentPhase();
    const target = Math.max(GraphRAGRolloutPhase.OFF, current - steps) as GraphRAGRolloutPhase;

    if (target === current) {
      logger.warn('[GraphRAGRollback] Already at minimum phase, no rollback needed');
      return;
    }

    // Cooldown kontrolü
    if (this.isOnCooldown()) {
      logger.warn('[GraphRAGRollback] Cooldown active, ignoring gradual rollback');
      return;
    }

    // Rollback'i kaydet
    this.recordRollbackEvent(current, target, reason, triggeredBy);

    // Phase'i değiştir
    GraphRAGConfigManager.setRolloutPhase(target);

    // Cooldown başlat
    this.startCooldown();

    logger.warn({
      msg: 'GRADUAL ROLLBACK',
      from: GraphRAGRolloutPhase[current],
      to: GraphRAGRolloutPhase[target],
      steps,
      reason,
      triggeredBy,
    });
  }

  /**
   * Belirli bir phase'e doğrudan rollback.
   *
   * @param targetPhase - Hedef phase
   * @param reason - Rollback nedeni
   * @param triggeredBy - Kimin tetiklediği
   */
  static async rollbackToPhase(
    targetPhase: GraphRAGRolloutPhase,
    reason: RollbackReason = RollbackReason.UNKNOWN,
    triggeredBy: string = 'system',
  ): Promise<void> {
    const current = GraphRAGConfigManager.getCurrentPhase();

    if (targetPhase === current) {
      logger.warn('[GraphRAGRollback] Already at target phase, no rollback needed');
      return;
    }

    if (targetPhase > current) {
      logger.warn('[GraphRAGRollback] Target phase is higher than current, use advancePhase instead');
      return;
    }

    // Cooldown kontrolü
    if (this.isOnCooldown()) {
      logger.warn('[GraphRAGRollback] Cooldown active, ignoring rollback');
      return;
    }

    // Rollback'i kaydet
    this.recordRollbackEvent(current, targetPhase, reason, triggeredBy);

    // Phase'i değiştir
    GraphRAGConfigManager.setRolloutPhase(targetPhase);

    // Cooldown başlat
    this.startCooldown();

    logger.warn({
      msg: 'ROLLBACK TO PHASE',
      from: GraphRAGRolloutPhase[current],
      to: GraphRAGRolloutPhase[targetPhase],
      reason,
      triggeredBy,
    });
  }

  /**
   * Son rollback zamanını getir.
   */
  static getLastRollbackTime(): Date | null {
    return this.lastRollbackTime;
  }

  /**
   * Rollback geçmişini getir.
   */
  static getRollbackHistory(): RollbackEvent[] {
    return [...this.rollbackHistory];
  }

  /**
   * Cooldown durumunu getir.
   */
  static isOnCooldown(): boolean {
    return Date.now() < this.cooldownUntilTimestamp;
  }

  /**
   * Cooldown'u sıfırla (manuel override için).
   */
  static resetCooldown(): void {
    this.cooldownUntilTimestamp = 0;
    logger.info('[GraphRAGRollback] Cooldown reset');
  }

  /**
   * Rollback event'ini kaydet.
   */
  private static recordRollbackEvent(
    fromPhase: GraphRAGRolloutPhase,
    toPhase: GraphRAGRolloutPhase,
    reason: RollbackReason,
    triggeredBy: string,
  ): void {
    const event: RollbackEvent = {
      timestamp: new Date(),
      fromPhase,
      toPhase,
      reason,
      triggeredBy,
    };

    this.rollbackHistory.push(event);
    this.lastRollbackTime = event.timestamp;

    // Geçmiş boyutunu sınırla (son 100 event)
    if (this.rollbackHistory.length > 100) {
      this.rollbackHistory = this.rollbackHistory.slice(-100);
    }
  }

  /**
   * Cooldown'u başlat.
   */
  private static startCooldown(): void {
    this.cooldownUntilTimestamp = Date.now() + this.cooldownMs;
    logger.debug(`[GraphRAGRollback] Cooldown started for ${this.cooldownMs / 1000}s`);
  }

  /**
   * Cooldown süresini getir (ms).
   */
  static getCooldownMs(): number {
    return this.cooldownMs;
  }

  /**
   * Cooldown süresini ayarla (ms).
   */
  static setCooldownMs(ms: number): void {
    this.cooldownMs = ms;
  }
}
