import axios from 'axios';
import { Readable } from 'stream';
import { normalizeIntent, ParsedIntent, normalizeIntentV2, ParsedIntentV2 } from '../utils/parser';
import { getStoredLlmModel } from '../utils/config';

const DEFAULT_BASE_URL = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
const DEFAULT_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

function getLlmApiKey(): string | undefined {
  return process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
}

export function getActiveLlmModel(): string {
  return process.env.LLM_MODEL || getStoredLlmModel() || DEFAULT_MODEL;
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
    ? res.data.data.map((m: any) => m?.id).filter((id: unknown) => typeof id === 'string')
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

function safeJsonParse(text: string): any {
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
  'Revenue          $143.8B  ↑ +40.3%  (Q4: $102.5B)  ▁▃▅█',
  'Net Income       $42.1B   ↑ +53.3%  (Q4: $27.5B)   ▁▂▅█',
  'Free Cash Flow   $51.6B   ↑ +206%   (Q4: -$48.4B)  ▁▁▁█',
  '',
  'PROFITABILITY',
  'Gross Margin     48.2%  ━━━━━━━━━░  Excellent',
  'Operating Margin 35.4%  ━━━━━━░░░░  Strong',
  'Net Margin       29.3%  ━━━━━░░░░░  Healthy',
  'Diluted EPS      $2.84  ↑ +54.3%',
  '',
  'BALANCE SHEET',
  'Total Assets   $379.3B  ↑ +5.6%',
  'Cash & Equiv.  $45.3B   ↑ +26.1%',
  'Total Debt     $88.5B   ↓ -2.1%',
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
    '{"entities": [{"name": "string", "type": "company"|"ticker"}], "analysis_type": "growth"|"profitability"|"cashflow"|"general", "include_news": boolean, "off_topic": boolean}',
    'Rules:',
    '- Extract company names OR stock tickers from the query.',
    '- If input is 1-5 uppercase letters, type = "ticker".',
    '- If input is a company name, type = "company".',
    '- DO NOT guess or assume tickers.',
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
