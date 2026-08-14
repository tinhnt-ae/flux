export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type UnknownRecord = Record<string, unknown>;

export type FinancialStatement = UnknownRecord;

export type TickerDataset = {
  latest: FinancialStatement | null;
  previous: FinancialStatement | null;
};

export type TickerDatasetMap = Record<string, TickerDataset>;

export type NewsArticle = {
  title: string;
  url: string;
  source: string;
  snippet: string;
  date?: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
};

export type NewsDataset = Record<string, NewsArticle[]>;

export type CommandErrorCode = 'NO_API_KEY' | 'API_ERROR' | 'NETWORK_ERROR';

export type ToolName = 'resolve_ticker' | 'get_financials' | 'get_news';

export type ResolveTickerArgs = {
  name: string;
};

export type GetFinancialsArgs = {
  tickers: string[];
};

export type GetNewsArgs = {
  companies: string[];
};

export type ToolArgsByName = {
  resolve_ticker: ResolveTickerArgs;
  get_financials: GetFinancialsArgs;
  get_news: GetNewsArgs;
};

export type ResolveTickerResult = {
  ticker: string | null;
  resolved: boolean;
};

export type GetFinancialsResult = {
  dataset: TickerDatasetMap;
};

export type GetNewsResult = {
  news: NewsDataset;
};

export type ToolErrorResult = {
  error: string;
};

export type ToolResultByName = {
  resolve_ticker: ResolveTickerResult | ToolErrorResult;
  get_financials: GetFinancialsResult | ToolErrorResult;
  get_news: GetNewsResult | ToolErrorResult;
};

export type ToolResult = ToolResultByName[ToolName];

export type QuoteOptions = {
  history?: boolean;
  json?: boolean;
};

export type CompareOptions = {
  period?: 'quarter' | 'annual' | string;
  align?: 'fiscal' | 'calendar' | string;
};

export type ChatToolDefinition = {
  type: 'function';
  function: {
    name: ToolName;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
};

export type LlmToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};
