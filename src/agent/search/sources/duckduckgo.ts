import type { SearchSourceAdapter, SearchResult, SearchQuery } from '../types.js';
import { DEFAULT_SOURCE_CONFIG } from '../types.js';

const DDG_HTML_URL = 'https://html.duckduckgo.com/html/';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

const FRESHNESS_MAP: Record<string, string> = {
  pd: 'd',
  pw: 'w',
  pm: 'm',
  py: 'y',
};

let requestTimestamps: number[] = [];

function isRateLimited(): boolean {
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter(ts => now - ts < 60000);
  return requestTimestamps.length >= DEFAULT_SOURCE_CONFIG.rateLimitPerMinute;
}

function recordRequest(): void {
  requestTimestamps.push(Date.now());
}

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function decodeUddg(uddg: string): string {
  try {
    return decodeURIComponent(uddg);
  } catch {
    return uddg;
  }
}

function parseDDGResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const resultBlocks = html.split('<div class="result"');

  for (const block of resultBlocks.slice(1)) {
    try {
      const titleMatch = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
      const urlMatch = block.match(/uddg=([^&"]+)/);
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);

      if (!titleMatch || !urlMatch) continue;

      const title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
      const url = decodeUddg(urlMatch[1]);
      const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';

      if (!title || !url) continue;

      results.push({
        title,
        url: url.startsWith('//') ? `https:${url}` : url,
        snippet,
        source: 'duckduckgo',
      });
    } catch {
      continue;
    }
  }

  return results;
}

export class DuckDuckGoSearchAdapter implements SearchSourceAdapter {
  readonly name = 'duckduckgo' as const;
  private cooldownUntil = 0;
  private consecutiveFailures = 0;

  isAvailable(): boolean {
    return Date.now() >= this.cooldownUntil;
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    if (!this.isAvailable()) return [];
    if (isRateLimited()) return [];

    const params = new URLSearchParams({ q: query.query });
    if (query.freshness && FRESHNESS_MAP[query.freshness]) {
      params.set('df', FRESHNESS_MAP[query.freshness]);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_SOURCE_CONFIG.requestTimeoutMs);

      const response = await fetch(`${DDG_HTML_URL}?${params.toString()}`, {
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Accept': 'text/html',
          'Accept-Language': 'tr,en;q=0.9',
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);
      recordRequest();

      if (!response.ok) {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= 3) {
          this.cooldownUntil = Date.now() + DEFAULT_SOURCE_CONFIG.cooldownMs;
        }
        return [];
      }

      this.consecutiveFailures = 0;
      const html = await response.text();
      const results = parseDDGResults(html);
      return results.slice(0, query.count ?? DEFAULT_SOURCE_CONFIG.defaultCount);
    } catch {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= 3) {
        this.cooldownUntil = Date.now() + DEFAULT_SOURCE_CONFIG.cooldownMs;
      }
      return [];
    }
  }
}