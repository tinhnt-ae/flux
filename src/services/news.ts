/**
 * News Service
 * Fetches financial news via RSS feeds:
 *   - Yahoo Finance (per-ticker feed, most relevant for stocks)
 *   - Google News (search-based, works with any company name)
 * No API key required.
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

// ── RSS helpers ────────────────────────────────────────────────────────────

/** Extract text from a tag, handling both plain and CDATA variants */
function extractTag(xml: string, tag: string): string {
  const cdataRe = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i');
  const plainRe = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i');
  return (xml.match(cdataRe)?.[1] ?? xml.match(plainRe)?.[1] ?? '').trim();
}

/** Strip HTML tags and decode basic HTML entities */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** Parse raw RSS XML into NewsArticle array */
function parseRss(xml: string, defaultSource: string): NewsArticle[] {
  const items = xml.match(/<item>([\s\S]*?)<\/item>/gi) ?? [];
  return items.map((item) => {
    const title = stripHtml(extractTag(item, 'title'));
    const url = extractTag(item, 'link');
    const snippet = stripHtml(extractTag(item, 'description')).slice(0, 200);
    const date = extractTag(item, 'pubDate');
    const source = extractTag(item, 'source') || defaultSource;
    return {
      title: title || 'Untitled',
      url,
      source,
      snippet,
      date: date || undefined,
      sentiment: analyzeSentiment(snippet),
    };
  }).filter((a) => a.title !== 'Untitled' || a.snippet !== '');
}

// ── Fetchers ───────────────────────────────────────────────────────────────

/** Looks like a stock ticker (1-5 letters, no spaces; case-insensitive) */
function looksLikeTicker(s: string): boolean {
  return /^[A-Z]{1,5}$/.test(s.trim().toUpperCase());
}

async function fetchYahooFinanceRss(ticker: string, limit: number): Promise<NewsArticle[]> {
  const url = `https://finance.yahoo.com/rss/headline?s=${encodeURIComponent(ticker.toUpperCase())}`;
  try {
    const res = await axios.get<string>(url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; flux-cli/1.0)',
        Accept: 'application/rss+xml, application/xml, text/xml',
      },
    });
    return parseRss(res.data, 'Yahoo Finance').slice(0, limit);
  } catch {
    return [];
  }
}

async function fetchGoogleNewsRss(query: string, limit: number): Promise<NewsArticle[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query + ' stock')}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const res = await axios.get<string>(url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; flux-cli/1.0)',
        Accept: 'application/rss+xml, application/xml, text/xml',
      },
    });
    return parseRss(res.data, 'Google News').slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Fetch news for a company name or ticker.
 * Yahoo Finance (ticker) + Google News (name) are fetched in parallel and merged.
 */
export async function fetchNews(company: string, limit: number = 8): Promise<NewsArticle[]> {
  if (!company || typeof company !== 'string') return [];

  const isTicker = looksLikeTicker(company);

  const [yahooArticles, googleArticles] = await Promise.all([
    isTicker ? fetchYahooFinanceRss(company, limit) : Promise.resolve([]),
    fetchGoogleNewsRss(company, limit),
  ]);

  const seen = new Set<string>();
  const merged: NewsArticle[] = [];
  for (const a of [...yahooArticles, ...googleArticles]) {
    if (!seen.has(a.title)) {
      seen.add(a.title);
      merged.push(a);
    }
    if (merged.length >= limit) break;
  }
  return merged;
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
 * Analyze sentiment of news snippets — simple heuristic
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
