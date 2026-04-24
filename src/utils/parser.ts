import { getField, parseNumberLike } from './data';

export type AnalysisType = 'growth' | 'profitability' | 'cashflow' | 'general';

export type EntityType = 'company' | 'ticker';

export type Entity = {
  name: string;
  type: EntityType;
};

export type ParsedIntent = {
  entities: Entity[];
  tickers: string[];
  analysis_type: AnalysisType;
  metrics: string[];
  periods: number;
  include_news: boolean;
};

export type RequestType = 'analysis' | 'news';

export type ParsedIntentV2 = {
  entities: Entity[];
  analysis_type: AnalysisType;
  include_news: boolean;
  off_topic: boolean;
  request_type: RequestType;
};

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

export function extractTickersFromQuery(query: string): string[] {
  const matches = (query || '').toUpperCase().match(/\b[A-Z]{1,5}\b/g) || [];
  const commonWords = ['AND', 'THE', 'WITH', 'OR', 'VS', 'BY', 'FOR', 'IN', 'ON', 'AT', 'TO', 'FROM', 'IS', 'A', 'AN'];
  return uniq(matches).filter(t => !commonWords.includes(t) && t.length >= 1);
}

export function normalizeIntent(input: any, query: string): ParsedIntent {
  const allowed: AnalysisType[] = ['growth', 'profitability', 'cashflow', 'general'];
  const analysisType = allowed.includes(input?.analysis_type) ? input.analysis_type : 'general';
  const metrics = Array.isArray(input?.metrics) ? input.metrics.filter((m: unknown) => typeof m === 'string') : [];
  const periodsRaw = Number(input?.periods);
  const periods = Number.isFinite(periodsRaw) && periodsRaw > 0 ? Math.min(Math.floor(periodsRaw), 8) : 2;

  const fromModel = Array.isArray(input?.tickers)
    ? input.tickers.filter((t: unknown) => typeof t === 'string').map((t: string) => t.toUpperCase())
    : [];
  const tickers = uniq(fromModel.length > 0 ? fromModel : extractTickersFromQuery(query));

  // Extract entities (for backward compatibility, keep tickers separate)
  const entities: Entity[] = Array.isArray(input?.entities)
    ? input.entities
      .filter((e: any) => typeof e?.name === 'string' && (e?.type === 'company' || e?.type === 'ticker'))
      .map((e: any) => ({ name: e.name.toUpperCase(), type: e.type as EntityType }))
    : tickers.map((t) => ({ name: t, type: 'ticker' as EntityType }));

  const includeNews = input?.include_news === true;

  return {
    entities,
    tickers,
    analysis_type: analysisType,
    metrics,
    periods,
    include_news: includeNews
  };
}

export function normalizeIntentV2(input: any): ParsedIntentV2 {
  const allowed: AnalysisType[] = ['growth', 'profitability', 'cashflow', 'general'];
  const analysisType = allowed.includes(input?.analysis_type) ? input.analysis_type : 'general';

  const entities: Entity[] = Array.isArray(input?.entities)
    ? input.entities
      .filter((e: any) => typeof e?.name === 'string' && (e?.type === 'company' || e?.type === 'ticker'))
      .map((e: any) => ({ name: e.name, type: e.type as EntityType }))
    : [];

  const includeNews = input?.include_news !== false; // default true

  const allowedRequestTypes: RequestType[] = ['analysis', 'news'];
  const requestType: RequestType = allowedRequestTypes.includes(input?.request_type)
    ? input.request_type
    : 'analysis';

  return {
    entities,
    analysis_type: analysisType,
    include_news: includeNews,
    off_topic: Boolean(input?.off_topic),
    request_type: requestType
  };
}

function getPath(obj: any, path: string[]): any {
  let cur = obj;
  for (const segment of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[segment];
  }
  return cur;
}

function parseMetric(obj: any, preferredPaths: string[][], fallbackKeys: string[]): number | null {
  for (const p of preferredPaths) {
    const v = getPath(obj, p);
    const parsed = parseNumberLike(v);
    if (parsed !== null) return parsed;
  }
  const fallback = parseNumberLike(getField(obj, fallbackKeys));
  return fallback;
}

export function extractCoreMetrics(statement: any): { revenue: number | null; netIncome: number | null; freeCashFlow: number | null } {
  const revenue = parseMetric(
    statement,
    [
      ['income_statement', 'revenue'],
      ['incomeStatement', 'revenue']
    ],
    ['revenue', 'total_revenue', 'revenues', 'revenue_usd', 'totalRevenue']
  );

  const netIncome = parseMetric(
    statement,
    [
      ['income_statement', 'net_income'],
      ['incomeStatement', 'net_income'],
      ['incomeStatement', 'netIncome']
    ],
    ['net_income', 'netIncome', 'net_earnings', 'netEarnings', 'net_income_usd']
  );

  const freeCashFlow = parseMetric(
    statement,
    [
      ['cash_flow', 'free_cash_flow'],
      ['cashFlow', 'free_cash_flow'],
      ['cashFlow', 'freeCashFlow']
    ],
    ['free_cash_flow', 'freeCashFlow', 'fcf']
  );

  return { revenue, netIncome, freeCashFlow };
}
