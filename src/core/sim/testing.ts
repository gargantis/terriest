// Helpers for the simulation's tests and measurements (design §1.13): placed
// states under a changed configuration, runs with inputs by list index,
// energy and momentum, the bodies' bits, P8's comparison by value, and D-4's
// second shape. Test support: not shipped, but linted and scanned as
// simulation code, so exact operations only (D-1). The M0 spike's
// testing.ts; its placement helpers are scenes.ts's now.

import { config, type Config, type PitchShape } from '../../config';
import { hash64 } from './hash';
import { mirrorInput, type TickInput } from './input';
import { HALF_TURN } from './math';
import { defaultParams, type SimParams, simParams } from './params';
import { type PlacedOptions, placedMatch } from './scenes';
import { ballSlot, type Body, type MatchState, NEVER, slotOf, type Terrier } from './state';
import { makeSim, type Sim, step } from './step';

/** A Sim and the state it steps. */
export interface Scenario {
  readonly sim: Sim;
  readonly s: MatchState;
}

/** 32 hex digits, increasing with k. */
export function testId(k: number): string {
  return k.toString(16).padStart(32, '0');
}

/** The parameters of the configuration with some settings changed. */
export function paramsWith(over: Partial<Config> = {}): SimParams {
  return Object.keys(over).length === 0 ? defaultParams : simParams({ ...config, ...over });
}

/** placedMatch and makeSim with a changed configuration, then setup(). */
export function scenario(
  packSize: number,
  over: Partial<Config> = {},
  setup?: (s: MatchState, P: SimParams) => void,
  opts: PlacedOptions = {},
): Scenario {
  const P = paramsWith(over);
  const s = placedMatch(P, packSize, opts);
  setup?.(s, P);
  return { sim: makeSim(P, packSize), s };
}

/** Runs ticks with terrier k's u16 from fn(k, t), by list index, or null
 *  when absent; nothing held by default. The inputs are handed over
 *  reversed (P4). */
export function run(sc: Scenario, ticks: number, fn: (k: number, t: number) => number | null = () => 0): void {
  const inputs: TickInput[] = [];
  for (let i = 0; i < ticks; i++) {
    const t = sc.s.tick + 1;
    inputs.length = 0;
    const list = sc.s.terriers;
    for (let k = list.length - 1; k >= 0; k--) {
      const v = fn(k, t);
      if (v !== null) inputs.push({ id: list[k]!.id, input: v, events: 0 });
    }
    step(sc.sim, sc.s, inputs);
  }
}

export function kineticEnergy(s: Readonly<MatchState>, P: SimParams): number {
  let e = 0;
  for (const t of s.terriers) e += 0.5 * P.config.terrierMassKg * (t.vx * t.vx + t.vy * t.vy + t.vz * t.vz);
  const b = s.ball;
  return e + 0.5 * P.config.ballMassKg * (b.vx * b.vx + b.vy * b.vy + b.vz * b.vz);
}

export function momentum(s: Readonly<MatchState>, P: SimParams): [number, number] {
  let px = P.config.ballMassKg * s.ball.vx;
  let py = P.config.ballMassKg * s.ball.vy;
  for (const t of s.terriers) {
    px += P.config.terrierMassKg * t.vx;
    py += P.config.terrierMassKg * t.vy;
  }
  return [px, py];
}

const bits = new DataView(new ArrayBuffer(8));
const hex8 = (v: number): string => (v >>> 0).toString(16).padStart(8, '0');

/** A float64's big-endian bits, as 16 hex digits. */
function floatBits(v: number): string {
  bits.setFloat64(0, v);
  return hex8(bits.getUint32(0)) + hex8(bits.getUint32(4));
}

function bodyText(b: Readonly<Body>, heading: number | null): string {
  const floats = floatBits(b.x) + floatBits(b.y) + floatBits(b.z) + floatBits(b.vx) + floatBits(b.vy) + floatBits(b.vz);
  return `${floats}${b.onFloor ? 1 : 0}${heading === null ? '' : hex8(heading)}`;
}

/** Every present body in slot order, the ball last: x, y, z, vx, vy, vz as
 *  16 hex digits each (the float64's big-endian bits), the floor flag as 0
 *  or 1, and a terrier's heading as 8 hex digits; bodies joined by ':'. */
export function bodyBits(s: Readonly<MatchState>): string {
  const list = [...s.terriers].sort((a, b) => slotOf(a) - slotOf(b));
  const parts = list.map((t) => bodyText(t, t.heading));
  parts.push(bodyText(s.ball, null));
  return parts.join(':');
}

/** hash64 of bodyBits's UTF-8 bytes: what the bit pins hold (design §4.1). */
export function bodyHash(s: Readonly<MatchState>): string {
  return hash64(new TextEncoder().encode(bodyBits(s)));
}

/** P8 by value (design §7.6): each pair (A_k, B_k) = terriers[2k],
 *  terriers[2k + 1] compared with ===, so +0 matches −0. Positions and
 *  velocities: x and y negated, z equal. Angles a half turn on: heading,
 *  overheadRef and, once pushed, lastPushDir. prevInput mirrored, slipFrom
 *  a terrier slot ^ 1 (−1 and the ball's stay), and every other field
 *  equal but identity and pack. The ball's x, y, vx, vy and hit change are
 *  each their own negation, ±0. Returns the first mismatches found. */
export function mirrorMismatches(s: Readonly<MatchState>, limit = 5): string[] {
  const out: string[] = [];
  const turned = (a: number): number => (a + HALF_TURN) >>> 0;
  const b = s.ball;
  const ballChecks: [string, number][] = [
    ['x', b.x], ['y', b.y], ['vx', b.vx], ['vy', b.vy], ['lastHitDvx', b.lastHitDvx], ['lastHitDvy', b.lastHitDvy],
  ];
  for (const [name, v] of ballChecks) if (v !== -v && out.length < limit) out.push(`ball.${name} = ${v}, not ±0`);
  const ballK = ballSlot(s.packSize);
  const slipMirror = (from: number): number => (from < 0 || from === ballK ? from : from ^ 1);
  for (let k = 0; k + 1 < s.terriers.length; k += 2) {
    const A: Terrier = s.terriers[k]!, B: Terrier = s.terriers[k + 1]!;
    const checks: [string, unknown, unknown][] = [
      ['x', -A.x, B.x], ['y', -A.y, B.y], ['z', A.z, B.z],
      ['vx', -A.vx, B.vx], ['vy', -A.vy, B.vy], ['vz', A.vz, B.vz],
      ['heading', turned(A.heading), B.heading], ['overheadRef', turned(A.overheadRef), B.overheadRef],
      ['lastPushDir', A.lastPushTick === NEVER ? A.lastPushDir : turned(A.lastPushDir), B.lastPushDir],
      ['prevInput', mirrorInput(A.prevInput), B.prevInput],
      ['slipFrom', slipMirror(A.slipFrom), B.slipFrom],
    ];
    for (const key of [
      'spot', 'joinTick', 'readyUntil', 'lastInputTick', 'onFloor', 'sitting', 'zoomLocked', 'ballOverhead', 'slipping', 'touchingBall',
      'meter', 'pounceWait', 'lunge', 'tumble', 'guard', 'touches', 'goals', 'anim', 'animStart', 'gait', 'takeOffTick', 'landingTick',
      'lastBallContactTick', 'lastTerrierContactTick', 'lastPushTick', 'headingChange',
    ] as const) {
      checks.push([key, A[key], B[key]]);
    }
    for (const [name, want, got] of checks) {
      if (want !== got && out.length < limit) out.push(`terrier ${k >> 1}: B.${name} = ${String(got)}, the mirror of A's = ${String(want)}`);
    }
  }
  return out;
}

/** D-4's second test shape: point-symmetric but not mirror-symmetric. */
export const SECOND_SHAPE: PitchShape = {
  lengthMetres: 50, // not a setting: D-4's second shape
  widthMetres: 30, // not a setting
  heightMetres: 6, // not a setting
  cornerCutsMetres: [6, 3, 6, 3], // not a setting
  mouthWidthMetres: 10, // not a setting
  mouthHeightMetres: 3, // not a setting
  goalDepthMetres: 2, // not a setting
  postRadiusMetres: 0.1, // not a setting
};
