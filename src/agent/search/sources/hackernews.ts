import type { SearchSourceAdapter, SearchResult, SearchQuery } from '../types.js';
import { DEFAULT_SOURCE_CONFIG } from '../types.js';

const HN_API_URL = 'https://hn.algolia.com/api/v1/search';

interface HNHit {
  objectID: string;
  title: string;
  url: string;
  story_text?: string;
  created_at: string;
  created_at_i: number;
  points: number;
  num_comments: number;
  author: string;
}

interface HNResponse {
  hits: HNHit[];
  nbHits: number;
  page: number;
  nbPages: number;
  hitsPerPage: number;
  processingTimeMS: number;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

const FRESHNESS_TIMESTAMP: Record<string, number> = {
  pd: Math.floor(Date.now() / 1000) - 86400,
  pw: Math.floor(Date.now() / 1000) - 604800,
  pm: Math.floor(Date.now() / 1000) - 2592000,
  py: Math.floor(Date.now() / 1000) - 31536000,
};

export class HackerNewsSearchAdapter implements SearchSourceAdapter {
  readonly name = 'hackernews' as const;
  private cooldownUntil = 0;
  private consecutiveFailures = 0;

  isAvailable(): boolean {
    return Date.now() >= this.cooldownUntil;
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    if (!this.isAvailable()) return [];

    const count = query.count ?? DEFAULT_SOURCE_CONFIG.defaultCount;
    const params = new URLSearchParams({
      query: query.query,
      tags: 'story',
      hitsPerPage: String(count),
    });

    if (query.freshness && FRESHNESS_TIMESTAMP[query.freshness]) {
      params.set('numericFilters', `created_at_i>${FRESHNESS_TIMESTAMP[query.freshness]}`);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(`${HN_API_URL}?${params.toString()}`, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= 5) {
          this.cooldownUntil = Date.now() + DEFAULT_SOURCE_CONFIG.cooldownMs;
        }
        return [];
      }

      this.consecutiveFailures = 0;
      const data: HNResponse = await response.json();
      const hits = data.hits ?? [];

      return hits
        .filter((hit: HNHit) => hit.title)
        .map((hit: HNHit) => ({
          title: hit.title,
          url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
          snippet: hit.story_text ? stripHtml(hit.story_text).slice(0, 300) : `Points: ${hit.points} | Comments: ${hit.num_comments}`,
          source: 'hackernews' as const,
          date: hit.created_at,
          extra: { points: hit.points, numComments: hit.num_comments, author: hit.author },
        }));
    } catch {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= 5) {
        this.cooldownUntil = Date.now() + DEFAULT_SOURCE_CONFIG.cooldownMs;
      }
      return [];
    }
  }
}