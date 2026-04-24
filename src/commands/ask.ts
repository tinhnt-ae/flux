import chalk from 'chalk';
import { runFluxAgent } from '../services/agent';
import { FluxLoader } from '../ui/fluxLoader';
import { renderAnalysisHeader, renderDivider } from '../ui/layout';
import { StreamWriter } from '../ui/stream';

const STREAM_CURSOR_ENABLED = true;

// ── Tool call label map ────────────────────────────────────────────────────

const TOOL_LABELS: Record<string, (args: any) => string> = {
  resolve_ticker: (a) => `Resolving "${a.name}"...`,
  get_financials: (a) => `Fetching financials for ${Array.isArray(a?.tickers) ? a.tickers.join(', ') : ''}...`,
  get_news:       (a) => `Fetching news for ${Array.isArray(a?.companies) ? a.companies.join(', ') : ''}...`,
};

export async function run(query: string): Promise<void> {
  // ── Shared ANSI helpers ─────────────────────────────────────────────────
  const isTTY = process.stdout.isTTY === true;
  const ESC = '\x1b';
  const BRAND = isTTY ? `${ESC}[38;5;48m`  : '';
  const POS   = isTTY ? `${ESC}[38;5;46m`  : '';
  const NEG   = isTTY ? `${ESC}[38;5;196m` : '';
  const CYAN  = isTTY ? `${ESC}[38;5;51m`  : '';
  const MUTED = isTTY ? `${ESC}[38;5;240m` : '';
  const BOLD  = isTTY ? `${ESC}[1m`         : '';
  const R     = isTTY ? `${ESC}[0m`         : '';

  const colorInline = (text: string): string =>
    text
      .replace(/(\$[\d,.]+[BMKbmk]?)/g, `${BOLD}$1${R}`)
      .replace(/(\([^)]+\))/g, `${MUTED}$1${R}`)
      .replace(/(\+[\d.]+%)/g, `${POS}$1${R}`)
      .replace(/(?<!\+)(-[\d.]+%)/g, `${NEG}$1${R}`)
      .replace(/↑/g, `${POS}↑${R}`)
      .replace(/↓/g, `${NEG}↓${R}`);

  const styleArticleLine = (line: string): string => {
    const trimmed = line.trim();
    if (trimmed === '') return '\n';
    if (/^[A-Z][A-Z\s&]+$/.test(trimmed)) {
      return `\n${BRAND}${BOLD}${trimmed}${R}\n`;
    }
    if (/^(Q[1-4]\s+\d{4}|FY\s*\d{4}|H[12]\s+\d{4})/i.test(trimmed)) {
      return `${MUTED}${trimmed}${R}\n`;
    }
    if (/^[•\-*]\s+/.test(trimmed)) {
      const text = trimmed.replace(/^[•\-*]\s+/, '');
      return `${CYAN}•${R} ${colorInline(text)}\n`;
    }
    return `${colorInline(trimmed)}\n`;
  };

  // ── Run agent ──────────────────────────────────────────────────────────
  const loader = new FluxLoader();
  loader.animate('Thinking...');

  const writer = new StreamWriter({ showCursor: STREAM_CURSOR_ENABLED, cursorChar: '▌' });
  let startedStreaming = false;
  let lineBuffer = '';

  const writeChunk = (chunk: string) => {
    if (!startedStreaming) {
      startedStreaming = true;
      loader.stop();
      process.stdout.write('\n');
      renderAnalysisHeader();
    }
    lineBuffer += chunk;
    const parts = lineBuffer.split('\n');
    lineBuffer = parts.pop() ?? '';
    for (const line of parts) {
      writer.write(styleArticleLine(line));
    }
  };

  const onToolCall = (name: string, args: any) => {
    const label = TOOL_LABELS[name]?.(args) ?? `Calling ${name}...`;
    loader.animate(label);
  };

  let result: Awaited<ReturnType<typeof runFluxAgent>>;
  try {
    result = await runFluxAgent(query, writeChunk, onToolCall);
  } catch (e: any) {
    loader.fail('Request failed');
    if (e?.message) process.stdout.write(`  ${chalk.gray(e.message)}\n\n`);
    return;
  }

  // Agent returned nothing (off-topic / no entities / error from model)
  if (!startedStreaming && !result.text) {
    loader.stop();
    process.stdout.write(
      `${chalk.yellow('!')} ${chalk.white("That doesn't look like a financial query.")}\n` +
      `  ${chalk.gray('Try: "Analyze Apple growth" or "Compare TSLA vs NVDA" or "Latest news on Meta"')}\n\n`
    );
    return;
  }

  // If streaming didn't fire (model returned text synchronously), render it now
  if (!startedStreaming && result.text) {
    loader.stop();
    process.stdout.write('\n');
    renderAnalysisHeader();
    for (const line of result.text.split('\n')) {
      writer.write(styleArticleLine(line));
    }
  } else {
    // Flush any partial last line
    if (lineBuffer.length > 0) {
      writer.write(styleArticleLine(lineBuffer));
    }
  }

  await writer.end();
  renderDivider();
  process.stdout.write('\n');
}
