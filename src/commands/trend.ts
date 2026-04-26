import { getFinancials } from '../services/apiClient';
import { bar, prettyCurrency } from '../utils/formatter';
import chalk from 'chalk';
import { getLatestPrev, getField, parseNumberLike, getCompanyName, readDisplayLabel } from '../utils/data';

export async function run(ticker: string) {
  const data = await getFinancials(ticker);
  const company = getCompanyName(data, ticker);
  const { quarters } = getLatestPrev(data);
  if (!quarters || quarters.length === 0) {
    console.log('Ticker not found');
    return;
  }

  const slice = quarters.slice(0, 4);
  const revenues = slice.map((q) => parseNumberLike(getField(q, ['revenue', 'total_revenue', 'revenues', 'revenue_usd', 'totalRevenue'])) ?? null);
  const numericRevs = revenues.filter((r): r is number => r !== null);
  const max = numericRevs.length > 0 ? Math.max(...numericRevs) : 1;

  console.log(chalk.cyan(`${ticker.toUpperCase()} — ${company}\n`));
  console.log('Revenue (last 4 quarters):\n');
  for (let i = 0; i < slice.length; i++) {
    const q = slice[i];
    const label = readDisplayLabel(q);
    const rev = revenues[i];
    const barStr = rev === null ? ''.padEnd(24, ' ') : chalk.green(bar(rev as number, max, 24));
    const line = `${label.padEnd(10, ' ')} ${barStr} ${prettyCurrency(rev)}`;
    console.log(line);
  }
}
