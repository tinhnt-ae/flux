/**
 * Ticker Resolver
 * Resolves company names to stock tickers
 */

import axios from 'axios';

// Simple ticker mapping for common companies
// This is a fallback; ideally you'd call a real API
const COMPANY_TICKER_MAP: Record<string, string> = {
  // Tech Giants
  APPLE: 'AAPL',
  MICROSOFT: 'MSFT',
  GOOGLE: 'GOOGL',
  ALPHABET: 'GOOGL',
  AMAZON: 'AMZN',
  TESLA: 'TSLA',
  NVIDIA: 'NVDA',
  META: 'META',
  FACEBOOK: 'META',
  NETFLIX: 'NFLX',
  INTEL: 'INTC',
  AMD: 'AMD',
  QUALCOMM: 'QCOM',
  BROADCOM: 'AVGO',
  CISCO: 'CSCO',
  ORACLE: 'ORCL',
  IBM: 'IBM',

  // SaaS/Enterprise
  SALESFORCE: 'CRM',
  ADOBE: 'ADBE',
  SNOWFLAKE: 'SNOW',
  DATADOG: 'DDOG',
  ELASTIC: 'ESTC',
  MONGODB: 'MDB',

  // Finance/Crypto
  COINBASE: 'COIN',

  // Banks
  'BANK OF AMERICA': 'BAC',
  JPM: 'JPM',
  'JPMORGAN': 'JPM',
  'JPMORGAN CHASE': 'JPM',
  WELLS: 'WFC',
  WELLS_FARGO: 'WFC',
  'WELLS FARGO': 'WFC',
  CITIGROUP: 'C',
  CITI: 'C',
  GOLDMAN: 'GS',
  'GOLDMAN SACHS': 'GS',
  'MORGAN STANLEY': 'MS',
  MORGAN: 'MS',
  BLACKROCK: 'BLK',
  VANGUARD: 'VTI',

  // Also accept tickers directly
  AAPL: 'AAPL',
  MSFT: 'MSFT',
  GOOGL: 'GOOGL',
  AMZN: 'AMZN',
  TSLA: 'TSLA',
  NVDA: 'NVDA',
  NFLX: 'NFLX',
  INTC: 'INTC',
  CRM: 'CRM',
  ADBE: 'ADBE'
};

/**
 * Resolve a company name or ticker to an actual ticker symbol
 * @param name Company name or ticker
 * @returns Ticker symbol or null if not found
 */
export async function resolveTicker(name: string): Promise<string | null> {
  if (!name || typeof name !== 'string') return null;

  const upper = name.toUpperCase().trim();

  // Prefer explicit mapping first so company names like APPLE map to AAPL.
  const mapped = COMPANY_TICKER_MAP[upper];
  if (mapped && mapped !== '') {
    return mapped;
  }

  // Check if already a ticker (1-5 uppercase letters)
  if (/^[A-Z]{1,5}$/.test(upper)) {
    return upper;
  }

  // Try to find partial match in our map
  for (const [company, ticker] of Object.entries(COMPANY_TICKER_MAP)) {
    if (ticker && (company.includes(upper) || upper.includes(company))) {
      return ticker;
    }
  }

  // Fallback: Try simple name → ticker conversion
  // This is a heuristic and may not work for all companies
  // In production, you'd call a real API like:
  // - Yahoo Finance API
  // - Alpha Vantage
  // - IEX Cloud
  // etc.

  return null;
}

/**
 * Resolve multiple names/tickers in parallel
 */
export async function resolveTickersParallel(names: string[]): Promise<Record<string, string | null>> {
  const results = await Promise.all(names.map((n) => resolveTicker(n)));
  const map: Record<string, string | null> = {};
  for (let i = 0; i < names.length; i++) {
    map[names[i]] = results[i];
  }
  return map;
}

/**
 * Search for companies matching a pattern
 * Returns up to 3 candidates
 */
export async function searchCompanies(pattern: string): Promise<string[]> {
  if (!pattern || typeof pattern !== 'string') return [];

  const upper = pattern.toUpperCase().trim();
  const candidates: string[] = [];

  for (const company of Object.keys(COMPANY_TICKER_MAP)) {
    if (company.includes(upper) || upper.includes(company)) {
      candidates.push(company);
      if (candidates.length >= 3) break;
    }
  }

  return candidates;
}
