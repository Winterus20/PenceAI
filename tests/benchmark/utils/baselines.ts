/**
 * Baseline Algoritma Implementasyonları
 * 
 * PenceAI retrieval algoritmasını karşılaştırmak için
 * standart bilgi erişim algoritmaları.
 * 
 * Algoritmalar:
 * - BM25: Okapi BM25 ranking fonksiyonu (FTS tabanlı)
 * - TF-IDF: Term Frequency-Inverse Document Frequency
 * - Pure Semantic: Sadece embedding similarity
 * - Random: Kontrol baseline'ı
 */

import type { MemoryRow } from '../../../src/memory/types.js';

// ========== Tip Tanımlamaları ==========

export interface SearchResult {
  id: number;
  score: number;
}

export interface SearchOptions {
  k: number;
  memoryType?: 'semantic' | 'episodic' | 'all';
}

// ========== Tokenization Helper ==========

/**
 * Metni token'lara ayır (Türkçe ve İngilizce destekli)
 * 
 * @param text - İşlenecek metin
 * @returns Token dizisi
 */
function tokenize(text: string): string[] {
  // Küçük harfe çevir ve özel karakterleri temizle
  const cleaned = text
    .toLowerCase()
    .replace(/[^\wğüşıöçĞÜŞİÖÇa-z0-9\s]/g, ' ')
    .trim();
  
  // Boşluklara göre ayır ve boş token'ları filtrele
  return cleaned.split(/\s+/).filter(token => token.length > 1);
}

/**
 * Türkçe stop words listesi
 */
const TURKISH_STOP_WORDS = new Set([
  've', 'veya', 'ya', 'da', 'de', 'bu', 'şu', 'o', 'bir', 'için',
  'ile', 'olan', 'olarak', 'gibi', 'kadar', 'daha', 'en', 'çok',
  'az', 'var', 'yok', 'varsa', 'yoksa', 'ise', 'ki', 'ne', 'nasıl',
  'neden', 'nerede', 'ne zaman', 'kim', 'hangi', 'hangisi',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'must', 'shall',
  'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in',
  'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through'
]);

/**
 * Stop word'leri filtrele
 * 
 * @param tokens - Token dizisi
 * @returns Filtrelenmiş token dizisi
 */
function filterStopWords(tokens: string[]): string[] {
  return tokens.filter(token => !TURKISH_STOP_WORDS.has(token));
}

// ========== BM25 Implementation ==========

/**
 * BM25 parametreleri
 */
const BM25_K1 = 1.2;  // Term frequency saturation parameter
const BM25_B = 0.75;  // Length normalization parameter

/**
 * Belge uzunluğunu hesapla
 */
function getDocumentLength(memory: MemoryRow): number {
  return tokenize(memory.content).length;
}

/**
 * Ortalama belge uzunluğunu hesapla
 */
function getAverageDocumentLength(memories: MemoryRow[]): number {
  if (memories.length === 0) return 0;
  const totalLength = memories.reduce((sum, m) => sum + getDocumentLength(m), 0);
  return totalLength / memories.length;
}

/**
 * Term frequency hesapla (belgedeki terim frekansı)
 */
function getTermFrequency(term: string, memory: MemoryRow): number {
  const tokens = tokenize(memory.content);
  return tokens.filter(t => t === term).length;
}

/**
 * Document frequency hesapla (terimi içeren belge sayısı)
 */
function getDocumentFrequency(term: string, memories: MemoryRow[]): number {
  return memories.filter(m => {
    const tokens = tokenize(m.content);
    return tokens.includes(term);
  }).length;
}

/**
 * IDF (Inverse Document Frequency) hesapla
 */
function calculateIDF(term: string, memories: MemoryRow[]): number {
  const df = getDocumentFrequency(term, memories);
  const N = memories.length;
  if (df === 0) return 0;
  return Math.log((N - df + 0.5) / (df + 0.5) + 1);
}

/**
 * BM25 skoru hesapla
 * 
 * BM25 = Σ(IDF(qi) * (f(qi,D) * (k1 + 1)) / (f(qi,D) + k1 * (1 - b + b * |D|/avgdl)))
 * 
 * @param query - Sorgu metni
 * @param memory - Bellek kaydı
 * @param memories - Tüm bellek kayıtları (IDF hesabı için)
 * @param avgdl - Ortalama belge uzunluğu
 * @returns BM25 skoru
 */
function calculateBM25Score(
  query: string,
  memory: MemoryRow,
  memories: MemoryRow[],
  avgdl: number
): number {
  const queryTerms = filterStopWords(tokenize(query));
  const docLength = getDocumentLength(memory);
  
  let score = 0;
  
  for (const term of queryTerms) {
    const tf = getTermFrequency(term, memory);
    const idf = calculateIDF(term, memories);
    
    if (tf > 0) {
      // BM25 formula
      const numerator = tf * (BM25_K1 + 1);
      const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLength / avgdl));
      score += idf * (numerator / denominator);
    }
  }
  
  return score;
}

/**
 * BM25 Search
 * 
 * Okapi BM25 algoritması ile bellek araması yapar.
 * FTS tabanlı bir algoritmadır ve terim frekansı ile belge uzunluğunu dikkate alır.
 * 
 * @param query - Sorgu metni
 * @param memories - Bellek kayıtları
 * @param options - Arama seçenekleri
 * @returns Sıralı memory ID'leri
 * 
 * @example
 * const results = bm25Search('TypeScript programlama', memories, { k: 10 });
 * // [5, 12, 3, 8, ...] - BM25 skoruna göre sıralı
 */
export function bm25Search(
  query: string,
  memories: MemoryRow[],
  options: SearchOptions
): number[] {
  const { k } = options;
  
  if (memories.length === 0 || !query.trim()) {
    return [];
  }
  
  const avgdl = getAverageDocumentLength(memories);
  
  // Her bellek için BM25 skoru hesapla
  const scored: SearchResult[] = memories.map(memory => ({
    id: memory.id,
    score: calculateBM25Score(query, memory, memories, avgdl)
  }));
  
  // Skorlara göre sırala (azalan) ve ilk k sonucu al
  scored.sort((a, b) => b.score - a.score);
  
  return scored.slice(0, k).map(r => r.id);
}

// ========== TF-IDF Implementation ==========

/**
 * TF (Term Frequency) hesapla - normalized
 */
function calculateTF(term: string, memory: MemoryRow): number {
  const tokens = tokenize(memory.content);
  const tf = tokens.filter(t => t === term).length;
  // Log normalization
  return tf > 0 ? 1 + Math.log(tf) : 0;
}

/**
 * TF-IDF skoru hesapla
 * 
 * TF-IDF = TF * IDF
 * 
 * @param query - Sorgu metni
 * @param memory - Bellek kaydı
 * @param memories - Tüm bellek kayıtları
 * @returns TF-IDF skoru
 */
function calculateTFIDFScore(
  query: string,
  memory: MemoryRow,
  memories: MemoryRow[]
): number {
  const queryTerms = filterStopWords(tokenize(query));
  
  let score = 0;
  
  for (const term of queryTerms) {
    const tf = calculateTF(term, memory);
    const idf = calculateIDF(term, memories);
    score += tf * idf;
  }
  
  return score;
}

/**
 * TF-IDF Search
 * 
 * Term Frequency-Inverse Document Frequency algoritması ile bellek araması yapar.
 * Terim frekansı ve belge frekansını dikkate alır.
 * 
 * @param query - Sorgu metni
 * @param memories - Bellek kayıtları
 * @param options - Arama seçenekleri
 * @returns Sıralı memory ID'leri
 * 
 * @example
 * const results = tfidfSearch('React component', memories, { k: 10 });
 * // [8, 15, 22, ...] - TF-IDF skoruna göre sıralı
 */
export function tfidfSearch(
  query: string,
  memories: MemoryRow[],
  options: SearchOptions
): number[] {
  const { k } = options;
  
  if (memories.length === 0 || !query.trim()) {
    return [];
  }
  
  // Her bellek için TF-IDF skoru hesapla
  const scored: SearchResult[] = memories.map(memory => ({
    id: memory.id,
    score: calculateTFIDFScore(query, memory, memories)
  }));
  
  // Skorlara göre sırala (azalan) ve ilk k sonucu al
  scored.sort((a, b) => b.score - a.score);
  
  return scored.slice(0, k).map(r => r.id);
}

// ========== Pure Semantic Search ==========

/**
 * Mock embedding vektörü oluştur
 * 
 * Gerçek embedding yerine, içerikten deterministik bir vektör oluşturur.
 * Benchmark için tutarlı sonuçlar sağlar.
 * 
 * @param text - Metin
 * @param dimensions - Vektör boyutu (varsayılan: 128)
 * @returns Mock embedding vektörü
 */
function createMockEmbedding(text: string, dimensions: number = 128): number[] {
  const tokens = tokenize(text);
  const embedding: number[] = [];
  
  // Her dimension için deterministik bir değer oluştur
  for (let i = 0; i < dimensions; i++) {
    let sum = 0;
    for (let j = 0; j < tokens.length; j++) {
      // Token karakterlerinin hash'ini kullan
      const charCode = (tokens[j].charCodeAt(j % tokens[j].length) || 0);
      sum += Math.sin(charCode * (i + 1) * 0.01) * Math.cos(j * 0.1);
    }
    // Normalize et
    embedding.push(sum / Math.max(tokens.length, 1));
  }
  
  // L2 normalize
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  return norm > 0 ? embedding.map(v => v / norm) : embedding;
}

/**
 * Cosine similarity hesapla
 * 
 * similarity = (A · B) / (||A|| * ||B||)
 * 
 * @param a - İlk vektör
 * @param b - İkinci vektör
 * @returns Cosine similarity (-1 ile 1 arası)
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator > 0 ? dotProduct / denominator : 0;
}

// Embedding cache (performans için)
const embeddingCache = new Map<string, number[]>();

/**
 * Cached embedding al
 */
function getCachedEmbedding(text: string): number[] {
  const cacheKey = text.toLowerCase().trim();
  if (!embeddingCache.has(cacheKey)) {
    embeddingCache.set(cacheKey, createMockEmbedding(cacheKey));
  }
  return embeddingCache.get(cacheKey)!;
}

/**
 * Pure Semantic Search
 * 
 * Sadece embedding similarity kullanarak bellek araması yapar.
 * FTS kullanmaz, tamamen anlamsal benzerliğe dayanır.
 * 
 * @param query - Sorgu metni
 * @param memories - Bellek kayıtları
 * @param options - Arama seçenekleri
 * @returns Sıralı memory ID'leri
 * 
 * @example
 * const results = pureSemanticSearch('programlama dili', memories, { k: 10 });
 * // [3, 7, 12, ...] - Semantic similarity'ye göre sıralı
 */
export function pureSemanticSearch(
  query: string,
  memories: MemoryRow[],
  options: SearchOptions
): number[] {
  const { k } = options;
  
  if (memories.length === 0 || !query.trim()) {
    return [];
  }
  
  // Sorgu embedding'ini al
  const queryEmbedding = getCachedEmbedding(query);
  
  // Her bellek için semantic similarity hesapla
  const scored: SearchResult[] = memories.map(memory => {
    const memoryEmbedding = getCachedEmbedding(memory.content);
    return {
      id: memory.id,
      score: cosineSimilarity(queryEmbedding, memoryEmbedding)
    };
  });
  
  // Skorlara göre sırala (azalan) ve ilk k sonucu al
  scored.sort((a, b) => b.score - a.score);
  
  return scored.slice(0, k).map(r => r.id);
}

// ========== Random Search (Control Baseline) ==========

/**
 * Seeded random number generator
 * 
 * Deterministik sonuçlar için kullanılır.
 */
class SeededRandom {
  private seed: number;
  
  constructor(seed: number) {
    this.seed = seed;
  }
  
  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }
}

/**
 * Random Search
 * 
 * Kontrol baseline'ı olarak rastgele sıralama döndürür.
 * Deterministik sonuçlar için seeded random kullanır.
 * 
 * @param query - Sorgu metni (kullanılmaz, sadece API uyumluluğu için)
 * @param memories - Bellek kayıtları
 * @param options - Arama seçenekleri
 * @returns Rastgele sıralı memory ID'leri
 * 
 * @example
 * const results = randomSearch('herhangi bir sorgu', memories, { k: 10 });
 * // [42, 7, 15, 3, ...] - Rastgele sıralı
 */
export function randomSearch(
  query: string,
  memories: MemoryRow[],
  options: SearchOptions
): number[] {
  const { k } = options;
  
  if (memories.length === 0) {
    return [];
  }
  
  // Query'den seed oluştur (deterministik sonuçlar için)
  const seed = query.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0);
  const random = new SeededRandom(seed);
  
  // Bellekleri kopyala ve karıştır
  const shuffled = [...memories];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random.next() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  // İlk k sonucu al
  return shuffled.slice(0, k).map(m => m.id);
}

// ========== Hybrid Search (FTS + Semantic) ==========

/**
 * Hybrid Search (RRF fusion olmadan basit versiyon)
 * 
 * FTS ve Semantic skorlarını ağırlıklı olarak birleştirir.
 * 
 * @param query - Sorgu metni
 * @param memories - Bellek kayıtları
 * @param options - Arama seçenekleri
 * @param ftsWeight - FTS ağırlığı (varsayılan: 0.5)
 * @param semanticWeight - Semantic ağırlığı (varsayılan: 0.5)
 * @returns Sıralı memory ID'leri
 */
export function hybridSearch(
  query: string,
  memories: MemoryRow[],
  options: SearchOptions,
  ftsWeight: number = 0.5,
  semanticWeight: number = 0.5
): number[] {
  const { k } = options;
  
  if (memories.length === 0 || !query.trim()) {
    return [];
  }
  
  const avgdl = getAverageDocumentLength(memories);
  const queryEmbedding = getCachedEmbedding(query);
  
  // Her bellek için hem FTS hem semantic skor hesapla
  const scored: SearchResult[] = memories.map(memory => {
    const ftsScore = calculateBM25Score(query, memory, memories, avgdl);
    const memoryEmbedding = getCachedEmbedding(memory.content);
    const semanticScore = cosineSimilarity(queryEmbedding, memoryEmbedding);
    
    // Skorları normalize et ve birleştir
    // FTS skoru 0-10 aralığında olabilir, semantic 0-1 aralığında
    const normalizedFts = Math.min(ftsScore / 10, 1);
    
    return {
      id: memory.id,
      score: ftsWeight * normalizedFts + semanticWeight * semanticScore
    };
  });
  
  // Skorlara göre sırala (azalan) ve ilk k sonucu al
  scored.sort((a, b) => b.score - a.score);
  
  return scored.slice(0, k).map(r => r.id);
}

// ========== Algoritma Registry ==========

export type AlgorithmName = 'bm25' | 'tfidf' | 'semantic' | 'random' | 'hybrid';

export interface AlgorithmInfo {
  name: AlgorithmName;
  displayName: string;
  description: string;
  search: (
    query: string,
    memories: MemoryRow[],
    options: SearchOptions
  ) => number[];
}

export const ALGORITHMS: Record<AlgorithmName, AlgorithmInfo> = {
  bm25: {
    name: 'bm25',
    displayName: 'BM25',
    description: 'Okapi BM25 - FTS tabanlı ranking algoritması',
    search: bm25Search
  },
  tfidf: {
    name: 'tfidf',
    displayName: 'TF-IDF',
    description: 'Term Frequency-Inverse Document Frequency',
    search: tfidfSearch
  },
  semantic: {
    name: 'semantic',
    displayName: 'Pure Semantic',
    description: 'Sadece embedding similarity tabanlı arama',
    search: pureSemanticSearch
  },
  random: {
    name: 'random',
    displayName: 'Random',
    description: 'Kontrol baseline - rastgele sıralama',
    search: randomSearch
  },
  hybrid: {
    name: 'hybrid',
    displayName: 'Hybrid (FTS + Semantic)',
    description: 'FTS ve Semantic skorlarının ağırlıklı birleşimi',
    search: hybridSearch
  }
};

/**
 * Algoritma ile arama yap
 * 
 * @param algorithm - Algoritma adı
 * @param query - Sorgu metni
 * @param memories - Bellek kayıtları
 * @param options - Arama seçenekleri
 * @returns Sıralı memory ID'leri
 */
export function search(
  algorithm: AlgorithmName,
  query: string,
  memories: MemoryRow[],
  options: SearchOptions
): number[] {
  const algo = ALGORITHMS[algorithm];
  if (!algo) {
    throw new Error(`Bilinmeyen algoritma: ${algorithm}`);
  }
  return algo.search(query, memories, options);
}

// ========== Embedding Cache Temizleme ==========

/**
 * Embedding cache'i temizle
 * 
 * Testler arasında bellek sızıntısını önlemek için kullanılır.
 */
export function clearEmbeddingCache(): void {
  embeddingCache.clear();
}
