export function growthLabel(pct: number | null): string {
  if (pct === null) return 'NO DATA';
  const abs = Math.abs(pct);
  if (abs >= 50) return 'VERY STRONG';
  if (abs >= 30) return 'STRONG';
  if (abs >= 10) return 'MODERATE';
  if (abs >= 0) return 'WEAK';
  return 'NO DATA';
}

export function fcStatus(amount: number | null): string {
  if (amount === null) return 'NO DATA';
  if (amount <= 0) return 'NEGATIVE';
  if (amount >= 1e10) return 'VERY HIGH';
  if (amount >= 1e9) return 'HIGH';
  return 'POSITIVE';
}
