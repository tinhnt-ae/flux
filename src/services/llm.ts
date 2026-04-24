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

export async function analyzeData(query: string, data: object): Promise<string> {
  const systemPrompt = [
    'You are a financial analysis assistant for a CLI.',
    'Use ONLY the provided dataset.',
    'Do NOT use external knowledge.',
    'If data is missing, explicitly say data is unavailable.',
    'Write concise, terminal-friendly analysis with two short sections:',
    '1) Analysis',
    '2) Conclusion'
  ].join('\n');

  const userPrompt = [
    `User query: ${query}`,
    'Dataset (JSON):',
    JSON.stringify(data)
  ].join('\n\n');

  return runChatCompletion([
    { role: 'system', content: systemPrompt },
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
  const systemPrompt = [
    'You are a financial analysis assistant for a CLI.',
    'You have access to:',
    '1. Financial data (source of truth)',
    '2. News data (context only)',
    'Rules:',
    '- Base analysis on financial data only.',
    '- Use news for context and explanation.',
    '- DO NOT extract numbers from news.',
    '- If news is irrelevant, ignore it.',
    '- Be concise and professional.',
    'Format output as:',
    '=== SUMMARY ===',
    '[1-2 sentences on financial health]',
    '',
    '=== ANALYSIS ===',
    '[2-3 paragraphs of analysis]',
    '',
    '=== NEWS IMPACT ===',
    '- [key point 1]',
    '- [key point 2]',
    '- [key point 3]',
    '',
    '=== CONCLUSION ==='
  ].join('\n');

  const userPrompt = [
    `User query: ${query}`,
    '',
    'FINANCIAL DATA:',
    JSON.stringify(financialData),
    '',
    'NEWS DATA:',
    JSON.stringify(newsData)
  ].join('\n');

  return runChatCompletion([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ]);
}

export async function analyzeDataStream(
  query: string,
  data: object,
  onChunk: (chunk: string) => void
): Promise<string> {
  const systemPrompt = [
    'You are a financial analysis assistant for a CLI.',
    'Use ONLY the provided dataset.',
    'Do NOT use external knowledge.',
    'If data is missing, explicitly say data is unavailable.',
    'Write concise, terminal-friendly analysis with two short sections:',
    '1) Analysis',
    '2) Conclusion'
  ].join('\n');

  const userPrompt = [`User query: ${query}`, 'Dataset (JSON):', JSON.stringify(data)].join('\n\n');

  return runChatCompletionStream(
    [
      { role: 'system', content: systemPrompt },
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
  const systemPrompt = [
    'You are a financial analysis assistant for a CLI.',
    'You have access to:',
    '1. Financial data (source of truth)',
    '2. News data (context only)',
    'Rules:',
    '- Base analysis on financial data only.',
    '- Use news for context and explanation.',
    '- DO NOT extract numbers from news.',
    '- If news is irrelevant, ignore it.',
    '- Be concise and professional.',
    'Format output as:',
    '=== SUMMARY ===',
    '[1-2 sentences on financial health]',
    '',
    '=== ANALYSIS ===',
    '[2-3 paragraphs of analysis]',
    '',
    '=== NEWS IMPACT ===',
    '- [key point 1]',
    '- [key point 2]',
    '- [key point 3]',
    '',
    '=== CONCLUSION ==='
  ].join('\n');

  const userPrompt = [
    `User query: ${query}`,
    '',
    'FINANCIAL DATA:',
    JSON.stringify(financialData),
    '',
    'NEWS DATA:',
    JSON.stringify(newsData)
  ].join('\n');

  return runChatCompletionStream(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    onChunk
  );
}
