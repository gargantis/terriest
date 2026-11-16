// The spike's match state (PLAN §7.1, A.1, D-9), without the roster: no
// player IDs, names, Ready or join ticks, since the spike plays a fixed
// roster from scripts. Everything here is in the canonical encoding
// (codec.ts), so in the hash.

import { datan2 } from './angle.ts';
import { KICKOFF_SPOTS, NEVER, type Pack, type SimConfig } from './config.ts';

// Phases (A.1's numbering; the spike plays only the last four).
export const WARM_UP = 0;
export const START_COUNTDOWN = 1;
export const KICKOFF_COUNTDOWN = 2;
export const IN_PLAY = 3;
export const CELEBRATION = 4;
export const ENDED = 5;

// Animation phases (D-9), in the contract's order.
export const ANIM_PHASES = ['standing', 'running', 'zooming', 'airborne', 'lunging', 'tumbled', 'gettingUp', 'sitting'] as const;
export const STANDING = 0;
export const RUNNING = 1;
export const ZOOMING = 2;
export const AIRBORNE = 3;
export const LUNGING = 4;
export const TUMBLED = 5;
export const GETTING_UP = 6;
export const SITTING = 7;

/** A body the solver moves: the ball or a terrier. */
export interface Body {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  onFloor: boolean;
}

export interface Ball extends Body {
  lastHitTick: number;
  lastHitStrength: number; // closing speed of the last hit (D-9)
  lastContactTick: number; // latest tick any terrier touched it
}

export interface Terrier extends Body {
  pack: Pack;
  spot: number;
  coat: number;
  lastInputTick: number;
  prevInput: number; // previous present input, bark bits and bit 15 cleared (D-10)
  heading: number; // binary angle
  overheadRef: number; // the heading when the ball-overhead flag set (D-7)
  sitting: boolean;
  zoomLocked: boolean;
  ballOverhead: boolean;
  slipping: boolean; // the slip-out flag, when the rule uses one (D-5 step 7)
  slipFrom: number; // body index the terrier slipped from, while slipping; −1 otherwise
  meter: number; // zoomies meter in half-ticks
  pounceWait: number; lunge: number; tumble: number; guard: number; // ticks
  touchingBall: boolean;
  touches: number;
  goals: number;
  anim: number;
  animStart: number;
  gait: number; // binary angle
  takeOffTick: number;
  landingTick: number;
  lastBallContactTick: number;
  lastTerrierContactTick: number;
  lastPushDir: number; // binary angle of the last push received
  lastPushTick: number;
  headingChange: number; // i32, this tick
  // Intents for this tick's substeps, set from the input (not separate
  // state: each is a function of the fields above and this tick's input,
  // but the substeps read them; encoded so the hash covers them).
  driveOn: boolean;
  targetVx: number;
  targetVy: number;
  zooming: boolean;
}

export interface MatchState {
  phase: number;
  phaseStart: number;
  tick: number; // the last tick computed
  packSize: number;
  score: [number, number];
  lastGoalTick: number;
  lastGoalPack: number;
  ownGoal: boolean;
  scorers: number; // bit k: the k-th terrier in the list
  ball: Ball;
  /** In (spot, pack) order: A1, B1, A2, B2 … The solver's body k is
   *  terriers[k], and the ball is body terriers.length. */
  terriers: Terrier[];
}

export function newTerrier(pack: Pack, spot: number, coat: number): Terrier {
  return {
    pack, spot, coat,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onFloor: true,
    lastInputTick: 0, prevInput: 0, heading: 0, overheadRef: 0,
    sitting: false, zoomLocked: false, ballOverhead: false, slipping: false, slipFrom: -1,
    meter: 0, pounceWait: 0, lunge: 0, tumble: 0, guard: 0,
    touchingBall: false, touches: 0, goals: 0,
    anim: STANDING, animStart: 0, gait: 0, takeOffTick: NEVER, landingTick: NEVER,
    lastBallContactTick: NEVER, lastTerrierContactTick: NEVER, lastPushDir: 0, lastPushTick: NEVER,
    headingChange: 0, driveOn: false, targetVx: 0, targetVy: 0, zooming: false,
  };
}

/** A match with packSize terriers a side, placed for a kickoff, in the
 *  given phase (a kickoff countdown, or straight into play). */
export function newMatch(packSize: number, C: SimConfig, phase: number = KICKOFF_COUNTDOWN): MatchState {
  const terriers: Terrier[] = [];
  for (let spot = 0; spot < packSize; spot++) {
    for (const pack of [0, 1] as const) terriers.push(newTerrier(pack, spot, (spot * 2 + pack) % C.coats));
  }
  const s: MatchState = {
    phase, phaseStart: 0, tick: 0, packSize, score: [0, 0],
    lastGoalTick: NEVER, lastGoalPack: 0, ownGoal: false, scorers: 0,
    ball: { x: 0, y: 0, z: C.ballRadius, vx: 0, vy: 0, vz: 0, onFloor: true, lastHitTick: NEVER, lastHitStrength: 0, lastContactTick: NEVER },
    terriers,
  };
  placeKickoff(s, C, 0);
  return s;
}

/** D-8's kickoff placement: every terrier at rest on its spot facing the
 *  ball, pounce ready, no lunge, tumble or guard, a full meter, no zoomies
 *  lockout; the ball at rest on the centre spot. Pack B's spots are pack
 *  A's point mirror, so a mirrored kickoff starts exactly mirrored. */
export function placeKickoff(s: MatchState, C: SimConfig, tick: number): void {
  const spots = KICKOFF_SPOTS[s.packSize];
  if (!spots) throw new Error(`no kickoff spots for pack size ${s.packSize}`);
  const b = s.ball;
  b.x = 0; b.y = 0; b.z = C.ballRadius; b.vx = 0; b.vy = 0; b.vz = 0; b.onFloor = true;
  for (const t of s.terriers) {
    const spot = spots[t.spot]!;
    t.x = t.pack === 0 ? spot[0] : -spot[0];
    t.y = t.pack === 0 ? spot[1] : -spot[1];
    t.z = C.terrierRadius;
    t.vx = 0; t.vy = 0; t.vz = 0; t.onFloor = true;
    t.heading = datan2(b.y - t.y, b.x - t.x);
    t.overheadRef = t.heading;
    t.ballOverhead = false;
    t.slipping = false; t.slipFrom = -1;
    t.zoomLocked = false;
    t.meter = C.meterFull;
    t.pounceWait = 0; t.lunge = 0; t.tumble = 0; t.guard = 0;
    t.touchingBall = false;
    t.driveOn = false; t.targetVx = 0; t.targetVy = 0; t.zooming = false;
    t.headingChange = 0;
    if (t.anim !== (t.sitting ? SITTING : STANDING)) {
      t.anim = t.sitting ? SITTING : STANDING;
      t.animStart = tick;
    }
  }
  s.scorers = 0;
}

export function cloneState(s: MatchState): MatchState {
  return {
    ...s,
    score: [s.score[0], s.score[1]],
    ball: { ...s.ball },
    terriers: s.terriers.map((t) => ({ ...t })),
  };
}
