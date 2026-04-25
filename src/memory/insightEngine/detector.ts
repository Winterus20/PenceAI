/**
 * Pattern detection — kural bazlı observation analizi
 */

import type { Observation, DetectedPattern, InsightType } from './types.js';
import { logger } from '../../utils/logger.js';

interface PatternAccumulator {
  key: string;
  type: InsightType;
  description: string;
  observations: Observation[];
  sessionIds: Set<string>;
  sourceMemoryIds: Set<number>;
}

export class PatternDetector {
  private observations: Observation[] = [];

  observe(obs: Observation): void {
    this.observations.push(obs);
  }

  getObservations(): ReadonlyArray<Observation> {
    return this.observations;
  }

  /**
   * Tüm birikmiş observation'lardan pattern'leri çıkar.
   * Kural bazlı — LLM call gerektirmez.
   */
  detectPatterns(): DetectedPattern[] {
    const accumulators = new Map<string, PatternAccumulator>();

    for (const obs of this.observations) {
      const key = this.extractPatternKey(obs);
      if (!key) continue;

      const existing = accumulators.get(key);
      if (existing) {
        existing.observations.push(obs);
        existing.sessionIds.add(obs.sessionId);
        if (obs.memoryId !== undefined) existing.sourceMemoryIds.add(obs.memoryId);
      } else {
        const sessionIds = new Set<string>();
        sessionIds.add(obs.sessionId);
        const sourceMemoryIds = new Set<number>();
        if (obs.memoryId !== undefined) sourceMemoryIds.add(obs.memoryId);

        accumulators.set(key, {
          key,
          type: obs.type === 'correction' ? 'correction_pattern' : obs.type === 'preference' ? 'preference' : obs.type === 'tool_pattern' ? 'tool_pattern' : 'habit',
          description: this.buildDescription(obs),
          observations: [obs],
          sessionIds,
          sourceMemoryIds,
        });
      }
    }

    const patterns: DetectedPattern[] = [];

    for (const acc of accumulators.values()) {
      // En az 2 observation gerekiyor
      if (acc.observations.length < 2) continue;

      const timestamps = acc.observations.map(o => o.timestamp);

      patterns.push({
        id: `pattern_${acc.key}_${Date.now()}`,
        type: acc.type,
        description: acc.description,
        observations: acc.observations.map(o => `${o.source}:${o.timestamp}`),
        confidence: 0, // Storage tarafında hesaplanacak
        firstSeen: Math.min(...timestamps),
        lastSeen: Math.max(...timestamps),
        hitCount: acc.observations.length,
        sessionIds: [...acc.sessionIds],
        sourceMemoryIds: [...acc.sourceMemoryIds],
      });
    }

    if (patterns.length > 0) {
      logger.info(`[InsightEngine] ${patterns.length} pattern tespit edildi (${this.observations.length} observation)`);
    }

    return patterns;
  }

  /**
   * Birikmiş observation'ları temizle.
   */
  clear(): void {
    this.observations = [];
  }

  /**
   * Tek bir observation'dan pattern key çıkar.
   */
  private extractPatternKey(obs: Observation): string | null {
    switch (obs.type) {
      case 'correction': {
        // "X değil Y kullan" → "prefer:Y"
        const match = obs.context.match(/(?:değil|değilse|yoksa|instead of)\s+(.{2,30}?)(?:\s+kullan|\s+tercih|\s+seç)/i);
        if (match) return `prefer:${this.normalizeKey(match[1])}`;

        const negMatch = obs.context.match(/(.{2,30})\s+(?:kullanma|yapma|tercih etme)/i);
        if (negMatch) return `avoid:${this.normalizeKey(negMatch[1])}`;

        return `correction:${this.hashContext(obs.context)}`;
      }
      case 'preference': {
        const prefMatch = obs.context.match(/(?:tercih|sever|favori|hoşlan|prefer|like)\s+(.{2,30})/i);
        if (prefMatch) return `prefer:${this.normalizeKey(prefMatch[1])}`;
        return null;
      }
      case 'tool_pattern': {
        if (obs.toolName) return `tool:${obs.toolName}`;
        return null;
      }
      case 'rejection': {
        if (obs.toolName) return `reject:${obs.toolName}`;
        return `reject:${this.hashContext(obs.context)}`;
      }
      default:
        return null;
    }
  }

  private buildDescription(obs: Observation): string {
    switch (obs.type) {
      case 'correction':
        return `Kullanıcı düzeltme pattern'i: ${obs.context.substring(0, 100)}`;
      case 'preference':
        return `Kullanıcı tercihi: ${obs.context.substring(0, 100)}`;
      case 'tool_pattern':
        return `Sık kullanılan tool: ${obs.toolName || 'unknown'}`;
      case 'rejection':
        return `Reddedilen işlem: ${obs.toolName || obs.context.substring(0, 100)}`;
      default:
        return 'Bilinmeyen pattern';
    }
  }

  private normalizeKey(text: string | undefined): string {
    if (!text) return '';
    return text.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9çğıöşü_]/g, '').substring(0, 30);
  }

  private hashContext(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return String(Math.abs(hash));
  }
}
