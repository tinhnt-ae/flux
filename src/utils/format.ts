export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n as number)) return '—';
  const num = Math.abs(Number(n));
  if (num >= 1e9) return `${(num / 1e9).toFixed(2).replace(/\.00$/, '')}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(2).replace(/\.00$/, '')}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(2).replace(/\.00$/, '')}K`;
  return num.toLocaleString();
}

export function formatCurrency(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n as number)) return '—';
  const sign = Number(n) < 0 ? '-' : '';
  return `${sign}$${formatNumber(n)}`;
}
