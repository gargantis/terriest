// Placing a scene (PLAN §16; design §1.12): each pack's ranked IDs, a match
// placed for a kickoff, a terrier or the ball put at a point, the reach of a
// touch, the inputs as A.2's u16, and a placed scene's state at tick 0.
// Moved out of scenes.ts, unchanged, by M4's phase 2a (M4's design §1.50,
// M4-Q5): the canary's replay, which the page's module holds, places its
// scene with these, and scenes.ts, which re-exports them, holds the golden
// runs' own scenes, named as the runs are, which only the determinism chunk
// needs. It ships in the page's module and the determinism chunk, so exact
// operations only (D-1).

import { encodeInput, FRAME_BALL, FRAME_PITCH } from './input';
import { mix } from './math';
import type { SimParams } from './params';
import { placeKickoff } from './rules';
import { IN_PLAY, type MatchState, NEVER, newTerrier, type Pack, type Phase } from './state';
import { makeSim } from './step';

/** A placed match's clock when it has no real one: 2^31 ticks, which no
 *  test reaches, so a long scene never meets 0:00 (design §13, R-7). */
const LONG_CLOCK = 2147483648; // not a setting

const hex8 = (v: number): string => (v >>> 0).toString(16).padStart(8, '0');

/** Each pack's IDs for a seed, ascending, so member (pack, rank) has its
 *  pack's rank-th smallest ID and rank k of pack B mirrors rank k of pack
 *  A. Each is 32 lower-case hex digits with a person's version digit, 4,
 *  never a bot's 8 (D-39). */
export function rankedIds(seed: number, perPack: number): readonly [readonly string[], readonly string[]] {
  const packs: [string[], string[]] = [[], []];
  const all: string[] = [];
  for (let pack = 0; pack < 2; pack++) {
    const ids = packs[pack as Pack];
    for (let rank = 0; rank < perPack; rank++) {
      const h = mix(seed, 2 * rank + pack);
      const id = hex8(mix(h, 1)) + hex8(mix(h, 2)) + hex8(mix(h, 3)) + hex8(mix(h, 4));
      const person = `${id.slice(0, 12)}4${id.slice(13)}`;
      if (all.includes(person)) throw new Error(`seed ${seed} gives two equal IDs`);
      all.push(person);
      ids.push(person);
    }
    ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }
  return packs;
}

export interface PlacedOptions {
  readonly phase?: Phase; // IN_PLAY by default; KICKOFF_COUNTDOWN for pinches
  readonly members?: readonly [number, number]; // terriers in each pack; both full by default
  readonly seed?: number; // for rankedIds; 0 by default
  readonly matchMinutes?: number; // a real clock; else 2^31 ticks, which no test reaches
}

/** A match placed for a kickoff (D-8, design §6.4) at tick 0: every member
 *  present, by ID rank on its pack's spots, Ready 0, phaseStart 0. */
export function placedMatch(P: SimParams, packSize: number, opts: PlacedOptions = {}): MatchState {
  const members = opts.members ?? [packSize, packSize];
  for (const m of members) {
    if (!(Number.isInteger(m) && m >= 0 && m <= packSize)) throw new Error(`${m} members don't fit a pack of ${packSize}`);
  }
  const ids = rankedIds(opts.seed ?? 0, packSize);
  const minutes = opts.matchMinutes;
  if (minutes !== undefined && !(Number.isInteger(minutes) && minutes >= 1)) throw new Error(`a match of ${minutes} minutes isn't whole minutes from 1`);
  const length = minutes === undefined ? LONG_CLOCK : minutes * P.ticksPerMinute;
  const s: MatchState = {
    phase: opts.phase ?? IN_PLAY, phaseStart: 0, overtime: false, tick: 0,
    packSize, matchLengthTicks: length, clock: length,
    score: [0, 0], lastGoalTick: NEVER, lastGoalPack: 0, ownGoal: false, scorers: 0,
    ball: {
      x: 0, y: 0, z: P.ballRadius, vx: 0, vy: 0, vz: 0, onFloor: true,
      lastHitTick: NEVER, lastHitStrength: 0, lastHitDvx: 0, lastHitDvy: 0, lastHitDvz: 0, lastContactTick: NEVER,
    },
    terriers: [],
  };
  for (let pack = 0; pack < 2; pack++) {
    for (let rank = 0; rank < members[pack]!; rank++) {
      s.terriers.push(newTerrier(ids[pack]![rank]!, '', pack as Pack, (2 * rank + pack) % P.coatCount, 0, P));
    }
  }
  placeKickoff(makeSim(P, packSize), s, 0);
  return s;
}

/** Terrier k, by list index, at rest at (x, y, z), on the floor if z is its radius. */
export function place(P: SimParams, s: MatchState, k: number, x: number, y: number, z: number = P.terrierRadius): void {
  const t = s.terriers[k]!;
  t.x = x; t.y = y; t.z = z;
  t.vx = 0; t.vy = 0; t.vz = 0;
  t.onFloor = z === P.terrierRadius;
}

/** Puts a terrier out of the way: a far corner of its own half. */
export function park(P: SimParams, s: MatchState, k: number): void {
  const t = s.terriers[k]!;
  const side = t.pack === 0 ? -1 : 1;
  place(P, s, k, side * 16, (t.spot - 1.5) * 1.2 * side + side * -9); // not a setting: a scene's coordinate
}

/** The ball at (x, y, z) with velocity (vx, vy, vz), on the floor if it rests there. */
export function placeBall(P: SimParams, s: MatchState, x: number, y: number, z: number = P.ballRadius, vx = 0, vy = 0, vz = 0): void {
  const b = s.ball;
  b.x = x; b.y = y; b.z = z; b.vx = vx; b.vy = vy; b.vz = vz;
  b.onFloor = z === P.ballRadius && vz === 0;
}

/** The horizontal centre distance of a standing terrier touching a resting ball. */
export function touchReach(P: SimParams): number {
  const R = P.ballRadius;
  const r = P.terrierRadius;
  return Math.sqrt((R + r) * (R + r) - (R - r) * (R - r));
}

// --- Inputs, as A.2's u16 ---

export const NOTHING = 0;
export const pitchDir = (step: number, zoomies = false): number => encodeInput({ step, frame: FRAME_PITCH, zoomies });
export const ballDir = (step: number, zoomies = false): number => encodeInput({ step, frame: FRAME_BALL, zoomies });

/** Member (pack, rank)'s u16 at tick t, or null when absent; s is the state
 *  before the tick. */
export type SceneInput = (pack: Pack, rank: number, t: number, s: Readonly<MatchState>) => number | null;

// --- Scenes ---

/** A placed scene: its state's setup and its inputs. */
export interface Scene {
  readonly name: string;
  readonly packSize: number;
  readonly phase: Phase;
  readonly members?: readonly [number, number];
  readonly setup?: (s: MatchState, P: SimParams) => void;
  readonly input: SceneInput;
  /** Pack B's rank k sends mirrorInput of pack A's rank k (P8). */
  readonly mirrored: boolean;
}

/** A scene's state at tick 0: placed, then set up. */
export function sceneStart(scene: Scene, P: SimParams, seed = 0): MatchState {
  const s = placedMatch(P, scene.packSize, { phase: scene.phase, seed, ...(scene.members ? { members: scene.members } : {}) });
  scene.setup?.(s, P);
  return s;
}
