/**
 * Insight Engine tip tanımları
 */

export type InsightType = 'preference' | 'habit' | 'correction_pattern' | 'tool_pattern';

export type InsightStatus = 'active' | 'suppressed' | 'pruned';

export interface Insight {
  id: number;
  userId: string;
  type: InsightType;
  description: string;
  confidence: number;
  hitCount: number;
  firstSeen: string;
  lastSeen: string;
  sourceMemoryIds: number[];
  sessionIds: string[];
  status: InsightStatus;
  ttlDays: number;
  createdAt: string;
  updatedAt: string;
}

export interface InsightRow {
  id: number;
  user_id: string;
  type: InsightType;
  description: string;
  confidence: number;
  hit_count: number;
  first_seen: string;
  last_seen: string;
  source_memory_ids: string;
  session_ids: string;
  status: InsightStatus;
  ttl_days: number;
  created_at: string;
  updated_at: string;
}

export interface Observation {
  type: 'correction' | 'preference' | 'tool_pattern' | 'rejection' | 'user_affirmation';
  timestamp: number;
  sessionId: string;
  context: string;
  source: 'feedback' | 'hook' | 'extraction';
  memoryId?: number;
  toolName?: string;
  args?: Record<string, unknown>;
}

export interface DetectedPattern {
  id: string;
  type: InsightType;
  description: string;
  observations: string[];
  confidence: number;
  firstSeen: number;
  lastSeen: number;
  hitCount: number;
  sessionIds: string[];
  sourceMemoryIds: number[];
}

export interface ConfidenceDimensions {
  frequency: number;
  recency: number;
  consistency: number;
  userAffirmation: number;
  crossSession: number;
}

export interface InsightQueryResult {
  insight: Insight;
  relevance: number;
}

export interface InsightEngineConfig {
  confidenceWeights: {
    frequency: number;
    recency: number;
    consistency: number;
    userAffirmation: number;
    crossSession: number;
  };
  thresholds: {
    certain: number;
    high: number;
    medium: number;
    low: number;
    garbage: number;
  };
  defaultTTLDays: number;
  dynamicTTL: boolean;
  minObservationsForPattern: number;
}
