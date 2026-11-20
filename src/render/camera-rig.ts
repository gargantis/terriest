// The cameras' yaw rules (PLAN D-28, L87, L88; M4's design,
// research/m4/DESIGN.md, §1.10, §3.1, M4-Q13), stepped once a head tick on
// the timeline's timer, never once a frame, so chase view's anchoring reads
// a yaw no frame rate moves (D-29, Q-19). The yaw is the camera's heading
// on the pitch, radians counter-clockwise from +x, the way the view looks;
// each viewer's own, outside the state, changing nothing in the match
// (L92).
//
// - Chase view eases toward the terrier's heading with time constant τ,
//   capped at ω: each tick Δ = wrap(heading − yaw), a step of
//   Δ · (1 − e^(−Δt/τ)) clamped to ±ω·Δt.
// - Ball view follows the horizontal line from the terrier to the ball at
//   up to ω, with no lag below the cap; while the ball-overhead flag is set
//   the line has no direction, so it turns toward the terrier's overhead
//   reference, which the ball frame then steers by (D-7), and holds.
// - After a timer run that moved the drawn head on k ticks, prevYaw is the
//   yaw at prev's tick and the yaw steps k times toward targets read
//   between the two heads at j / k (positions linearly, headings the short
//   way), so the yaw at the head's tick doesn't depend on how frames
//   batched the ticks. A frame draws prevYaw to yaw by the bodies' own
//   spread fraction (src/render/interpolate.ts), so the camera glides
//   through a catch-up as the bodies do.
// - It snaps to its target on a view's first tick, at a kickoff placement
//   anywhere in the ticks the head moved, at the terrier's arrival or
//   switch, and when the timeline held is another (the view's call).
//
// Spectators (D-28, L91): their window's centre along the pitch's length
// eases toward the followed body with spectatorFollowSeconds, stepped the
// same way, once a tick. New at M4; the spike's camera stepped its yaw once
// a frame (research/spike/src/scene/camera.ts). Render-only maths,
// three-free.

import { config, derived } from '../config';
import type { Pitch } from '../core/sim/pitch';
import { findTerrier, type MatchState, type Terrier } from '../core/sim/state';
import type { ViewMode } from './frame';
import { lerpAngle, placementBetween, toRadians } from './interpolate';

/** The swing, by camera setting, from src/config.ts (A.5's Chase view swing). */
export interface RigParams {
  readonly chaseTimeConstantSeconds: number;
  readonly chaseMaxTurnsPerSecond: number;
  readonly ballViewMaxTurnsPerSecond: number;
  readonly tickSeconds: number;
  /** The spectators' window's time constant (A.5's Spectators' camera). */
  readonly spectatorFollowSeconds: number;
}

/** The rig's settings: the swing's, or the calmer camera's (PLAN §11). */
export function rigParams(calmer: boolean): RigParams {
  return {
    chaseTimeConstantSeconds: calmer ? config.chaseCalmerTimeConstantSeconds : config.chaseSwingTimeConstantSeconds,
    chaseMaxTurnsPerSecond: calmer ? config.chaseCalmerMaxTurnsPerSecond : config.chaseSwingMaxTurnsPerSecond,
    ballViewMaxTurnsPerSecond: calmer ? config.ballViewCalmerMaxTurnsPerSecond : config.ballViewSwingMaxTurnsPerSecond,
    tickSeconds: derived.tickSeconds,
    spectatorFollowSeconds: config.spectatorFollowSeconds,
  };
}

/** What one step reads of the viewer's terrier and the ball: a head's, or a point between two heads.
 *  Metres; the heading and the overhead reference in radians. */
export interface RigInput {
  readonly x: number; readonly y: number; readonly heading: number;
  readonly ballOverhead: boolean; readonly overheadRef: number;
  readonly ballX: number; readonly ballY: number;
}

const TAU = 2 * Math.PI;
/** Closer than this in plan, the line to the ball has no direction and the yaw holds. */
const LINE_MIN_METRES_SQUARED = 1e-6;

/** An angle into (−π, π]. */
export function wrapAngle(a: number): number {
  let x = a % TAU;
  if (x > Math.PI) x -= TAU;
  else if (x <= -Math.PI) x += TAU;
  return x;
}

/** The yaw a step turns toward: chase view the terrier's heading; ball view the line to the ball, or the
 *  overhead reference while the ball is overhead (D-7), or `yaw` itself when the line has no direction. */
export function rigTarget(view: ViewMode, at: RigInput, yaw: number): number {
  if (view === 'chase') return at.heading;
  if (at.ballOverhead) return at.overheadRef;
  const dx = at.ballX - at.x;
  const dy = at.ballY - at.y;
  return dx * dx + dy * dy < LINE_MIN_METRES_SQUARED ? yaw : Math.atan2(dy, dx);
}

/** A head's terrier and ball as one step reads them. */
export function rigInput(s: Readonly<MatchState>, T: Readonly<Terrier>): RigInput {
  return {
    x: T.x, y: T.y, heading: toRadians(T.heading), ballOverhead: T.ballOverhead, overheadRef: toRadians(T.overheadRef),
    ballX: s.ball.x, ballY: s.ball.y,
  };
}

/** The point at f between two heads' terrier and ball: positions linearly, headings the short way, the
 *  flag from the nearer, and the overhead reference the short way within one episode of it. */
function between(prev: Readonly<MatchState>, A: Readonly<Terrier>, head: Readonly<MatchState>, B: Readonly<Terrier>, f: number): RigInput {
  const n = f < 0.5 ? A : B;
  return {
    x: A.x + (B.x - A.x) * f,
    y: A.y + (B.y - A.y) * f,
    heading: toRadians(lerpAngle(A.heading, B.heading, f)),
    ballOverhead: n.ballOverhead,
    overheadRef: toRadians(A.ballOverhead && B.ballOverhead ? lerpAngle(A.overheadRef, B.overheadRef, f) : n.overheadRef),
    ballX: prev.ball.x + (head.ball.x - prev.ball.x) * f,
    ballY: prev.ball.y + (head.ball.y - prev.ball.y) * f,
  };
}

/** The furthest the spectators' window's centre goes from the halfway line, so the window stays on the
 *  pitch, the goals included: a ball in the back of the net is still in it (§3.2). */
export function spectatorCentreLimit(p: Pitch): number {
  return Math.max(0, p.goalLineX + p.shape.goalDepthMetres - config.spectatorViewLengthMetres / 2);
}

export class CameraRig {
  private yawValue = 0;
  private prevYawValue = 0;
  private centreValue = 0;
  private prevCentreValue = 0;
  private snapsValue = 0;

  /** Radians, at the drawn head's tick. */
  get yaw(): number {
    return this.yawValue;
  }

  /** At prev's tick: a frame draws lerp(prevYaw, yaw, f′), f′ the bodies' spread fraction. */
  get prevYaw(): number {
    return this.prevYawValue;
  }

  /** The yaw's snaps, and the spectators' window's, since the rig was made. */
  get snaps(): number {
    return this.snapsValue;
  }

  /** The spectators' window's centre along the pitch's length, metres, at the head's tick and at prev's. */
  get centre(): number {
    return this.centreValue;
  }

  get prevCentre(): number {
    return this.prevCentreValue;
  }

  /** Steps the yaw one tick toward its target: chase view eases toward the terrier's heading, capped;
   *  ball view follows the line to the ball at the cap, with no lag below it, and toward the overhead
   *  reference while the ball is overhead (D-28). */
  step(view: ViewMode, at: RigInput, p: RigParams): void {
    const d = wrapAngle(rigTarget(view, at, this.yawValue) - this.yawValue);
    const dt = p.tickSeconds;
    const chase = view === 'chase';
    const cap = (chase ? p.chaseMaxTurnsPerSecond : p.ballViewMaxTurnsPerSecond) * TAU * dt;
    const want = chase ? d * (1 - Math.exp(-dt / p.chaseTimeConstantSeconds)) : d;
    this.yawValue = wrapAngle(this.yawValue + Math.max(-cap, Math.min(cap, want)));
  }

  /** After a timer run that moved the drawn head on k ≥ 1 ticks: prevYaw becomes the yaw at prev's tick,
   *  then k steps toward targets read between prev and head at j / k, j = 1 to k (positions linearly,
   *  headings the short way), so the yaw at head's tick doesn't depend on how frames batched the ticks.
   *  A kickoff placement anywhere between them, or the terrier's arrival or switch, snaps it instead; a
   *  terrier the head doesn't hold leaves it where it is. */
  advance(view: ViewMode, prev: Readonly<MatchState>, head: Readonly<MatchState>, me: string, p: RigParams): void {
    const k = head.tick - prev.tick;
    if (k < 1) return;
    const b = findTerrier(head, me);
    if (b < 0) {
      this.prevYawValue = this.yawValue;
      return;
    }
    const B = head.terriers[b]!;
    const a = findTerrier(prev, me);
    const A = a < 0 ? undefined : prev.terriers[a]!;
    if (A === undefined || A.pack !== B.pack || A.spot !== B.spot || placementBetween(prev, head)) {
      this.snap(view, rigInput(head, B));
      return;
    }
    this.prevYawValue = this.yawValue;
    for (let j = 1; j <= k; j++) this.step(view, between(prev, A, head, B, j / k), p);
  }

  /** A view's first tick, a terrier's arrival or a kickoff placement: the yaw jumps to its target. */
  snap(view: ViewMode, at: RigInput): void {
    this.yawValue = wrapAngle(rigTarget(view, at, this.yawValue));
    this.prevYawValue = this.yawValue;
    this.snapsValue++;
  }

  /** The yaw a frame draws at the bodies' spread fraction f′: prevYaw to yaw, the short way. */
  drawn(f: number): number {
    const g = f > 0 ? (f < 1 ? f : 1) : 0;
    return wrapAngle(this.prevYawValue + wrapAngle(this.yawValue - this.prevYawValue) * g);
  }

  /** One tick of the spectators' window: its centre eased toward x with spectatorFollowSeconds. */
  stepCentre(x: number, p: RigParams): void {
    this.centreValue += (x - this.centreValue) * (1 - Math.exp(-p.tickSeconds / p.spectatorFollowSeconds));
  }

  /** As advance, for the spectators' window: k steps toward targets from `from` to `to`, at j / k. */
  advanceCentre(from: number, to: number, k: number, p: RigParams): void {
    if (k < 1) return;
    this.prevCentreValue = this.centreValue;
    for (let j = 1; j <= k; j++) this.stepCentre(from + ((to - from) * j) / k, p);
  }

  /** A follow's first tick, or a kickoff placement: the window jumps to x. */
  snapCentre(x: number): void {
    this.centreValue = x;
    this.prevCentreValue = x;
    this.snapsValue++;
  }

  /** The window's centre a frame draws at the bodies' spread fraction f′. */
  drawnCentre(f: number): number {
    const g = f > 0 ? (f < 1 ? f : 1) : 0;
    return this.prevCentreValue + (this.centreValue - this.prevCentreValue) * g;
  }
}
