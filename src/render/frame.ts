// The types one frame's drawing meets at (M4's design, research/m4/DESIGN.md,
// §1.1, §2.2, §3): the drawn match the view composes (src/render/view.ts)
// and the stage draws (src/render/scene.ts), the cameras' modes, what the
// stage reports of a frame for the DOM overlay and the hook, and the
// smoother's shift of the previous state. The screens' layers and the tests
// read them too. Types and one constant only; three-free.

import type { AnimPhase, Pack, Phase } from '../core/sim/index';
import type { DrawerFrame } from './drawer';

/** A body as drawn: interpolated, with D-16's offset added. Metres, z up; m/s. */
export interface DrawnBody { x: number; y: number; z: number; vx: number; vy: number; vz: number }

export interface DrawnBall extends DrawnBody {
  onFloor: boolean;
  lastHitTick: number; // NEVER until hit (A.1)
  lastHitStrength: number; // the hit's closing speed, m/s (D-9)
  lastHitDv: [number, number, number]; // the squash's axis (A.1, D-9's M2 note)
  lastContactTick: number;
}

export interface DrawnTerrier extends DrawnBody {
  id: string; name: string; pack: Pack; spot: number; coat: number;
  heading: number; // radians counter-clockwise from +x, interpolated the short way
  headingChange: number; // radians this tick (D-9's turning)
  anim: AnimPhase; animStart: number; // D-9: from the nearer of the two states drawn between
  gait: number; // a fraction of a cycle, 0 to 1
  takeOffTick: number; landingTick: number;
  lastBallContactTick: number; lastTerrierContactTick: number;
  lastPushDir: number; // radians; meaningless while lastPushTick is NEVER
  lastPushTick: number;
  sitting: boolean; ballOverhead: boolean;
  overheadRef: number; // radians: the heading when ballOverhead set (D-7)
  meter: number; // 0 to 1 of full (A.1's half-ticks over meterFull)
  pounceWait: number; lunge: number; tumble: number; guard: number; // ticks left
}

export interface DrawnMatch {
  time: number; // the drawn time in ticks: headTick − 1 + fraction
  headTick: number;
  fraction: number; // 0 to 1
  phase: Phase; phaseStart: number; overtime: boolean;
  clock: number; // ticks left, or since overtime began (A.1)
  packSize: number;
  lastGoalTick: number; lastGoalPack: Pack; ownGoal: boolean;
  ball: DrawnBall;
  terriers: DrawnTerrier[]; // the head's (spot, pack) order
}

export type ViewMode = 'ball' | 'chase';
export type CameraMode =
  | { readonly kind: 'overview' } // M1's: the whole empty pitch
  | { readonly kind: 'player'; readonly view: ViewMode; readonly terrier: string }
  | { readonly kind: 'spectator'; readonly follow: string | null }; // null: the ball (D-28, L91)

export interface CameraFrame {
  readonly mode: CameraMode;
  readonly yaw: number; // radians: the rig's yaw, interpolated by the fraction (M4's design §3.1)
  readonly target: { readonly x: number; readonly y: number; readonly z: number }; // the drawn body it aims at or follows
  readonly subject: { readonly x: number; readonly y: number; readonly z: number } | null; // a player's drawn terrier
}

/** What the stage draws in one frame; a null match: the empty pitch from the overview camera. */
export interface StageFrame {
  readonly match: DrawnMatch | null;
  readonly drawer: DrawerFrame | null;
  readonly camera: CameraFrame;
  readonly nowMs: number; // the drawing clock: the page clock less the time Practice was paused (M4's design §2.2)
  readonly dtMs: number; // since the last frame by that clock, 0 while paused: the ball's roll and the dust only (C-29)
  readonly fadeTo: { readonly x: number; readonly y: number; readonly z: number } | null; // the occluders fade between the camera and this (D-28)
}

/** A goal's netting bulging round the ball: src/render/effects.ts finds it in the drawn match, pitch.ts draws it. */
export interface Bulge { readonly pack: Pack; readonly weight: number; readonly x: number; readonly y: number; readonly z: number }

export interface ScreenPoint {
  readonly x: number; readonly y: number; // CSS px from the canvas's top left
  readonly inView: boolean; // in front of the camera and inside the view, by a margin
  readonly angle: number; // radians from the view's centre, for the off-screen arrow (D-28)
}

/** What the stage reports of a frame, for the DOM overlay and the hook. */
export interface FrameOut {
  readonly ball: ScreenPoint;
  readonly terriers: readonly (ScreenPoint & { readonly id: string })[];
  readonly yaw: number;
  readonly cssWidth: number; readonly cssHeight: number;
}

/** A correction's shift of the drawn head's previous state, per body ID ('ball' for the ball), applied
 *  until the head next advances (M4's design §2.3): written by src/render/smoothing.ts, read by
 *  src/render/interpolate.ts. */
export type PrevShift = ReadonlyMap<string, { readonly dx: number; readonly dy: number; readonly dz: number; readonly dh: number }>;

export const NEVER_TICK = 0xffffffff; // not a setting: A.1's NEVER, for files that don't import the simulation
