import { getFinancials } from '../services/apiClient';
import { pctChange } from '../utils/growth';
import { growthLabel, fcStatus } from '../utils/scorer';
import { prettyCurrency, pct } from '../utils/formatter';
import { getCompanyName, getLatestPrev, parseNumberLike, getField, extractQuarterLabel } from '../utils/data';
import chalk from 'chalk';
import Table from 'cli-table3';
import boxen from 'boxen';

export async function run(ticker: string) {
  const data = await getFinancials(ticker);
  const company = getCompanyName(data, ticker);
  const { quarters, latest, prev } = getLatestPrev(data);
  if (!quarters || quarters.length < 1 || !latest) {
    console.log('Ticker not found or no quarter data');
    return;
  }
  const rev = parseNumberLike(getField(latest, ['revenue', 'total_revenue', 'revenues', 'revenue_usd', 'totalRevenue'])) ?? null;
  const prevRev = parseNumberLike(getField(prev, ['revenue', 'total_revenue', 'revenues', 'revenue_usd', 'totalRevenue'])) ?? null;
  const ni = parseNumberLike(getField(latest, ['net_income', 'netIncome', 'net_earnings', 'netEarnings', 'net_income_usd'])) ?? null;
  const prevNi = parseNumberLike(getField(prev, ['net_income', 'netIncome', 'net_earnings', 'netEarnings', 'net_income_usd'])) ?? null;
  const fcf = parseNumberLike(getField(latest, ['free_cash_flow', 'freeCashFlow', 'fcf'])) ?? null;

  const revPct = pctChange(rev, prevRev);
  const niPct = pctChange(ni, prevNi);

  const qlabel = extractQuarterLabel(latest);

  const header = `${ticker.toUpperCase()} — ${company} · ${qlabel}`;
  console.log(boxen(chalk.bold.white(header), { padding: 1, borderColor: 'green', align: 'center' }));

  const summary = new Table({ head: [chalk.green('Metric'), chalk.green('Value'), chalk.green('QoQ')], colWidths: [24, 18, 12] });
  summary.push([
    'Revenue',
    prettyCurrency(rev),
    revPct === null ? 'N/A' : (revPct >= 0 ? chalk.hex('#00ff99')(pct(revPct)) : chalk.red(pct(revPct)))
  ]);
  summary.push([
    'Net income',
    prettyCurrency(ni),
    niPct === null ? 'N/A' : (niPct >= 0 ? chalk.hex('#00ff99')(pct(niPct)) : chalk.red(pct(niPct)))
  ]);
  summary.push(['Free cash flow', prettyCurrency(fcf), fcStatus(fcf)]);

  console.log(summary.toString());

  console.log(chalk.bold('\nInterpretation'));
  if ((revPct ?? 0) >= 30 && (niPct ?? 0) >= 30) {
    console.log(chalk.green('• Strong short-term growth with expanding profitability.'));
  } else if ((revPct ?? 0) >= 10) {
    console.log(chalk.yellow('• Moderate growth — monitor next quarters.'));
  } else if (revPct === null && niPct === null) {
    console.log(chalk.gray('• Insufficient data to provide an interpretation.'));
  } else {
    console.log(chalk.red('• Growth is weak or flat; investigate drivers.'));
  }

  console.log(chalk.bold('\nWatch'));
  console.log('• Growth spikes may be seasonal');
  if (fcf === null) console.log('• Free cash flow data missing — check cash flow statement');
}
