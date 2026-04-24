/**
 * FLUX Agent
 *
 * Agentic loop: LLM receives the user query + available tool definitions,
 * decides what data to fetch, executes tool calls, then produces the final
 * analysis — all driven by the model, not a hard-coded pipeline.
 */

import { resolveTicker } from './resolver';
import { buildMinimalDataset } from './factstream';
import { fetchNewsParallel } from './news';
import { runAgentLoop, runAgentLoopStream, AgentMessage } from './llm';

// ── Tool definitions sent to the LLM ─────────────────────────────────────────

export const FLUX_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_financials',
      description:
        'Fetch the latest and previous quarterly/annual financial statements for one or more stock tickers. Use this when the user asks about earnings, revenue, profit, growth, balance sheet, cash flow, valuation, or any financial metric.',
      parameters: {
        type: 'object',
        properties: {
          tickers: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of stock ticker symbols (uppercase). Resolve company names to tickers first.',
          },
        },
        required: ['tickers'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_news',
      description:
        'Fetch the latest news articles for one or more companies. Use this when the user asks about news, recent events, headlines, what happened, market impact, or context around a company.',
      parameters: {
        type: 'object',
        properties: {
          companies: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of company names or ticker symbols to fetch news for.',
          },
        },
        required: ['companies'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'resolve_ticker',
      description:
        'Resolve a company name to its stock ticker symbol. Use this before calling get_financials when you have a company name (e.g. "Apple") instead of a ticker (e.g. "AAPL").',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Company name or partial name to resolve.',
          },
        },
        required: ['name'],
      },
    },
  },
] as const;

// ── Tool executor ─────────────────────────────────────────────────────────────

export type ToolCallResult = {
  tool: string;
  result: any;
};

export async function executeTool(name: string, args: any): Promise<any> {
  switch (name) {
    case 'resolve_ticker': {
      const ticker = await resolveTicker(String(args.name || ''));
      return { ticker: ticker || null, resolved: !!ticker };
    }

    case 'get_financials': {
      const tickers: string[] = Array.isArray(args.tickers)
        ? args.tickers.map((t: any) => String(t).toUpperCase())
        : [];
      if (tickers.length === 0) return { error: 'No tickers provided' };
      const dataset = await buildMinimalDataset(tickers);
      return { dataset };
    }

    case 'get_news': {
      const companies: string[] = Array.isArray(args.companies)
        ? args.companies.map((c: any) => String(c))
        : [];
      if (companies.length === 0) return { error: 'No companies provided' };
      const news = await fetchNewsParallel(companies);
      return { news };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ── Agent run result ──────────────────────────────────────────────────────────

export type AgentResult = {
  /** Tickers that were ultimately fetched (for the header display) */
  resolvedTickers: string[];
  /** Collected financial dataset (may be empty for news-only queries) */
  dataset: Record<string, { latest: any; previous: any }>;
  /** Collected news data (may be empty for financials-only queries) */
  newsData: Record<string, any>;
  /** Final text output from the LLM */
  text: string;
};

// ── Main agent entry point ────────────────────────────────────────────────────

/**
 * Run the agentic loop for a user query.
 * @param query  Raw user query
 * @param onChunk  Called with each streamed token of the final answer
 * @param onToolCall  Called when the agent fires a tool call (for spinner updates)
 */
export async function runFluxAgent(
  query: string,
  onChunk?: (chunk: string) => void,
  onToolCall?: (name: string, args: any) => void
): Promise<AgentResult> {
  const resolvedTickers: string[] = [];
  const dataset: Record<string, { latest: any; previous: any }> = {};
  const newsData: Record<string, any> = {};

  const messages: AgentMessage[] = [
    {
      role: 'system',
      content: AGENT_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: query,
    },
  ];

  // Agent loop — max 6 iterations to prevent runaway loops
  for (let turn = 0; turn < 6; turn++) {
    // On each turn, check if the model wants tool calls (non-streaming).
    // When the model produces a final text answer, re-run with streaming if onChunk is provided.
    const response = onChunk
      ? await runAgentLoopStream(messages, FLUX_TOOLS, onChunk)
      : await runAgentLoop(messages, FLUX_TOOLS);

    if (response.type === 'text') {
      // Final answer — stream it out
      return { resolvedTickers, dataset, newsData, text: response.content };
    }

    if (response.type === 'tool_calls') {
      // Push the assistant message with tool_calls into history
      messages.push({ role: 'assistant', tool_calls: response.toolCalls });

      // Execute each tool call and push results
      for (const tc of response.toolCalls) {
        onToolCall?.(tc.function.name, JSON.parse(tc.function.arguments || '{}'));

        let result: any;
        try {
          result = await executeTool(tc.function.name, JSON.parse(tc.function.arguments || '{}'));
        } catch (err: any) {
          result = { error: err?.message || 'Tool execution failed' };
        }

        // Accumulate side-effects for caller metadata
        if (tc.function.name === 'get_financials' && result.dataset) {
          Object.assign(dataset, result.dataset);
          resolvedTickers.push(...Object.keys(result.dataset).filter(k => !resolvedTickers.includes(k)));
        }
        if (tc.function.name === 'get_news' && result.news) {
          Object.assign(newsData, result.news);
        }
        if (tc.function.name === 'resolve_ticker' && result.ticker) {
          if (!resolvedTickers.includes(result.ticker)) resolvedTickers.push(result.ticker);
        }

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }

      // Continue the loop — LLM will now see the tool results
      continue;
    }

    // Unexpected response type — stop
    break;
  }

  return { resolvedTickers, dataset, newsData, text: '' };
}

// ── Agent system prompt ───────────────────────────────────────────────────────

const AGENT_SYSTEM_PROMPT = [
  'You are FLUX, a Financial Intelligence CLI assistant.',
  'You have access to tools to fetch real financial data and news.',
  '',
  'DECISION RULES:',
  '- If the user asks about financials, earnings, revenue, profit, growth, valuation, or comparison → call get_financials',
  '- If the user asks about news, recent events, headlines, what happened, or market updates → call get_news',
  '- If the user asks for both analysis and news context → call both tools',
  '- If you have a company name but not a ticker → call resolve_ticker first',
  '- Never guess financial numbers. Always fetch data before analyzing.',
  '',
  'OUTPUT FORMAT (plain text, no markdown, no escape codes):',
  '',
  'For FINANCIAL ANALYSIS (single ticker):',
  'Four sections: QUARTERLY PERFORMANCE, PROFITABILITY, BALANCE SHEET, KEY TAKEAWAYS',
  'QUARTERLY PERFORMANCE',
  '<period label, e.g. Q1 2026 vs Q4 2025>',
  'Revenue          $<value>  <↑/↓><pct>  (<prior>: $<value>)  <sparkline>',
  'Net Income       $<value>  <↑/↓><pct>  (<prior>: $<value>)  <sparkline>',
  'Free Cash Flow   $<value>  <↑/↓><pct>  (<prior>: $<value>)  <sparkline>',
  'PROFITABILITY',
  'Gross Margin     <pct>  <bar10>  <assessment>',
  'Operating Margin <pct>  <bar10>  <assessment>',
  'Net Margin       <pct>  <bar10>  <assessment>',
  'Diluted EPS      $<value>  <↑/↓><pct>',
  'BALANCE SHEET',
  'Total Assets   $<value>  <↑/↓><pct>',
  'Cash & Equiv.  $<value>  <↑/↓><pct>',
  'Total Debt     $<value>  <↑/↓><pct>',
  'KEY TAKEAWAYS',
  '• <point>',
  '• <point>',
  '• <point>',
  '',
  'For COMPARISON (2+ tickers):',
  'Five sections: REVENUE & GROWTH, PROFITABILITY, BALANCE SHEET, KEY DIFFERENCES, VERDICT',
  'Each section is a side-by-side table. KEY DIFFERENCES bullets must compare tickers against each other.',
  'VERDICT is 2-3 sentences: who leads, who suits which investor, any standout risk.',
  '',
  'For NEWS BRIEF:',
  'Three sections: LATEST NEWS, MARKET IMPACT, KEY TAKEAWAYS',
  'LATEST NEWS: up to 6 bullets — headline, 1-sentence summary, source + date',
  'MARKET IMPACT: 2-3 sentences on collective business/stock impact',
  'KEY TAKEAWAYS: 3 actionable insights from the news',
  '',
  'For COMBINED (financials + news):',
  'Use the financial analysis format, then add a NEWS CONTEXT section after KEY TAKEAWAYS (bullets only).',
  '',
  'RULES:',
  '- Labels padded to 16 chars. ↑ positive, ↓ negative, → flat.',
  '- Progress bars: ━ filled + ░ empty, exactly 10 chars.',
  '- Sparklines: ▁▂▃▅▆▇█, 4 chars.',
  '- If a metric is missing: write "Data not available".',
  '- Output ONLY the analysis — no preamble, no explanations.',
].join('\n');
