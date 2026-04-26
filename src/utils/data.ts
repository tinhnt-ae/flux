import type { FinancialStatement } from '../types/domain';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getRecordField(obj: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = obj[key];
  return isRecord(value) ? value : undefined;
}

export function getField(obj: unknown, keys: string[]): unknown {
  if (!isRecord(obj)) return undefined;
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  const values = getRecordField(obj, 'values');
  if (values) for (const k of keys) if (values[k] !== undefined) return values[k];
  const metrics = getRecordField(obj, 'metrics');
  if (metrics) for (const k of keys) if (metrics[k] !== undefined) return metrics[k];
  // As a fallback, search recursively for numeric-looking properties matching the given names.
  // This helps with API shapes that nest numbers under unexpected keys.
  try {
    const found = findFirstNumericByNames(obj, keys);
    if (found !== undefined) return found;
  } catch (_) { }
  return undefined;
}

export function getStringField(obj: unknown, keys: string[]): string | undefined {
  if (!isRecord(obj)) return undefined;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export function getCompanyName(data: unknown, fallbackTicker: string): string {
  const direct = getStringField(data, ['company_name', 'name']);
  if (direct) return direct;
  if (isRecord(data)) {
    const metadata = getStringField(data.metadata, ['name']);
    if (metadata) return metadata;
    const ticker = getStringField(data.ticker, ['name']);
    if (ticker) return ticker;
  }
  return fallbackTicker.toUpperCase();
}

export function getFieldLegacy(obj: unknown, keys: string[]): unknown {
  if (!obj) return undefined;
  return getField(obj, keys);
}

export function looksLikeQuarterArray(arr: unknown[]): boolean {
  if (!Array.isArray(arr) || arr.length === 0) return false;
  const sample = arr.slice(0, 3);
  let score = 0;
  for (const item of sample) {
    if (!isRecord(item)) return false;
    const keys = Object.keys(item).map(k => k.toLowerCase());
    if (keys.includes('revenue') || keys.includes('total_revenue') || keys.includes('revenues') || keys.includes('revenue_usd')) score += 2;
    if (keys.includes('net_income') || keys.includes('netincome') || keys.includes('net_earnings')) score += 2;
    if (keys.includes('free_cash_flow') || keys.includes('fcf') || keys.includes('freecashflow')) score += 1;
    if (keys.includes('quarter') || keys.includes('period') || keys.includes('label') || keys.includes('date')) score += 1;
  }
  return score >= 2;
}

export function findQuarterArray(obj: unknown, depth = 0): FinancialStatement[] | null {
  if (!obj || depth > 6) return null;
  if (Array.isArray(obj) && looksLikeQuarterArray(obj)) return obj.filter(isRecord);
  if (!isRecord(obj)) return null;
  for (const k of Object.keys(obj)) {
    try {
      const child = obj[k];
      if (Array.isArray(child) && looksLikeQuarterArray(child)) return child;
      if (isRecord(child) || Array.isArray(child)) {
        const found = findQuarterArray(child, depth + 1);
        if (found) return found;
      }
    } catch (_) { }
  }
  return null;
}

export function findFirstNumericByNames(obj: unknown, names: string[], depth = 0): number | undefined {
  if (!obj || depth > 8) return undefined;
  if (typeof obj === 'number') return undefined;
  if (!isRecord(obj)) return undefined;
  for (const k of Object.keys(obj)) {
    const low = k.toLowerCase();
    if (names.some(n => low.includes(n))) {
      const v = obj[k];
      if (typeof v === 'number') return v;
      const parsed = parseNumberLike(v);
      if (parsed !== null) return parsed;
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

export function parseNumberLike(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (isRecord(v)) {
    if (typeof v.value === 'number') return v.value;
    if (typeof v.amount === 'number') return v.amount;
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
    s = s.replace(/[$,]/g, '');
    const isParens = /^\((.*)\)$/.exec(s);
    if (isParens) s = '-' + isParens[1];
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

export function extractQuarterLabel(q: unknown): string {
  if (!q) return 'Q?';
  if (!isRecord(q)) return 'Q?';
  const candidates = [
    'label', 'period', 'period_label', 'periodLabel', 'quarter_label', 'quarterLabel', 'quarter', 'period_end', 'period_end_date', 'end_date', 'endDate', 'date', 'report_date', 'report_period', 'periodEnd', 'periodEndDate'
  ];
  for (const k of candidates) {
    const v = q[k];
    if (v && typeof v === 'string') {
      const s = v.trim();
      const m = s.match(/(Q\d)\s*-?\s*(\d{4})/i) || s.match(/(\d{4})\s*-?\s*(Q\d)/i) || s.match(/(\d{4})Q(\d)/i);
      if (m) {
        if (/Q/i.test(m[1])) return `${m[1].toUpperCase()} ${m[2] ?? m[1]}`.replace(/\s+/g, ' ').trim();
      }
      const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (iso) {
        const year = Number(iso[1]);
        const month = Number(iso[2]);
        const qn = Math.floor((month - 1) / 3) + 1;
        return `Q${qn} ${year}`;
      }
      const yearOnly = s.match(/^(\d{4})$/);
      if (yearOnly) return `Q? ${yearOnly[1]}`;
      const compact = s.match(/^(\d{4})Q(\d)$/i);
      if (compact) return `Q${compact[2]} ${compact[1]}`;
      if (s.length <= 20) return s;
    }
    const vn = q['year'] || q['fy_year'] || q['fiscal_year'];
    const vq = q['quarter'] || q['fiscal_quarter'];
    if (vn && vq) return `Q${vq} ${vn}`;
  }
  if (q.date || q.period_end || q.periodEnd) {
    const dstr = q.date || q.period_end || q.periodEnd || q.end_date || q.endDate || q.report_period;
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

export function calendarQuarterLabel(q: unknown): string {
  if (!q) return 'Q?';
  if (!isRecord(q)) return 'Q?';
  const dateKeys = ['end_date', 'endDate', 'report_period', 'reportPeriod', 'date', 'period_end', 'periodEnd'];
  for (const k of dateKeys) {
    const v = q[k];
    if (v && typeof v === 'string') {
      const iso = v.match(/(\d{4})-(\d{2})-(\d{2})/);
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

export function getLatestPrev(data: unknown): {
  quarters: FinancialStatement[];
  latest: FinancialStatement | null;
  prev: FinancialStatement | null;
} {
  const quarters = findQuarterArray(data) || (Array.isArray(data) ? data : []);
  const statementQuarters = quarters.filter(isRecord);
  const latest = statementQuarters.length > 0 ? statementQuarters[0] : null;
  const prev = statementQuarters.length > 1 ? statementQuarters[1] : null;
  return { quarters: statementQuarters, latest, prev };
}

export function extractMetricValue(data: unknown, statement: unknown, keys: string[]): unknown {
  return getField(statement, keys) ?? findFirstNumericByNames(data, keys);
}

export function objectKeys(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value) : [];
}

export function readDisplayLabel(q: unknown): string {
  if (!isRecord(q)) return 'Q?';
  const label = q.label || q.period || `${q.quarter || ''} ${q.year || ''}`.trim() || q.date;
  return typeof label === 'string' && label.trim() ? label : 'Q?';
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function getLatestPrevLegacy(data: unknown) {
  const { quarters, latest, prev } = getLatestPrev(data);
  return { quarters, latest, prev };
}
