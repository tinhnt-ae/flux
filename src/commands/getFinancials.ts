import * as api from '../services/apiClient';
import * as format from '../utils/format';
import { pctChange } from '../utils/growth';
import { getApiKey } from '../utils/config';
import {
  extractMetricValue,
  extractQuarterLabel,
  findFirstNumericByNames,
  getCompanyName,
  getField,
  getLatestPrev,
  objectKeys,
  parseNumberLike,
  readDisplayLabel
} from '../utils/data';
import { hasCommandErrorCode } from '../utils/errors';
import chalk from 'chalk';
import ora from 'ora';
import Figlet from 'figlet';
import boxen from 'boxen';
import Table from 'cli-table3';
import type { QuoteOptions } from '../types/domain';

export async function run(ticker: string, options: QuoteOptions = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.log('No API key found.');
    console.log('Run: fin login YOUR_API_KEY');
    return;
  }

  const spinner = ora('Fetching financials...').start();
  try {
    const data = await api.getFinancials(ticker);
    spinner.stop();

    if (options.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const company = getCompanyName(data, ticker);
    const { quarters, latest, prev } = getLatestPrev(data);

    if (!quarters || quarters.length === 0) {
      console.log('Ticker not found');
      return;
    }

    const revenue = getField(latest, ['revenue', 'total_revenue', 'revenues', 'revenue_usd', 'totalRevenue']);
    const netIncome = getField(latest, ['net_income', 'netIncome', 'net_earnings', 'netEarnings', 'net_income_usd']);
    const fcf = getField(latest, ['free_cash_flow', 'freeCashFlow', 'fcf']);

    const fallbackRevenue = revenue ?? findFirstNumericByNames(data, ['revenue', 'total_revenue', 'revenues', 'revenue_usd', 'totalRevenue']);
    const fallbackNetIncome = netIncome ?? findFirstNumericByNames(data, ['net_income', 'netincome', 'net_earnings', 'netearnings']);
    const fallbackFcf = fcf ?? findFirstNumericByNames(data, ['free_cash_flow', 'fcf', 'freecashflow']);

    const revNum = parseNumberLike(revenue ?? fallbackRevenue);
    const prevRevNum = parseNumberLike(extractMetricValue(prev, prev, ['revenue', 'total_revenue', 'revenues', 'revenue_usd', 'totalRevenue']));
    const niNum = parseNumberLike(netIncome ?? fallbackNetIncome);
    const prevNiNum = parseNumberLike(extractMetricValue(prev, prev, ['net_income', 'netIncome', 'net_earnings', 'netEarnings', 'net_income_usd', 'netearnings']));

    // Fancy header inspired by the screenshot: big ASCII banner + welcome box
    try {
      // Use an ANSI Shadow style figlet to mimic the Dexter heading
      const fontName = 'ANSI Shadow';
      const artMain = Figlet.textSync('FLUX', { horizontalLayout: 'default', font: fontName });
      // Print main art in a retro 'screen' green and adjust shadow
      console.log(chalk.hex('#00ff99').bold(artMain));

      // Some figlet fonts (like ANSI Shadow) already include a shadowed look.
      // Only print an extra dim shadow when the font does NOT already include 'shadow'.
      if (!/shadow/i.test(fontName)) {
        const shadow = artMain
          .split('\n')
          .map(line => ' ' + line)
          .join('\n');
        console.log(chalk.hex('#006400').dim(shadow));
      }
    } catch (_) { }

    const pkg = require('../../package.json');
    const welcome = `Welcome to FLUX v${pkg.version}`;
    console.log(chalk.green(boxen(welcome, { padding: { top: 0, bottom: 0, left: 1, right: 1 }, borderStyle: 'single', borderColor: 'green', align: 'center' })));
    console.log(chalk.green('\nYour AI assistant for deep financial research.'));
    console.log(chalk.gray('Model: Opus 4.6\n'));

    console.log(`${ticker.toUpperCase()} — ${company}\n`);

    const quarterLabel = extractQuarterLabel(latest);

    // Print a small table summary
    // Larger green table with margins
    const table = new Table({
      head: [chalk.green('Metric'), chalk.green('Value')],
      style: { head: [], border: [] },
      colWidths: [26, 34],
      wordWrap: true
    });

    table.push([chalk.green('Quarter'), chalk.white(quarterLabel)]);
    table.push([chalk.green('Revenue'), chalk.white(format.formatCurrency(parseNumberLike(fallbackRevenue)))]);
    table.push([chalk.green('Net Income'), chalk.white(format.formatCurrency(parseNumberLike(fallbackNetIncome)))]);
    table.push([chalk.green('Free Cash Flow'), chalk.white(format.formatCurrency(parseNumberLike(fallbackFcf)))]);

    // Print with extra margins and green color for border
    const tableStr = table.toString().split('\n').map(line => '  ' + line).join('\n');
    console.log(chalk.green(tableStr));

    console.log('\nQoQ Growth:');
    const revChange = pctChange(revNum, prevRevNum);
    const niChange = pctChange(niNum, prevNiNum);

    function colorPct(p: number | null) {
      if (p === null) return 'N/A';
      const s = `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
      return p >= 0 ? chalk.hex('#00ff99')(s) : chalk.red(s);
    }

    const growthTable = new Table({ head: ['', 'QoQ'], style: { head: ['magenta'] }, colWidths: [20, 20] });
    growthTable.push(['Revenue', colorPct(revChange)]);
    growthTable.push(['Net Income', colorPct(niChange)]);
    console.log(growthTable.toString());

    if (options.history) {
      console.log('\nRevenue (last 4 quarters):\n');
      const slice = quarters.slice(0, 4);
      for (const q of slice) {
        const label = readDisplayLabel(q);
        const rev = getField(q, ['revenue', 'total_revenue', 'revenues', 'revenue_usd', 'totalRevenue']);
        console.log(label.padEnd(12, ' ') + ' ' + format.formatCurrency(parseNumberLike(rev)));
      }
    }

    // If everything is missing, print a short diagnostic to help map fields
    if ((!fallbackRevenue || fallbackRevenue === undefined) && (!fallbackNetIncome || fallbackNetIncome === undefined) && (!fallbackFcf || fallbackFcf === undefined)) {
      console.log('\n(No numeric financials found in standard locations.)\n');
      console.log('Top-level keys:');
      console.log(objectKeys(data).join(', '));
      console.log('\nRun with --json to inspect raw API output:');
      console.log('  node dist/index.js ' + ticker + ' --json');
    }

    console.log('\nPowered by FactStream API');
  } catch (e: unknown) {
    spinner.stop();
    if (hasCommandErrorCode(e, 'NO_API_KEY')) {
      console.log('No API key found.');
      console.log('Run: fin login YOUR_API_KEY');
      return;
    }
    if (e instanceof Error && 'status' in e && e.status === 404) {
      console.log('Ticker not found');
      return;
    }
    if (e instanceof Error && 'status' in e && e.status === 429) {
      console.log('Rate limit reached. Upgrade your plan.');
      return;
    }
    console.log('Failed to fetch data');
  }
}
