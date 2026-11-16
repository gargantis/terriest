// What a drawer is handed each frame (PLAN D-27, §12): the view one tick
// behind the newest, interpolated by the tick's fraction. Positions and
// velocities are interpolated linearly; headings and gaits, which are u32
// binary angles, the short way round. Pure, so it's unit-tested.

import type { AnimPhase, BallView, MatchView, Pack, TerrierView } from '../contract';

const TURN = 4294967296;

export interface TerrierPose {
  pack: Pack;
  spot: number;
  coat: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Radians, counter-clockwise from +x seen from above; not wrapped. */
  heading: number;
  phase: AnimPhase;
  phaseStartTick: number;
  /** Fraction of a gait cycle, 0 to 1. */
  gait: number;
  lastBallContactTick: number;
}

export type BallPose = BallView;

export interface DrawFrame {
  /** The drawn time in ticks: the older view's tick plus the fraction. */
  time: number;
  tick: number;
  fraction: number;
  terriers: TerrierPose[];
  ball: BallPose;
  lastGoal?: { tick: number; pack: Pack };
}

/** The signed short-way difference b - a of two u32 binary angles. */
export function angleDelta(a: number, b: number): number {
  return (b - a) | 0;
}

const lerp = (a: number, b: number, f: number): number => a + (b - a) * f;

function terrierPose(a: TerrierView, b: TerrierView, f: number): TerrierPose {
  // Discrete fields come from the nearer view: a phase that starts at the
  // newer tick shows from halfway through the older one.
  const d = f < 0.5 ? a : b;
  const heading = a.heading + angleDelta(a.heading, b.heading) * f;
  const gait = a.gait + angleDelta(a.gait, b.gait) * f;
  return {
    pack: b.pack, spot: b.spot, coat: b.coat,
    x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), z: lerp(a.z, b.z, f),
    vx: lerp(a.vx, b.vx, f), vy: lerp(a.vy, b.vy, f), vz: lerp(a.vz, b.vz, f),
    heading: (heading / TURN) * 2 * Math.PI,
    phase: d.phase,
    phaseStartTick: d.phaseStartTick,
    gait: (((gait % TURN) + TURN) % TURN) / TURN,
    lastBallContactTick: d.lastBallContactTick,
  };
}

/** prev and next are views of consecutive ticks (or the same view twice). */
export function interpolate(prev: MatchView, next: MatchView, fraction: number): DrawFrame {
  const f = Math.min(1, Math.max(0, fraction));
  const terriers: TerrierPose[] = [];
  for (let i = 0; i < next.terriers.length; i++) {
    const b = next.terriers[i]!;
    const a = prev.terriers[i];
    // A terrier that wasn't in the older view (or moved slot) isn't interpolated.
    terriers.push(terrierPose(a && a.pack === b.pack && a.spot === b.spot ? a : b, b, f));
  }
  const pa = prev.ball;
  const pb = next.ball;
  const d = f < 0.5 ? pa : pb;
  const frame: DrawFrame = {
    time: prev.tick + (next.tick - prev.tick) * f,
    tick: prev.tick,
    fraction: f,
    terriers,
    ball: {
      x: lerp(pa.x, pb.x, f), y: lerp(pa.y, pb.y, f), z: lerp(pa.z, pb.z, f),
      vx: lerp(pa.vx, pb.vx, f), vy: lerp(pa.vy, pb.vy, f), vz: lerp(pa.vz, pb.vz, f),
      lastHitTick: d.lastHitTick, lastHitStrength: d.lastHitStrength,
    },
  };
  const goal = (f < 0.5 ? prev : next).lastGoal;
  if (goal) frame.lastGoal = { ...goal };
  return frame;
}

/** A copy of a view, so a source that reuses its view object can't change a kept one. */
export function snapshot(v: MatchView): MatchView {
  const s: MatchView = { tick: v.tick, terriers: v.terriers.map((t) => ({ ...t })), ball: { ...v.ball } };
  if (v.lastGoal) s.lastGoal = { ...v.lastGoal };
  return s;
}
