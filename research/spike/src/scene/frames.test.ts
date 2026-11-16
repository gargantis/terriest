import { describe, expect, it } from 'vitest';
import { MAX_MS, P95_MS, intervals, passes, quantile, spread } from './frames';

describe("the frame-time verdict (roslambo's src/frames.ts)", () => {
  it("takes quantiles as roslambo's: the element at floor(n * q)", () => {
    const xs = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(quantile(xs, 0.5)).toBe(11);
    expect(quantile(xs, 0.95)).toBe(20);
    expect(quantile([], 0.95)).toBe(0);
  });

  it('passes at p95 <= 18 ms and max <= 50 ms, and fails just past either', () => {
    expect([P95_MS, MAX_MS]).toEqual([18, 50]);
    const steady = Array.from({ length: 100 }, () => 16.7);
    expect(passes(intervals(steady), steady.length)).toBe(true);
    expect(passes(intervals([...steady.slice(1), 50]), 100)).toBe(true);
    expect(passes(intervals([...steady.slice(1), 50.1]), 100)).toBe(false);
    const slow = [...steady.slice(0, 94), ...Array.from({ length: 6 }, () => 18.1)];
    expect(intervals(slow).p95).toBe(18.1);
    expect(passes(intervals(slow), 100)).toBe(false);
    expect(passes(intervals([]), 0)).toBe(false);
  });

  it('summarises work as mean, p95 and max', () => {
    expect(spread([1, 2, 3, 4])).toEqual({ mean: 2.5, p95: 4, max: 4 });
  });
});
