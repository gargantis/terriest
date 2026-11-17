// Binary angles and exact trigonometry (PLAN D-1, D-2), and roslambo's
// integer mixer for seeded scripts and bot noise (D-39). The M0 spike's
// research/spike/src/sim/angle.ts, ported unchanged: dir() and
// fractionOfTurn() are roslambo's src/core/sim/angle.ts, within 7e-16 of
// Math.cos and Math.sin and identical in V8, SpiderMonkey and
// JavaScriptCore; datan2() is M0's. mix() is the spike's scripts.ts mixer,
// itself roslambo's (design §1.1).
// Only + − × ÷ %, comparisons, bit operations and Math.sqrt / abs / min /
// max / floor / round / trunc / imul appear here: IEEE 754 rounds each of
// them exactly, so every engine computes the same bits.

/** Binary angles: 2^32 units a turn. */
export const TURN = 4294967296; // not a setting: 2^32 binary-angle units a turn
export const HALF_TURN = 2147483648; // not a setting
export const QUARTER_TURN = 1073741824; // not a setting

const OCTANT = 536870912; // not a setting: 2^29 units, one eighth of a turn
// π/4 over 2^29: radians a unit. Dividing by a power of two is exact.
const RAD_PER_UNIT = 0.7853981633974483 / OCTANT; // not a setting

// Taylor coefficients, each one exact division at load. Each is marked for
// the configuration scan (src/config.test.ts): C2 is −0.5.
const S3 = -1 / 6; // not a setting
const S5 = 1 / 120; // not a setting
const S7 = -1 / 5040; // not a setting
const S9 = 1 / 362880; // not a setting
const S11 = -1 / 39916800; // not a setting
const S13 = 1 / 6227020800; // not a setting
const S15 = -1 / 1307674368000; // not a setting
const C2 = -1 / 2; // not a setting
const C4 = 1 / 24; // not a setting
const C6 = -1 / 720; // not a setting
const C8 = 1 / 40320; // not a setting
const C10 = -1 / 3628800; // not a setting
const C12 = 1 / 479001600; // not a setting
const C14 = -1 / 87178291200; // not a setting
const C16 = 1 / 20922789888000; // not a setting

function sinPoly(x: number): number {
  const x2 = x * x;
  return x * (1 + x2 * (S3 + x2 * (S5 + x2 * (S7 + x2 * (S9 + x2 * (S11 + x2 * (S13 + x2 * S15)))))));
}

function cosPoly(x: number): number {
  const x2 = x * x;
  return 1 + x2 * (C2 + x2 * (C4 + x2 * (C6 + x2 * (C8 + x2 * (C10 + x2 * (C12 + x2 * (C14 + x2 * C16)))))));
}

/** Writes the cosine and sine of a binary angle into out[0] and out[1].
 *  The octant comes from the top 3 bits; odd octants use the exact integer
 *  complement, so the polynomial always sees [0, π/4]. */
export function dir(angle: number, out: Float64Array): void {
  const a = angle >>> 0;
  const oct = a >>> 29;
  const r = a & 0x1fffffff;
  const x = ((oct & 1) === 1 ? OCTANT - r : r) * RAD_PER_UNIT;
  const s = sinPoly(x);
  const c = cosPoly(x);
  switch (oct) {
    case 0: out[0] = c; out[1] = s; break;
    case 1: out[0] = s; out[1] = c; break;
    case 2: out[0] = -s; out[1] = c; break;
    case 3: out[0] = -c; out[1] = s; break;
    case 4: out[0] = -c; out[1] = -s; break;
    case 5: out[0] = -s; out[1] = -c; break;
    case 6: out[0] = s; out[1] = -c; break;
    default: out[0] = c; out[1] = -s; break;
  }
}

/** k/n of a turn as a binary angle: floor(k · 2^32 / n) >>> 0. */
export function fractionOfTurn(k: number, n: number): number {
  return Math.floor((k * TURN) / n) >>> 0;
}

// --- datan2 (D-2) ---------------------------------------------------------
// atan(t) ≈ t·P(t²) on [0, 1]. P is the degree-14 Chebyshev interpolant of
// atan(√s)/√s on s ∈ [0, 1], converted to monomials with exact rational
// arithmetic and rounded to doubles once. In double Horner form its worst
// error against Math.atan is 1.5e-13 rad (2.4e-14 of a turn, 1e-4 of a
// binary-angle unit), so the rounding to a whole unit dominates. The
// polynomial is odd and exactly 0 at t = 0: the axes give exact multiples of
// a quarter turn, and no fitted constant term turns mirrored terriers apart.
const A0 = 0.99999999999970890; // not a setting
const A1 = -0.33333333320221242; // not a setting
const A2 = 0.19999999010942454; // not a setting
const A3 = -0.14285684593699935; // not a setting
const A4 = 0.11110639850626285; // not a setting
const A5 = -0.090863528706256608; // not a setting
const A6 = 0.076631356069932127; // not a setting
const A7 = -0.065360771218911401; // not a setting
const A8 = 0.054578560029525158; // not a setting
const A9 = -0.042317801902148254; // not a setting
const A10 = 0.028402131516486406; // not a setting
const A11 = -0.015225260301182668; // not a setting
const A12 = 0.0059323524435361229; // not a setting
const A13 = -0.0014653526246547698; // not a setting
const A14 = 0.00017026861508687337; // not a setting

// 2^31/π: binary-angle units a radian. One exact division of two exact
// doubles, so every engine holds the same constant.
const UNITS_PER_RAD = HALF_TURN / Math.PI;

/** atan(t) for t in [0, 1], in radians. */
function atanPoly(t: number): number {
  const s = t * t;
  return t * (A0 + s * (A1 + s * (A2 + s * (A3 + s * (A4 + s * (A5 + s * (A6 + s * (A7 +
    s * (A8 + s * (A9 + s * (A10 + s * (A11 + s * (A12 + s * (A13 + s * A14))))))))))))));
}

/** Negative, or negative zero: the sign Math.atan2 reads. 1/−0 is −Infinity. */
function negative(v: number): boolean {
  return v < 0 || (v === 0 && 1 / v < 0);
}

/** The binary angle of the vector (x, y): Math.atan2(y, x) as a u32, from
 *  exact operations only. The octant comes from comparisons and swaps, then
 *  one exact division, the polynomial and one rounding. The quadrant is
 *  added as exact integers, with Math.atan2's signed-zero conventions, so
 *  datan2(−y, −x) === (datan2(y, x) + HALF_TURN) >>> 0 for every finite
 *  input, the axes with signed zeros included (P8). Two infinite parts, or
 *  a NaN, give 0, as the spike's does; D-1 keeps them out of every state. */
export function datan2(y: number, x: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  let a: number; // the first-quadrant angle, an integer in [0, QUARTER_TURN]
  if (ay <= ax) a = ax === 0 ? 0 : Math.round(atanPoly(ay / ax) * UNITS_PER_RAD);
  else a = QUARTER_TURN - Math.round(atanPoly(ax / ay) * UNITS_PER_RAD);
  if (negative(x)) a = negative(y) ? HALF_TURN + a : HALF_TURN - a;
  else if (negative(y)) a = TURN - a;
  return a >>> 0;
}

/** The signed difference b − a of two binary angles, in [−2^31, 2^31). */
export function angleDiff(a: number, b: number): number {
  return ((b >>> 0) - (a >>> 0)) | 0;
}

/** roslambo's scripts.ts mixer: a u32 from two integers, for seeded scripts
 *  and the bots' noise (D-39). */
export function mix(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}
