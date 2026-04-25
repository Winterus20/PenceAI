/**
 * Insight güven skoru hesaplama modülü
 * 5 boyutlu confidence modeli
 */

import type { ConfidenceDimensions, InsightEngineConfig } from './types.js';

export const DEFAULT_CONFIG: InsightEngineConfig = {
  confidenceWeights: {
    frequency: 0.25,
    recency: 0.15,
    consistency: 0.25,
    userAffirmation: 0.20,
    crossSession: 0.15,
  },
  thresholds: {
    certain: 0.90,
    high: 0.70,
    medium: 0.50,
    low: 0.30,
    garbage: 0.29,
  },
  defaultTTLDays: 30,
  dynamicTTL: true,
  minObservationsForPattern: 2,
};

/**
 * 5 boyutlu confidence değerlendirmesi
 */
export function computeConfidence(dim: ConfidenceDimensions, config: InsightEngineConfig = DEFAULT_CONFIG): number {
  const w = config.confidenceWeights;

  const raw =
    dim.frequency * w.frequency +
    dim.recency * w.recency +
    dim.consistency * w.consistency +
    dim.userAffirmation * w.userAffirmation +
    dim.crossSession * w.crossSession;

  // Sigmoid normalization — orta değerleri daha belirgin ayırır
  return 1 / (1 + Math.exp(-8 * (raw - 0.5)));
}

/**
 * Frequency skoru: Kaç kez tekrarlandı? (max 5)
 */
export function computeFrequency(hitCount: number): number {
  return Math.min(1, hitCount / 5);
}

/**
 * Recency skoru: Exponential decay, 30 gün yarı ömür
 */
export function computeRecency(lastSeenMs: number): number {
  const daysSince = (Date.now() - lastSeenMs) / (1000 * 60 * 60 * 24);
  return Math.exp(-daysSince / 30);
}

/**
 * Consistency skoru: Çelişki sayısına göre
 */
export function computeConsistency(contradictions: number, totalObservations: number): number {
  if (totalObservations === 0) return 0.5;
  return Math.max(0, 1 - contradictions / totalObservations);
}

/**
 * User affirmation skoru: Feedback oranı
 */
export function computeUserAffirmation(positiveFeedback: number, negativeFeedback: number): number {
  const total = positiveFeedback + negativeFeedback;
  if (total === 0) return 0.5;
  return positiveFeedback / total;
}

/**
 * Cross-session skoru: Kaç farklı oturumda görüldü?
 */
export function computeCrossSession(uniqueSessionCount: number): number {
  return Math.min(1, uniqueSessionCount / 5);
}

/**
 * Confidence seviyesini döndürür
 */
export function getConfidenceLevel(confidence: number, config: InsightEngineConfig = DEFAULT_CONFIG): 'certain' | 'high' | 'medium' | 'low' | 'garbage' {
  const t = config.thresholds;
  if (confidence >= t.certain) return 'certain';
  if (confidence >= t.high) return 'high';
  if (confidence >= t.medium) return 'medium';
  if (confidence >= t.low) return 'low';
  return 'garbage';
}

/**
 * Confidence'a bağlı dinamik TTL (gün)
 */
export function computeDynamicTTL(confidence: number, config: InsightEngineConfig = DEFAULT_CONFIG): number {
  if (!config.dynamicTTL) return config.defaultTTLDays;

  // Yüksek confidence = uzun ömür
  const base = config.defaultTTLDays;
  const multiplier = 1 + confidence * 2; // 1.0 - 3.0 arası
  return Math.round(base * multiplier);
}
