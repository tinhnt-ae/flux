import { getFinancials } from '../services/apiClient';
import { pctChange } from '../utils/growth';
import { prettyCurrency } from '../utils/formatter';
import { getLatestPrev, getField, parseNumberLike, extractQuarterLabel } from '../utils/data';
import chalk from 'chalk';

export async function run(ticker: string) {
  const data = await getFinancials(ticker);
  const { quarters, latest } = getLatestPrev(data);
  if (!quarters || quarters.length === 0) {
    console.log('Ticker not found');
    return;
  }

  const prev = (quarters && quarters.length > 1) ? quarters[1] : null;

  const rev = parseNumberLike(getField(latest, ['revenue', 'total_revenue', 'revenues', 'revenue_usd', 'totalRevenue'])) ?? null;
  const prevRev = parseNumberLike(getField(prev, ['revenue', 'total_revenue', 'revenues', 'revenue_usd', 'totalRevenue'])) ?? null;
  const ni = parseNumberLike(getField(latest, ['net_income', 'netIncome', 'net_earnings', 'netEarnings', 'net_income_usd'])) ?? null;
  const prevNi = parseNumberLike(getField(prev, ['net_income', 'netIncome', 'net_earnings', 'netEarnings', 'net_income_usd'])) ?? null;
  const fcf = parseNumberLike(getField(latest, ['free_cash_flow', 'freeCashFlow', 'fcf'])) ?? null;

  const revPct = pctChange(rev, prevRev);
  const niPct = pctChange(ni, prevNi);

  const qlabel = extractQuarterLabel(latest);

  // Two variants: compact and expanded
  const compact = `${ticker.toUpperCase()} ${qlabel}: Rev ${revPct === null ? 'N/A' : (revPct >= 0 ? '+' : '') + Math.round(revPct) + '%'} | NI ${niPct === null ? 'N/A' : (niPct >= 0 ? '+' : '') + Math.round(niPct) + '%'} | FCF ${prettyCurrency(fcf)}`;

  console.log(chalk.cyanBright(compact));
  console.log('\n' + chalk.gray('Copy-ready:') + '\n' + compact + '\n');
}
