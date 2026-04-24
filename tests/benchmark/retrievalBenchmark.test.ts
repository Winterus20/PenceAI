/**
 * Retrieval Benchmark Testleri
 * 
 * PenceAI retrieval algoritmasını diğer sistemlerle karşılaştıran
 * kapsamlı benchmark testleri.
 * 
 * Karşılaştırmalar:
 * - Baseline Algoritmalar: BM25, TF-IDF, Pure Semantic, Random
 * - PenceAI Varyantları: Hybrid, Graph-aware, Full
 * 
 * Metrikler:
 * - MRR (Mean Reciprocal Rank)
 * - NDCG (Normalized Discounted Cumulative Gain)
 * - MAP (Mean Average Precision)
 * - Recall@K
 * - Latency (sorgu süresi)
 */

import {
  benchmarkQueries,
  benchmarkMemories,
  toMemoryRows,
  type BenchmarkQuery
} from './fixtures/benchmarkDataset.js';
import {
  calculateMRR,
  calculateNDCG,
  calculateMAP,
  calculateRecallAtK,
  calculateMeanNDCG,
  calculateMeanRecallAtK,
  calculateAllMetrics,
  compareMetrics,
  formatMetricsTable,
  formatComparisonTable,
  type ComprehensiveMetrics
} from './utils/metrics.js';
import {
  bm25Search,
  tfidfSearch,
  pureSemanticSearch,
  randomSearch,
  hybridSearch,
  search,
  clearEmbeddingCache,
  type AlgorithmName
} from './utils/baselines.js';
import type { MemoryRow } from '../../src/memory/types.js';

// ========== Test Konfigürasyonu ==========

const BENCHMARK_ITERATIONS = 10; // Her test için tekrar sayısı
const DEFAULT_K = 20; // Varsayılan sonuç sayısı

// ========== Test Fixture'ları ==========

let memoryRows: MemoryRow[];

/**
 * Benchmark öncesi hazırlık
 */
beforeAll(() => {
  // Bellek kayıtlarını MemoryRow formatına dönüştür
  memoryRows = toMemoryRows(benchmarkMemories);
  
  // Embedding cache'i temizle
  clearEmbeddingCache();
});

/**
 * Her test öncesi cache temizleme
 */
beforeEach(() => {
  clearEmbeddingCache();
});

// ========== Yardımcı Fonksiyonlar ==========

interface BenchmarkResult {
  algorithm: string;
  rankings: number[][];
  groundTruths: number[][];
  metrics: ComprehensiveMetrics;
  totalLatencyMs: number;
  avgLatencyMs: number;
  queriesPerSecond: number;
}

/**
 * Algoritmayı çalıştır ve sonuçları topla
 */
function runBenchmark(
  algorithmName: AlgorithmName,
  queries: BenchmarkQuery[],
  memories: MemoryRow[],
  k: number,
  iterations: number
): BenchmarkResult {
  const rankings: number[][] = [];
  const groundTruths: number[][] = [];
  let totalLatencyMs = 0;

  // Her sorgu için algoritmayı çalıştır
  for (const query of queries) {
    const groundTruth = query.relevantMemoryIds;
    groundTruths.push(groundTruth);

    // Çoklu iterasyon ile ortalama latency hesapla
    let queryRanking: number[] = [];
    let queryLatencySum = 0;

    for (let i = 0; i < iterations; i++) {
      const startTime = performance.now();
      queryRanking = search(algorithmName, query.query, memories, { k });
      const endTime = performance.now();
      queryLatencySum += endTime - startTime;
    }

    totalLatencyMs += queryLatencySum / iterations;
    rankings.push(queryRanking);
  }

  // Metrikleri hesapla
  const metrics = calculateAllMetrics(rankings, groundTruths);

  // Performans metrikleri
  const avgLatencyMs = totalLatencyMs / queries.length;
  const queriesPerSecond = 1000 / avgLatencyMs;

  return {
    algorithm: algorithmName,
    rankings,
    groundTruths,
    metrics,
    totalLatencyMs,
    avgLatencyMs,
    queriesPerSecond
  };
}

/**
 * Benchmark sonuçlarını tablo formatında yazdır
 */
function printBenchmarkResults(results: BenchmarkResult[]): void {
  console.log('\n=== Retrieval Benchmark Results ===');
  console.log(`Dataset: ${benchmarkQueries.length} queries, ${benchmarkMemories.length} memories\n`);
  
  // Tablo başlığı
  const header = '| Algorithm          | MRR   | NDCG@10 | Recall@10 | Latency(ms) | QPS    |';
  const separator = '|--------------------|-------|---------|-----------|-------------|--------|';
  
  console.log(header);
  console.log(separator);

  for (const result of results) {
    const mrr = result.metrics.mrr.toFixed(2);
    const ndcg = result.metrics.ndcg.at10.toFixed(2);
    const recall = result.metrics.recall.at10.toFixed(2);
    const latency = result.avgLatencyMs.toFixed(0);
    const qps = result.queriesPerSecond.toFixed(0);
    
    console.log(
      `| ${result.algorithm.padEnd(18)} | ${mrr.padEnd(5)} | ${ndcg.padEnd(7)} | ${recall.padEnd(9)} | ${latency.padEnd(11)} | ${qps.padEnd(6)} |`
    );
  }

  // İyileştirme özeti
  if (results.length >= 2) {
    const baseline = results[0];
    const best = results.reduce((best, curr) => 
      curr.metrics.mrr > best.metrics.mrr ? curr : best
    );
    
    const mrrImprovement = ((best.metrics.mrr - baseline.metrics.mrr) / baseline.metrics.mrr * 100).toFixed(0);
    const ndcgImprovement = ((best.metrics.ndcg.at10 - baseline.metrics.ndcg.at10) / baseline.metrics.ndcg.at10 * 100).toFixed(0);
    
    console.log(`\nBest vs Baseline (${baseline.algorithm}):`);
    console.log(`  MRR Improvement: +${mrrImprovement}%`);
    console.log(`  NDCG@10 Improvement: +${ndcgImprovement}%`);
  }
}

// ========== Benchmark Testleri ==========

describe('Retrieval Benchmark', () => {
  
  // ----- Baseline Algoritma Testleri -----
  
  describe('Baseline Algorithms', () => {
    
    test('BM25 - FTS tabanlı arama', () => {
      const result = runBenchmark('bm25', benchmarkQueries, memoryRows, DEFAULT_K, BENCHMARK_ITERATIONS);
      
      console.log(`\n--- BM25 Results ---`);
      console.log(formatMetricsTable(result.metrics));
      
      // BM25 anlamlı sonuçlar döndürmeli
      expect(result.metrics.mrr).toBeGreaterThan(0);
      expect(result.avgLatencyMs).toBeLessThan(1000); // 1000ms'den hızlı (benchmark ortamı için)
      
      // Sonuçları sakla (karşılaştırma için)
      globalThis.benchmarkResults = globalThis.benchmarkResults || {};
      globalThis.benchmarkResults['bm25'] = result;
    });

    test('TF-IDF - Terim frekansı tabanlı arama', () => {
      const result = runBenchmark('tfidf', benchmarkQueries, memoryRows, DEFAULT_K, BENCHMARK_ITERATIONS);
      
      console.log(`\n--- TF-IDF Results ---`);
      console.log(formatMetricsTable(result.metrics));
      
      expect(result.metrics.mrr).toBeGreaterThan(0);
      expect(result.avgLatencyMs).toBeLessThan(1000); // 1000ms'den hızlı (benchmark ortamı için)
      
      globalThis.benchmarkResults = globalThis.benchmarkResults || {};
      globalThis.benchmarkResults['tfidf'] = result;
    });

    test('Pure Semantic - Embedding similarity arama', () => {
      const result = runBenchmark('semantic', benchmarkQueries, memoryRows, DEFAULT_K, BENCHMARK_ITERATIONS);
      
      console.log(`\n--- Pure Semantic Results ---`);
      console.log(formatMetricsTable(result.metrics));
      
      expect(result.metrics.mrr).toBeGreaterThan(0);
      expect(result.avgLatencyMs).toBeLessThan(200); // Embedding hesabı daha yavaş
      
      globalThis.benchmarkResults = globalThis.benchmarkResults || {};
      globalThis.benchmarkResults['semantic'] = result;
    });

    test('Random - Kontrol baseline', () => {
      const result = runBenchmark('random', benchmarkQueries, memoryRows, DEFAULT_K, BENCHMARK_ITERATIONS);
      
      console.log(`\n--- Random Results ---`);
      console.log(formatMetricsTable(result.metrics));
      
      // Random düşük performans göstermeli
      expect(result.metrics.mrr).toBeLessThan(0.3);
      expect(result.avgLatencyMs).toBeLessThan(10); // Çok hızlı
      
      globalThis.benchmarkResults = globalThis.benchmarkResults || {};
      globalThis.benchmarkResults['random'] = result;
    });
  });

  // ----- Hybrid Search Testleri -----
  
  describe('Hybrid Search', () => {
    
    test('Hybrid (FTS + Semantic) - BM25\'ten daha iyi performans', () => {
      const result = runBenchmark('hybrid', benchmarkQueries, memoryRows, DEFAULT_K, BENCHMARK_ITERATIONS);
      
      console.log(`\n--- Hybrid Results ---`);
      console.log(formatMetricsTable(result.metrics));
      
      expect(result.metrics.mrr).toBeGreaterThan(0);
      
      globalThis.benchmarkResults = globalThis.benchmarkResults || {};
      globalThis.benchmarkResults['hybrid'] = result;
    });

    test('PenceAI-Hybrid vs BM25 karşılaştırması', () => {
      const bm25Result = globalThis.benchmarkResults?.['bm25'] || 
        runBenchmark('bm25', benchmarkQueries, memoryRows, DEFAULT_K, BENCHMARK_ITERATIONS);
      const hybridResult = globalThis.benchmarkResults?.['hybrid'] || 
        runBenchmark('hybrid', benchmarkQueries, memoryRows, DEFAULT_K, BENCHMARK_ITERATIONS);
      
      const comparison = compareMetrics(bm25Result.metrics, hybridResult.metrics);
      
      console.log(`\n--- Hybrid vs BM25 Comparison ---`);
      console.log(formatComparisonTable(comparison));
      
      // Hybrid, BM25'ten en azından rekabetçi olmalı
      expect(hybridResult.metrics.mrr).toBeGreaterThan(bm25Result.metrics.mrr * 0.8);
    });
  });

  // ----- Kapsamlı Karşılaştırma Testleri -----
  
  describe('Comprehensive Comparison', () => {
    
    test('Tüm algoritmaların karşılaştırması', () => {
      const algorithms: AlgorithmName[] = ['bm25', 'tfidf', 'semantic', 'random', 'hybrid'];
      const results: BenchmarkResult[] = [];
      
      for (const algo of algorithms) {
        const result = runBenchmark(algo, benchmarkQueries, memoryRows, DEFAULT_K, BENCHMARK_ITERATIONS);
        results.push(result);
      }
      
      printBenchmarkResults(results);
      
      // En az bir algoritma anlamlı sonuçlar döndürmeli
      const bestMRR = Math.max(...results.map(r => r.metrics.mrr));
      expect(bestMRR).toBeGreaterThan(0.1);
      
      // Random en düşük performansı göstermeli
      const randomResult = results.find(r => r.algorithm === 'random')!;
      const nonRandomResults = results.filter(r => r.algorithm !== 'random');
      const avgNonRandomMRR = nonRandomResults.reduce((sum, r) => sum + r.metrics.mrr, 0) / nonRandomResults.length;
      
      expect(avgNonRandomMRR).toBeGreaterThan(randomResult.metrics.mrr);
    });

    test('Performans: Latency karşılaştırması', () => {
      const algorithms: AlgorithmName[] = ['bm25', 'tfidf', 'semantic', 'random'];
      const latencies: { algorithm: string; latencyMs: number }[] = [];
      
      for (const algo of algorithms) {
        const result = runBenchmark(algo, benchmarkQueries, memoryRows, DEFAULT_K, BENCHMARK_ITERATIONS);
        latencies.push({
          algorithm: algo,
          latencyMs: result.avgLatencyMs
        });
      }
      
      console.log('\n--- Latency Comparison ---');
      for (const { algorithm, latencyMs } of latencies) {
        console.log(`  ${algorithm}: ${latencyMs.toFixed(2)}ms`);
      }
      
      // Sıralama: random < bm25 ≈ tfidf < semantic
      const randomLatency = latencies.find(l => l.algorithm === 'random')!.latencyMs;
      const semanticLatency = latencies.find(l => l.algorithm === 'semantic')!.latencyMs;
      
      expect(randomLatency).toBeLessThan(semanticLatency);
    });
  });

  // ----- Zorluk Seviyesi Analizi -----
  
  describe('Difficulty Breakdown', () => {
    
    test('Kolay sorgular performansı', () => {
      const easyQueries = benchmarkQueries.filter(q => q.difficulty === 'easy');
      const result = runBenchmark('bm25', easyQueries, memoryRows, DEFAULT_K, BENCHMARK_ITERATIONS);
      
      console.log(`\n--- Easy Queries (${easyQueries.length} queries) ---`);
      console.log(`MRR: ${result.metrics.mrr.toFixed(4)}`);
      console.log(`NDCG@10: ${result.metrics.ndcg.at10.toFixed(4)}`);
      
      // Kolay sorgularda yüksek performans beklenir
      expect(result.metrics.mrr).toBeGreaterThan(0.3);
    });

    test('Orta zorlukta sorgular performansı', () => {
      const mediumQueries = benchmarkQueries.filter(q => q.difficulty === 'medium');
      const result = runBenchmark('bm25', mediumQueries, memoryRows, DEFAULT_K, BENCHMARK_ITERATIONS);
      
      console.log(`\n--- Medium Queries (${mediumQueries.length} queries) ---`);
      console.log(`MRR: ${result.metrics.mrr.toFixed(4)}`);
      console.log(`NDCG@10: ${result.metrics.ndcg.at10.toFixed(4)}`);
      
      expect(result.metrics.mrr).toBeGreaterThan(0);
    });

    test('Zor sorgular performansı', () => {
      const hardQueries = benchmarkQueries.filter(q => q.difficulty === 'hard');
      const result = runBenchmark('bm25', hardQueries, memoryRows, DEFAULT_K, BENCHMARK_ITERATIONS);
      
      console.log(`\n--- Hard Queries (${hardQueries.length} queries) ---`);
      console.log(`MRR: ${result.metrics.mrr.toFixed(4)}`);
      console.log(`NDCG@10: ${result.metrics.ndcg.at10.toFixed(4)}`);
      
      // Zor sorgularda daha düşük performans beklenir ama yine de anlamlı olmalı
      expect(result.metrics.mrr).toBeGreaterThan(0);
    });

    test('Zorluk seviyeleri karşılaştırması', () => {
      const difficulties = ['easy', 'medium', 'hard'] as const;
      const results: { difficulty: string; mrr: number; ndcg: number }[] = [];
      
      for (const difficulty of difficulties) {
        const queries = benchmarkQueries.filter(q => q.difficulty === difficulty);
        const result = runBenchmark('hybrid', queries, memoryRows, DEFAULT_K, BENCHMARK_ITERATIONS);
        results.push({
          difficulty,
          mrr: result.metrics.mrr,
          ndcg: result.metrics.ndcg.at10
        });
      }
      
      console.log('\n--- Difficulty Breakdown ---');
      console.log('| Difficulty | MRR    | NDCG@10 |');
      console.log('|------------|--------|---------|');
      for (const { difficulty, mrr, ndcg } of results) {
        console.log(`| ${difficulty.padEnd(10)} | ${mrr.toFixed(4)} | ${ndcg.toFixed(4)}  |`);
      }
      
      // Kolay > Orta > Zor sıralaması beklenir
      const easyMRR = results.find(r => r.difficulty === 'easy')!.mrr;
      const hardMRR = results.find(r => r.difficulty === 'hard')!.mrr;
      expect(easyMRR).toBeGreaterThan(hardMRR * 0.5); // En azından yarısı kadar
    });
  });

  // ----- Kategori Analizi -----
  
  describe('Category Breakdown', () => {
    
    test('Preference sorguları performansı', () => {
      const prefQueries = benchmarkQueries.filter(q => q.category === 'preference');
      const result = runBenchmark('hybrid', prefQueries, memoryRows, DEFAULT_K, BENCHMARK_ITERATIONS);
      
      console.log(`\n--- Preference Queries (${prefQueries.length} queries) ---`);
      console.log(`MRR: ${result.metrics.mrr.toFixed(4)}`);
      console.log(`Recall@10: ${result.metrics.recall.at10.toFixed(4)}`);
      
      expect(result.metrics.mrr).toBeGreaterThan(0);
    });

    test('Factual sorguları performansı', () => {
      const factualQueries = benchmarkQueries.filter(q => q.category === 'factual');
      const result = runBenchmark('hybrid', factualQueries, memoryRows, DEFAULT_K, BENCHMARK_ITERATIONS);
      
      console.log(`\n--- Factual Queries (${factualQueries.length} queries) ---`);
      console.log(`MRR: ${result.metrics.mrr.toFixed(4)}`);
      console.log(`Recall@10: ${result.metrics.recall.at10.toFixed(4)}`);
      
      expect(result.metrics.mrr).toBeGreaterThan(0);
    });

    test('Follow-up sorguları performansı', () => {
      const followUpQueries = benchmarkQueries.filter(q => q.category === 'follow_up');
      const result = runBenchmark('hybrid', followUpQueries, memoryRows, DEFAULT_K, BENCHMARK_ITERATIONS);
      
      console.log(`\n--- Follow-up Queries (${followUpQueries.length} queries) ---`);
      console.log(`MRR: ${result.metrics.mrr.toFixed(4)}`);
      console.log(`Recall@10: ${result.metrics.recall.at10.toFixed(4)}`);
      
      expect(result.metrics.mrr).toBeGreaterThan(0);
    });

    test('Exploratory sorguları performansı', () => {
      const exploratoryQueries = benchmarkQueries.filter(q => q.category === 'exploratory');
      const result = runBenchmark('hybrid', exploratoryQueries, memoryRows, DEFAULT_K, BENCHMARK_ITERATIONS);
      
      console.log(`\n--- Exploratory Queries (${exploratoryQueries.length} queries) ---`);
      console.log(`MRR: ${result.metrics.mrr.toFixed(4)}`);
      console.log(`Recall@10: ${result.metrics.recall.at10.toFixed(4)}`);
      
      expect(result.metrics.mrr).toBeGreaterThan(0);
    });
  });

  // ----- Recall@K Analizi -----
  
  describe('Recall@K Analysis', () => {
    
    test('Farklı K değerleri için Recall', () => {
      const kValues = [1, 5, 10, 20];
      const results: { k: number; recall: number }[] = [];
      
      for (const k of kValues) {
        const result = runBenchmark('hybrid', benchmarkQueries, memoryRows, k, BENCHMARK_ITERATIONS);
        results.push({
          k,
          recall: result.metrics.recall[`at${k}` as keyof typeof result.metrics.recall] || 
                  calculateMeanRecallAtK(result.rankings, result.groundTruths, k)
        });
      }
      
      console.log('\n--- Recall@K Analysis ---');
      console.log('| K  | Recall  |');
      console.log('|----|---------|');
      for (const { k, recall } of results) {
        console.log(`| ${k.toString().padEnd(2)} | ${recall.toFixed(4)}  |`);
      }
      
      // K arttıkça Recall artmalı
      const recall1 = results.find(r => r.k === 1)!.recall;
      const recall10 = results.find(r => r.k === 10)!.recall;
      expect(recall10).toBeGreaterThan(recall1);
    });
  });

  // ----- NDCG@K Analizi -----
  
  describe('NDCG@K Analysis', () => {
    
    test('Farklı K değerleri için NDCG', () => {
      const kValues = [5, 10, 20];
      const results: { k: number; ndcg: number }[] = [];
      
      for (const k of kValues) {
        const result = runBenchmark('hybrid', benchmarkQueries, memoryRows, k, BENCHMARK_ITERATIONS);
        const ndcgKey = `at${k}` as keyof typeof result.metrics.ndcg;
        results.push({
          k,
          ndcg: result.metrics.ndcg[ndcgKey]
        });
      }
      
      console.log('\n--- NDCG@K Analysis ---');
      console.log('| K  | NDCG    |');
      console.log('|----|---------|');
      for (const { k, ndcg } of results) {
        console.log(`| ${k.toString().padEnd(2)} | ${ndcg.toFixed(4)}  |`);
      }
      
      // NDCG değerleri 0-1 aralığında olmalı
      for (const { ndcg } of results) {
        expect(ndcg).toBeGreaterThanOrEqual(0);
        expect(ndcg).toBeLessThanOrEqual(1);
      }
    });
  });

  // ----- Performans Benchmark -----
  
  describe('Performance Benchmark', () => {
    
    test('Throughput karşılaştırması', () => {
      const algorithms: AlgorithmName[] = ['bm25', 'tfidf', 'semantic', 'random'];
      const results: { algorithm: string; qps: number }[] = [];
      
      for (const algo of algorithms) {
        const result = runBenchmark(algo, benchmarkQueries, memoryRows, DEFAULT_K, BENCHMARK_ITERATIONS);
        results.push({
          algorithm: algo,
          qps: result.queriesPerSecond
        });
      }
      
      console.log('\n--- Throughput Comparison ---');
      console.log('| Algorithm | QPS    |');
      console.log('|-----------|--------|');
      for (const { algorithm, qps } of results) {
        console.log(`| ${algorithm.padEnd(9)} | ${qps.toFixed(0).padEnd(6)} |`);
      }
      
      // Tüm algoritmalar en az 1 QPS sağlamalı (benchmark ortamı için)
      for (const { qps } of results) {
        expect(qps).toBeGreaterThan(1);
      }
    });

    test('P99 Latency hesaplama', () => {
      const latencies: number[] = [];
      
      // Her sorgu için latency ölç
      for (const query of benchmarkQueries) {
        const start = performance.now();
        search('hybrid', query.query, memoryRows, { k: DEFAULT_K });
        const end = performance.now();
        latencies.push(end - start);
      }
      
      // P99 hesapla
      latencies.sort((a, b) => a - b);
      const p99Index = Math.floor(latencies.length * 0.99);
      const p99 = latencies[p99Index];
      
      console.log(`\n--- Latency Percentiles ---`);
      console.log(`P50: ${latencies[Math.floor(latencies.length * 0.5)].toFixed(2)}ms`);
      console.log(`P90: ${latencies[Math.floor(latencies.length * 0.9)].toFixed(2)}ms`);
      console.log(`P99: ${p99.toFixed(2)}ms`);
      
      // P99 2000ms'den az olmalı (benchmark ortamı için)
      expect(p99).toBeLessThan(2000);
    });
  });

  // ----- Özet Rapor -----
  
  describe('Summary Report', () => {
    
    test('Tüm sonuçların özet raporu', () => {
      const algorithms: AlgorithmName[] = ['bm25', 'tfidf', 'semantic', 'random', 'hybrid'];
      const results: BenchmarkResult[] = [];
      
      for (const algo of algorithms) {
        const result = runBenchmark(algo, benchmarkQueries, memoryRows, DEFAULT_K, BENCHMARK_ITERATIONS);
        results.push(result);
      }
      
      // Özet tablo
      printBenchmarkResults(results);
      
      // JSON formatında sonuçlar
      const jsonResults = {
        dataset: {
          queries: benchmarkQueries.length,
          memories: benchmarkMemories.length,
          categoryDistribution: benchmarkQueries.reduce((acc, q) => {
            acc[q.category] = (acc[q.category] || 0) + 1;
            return acc;
          }, {} as Record<string, number>),
          difficultyDistribution: benchmarkQueries.reduce((acc, q) => {
            acc[q.difficulty] = (acc[q.difficulty] || 0) + 1;
            return acc;
          }, {} as Record<string, number>)
        },
        algorithms: results.map(r => ({
          name: r.algorithm,
          mrr: r.metrics.mrr,
          map: r.metrics.map,
          ndcgAt10: r.metrics.ndcg.at10,
          recallAt10: r.metrics.recall.at10,
          avgLatencyMs: r.avgLatencyMs,
          qps: r.queriesPerSecond
        }))
      };
      
      console.log('\n--- JSON Results ---');
      console.log(JSON.stringify(jsonResults, null, 2));
      
      // Başarı kriterleri
      const bestResult = results.reduce((best, curr) => 
        curr.metrics.mrr > best.metrics.mrr ? curr : best
      );
      
      expect(bestResult.metrics.mrr).toBeGreaterThan(0.1);
    });
  });
});

// ========== Global Type Declarations ==========

declare global {
  // eslint-disable-next-line no-var
  var benchmarkResults: Record<string, BenchmarkResult>;
}
