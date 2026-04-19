import type { SearchResult, SearchQuery, SearchSource, SourceHealth } from './types.js';
import { DEFAULT_SOURCE_CONFIG } from './types.js';
import { DuckDuckGoSearchAdapter } from './sources/duckduckgo.js';
import { WikipediaSearchAdapter } from './sources/wikipedia.js';
import { HackerNewsSearchAdapter } from './sources/hackernews.js';
import { RedditSearchAdapter } from './sources/reddit.js';
import { routeQuery } from './router.js';
import { mergeAndRankResults, formatResults } from './merger.js';

export type { SearchResult, SearchQuery, SearchSource } from './types.js';

interface SmartSearchOptions {
  braveApiKey?: string;
  enableDuckDuckGo?: boolean;
  enableWikipedia?: boolean;
  enableHackerNews?: boolean;
  enableReddit?: boolean;
}

export class SmartSearchEngine {
  private adapters: Map<SearchSource, { adapter: DuckDuckGoSearchAdapter | WikipediaSearchAdapter | HackerNewsSearchAdapter | RedditSearchAdapter; enabled: boolean }>;
  private braveApiKey?: string;

  constructor(options: SmartSearchOptions = {}) {
    this.braveApiKey = options.braveApiKey;

    this.adapters = new Map([
      ['duckduckgo', { adapter: new DuckDuckGoSearchAdapter(), enabled: options.enableDuckDuckGo ?? true }],
      ['wikipedia', { adapter: new WikipediaSearchAdapter(), enabled: options.enableWikipedia ?? true }],
      ['hackernews', { adapter: new HackerNewsSearchAdapter(), enabled: options.enableHackerNews ?? true }],
      ['reddit', { adapter: new RedditSearchAdapter(), enabled: options.enableReddit ?? true }],
    ]);
  }

  get hasBraveKey(): boolean {
    return !!this.braveApiKey;
  }

  getSourceHealth(): SourceHealth[] {
    const health: SourceHealth[] = [];

    if (this.braveApiKey) {
      health.push({ source: 'brave', available: true, requestCount: 0 });
    }

    for (const [source, { adapter, enabled }] of this.adapters) {
      health.push({
        source,
        available: enabled && adapter.isAvailable(),
        requestCount: 0,
      });
    }

    return health;
  }

  async search(query: string, options?: { count?: number; freshness?: 'pd' | 'pw' | 'pm' | 'py' }): Promise<{ results: SearchResult[]; formatted: string; sources: SearchSource[]; intent: string }> {
    const searchQuery: SearchQuery = {
      query,
      count: options?.count ?? DEFAULT_SOURCE_CONFIG.defaultCount,
      freshness: options?.freshness,
    };

    if (this.braveApiKey) {
      const results = await this.braveSearch(searchQuery);
      if (results.length > 0) {
        return {
          results,
          formatted: formatResults(results),
          sources: ['brave'],
          intent: 'general',
        };
      }
    }

    const enabledSources = Array.from(this.adapters.entries())
      .filter(([, { enabled }]) => enabled)
      .filter(([, { adapter }]) => adapter.isAvailable())
      .map(([source]) => source) as SearchSource[];

    const { intent, sources: routedSources } = routeQuery(query, enabledSources);

    const resultsBySource = new Map<SearchSource, SearchResult[]>();

    const promises = routedSources.map(async (source) => {
      const entry = this.adapters.get(source);
      if (!entry || !entry.enabled) return;

      try {
        const results = await entry.adapter.search(searchQuery);
        if (results.length > 0) {
          resultsBySource.set(source, results);
        }
      } catch {
        // Source failed, continue with others
      }
    });

    await Promise.all(promises);

    const merged = mergeAndRankResults(resultsBySource, {
      maxResults: searchQuery.count,
    });

    return {
      results: merged,
      formatted: formatResults(merged),
      sources: routedSources,
      intent,
    };
  }

  private async braveSearch(query: SearchQuery): Promise<SearchResult[]> {
    if (!this.braveApiKey) return [];

    const params = new URLSearchParams({
      q: query.query,
      count: String(Math.min(query.count ?? 5, 10)),
      search_lang: 'tr',
    });
    if (query.freshness) params.set('freshness', query.freshness);

    try {
      const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': this.braveApiKey!,
        },
      });

      if (!response.ok) return [];

      const data = await response.json() as any;
      const results = data?.web?.results ?? [];

      return results.slice(0, query.count ?? 5).map((r: any, i: number) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        snippet: r.description ?? '',
        source: 'brave' as const,
        date: r.age,
        score: 1.0 / (60 + i + 1),
      }));
    } catch {
      return [];
    }
  }
}

export { formatResults, mergeAndRankResults } from './merger.js';
export { routeQuery } from './router.js';
export { DuckDuckGoSearchAdapter } from './sources/duckduckgo.js';
export { WikipediaSearchAdapter } from './sources/wikipedia.js';
export { HackerNewsSearchAdapter } from './sources/hackernews.js';
export { RedditSearchAdapter } from './sources/reddit.js';