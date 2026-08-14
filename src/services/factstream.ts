import axios from 'axios';
import { getApiKey } from '../utils/config';
import { findQuarterArray } from '../utils/data';
import { missingApiKeyError, toFactStreamError } from '../utils/errors';
import type { TickerDataset, TickerDatasetMap } from '../types/domain';

const BASE = 'https://api.factstream.io/v1';
const FINANCIALS_TIMEOUT_MS = 15000;

export async function getAllFinancialStatements(ticker: string): Promise<unknown> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw missingApiKeyError();
  }

  try {
    const res = await axios.get<unknown>(`${BASE}/financials/${encodeURIComponent(ticker)}`, {
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json'
      },
      timeout: FINANCIALS_TIMEOUT_MS
    });
    return res.data;
  } catch (error: unknown) {
    throw toFactStreamError(error);
  }
}

export async function buildMinimalDataset(tickers: string[]): Promise<TickerDatasetMap> {
  const entries = await Promise.all(
    tickers.map(async (ticker) => {
      const data = await getAllFinancialStatements(ticker);
      const quarters = findQuarterArray(data) || [];
      return [
        ticker,
        {
          latest: quarters[0] || null,
          previous: quarters[1] || null
        }
      ] as const;
    })
  );

  return Object.fromEntries(entries);
}
