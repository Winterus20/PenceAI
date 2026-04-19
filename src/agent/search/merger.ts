import type { SearchResult, SearchSource } from './types.js';
import { SOURCE_WEIGHTS } from './types.js';

interface MergeOptions {
  dedupByUrl?: boolean;
  rrfK?: number;
  maxResults?: number;
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${host}${path}${parsed.search}`;
  } catch {
    return url.toLowerCase().trim();
  }
}

export function mergeAndRankResults(
  resultsBySource: Map<SearchSource, SearchResult[]>,
  options: MergeOptions = {},
): SearchResult[] {
  const { dedupByUrl = true, rrfK = 60, maxResults = 10 } = options;

  const urlToEntries = new Map<string, SearchResult[]>();

  for (const [source, results] of resultsBySource) {
    const weight = SOURCE_WEIGHTS[source] ?? 1.0;
    for (let i = 0; i < results.length; i++) {
      const result = { ...results[i] };
      result.score = weight / (rrfK + i + 1);

      if (dedupByUrl) {
        const normalizedUrl = normalizeUrl(result.url);
        const existing = urlToEntries.get(normalizedUrl);
        if (existing) {
          existing.push(result);
        } else {
          urlToEntries.set(normalizedUrl, [result]);
        }
      } else {
        const key = `${source}:${i}`;
        urlToEntries.set(key, [result]);
      }
    }
  }

  const merged: SearchResult[] = [];

  for (const entries of urlToEntries.values()) {
    const best = entries.reduce((a, b) => (a.score ?? 0) >= (b.score ?? 0) ? a : b);
    best.score = entries.reduce((sum, e) => sum + (e.score ?? 0), 0);
    merged.push(best);
  }

  merged.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return merged.slice(0, maxResults);
}

export function formatResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return 'Sonuç bulunamadı.';
  }

  const lines = results.map((r, i) => {
    let line = `${i + 1}. **${r.title}**\n   ${r.url}`;
    if (r.snippet) line += `\n   ${r.snippet}`;
    if (r.date) line += ` (${r.date})`;
    line += `\n   [${r.source}]`;
    return line;
  });

  return lines.join('\n\n');
}