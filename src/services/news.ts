/**
 * News Service
 * Fetches news about companies using SearXNG or other sources
 */

import axios from 'axios';

export type NewsArticle = {
  title: string;
  url: string;
  source: string;
  snippet: string;
  date?: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
};

/**
 * Fetch news articles for a company
 * Uses public search API or SearXNG instance
 * @param company Company name
 * @param limit Max articles to return (default 3)
 */
export async function fetchNews(company: string, limit: number = 3): Promise<NewsArticle[]> {
  if (!company || typeof company !== 'string') return [];

  try {
    // Try using a public SearXNG instance or Bing Search API
    // For MVP, we'll use a simple approach with Google search API
    // In production, integrate with your preferred news API:
    // - NewsAPI.org
    // - Alpha Vantage News
    // - Your own SearXNG instance

    const query = `${company} stock news`;

    // Placeholder: Return empty array for now
    // In real implementation, call actual API:
    // const res = await axios.get('https://your-searxng-instance/search', {
    //   params: { q: query, format: 'json' }
    // });

    // Parse results into NewsArticle format
    return [];
  } catch (error: any) {
    console.error(`Failed to fetch news for ${company}:`, error?.message);
    return [];
  }
}

/**
 * Fetch news for multiple companies in parallel
 */
export async function fetchNewsParallel(companies: string[]): Promise<Record<string, NewsArticle[]>> {
  const results = await Promise.all(companies.map((c) => fetchNews(c)));
  const map: Record<string, NewsArticle[]> = {};
  for (let i = 0; i < companies.length; i++) {
    map[companies[i]] = results[i];
  }
  return map;
}

/**
 * Analyze sentiment of news snippets
 * Simple heuristic for MVP
 */
export function analyzeSentiment(snippet: string): 'positive' | 'negative' | 'neutral' {
  if (!snippet || typeof snippet !== 'string') return 'neutral';

  const positive = /\b(surge|soar|jump|rally|beat|rise|growth|expand|record|improve|outperform)\b/i;
  const negative = /\b(plunge|fall|drop|decline|miss|slump|crash|down|shrink|contract|underperform)\b/i;

  const hasPositive = positive.test(snippet);
  const hasNegative = negative.test(snippet);

  if (hasPositive && !hasNegative) return 'positive';
  if (hasNegative && !hasPositive) return 'negative';
  return 'neutral';
}

/**
 * Format news articles for CLI display
 */
export function formatNewsForCli(articles: NewsArticle[]): string {
  if (articles.length === 0) return 'No news found.';

  return articles
    .map(
      (article, idx) =>
        `${idx + 1}. ${article.title}\n   Source: ${article.source}\n   ${article.snippet}`
    )
    .join('\n\n');
}
