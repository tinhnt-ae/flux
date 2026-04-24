export function getField(obj: any, keys: string[]) {
  if (!obj) return undefined;
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  if (obj.values) for (const k of keys) if (obj.values[k] !== undefined) return obj.values[k];
  if (obj.metrics) for (const k of keys) if (obj.metrics[k] !== undefined) return obj.metrics[k];
  // As a fallback, search recursively for numeric-looking properties matching the given names
  // This helps with API shapes that nest numbers under unexpected keys.
  try {
    const found = findFirstNumericByNames(obj, keys);
    if (found !== undefined) return found;
  } catch (_) { }
  return undefined;
}

export function looksLikeQuarterArray(arr: any[]): boolean {
  if (!Array.isArray(arr) || arr.length === 0) return false;
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

export function findQuarterArray(obj: any, depth = 0): any[] | null {
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
    } catch (_) { }
  }
  return null;
}

export function findFirstNumericByNames(obj: any, names: string[], depth = 0): number | undefined {
  if (!obj || depth > 8) return undefined;
  if (typeof obj === 'number') return undefined;
  if (typeof obj !== 'object') return undefined;
  for (const k of Object.keys(obj)) {
    const low = k.toLowerCase();
    if (names.some(n => low.includes(n))) {
      const v = obj[k];
      if (typeof v === 'number') return v;
      if (typeof v === 'string' && !isNaN(Number(v))) return Number(v.replace(/[$,]/g, ''));
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

export function parseNumberLike(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object') {
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

export function extractQuarterLabel(q: any): string {
  if (!q) return 'Q?';
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

export function calendarQuarterLabel(q: any): string {
  if (!q) return 'Q?';
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

export function getLatestPrev(data: any) {
  const quarters = findQuarterArray(data) || (Array.isArray(data) ? data : []);
  const latest = (quarters && quarters.length > 0) ? quarters[0] : null;
  const prev = (quarters && quarters.length > 1) ? quarters[1] : null;
  return { quarters, latest, prev };
}
