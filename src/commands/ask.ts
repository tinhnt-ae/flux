import chalk from 'chalk';
import { parseEntityIntent, analyzeDataStream, analyzeDataWithNewsStream, analyzeData, analyzeDataWithNews } from '../services/llm';
import { buildMinimalDataset } from '../services/factstream';
import { fetchNewsParallel } from '../services/news';
import { resolveTicker } from '../services/resolver';
import { extractCoreMetrics } from '../utils/parser';
import { formatCurrency } from '../utils/format';
import { pctChange } from '../utils/growth';
import { FluxLoader } from '../ui/fluxLoader';
import { renderAnalysisHeader, renderDivider } from '../ui/layout';
import { pauseStep, renderStepFail } from '../ui/renderer';
import { StreamWriter } from '../ui/stream';

const STREAM_CURSOR_ENABLED = true;

// ── color helpers ──────────────────────────────────────────────────────────

/** Color a percentage string: + → green, - → red, else unchanged */
function colorPercentage(value: string): string {
  if (!process.stdout.isTTY) return value;
  if (value.startsWith('+')) return chalk.green(value);
  if (value.startsWith('-')) return chalk.red(value);
  return value;
}

/** Color a trend direction word: improving → green, weakening → red, else unchanged */
function colorTrendWord(word: string): string {
  if (!process.stdout.isTTY) return word;
  const lower = word.toLowerCase();
  if (lower === 'improving') return chalk.green(word);
  if (lower === 'weakening') return chalk.red(word);
  return word;
}

// ── formatters ─────────────────────────────────────────────────────────────

function formatPct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return 'N/A';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

/** Returns the colored value portion of a trend line (no label). */
function insightValue(latest: number | null, previous: number | null): string {
  const trend = pctChange(latest, previous);
  if (trend === null) return chalk.gray('insufficient data');
  const pctStr = formatPct(trend);
  if (trend > 0) return `${colorTrendWord('improving')} (${colorPercentage(pctStr)} QoQ)`;
  if (trend < 0) return `${colorTrendWord('weakening')} (${colorPercentage(pctStr)} QoQ)`;
  return `stable (${pctStr} QoQ)`;
}

function insightLine(label: string, latest: number | null, previous: number | null): string {
  return `${label}: ${insightValue(latest, previous)}`;
}

function renderTickerInsightBlock(ticker: string, latestRaw: any, previousRaw: any): void {
  const latest = extractCoreMetrics(latestRaw);
  const previous = previousRaw ? extractCoreMetrics(previousRaw) : { revenue: null, netIncome: null, freeCashFlow: null };

  const L = 16; // label column width (matches widest label "Free Cash Flow:")

  const labelCol = (text: string) => chalk.gray(text.padEnd(L));
  const valCol = (text: string) => chalk.white(text);

  process.stdout.write(`${chalk.bold.hex('#7ad3ff')(ticker)}\n`);
  process.stdout.write(`  ${labelCol('Revenue:')} ${valCol(formatCurrency(latest.revenue))}\n`);
  process.stdout.write(`  ${labelCol('Net Income:')} ${valCol(formatCurrency(latest.netIncome))}\n`);
  process.stdout.write(`  ${labelCol('Free Cash Flow:')} ${valCol(formatCurrency(latest.freeCashFlow))}\n`);
  process.stdout.write(`  ${labelCol('Revenue trend:')} ${insightValue(latest.revenue, previous.revenue)}\n`);
  process.stdout.write(`  ${labelCol('Profit trend:')} ${insightValue(latest.netIncome, previous.netIncome)}\n`);
  process.stdout.write(`  ${labelCol('Cash flow trend:')} ${insightValue(latest.freeCashFlow, previous.freeCashFlow)}\n\n`);
}

function formatResolvedSummary(resolvedMap: Record<string, string>): string {
  const entries = Object.entries(resolvedMap);
  if (entries.length === 1) {
    return `Resolving company -> ${entries[0][1]}`;
  }
  const tickers = entries.map(([, ticker]) => ticker).join(', ');
  return `Resolved companies -> ${tickers}`;
}

export async function run(query: string): Promise<void> {
  const parseLoader = new FluxLoader();
  let entityIntent: Awaited<ReturnType<typeof parseEntityIntent>>;
  parseLoader.start('Interpreting request...');
  try {
    entityIntent = await parseEntityIntent(query);
    parseLoader.ok('Request interpreted');
  } catch (e: any) {
    parseLoader.fail('Request interpretation failed');
    return;
  }
  await pauseStep();

  if (entityIntent.off_topic) {
    process.stdout.write(
      `${chalk.yellow('!')} ${chalk.white("That doesn't look like a financial query.")}\n` +
      `  ${chalk.gray('Try: "Analyze Apple growth" or "Compare TSLA vs NVDA with latest news"')}\n` +
      `  ${chalk.gray('Type')} ${chalk.cyan('/examples')} ${chalk.gray('for more ideas.')}\n\n`
    );
    return;
  }

  if (!entityIntent.entities || entityIntent.entities.length === 0) {
    process.stdout.write(
      `${chalk.yellow('!')} ${chalk.white('No company or ticker found in your query.')}\n` +
      `  ${chalk.gray('Include a company name or ticker, e.g.')} ${chalk.cyan('"Analyze AAPL"')}\n\n`
    );
    return;
  }

  const resolveLoader = new FluxLoader();
  const tickers: string[] = [];
  const resolvedMap: Record<string, string> = {};

  resolveLoader.start('Resolving company...');
  for (const entity of entityIntent.entities) {
    const resolved = await resolveTicker(entity.name);
    if (!resolved) continue;
    tickers.push(resolved);
    resolvedMap[entity.name] = resolved;
  }

  if (tickers.length === 0) {
    resolveLoader.fail('Company resolution failed');
    const names = entityIntent.entities.map((e) => `"${e.name}"`).join(', ');
    process.stdout.write(
      `  ${chalk.gray(`Could not find a listed ticker for ${names}.`)}\n` +
      `  ${chalk.gray('Try using the official ticker symbol, e.g.')} ${chalk.cyan('"AAPL"')} ${chalk.gray('instead of')} ${chalk.cyan('"Apple Inc"')}\n\n`
    );
    return;
  }
  resolveLoader.ok(formatResolvedSummary(resolvedMap));
  await pauseStep();

  const financialLoader = new FluxLoader();
  const dataset: Record<string, { latest: any; previous: any }> = {};

  financialLoader.start('Fetching financial data...');
  for (const ticker of tickers) {
    try {
      const single = await buildMinimalDataset([ticker]);
      if (single[ticker]) dataset[ticker] = single[ticker];
    } catch {
      // Keep moving and report after fetch completes.
    }
  }

  if (Object.keys(dataset).length === 0) {
    financialLoader.fail('Financial data unavailable');
    return;
  }
  financialLoader.ok('Financial data loaded');
  await pauseStep();

  let newsData: Record<string, any> = {};
  if (entityIntent.include_news) {
    const newsLoader = new FluxLoader();
    newsLoader.start('Fetching latest news...');
    try {
      newsData = await fetchNewsParallel(entityIntent.entities.map((e) => e.name));
      newsLoader.ok('News data loaded');
    } catch {
      newsLoader.fail('News data unavailable');
    }
    await pauseStep();
  }

  renderDivider();
  process.stdout.write(`${chalk.bold.white('Market Brief')}\n`);
  process.stdout.write(`${chalk.gray('------------')}\n`);
  process.stdout.write(`${chalk.gray('A concise snapshot of financial quality and momentum by ticker.')}\n\n`);

  for (const [ticker, statements] of Object.entries(dataset)) {
    if (!statements.latest) continue;
    renderTickerInsightBlock(ticker, statements.latest, statements.previous);
  }

  const analyzingLoader = new FluxLoader();
  const writer = new StreamWriter({ showCursor: STREAM_CURSOR_ENABLED, cursorChar: '▌' });
  let startedStreaming = false;
  let lineBuffer = '';

  const styleArticleLine = (line: string): string => {
    const trimmed = line.trim();
    if (/^===\s*.+\s*===$/.test(trimmed)) return `${chalk.bold.hex('#7ad3ff')(trimmed)}\n`;
    if (/^(summary|financial analysis|news impact|combined insight|conclusion)\s*:/i.test(trimmed)) {
      return `${chalk.bold.white(trimmed)}\n`;
    }
    if (/^[-*]\s+/.test(trimmed)) return `${chalk.gray(line)}\n`;
    return `${chalk.white(line)}\n`;
  };

  const writeArticleChunk = (chunk: string) => {
    lineBuffer += chunk;
    const parts = lineBuffer.split('\n');
    lineBuffer = parts.pop() ?? '';
    for (const line of parts) {
      writer.write(styleArticleLine(line));
    }
    // Do not wait for full paragraphs; start showing text progressively.
    if (lineBuffer.length >= 20) {
      writer.write(chalk.white(lineBuffer));
      lineBuffer = '';
    }
  };

  analyzingLoader.animate('Analyzing...');
  try {
    const onChunk = (chunk: string) => {
      if (!startedStreaming) {
        startedStreaming = true;
        analyzingLoader.stop();
        process.stdout.write('\n');
        renderAnalysisHeader();
      }
      writeArticleChunk(chunk);
    };

    if (entityIntent.include_news && Object.keys(newsData).length > 0) {
      await analyzeDataWithNewsStream(query, { tickers, dataset }, newsData, onChunk);
    } else {
      await analyzeDataStream(query, { tickers, dataset }, onChunk);
    }

    if (!startedStreaming) {
      analyzingLoader.stop();
      renderAnalysisHeader();
      const fallbackText = entityIntent.include_news && Object.keys(newsData).length > 0
        ? await analyzeDataWithNews(query, { tickers, dataset }, newsData)
        : await analyzeData(query, { tickers, dataset });
      writer.write(chalk.white(fallbackText));
      await writer.end();
    } else {
      if (lineBuffer.length > 0) {
        writer.write(chalk.white(lineBuffer));
      }
      await writer.end();
    }
  } catch (e: any) {
    await writer.abort();
    analyzingLoader.fail('Analysis failed');
    return;
  }

  renderDivider();
  process.stdout.write('\n');
}
