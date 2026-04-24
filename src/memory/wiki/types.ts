/**
 * Karpathy LLM Wiki — Bellek Kalite Sistemi Tipleri
 * Faz 1-4: Global çelişki tespiti, kullanıcı odaklı editing,
 * provenance tracking, adaptive retrieval ve export.
 */

export type ContradictionStatus = 'open' | 'confirmed' | 'resolved' | 'false_positive' | 'outdated';

export type ContradictionDetectionType =
  | 'jaccard'
  | 'semantic'
  | 'entity_overlap'
  | 'relation_contradicts'
  | 'llm_flagged'
  | 'user_reported';

export interface ContradictionCandidate {
  id: number;
  memoryAId: number;
  memoryBId: number;
  detectionType: ContradictionDetectionType;
  confidence: number;
  description: string;
  status: ContradictionStatus;
  detectedAt: string;
  resolvedAt: string | null;
  resolutionNotes: string;
}

export interface LintPassResult {
  scannedPairs: number;
  contradictionsFound: number;
  falsePositivesFiltered: number;
  durationMs: number;
}

export interface MemoryRevision {
  id: number;
  memoryId: number;
  revisionNumber: number;
  content: string;
  category: string;
  importance: number;
  provenanceSource: string | null;
  provenanceModel: string | null;
  provenancePromptHash: string | null;
  createdAt: string;
}

export interface ProvenanceTrace {
  source: string | null;
  model: string | null;
  promptHash: string | null;
  revisionCount: number;
}

export interface ExportMemoryRow {
  id: number;
  content: string;
  category: string;
  importance: number;
  created_at: string;
  updated_at: string;
}

export interface ObsidianFile {
  filename: string;
  content: string;
}
