/**
 * Benchmark Metrik Hesaplama Fonksiyonları
 * 
 * Retrieval algoritmalarının performansını ölçmek için
 * standart bilgi erişim (IR) metrikleri.
 * 
 * Metrikler:
 * - MRR (Mean Reciprocal Rank): İlk ilgili sonucun sıralaması
 * - NDCG (Normalized Discounted Cumulative Gain): Sıralama kalitesi
 * - MAP (Mean Average Precision): Ortalama hassasiyet
 * - Recall@K: K sonucun içindeki ilgili belgelerin oranı
 */

// ========== Tip Tanımlamaları ==========

export interface RankingResult {
  queryId: string;
  rankedIds: number[]; // Sıralı memory ID'leri (en ilgili -> en az ilgili)
  scores?: number[]; // Opsiyonel skorlar
}

export interface GroundTruth {
  queryId: string;
  relevantIds: number[]; // İlgili memory ID'leri (ground truth)
}

export interface MetricResult {
  name: string;
  value: number;
  details?: Record<string, unknown>;
}

export interface RecallAtKResult {
  k: number;
  recall: number;
  details: Array<{
    queryId: string;
    retrieved: number;
    relevant: number;
    recall: number;
  }>;
}

// ========== MRR (Mean Reciprocal Rank) ==========

/**
 * Mean Reciprocal Rank hesapla
 * 
 * MRR, her sorgu için ilk ilgili sonucun sıralamasının tersinin ortalamasıdır.
 * Değer 0-1 arasındadır, 1 mükemmel sıralamayı gösterir.
 * 
 * Formül: MRR = (1/|Q|) * Σ(1/rank_i)
 * 
 * @param rankings - Her sorgu için sıralı memory ID'leri
 * @param groundTruths - Her sorgu için ilgili memory ID'leri
 * @returns MRR değeri (0-1 arası)
 * 
 * @example
 * const rankings = [[1, 2, 3], [4, 5, 6]]; // İlk sorgu: 1,2,3 sıralı; ikinci: 4,5,6
 * const groundTruths = [[2], [4]]; // İlk sorgu için 2 ilgili, ikinci için 4
 * const mrr = calculateMRR(rankings, groundTruths);
 * // (1/2) + (1/1) / 2 = 0.75
 */
export function calculateMRR(
  rankings: number[][],
  groundTruths: number[][]
): number {
  if (rankings.length === 0 || rankings.length !== groundTruths.length) {
    return 0;
  }

  let reciprocalRankSum = 0;
  let validQueries = 0;

  for (let i = 0; i < rankings.length; i++) {
    const ranking = rankings[i];
    const relevantIds = new Set(groundTruths[i]);

    if (relevantIds.size === 0) {
      continue; // Ground truth boşsa atla
    }

    validQueries++;

    // İlk ilgili sonucun sırasını bul
    for (let rank = 0; rank < ranking.length; rank++) {
      if (relevantIds.has(ranking[rank])) {
        reciprocalRankSum += 1 / (rank + 1); // 1-indexed
        break;
      }
    }
    // Eğer hiç ilgili sonuç bulunamazsa, reciprocal rank = 0
  }

  return validQueries > 0 ? reciprocalRankSum / validQueries : 0;
}

// ========== NDCG (Normalized Discounted Cumulative Gain) ==========

/**
 * DCG (Discounted Cumulative Gain) hesapla
 * 
 * DCG = Σ(rel_i / log2(i + 1)) for i = 1 to k
 * 
 * @param ranking - Sıralı memory ID'leri
 * @param relevantIds - İlgili memory ID'leri set olarak
 * @param k - Kesim noktası (kaç sonucun değerlendirileceği)
 * @returns DCG değeri
 */
function calculateDCG(
  ranking: number[],
  relevantIds: Set<number>,
  k: number
): number {
  const cutoff = Math.min(k, ranking.length);
  let dcg = 0;

  for (let i = 0; i < cutoff; i++) {
    const relevance = relevantIds.has(ranking[i]) ? 1 : 0;
    // log2(i + 2) çünkü i 0-indexed ve log2(1) = 0 olmamalı
    dcg += relevance / Math.log2(i + 2);
  }

  return dcg;
}

/**
 * IDCG (Ideal DCG) hesapla
 * 
 * İdeal durumda tüm ilgili belgeler en başta olsaydı elde edilecek DCG.
 * 
 * @param relevantCount - İlgili belge sayısı
 * @param k - Kesim noktası
 * @returns IDCG değeri
 */
function calculateIDCG(relevantCount: number, k: number): number {
  const idealCount = Math.min(relevantCount, k);
  let idcg = 0;

  for (let i = 0; i < idealCount; i++) {
    // İdeal durumda tüm ilgili belgeler relevance = 1
    idcg += 1 / Math.log2(i + 2);
  }

  return idcg;
}

/**
 * NDCG@K (Normalized Discounted Cumulative Gain at K) hesapla
 * 
 * NDCG = DCG / IDCG
 * Değer 0-1 arasındadır, 1 mükemmel sıralamayı gösterir.
 * 
 * @param ranking - Sıralı memory ID'leri
 * @param groundTruth - İlgili memory ID'leri
 * @param k - Kesim noktası (genellikle 5, 10, 20)
 * @returns NDCG değeri (0-1 arası)
 * 
 * @example
 * const ranking = [1, 2, 3, 4, 5];
 * const groundTruth = [2, 4];
 * const ndcg = calculateNDCG(ranking, groundTruth, 5);
 * // DCG = 1/log2(2) + 1/log2(4) = 1 + 0.5 = 1.5
 * // IDCG = 1/log2(2) + 1/log2(3) = 1 + 0.63 = 1.63
 * // NDCG = 1.5 / 1.63 ≈ 0.92
 */
export function calculateNDCG(
  ranking: number[],
  groundTruth: number[],
  k: number
): number {
  if (ranking.length === 0 || groundTruth.length === 0) {
    return 0;
  }

  const relevantIds = new Set(groundTruth);
  const dcg = calculateDCG(ranking, relevantIds, k);
  const idcg = calculateIDCG(groundTruth.length, k);

  return idcg > 0 ? dcg / idcg : 0;
}

/**
 * Birden fazla sorgu için ortalama NDCG hesapla
 * 
 * @param rankings - Her sorgu için sıralı memory ID'leri
 * @param groundTruths - Her sorgu için ilgili memory ID'leri
 * @param k - Kesim noktası
 * @returns Ortalama NDCG değeri
 */
export function calculateMeanNDCG(
  rankings: number[][],
  groundTruths: number[][],
  k: number
): number {
  if (rankings.length === 0 || rankings.length !== groundTruths.length) {
    return 0;
  }

  let ndcgSum = 0;
  let validQueries = 0;

  for (let i = 0; i < rankings.length; i++) {
    if (groundTruths[i].length > 0) {
      ndcgSum += calculateNDCG(rankings[i], groundTruths[i], k);
      validQueries++;
    }
  }

  return validQueries > 0 ? ndcgSum / validQueries : 0;
}

// ========== MAP (Mean Average Precision) ==========

/**
 * Tek bir sorgu için Average Precision hesapla
 * 
 * AP = (1/|R|) * Σ(P@k * rel(k))
 * 
 * @param ranking - Sıralı memory ID'leri
 * @param groundTruth - İlgili memory ID'leri
 * @returns Average Precision değeri (0-1 arası)
 */
function calculateAP(ranking: number[], groundTruth: number[]): number {
  if (groundTruth.length === 0) {
    return 0;
  }

  const relevantIds = new Set(groundTruth);
  let relevantCount = 0;
  let precisionSum = 0;

  for (let i = 0; i < ranking.length; i++) {
    if (relevantIds.has(ranking[i])) {
      relevantCount++;
      const precisionAtK = relevantCount / (i + 1);
      precisionSum += precisionAtK;
    }
  }

  return precisionSum / groundTruth.length;
}

/**
 * Mean Average Precision hesapla
 * 
 * MAP, tüm sorguların AP değerlerinin ortalamasıdır.
 * Değer 0-1 arasındadır, 1 mükemmel sıralamayı gösterir.
 * 
 * @param rankings - Her sorgu için sıralı memory ID'leri
 * @param groundTruths - Her sorgu için ilgili memory ID'leri
 * @returns MAP değeri (0-1 arası)
 * 
 * @example
 * const rankings = [[1, 2, 3], [4, 5, 6]];
 * const groundTruths = [[1, 2], [4]];
 * const map = calculateMAP(rankings, groundTruths);
 * // AP1 = (1/1 + 2/2) / 2 = 1.0
 * // AP2 = (1/1) / 1 = 1.0
 * // MAP = (1.0 + 1.0) / 2 = 1.0
 */
export function calculateMAP(
  rankings: number[][],
  groundTruths: number[][]
): number {
  if (rankings.length === 0 || rankings.length !== groundTruths.length) {
    return 0;
  }

  let apSum = 0;
  let validQueries = 0;

  for (let i = 0; i < rankings.length; i++) {
    if (groundTruths[i].length > 0) {
      apSum += calculateAP(rankings[i], groundTruths[i]);
      validQueries++;
    }
  }

  return validQueries > 0 ? apSum / validQueries : 0;
}

// ========== Recall@K ==========

/**
 * Tek bir sorgu için Recall@K hesapla
 * 
 * Recall@K = |retrieved ∩ relevant| / |relevant|
 * 
 * @param ranking - Sıralı memory ID'leri
 * @param groundTruth - İlgili memory ID'leri
 * @param k - Kesim noktası
 * @returns Recall değeri (0-1 arası)
 * 
 * @example
 * const ranking = [1, 2, 3, 4, 5];
 * const groundTruth = [2, 4, 6];
 * const recall = calculateRecallAtK(ranking, groundTruth, 5);
 * // Retrieved: [1, 2, 3, 4, 5]
 * // Relevant: [2, 4, 6]
 * // Retrieved ∩ Relevant: [2, 4] -> 2 eleman
 * // Recall@5 = 2/3 ≈ 0.67
 */
export function calculateRecallAtK(
  ranking: number[],
  groundTruth: number[],
  k: number
): number {
  if (groundTruth.length === 0) {
    return 0;
  }

  const relevantIds = new Set(groundTruth);
  const topK = ranking.slice(0, k);
  
  let retrievedRelevant = 0;
  for (const id of topK) {
    if (relevantIds.has(id)) {
      retrievedRelevant++;
    }
  }

  return retrievedRelevant / groundTruth.length;
}

/**
 * Birden fazla sorgu için ortalama Recall@K hesapla
 * 
 * @param rankings - Her sorgu için sıralı memory ID'leri
 * @param groundTruths - Her sorgu için ilgili memory ID'leri
 * @param k - Kesim noktası
 * @returns Ortalama Recall değeri
 */
export function calculateMeanRecallAtK(
  rankings: number[][],
  groundTruths: number[][],
  k: number
): number {
  if (rankings.length === 0 || rankings.length !== groundTruths.length) {
    return 0;
  }

  let recallSum = 0;
  let validQueries = 0;

  for (let i = 0; i < rankings.length; i++) {
    if (groundTruths[i].length > 0) {
      recallSum += calculateRecallAtK(rankings[i], groundTruths[i], k);
      validQueries++;
    }
  }

  return validQueries > 0 ? recallSum / validQueries : 0;
}

/**
 * Farklı K değerleri için Recall hesapla
 * 
 * @param rankings - Her sorgu için sıralı memory ID'leri
 * @param groundTruths - Her sorgu için ilgili memory ID'leri
 * @param kValues - K değerleri listesi (örn: [1, 5, 10, 20])
 * @returns Her K değeri için Recall sonucu
 */
export function calculateRecallAtMultipleK(
  rankings: number[][],
  groundTruths: number[][],
  kValues: number[]
): RecallAtKResult[] {
  return kValues.map(k => ({
    k,
    recall: calculateMeanRecallAtK(rankings, groundTruths, k),
    details: rankings.map((ranking, i) => {
      const relevantIds = new Set(groundTruths[i]);
      const topK = ranking.slice(0, k);
      let retrievedRelevant = 0;
      for (const id of topK) {
        if (relevantIds.has(id)) {
          retrievedRelevant++;
        }
      }
      return {
        queryId: `query-${i}`,
        retrieved: topK.length,
        relevant: groundTruths[i].length,
        recall: groundTruths[i].length > 0 
          ? retrievedRelevant / groundTruths[i].length 
          : 0
      };
    })
  }));
}

// ========== Precision@K ==========

/**
 * Tek bir sorgu için Precision@K hesapla
 * 
 * Precision@K = |retrieved ∩ relevant| / K
 * 
 * @param ranking - Sıralı memory ID'leri
 * @param groundTruth - İlgili memory ID'leri
 * @param k - Kesim noktası
 * @returns Precision değeri (0-1 arası)
 */
export function calculatePrecisionAtK(
  ranking: number[],
  groundTruth: number[],
  k: number
): number {
  if (k === 0) {
    return 0;
  }

  const relevantIds = new Set(groundTruth);
  const topK = ranking.slice(0, k);
  
  let retrievedRelevant = 0;
  for (const id of topK) {
    if (relevantIds.has(id)) {
      retrievedRelevant++;
    }
  }

  return retrievedRelevant / k;
}

/**
 * Birden fazla sorgu için ortalama Precision@K hesapla
 * 
 * @param rankings - Her sorgu için sıralı memory ID'leri
 * @param groundTruths - Her sorgu için ilgili memory ID'leri
 * @param k - Kesim noktası
 * @returns Ortalama Precision değeri
 */
export function calculateMeanPrecisionAtK(
  rankings: number[][],
  groundTruths: number[][],
  k: number
): number {
  if (rankings.length === 0 || rankings.length !== groundTruths.length) {
    return 0;
  }

  let precisionSum = 0;
  let validQueries = 0;

  for (let i = 0; i < rankings.length; i++) {
    if (groundTruths[i].length > 0) {
      precisionSum += calculatePrecisionAtK(rankings[i], groundTruths[i], k);
      validQueries++;
    }
  }

  return validQueries > 0 ? precisionSum / validQueries : 0;
}

// ========== F1@K ==========

/**
 * F1@K hesapla (Precision ve Recall'un harmonik ortalaması)
 * 
 * F1 = 2 * (Precision * Recall) / (Precision + Recall)
 * 
 * @param ranking - Sıralı memory ID'leri
 * @param groundTruth - İlgili memory ID'leri
 * @param k - Kesim noktası
 * @returns F1 değeri (0-1 arası)
 */
export function calculateF1AtK(
  ranking: number[],
  groundTruth: number[],
  k: number
): number {
  const precision = calculatePrecisionAtK(ranking, groundTruth, k);
  const recall = calculateRecallAtK(ranking, groundTruth, k);

  if (precision + recall === 0) {
    return 0;
  }

  return (2 * precision * recall) / (precision + recall);
}

/**
 * Birden fazla sorgu için ortalama F1@K hesapla
 * 
 * @param rankings - Her sorgu için sıralı memory ID'leri
 * @param groundTruths - Her sorgu için ilgili memory ID'leri
 * @param k - Kesim noktası
 * @returns Ortalama F1 değeri
 */
export function calculateMeanF1AtK(
  rankings: number[][],
  groundTruths: number[][],
  k: number
): number {
  if (rankings.length === 0 || rankings.length !== groundTruths.length) {
    return 0;
  }

  let f1Sum = 0;
  let validQueries = 0;

  for (let i = 0; i < rankings.length; i++) {
    if (groundTruths[i].length > 0) {
      f1Sum += calculateF1AtK(rankings[i], groundTruths[i], k);
      validQueries++;
    }
  }

  return validQueries > 0 ? f1Sum / validQueries : 0;
}

// ========== Kapsamlı Metrik Hesaplama ==========

export interface ComprehensiveMetrics {
  mrr: number;
  map: number;
  ndcg: {
    at5: number;
    at10: number;
    at20: number;
  };
  recall: {
    at1: number;
    at5: number;
    at10: number;
    at20: number;
  };
  precision: {
    at1: number;
    at5: number;
    at10: number;
    at20: number;
  };
  f1: {
    at5: number;
    at10: number;
    at20: number;
  };
}

/**
 * Tüm metrikleri tek seferde hesapla
 * 
 * @param rankings - Her sorgu için sıralı memory ID'leri
 * @param groundTruths - Her sorgu için ilgili memory ID'leri
 * @returns Kapsamlı metrik sonuçları
 */
export function calculateAllMetrics(
  rankings: number[][],
  groundTruths: number[][]
): ComprehensiveMetrics {
  return {
    mrr: calculateMRR(rankings, groundTruths),
    map: calculateMAP(rankings, groundTruths),
    ndcg: {
      at5: calculateMeanNDCG(rankings, groundTruths, 5),
      at10: calculateMeanNDCG(rankings, groundTruths, 10),
      at20: calculateMeanNDCG(rankings, groundTruths, 20)
    },
    recall: {
      at1: calculateMeanRecallAtK(rankings, groundTruths, 1),
      at5: calculateMeanRecallAtK(rankings, groundTruths, 5),
      at10: calculateMeanRecallAtK(rankings, groundTruths, 10),
      at20: calculateMeanRecallAtK(rankings, groundTruths, 20)
    },
    precision: {
      at1: calculateMeanPrecisionAtK(rankings, groundTruths, 1),
      at5: calculateMeanPrecisionAtK(rankings, groundTruths, 5),
      at10: calculateMeanPrecisionAtK(rankings, groundTruths, 10),
      at20: calculateMeanPrecisionAtK(rankings, groundTruths, 20)
    },
    f1: {
      at5: calculateMeanF1AtK(rankings, groundTruths, 5),
      at10: calculateMeanF1AtK(rankings, groundTruths, 10),
      at20: calculateMeanF1AtK(rankings, groundTruths, 20)
    }
  };
}

// ========== Metrik Karşılaştırma ==========

export interface MetricComparison {
  baseline: ComprehensiveMetrics;
  candidate: ComprehensiveMetrics;
  improvement: {
    mrr: number; // Yüzde iyileştirme
    map: number;
    ndcgAt10: number;
    recallAt10: number;
  };
}

/**
 * İki algoritmanın metriklerini karşılaştır
 * 
 * @param baseline - Baseline algoritma metrikleri
 * @param candidate - Aday algoritma metrikleri
 * @returns Karşılaştırma sonuçları
 */
export function compareMetrics(
  baseline: ComprehensiveMetrics,
  candidate: ComprehensiveMetrics
): MetricComparison {
  const calcImprovement = (base: number, cand: number): number => {
    if (base === 0) return cand > 0 ? 100 : 0;
    return ((cand - base) / base) * 100;
  };

  return {
    baseline,
    candidate,
    improvement: {
      mrr: calcImprovement(baseline.mrr, candidate.mrr),
      map: calcImprovement(baseline.map, candidate.map),
      ndcgAt10: calcImprovement(baseline.ndcg.at10, candidate.ndcg.at10),
      recallAt10: calcImprovement(baseline.recall.at10, candidate.recall.at10)
    }
  };
}

// ========== Sonuç Formatlama ==========

/**
 * Metrik sonuçlarını okunabilir tablo formatına dönüştür
 * 
 * @param metrics - Metrik sonuçları
 * @returns Formatlanmış metrik tablosu
 */
export function formatMetricsTable(metrics: ComprehensiveMetrics): string {
  const lines: string[] = [
    '=== Retrieval Metrics ===',
    '',
    'Sıralama Kalitesi:',
    `  MRR:  ${metrics.mrr.toFixed(4)}`,
    `  MAP:  ${metrics.map.toFixed(4)}`,
    '',
    'NDCG:',
    `  @5:   ${metrics.ndcg.at5.toFixed(4)}`,
    `  @10:  ${metrics.ndcg.at10.toFixed(4)}`,
    `  @20:  ${metrics.ndcg.at20.toFixed(4)}`,
    '',
    'Recall:',
    `  @1:   ${metrics.recall.at1.toFixed(4)}`,
    `  @5:   ${metrics.recall.at5.toFixed(4)}`,
    `  @10:  ${metrics.recall.at10.toFixed(4)}`,
    `  @20:  ${metrics.recall.at20.toFixed(4)}`,
    '',
    'Precision:',
    `  @1:   ${metrics.precision.at1.toFixed(4)}`,
    `  @5:   ${metrics.precision.at5.toFixed(4)}`,
    `  @10:  ${metrics.precision.at10.toFixed(4)}`,
    `  @20:  ${metrics.precision.at20.toFixed(4)}`,
    '',
    'F1:',
    `  @5:   ${metrics.f1.at5.toFixed(4)}`,
    `  @10:  ${metrics.f1.at10.toFixed(4)}`,
    `  @20:  ${metrics.f1.at20.toFixed(4)}`
  ];

  return lines.join('\n');
}

/**
 * Karşılaştırma sonuçlarını okunabilir formatta dönüştür
 * 
 * @param comparison - Karşılaştırma sonuçları
 * @returns Formatlanmış karşılaştırma tablosu
 */
export function formatComparisonTable(comparison: MetricComparison): string {
  const { baseline, candidate, improvement } = comparison;
  
  const lines: string[] = [
    '=== Algorithm Comparison ===',
    '',
    '| Metric     | Baseline | Candidate | Improvement |',
    '|------------|----------|-----------|-------------|',
    `| MRR        | ${baseline.mrr.toFixed(4)}   | ${candidate.mrr.toFixed(4)}    | ${improvement.mrr >= 0 ? '+' : ''}${improvement.mrr.toFixed(1)}%     |`,
    `| MAP        | ${baseline.map.toFixed(4)}   | ${candidate.map.toFixed(4)}    | ${improvement.map >= 0 ? '+' : ''}${improvement.map.toFixed(1)}%     |`,
    `| NDCG@10    | ${baseline.ndcg.at10.toFixed(4)}   | ${candidate.ndcg.at10.toFixed(4)}    | ${improvement.ndcgAt10 >= 0 ? '+' : ''}${improvement.ndcgAt10.toFixed(1)}%     |`,
    `| Recall@10  | ${baseline.recall.at10.toFixed(4)}   | ${candidate.recall.at10.toFixed(4)}    | ${improvement.recallAt10 >= 0 ? '+' : ''}${improvement.recallAt10.toFixed(1)}%     |`
  ];

  return lines.join('\n');
}
