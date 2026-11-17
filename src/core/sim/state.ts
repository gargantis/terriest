// The canonical state (PLAN §7.1, A.1, D-9; design §1.4, §2): its types,
// genesis, cloning, the roster helpers and the display-name rule. Every
// field is in the canonical encoding (codec.ts), so in the hash. Plain data:
// plain objects and arrays, no classes, getters or methods, so cloneState
// copies it and the codec reads it.
// The M0 spike's state.ts (newTerrier, cloneState), roslambo's state.ts
// (genesis) and rules.ts (cleanName), with the roster's fields, the clock
// and overtime, slipFrom as a body slot, and the ball's hit change. The
// spike's per-tick intents leave the state for the Sim's scratch (A.1).

import { defaultParams, type SimParams } from './params';
import type { Pack } from './pitch';

export type { Pack } from './pitch';

// Phases, A.1's numbering. The codes are marked for the configuration scan
// (src/config.test.ts).
export const WARM_UP = 0; // not a setting
export const START_COUNTDOWN = 1; // not a setting
export const KICKOFF_COUNTDOWN = 2; // not a setting
export const IN_PLAY = 3; // not a setting
export const CELEBRATION = 4; // not a setting
export const ENDED = 5; // not a setting
export type Phase = typeof WARM_UP | typeof START_COUNTDOWN | typeof KICKOFF_COUNTDOWN | typeof IN_PLAY | typeof CELEBRATION | typeof ENDED;

// Animation phases (D-9), in ANIM_PHASES' order.
export const STANDING = 0; // not a setting
export const RUNNING = 1; // not a setting
export const ZOOMING = 2; // not a setting
export const AIRBORNE = 3; // not a setting
export const LUNGING = 4; // not a setting
export const TUMBLED = 5; // not a setting
export const GETTING_UP = 6; // not a setting
export const SITTING = 7; // not a setting
export type AnimPhase = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const ANIM_PHASES = ['standing', 'running', 'zooming', 'airborne', 'lunging', 'tumbled', 'gettingUp', 'sitting'] as const;

/** A tick that never happened (A.1). */
export const NEVER = 0xffffffff; // not a setting

/** A body the solver moves: the ball or a terrier. */
export interface Body {
  x: number; y: number; z: number; // metres: the centre spot is the origin, x along the length, z up (D-4)
  vx: number; vy: number; vz: number; // m/s
  onFloor: boolean; // set by step 4's support, and by placement
}

export interface Ball extends Body {
  lastHitTick: number; // NEVER until hit (D-9)
  lastHitStrength: number; // that hit's closing speed, m/s
  // That hit's velocity change, m/s: the squash's axis (A.1, D-9); 0 until hit.
  lastHitDvx: number; lastHitDvy: number; lastHitDvz: number;
  lastContactTick: number; // NEVER until a terrier touches it: credit and Q-8
}

export interface Terrier extends Body {
  // Identity.
  id: string; name: string; pack: Pack; spot: number; coat: number;
  // Lifecycle.
  joinTick: number; readyUntil: number; lastInputTick: number; // readyUntil 0: not ready
  prevInput: number; // the previous present final input, bits 0–12 (D-10)
  // Body.
  heading: number; // u32 binary angle
  overheadRef: number; // the heading when ballOverhead set (D-7)
  sitting: boolean; zoomLocked: boolean; ballOverhead: boolean; slipping: boolean; touchingBall: boolean;
  slipFrom: number; // the body slot slipped from, or −1 (A.1)
  // Timers, in ticks; the meter in half-ticks.
  meter: number; pounceWait: number; lunge: number; tumble: number; guard: number;
  // Counts.
  touches: number; goals: number;
  // Animation (D-9).
  anim: AnimPhase; animStart: number;
  gait: number; // u32 binary angle
  takeOffTick: number; landingTick: number;
  lastBallContactTick: number; lastTerrierContactTick: number;
  lastPushDir: number; // binary angle; 0 while lastPushTick is NEVER
  lastPushTick: number;
  headingChange: number; // i32: this tick's change of heading
}

export interface MatchSettings {
  packSize: number;
  matchMinutes: number;
}

export interface MatchState {
  phase: Phase; phaseStart: number; overtime: boolean; tick: number;
  packSize: number; // set at genesis, then never changed
  matchLengthTicks: number; // set at genesis, then never changed
  clock: number; // ticks left; in overtime, ticks since it began
  score: [number, number];
  lastGoalTick: number; lastGoalPack: Pack; ownGoal: boolean;
  scorers: number; // bit k: s.terriers[k]
  ball: Ball;
  terriers: Terrier[]; // (spot, pack) order: A1, B1, A2, B2 … (A.1)
}

/** Tick 0 of a match (D-8): warm-up, nobody in it yet, the clock at the
 *  match's length, the ball at rest on the centre spot. Throws on a pack
 *  size or a length outside the configuration: whole minutes, 1 to 10. */
export function genesis(settings: MatchSettings, P: SimParams = defaultParams): MatchState {
  const { packSize, matchMinutes } = settings;
  if (!(Number.isInteger(packSize) && packSize >= P.packSizeMin && packSize <= P.packSizeMax)) {
    throw new Error(`a pack size of ${packSize} is outside ${P.packSizeMin} to ${P.packSizeMax}`);
  }
  if (!(Number.isInteger(matchMinutes) && matchMinutes >= P.matchMinutesMin && matchMinutes <= P.matchMinutesMax)) {
    throw new Error(`a match of ${matchMinutes} minutes isn't a whole number from ${P.matchMinutesMin} to ${P.matchMinutesMax} (D-8)`);
  }
  const length = matchMinutes * P.ticksPerMinute;
  return {
    phase: WARM_UP, phaseStart: 0, overtime: false, tick: 0,
    packSize, matchLengthTicks: length, clock: length,
    score: [0, 0], lastGoalTick: NEVER, lastGoalPack: 0, ownGoal: false, scorers: 0,
    ball: {
      x: 0, y: 0, z: P.ballRadius, vx: 0, vy: 0, vz: 0, onFloor: true,
      lastHitTick: NEVER, lastHitStrength: 0, lastHitDvx: 0, lastHitDvy: 0, lastHitDvz: 0, lastContactTick: NEVER,
    },
    terriers: [],
  };
}

/** A terrier that joins at tick: spot 0, at rest on the floor at the
 *  centre spot until its arrival or a kickoff places it (D-8), with a full
 *  meter, every timer 0 and every unset tick NEVER (A.1). The caller passes
 *  a cleaned name and a coat in the list (D-12). */
export function newTerrier(id: string, name: string, pack: Pack, coat: number, tick: number, P: SimParams): Terrier {
  return {
    x: 0, y: 0, z: P.terrierRadius, vx: 0, vy: 0, vz: 0, onFloor: true,
    id, name, pack, spot: 0, coat,
    joinTick: tick, readyUntil: 0, lastInputTick: tick, prevInput: 0,
    heading: 0, overheadRef: 0,
    sitting: false, zoomLocked: false, ballOverhead: false, slipping: false, touchingBall: false,
    slipFrom: -1,
    meter: P.meterFull, pounceWait: 0, lunge: 0, tumble: 0, guard: 0,
    touches: 0, goals: 0,
    anim: STANDING, animStart: tick, gait: 0,
    takeOffTick: NEVER, landingTick: NEVER,
    lastBallContactTick: NEVER, lastTerrierContactTick: NEVER,
    lastPushDir: 0, lastPushTick: NEVER,
    headingChange: 0,
  };
}

/** A deep copy: the ball, the score and every terrier. */
export function cloneState(s: Readonly<MatchState>): MatchState {
  return { ...s, score: [s.score[0], s.score[1]], ball: { ...s.ball }, terriers: s.terriers.map((t) => ({ ...t })) };
}

/** A terrier's body slot: 2 × spot + pack (A.1). */
export function slotOf(t: Readonly<Terrier>): number {
  return 2 * t.spot + t.pack;
}

/** The ball's body slot, after every terrier's: 2 × pack size. */
export function ballSlot(packSize: number): number {
  return 2 * packSize;
}

/** The list index of the terrier with this ID, or −1. */
export function findTerrier(s: Readonly<MatchState>, id: string): number {
  const list = s.terriers;
  for (let k = 0; k < list.length; k++) if (list[k]!.id === id) return k;
  return -1;
}

export function packCount(s: Readonly<MatchState>, pack: Pack): number {
  let n = 0;
  for (const t of s.terriers) if (t.pack === pack) n++;
  return n;
}

/** The list into (spot, pack) order, by slot: an insertion sort in place. */
export function sortTerriers(s: MatchState): void {
  const list = s.terriers;
  for (let k = 1; k < list.length; k++) {
    const t = list[k]!;
    const slot = slotOf(t);
    let j = k - 1;
    while (j >= 0 && slotOf(list[j]!) > slot) {
      list[j + 1] = list[j]!;
      j--;
    }
    list[j + 1] = t;
  }
}

// --- Display names (C-17) ---
// One set, named: C0, DEL and C1, as roslambo's fitName strips them, plus
// lone surrogates, which TextEncoder would write as U+FFFD, so a decoded
// name would differ from the joined one. M4's src/core/names.ts strips by
// isNameControl and drops lone surrogates before it fits a name to the
// limits, so cleanName never drops a fitted name.

/** A UTF-16 code unit a display name may not hold: C0 (U+0000–U+001F),
 *  DEL (U+007F) and C1 (U+0080–U+009F). */
export function isNameControl(codeUnit: number): boolean {
  return codeUnit <= 0x1f || (codeUnit >= 0x7f && codeUnit <= 0x9f);
}

/** At most nameMaxChars code points and nameMaxBytes UTF-8 bytes, no
 *  isNameControl unit and no lone surrogate (C-17, A.4's Display name). */
export function nameAllowed(name: string, P: SimParams): boolean {
  if (typeof name !== 'string') return false;
  let chars = 0;
  let bytes = 0;
  for (let i = 0; i < name.length; i++) {
    const u = name.charCodeAt(i);
    if (isNameControl(u)) return false;
    if (u >= 0xd800 && u <= 0xdfff) {
      // Only a high surrogate followed by a low one: a code point of 4 bytes.
      const next = i + 1 < name.length ? name.charCodeAt(i + 1) : 0;
      if (u > 0xdbff || next < 0xdc00 || next > 0xdfff) return false;
      i++;
      bytes += 4;
    } else {
      bytes += u < 0x80 ? 1 : u < 0x800 ? 2 : 3;
    }
    chars++;
    if (chars > P.nameMaxChars || bytes > P.nameMaxBytes) return false;
  }
  return true;
}

/** A JOIN's name if nameAllowed, else '' (roslambo's cleanName). */
export function cleanName(name: string | undefined, P: SimParams): string {
  return name !== undefined && nameAllowed(name, P) ? name : '';
}
