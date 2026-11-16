// The frame-time verdict, as roslambo's src/frames.ts computes it (the
// criteria L286 copies): the interval between animation frames at p95 <= 18
// ms and max <= 50 ms, with the display at 60 Hz. Quantiles are taken as
// roslambo's are, the element at floor(n * q) of the sorted intervals.

export const P95_MS = 18;
export const MAX_MS = 50;

export interface Spread {
  mean: number;
  p95: number;
  max: number;
}

export interface Intervals {
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export function quantile(sorted: readonly number[], q: number): number {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]! : 0;
}

export function spread(xs: readonly number[]): Spread {
  const s = [...xs].sort((a, b) => a - b);
  return { mean: s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0, p95: quantile(s, 0.95), max: s.length ? s[s.length - 1]! : 0 };
}

export function intervals(xs: readonly number[]): Intervals {
  const s = [...xs].sort((a, b) => a - b);
  return { p50: quantile(s, 0.5), p95: quantile(s, 0.95), p99: quantile(s, 0.99), max: s[s.length - 1] ?? 0 };
}

export function passes(i: Intervals, frames: number): boolean {
  return frames > 0 && i.p95 <= P95_MS && i.max <= MAX_MS;
}
