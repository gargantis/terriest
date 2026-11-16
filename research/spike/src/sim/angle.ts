// Binary angles and exact-ops trigonometry (PLAN D-1, D-2). dir() and
// fractionOfTurn() are roslambo's src/core/sim/angle.ts, copied unchanged:
// within 7e-16 of Math.cos and Math.sin, identical bits in V8,
// SpiderMonkey and JavaScriptCore. datan2() is new for terriest.
// Only + - * / %, comparisons, bit operations and Math.sqrt / abs / min /
// max / floor / round / trunc / imul appear here: IEEE 754 rounds each of
// them exactly, so every engine computes the same bits.

/** Binary angles: 2^32 units per turn. */
export const TURN = 4294967296;
export const HALF_TURN = 2147483648;
export const QUARTER_TURN = 1073741824;

const OCTANT = 536870912; // 2^29 units, one eighth of a turn
// π/4 over 2^29: radians per unit. Dividing by a power of two is exact.
const RAD_PER_UNIT = 0.7853981633974483 / OCTANT;

// Taylor coefficients, each one exact division at load.
const S3 = -1 / 6;
const S5 = 1 / 120;
const S7 = -1 / 5040;
const S9 = 1 / 362880;
const S11 = -1 / 39916800;
const S13 = 1 / 6227020800;
const S15 = -1 / 1307674368000;
const C2 = -1 / 2;
const C4 = 1 / 24;
const C6 = -1 / 720;
const C8 = 1 / 40320;
const C10 = -1 / 3628800;
const C12 = 1 / 479001600;
const C14 = -1 / 87178291200;
const C16 = 1 / 20922789888000;

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

/** k/n of a turn as a binary angle. */
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
const A0 = 0.99999999999970890;
const A1 = -0.33333333320221242;
const A2 = 0.19999999010942454;
const A3 = -0.14285684593699935;
const A4 = 0.11110639850626285;
const A5 = -0.090863528706256608;
const A6 = 0.076631356069932127;
const A7 = -0.065360771218911401;
const A8 = 0.054578560029525158;
const A9 = -0.042317801902148254;
const A10 = 0.028402131516486406;
const A11 = -0.015225260301182668;
const A12 = 0.0059323524435361229;
const A13 = -0.0014653526246547698;
const A14 = 0.00017026861508687337;

// 2^31/π: binary-angle units per radian. One exact division of two exact
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
 *  datan2(−y, −x) === (datan2(y, x) + HALF_TURN) >>> 0 for every input,
 *  the axes with signed zeros included (P8). */
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
