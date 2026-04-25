/**
 * Insight Engine — Facade
 */

import type Database from 'better-sqlite3';
import { InsightStorage } from './storage.js';
import { InsightRetrieval } from './retrieval.js';
import { PatternDetector } from './detector.js';
import type { Observation, Insight, DetectedPattern, InsightEngineConfig } from './types.js';
import { DEFAULT_CONFIG } from './confidence.js';
import { logger } from '../../utils/logger.js';

export { type Insight, type InsightType, type InsightStatus, type Observation } from './types.js';
export { computeConfidence, getConfidenceLevel } from './confidence.js';

export class InsightEngine {
  private storage: InsightStorage;
  private retrieval: InsightRetrieval;
  private detector: PatternDetector;
  private config: InsightEngineConfig;

  constructor(
    private db: Database.Database,
    config?: Partial<InsightEngineConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.storage = new InsightStorage(db, this.config);
    this.retrieval = new InsightRetrieval(db);
    this.detector = new PatternDetector();
  }

  /**
   * Yeni observation kaydet.
   */
  observe(obs: Observation): void {
    this.detector.observe(obs);
  }

  /**
   * Birikmiş observation'lardan pattern'leri çıkar ve kaydet.
   */
  async processObservations(userId: string = 'default'): Promise<Insight[]> {
    const patterns = this.detector.detectPatterns();
    const insights: Insight[] = [];

    for (const pattern of patterns) {
      const insight = this.storage.upsertInsight(pattern, userId);
      insights.push(insight);
    }

    this.detector.clear();
    return insights;
  }

  /**
   * Sorguya göre alakalı insight'ları getir.
   */
  async getRelevantInsights(query: string, minConfidence?: number): Promise<Insight[]> {
    const results = await this.retrieval.getRelevantInsights(query, minConfidence ?? this.config.thresholds.medium);
    return results.map(r => r.insight);
  }

  /**
   * Yüksek confidence'lı insight'ları getir (sistem prompt'u için).
   */
  async getHighConfidenceInsights(threshold?: number): Promise<Insight[]> {
    return this.retrieval.getHighConfidenceInsights(threshold ?? this.config.thresholds.high);
  }

  /**
   * Tüm aktif insight'ları getir.
   */
  getActiveInsights(userId?: string): Insight[] {
    return this.storage.getActiveInsights(userId ?? 'default');
  }

  /**
   * Insight durumunu güncelle.
   */
  updateInsightStatus(id: number, status: 'active' | 'suppressed' | 'pruned'): boolean {
    return this.storage.updateStatus(id, status);
  }

  /**
   * Insight açıklamasını düzenle.
   */
  updateInsightDescription(id: number, description: string): boolean {
    return this.storage.updateDescription(id, description);
  }

  /**
   * Kullanıcı feedback'i uygula.
   */
  applyFeedback(insightId: number, isPositive: boolean): void {
    this.storage.applyFeedback(insightId, isPositive);
  }

  /**
   * Auto-prune çalıştır.
   */
  prune(): { pruned: number; suppressed: number } {
    return this.storage.pruneInsights();
  }

  /**
   * Insight'ları prompt context formatında döndür.
   */
  async buildInsightContext(query?: string): Promise<string> {
    let insights: Insight[];

    if (query) {
      insights = await this.getRelevantInsights(query);
    } else {
      insights = await this.getHighConfidenceInsights();
    }

    if (insights.length === 0) return '';

    const lines = insights.map(i => `• ${i.description} (güven: ${Math.round(i.confidence * 100)}%)`);
    return `\n[Kullanıcı Tercihleri ve Alışkanlıkları]\n${lines.join('\n')}\n`;
  }
}
