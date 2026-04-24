import * as api from '../services/apiClient';
import * as format from '../utils/format';
import { pctChange } from '../utils/growth';
import store from '../config/store';
import chalk from 'chalk';
import ora from 'ora';
import Figlet from 'figlet';
import boxen from 'boxen';
import Table from 'cli-table3';

export async function run(ticker: string, options: { history?: boolean; json?: boolean } = {}) {
  const apiKey = store.get('apiKey');
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

    const company = data.company_name || data.name || data.metadata?.name || data.ticker?.name || ticker.toUpperCase();

    // Recursively search the response for an array that looks like quarters
    function looksLikeQuarterArray(arr: any[]): boolean {
      if (!Array.isArray(arr) || arr.length === 0) return false;
      // examine first few items
      const sample = arr.slice(0, 3);
      let score = 0;
      for (const item of sample) {
        if (!item || typeof item !== 'object') return false;
        const keys = Object.keys(item).map(k => k.toLowerCase());
        if (keys.includes('revenue') || keys.includes('total_revenue') || keys.includes('revenues') || keys.includes('revenue_usd')) score += 2;
        if (keys.includes('net_income') || keys.includes('netincome') || keys.includes('net_earnings')) score += 2;
        if (keys.includes('free_cash_flow') || keys.includes('fcf') || keys.includes('freecashflow')) score += 1;
        if (keys.includes('quarter') || keys.includes('period') || keys.includes('label') || keys.includes('date')) score += 1;
      }
      return score >= 2;
    }

    function findQuarterArray(obj: any, depth = 0): any[] | null {
      if (!obj || depth > 6) return null;
      if (Array.isArray(obj) && looksLikeQuarterArray(obj)) return obj;
      if (typeof obj !== 'object') return null;
      for (const k of Object.keys(obj)) {
        try {
          const child = obj[k];
          if (Array.isArray(child) && looksLikeQuarterArray(child)) return child;
          if (typeof child === 'object') {
            const found = findQuarterArray(child, depth + 1);
            if (found) return found;
          }
        } catch (_) {
          // ignore
        }
      }
      return null;
    }

    const quarters: any[] = findQuarterArray(data) || [];

    if (!quarters || quarters.length === 0) {
      console.log('Ticker not found');
      return;
    }

    const latest = quarters[0] || {};
    const prev = quarters[1] || {};

    function getField(q: any, keys: string[]) {
      if (!q) return undefined;
      for (const k of keys) {
        if (q[k] !== undefined && q[k] !== null) return q[k];
      }
      // try nested under values or metrics
      if (q.values) {
        for (const k of keys) if (q.values[k] !== undefined) return q.values[k];
      }
      if (q.metrics) {
        for (const k of keys) if (q.metrics[k] !== undefined) return q.metrics[k];
      }
      return undefined;
    }

    const revenue = getField(latest, ['revenue', 'total_revenue', 'revenues', 'revenue_usd', 'totalRevenue']);
    const netIncome = getField(latest, ['net_income', 'netIncome', 'net_earnings', 'netEarnings', 'net_income_usd']);
    const fcf = getField(latest, ['free_cash_flow', 'freeCashFlow', 'fcf']);

    // Fallback: search the whole response for first numeric matching keys
    function findFirstNumericByNames(obj: any, names: string[], depth = 0): number | undefined {
      if (!obj || depth > 8) return undefined;
      if (typeof obj === 'number') return undefined;
      if (typeof obj !== 'object') return undefined;
      for (const k of Object.keys(obj)) {
        const low = k.toLowerCase();
        if (names.some(n => low.includes(n))) {
          const v = obj[k];
          if (typeof v === 'number') return v;
          if (typeof v === 'string' && !isNaN(Number(v))) return Number(v);
        }
      }
      for (const k of Object.keys(obj)) {
        try {
          const found = findFirstNumericByNames(obj[k], names, depth + 1);
          if (found !== undefined) return found;
        } catch (_) { }
      }
      return undefined;
    }

    const fallbackRevenue = revenue ?? findFirstNumericByNames(data, ['revenue', 'total_revenue', 'revenues', 'revenue_usd', 'totalRevenue']);
    const fallbackNetIncome = netIncome ?? findFirstNumericByNames(data, ['net_income', 'netincome', 'net_earnings', 'netearnings']);
    const fallbackFcf = fcf ?? findFirstNumericByNames(data, ['free_cash_flow', 'fcf', 'freecashflow']);

    // Normalize possible numeric formats to raw number for growth calc
    function parseNumberLike(v: any): number | null {
      if (v === null || v === undefined) return null;
      if (typeof v === 'number') return v;
      if (typeof v === 'object') {
        // sometimes wrapped: { value: 123 }
        if (typeof v.value === 'number') return v.value;
        if (typeof v.amount === 'number') return v.amount;
        // try to find any numeric property
        for (const k of Object.keys(v)) {
          const nv = v[k];
          if (typeof nv === 'number') return nv;
          if (typeof nv === 'string' && nv.trim() !== '') {
            const parsed = parseNumberLike(nv);
            if (parsed !== null) return parsed;
          }
        }
        return null;
      }
      if (typeof v === 'string') {
        let s = v.trim();
        // remove currency
        s = s.replace(/[$,]/g, '');
        // handle parentheses for negative
        const isParens = /^\((.*)\)$/.exec(s);
        if (isParens) s = '-' + isParens[1];
        // suffixes
        const m = s.match(/^(-?[0-9,.]+)([kmbbKMB]*)$/);
        if (m) {
          let num = Number(m[1].replace(/,/g, ''));
          const suf = (m[2] || '').toUpperCase();
          if (suf === 'K') num *= 1e3;
          if (suf === 'M') num *= 1e6;
          if (suf === 'B') num *= 1e9;
          return isNaN(num) ? null : num;
        }
        const asNum = Number(s);
        return isNaN(asNum) ? null : asNum;
      }
      return null;
    }

    const revNum = parseNumberLike(revenue ?? fallbackRevenue);
    const prevRevNum = parseNumberLike(getField(prev, ['revenue', 'total_revenue', 'revenues', 'revenue_usd', 'totalRevenue']) ?? findFirstNumericByNames(prev || {}, ['revenue', 'total_revenue', 'revenues']));
    const niNum = parseNumberLike(netIncome ?? fallbackNetIncome);
    const prevNiNum = parseNumberLike(getField(prev, ['net_income', 'netIncome', 'net_earnings', 'netEarnings', 'net_income_usd']) ?? findFirstNumericByNames(prev || {}, ['net_income', 'netearnings']));

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

    function extractQuarterLabel(q: any): string {
      if (!q) return 'Q?';
      // common direct labels
      const candidates = [
        'label', 'period', 'period_label', 'periodLabel', 'quarter_label', 'quarterLabel', 'quarter', 'period_end', 'period_end_date', 'date', 'report_date', 'periodEnd', 'periodEndDate'
      ];
      for (const k of candidates) {
        const v = q[k];
        if (v && typeof v === 'string') {
          const s = v.trim();
          // formats: 'Q1 2026', '2026 Q1', '2026Q1', 'Q1-2026'
          const m = s.match(/(Q\d)\s*-?\s*(\d{4})/i) || s.match(/(\d{4})\s*-?\s*(Q\d)/i) || s.match(/(\d{4})Q(\d)/i);
          if (m) {
            if (/Q/i.test(m[1])) return `${m[1].toUpperCase()} ${m[2] ?? m[1]}`.replace(/\s+/g, ' ').trim();
          }
          // ISO date or yyyy-mm-dd
          const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
          if (iso) {
            const year = Number(iso[1]);
            const month = Number(iso[2]);
            const qn = Math.floor((month - 1) / 3) + 1;
            return `Q${qn} ${year}`;
          }
          // simple year only
          const yearOnly = s.match(/^(\d{4})$/);
          if (yearOnly) return `Q? ${yearOnly[1]}`;
          // if looks like '2026Q1'
          const compact = s.match(/^(\d{4})Q(\d)$/i);
          if (compact) return `Q${compact[2]} ${compact[1]}`;
          // otherwise return the string as-is if short
          if (s.length <= 20) return s;
        }
        // numeric year and quarter
        const vn = q['year'] || q['fy_year'] || q['fiscal_year'];
        const vq = q['quarter'] || q['fiscal_quarter'];
        if (vn && vq) return `Q${vq} ${vn}`;
      }
      // If q has a date-like object
      if (q.date || q.period_end || q.periodEnd) {
        const dstr = q.date || q.period_end || q.periodEnd;
        if (typeof dstr === 'string') {
          const iso = dstr.match(/(\d{4})-(\d{2})-(\d{2})/);
          if (iso) {
            const year = Number(iso[1]);
            const month = Number(iso[2]);
            const qn = Math.floor((month - 1) / 3) + 1;
            return `Q${qn} ${year}`;
          }
        }
      }
      return 'Q?';
    }

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
    table.push([chalk.green('Revenue'), chalk.white(format.formatCurrency(fallbackRevenue))]);
    table.push([chalk.green('Net Income'), chalk.white(format.formatCurrency(fallbackNetIncome))]);
    table.push([chalk.green('Free Cash Flow'), chalk.white(format.formatCurrency(fallbackFcf))]);

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
        const label = q.label || q.period || `${q.quarter || ''} ${q.year || ''}`.trim() || q.date || 'Q?';
        const rev = getField(q, ['revenue', 'total_revenue', 'revenues', 'revenue_usd', 'totalRevenue']);
        console.log(label.padEnd(12, ' ') + ' ' + format.formatCurrency(rev));
      }
    }

    // If everything is missing, print a short diagnostic to help map fields
    if ((!fallbackRevenue || fallbackRevenue === undefined) && (!fallbackNetIncome || fallbackNetIncome === undefined) && (!fallbackFcf || fallbackFcf === undefined)) {
      console.log('\n(No numeric financials found in standard locations.)\n');
      console.log('Top-level keys:');
      console.log(Object.keys(data).join(', '));
      console.log('\nRun with --json to inspect raw API output:');
      console.log('  node dist/index.js ' + ticker + ' --json');
    }

    console.log('\nPowered by FactStream API');
  } catch (e: any) {
    spinner.stop();
    if (e.code === 'NO_API_KEY') {
      console.log('No API key found.');
      console.log('Run: fin login YOUR_API_KEY');
      return;
    }
    if (e.status === 404) {
      console.log('Ticker not found');
      return;
    }
    if (e.status === 429) {
      console.log('Rate limit reached. Upgrade your plan.');
      return;
    }
    console.log('Failed to fetch data');
  }
}
