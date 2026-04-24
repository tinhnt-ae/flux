import { getFinancials } from '../services/apiClient';
import { bar, prettyCurrency } from '../utils/formatter';
import chalk from 'chalk';
import { getLatestPrev, getField, parseNumberLike, extractQuarterLabel } from '../utils/data';

export async function run(ticker: string) {
  const data = await getFinancials(ticker);
  const company = data.company_name || data.name || ticker.toUpperCase();
  const { quarters } = getLatestPrev(data);
  if (!quarters || quarters.length === 0) {
    console.log('Ticker not found');
    return;
  }

  const slice = quarters.slice(0, 4);
  const revenues = slice.map((q: any) => parseNumberLike(getField(q, ['revenue', 'total_revenue', 'revenues', 'revenue_usd', 'totalRevenue'])) ?? null);
  const numericRevs = revenues.filter((r: any) => r !== null) as number[];
  const max = numericRevs.length > 0 ? Math.max(...numericRevs) : 1;

  console.log(chalk.cyan(`${ticker.toUpperCase()} — ${company}\n`));
  console.log('Revenue (last 4 quarters):\n');
  for (let i = 0; i < slice.length; i++) {
    const q = slice[i];
    const label = q.label || q.period || `${q.quarter || ''} ${q.year || ''}`.trim() || q.date || 'Q?';
    const rev = revenues[i];
    const barStr = rev === null ? ''.padEnd(24, ' ') : chalk.green(bar(rev as number, max, 24));
    const line = `${label.padEnd(10, ' ')} ${barStr} ${prettyCurrency(rev)}`;
    console.log(line);
  }
}
