// M0 run 2's cases as runnable measurements: §16's slip-out cases ("A ball
// on terriers", D-5 step 7), dribbles, and push times. slipout.test.ts and
// push.test.ts assert them, and measure.test.ts takes the report's numbers
// from the same functions. Test support, not simulation: nothing in the
// simulation imports it. Exact operations, like the rest of src/sim.

import { datan2, dir, fractionOfTurn, HALF_TURN } from './angle.ts';
import { makeConfig, SLIP_OUT_RULES, type SimConfig, type SlipOutName, type SlipOutRule } from './config.ts';
import { ballDir, NOTHING, park, pinch, pitchDir, place, placeBall, type ScriptSpec, scriptConfig, scriptInputs, scriptStart } from './scripts.ts';
import { IN_PLAY, type MatchState, newMatch } from './state.ts';
import { makeSim, step } from './step.ts';
import { mirrorMismatches } from './testing.ts';

export interface SlipResult {
  /** Seconds from the run's start to the ball's first landing on a terrier. */
  landed: number | null;
  /** Seconds from that landing to the ball reaching the floor; null if it
   *  was still up when the run ended. */
  down: number | null;
  slipOuts: number;
  /** The first P8 mismatch, for mirrored runs. */
  mirror: string | null;
  /** The ball's highest centre, metres. */
  apex: number;
}

const R = 0.8;
const r = 0.25;
const REACH = R + r;
/** The ball counts as down within 1 cm of the floor: two terriers holding
 *  in can keep it a fraction of a millimetre up at the floor contact. */
export const DOWN = 0.01;

/** Watches a run substep by substep: the first landing on a terrier, the
 *  first floor contact after it, the apex, and mirror symmetry. */
class Watch {
  sub = 0;
  landedSub = -1;
  downSub = -1;
  apex = 0;
  mirror: string | null = null;
  private prevZ = Infinity;
  private prevVz = 0;
  private readonly checkMirror: boolean;
  constructor(checkMirror: boolean) {
    this.checkMirror = checkMirror;
  }
  /** A landing is a contact from above while the ball, off the floor in the
   *  previous substep, was coming down: not a pinch's push from the floor. */
  see(s: MatchState): void {
    this.sub++;
    const b = s.ball;
    this.apex = Math.max(this.apex, b.z);
    if (this.landedSub < 0) {
      if (this.prevZ > R + 1e-6 && this.prevVz < 0) {
        for (const t of s.terriers) {
          const dx = b.x - t.x, dy = b.y - t.y, dz = b.z - t.z;
          if (dz > 0 && dx * dx + dy * dy + dz * dz <= REACH * REACH * (1 + 1e-9)) { this.landedSub = this.sub; break; }
        }
      }
    } else if (this.downSub < 0 && b.z <= R + DOWN) {
      this.downSub = this.sub;
    }
    this.prevZ = b.z;
    this.prevVz = b.vz;
    if (this.checkMirror && this.mirror === null) {
      const m = mirrorMismatches(s, 1);
      if (m.length > 0) this.mirror = `substep ${this.sub}: ${m[0]}`;
    }
  }
  result(slipOuts: number): SlipResult {
    return {
      landed: this.landedSub < 0 ? null : this.landedSub / 240,
      down: this.landedSub < 0 || this.downSub < 0 ? null : (this.downSub - this.landedSub) / 240,
      slipOuts, mirror: this.mirror, apex: this.apex,
    };
  }
}

export type Holding = 'ball frame' | 'pitch frame, opposite' | 'sitting';

export interface RestCase {
  packSize: number;
  /** The contact angle from vertical the ball is placed at, degrees. */
  thetaDeg: number;
  holding: Holding;
  /** Pack B 2 cm off its mirrored place (sideways) and its inputs a tick late. */
  offMirror?: boolean;
}

/** A ball dropped from 1 cm onto terriers placed round it, pack B the point
 *  mirror of pack A, with the terriers holding toward it (or sitting). */
export function ballOnTerriers(rule: SlipOutName | SlipOutRule, c: RestCase, seconds = 10, over: Partial<SimConfig> = {}): SlipResult {
  const C = makeConfig({ slipOut: typeof rule === 'string' ? SLIP_OUT_RULES[rule] : rule, ...over });
  const sim = makeSim(C, c.packSize);
  const s = newMatch(c.packSize, C, IN_PLAY);
  const d = new Float64Array(2);
  dir(fractionOfTurn(c.thetaDeg, 360), d);
  const cosT = d[0]!;
  const sinT = d[1]!;
  const rho = REACH * sinT;
  for (let j = 0; j < c.packSize; j++) {
    // Pack A round the −x side, 38° apart (clear of each other at ρ ≥ 0.81).
    const offset = Math.round(((2 * j - (c.packSize - 1)) * 38 * 4294967296) / 720);
    dir((HALF_TURN + offset) >>> 0, d);
    const ax = rho * d[0]!, ay = rho * d[1]!;
    place(s, 2 * j, ax, ay);
    place(s, 2 * j + 1, -ax, -ay + (c.offMirror ? 0.02 : 0));
  }
  placeBall(s, 0, 0, r + REACH * cosT + 0.01);
  if (c.holding === 'sitting') for (const t of s.terriers) t.sitting = true;
  const watch = new Watch(!c.offMirror);
  sim.probe = (st) => watch.see(st);
  const inputs: (number | null)[] = new Array(c.packSize * 2).fill(0);
  const ticks = Math.round(seconds * 60);
  for (let t = 1; t <= ticks; t++) {
    for (let k = 0; k < inputs.length; k++) {
      const late = c.offMirror === true && (k & 1) === 1 && t === 1;
      if (c.holding === 'sitting') inputs[k] = null;
      else if (late) inputs[k] = NOTHING;
      else if (c.holding === 'ball frame') inputs[k] = ballDir(0);
      else inputs[k] = (k & 1) === 0 ? pitchDir(0) : pitchDir(16);
    }
    step(sim, s, inputs);
    if (watch.downSub >= 0 && watch.sub > watch.downSub + 240) break;
  }
  return watch.result(sim.physics.stats.slipOuts);
}

/** The kickoff pinch (C-21) at a pack size: everyone holds at the ball from
 *  the whistle; mirrored throughout, checked at every substep. */
export function kickoffPinch(rule: SlipOutName | SlipOutRule, packSize: number, zoomies = false, seconds = 15): SlipResult {
  const spec = pinch(packSize, typeof rule === 'string' ? rule : 'none', zoomies);
  const C = typeof rule === 'string' ? scriptConfig(spec) : { ...scriptConfig(spec), slipOut: rule };
  const sim = makeSim(C, packSize);
  const s = scriptStart(spec, C);
  const watch = new Watch(true);
  sim.probe = (st) => watch.see(st);
  const inputs: (number | null)[] = [];
  const ticks = C.kickoffCountdownTicks + Math.round(seconds * 60);
  for (let t = 1; t <= ticks; t++) {
    step(sim, s, scriptInputs(spec, t, inputs));
    if (watch.downSub >= 0 && watch.sub > watch.downSub + 240) break;
  }
  return watch.result(sim.physics.stats.slipOuts);
}

export interface DribbleResult {
  slipOuts: number;
  seconds: number;
  ballTop: number; // fastest ball speed, m/s
  hopAngles: [number, number]; // contact angles from vertical seen while the ball was above the terrier's centre, degrees (min, max)
}

/** A lone terrier dribbling: from contact, holding at the ball (or along the
 *  pitch), at run speed or zoomies, until the ball nears a wall. */
export function dribble(rule: SlipOutName | SlipOutRule, frame: 'ball' | 'pitch', zoomies: boolean, runUp = 0, over: Partial<SimConfig> = {}, startSpeed?: number, stepOff = 0): DribbleResult {
  const C = makeConfig({ slipOut: typeof rule === 'string' ? SLIP_OUT_RULES[rule] : rule, ...over });
  const sim = makeSim(C, 1);
  const s = newMatch(1, C, IN_PLAY);
  park(s, 1);
  placeBall(s, -14, 0);
  place(s, 0, -14 - Math.sqrt(REACH * REACH - (R - r) * (R - r)) - runUp, 0);
  if (runUp > 0) s.terriers[0]!.vx = startSpeed ?? (zoomies ? C.zoomiesSpeed : C.runSpeed);
  let top = 0;
  let minA = 180, maxA = 0;
  sim.probe = (st) => {
    const b = st.ball, t = st.terriers[0]!;
    top = Math.max(top, Math.sqrt(b.vx * b.vx + b.vy * b.vy));
    const dx = b.x - t.x, dy = b.y - t.y, dz = b.z - t.z;
    const h = Math.sqrt(dx * dx + dy * dy);
    if (h * h + dz * dz <= REACH * REACH * (1 + 1e-9) && dz > 0) {
      const a = (datan2(h, dz) * 360) / 4294967296; // degrees from vertical
      minA = Math.min(minA, a);
      maxA = Math.max(maxA, a);
    }
  };
  let t = 0;
  // Until the ball is 4 m from an end or side wall, or 6 s.
  while (s.ball.x < 15 && s.ball.x > -17 && s.ball.y < 10 && s.ball.y > -10 && t < 360) {
    t++;
    step(sim, s, [frame === 'ball' ? ballDir(stepOff & 31, zoomies) : pitchDir(stepOff & 31, zoomies), NOTHING]);
  }
  return { slipOuts: sim.physics.stats.slipOuts, seconds: t / 60, ballTop: top, hopAngles: [minA, maxA] };
}

export interface PushResult {
  name: string;
  seconds: number | null; // null: not reached in the time allowed
  top: number; // the fastest the ball went, m/s
  slipOuts: number;
  airborneShare: number; // share of substeps with the ball off the floor
}

/** §16 "Pushes", C-18: from rest, in contact, with the rolling slowdown,
 *  the time for the ball to reach 95% of run speed. */
export function pushTime(spec: ScriptSpec, over: Partial<SimConfig> = {}, limitTicks = 360): PushResult {
  const C = makeConfig({ slipOut: SLIP_OUT_RULES[spec.slipOut], ...over });
  const sim = makeSim(C, spec.packSize);
  const s = scriptStart(spec, C);
  const inputs: (number | null)[] = [];
  let reached: number | null = null;
  let top = 0;
  let air = 0;
  let subs = 0;
  let sub = 0;
  const target = 0.95 * C.runSpeed;
  sim.probe = (st) => {
    sub++;
    if (reached !== null) return;
    subs++;
    if (!st.ball.onFloor) air++;
    const v = Math.sqrt(st.ball.vx * st.ball.vx + st.ball.vy * st.ball.vy);
    if (v > top) top = v;
    if (v >= target) reached = sub / 240;
  };
  for (let t = 1; t <= limitTicks && reached === null; t++) step(sim, s, scriptInputs(spec, t, inputs));
  return { name: spec.name, seconds: reached, top, slipOuts: sim.physics.stats.slipOuts, airborneShare: air / (subs > 0 ? subs : 1) };
}
