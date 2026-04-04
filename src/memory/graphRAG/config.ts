/**
 * GraphRAG Config — Feature Flag ve Konfigürasyon Yönetimi.
 * 
 * GraphRAG'ın production rollout'ını yönetmek için feature flag
 * ve konfigürasyon ayarlarını sağlar.
 * 
 * Rollout Stratejisi:
 * Faz 1 (OFF): GraphRAG kapalı
 * Faz 2 (SHADOW): Shadow mode aktif (%10 sorgu shadow'da test)
 * Faz 3 (PARTIAL): Kısmi aktif (%30 sorgu GraphRAG ile)
 * Faz 4 (FULL): Tam aktif (%100 sorgu GraphRAG ile)
 */

import { logger } from '../../utils/logger.js';

/** GraphRAG feature flag */
export interface GraphRAGFeatureFlag {
  enabled: boolean;
  shadowMode: boolean;
  sampleRate: number;
  maxHops: number;
  usePageRank: boolean;
  useCommunities: boolean;
  tokenBudget: number;
  timeoutMs: number;
  fallbackEnabled: boolean;
}

/** Rollout phase enum */
export enum GraphRAGRolloutPhase {
  OFF = 1,           // Kapalı
  SHADOW = 2,        // Shadow mode (test, kullanıcıya gösterme)
  PARTIAL = 3,       // Kısmi aktif (%30 sorgu)
  FULL = 4           // Tam aktif (%100 sorgu)
}

/** Rollout phase'e özel konfigürasyonlar */
export const ROLLOUT_PHASE_CONFIG: Record<GraphRAGRolloutPhase, GraphRAGFeatureFlag> = {
  [GraphRAGRolloutPhase.OFF]: {
    enabled: false,
    shadowMode: false,
    sampleRate: 0,
    maxHops: 2,
    usePageRank: true,
    useCommunities: true,
    tokenBudget: 32000,
    timeoutMs: 5000,
    fallbackEnabled: true
  },
  [GraphRAGRolloutPhase.SHADOW]: {
    enabled: true,
    shadowMode: true,
    sampleRate: 0.1,  // %10 sorgu shadow mode'da test
    maxHops: 2,
    usePageRank: true,
    useCommunities: true,
    tokenBudget: 32000,
    timeoutMs: 5000,
    fallbackEnabled: true
  },
  [GraphRAGRolloutPhase.PARTIAL]: {
    enabled: true,
    shadowMode: false,
    sampleRate: 0.3,  // %30 sorgu GraphRAG ile
    maxHops: 2,
    usePageRank: true,
    useCommunities: true,
    tokenBudget: 32000,
    timeoutMs: 5000,
    fallbackEnabled: true
  },
  [GraphRAGRolloutPhase.FULL]: {
    enabled: true,
    shadowMode: false,
    sampleRate: 1.0,  // %100 sorgu GraphRAG ile
    maxHops: 3,       // Tam aktif'te daha derin traversal
    usePageRank: true,
    useCommunities: true,
    tokenBudget: 48000, // Daha yüksek token budget
    timeoutMs: 8000,    // Daha uzun timeout
    fallbackEnabled: true
  }
};

/** Başlangıç config'i: FULL mode */
export const CURRENT_ROLLOUT_PHASE = GraphRAGRolloutPhase.FULL;

/** Default config — CURRENT_ROLLOUT_PHASE'den türetilir */
export const DEFAULT_GRAPH_RAG_CONFIG: GraphRAGFeatureFlag = {
  ...ROLLOUT_PHASE_CONFIG[CURRENT_ROLLOUT_PHASE]
};

/** Config validation kuralları */
const CONFIG_VALIDATION_RULES = {
  sampleRate: { min: 0, max: 1 },
  maxHops: { min: 1, max: 5 },
  tokenBudget: { min: 4000, max: 128000 },
  timeoutMs: { min: 1000, max: 30000 },
};

/**
 * GraphRAG Config Manager.
 */
export class GraphRAGConfigManager {
  private static currentConfig: GraphRAGFeatureFlag = { ...DEFAULT_GRAPH_RAG_CONFIG };

  /**
   * Mevcut config'i getir.
   */
  static getConfig(): GraphRAGFeatureFlag {
    return { ...this.currentConfig };
  }

  /**
   * Config'i güncelle.
   * 
   * @param partial - Güncellenecek config değerleri
   */
  static updateConfig(partial: Partial<GraphRAGFeatureFlag>): void {
    const newConfig = { ...this.currentConfig, ...partial };

    // Validation
    if (!this.validateConfig(newConfig)) {
      throw new Error('Invalid GraphRAG configuration');
    }

    const prevConfig = { ...this.currentConfig };
    this.currentConfig = newConfig;

    // Feature flag'i güncelle
    if (partial.enabled !== undefined) {
      // GraphRAGEngine.setEnabled(partial.enabled); // Circular dependency önlemek için comment out
    }

    logger.info(
      `[GraphRAGConfig] Config updated: enabled=${newConfig.enabled}, ` +
      `shadowMode=${newConfig.shadowMode}, sampleRate=${newConfig.sampleRate}`,
    );
  }

  /**
   * Config'i default değerlere sıfırla.
   */
  static resetToDefaults(): void {
    this.currentConfig = { ...DEFAULT_GRAPH_RAG_CONFIG };
    logger.info('[GraphRAGConfig] Config reset to defaults');
  }

  /**
   * Config'i validate et.
   * 
   * @param config - Validate edilecek config
   * @returns boolean
   */
  static validateConfig(config: GraphRAGFeatureFlag): boolean {
    const errors: string[] = [];

    // Sample rate validation
    if (config.sampleRate < CONFIG_VALIDATION_RULES.sampleRate.min ||
        config.sampleRate > CONFIG_VALIDATION_RULES.sampleRate.max) {
      errors.push(`sampleRate must be between ${CONFIG_VALIDATION_RULES.sampleRate.min} and ${CONFIG_VALIDATION_RULES.sampleRate.max}`);
    }

    // Max hops validation
    if (config.maxHops < CONFIG_VALIDATION_RULES.maxHops.min ||
        config.maxHops > CONFIG_VALIDATION_RULES.maxHops.max) {
      errors.push(`maxHops must be between ${CONFIG_VALIDATION_RULES.maxHops.min} and ${CONFIG_VALIDATION_RULES.maxHops.max}`);
    }

    // Token budget validation
    if (config.tokenBudget < CONFIG_VALIDATION_RULES.tokenBudget.min ||
        config.tokenBudget > CONFIG_VALIDATION_RULES.tokenBudget.max) {
      errors.push(`tokenBudget must be between ${CONFIG_VALIDATION_RULES.tokenBudget.min} and ${CONFIG_VALIDATION_RULES.tokenBudget.max}`);
    }

    // Timeout validation
    if (config.timeoutMs < CONFIG_VALIDATION_RULES.timeoutMs.min ||
        config.timeoutMs > CONFIG_VALIDATION_RULES.timeoutMs.max) {
      errors.push(`timeoutMs must be between ${CONFIG_VALIDATION_RULES.timeoutMs.min} and ${CONFIG_VALIDATION_RULES.timeoutMs.max}`);
    }

    if (errors.length > 0) {
      logger.error(`[GraphRAGConfig] Config validation failed: ${errors.join(', ')}`);
      return false;
    }

    return true;
  }

  /**
   * Rollout phase'e göre config ayarla.
   * 
   * @param phase - Rollout phase (1-4)
   */
  static setRolloutPhase(phase: GraphRAGRolloutPhase): void {
    const config = ROLLOUT_PHASE_CONFIG[phase];
    this.updateConfig(config);
    logger.info({ msg: 'GraphRAG rollout phase changed', phase: GraphRAGRolloutPhase[phase] });
  }

  /**
   * Mevcut phase'i getir.
   */
  static getCurrentPhase(): GraphRAGRolloutPhase {
    const config = this.getConfig();
    if (!config.enabled) return GraphRAGRolloutPhase.OFF;
    if (config.shadowMode) return GraphRAGRolloutPhase.SHADOW;
    if (config.sampleRate < 1.0) return GraphRAGRolloutPhase.PARTIAL;
    return GraphRAGRolloutPhase.FULL;
  }

  /**
   * Phase'i bir sonraki seviyeye ilerlet.
   */
  static advancePhase(): GraphRAGRolloutPhase {
    const current = this.getCurrentPhase();
    if (current >= GraphRAGRolloutPhase.FULL) {
      logger.warn({ msg: 'Already at full rollout phase' });
      return current;
    }
    const next = (current + 1) as GraphRAGRolloutPhase;
    this.setRolloutPhase(next);
    return next;
  }
}
