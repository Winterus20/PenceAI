/**
 * TokenPruner — Token Budget Yönetimi.
 * 
 * GraphRAG'ın ürettiği context'in token limitini aşmamasını sağlar.
 * Priority'ye göre sıralama yaparak en düşük priority'li item'ları kaldırır.
 * 
 * Token Hesaplama:
 * - gpt-tokenizer kütüphanesini kullanır
 * - Her memory content için token say
 * - Her community summary için token say
 * - Graph context için sabit token (~100)
 * 
 * Pruning Stratejisi:
 * 1. Önce community summaries'yi prune et (daha az önemli)
 * 2. Sonra memories'yi prune et (PageRank score'a göre sırala, en düşükleri kaldır)
 * 3. Token budget'a kadar devam et
 */

import { encode } from 'gpt-tokenizer';
import { logger } from '../../utils/logger.js';
import type { MemoryRow } from '../types.js';
import type { CommunitySummary } from './CommunitySummarizer.js';

/** Token budget dağılımı */
export interface TokenBudget {
  total: number;           // Default: 32000
  memories: number;        // %50 → 16000
  communitySummaries: number; // %25 → 8000
  graphContext: number;    // %25 → 8000
}

/** Memory önceliklendirme ağırlıkları */
export interface MemoryPriorityWeights {
  importance: number;      // Default: 0.5 (önem skoru ağırlığı)
  accessCount: number;     // Default: 0.3 (erişim sayısı ağırlığı)
  confidence: number;      // Default: 0.2 (güven skoru ağırlığı)
}

/** Pruning seçenekleri */
export interface PruningOptions {
  budget: TokenBudget;
  memoryPriorityFn?: (item: MemoryRow) => number;
  memoryWeights?: MemoryPriorityWeights;
  summaryPriorityFn?: (item: CommunitySummary) => number;
  tokenizer?: (text: string) => number;
}

/** Pruning sonucu */
export interface PruningResult {
  prunedMemories: MemoryRow[];
  prunedSummaries: CommunitySummary[];
  removedMemories: number;
  removedSummaries: number;
  totalTokens: number;
  withinBudget: boolean;
}

/** Default token budget */
const DEFAULT_TOKEN_BUDGET: TokenBudget = {
  total: 32000,
  memories: 16000,
  communitySummaries: 8000,
  graphContext: 8000,
};

/** Default memory priority weights */
const DEFAULT_MEMORY_WEIGHTS: MemoryPriorityWeights = {
  importance: 0.5,
  accessCount: 0.3,
  confidence: 0.2,
};

/** Graph context için sabit token sayısı */
const GRAPH_CONTEXT_TOKENS = 300;

/** Default tokenizer: gpt-tokenizer */
function defaultTokenizer(text: string): number {
  try {
    return encode(text).length;
  } catch {
    // Fallback: kelime sayısı * 1.3 (yaklaşık token)
    return Math.ceil(text.split(/\s+/).length * 1.3);
  }
}

/**
 * Priority fonksiyonu: Memory için configurable weights kullanır.
 */
function createMemoryPriorityFn(weights: MemoryPriorityWeights): (memory: MemoryRow) => number {
  return (memory: MemoryRow): number => {
    const importance = memory.importance ?? 5;
    const accessCount = memory.access_count ?? 0;
    const confidence = memory.confidence ?? 0.5;

    return (importance / 10) * weights.importance +
      Math.min(accessCount / 100, 1) * weights.accessCount +
      confidence * weights.confidence;
  };
}

/**
 * Priority fonksiyonu: CommunitySummary için modularity score kullanır.
 */
function summaryPriorityFn(summary: CommunitySummary): number {
  const entityCount = summary.keyEntities?.length ?? 0;
  const summaryLength = summary.summary?.length ?? 0;

  // Normalize: 0-1 arası
  const entityScore = Math.min(entityCount / 10, 1);
  const lengthScore = Math.min(summaryLength / 500, 1);

  // Min 0.4, Max 1.0
  return 0.4 + (entityScore * 0.3) + (lengthScore * 0.3);
}

export class TokenPruner {
  private readonly budget: TokenBudget;
  private readonly memoryPriorityFn: (item: MemoryRow) => number;
  private readonly summaryPriorityFn: (item: CommunitySummary) => number;
  private readonly tokenizer: (text: string) => number;

  constructor(options?: Partial<PruningOptions>) {
    this.budget = options?.budget ?? DEFAULT_TOKEN_BUDGET;
    this.tokenizer = options?.tokenizer ?? defaultTokenizer;
    this.summaryPriorityFn = options?.summaryPriorityFn ?? summaryPriorityFn;

    // Configurable weights veya custom priority function
    if (options?.memoryPriorityFn) {
      // Eğer custom priority function verilmişse onu kullan
      this.memoryPriorityFn = options.memoryPriorityFn;
    } else {
      // Yoksa configurable weights ile oluştur
      const weights = options?.memoryWeights ?? DEFAULT_MEMORY_WEIGHTS;
      this.memoryPriorityFn = createMemoryPriorityFn(weights);
    }
  }

  /**
   * Ana fonksiyon: Token budget'a göre prune et.
   * 
   * @param memories - Prune edilecek memory'ler
   * @param summaries - Prune edilecek community summaries
   * @returns PruningResult - Prune edilmiş sonuçlar
   */
  prune(memories: MemoryRow[], summaries: CommunitySummary[]): PruningResult {
    const startTime = Date.now();
    
    // Boş input kontrolü
    if (memories.length === 0 && summaries.length === 0) {
      return {
        prunedMemories: [],
        prunedSummaries: [],
        removedMemories: 0,
        removedSummaries: 0,
        totalTokens: 0,
        withinBudget: true,
      };
    }

    const { budget, memoryPriorityFn, summaryPriorityFn, tokenizer } = this;

    // 1. Community summaries'yi prune et (daha az önemli)
    const { pruned: prunedSummaries, removedCount: removedSummaries, totalTokens: summaryTokens } =
      this.pruneByPriority<CommunitySummary>(
        summaries,
        budget.communitySummaries,
        summaryPriorityFn,
        (item) => item.summary,
        tokenizer,
      );

    // 2. Memories'yi prune et (PageRank score'a göre sırala, en düşükleri kaldır)
    const { pruned: prunedMemories, removedCount: removedMemories, totalTokens: memoryTokens } =
      this.pruneByPriority<MemoryRow>(
        memories,
        budget.memories,
        memoryPriorityFn,
        (item) => item.content,
        tokenizer,
      );

    // 3. Toplam token hesapla
    const totalTokens = memoryTokens + summaryTokens + GRAPH_CONTEXT_TOKENS;
    const withinBudget = totalTokens <= budget.total;

    const elapsed = Date.now() - startTime;
    logger.debug(
      `[TokenPruner] Pruning completed in ${elapsed}ms: ` +
      `${memories.length - removedMemories}/${memories.length} memories, ` +
      `${summaries.length - removedSummaries}/${summaries.length} summaries, ` +
      `${totalTokens} tokens (budget: ${budget.total})`,
    );

    return {
      prunedMemories,
      prunedSummaries,
      removedMemories,
      removedSummaries,
      totalTokens,
      withinBudget,
    };
  }

  /**
   * Token sayısını hesapla.
   * 
   * @param text - Token sayısı hesaplanacak metin
   * @returns Token sayısı
   */
  countTokens(text: string): number {
    return this.tokenizer(text);
  }

  /**
   * Priority'ye göre sırala ve en düşük priority'li item'ları kaldır.
   * 
   * @param items - Prune edilecek item'lar
   * @param budget - Token budget
   * @param priorityFn - Priority fonksiyonu
   * @param textExtractor - Text extractor
   * @param tokenizer - Tokenizer
   * @returns Pruning sonucu
   */
  private pruneByPriority<T>(
    items: T[],
    budget: number,
    priorityFn: (item: T) => number,
    textExtractor: (item: T) => string,
    tokenizer: (text: string) => number,
  ): { pruned: T[]; removedCount: number; totalTokens: number } {
    if (items.length === 0) {
      return { pruned: [], removedCount: 0, totalTokens: 0 };
    }

    // Token sayılarını hesapla
    const itemsWithTokens = items.map((item) => ({
      item,
      tokens: tokenizer(textExtractor(item)),
      priority: priorityFn(item),
    }));

    // Toplam token
    const totalTokens = itemsWithTokens.reduce((sum, i) => sum + i.tokens, 0);

    // Budget içindeyse hiçbir şey prune etme
    if (totalTokens <= budget) {
      return { pruned: items, removedCount: 0, totalTokens };
    }

    // Priority'ye göre sırala (en düşük priority önce)
    itemsWithTokens.sort((a, b) => a.priority - b.priority);

    // En düşük priority'li item'ları kaldır
    const removed: T[] = [];
    let remainingTokens = totalTokens;
    let idx = 0;

    while (remainingTokens > budget && idx < itemsWithTokens.length) {
      const current = itemsWithTokens[idx]!;
      removed.push(current.item);
      remainingTokens -= current.tokens;
      idx++;
    }

    const pruned = itemsWithTokens.slice(idx).map((i) => i.item);

    logger.debug(
      `[TokenPruner] Pruned ${removed.length}/${items.length} items, ` +
      `${remainingTokens}/${totalTokens} tokens remaining (budget: ${budget})`,
    );

    return {
      pruned,
      removedCount: removed.length,
      totalTokens: remainingTokens,
    };
  }
}
