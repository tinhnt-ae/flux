import axios from 'axios';
import { getApiKey } from '../utils/config';

const BASE = 'https://api.factstream.io/v1';

export async function getFinancials(ticker: string): Promise<any> {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err: any = new Error('No API key found');
    err.code = 'NO_API_KEY';
    throw err;
  }

  try {
    const res = await axios.get(`${BASE}/financials/${encodeURIComponent(ticker)}`, {
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    return res.data;
  } catch (e: any) {
    if (e.response) {
      const err: any = new Error('API_ERROR');
      err.status = e.response.status;
      err.response = e.response;
      throw err;
    }
    throw e;
  }
}
