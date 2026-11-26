// The drawn match between the timeline's two drawn heads (PLAN §12's "Each
// frame"; M4's design, research/m4/DESIGN.md, §1.13, §2.2; D-16): the
// predicted state one tick behind the newest, at the tick's fraction.
// Positions and velocities linearly; headings, gaits, the overhead
// reference and the last push's direction the short way round, as binary
// angles; the discrete fields (the phase, a terrier's animation and its
// start, the ticks of its contacts and landings, the timers) from the
// nearer state, so a phase that starts at the head's tick shows from
// halfway through the tick before. Heads k > 1 ticks apart, after a
// catch-up, spread the fraction over the k ticks, f′ = (k − 1 + f) / k, so
// the bodies move on as if the k ticks were one and the drawn time stays
// the head's tick less one plus f. Nothing is interpolated across a kickoff
// placement anywhere between the two, so terriers never glide across the
// pitch to their spots (D-16: "dropped at a kickoff reset rather than
// smoothed across it"), nor for a terrier that arrived or changed slot.
//
// A port of roslambo's src/render/interpolate.ts (lerpAngle, toRadians,
// matching bodies by ID) in 3D, with the M0 spike's discrete-field rule
// (research/spike/src/scene/interpolate.ts). It reads the two states and
// writes only `out` (P11). Render-only maths, three-free.

import { HALF_TURN, TURN } from '../core/sim/math';
import { paramsFor } from '../core/sim/params';
import { type Ball, KICKOFF_COUNTDOWN, type MatchState, NEVER, START_COUNTDOWN, type Terrier } from '../core/sim/state';
import type { DrawnBall, DrawnMatch, DrawnTerrier, PrevShift } from './frame';

const RADIANS_PER_UNIT = (2 * Math.PI) / TURN;
const UNITS_PER_RADIAN = TURN / (2 * Math.PI);
/** A spread fraction below this draws the earlier state's discrete fields. */
const NEARER = 0.5;

const clamp01 = (f: number): number => (f > 0 ? (f < 1 ? f : 1) : 0);

/** Binary angles a → b by fraction f, the shorter way round, in [0, 2^32) (roslambo's). */
export function lerpAngle(a: number, b: number, f: number): number {
  let d = (b - a) % TURN;
  if (d >= HALF_TURN) d -= TURN;
  else if (d < -HALF_TURN) d += TURN;
  const x = (a + d * f) % TURN;
  return x < 0 ? x + TURN : x;
}

/** A binary angle in radians, counter-clockwise from +x. */
export function toRadians(binaryAngle: number): number {
  return binaryAngle * RADIANS_PER_UNIT;
}

/** Whether a kickoff placement lies anywhere between the two states: the head in a countdown that began
 *  after prev's tick, at or before the head's (M4's design §2.2). */
export const placementBetween = (prev: Readonly<MatchState>, head: Readonly<MatchState>): boolean =>
  (head.phase === START_COUNTDOWN || head.phase === KICKOFF_COUNTDOWN) && prev.tick < head.phaseStart && head.phaseStart <= head.tick;

/** The bodies' fraction between heads k ticks apart at the tick's fraction f: f′ = (k − 1 + f) / k, and f
 *  itself for consecutive heads. The camera rig draws its yaw by it too (§3.1). */
export function spreadFraction(prev: Readonly<MatchState>, head: Readonly<MatchState>, f: number): number {
  const k = head.tick - prev.tick;
  const a = clamp01(f);
  return k > 1 ? (k - 1 + a) / k : a;
}

function newDrawnTerrier(): DrawnTerrier {
  return {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    id: '', name: '', pack: 0, spot: 0, coat: 0, heading: 0, headingChange: 0, anim: 0, animStart: 0, gait: 0,
    takeOffTick: NEVER, landingTick: NEVER, lastBallContactTick: NEVER, lastTerrierContactTick: NEVER,
    lastPushDir: 0, lastPushTick: NEVER, sitting: false, ballOverhead: false, overheadRef: 0,
    meter: 0, pounceWait: 0, lunge: 0, tumble: 0, guard: 0,
  };
}

/** An empty drawn match, for interpolate's `out`. */
export function newDrawnMatch(): DrawnMatch {
  const ball: DrawnBall = {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onFloor: true,
    lastHitTick: NEVER, lastHitStrength: 0, lastHitDv: [0, 0, 0], lastContactTick: NEVER,
  };
  return {
    time: 0, headTick: 0, fraction: 0, phase: 0, phaseStart: 0, overtime: false, clock: 0, packSize: 1,
    lastGoalTick: NEVER, lastGoalPack: 0, ownGoal: false, ball, terriers: [],
  };
}

type Shift = PrevShift extends ReadonlyMap<string, infer S> ? S : never;

function drawBall(d: DrawnBall, a: Readonly<Ball>, b: Readonly<Ball>, f: number, s: Shift | undefined): void {
  const ax = a.x + (s?.dx ?? 0);
  const ay = a.y + (s?.dy ?? 0);
  const az = a.z + (s?.dz ?? 0);
  d.x = ax + (b.x - ax) * f;
  d.y = ay + (b.y - ay) * f;
  d.z = az + (b.z - az) * f;
  d.vx = a.vx + (b.vx - a.vx) * f;
  d.vy = a.vy + (b.vy - a.vy) * f;
  d.vz = a.vz + (b.vz - a.vz) * f;
  const n = f < NEARER ? a : b;
  d.onFloor = n.onFloor;
  d.lastHitTick = n.lastHitTick;
  d.lastHitStrength = n.lastHitStrength;
  d.lastHitDv[0] = n.lastHitDvx;
  d.lastHitDv[1] = n.lastHitDvy;
  d.lastHitDv[2] = n.lastHitDvz;
  d.lastContactTick = n.lastContactTick;
}

function drawTerrier(d: DrawnTerrier, a: Readonly<Terrier>, b: Readonly<Terrier>, f: number, s: Shift | undefined, meterFull: number): void {
  const ax = a.x + (s?.dx ?? 0);
  const ay = a.y + (s?.dy ?? 0);
  const az = a.z + (s?.dz ?? 0);
  d.x = ax + (b.x - ax) * f;
  d.y = ay + (b.y - ay) * f;
  d.z = az + (b.z - az) * f;
  d.vx = a.vx + (b.vx - a.vx) * f;
  d.vy = a.vy + (b.vy - a.vy) * f;
  d.vz = a.vz + (b.vz - a.vz) * f;
  d.id = b.id;
  d.name = b.name;
  d.pack = b.pack;
  d.spot = b.spot;
  d.coat = b.coat;
  d.heading = toRadians(lerpAngle(a.heading + (s?.dh ?? 0) * UNITS_PER_RADIAN, b.heading, f));
  d.headingChange = (a.headingChange + (b.headingChange - a.headingChange) * f) * RADIANS_PER_UNIT;
  d.gait = lerpAngle(a.gait, b.gait, f) / TURN;
  const n = f < NEARER ? a : b;
  // The overhead reference and the push's direction hold for an episode, so the short way round runs
  // between two states of the same one; a new one's comes from the nearer state, with its flag or tick.
  d.overheadRef = toRadians(a.ballOverhead && b.ballOverhead ? lerpAngle(a.overheadRef, b.overheadRef, f) : n.overheadRef);
  d.lastPushDir = toRadians(a.lastPushTick === b.lastPushTick ? lerpAngle(a.lastPushDir, b.lastPushDir, f) : n.lastPushDir);
  d.anim = n.anim;
  d.animStart = n.animStart;
  d.takeOffTick = n.takeOffTick;
  d.landingTick = n.landingTick;
  d.lastBallContactTick = n.lastBallContactTick;
  d.lastTerrierContactTick = n.lastTerrierContactTick;
  d.lastPushTick = n.lastPushTick;
  d.sitting = n.sitting;
  d.ballOverhead = n.ballOverhead;
  d.meter = (a.meter + (b.meter - a.meter) * f) / meterFull;
  d.pounceWait = n.pounceWait;
  d.lunge = n.lunge;
  d.tumble = n.tumble;
  d.guard = n.guard;
}

/** prev's terrier for head's B, its list index i there, by ID; none if it wasn't in prev or its slot
 *  changed, an arrival or a switch (M4's design §2.2). */
function earlier(prev: Readonly<MatchState>, B: Readonly<Terrier>, i: number): Readonly<Terrier> | undefined {
  let A: Readonly<Terrier> | undefined = prev.terriers[i];
  if (A?.id !== B.id) A = prev.terriers.find((T) => T.id === B.id);
  return A !== undefined && A.pack === B.pack && A.spot === B.spot ? A : undefined;
}

/** The drawn match between prev and head at the tick's fraction f (PLAN §12's "Each frame"): bodies by
 *  the spread fraction (spreadFraction), discrete fields from the nearer state, the head drawn as it is
 *  across a kickoff placement between them, and a terrier drawn as the head has it if it wasn't in prev
 *  or its slot changed. prevShift: the correction's shift of prev, per body ID ('ball' for the ball),
 *  metres and radians (src/render/smoothing.ts, phase 3). Writes `out` and returns it; reads the states
 *  alone. */
export function interpolate(
  prev: Readonly<MatchState>, head: Readonly<MatchState>, f: number, prevShift: PrevShift | null, out: DrawnMatch,
): DrawnMatch {
  const a = clamp01(f);
  const asIs = head.tick <= prev.tick || placementBetween(prev, head);
  const g = asIs ? 1 : spreadFraction(prev, head, a);
  const n = g < NEARER ? prev : head;
  out.time = head.tick - 1 + a;
  out.headTick = head.tick;
  out.fraction = a;
  out.phase = n.phase;
  out.phaseStart = n.phaseStart;
  out.overtime = n.overtime;
  out.clock = n.clock;
  out.packSize = head.packSize;
  out.lastGoalTick = n.lastGoalTick;
  out.lastGoalPack = n.lastGoalPack;
  out.ownGoal = n.ownGoal;
  drawBall(out.ball, asIs ? head.ball : prev.ball, head.ball, g, asIs ? undefined : prevShift?.get('ball'));
  const list = head.terriers;
  const drawn = out.terriers;
  drawn.length = list.length;
  // The meter's share of the match's own full meter: its rules' (C-59).
  const meterFull = paramsFor(head.rules).meterFull;
  for (let i = 0; i < list.length; i++) {
    const B = list[i]!;
    const A = asIs ? undefined : earlier(prev, B, i);
    const d = drawn[i] ?? newDrawnTerrier();
    if (A === undefined) drawTerrier(d, B, B, 1, undefined, meterFull);
    else drawTerrier(d, A, B, g, prevShift?.get(B.id), meterFull);
    drawn[i] = d;
  }
  return out;
}
