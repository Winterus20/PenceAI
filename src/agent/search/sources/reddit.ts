import type { SearchSourceAdapter, SearchResult, SearchQuery } from '../types.js';
import { DEFAULT_SOURCE_CONFIG } from '../types.js';

const REDDIT_SEARCH_URL = 'https://www.reddit.com/search.json';

const REDDIT_USER_AGENT = 'PenceAI/0.1 (Smart Search Module)';

let requestTimestamps: number[] = [];
const RATE_LIMIT_PER_MINUTE = 55;

function isRateLimited(): boolean {
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter(ts => now - ts < 60000);
  return requestTimestamps.length >= RATE_LIMIT_PER_MINUTE;
}

function recordRequest(): void {
  requestTimestamps.push(Date.now());
}

interface RedditPostData {
  title: string;
  url: string;
  selftext: string;
  created_utc: number;
  score: number;
  num_comments: number;
  subreddit: string;
  permalink: string;
  is_self: boolean;
}

interface RedditChild {
  kind: string;
  data: RedditPostData;
}

interface RedditResponse {
  data?: {
    children?: RedditChild[];
    dist?: number;
  };
}

export class RedditSearchAdapter implements SearchSourceAdapter {
  readonly name = 'reddit' as const;
  private cooldownUntil = 0;
  private consecutiveFailures = 0;

  isAvailable(): boolean {
    return Date.now() >= this.cooldownUntil;
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    if (!this.isAvailable()) return [];
    if (isRateLimited()) return [];

    const count = query.count ?? DEFAULT_SOURCE_CONFIG.defaultCount;
    const params = new URLSearchParams({
      q: query.query,
      sort: 'relevance',
      limit: String(count),
      restrict_sr: 'off',
    });

    if (query.freshness) {
      const timeMap: Record<string, string> = { pd: 'day', pw: 'week', pm: 'month', py: 'year' };
      if (timeMap[query.freshness]) {
        params.set('t', timeMap[query.freshness]);
      }
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(`${REDDIT_SEARCH_URL}?${params.toString()}`, {
        headers: {
          'User-Agent': REDDIT_USER_AGENT,
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);
      recordRequest();

      if (response.status === 403 || response.status === 429) {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= 2) {
          this.cooldownUntil = Date.now() + DEFAULT_SOURCE_CONFIG.cooldownMs;
        }
        return [];
      }

      if (!response.ok) {
        this.consecutiveFailures++;
        return [];
      }

      this.consecutiveFailures = 0;
      const data: RedditResponse = await response.json();
      const children = data?.data?.children ?? [];

      return children
        .filter((child: RedditChild) => child.kind === 't3' && child.data.title)
        .map((child: RedditChild) => {
          const post = child.data;
          const snippet = post.selftext
            ? post.selftext.replace(/\n/g, ' ').slice(0, 300)
            : `r/${post.subreddit} | Score: ${post.score}`;
          return {
            title: post.title,
            url: post.is_self ? `https://www.reddit.com${post.permalink}` : post.url,
            snippet,
            source: 'reddit' as const,
            date: new Date(post.created_utc * 1000).toISOString(),
            extra: { score: post.score, numComments: post.num_comments, subreddit: post.subreddit },
          };
        });
    } catch {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= 3) {
        this.cooldownUntil = Date.now() + DEFAULT_SOURCE_CONFIG.cooldownMs;
      }
      return [];
    }
  }
}