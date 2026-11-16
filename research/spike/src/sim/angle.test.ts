import { describe, expect, it, vi } from 'vitest';
import { angleDiff, datan2, dir, fractionOfTurn, HALF_TURN, QUARTER_TURN, TURN } from './angle.ts';

// These run whole scripted matches; under a parallel run they need more than vitest's 5 s.
vi.setConfig({ testTimeout: 120_000 });

// roslambo's angle.test.ts, copied, plus datan2 (PLAN D-2, §16 Steering).
describe('binary angles (D-2)', () => {
  it('dir() is within 1e-15 of Math.cos and Math.sin everywhere', () => {
    const d = new Float64Array(2);
    let worst = 0;
    for (let i = 0; i < 200_000; i++) {
      const a = Math.imul(i, 2654435761) >>> 0;
      dir(a, d);
      const th = (a / TURN) * 2 * Math.PI;
      worst = Math.max(worst, Math.abs(d[0]! - Math.cos(th)), Math.abs(d[1]! - Math.sin(th)));
    }
    expect(worst).toBeLessThan(1e-15);
  }, 120_000);

  it('is exact on the axes and continuous across octant boundaries', () => {
    const d = new Float64Array(2);
    // ±0 compare equal: a cosine of −0 is the same number, and deterministic.
    dir(0, d);
    expect(d[0] === 1 && d[1] === 0).toBe(true);
    dir(QUARTER_TURN, d);
    expect(d[0] === 0 && d[1] === 1).toBe(true);
    for (let oct = 1; oct < 8; oct++) {
      const b = oct * 536870912;
      const e = new Float64Array(2);
      dir(b - 1, d);
      dir(b, e);
      expect(Math.abs(d[0]! - e[0]!) + Math.abs(d[1]! - e[1]!)).toBeLessThan(1e-8);
    }
  });

  it('splits a turn into n equal binary angles', () => {
    expect(fractionOfTurn(0, 7)).toBe(0);
    expect(fractionOfTurn(1, 4)).toBe(QUARTER_TURN);
    expect(fractionOfTurn(1, 3)).toBe(Math.floor(TURN / 3));
    expect(fractionOfTurn(7, 7)).toBe(0); // a whole turn wraps
  });

  it('dir() of a half turn more is the exact negation (mirrored headings, P8)', () => {
    const d = new Float64Array(2);
    const e = new Float64Array(2);
    let bad = 0;
    for (let i = 0; i < 100_000; i++) {
      const a = Math.imul(i, 2246822519) >>> 0;
      dir(a, d);
      dir((a + HALF_TURN) >>> 0, e);
      if (!(e[0] === -d[0]! && e[1] === -d[1]!)) bad++;
    }
    expect(bad).toBe(0);
  }, 120_000);
});

/** datan2's error against Math.atan2, in binary-angle units, wrapped. */
function unitsOff(y: number, x: number): number {
  const ref = (Math.atan2(y, x) / (2 * Math.PI)) * TURN;
  let d = (datan2(y, x) - ref) % TURN;
  if (d >= TURN / 2) d -= TURN;
  if (d < -TURN / 2) d += TURN;
  return Math.abs(d);
}

/** A seeded generator of doubles over many magnitudes (no Math.random). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / TURN;
  };
}

describe('datan2 (D-2)', () => {
  it('matches Math.atan2 to within half a unit plus 1e-3, about 1.2e-10 of a turn', () => {
    const rnd = lcg(12345);
    let worst = 0;
    for (let i = 0; i < 400_000; i++) {
      const mag = Math.pow(10, Math.floor(rnd() * 12) - 6); // 1e-6 … 1e5
      const x = (rnd() * 2 - 1) * mag;
      const y = (rnd() * 2 - 1) * mag * (rnd() < 0.5 ? 1 : 1e-3 + rnd());
      worst = Math.max(worst, unitsOff(y, x));
    }
    // Rounding to a whole unit costs up to 0.5; the polynomial adds 1e-4.
    expect(worst).toBeLessThan(0.5 + 1e-3);
    expect(worst / TURN).toBeLessThan(1e-9); // PLAN D-2's "about 1e-9 of a turn"
    console.log(`[datan2] worst error ${worst.toFixed(6)} units = ${(worst / TURN).toExponential(3)} of a turn over 400,000 vectors`);
  }, 120_000);

  it('is within half a unit of Math.atan2 on a dense sweep of one octant', () => {
    let worst = 0;
    for (let i = 0; i <= 1_000_000; i++) worst = Math.max(worst, unitsOff(i / 1_000_000, 1));
    expect(worst).toBeLessThan(0.5 + 1e-3);
  }, 120_000);

  it('gives exact quarter turns on the axes, with Math.atan2 signed zeros', () => {
    expect(datan2(0, 1)).toBe(0);
    expect(datan2(1, 0)).toBe(QUARTER_TURN);
    expect(datan2(0, -1)).toBe(HALF_TURN);
    expect(datan2(-1, 0)).toBe(3 * QUARTER_TURN);
    expect(datan2(-0, 1)).toBe(0);
    expect(datan2(-0, -1)).toBe(HALF_TURN); // atan2(−0, −1) = −π
    expect(datan2(1, -0)).toBe(QUARTER_TURN);
    expect(datan2(-1, -0)).toBe(3 * QUARTER_TURN);
    // The origin follows atan2: +0, +π, −0, −π.
    expect(datan2(0, 0)).toBe(0);
    expect(datan2(0, -0)).toBe(HALF_TURN);
    expect(datan2(-0, 0)).toBe(0);
    expect(datan2(-0, -0)).toBe(HALF_TURN);
    for (const m of [1e-300, 5e-324, 1e-9, 0.25, 7, 1e9, 1e300]) {
      expect(datan2(0, m)).toBe(0);
      expect(datan2(m, 0)).toBe(QUARTER_TURN);
      expect(datan2(0, -m)).toBe(HALF_TURN);
      expect(datan2(-m, 0)).toBe(3 * QUARTER_TURN);
    }
  });

  it('gives exact eighth turns on the diagonals', () => {
    for (const m of [5e-324, 1e-12, 0.3, 1, 2, 1e12, 1e300]) {
      expect(datan2(m, m)).toBe(QUARTER_TURN / 2);
      expect(datan2(m, -m)).toBe((3 * QUARTER_TURN) / 2);
      expect(datan2(-m, -m)).toBe((5 * QUARTER_TURN) / 2);
      expect(datan2(-m, m)).toBe((7 * QUARTER_TURN) / 2);
    }
  });

  it('is point-symmetric exactly: datan2(−y, −x) === datan2(y, x) + 2^31', () => {
    const rnd = lcg(777);
    const bad: string[] = [];
    const check = (y: number, x: number): void => {
      if (datan2(-y, -x) !== ((datan2(y, x) + HALF_TURN) >>> 0) && bad.length < 5) bad.push(`(${y}, ${x})`);
    };
    for (let i = 0; i < 300_000; i++) {
      const mag = Math.pow(10, Math.floor(rnd() * 10) - 5);
      check((rnd() * 2 - 1) * mag, (rnd() * 2 - 1) * mag);
    }
    // The axes with signed zeros, and the diagonals.
    for (const z of [0, -0]) for (const w of [0, -0, 1, -1, 1e-300, -1e300]) {
      check(z, w);
      check(w, z);
    }
    for (const m of [1, -1, 1e-300, -1e300, 0.5, -3]) {
      check(m, m);
      check(m, -m);
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it('points dir() back along the vector', () => {
    const d = new Float64Array(2);
    const rnd = lcg(99);
    let worst = 0;
    for (let i = 0; i < 100_000; i++) {
      const x = rnd() * 2 - 1;
      const y = rnd() * 2 - 1;
      const len = Math.sqrt(x * x + y * y);
      dir(datan2(y, x), d);
      worst = Math.max(worst, Math.abs(d[0]! - x / len), Math.abs(d[1]! - y / len));
    }
    expect(worst).toBeLessThan(2e-9); // half a unit is 7.3e-10 rad
  });

  it('angleDiff is the signed shortest difference', () => {
    expect(angleDiff(0, QUARTER_TURN)).toBe(QUARTER_TURN);
    expect(angleDiff(QUARTER_TURN, 0)).toBe(-QUARTER_TURN);
    expect(angleDiff(TURN - 1, 1)).toBe(2);
    expect(angleDiff(1, TURN - 1)).toBe(-2);
    expect(angleDiff(0, HALF_TURN)).toBe(-HALF_TURN);
  });
});
