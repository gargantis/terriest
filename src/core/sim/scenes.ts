// M0's scenes and the helpers that build them, in one place (design §1.12),
// so the physics tests, the goldens, the canary, the cases, the marks, the
// tuning page and the metrics all run the same scenes. From the M0 spike's
// scripts.ts (the placement helpers, the inputs, chasey, and the push,
// pinch, squeeze and scrum setups) and cases.ts (the rest and dribble
// setups). The spike's literal radii are read from SimParams; its
// coordinates and inputs stay, each marked where the configuration scan
// would read one as a setting. M2 adds design §9.6's shots into the
// netting. It ships in the determinism chunk, so it keeps to exact
// operations (D-1).
//
// A placed state may hold fewer terriers than its pack size (members):
// warm-up has holes anyway, and in play it's a test-only state, the
// empty-goal mark's (design §2.3, §8.5), which step handles, since
// everything indexes by slot, and which stateProblems reports once the
// rules' checks are in (design §6.7), so it never comes from a peer.

import { encodeInput, FRAME_BALL, FRAME_NOSE, FRAME_PITCH, mirrorInput, type TickInput } from './input';
import { dir, fractionOfTurn, HALF_TURN, mix, TURN } from './math';
import type { SimParams } from './params';
import { placeKickoff } from './rules';
import { IN_PLAY, KICKOFF_COUNTDOWN, type MatchState, NEVER, newTerrier, type Pack, type Phase } from './state';
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

const BALL_STEPS = [0, 0, 0, 0, 0, 1, 31, 2, 30, 4, 28, 8, 24, 16, 0, 0];
const CONTACT_STEPS = [0, 0, 0, 0, 0, 0, 0, 0, 1, 31, 2, 30, 3, 29, 0, 0];
const NOSE_STEPS = [0, 0, 2, 30, 4, 28, 16, 8];

const jumps = (seed: number, k: number, t: number): number => Math.floor((t + (mix(seed, k) & 63)) / (97 + 13 * (k >> 1)));
const pounces = (seed: number, k: number, t: number): number => Math.floor((t + (mix(seed, k + 50) & 63)) / (131 + 17 * (k >> 1)));

/** The spike's seeded play: held directions in spells of 23 ticks, some
 *  zoomies, and periodic jumps and pounces from press counters. 'ball':
 *  mostly at the ball; 'all': a quarter of the spells in the pitch frame,
 *  one in eight in the nose frame, the rest at the ball; 'contact': at the
 *  ball, with a pitch-frame or nose-frame spell one time in eight each, so
 *  terriers keep meeting the ball and each other. Seeded by slot, as the
 *  spike's was by list index. */
export function chasey(seed: number, frames: 'ball' | 'all' | 'contact'): SceneInput {
  return (pack, rank, t) => {
    const k = 2 * rank + pack;
    const h = mix(mix(seed, k), Math.floor(t / 23));
    if ((h & 15) === 0) return encodeInput({ jump: jumps(seed, k, t), pounce: pounces(seed, k, t) }); // an idle spell
    let frame = FRAME_BALL;
    let step = (frames === 'contact' ? CONTACT_STEPS : BALL_STEPS)[(h >>> 4) & 15]!;
    const f = (h >>> 8) & 7;
    if (frames === 'all') {
      if (f === 0 || f === 1) { frame = FRAME_PITCH; step = (h >>> 12) & 31; }
      else if (f === 2) { frame = FRAME_NOSE; step = NOSE_STEPS[(h >>> 12) & 7]!; }
    } else if (frames === 'contact') {
      if (f === 0) { frame = FRAME_PITCH; step = (h >>> 12) & 31; }
      else if (f === 1) { frame = FRAME_NOSE; step = NOSE_STEPS[(h >>> 12) & 7]!; }
    }
    return encodeInput({
      step, frame, zoomies: ((h >>> 20) & 3) === 0,
      jump: jumps(seed, k, t), pounce: pounces(seed, k, t),
    });
  };
}

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

/** A member's rank: how many of its pack have a smaller ID. */
function rankOf(s: Readonly<MatchState>, T: Readonly<{ id: string; pack: Pack }>): number {
  let rank = 0;
  for (const U of s.terriers) if (U.pack === T.pack && U.id < T.id) rank++;
  return rank;
}

/** Tick t's TickInputs for a scene's members, with their IDs, handed over
 *  reversed so arrival order is exercised every tick (P4); s is the state
 *  before the tick. */
export function sceneInputs(scene: Scene, s: Readonly<MatchState>, t: number, out: TickInput[] = []): TickInput[] {
  out.length = 0;
  const list = s.terriers;
  for (let k = list.length - 1; k >= 0; k--) {
    const T = list[k]!;
    const rank = rankOf(s, T);
    let v: number | null;
    if (scene.mirrored && T.pack === 1) {
      const a = scene.input(0, rank, t, s);
      v = a === null ? null : mirrorInput(a);
    } else {
      v = scene.input(T.pack, rank, t, s);
    }
    if (v !== null) out.push({ id: T.id, input: v, events: 0 });
  }
  return out;
}

/** Round the back of the ball, touching it: 33° apart, in 720ths of a turn,
 *  just clear of each other (a 0.508 m chord against the 0.5 m they need). */
const ROUND_STEP_720THS = 33 * 2; // not a setting

/** Pack A's first m terriers push the ball from rest at the centre spot,
 *  holding +x in the pitch frame or at the ball in the ball frame (§16,
 *  C-18): one behind another ('train'), on a straight line abreast 0.52 m
 *  apart ('line'), or round the back of the ball, touching it, 33° apart
 *  ('round'). Everyone else is parked. */
export function pushScene(layout: 'train' | 'line' | 'round', m: number, frame: 'pitch' | 'ball'): Scene {
  const packSize = m <= 1 ? 1 : m <= 2 ? 2 : 4;
  const held = frame === 'pitch' ? pitchDir(0) : ballDir(0);
  return {
    name: `${m} ${layout === 'train' ? 'in a train' : layout === 'line' ? 'on a line' : 'round the ball'}, ${frame} frame`,
    packSize, phase: IN_PLAY, mirrored: false,
    setup: (s, P) => {
      for (let k = 0; k < s.terriers.length; k++) park(P, s, k);
      placeBall(P, s, 0, 0);
      const reach = touchReach(P);
      const d = new Float64Array(2);
      for (let j = 0; j < m; j++) {
        const k = 2 * j; // pack A's rank j
        if (layout === 'train') {
          // One behind another, each touching the next.
          place(P, s, k, -reach - 0.5 * j, 0);
        } else if (layout === 'line') {
          // On a straight line abreast, 0.52 m apart; the middle ones touch the ball.
          place(P, s, k, -Math.sqrt(reach * reach - 0.26 * 0.26), (j - (m - 1) / 2) * 0.52);
        } else {
          const offset = Math.round(((2 * j - (m - 1)) * ROUND_STEP_720THS * TURN) / 1440);
          dir((HALF_TURN + offset) >>> 0, d);
          place(P, s, k, reach * d[0]!, reach * d[1]!);
        }
      }
    },
    input: (pack, rank) => (pack === 0 && rank < m ? held : NOTHING),
  };
}

/** The kickoff pinch (C-21), from its countdown: everyone holds at the ball
 *  from the whistle, mirrored. */
export function pinchScene(packSize: number, zoomies = false): Scene {
  return {
    name: `pinch ${packSize}${zoomies ? ', zoomies' : ''}`, packSize, phase: KICKOFF_COUNTDOWN, mirrored: true,
    input: () => ballDir(0, zoomies),
  };
}

/** Two terriers squeeze the ball between them, mirrored. */
export const SQUEEZE: Scene = {
  name: 'squeeze',
  packSize: 1, // not a setting
  phase: IN_PLAY,
  mirrored: true,
  setup: (s, P) => {
    const reach = touchReach(P);
    place(P, s, 0, -reach - 1, 0);
    place(P, s, 1, reach + 1, 0);
  },
  input: () => pitchDir(0),
};

/** 4 a side scrumming at the ball against the +y side wall (M0 run 3): every
 *  terrier holds at it in the ball frame, each with zoomies in alternate
 *  32-tick spells. */
export const WALL_SCRUM: Scene = {
  name: 'scrum at the wall',
  packSize: 4, // not a setting
  phase: IN_PLAY,
  mirrored: false,
  setup: (s, P) => {
    const R = P.ballRadius;
    placeBall(P, s, 0, 14 - R);
    for (let k = 0; k < 8; k++) {
      const side = (k & 1) === 0 ? -1 : 1;
      const j = k >> 1;
      place(P, s, k, side * (1.0 + 0.55 * j), 14 - R - 0.4 - 0.5 * (j & 1)); // not a setting: a scene's coordinate
    }
  },
  input: (pack, rank, t) => ballDir(0, ((t >> 5) + 2 * rank + pack) % 2 === 0),
};

/** The same in the (+x, +y) cut corner, the densest contact the spike has:
 *  the ball touching the corner wall, the terriers packed behind it. */
export const CORNER_SCRUM: Scene = {
  name: 'scrum in the corner',
  packSize: 4, // not a setting
  phase: IN_PLAY,
  mirrored: false,
  setup: (s, P) => {
    const R = P.ballRadius;
    // On the corner's inward normal, (−1, −1)/√2, R in from its wall.
    const back = Math.sqrt(0.5);
    const cx = 18 - (R / back) / 2 - 0.4; // not a setting: a scene's coordinate
    const cy = 12 - (R / back) / 2 + 0.4; // not a setting: a scene's coordinate
    placeBall(P, s, cx, cy);
    for (let k = 0; k < 8; k++) {
      const row = k >> 2;
      const col = (k & 3) - 1.5; // not a setting: a scene's coordinate
      // Rows 1.3 m and 1.9 m back along the normal, 0.55 m apart across it.
      const along = 1.3 + 0.6 * row; // not a setting: a scene's coordinate
      place(P, s, k, cx - along * back + col * 0.55 * back, cy - along * back - col * 0.55 * back);
    }
  },
  input: (pack, rank, t) => ballDir(0, ((t >> 5) + 2 * rank + pack) % 2 === 0),
};

/** A resting ball between two standing terriers, nothing held. */
export const RESTING_BALL: Scene = {
  name: 'resting ball',
  packSize: 1, // not a setting
  phase: IN_PLAY,
  mirrored: false,
  setup: (s, P) => {
    place(P, s, 0, -3, 2);
    place(P, s, 1, 3, -2);
  },
  input: () => NOTHING,
};

/** A ball rolling from (−6, −3) at (3, 1.5) m/s, nothing held: the rolling slowdown. */
export const ROLLING_BALL: Scene = {
  name: 'rolling ball',
  packSize: 1, // not a setting
  phase: IN_PLAY,
  mirrored: false,
  setup: (s, P) => placeBall(P, s, -6, -3, P.ballRadius, 3, 1.5), // not a setting: a scene's coordinate
  input: () => NOTHING,
};

/** A lone terrier dribbling from contact at (−14, 0), holding at the ball in
 *  the ball frame or along +x in the pitch frame, stepOff steps aside, at
 *  run or zoomies speed; with a run-up, it starts that far back at
 *  startSpeed, or its drive's speed. Its rival is parked. */
export function dribbleScene(frame: 'ball' | 'pitch', zoomies: boolean, runUp = 0, startSpeed?: number, stepOff = 0): Scene {
  const held = frame === 'ball' ? ballDir(stepOff & 31, zoomies) : pitchDir(stepOff & 31, zoomies);
  return {
    name: `dribble, ${frame} frame${zoomies ? ', zoomies' : ''}${runUp > 0 ? `, ${runUp} m run-up` : ''}${stepOff !== 0 ? `, ${stepOff} steps off` : ''}`,
    packSize: 1, // not a setting
    phase: IN_PLAY,
    mirrored: false,
    setup: (s, P) => {
      const R = P.ballRadius;
      const r = P.terrierRadius;
      const reach = R + r;
      park(P, s, 1);
      placeBall(P, s, -14, 0);
      place(P, s, 0, -14 - Math.sqrt(reach * reach - (R - r) * (R - r)) - runUp, 0);
      if (runUp > 0) s.terriers[0]!.vx = startSpeed ?? (zoomies ? P.zoomiesSpeed : P.runSpeed);
    },
    input: (pack) => (pack === 0 ? held : NOTHING),
  };
}

/** One of §16's slip-out cases ("A ball on terriers", D-5 step 7). */
export interface RestCase {
  packSize: number;
  /** The contact angle from vertical the ball is placed at, degrees. */
  thetaDeg: number;
  holding: 'ball frame' | 'pitch frame, opposite' | 'sitting';
  /** Pack B 2 cm off its mirrored place (sideways) and its inputs a tick late. */
  offMirror?: boolean;
}

/** A ball dropped from 1 cm onto terriers placed round it at the case's
 *  contact angle, pack A round the −x side, 38° apart, and pack B its point
 *  mirror, holding toward it, or sitting with no input. */
export function restScene(c: RestCase): Scene {
  return {
    name: `ball on terriers, ${c.packSize} a side at ${c.thetaDeg}°, ${c.holding}${c.offMirror === true ? ', off mirror' : ''}`,
    packSize: c.packSize, phase: IN_PLAY, mirrored: false,
    setup: (s, P) => {
      const r = P.terrierRadius;
      const reach = P.ballRadius + r;
      const d = new Float64Array(2);
      dir(fractionOfTurn(c.thetaDeg, 360), d);
      const cosT = d[0]!;
      const sinT = d[1]!;
      const rho = reach * sinT;
      for (let j = 0; j < c.packSize; j++) {
        // Pack A round the −x side, 38° apart (clear of each other at ρ ≥ 0.81).
        const offset = Math.round(((2 * j - (c.packSize - 1)) * 38 * TURN) / 720);
        dir((HALF_TURN + offset) >>> 0, d);
        const ax = rho * d[0]!, ay = rho * d[1]!;
        place(P, s, 2 * j, ax, ay);
        place(P, s, 2 * j + 1, -ax, -ay + (c.offMirror === true ? 0.02 : 0));
      }
      placeBall(P, s, 0, 0, r + reach * cosT + 0.01);
      if (c.holding === 'sitting') for (const t of s.terriers) t.sitting = true;
    },
    input: (pack, _rank, t) => {
      if (c.holding === 'sitting') return null;
      if (c.offMirror === true && pack === 1 && t === 1) return NOTHING;
      if (c.holding === 'ball frame') return ballDir(0);
      return pack === 0 ? pitchDir(0) : pitchDir(16);
    },
  };
}

// --- The netting shots (design §9.6, C-48) ---

/** A shot into the +x goal's netting, with nobody near: from 3 m in front of
 *  the goal line, aimed through the mouth's centre at an angle in plan,
 *  rolling, high (its centre 2 m up) or lobbed (4 m/s up). */
export interface NettingShot {
  readonly speed: number; // m/s, in plan
  readonly angleDeg: number; // in plan, from straight at the goal
  readonly kind: 'rolling' | 'high' | 'lobbed';
}

/** Design §9.6's 18 shots: at 5 and 10 m/s, at 0°, 20° and 35°, each
 *  rolling, high and lobbed. The tuning page and its metrics run them, and
 *  so will netting.test.ts, which holds the settled value in the gate
 *  (design §11). */
export const NETTING_SHOTS: readonly NettingShot[] = [5, 10].flatMap((speed) =>
  [0, 20, 35].flatMap((angleDeg) => (['rolling', 'high', 'lobbed'] as const).map((kind) => ({ speed, angleDeg, kind }))),
);

/** A netting shot as a scene: 1 a side in play, both terriers parked and
 *  holding nothing, the ball placed with the shot's velocity. */
export function nettingScene(shot: NettingShot): Scene {
  const { speed, angleDeg, kind } = shot;
  return {
    name: `netting: a ${kind} shot at ${speed} m/s, ${angleDeg}° in plan`,
    packSize: 1, // not a setting
    phase: IN_PLAY,
    mirrored: false,
    setup: (s, P) => {
      park(P, s, 0);
      park(P, s, 1);
      const d = new Float64Array(2);
      dir(fractionOfTurn(angleDeg, 360), d);
      const back = 3; // not a setting: a scene's coordinate
      const z = kind === 'high' ? 2 : P.ballRadius; // not a setting: a scene's coordinate
      const vz = kind === 'lobbed' ? 4 : 0; // not a setting: a scene's velocity
      placeBall(P, s, P.pitch.goalLineX - back, -(d[1]! / d[0]!) * back, z, speed * d[0]!, speed * d[1]!, vz);
    },
    input: () => NOTHING,
  };
}
