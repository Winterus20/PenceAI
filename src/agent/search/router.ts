import type { SearchSource } from './types.js';

type QueryIntent = 'factual' | 'technical' | 'opinion' | 'news' | 'general';

interface ClassificationResult {
  intent: QueryIntent;
  sources: SearchSource[];
  confidence: number;
}

const TECHNICAL_KEYWORDS = [
  'code', 'programming', 'javascript', 'python', 'typescript', 'react', 'node',
  'api', 'framework', 'library', 'bug', 'error', 'debug', 'deploy', 'docker',
  'kubernetes', 'aws', 'cloud', 'database', 'sql', 'nosql', 'git', 'compiler',
  'algorithm', 'data structure', 'software', 'hardware', 'linux', 'terminal',
  'rust', 'golang', 'kotlin', 'swift', 'devops', 'ci/cd', 'test', 'benchmark',
];

const FACTUAL_KEYWORDS = [
  'what is', 'who is', 'who was', 'when was', 'where is', 'define', 'definition',
  'history of', 'meaning of', 'how old', 'born in', 'invented', 'discovered',
  'population of', 'capital of', 'president of', 'height of', 'distance between',
];

const OPINION_KEYWORDS = [
  'best', 'worst', 'recommend', 'review', 'opinion', 'should i', 'vs',
  'compared to', 'alternative to', 'think about', 'experience with', 'prefer',
  'pros and cons', 'which is better',
];

const NEWS_KEYWORDS = [
  'latest', 'recent', 'today', 'yesterday', 'this week', 'this month', '2024', '2025', '2026',
  'breaking', 'update', 'announced', 'released', 'launch', 'news', 'event',
];

function classifyIntent(query: string): QueryIntent {
  const lower = query.toLowerCase();

  const technicalScore = TECHNICAL_KEYWORDS.filter(kw => lower.includes(kw)).length;
  const factualScore = FACTUAL_KEYWORDS.filter(kw => lower.includes(kw)).length;
  const opinionScore = OPINION_KEYWORDS.filter(kw => lower.includes(kw)).length;
  const newsScore = NEWS_KEYWORDS.filter(kw => lower.includes(kw)).length;

  const scores: [QueryIntent, number][] = [
    ['technical', technicalScore],
    ['factual', factualScore],
    ['opinion', opinionScore],
    ['news', newsScore],
  ];

  const max = scores.reduce((a, b) => (b[1] > a[1] ? b : a), ['general', 0] as [QueryIntent, number]);

  if (max[1] === 0) return 'general';

  return max[0];
}

function intentToSources(intent: QueryIntent): SearchSource[] {
  switch (intent) {
    case 'factual':
      return ['wikipedia', 'duckduckgo'];
    case 'technical':
      return ['hackernews', 'duckduckgo', 'wikipedia'];
    case 'opinion':
      return ['reddit', 'duckduckgo'];
    case 'news':
      return ['duckduckgo', 'hackernews', 'reddit'];
    case 'general':
    default:
      return ['duckduckgo', 'wikipedia', 'hackernews'];
  }
}

export function routeQuery(query: string, availableSources: SearchSource[]): ClassificationResult {
  const intent = classifyIntent(query);
  const preferredSources = intentToSources(intent);
  const sources = preferredSources.filter(s => availableSources.includes(s));

  if (sources.length === 0) {
    return {
      intent: 'general',
      sources: availableSources.length > 0 ? [availableSources[0]] : ['duckduckgo'],
      confidence: 0.3,
    };
  }

  return {
    intent,
    sources,
    confidence: sources.length >= 2 ? 0.8 : 0.5,
  };
}