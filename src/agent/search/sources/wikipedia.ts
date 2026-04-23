import type { SearchSourceAdapter, SearchResult, SearchQuery } from '../types.js';
import { DEFAULT_SOURCE_CONFIG } from '../types.js';

const WIKI_API_URL = 'https://en.wikipedia.org/w/api.php';
const WIKI_USER_AGENT = 'PenceAI/0.1 (https://github.com/penceai)';

interface WikiSearchResult {
  ns: number;
  title: string;
  pageid: number;
  snippet: string;
  timestamp: string;
}

interface WikiApiResponse {
  query?: {
    search?: WikiSearchResult[];
    searchinfo?: { totalhits: number };
  };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

export class WikipediaSearchAdapter implements SearchSourceAdapter {
  readonly name = 'wikipedia' as const;

  isAvailable(): boolean {
    return true;
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: query.query,
      format: 'json',
      srlimit: String(query.count ?? DEFAULT_SOURCE_CONFIG.defaultCount),
      utf8: '1',
    });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(`${WIKI_API_URL}?${params.toString()}`, {
        headers: {
          'User-Agent': WIKI_USER_AGENT,
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) return [];

      const data = await response.json() as WikiApiResponse;
      const searchResults = data?.query?.search;
      if (!searchResults || searchResults.length === 0) return [];

      return searchResults.map((item: WikiSearchResult) => ({
        title: item.title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
        snippet: stripHtml(item.snippet),
        source: 'wikipedia' as const,
        date: item.timestamp,
      }));
    } catch {
      return [];
    }
  }
}