/**
 * SpreadingActivationService - Klasik iterative spreading activation algoritması.
 * 
 * Sorumluluklar:
 * - Seed node'lardan başlayarak graph üzerinde activation yayma
 * - Her iterasyonda komşulara activation aktarma + decay uygulama
 * - Spreading activation config yönetimi
 * 
 * Bu servis RetrievalOrchestrator'deki SA mekanizmasından bağımsızdır.
 * RetrievalOrchestrator kendi inline SA mantığını kullanır (retrieval-time bonus).
 * Bu servis ise genel amaçlı, çok-iterasyonlu graph activation sağlar.
 */

import { logger } from '../../utils/logger.js';

// ========== Tipler ==========

export interface SpreadingActivationConfig {
  decayFactor: number;
  maxIterations: number;
  minActivation: number;
  relationTypeWeights: Record<string, number>;
}

export interface SpreadingActivationResult {
  nodeActivations: Map<number, number>;
  iterations: number;
  converged: boolean;
}

/** MemoryGraphManager'dan ihtiyaç duyulan komşu verisi arayüzü */
export interface NeighborProvider {
  getMemoryNeighborsBatch(
    memoryIds: number[],
    limitPerNode?: number
  ): Map<number, Array<{ id: number; relation_type: string; confidence: number }>>;
}

// ========== Varsayılan Config ==========

const DEFAULT_CONFIG: SpreadingActivationConfig = {
  decayFactor: 0.85,
  maxIterations: 10,
  minActivation: 0.01,
  relationTypeWeights: {
    'related_to': 1.0,
    'part_of': 0.9,
    'caused_by': 0.8,
    'associated_with': 0.7,
    'shared_entity': 0.6,
    'default': 0.5,
  },
};

// ========== Servis ==========

export class SpreadingActivationService {
  constructor(private neighborProvider: NeighborProvider) {}

  /**
   * Spreading Activation config döndürür.
   */
  getConfig(): Partial<SpreadingActivationConfig> {
    return { ...DEFAULT_CONFIG };
  }

  /**
   * RetrievalOrchestrator için spreading activation config döndürür.
   * RetrievalSpreadingActivationConfig formatında config sağlar.
   */
  getOrchestratorConfig(): Record<string, unknown> {
    return {
      enabled: true,
      rolloutState: 'soft',
      seedLimit: 5,
      neighborsPerSeed: 10,
      maxCandidates: 15,
      maxHopDepth: 2,
      seedConfidenceFloor: 0.65,
      seedScoreFloor: 1.0,
      candidateConfidenceFloor: 0.6,
      relationConfidenceFloor: 0.5,
      minEffectiveBonus: 0.02,
      hopDecay: 0.7,
      activationScale: 0.08,
      maxCandidateBonus: 0.15,
    };
  }

  /**
   * Klasik iterative spreading activation algoritması.
   *
   * Seed node'lardan başlayarak graph üzerinde activation yayar.
   * Her iterasyonda komşulara activation aktarılır, decay uygulanır.
   * Convergence sağlanana veya maxIterations'a ulaşılana kadar devam eder.
   *
   * @param seedNodeIds - Başlangıç node ID'leri
   * @param configOverrides - Opsiyonel konfigürasyon override'ları
   * @returns Activation sonuçları (nodeActivations, iterations, converged)
   */
  compute(
    seedNodeIds: number[],
    configOverrides?: Partial<SpreadingActivationConfig>
  ): SpreadingActivationResult {
    const cfg = this.buildConfig(configOverrides);
    const activations = new Map<number, number>();

    if (seedNodeIds.length === 0) {
      return { nodeActivations: activations, iterations: 0, converged: true };
    }

    // Seed node'larına başlangıç aktivasyonu
    const seedActivation = 1.0 / seedNodeIds.length;
    for (const id of seedNodeIds) {
      activations.set(id, seedActivation);
    }

    let currentActivations = new Map(activations);
    let iterations = 0;
    let converged = false;

    for (let iter = 0; iter < cfg.maxIterations; iter++) {
      iterations++;
      const newActivations = new Map(currentActivations);
      let maxChange = 0;

      // Aktif node'ları getir (minActivation üstü)
      const activeNodeIds = Array.from(currentActivations.keys())
        .filter(id => currentActivations.get(id)! > cfg.minActivation);

      if (activeNodeIds.length === 0) {
        converged = true;
        break;
      }

      // Batch neighbor retrieval
      const neighbors = this.neighborProvider.getMemoryNeighborsBatch(activeNodeIds, 20);

      // Activation yayma
      for (const sourceId of activeNodeIds) {
        const sourceActivation = currentActivations.get(sourceId) ?? 0;
        if (sourceActivation <= cfg.minActivation) continue;

        const sourceNeighbors = neighbors.get(sourceId) || [];
        if (sourceNeighbors.length === 0) continue;

        // Toplam ağırlık hesapla
        const totalWeight = sourceNeighbors.reduce((sum, n) => {
          const relWeight = (cfg.relationTypeWeights[n.relation_type] ?? cfg.relationTypeWeights['default']) ?? 1;
          return sum + ((n.confidence ?? 0.7) * relWeight);
        }, 0);

        if (totalWeight === 0) continue;

        // Komşulara activation dağıt
        for (const neighbor of sourceNeighbors) {
          const relWeight = (cfg.relationTypeWeights[neighbor.relation_type] ?? cfg.relationTypeWeights['default']) ?? 1;
          const neighborConfidence = neighbor.confidence ?? 0.7;

          const propagatedActivation = (
            sourceActivation
            * cfg.decayFactor
            * neighborConfidence
            * relWeight
          ) / totalWeight;

          const currentNeighborActivation = newActivations.get(neighbor.id) ?? 0;
          const newActivation = Math.min(1.0, currentNeighborActivation + propagatedActivation);
          newActivations.set(neighbor.id, newActivation);

          maxChange = Math.max(maxChange, Math.abs(newActivation - currentNeighborActivation));
        }
      }

      currentActivations = newActivations;

      // Convergence kontrolü
      if (maxChange < cfg.minActivation) {
        converged = true;
        break;
      }
    }

    // Min activation altındaki node'ları temizle
    for (const [id, activation] of currentActivations) {
      if (activation < cfg.minActivation) {
        currentActivations.delete(id);
      }
    }

    logger.debug({
      seedCount: seedNodeIds.length,
      resultCount: currentActivations.size,
      iterations,
      converged,
    }, '[Memory] Spreading activation completed');

    return {
      nodeActivations: currentActivations,
      iterations,
      converged,
    };
  }

  /**
   * Spreading Activation config oluşturur.
   */
  private buildConfig(overrides?: Partial<SpreadingActivationConfig>): SpreadingActivationConfig {
    return {
      ...DEFAULT_CONFIG,
      ...overrides,
    };
  }
}
