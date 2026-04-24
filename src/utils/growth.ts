export function pctChange(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current === null || current === undefined) return null;
  if (previous === null || previous === undefined) return null;
  const prev = Number(previous);
  if (prev === 0) return null;
  const change = ((Number(current) - prev) / Math.abs(prev)) * 100;
  return change;
}
