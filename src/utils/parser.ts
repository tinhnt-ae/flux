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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function extractTickersFromQuery(query: string): string[] {
  const matches = (query || '').toUpperCase().match(/\b[A-Z]{1,5}\b/g) || [];
  const commonWords = ['AND', 'THE', 'WITH', 'OR', 'VS', 'BY', 'FOR', 'IN', 'ON', 'AT', 'TO', 'FROM', 'IS', 'A', 'AN'];
  return uniq(matches).filter(t => !commonWords.includes(t) && t.length >= 1);
}

export function normalizeIntent(input: unknown, query: string): ParsedIntent {
  const record = isRecord(input) ? input : {};
  const allowed: AnalysisType[] = ['growth', 'profitability', 'cashflow', 'general'];
  const rawAnalysisType = readString(record.analysis_type);
  const analysisType = rawAnalysisType && allowed.includes(rawAnalysisType as AnalysisType) ? rawAnalysisType as AnalysisType : 'general';
  const metrics = Array.isArray(record.metrics) ? record.metrics.filter((m: unknown): m is string => typeof m === 'string') : [];
  const periodsRaw = Number(record.periods);
  const periods = Number.isFinite(periodsRaw) && periodsRaw > 0 ? Math.min(Math.floor(periodsRaw), 8) : 2;

  const fromModel = Array.isArray(record.tickers)
    ? record.tickers.filter((t: unknown): t is string => typeof t === 'string').map((t) => t.toUpperCase())
    : [];
  const tickers = uniq(fromModel.length > 0 ? fromModel : extractTickersFromQuery(query));

  // Extract entities (for backward compatibility, keep tickers separate)
  const entities: Entity[] = Array.isArray(record.entities)
    ? record.entities
      .filter((e: unknown): e is Entity => isRecord(e) && typeof e.name === 'string' && (e.type === 'company' || e.type === 'ticker'))
      .map((e) => ({ name: e.name.toUpperCase(), type: e.type }))
    : tickers.map((t) => ({ name: t, type: 'ticker' as EntityType }));

  const includeNews = record.include_news === true;

  return {
    entities,
    tickers,
    analysis_type: analysisType,
    metrics,
    periods,
    include_news: includeNews
  };
}

export function normalizeIntentV2(input: unknown): ParsedIntentV2 {
  const record = isRecord(input) ? input : {};
  const allowed: AnalysisType[] = ['growth', 'profitability', 'cashflow', 'general'];
  const rawAnalysisType = readString(record.analysis_type);
  const analysisType = rawAnalysisType && allowed.includes(rawAnalysisType as AnalysisType) ? rawAnalysisType as AnalysisType : 'general';

  const entities: Entity[] = Array.isArray(record.entities)
    ? record.entities
      .filter((e: unknown): e is Entity => isRecord(e) && typeof e.name === 'string' && (e.type === 'company' || e.type === 'ticker'))
      .map((e) => ({ name: e.name, type: e.type }))
    : [];

  const includeNews = record.include_news !== false; // default true

  const allowedRequestTypes: RequestType[] = ['analysis', 'news'];
  const rawRequestType = readString(record.request_type);
  const requestType: RequestType = rawRequestType && allowedRequestTypes.includes(rawRequestType as RequestType)
    ? rawRequestType as RequestType
    : 'analysis';

  return {
    entities,
    analysis_type: analysisType,
    include_news: includeNews,
    off_topic: Boolean(record.off_topic),
    request_type: requestType
  };
}

function getPath(obj: unknown, path: string[]): unknown {
  let cur = obj;
  for (const segment of path) {
    if (!isRecord(cur)) return undefined;
    cur = cur[segment];
  }
  return cur;
}

function parseMetric(obj: unknown, preferredPaths: string[][], fallbackKeys: string[]): number | null {
  for (const p of preferredPaths) {
    const v = getPath(obj, p);
    const parsed = parseNumberLike(v);
    if (parsed !== null) return parsed;
  }
  const fallback = parseNumberLike(getField(obj, fallbackKeys));
  return fallback;
}

export function extractCoreMetrics(statement: unknown): { revenue: number | null; netIncome: number | null; freeCashFlow: number | null } {
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
