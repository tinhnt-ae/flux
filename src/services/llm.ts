import axios from 'axios';
import { Readable } from 'stream';
import { normalizeIntent, ParsedIntent, normalizeIntentV2, ParsedIntentV2 } from '../utils/parser';
import { getStoredLlmModel } from '../utils/config';
import type { ChatToolDefinition, LlmToolCall } from '../types/domain';

const DEFAULT_BASE_URL = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
const DEFAULT_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

function getLlmApiKey(): string | undefined {
  return process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
}

export function getActiveLlmModel(): string {
  return process.env.LLM_MODEL || getStoredLlmModel() || DEFAULT_MODEL;
}

// ── Agent types ───────────────────────────────────────────────────────────────

export type AgentMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content?: string; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type ToolCall = LlmToolCall;

export type AgentLoopResponse =
  | { type: 'text'; content: string }
  | { type: 'tool_calls'; toolCalls: ToolCall[] };

/**
 * Single step of the agent loop: send messages + tools to the LLM.
 * Returns either a final text answer or a list of tool calls to execute.
 */
export async function runAgentLoop(
  messages: AgentMessage[],
  tools: readonly ChatToolDefinition[]
): Promise<AgentLoopResponse> {
  const apiKey = getLlmApiKey();
  if (!apiKey) throw new Error('Missing LLM API key. Set OPENAI_API_KEY or LLM_API_KEY.');

  const res = await axios.post(
    `${DEFAULT_BASE_URL}/chat/completions`,
    {
      model: getActiveLlmModel(),
      temperature: 0,
      tools,
      tool_choice: 'auto',
      messages,
    },
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 60000,
    }
  );

  const choice = res?.data?.choices?.[0];
  if (!choice) throw new Error('LLM returned an empty response');

  const msg = choice.message;

  if (Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0) {
    return { type: 'tool_calls', toolCalls: msg.tool_calls as ToolCall[] };
  }

  const content = msg?.content;
  if (!content || typeof content !== 'string') throw new Error('LLM returned an empty response');
  return { type: 'text', content: content.trim() };
}

/**
 * Same as runAgentLoop but streams the final text answer token by token.
 * Tool-call turns are NOT streamed (they return immediately with tool_calls).
 */
export async function runAgentLoopStream(
  messages: AgentMessage[],
  tools: readonly ChatToolDefinition[],
  onChunk: (chunk: string) => void
): Promise<AgentLoopResponse> {
  const apiKey = getLlmApiKey();
  if (!apiKey) throw new Error('Missing LLM API key. Set OPENAI_API_KEY or LLM_API_KEY.');

  // First do a non-streamed call to check if the model wants tool calls
  const checkRes = await axios.post(
    `${DEFAULT_BASE_URL}/chat/completions`,
    {
      model: getActiveLlmModel(),
      temperature: 0,
      tools,
      tool_choice: 'auto',
      messages,
    },
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 60000,
    }
  );

  const choice = checkRes?.data?.choices?.[0];
  if (!choice) throw new Error('LLM returned an empty response');

  const msg = choice.message;

  if (Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0) {
    return { type: 'tool_calls', toolCalls: msg.tool_calls as ToolCall[] };
  }

  // Final answer — re-run with streaming to emit tokens
  const streamRes = await axios.post(
    `${DEFAULT_BASE_URL}/chat/completions`,
    {
      model: getActiveLlmModel(),
      temperature: 0,
      stream: true,
      messages,
    },
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      responseType: 'stream',
      timeout: 60000,
    }
  );

  const stream = streamRes.data as Readable;
  let buffer = '';
  let fullText = '';

  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const lineRaw of lines) {
        const line = lineRaw.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') { resolve(); return; }
        try {
          const parsed = JSON.parse(payload);
          const token = parsed?.choices?.[0]?.delta?.content;
          if (typeof token === 'string' && token.length > 0) {
            fullText += token;
            onChunk(token);
          }
        } catch { /* ignore partial payloads */ }
      }
    });
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });

  return { type: 'text', content: fullText.trim() };
}

export async function listAvailableModels(): Promise<string[]> {
  const apiKey = getLlmApiKey();
  if (!apiKey) {
    throw new Error('Missing LLM API key. Set OPENAI_API_KEY or LLM_API_KEY.');
  }

  const res = await axios.get(`${DEFAULT_BASE_URL}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    timeout: 20000
  });

  const ids: string[] = Array.isArray(res?.data?.data)
    ? res.data.data.map((model: unknown) => getStringProperty(model, 'id')).filter((id: unknown): id is string => typeof id === 'string')
    : [];

  const chatLike = ids.filter((id) => /(^gpt-|^o\d|chatgpt)/i.test(id));
  const unique = [...new Set(chatLike.length > 0 ? chatLike : ids)];
  return unique.sort((a, b) => a.localeCompare(b));
}

async function runChatCompletion(messages: Array<{ role: 'system' | 'user'; content: string }>): Promise<string> {
  const apiKey = getLlmApiKey();
  if (!apiKey) {
    throw new Error('Missing LLM API key. Set OPENAI_API_KEY or LLM_API_KEY.');
  }

  const res = await axios.post(
    `${DEFAULT_BASE_URL}/chat/completions`,
    {
      model: getActiveLlmModel(),
      temperature: 0,
      messages
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 25000
    }
  );

  const content = res?.data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('LLM returned an empty response');
  }
  return content.trim();
}

async function runChatCompletionStream(
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  onChunk: (chunk: string) => void
): Promise<string> {
  const apiKey = getLlmApiKey();
  if (!apiKey) {
    throw new Error('Missing LLM API key. Set OPENAI_API_KEY or LLM_API_KEY.');
  }

  const res = await axios.post(
    `${DEFAULT_BASE_URL}/chat/completions`,
    {
      model: getActiveLlmModel(),
      temperature: 0,
      stream: true,
      messages
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      responseType: 'stream',
      timeout: 60000
    }
  );

  const stream = res.data as Readable;
  let buffer = '';
  let fullText = '';

  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const lineRaw of lines) {
        const line = lineRaw.trim();
        if (!line.startsWith('data:')) continue;

        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          resolve();
          return;
        }

        try {
          const parsed = JSON.parse(payload);
          const token = parsed?.choices?.[0]?.delta?.content;
          if (typeof token === 'string' && token.length > 0) {
            fullText += token;
            onChunk(token);
          }
        } catch {
          // Ignore partial/invalid event payloads.
        }
      }
    });

    stream.on('end', () => resolve());
    stream.on('error', reject);
  });

  return fullText.trim();
}

function getStringProperty(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return typeof record[key] === 'string' ? record[key] : undefined;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error('Unable to parse LLM JSON response');
  }
}

export async function parseIntent(query: string): Promise<ParsedIntent> {
  const systemPrompt = [
    'You are an intent parser for a financial CLI.',
    'Return STRICT JSON only with keys:',
    '{"tickers": string[], "analysis_type": "growth"|"profitability"|"cashflow"|"general", "metrics": string[], "periods": number}',
    'Rules:',
    '- Extract stock tickers in uppercase.',
    '- If none found, return an empty array for tickers.',
    '- Default periods to 2 when unclear.',
    '- Do not include any explanation or markdown.'
  ].join('\n');

  const raw = await runChatCompletion([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: query }
  ]);

  const parsed = safeJsonParse(raw);
  return normalizeIntent(parsed, query);
}

const ANALYSIS_SYSTEM_PROMPT = [
  'You are FLUX, a Financial Intelligence CLI assistant.',
  'Use ONLY the provided financial data (source: FactStream). Do NOT use external knowledge.',
  'Output PLAIN TEXT only — no escape codes, no markdown, no backticks.',
  '',
  '━━━━━━━━━━━━━━━━━━ OUTPUT FORMAT ━━━━━━━━━━━━━━━━━━━━━━',
  'Four sections in this order, each with an ALL-CAPS header:',
  '',
  'QUARTERLY PERFORMANCE',
  '<period label, e.g. Q1 2026 vs Q4 2025>',
  'Revenue          $<value>  <direction> <pct>  (<prior period>: $<value>)  <sparkline>',
  'Net Income       $<value>  <direction> <pct>  (<prior period>: $<value>)  <sparkline>',
  'Free Cash Flow   $<value>  <direction> <pct>  (<prior period>: $<value>)  <sparkline>',
  '',
  'PROFITABILITY',
  'Gross Margin     <pct>  <bar10>  <assessment>',
  'Operating Margin <pct>  <bar10>  <assessment>',
  'Net Margin       <pct>  <bar10>  <assessment>',
  'Diluted EPS      $<value>  <direction> <pct>',
  '',
  'BALANCE SHEET',
  'Total Assets   $<value>  <direction> <pct>',
  'Cash & Equiv.  $<value>  <direction> <pct>',
  'Total Debt     $<value>  <direction> <pct>',
  '',
  'KEY TAKEAWAYS',
  '• <point 1>',
  '• <point 2>',
  '• <point 3>',
  '',
  '━━━━━━━━━━━━━━━━━━ RULES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  '- Labels padded to 16 chars',
  '- ↑ for positive, ↓ for negative, → for flat',
  '- Progress bars: ━ filled + ░ empty, exactly 10 chars',
  '- Sparklines: ▁▂▃▅▆▇█, 4 chars per row',
  '- Blank line between every section',
  '- If a metric is missing: write "Data not available"',
  '- If news context provided: add NEWS CONTEXT section after KEY TAKEAWAYS (bullets only, no numbers)',
  '- Output ONLY the analysis — no preamble, no explanations',
].join('\n');

// ── Compare prompt (2+ tickers side-by-side) ─────────────────────────────────
const COMPARE_SYSTEM_PROMPT = [
  'You are FLUX, a Financial Intelligence CLI assistant.',
  'Use ONLY the provided financial data (source: FactStream). Do NOT use external knowledge.',
  'Output PLAIN TEXT only — no escape codes, no markdown, no backticks.',
  '',
  '━━━━━━━━━━━━━━━━━━ OUTPUT FORMAT ━━━━━━━━━━━━━━━━━━━━━━',
  'Five sections in this order, each with an ALL-CAPS header:',
  '',
  'REVENUE & GROWTH',
  '<period label, e.g. Q1 2026>',
  'Ticker   Revenue     QoQ       vs Leader',
  '<TICK1>  $<value>   <↑/↓><pct>  leader',
  '<TICK2>  $<value>   <↑/↓><pct>  -<gap>%',
  '...',
  '→ Revenue leader: <TICKER>',
  '',
  'PROFITABILITY',
  'Ticker   Net Margin  Gross Margin  Op Margin  Diluted EPS',
  '<TICK1>  <pct>       <pct>         <pct>      $<value>',
  '<TICK2>  <pct>       <pct>         <pct>      $<value>',
  '...',
  '→ Most profitable: <TICKER>',
  '',
  'BALANCE SHEET',
  'Ticker   Cash        Total Debt   Debt/Equity',
  '<TICK1>  $<value>   $<value>     <ratio>',
  '<TICK2>  $<value>   $<value>     <ratio>',
  '...',
  '→ Strongest balance sheet: <TICKER>',
  '',
  'KEY DIFFERENCES',
  '• <direct comparison point between tickers>',
  '• <direct comparison point between tickers>',
  '• <direct comparison point between tickers>',
  '',
  'VERDICT',
  '<2-3 sentences: who leads overall, who suits which investor, any standout risk or opportunity>',
  '',
  '━━━━━━━━━━━━━━━━━━ RULES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  '- Ticker column: pad to 8 chars',
  '- Numeric columns: right-align values, consistent width per column',
  '- ↑ for positive QoQ, ↓ for negative, → for flat',
  '- "vs Leader" column: show "leader" for the top ticker, "-<gap>%" for others',
  '- If a metric is missing for a ticker: write "N/A"',
  '- KEY DIFFERENCES must compare tickers against each other — no single-ticker observations',
  '- If news context provided: add NEWS CONTEXT section after VERDICT (bullets only)',
  '- Output ONLY the analysis — no preamble, no explanations',
].join('\n');

export async function analyzeData(query: string, data: object): Promise<string> {
  const userPrompt = [
    `User query: ${query}`,
    '',
    'FINANCIAL DATA (source: FactStream):',
    JSON.stringify(data, null, 2)
  ].join('\n');

  return runChatCompletion([
    { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt }
  ]);
}

/**
 * Enhanced entity-based intent parsing
 * Returns entities (company names + tickers) instead of just tickers
 */
export async function parseEntityIntent(query: string): Promise<ParsedIntentV2> {
  const systemPrompt = [
    'You are an entity parser for a financial CLI.',
    'Return STRICT JSON only with keys:',
    '{"entities": [{"name": "string", "type": "company"|"ticker"}], "analysis_type": "growth"|"profitability"|"cashflow"|"general", "include_news": boolean, "off_topic": boolean, "request_type": "analysis"|"news"}',
    'Rules:',
    '- Extract company names OR stock tickers from the query.',
    '- If input is 1-5 uppercase letters, type = "ticker".',
    '- If input is a company name, type = "company".',
    '- DO NOT guess or assume tickers.',
    '- Set request_type = "news" when the user primarily wants news, headlines, or recent events (e.g. "tell me the news", "latest news", "what happened", "any updates", "headlines").',
    '- Set request_type = "analysis" for financial analysis, earnings, growth, valuation, comparison, or general stock queries.',
    '- Set include_news = true if query mentions "news", "latest", "why", "impact", or "recent".',
    '- Default include_news = true.',
    '- Set off_topic = true if the input has NO financial or company intent (e.g. greetings, random text, jokes, personal questions, unrelated topics).',
    '- When off_topic = true, entities must be an empty array.',
    '- Do not include any explanation or markdown.'
  ].join('\n');

  const raw = await runChatCompletion([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: query }
  ]);

  const parsed = safeJsonParse(raw);
  return normalizeIntentV2(parsed);
}

/**
 * Combined analysis using both financial and news data
 */
export async function analyzeDataWithNews(
  query: string,
  financialData: object,
  newsData: object
): Promise<string> {
  const userPrompt = [
    `User query: ${query}`,
    '',
    'FINANCIAL DATA (source: FactStream):',
    JSON.stringify(financialData, null, 2),
    '',
    'NEWS CONTEXT (use for context only, do not extract numbers):',
    JSON.stringify(newsData, null, 2)
  ].join('\n');

  return runChatCompletion([
    { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt }
  ]);
}

export async function analyzeDataStream(
  query: string,
  data: object,
  onChunk: (chunk: string) => void
): Promise<string> {
  const userPrompt = [
    `User query: ${query}`,
    '',
    'FINANCIAL DATA (source: FactStream):',
    JSON.stringify(data, null, 2)
  ].join('\n');

  return runChatCompletionStream(
    [
      { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    onChunk
  );
}

export async function analyzeDataWithNewsStream(
  query: string,
  financialData: object,
  newsData: object,
  onChunk: (chunk: string) => void
): Promise<string> {
  const userPrompt = [
    `User query: ${query}`,
    '',
    'FINANCIAL DATA (source: FactStream):',
    JSON.stringify(financialData, null, 2),
    '',
    'NEWS CONTEXT (use for context only, do not extract numbers):',
    JSON.stringify(newsData, null, 2)
  ].join('\n');

  return runChatCompletionStream(
    [
      { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    onChunk
  );
}

// ── News summary prompt ───────────────────────────────────────────────────────
const NEWS_SYSTEM_PROMPT = [
  'You are FLUX, a Financial Intelligence CLI assistant.',
  'Use ONLY the provided news data. Do NOT fabricate events or use external knowledge.',
  'Output PLAIN TEXT only — no escape codes, no markdown, no backticks.',
  '',
  '━━━━━━━━━━━━━━━━━━ OUTPUT FORMAT ━━━━━━━━━━━━━━━━━━━━━━',
  'Three sections in this order, each with an ALL-CAPS header:',
  '',
  'LATEST NEWS',
  '• <headline> — <1-sentence summary> (<source>, <date if available>)',
  '• ...',
  '(list up to 6 most relevant articles)',
  '',
  'MARKET IMPACT',
  '<2-3 sentences: how the news collectively could affect the stock or business>',
  '',
  'KEY TAKEAWAYS',
  '• <actionable insight derived from the news>',
  '• <actionable insight derived from the news>',
  '• <actionable insight derived from the news>',
  '',
  '━━━━━━━━━━━━━━━━━━ RULES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  '- Only report what is in the provided news data',
  '- Do not discuss earnings, financials, or valuation unless mentioned in the news',
  '- Output ONLY the news brief — no preamble, no explanations',
].join('\n');

export async function summarizeNews(query: string, newsData: object): Promise<string> {
  const userPrompt = [
    `User query: ${query}`,
    '',
    'NEWS DATA:',
    JSON.stringify(newsData, null, 2)
  ].join('\n');

  return runChatCompletion([
    { role: 'system', content: NEWS_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt }
  ]);
}

export async function summarizeNewsStream(
  query: string,
  newsData: object,
  onChunk: (chunk: string) => void
): Promise<string> {
  const userPrompt = [
    `User query: ${query}`,
    '',
    'NEWS DATA:',
    JSON.stringify(newsData, null, 2)
  ].join('\n');

  return runChatCompletionStream(
    [
      { role: 'system', content: NEWS_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    onChunk
  );
}

// ── Compare variants (2+ tickers) ────────────────────────────────────────────
export async function compareData(query: string, data: object): Promise<string> {
  const userPrompt = [
    `User query: ${query}`,
    '',
    'FINANCIAL DATA (source: FactStream):',
    JSON.stringify(data, null, 2)
  ].join('\n');

  return runChatCompletion([
    { role: 'system', content: COMPARE_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt }
  ]);
}

export async function compareDataWithNews(
  query: string,
  financialData: object,
  newsData: object
): Promise<string> {
  const userPrompt = [
    `User query: ${query}`,
    '',
    'FINANCIAL DATA (source: FactStream):',
    JSON.stringify(financialData, null, 2),
    '',
    'NEWS CONTEXT (use for context only, do not extract numbers):',
    JSON.stringify(newsData, null, 2)
  ].join('\n');

  return runChatCompletion([
    { role: 'system', content: COMPARE_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt }
  ]);
}

export async function compareDataStream(
  query: string,
  data: object,
  onChunk: (chunk: string) => void
): Promise<string> {
  const userPrompt = [
    `User query: ${query}`,
    '',
    'FINANCIAL DATA (source: FactStream):',
    JSON.stringify(data, null, 2)
  ].join('\n');

  return runChatCompletionStream(
    [
      { role: 'system', content: COMPARE_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    onChunk
  );
}

export async function compareDataWithNewsStream(
  query: string,
  financialData: object,
  newsData: object,
  onChunk: (chunk: string) => void
): Promise<string> {
  const userPrompt = [
    `User query: ${query}`,
    '',
    'FINANCIAL DATA (source: FactStream):',
    JSON.stringify(financialData, null, 2),
    '',
    'NEWS CONTEXT (use for context only, do not extract numbers):',
    JSON.stringify(newsData, null, 2)
  ].join('\n');

  return runChatCompletionStream(
    [
      { role: 'system', content: COMPARE_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    onChunk
  );
}
