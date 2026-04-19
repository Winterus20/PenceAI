export type SearchSource = 'brave' | 'duckduckgo' | 'wikipedia' | 'hackernews' | 'reddit';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: SearchSource;
  score?: number;
  date?: string;
  extra?: Record<string, unknown>;
}

export interface SearchQuery {
  query: string;
  count?: number;
  freshness?: 'pd' | 'pw' | 'pm' | 'py';
  sources?: SearchSource[];
}

export interface SourceHealth {
  source: SearchSource;
  available: boolean;
  lastError?: string;
  cooldownUntil?: number;
  requestCount: number;
}

export interface SearchSourceAdapter {
  name: SearchSource;
  search(query: SearchQuery): Promise<SearchResult[]>;
  isAvailable(): boolean;
}

export const SOURCE_WEIGHTS: Record<SearchSource, number> = {
  brave: 1.0,
  duckduckgo: 0.9,
  wikipedia: 1.5,
  hackernews: 1.3,
  reddit: 0.7,
};

export const DEFAULT_SOURCE_CONFIG = {
  maxResults: 10,
  defaultCount: 5,
  rateLimitPerMinute: 20,
  cooldownMs: 300000,
  requestTimeoutMs: 10000,
} as const;