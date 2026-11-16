// Helpers for the simulation's tests and measurements: hand-placed states,
// settings that isolate one effect, and runs with a probe. Never imported by
// the scene or the shipped page.

import { makeConfig, type SimConfig } from './config.ts';
import { encodeState } from './codec.ts';
import { mirrorInput } from './input.ts';
import { IN_PLAY, type MatchState, newMatch } from './state.ts';
import { makeSim, type Sim, step } from './step.ts';

export interface Scenario {
  sim: Sim;
  s: MatchState;
}

/** A match in play with packSize a side, kickoff-placed, then setup(). */
export function scenario(packSize: number, over: Partial<SimConfig> = {}, setup?: (s: MatchState, C: SimConfig) => void): Scenario {
  const C = makeConfig(over);
  const sim = makeSim(C, packSize);
  const s = newMatch(packSize, C, IN_PLAY);
  setup?.(s, C);
  return { sim, s };
}

/** Runs ticks with inputs from fn (k, t), or nothing held. */
export function run(sc: Scenario, ticks: number, fn: (k: number, t: number) => number | null = () => 0): void {
  const inputs: (number | null)[] = new Array(sc.s.terriers.length).fill(0);
  for (let i = 0; i < ticks; i++) {
    const t = sc.s.tick + 1;
    for (let k = 0; k < inputs.length; k++) inputs[k] = fn(k, t);
    step(sc.sim, sc.s, inputs);
  }
}

export function kineticEnergy(s: MatchState, C: SimConfig): number {
  let e = 0;
  for (const t of s.terriers) e += 0.5 * C.terrierMass * (t.vx * t.vx + t.vy * t.vy + t.vz * t.vz);
  const b = s.ball;
  return e + 0.5 * C.ballMass * (b.vx * b.vx + b.vy * b.vy + b.vz * b.vz);
}

export function momentum(s: MatchState, C: SimConfig): [number, number] {
  let px = C.ballMass * s.ball.vx;
  let py = C.ballMass * s.ball.vy;
  for (const t of s.terriers) {
    px += C.terrierMass * t.vx;
    py += C.terrierMass * t.vy;
  }
  return [px, py];
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export const stateBytes = encodeState;

/** P8, by value: pack B's terrier k is pack A's point mirror (x and y
 *  negated, z equal, angles a half turn on, everything else equal), and the
 *  ball is its own mirror. Returns the first mismatches found. */
export function mirrorMismatches(s: MatchState, limit = 5): string[] {
  const out: string[] = [];
  const HALF = 2147483648;
  const angle = (a: number): number => (a + HALF) >>> 0;
  const b = s.ball;
  const ballChecks: [string, boolean][] = [
    ['ball.x', b.x === -b.x], ['ball.y', b.y === -b.y], ['ball.vx', b.vx === -b.vx], ['ball.vy', b.vy === -b.vy],
  ];
  for (const [name, ok] of ballChecks) if (!ok && out.length < limit) out.push(`${name} = ${name.endsWith('x') ? b.x : b.y}`);
  for (let k = 0; k + 1 < s.terriers.length; k += 2) {
    const A = s.terriers[k]!, B = s.terriers[k + 1]!;
    const checks: [string, unknown, unknown][] = [
      ['x', -A.x, B.x], ['y', -A.y, B.y], ['z', A.z, B.z],
      ['vx', -A.vx, B.vx], ['vy', -A.vy, B.vy], ['vz', A.vz, B.vz],
      ['heading', angle(A.heading), B.heading], ['overheadRef', angle(A.overheadRef), B.overheadRef],
      ['lastPushDir', A.lastPushTick === 0xffffffff ? B.lastPushDir : angle(A.lastPushDir), B.lastPushDir],
      ['targetVx', -A.targetVx, B.targetVx], ['targetVy', -A.targetVy, B.targetVy],
      ['slipFrom', A.slipFrom < 0 || A.slipFrom === s.terriers.length ? A.slipFrom : A.slipFrom ^ 1, B.slipFrom],
      ['prevInput', mirrorInput(A.prevInput), B.prevInput],
    ];
    for (const key of [
      'spot', 'onFloor', 'sitting', 'zoomLocked', 'ballOverhead', 'slipping', 'meter', 'pounceWait', 'lunge', 'tumble',
      'guard', 'touchingBall', 'touches', 'goals', 'anim', 'animStart', 'gait', 'takeOffTick', 'landingTick',
      'lastBallContactTick', 'lastTerrierContactTick', 'lastPushTick', 'headingChange', 'driveOn', 'zooming',
      'lastInputTick',
    ] as const) {
      checks.push([key, A[key], B[key]]);
    }
    for (const [name, want, got] of checks) {
      if (want !== got && out.length < limit) out.push(`terrier ${k >> 1}: B.${name} = ${String(got)}, mirror of A = ${String(want)}`);
    }
  }
  return out;
}
