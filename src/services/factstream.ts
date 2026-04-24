import axios from 'axios';
import { getApiKey } from '../utils/config';
import { findQuarterArray } from '../utils/data';

const BASE = 'https://api.factstream.io/v1';

export type TickerDataset = {
  latest: any | null;
  previous: any | null;
};

export async function getAllFinancialStatements(ticker: string): Promise<any> {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err: any = new Error('NO_API_KEY');
    err.code = 'NO_API_KEY';
    throw err;
  }

  try {
    const res = await axios.get(`${BASE}/financials/${encodeURIComponent(ticker)}`, {
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });
    return res.data;
  } catch (e: any) {
    if (e.response) {
      const err: any = new Error(`FactStream request failed (${e.response.status})`);
      err.code = 'API_ERROR';
      err.status = e.response.status;
      err.details = e.response.data;
      throw err;
    }
    throw new Error('Unable to reach FactStream API');
  }
}

export async function buildMinimalDataset(tickers: string[]): Promise<Record<string, TickerDataset>> {
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
