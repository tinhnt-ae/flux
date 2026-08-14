import { getFinancials } from '../services/apiClient';
import { prettyCurrency, prettyNumber } from '../utils/formatter';
import { asRecord, getCompanyName, getLatestPrev, parseNumberLike, getField, extractQuarterLabel, calendarQuarterLabel } from '../utils/data';
import chalk from 'chalk';
import Table from 'cli-table3';
import boxen from 'boxen';
import type { CompareOptions, FinancialStatement } from '../types/domain';

function netMargin(latest: FinancialStatement | null) {
  const rev = parseNumberLike(getField(latest, ['revenue', 'total_revenue', 'revenues', 'revenue_usd', 'totalRevenue'])) ?? null;
  const ni = parseNumberLike(getField(latest, ['net_income', 'netIncome', 'net_earnings', 'netEarnings', 'net_income_usd'])) ?? null;
  if (rev === null || ni === null) return null;
  return (Number(ni) / Number(rev)) * 100;
}

export async function run(tickers: string[], options: CompareOptions = { period: 'quarter' }) {
  if (!Array.isArray(tickers) || tickers.length < 2) {
    console.log('Please provide two or more tickers to compare, e.g. `flux compare AAPL MSFT NVDA`.');
    return;
  }

  // Fetch all tickers in parallel
  const datas = await Promise.all(tickers.map(t => getFinancials(t)));

  // Map to objects with computed metrics
  const rows = datas.map((d, idx) => {
    const t = (tickers[idx] || '').toUpperCase();
    const name = getCompanyName(d, t);
    // determine period entries based on requested period type
    const quarters = getLatestPrev(d).quarters || [];
    const periodType = (options.period || 'quarter').toLowerCase();
    let label = '';
    let chosenEntry: FinancialStatement | null = null;
    if (periodType === 'annual') {
      // choose an annual-like entry (period === 'year' or fiscal_year with no quarter)
      for (const q of quarters) {
        const record = asRecord(q);
        const p = String(record?.period || '').toLowerCase();
        if (p.includes('year') || (record?.fiscal_year && !record.quarter)) {
          chosenEntry = q; break;
        }
      }
    }
    // default: use latest quarterly entries
    if (!chosenEntry) chosenEntry = quarters[0] || null;
    label = extractQuarterLabel(chosenEntry);
    const rev = chosenEntry ? parseNumberLike(getField(chosenEntry, ['revenue', 'total_revenue', 'revenues', 'revenue_usd', 'totalRevenue'])) ?? null : null;
    const nm = chosenEntry ? netMargin(chosenEntry) : null;
    return { ticker: t, name, label, rev, nm };
  });

  // If comparing quarterly and we want the same quarter across tickers, try to choose the most common label present in each series
  if ((options.period || 'quarter').toLowerCase() === 'quarter') {
    const useCalendar = (options.align || 'fiscal').toLowerCase() === 'calendar';
    // collect label sets per ticker (calendar or fiscal)
    const labelSets = datas.map(d => (getLatestPrev(d).quarters || []).map((q) => useCalendar ? calendarQuarterLabel(q) : extractQuarterLabel(q)));
    const common = labelSets.reduce((acc: string[] | null, set) => {
      if (acc === null) return [...set];
      return acc.filter(x => set.includes(x));
    }, null as string[] | null) || [];
    if (common.length > 0) {
      const targetLabel = common[0]; // most recent common label
      // re-map rows to use the entry with targetLabel when available
      rows.forEach((r, i) => {
        const quarters = getLatestPrev(datas[i]).quarters || [];
        const found = quarters.find((q) => (useCalendar ? calendarQuarterLabel(q) : extractQuarterLabel(q)) === targetLabel);
        if (found) {
          r.label = targetLabel;
          r.rev = parseNumberLike(getField(found, ['revenue', 'total_revenue', 'revenues', 'revenue_usd', 'totalRevenue'])) ?? null;
          r.nm = netMargin(found);
        }
      });
    } else {
      console.log('No common quarter found across tickers; using each latest available period.');
    }
  }

  // Header
  const header = tickers.map(t => t.toUpperCase() + (rows.find(r => r.ticker === t.toUpperCase())?.label ? ` (${rows.find(r => r.ticker === t.toUpperCase())?.label})` : '')).join('  vs  ');
  console.log(boxen(chalk.bold.white(header), { padding: 1, borderColor: 'cyan' }));

  // Build table
  const head = [chalk.green('Metric'), ...rows.map(r => chalk.green(r.ticker)), chalk.green('Top')];
  const table = new Table({ head, colWidths: [18, ...rows.map(() => 16), 14] });

  // Revenue row
  const revValues = rows.map(r => r.rev);
  const maxRev = revValues.filter(v => v !== null).length > 0 ? Math.max(...(revValues.filter(v => v !== null) as number[])) : null;
  const revTop = maxRev === null ? 'N/A' : rows.filter(r => r.rev === maxRev).map(r => r.ticker).join(', ');
  table.push(['Revenue', ...rows.map(r => prettyCurrency(r.rev)), revTop]);

  // Net margin row
  const nmValues = rows.map(r => r.nm);
  const maxNm = nmValues.filter(v => v !== null).length > 0 ? Math.max(...(nmValues.filter(v => v !== null) as number[])) : null;
  const nmTop = maxNm === null ? 'N/A' : rows.filter(r => r.nm === maxNm).map(r => r.ticker).join(', ');
  table.push(['Net margin', ...rows.map(r => (r.nm === null ? 'N/A' : prettyNumber(r.nm) + '%')), nmTop]);

  console.log(table.toString());

  // Rankings
  const revRank = rows.slice().filter(r => r.rev !== null).sort((a, b) => (b.rev as number) - (a.rev as number));
  const nmRank = rows.slice().filter(r => r.nm !== null).sort((a, b) => (b.nm as number) - (a.nm as number));

  if (revRank.length > 0) {
    console.log(chalk.bold('\nRevenue ranking:'));
    revRank.forEach((r, i) => console.log(`${i + 1}. ${r.ticker} — ${prettyCurrency(r.rev)}`));
  }

  if (nmRank.length > 0) {
    console.log(chalk.bold('\nProfitability ranking:'));
    nmRank.forEach((r, i) => console.log(`${i + 1}. ${r.ticker} — ${prettyNumber(r.nm)}%`));
  }
}
