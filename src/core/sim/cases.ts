// M0 run 2's cases as runnable measurements (design §1.14): §16's slip-out
// cases ("A ball on terriers", D-5 step 7), dribbles and push times, which
// the slip-out and push tests, the tuning page and the metrics share. The M0
// spike's cases.ts for the chosen rule alone: ballOnTerriers and
// kickoffPinch lose their rule argument, the scenes come from scenes.ts, and
// a dribble counts its touches, for the re-arm gap's metric (design §9.6).
// Test support, not shipped: nothing in the simulation imports it. Exact
// operations, like the rest of src/core/sim (D-1).

import type { Config } from '../../config';
import { datan2 } from './math';
import type { SimParams } from './params';
import { dribbleScene, pinchScene, pushScene, type RestCase, restScene, type Scene, sceneInputs, sceneStart } from './scenes';
import type { MatchState } from './state';
import { makeSim, step } from './step';
import { mirrorMismatches, paramsWith } from './testing';

/** §16's "within 1 cm of its resting height": two terriers holding in can
 *  keep the ball a fraction of a millimetre up at the floor contact. */
export const DOWN_METRES = 0.01; // not a setting

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

/** Watches a run substep by substep: the first landing on a terrier, the
 *  first floor contact after it, the apex, and mirror symmetry. */
class Watch {
  sub = 0;
  landedSub = -1; // not a setting: none yet
  downSub = -1; // not a setting: none yet
  apex = 0;
  mirror: string | null = null;
  private prevZ = Infinity;
  private prevVz = 0;
  private readonly checkMirror: boolean;
  private readonly R: number;
  private readonly reach: number;
  /** Substeps a second: 240 at D-3's 4 substeps. */
  readonly perSecond: number;

  constructor(P: SimParams, checkMirror: boolean) {
    this.checkMirror = checkMirror;
    this.R = P.ballRadius;
    this.reach = P.ballRadius + P.terrierRadius;
    this.perSecond = P.config.ticksPerSecond * P.substeps;
  }

  /** A landing is a contact from above while the ball, off the floor in the
   *  previous substep, was coming down: not a pinch's push from the floor. */
  see(s: Readonly<MatchState>): void {
    this.sub++;
    const b = s.ball;
    this.apex = Math.max(this.apex, b.z);
    if (this.landedSub < 0) {
      if (this.prevZ > this.R + 1e-6 && this.prevVz < 0) {
        for (const t of s.terriers) {
          const dx = b.x - t.x, dy = b.y - t.y, dz = b.z - t.z;
          if (dz > 0 && dx * dx + dy * dy + dz * dz <= this.reach * this.reach * (1 + 1e-9)) {
            this.landedSub = this.sub;
            break;
          }
        }
      }
    } else if (this.downSub < 0 && b.z <= this.R + DOWN_METRES) {
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
      landed: this.landedSub < 0 ? null : this.landedSub / this.perSecond,
      down: this.landedSub < 0 || this.downSub < 0 ? null : (this.downSub - this.landedSub) / this.perSecond,
      slipOuts, mirror: this.mirror, apex: this.apex,
    };
  }
}

/** Runs a scene for some ticks, watched, until a second after the ball is down. */
function watched(P: SimParams, scene: Scene, ticks: number, checkMirror: boolean): SlipResult {
  const sim = makeSim(P, scene.packSize);
  const s = sceneStart(scene, P);
  const watch = new Watch(P, checkMirror);
  sim.probe = (st) => watch.see(st);
  for (let t = 1; t <= ticks; t++) {
    step(sim, s, sceneInputs(scene, s, t));
    if (watch.downSub >= 0 && watch.sub > watch.downSub + watch.perSecond) break;
  }
  return watch.result(sim.physics.stats.slipOuts);
}

/** A ball dropped from 1 cm onto terriers placed round it, pack B the point
 *  mirror of pack A, with the terriers holding toward it, or sitting
 *  (restScene); checked for P8 unless the case is off mirror. */
export function ballOnTerriers(c: RestCase, seconds = 10, over: Partial<Config> = {}): SlipResult {
  const P = paramsWith(over);
  return watched(P, restScene(c), Math.round(seconds * P.config.ticksPerSecond), c.offMirror !== true);
}

/** The kickoff pinch (C-21) at a pack size: everyone holds at the ball from
 *  the whistle; mirrored throughout, checked at every substep. */
export function kickoffPinch(packSize: number, zoomies = false, seconds = 15, over: Partial<Config> = {}): SlipResult {
  const P = paramsWith(over);
  return watched(P, pinchScene(packSize, zoomies), P.kickoffCountdownTicks + Math.round(seconds * P.config.ticksPerSecond), true);
}

export interface DribbleResult {
  slipOuts: number;
  seconds: number;
  ballTop: number; // fastest ball speed, m/s
  /** Contact angles from vertical seen while the ball was above the
   *  terrier's centre, degrees (min, max). */
  hopAngles: [number, number];
  /** The dribbler's touches: one contact episode each, re-armed at the gap (D-8). */
  touches: number;
}

/** A lone terrier dribbling (dribbleScene): from contact, holding at the
 *  ball or along the pitch, at run speed or zoomies, until the ball is 4 m
 *  from an end or side wall, or 6 s. */
export function dribble(
  frame: 'ball' | 'pitch',
  zoomies: boolean,
  runUp = 0,
  over: Partial<Config> = {},
  startSpeed?: number,
  stepOff = 0,
): DribbleResult {
  const P = paramsWith(over);
  const scene = dribbleScene(frame, zoomies, runUp, startSpeed, stepOff);
  const sim = makeSim(P, 1);
  const s = sceneStart(scene, P);
  const reach = P.ballRadius + P.terrierRadius;
  let top = 0;
  let minA = 180, maxA = 0;
  sim.probe = (st) => {
    const b = st.ball, t = st.terriers[0]!;
    top = Math.max(top, Math.sqrt(b.vx * b.vx + b.vy * b.vy));
    const dx = b.x - t.x, dy = b.y - t.y, dz = b.z - t.z;
    const h = Math.sqrt(dx * dx + dy * dy);
    if (h * h + dz * dz <= reach * reach * (1 + 1e-9) && dz > 0) {
      const a = (datan2(h, dz) * 360) / 4294967296; // degrees from vertical
      minA = Math.min(minA, a);
      maxA = Math.max(maxA, a);
    }
  };
  let t = 0;
  while (s.ball.x < 15 && s.ball.x > -17 && s.ball.y < 10 && s.ball.y > -10 && t < 360) {
    t++;
    step(sim, s, sceneInputs(scene, s, t));
  }
  return {
    slipOuts: sim.physics.stats.slipOuts, seconds: t / P.config.ticksPerSecond, ballTop: top, hopAngles: [minA, maxA],
    touches: s.terriers[0]!.touches,
  };
}

export interface PushResult {
  name: string;
  seconds: number | null; // null: not reached in the time allowed
  top: number; // the fastest the ball went, m/s
  slipOuts: number;
  airborneShare: number; // share of substeps with the ball off the floor
}

/** §16 "Pushes", C-18: from rest, in contact, with the rolling slowdown,
 *  the time for the ball to reach 95% of run speed (pushScene). */
export function pushTime(
  layout: 'train' | 'line' | 'round',
  m: number,
  frame: 'pitch' | 'ball',
  over: Partial<Config> = {},
  limitTicks = 360,
): PushResult {
  const P = paramsWith(over);
  const scene = pushScene(layout, m, frame);
  const sim = makeSim(P, scene.packSize);
  const s = sceneStart(scene, P);
  let reached: number | null = null;
  let top = 0;
  let air = 0;
  let subs = 0;
  let sub = 0;
  const target = 0.95 * P.runSpeed;
  const perSecond = P.config.ticksPerSecond * P.substeps;
  sim.probe = (st) => {
    sub++;
    if (reached !== null) return;
    subs++;
    if (!st.ball.onFloor) air++;
    const v = Math.sqrt(st.ball.vx * st.ball.vx + st.ball.vy * st.ball.vy);
    if (v > top) top = v;
    if (v >= target) reached = sub / perSecond;
  };
  for (let t = 1; t <= limitTicks && reached === null; t++) step(sim, s, sceneInputs(scene, s, t));
  return { name: scene.name, seconds: reached, top, slipOuts: sim.physics.stats.slipOuts, airborneShare: air / (subs > 0 ? subs : 1) };
}
