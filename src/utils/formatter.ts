import { formatCurrency, formatNumber } from './format';

export function bar(value: number, max: number, width = 24): string {
  if (max <= 0 || value <= 0) return ''.padEnd(width, ' ');
  const filled = Math.round((value / max) * width);
  const bar = '█'.repeat(filled).padEnd(width, ' ');
  return bar;
}

export function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'N/A';
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

export function prettyCurrency(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return formatCurrency(n);
}

export function prettyNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return formatNumber(n);
}
