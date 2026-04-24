import chalk from 'chalk';
import Figlet from 'figlet';

const VERSION = 'v0.1.0';

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

export function renderHeader(): void {
  let artLines: string[] = [];
  let artWidth = 0;

  try {
    const raw = Figlet.textSync('FLUX', { font: 'Standard' });
    artLines = raw.split('\n');
    while (artLines.length > 0 && artLines[artLines.length - 1].trim() === '') artLines.pop();
    artWidth = artLines.reduce((m, l) => Math.max(m, l.length), 0);
  } catch {
    artLines = ['FLUX'];
    artWidth = 4;
  }

  const rightLines: string[] = [
    '',
    chalk.bold.white('Financial Intelligence CLI'),
    chalk.gray(VERSION),
  ];

  const tagline = chalk.gray('Powered by AI · stock analysis, financials, and live news');
  const taglineRaw = stripAnsi(tagline);

  const GAP = 6;
  const VPAD = 1;  // empty rows at top and bottom inside border
  const HPAD = 2;  // extra horizontal padding each side

  const rightWidth = rightLines.reduce((m, l) => Math.max(m, stripAnsi(l).length), 0);
  const bodyWidth = artWidth + GAP + rightWidth;
  const contentWidth = Math.max(bodyWidth, taglineRaw.length);
  const innerWidth = contentWidth + HPAD * 2;

  const B = chalk.hex('#00ff99');
  const bar = B('│');
  const top = B('┌' + '─'.repeat(innerWidth + 2) + '┐');
  const bottom = B('└' + '─'.repeat(innerWidth + 2) + '┘');

  // Renders one content row with HPAD on left, trailing spaces to fill, HPAD on right
  const row = (content: string, visibleLen: number): string => {
    const trailing = Math.max(0, innerWidth - HPAD - visibleLen);
    return `${bar} ${' '.repeat(HPAD)}${content}${' '.repeat(trailing)} ${bar}`;
  };
  const emptyRow = `${bar}${' '.repeat(innerWidth + 2)}${bar}`;

  const numLines = Math.max(artLines.length, rightLines.length);

  process.stdout.write('\n' + top + '\n');
  for (let p = 0; p < VPAD; p++) process.stdout.write(emptyRow + '\n');

  // Art (left) + right info side by side
  for (let i = 0; i < numLines; i++) {
    const artRaw = artLines[i] ?? '';
    const artPad = artRaw + ' '.repeat(Math.max(0, artWidth - artRaw.length));
    const right = rightLines[i] ?? '';
    const rightPad = right + ' '.repeat(Math.max(0, rightWidth - stripAnsi(right).length));
    const content = chalk.hex('#00ff99')(artPad) + ' '.repeat(GAP) + rightPad;
    process.stdout.write(row(content, bodyWidth) + '\n');
  }

  // Tagline on its own row, still inside the border
  process.stdout.write(emptyRow + '\n');
  process.stdout.write(row(tagline, taglineRaw.length) + '\n');
  for (let p = 0; p < VPAD; p++) process.stdout.write(emptyRow + '\n');

  process.stdout.write(bottom + '\n\n');
}

export function renderDivider(): void {
  const cols = process.stdout.columns || 80;
  process.stdout.write(chalk.gray('─'.repeat(Math.min(cols - 2, 60))) + '\n');
}

export function renderAnalysisHeader(): void {
  process.stdout.write(chalk.bold.hex('#7ad3ff')('◆ Analysis') + '\n\n');
}

