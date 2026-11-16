// Scripted runs for the goldens, the tests and the scene (PLAN §16, M0 run
// 1): each terrier's u16 input (A.2) is a pure function of the script, the
// terrier and the tick, so any engine replays a run bit for bit. A mirrored
// script gives pack B the point mirror of pack A's input (P8). Dev and test
// only; not a bot.

import { type MatchState, newMatch, IN_PLAY, KICKOFF_COUNTDOWN } from './state.ts';
import { DEFAULT_CONFIG, MAIN_PITCH, makeConfig, SECOND_PITCH, SLIP_OUT_RULES, type SimConfig, type SlipOutName } from './config.ts';
import { encodeInput, FRAME_BALL, FRAME_NOSE, FRAME_PITCH, mirrorInput } from './input.ts';
import { dir, HALF_TURN, TURN } from './angle.ts';

export type InputFn = (k: number, t: number) => number | null;

export interface ScriptSpec {
  name: string;
  packSize: number;
  pitch: 'main' | 'second';
  slipOut: SlipOutName;
  ticks: number; // the golden length
  start: 'countdown' | 'play';
  setup?: (s: MatchState, C: SimConfig) => void;
  input: InputFn;
  /** Pack B's input is the mirror of pack A's (P8). */
  mirrored: boolean;
  config?: Partial<SimConfig>;
}

/** roslambo's scripts.ts mixer. */
export function mix(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** The config a script runs under. */
export function scriptConfig(spec: ScriptSpec): SimConfig {
  return makeConfig({
    pitch: spec.pitch === 'second' ? SECOND_PITCH : MAIN_PITCH,
    slipOut: SLIP_OUT_RULES[spec.slipOut],
    ...spec.config,
  });
}

/** The script's state at tick 0. */
export function scriptStart(spec: ScriptSpec, C: SimConfig = scriptConfig(spec)): MatchState {
  const s = newMatch(spec.packSize, C, spec.start === 'play' ? IN_PLAY : KICKOFF_COUNTDOWN);
  spec.setup?.(s, C);
  return s;
}

/** The inputs of tick t, indexed like the state's terriers. */
export function scriptInputs(spec: ScriptSpec, t: number, out: (number | null)[] = []): (number | null)[] {
  const n = spec.packSize * 2;
  out.length = n;
  for (let k = 0; k < n; k++) {
    if (spec.mirrored && (k & 1) === 1) {
      const a = spec.input(k - 1, t);
      out[k] = a === null ? null : mirrorInput(a);
    } else {
      out[k] = spec.input(k, t);
    }
  }
  return out;
}

// --- Placement helpers ------------------------------------------------------

const R = DEFAULT_CONFIG.ballRadius;
const r = DEFAULT_CONFIG.terrierRadius;
/** Horizontal centre distance of a standing terrier touching a resting ball. */
export const TOUCH_REACH = Math.sqrt((R + r) * (R + r) - (R - r) * (R - r));

export function place(s: MatchState, k: number, x: number, y: number, z = r): void {
  const t = s.terriers[k]!;
  t.x = x; t.y = y; t.z = z;
  t.vx = 0; t.vy = 0; t.vz = 0;
  t.onFloor = z === r;
}

/** Puts a terrier out of the way: a far corner of its own half, facing in. */
export function park(s: MatchState, k: number): void {
  const t = s.terriers[k]!;
  const side = t.pack === 0 ? -1 : 1;
  place(s, k, side * 16, (t.spot - 1.5) * 1.2 * side + side * -9);
}

export function placeBall(s: MatchState, x: number, y: number, z = R, vx = 0, vy = 0, vz = 0): void {
  const b = s.ball;
  b.x = x; b.y = y; b.z = z; b.vx = vx; b.vy = vy; b.vz = vz;
  b.onFloor = z === R && vz === 0;
}

// --- Inputs -------------------------------------------------------------------

export const NOTHING = 0;
export const pitchDir = (step: number, zoomies = false): number => encodeInput({ step, frame: FRAME_PITCH, zoomies });
export const ballDir = (step: number, zoomies = false): number => encodeInput({ step, frame: FRAME_BALL, zoomies });

const BALL_STEPS = [0, 0, 0, 0, 0, 1, 31, 2, 30, 4, 28, 8, 24, 16, 0, 0];
const CONTACT_STEPS = [0, 0, 0, 0, 0, 0, 0, 0, 1, 31, 2, 30, 3, 29, 0, 0];

/** Seeded play: held directions in spells of 23 ticks, mostly at the ball,
 *  some zoomies, and periodic jumps and pounces from press counters. */
/** Seeded play. 'all': a quarter of the spells in the pitch frame, one in
 *  eight in the nose frame, the rest at the ball; 'contact': at the ball,
 *  with a pitch-frame or nose-frame spell one time in eight each, so
 *  terriers keep meeting the ball and each other. */
export function chasey(seed: number, frames: 'ball' | 'all' | 'contact' = 'ball'): InputFn {
  return (k, t) => {
    const h = mix(mix(seed, k), Math.floor(t / 23));
    if ((h & 15) === 0) return encodeInput({ jump: jumps(seed, k, t), pounce: pounces(seed, k, t) }); // idle spell
    let frame = FRAME_BALL;
    let step = (frames === 'contact' ? CONTACT_STEPS : BALL_STEPS)[(h >>> 4) & 15]!;
    const f = (h >>> 8) & 7;
    if (frames === 'all') {
      if (f === 0 || f === 1) { frame = FRAME_PITCH; step = (h >>> 12) & 31; }
      else if (f === 2) { frame = FRAME_NOSE; step = [0, 0, 2, 30, 4, 28, 16, 8][(h >>> 12) & 7]!; }
    } else if (frames === 'contact') {
      if (f === 0) { frame = FRAME_PITCH; step = (h >>> 12) & 31; }
      else if (f === 1) { frame = FRAME_NOSE; step = [0, 0, 2, 30, 4, 28, 16, 8][(h >>> 12) & 7]!; }
    }
    return encodeInput({
      step, frame, zoomies: ((h >>> 20) & 3) === 0,
      jump: jumps(seed, k, t), pounce: pounces(seed, k, t),
    });
  };
}

const jumps = (seed: number, k: number, t: number): number => Math.floor((t + (mix(seed, k) & 63)) / (97 + 13 * (k >> 1)));
const pounces = (seed: number, k: number, t: number): number => Math.floor((t + (mix(seed, k + 50) & 63)) / (131 + 17 * (k >> 1)));

/** Holds one input for some terriers and nothing for the rest. */
function holding(which: (k: number) => boolean, input: number): InputFn {
  return (k) => (which(k) ? input : NOTHING);
}

// --- Setups -------------------------------------------------------------------

/** Pack A's terriers 0..m−1 (state indices 0, 2, 4, 6) behind the ball. */
const packA = (j: number): number => 2 * j;

/** Round the back of the ball, touching it: 33° apart, just clear of each
 *  other (a 0.508 m chord against the 0.5 m they need). */
const ROUND_STEP_720THS = 33 * 2;

function pushSetup(layout: 'train' | 'line' | 'round', m: number): (s: MatchState) => void {
  return (s) => {
    for (let k = 0; k < s.terriers.length; k++) park(s, k);
    placeBall(s, 0, 0);
    const d = new Float64Array(2);
    for (let j = 0; j < m; j++) {
      const k = packA(j);
      if (layout === 'train') {
        // One behind another, each touching the next.
        place(s, k, -TOUCH_REACH - 0.5 * j, 0);
      } else if (layout === 'line') {
        // On a straight line abreast, 0.52 m apart; the middle ones touch the ball.
        place(s, k, -Math.sqrt(TOUCH_REACH * TOUCH_REACH - 0.26 * 0.26), (j - (m - 1) / 2) * 0.52);
      } else {
        const offset = Math.round(((2 * j - (m - 1)) * ROUND_STEP_720THS * TURN) / 1440);
        dir((HALF_TURN + offset) >>> 0, d);
        place(s, k, TOUCH_REACH * d[0]!, TOUCH_REACH * d[1]!);
      }
    }
  };
}

// --- The suite ------------------------------------------------------------------

const base = { pitch: 'main' as const, slipOut: 'drafted' as SlipOutName, mirrored: false, start: 'play' as 'play' | 'countdown' };

function kickoff(packSize: number, pitch: 'main' | 'second', seed: number, slipOut: SlipOutName = 'drafted'): ScriptSpec {
  return {
    ...base, name: `kickoff ${packSize}${pitch === 'second' ? ', second shape' : ''}${slipOut !== 'drafted' ? `, ${slipOut}` : ''}`,
    packSize, pitch, slipOut, ticks: 3000, start: 'countdown', mirrored: true, input: chasey(seed, 'contact'),
  };
}

/** The kickoff pinch (C-21): everyone holds at the ball from the whistle. */
export function pinch(packSize: number, slipOut: SlipOutName = 'drafted', zoomies = false): ScriptSpec {
  return {
    ...base, name: `pinch ${packSize}${zoomies ? ', zoomies' : ''}${slipOut !== 'drafted' ? `, ${slipOut}` : ''}`,
    packSize, slipOut, ticks: 1500, start: 'countdown', mirrored: true, input: () => ballDir(0, zoomies),
  };
}

export function pushScript(name: string, layout: 'train' | 'line' | 'round', m: number, frame: 'pitch' | 'ball', ticks = 600): ScriptSpec {
  const packSize = m <= 1 ? 1 : m <= 2 ? 2 : 4;
  const input = frame === 'pitch' ? pitchDir(0) : ballDir(0);
  return { ...base, name, packSize, ticks, setup: pushSetup(layout, m), input: holding((k) => (k & 1) === 0 && k >> 1 < m, input) };
}

export const GOLDEN_SCRIPTS: ScriptSpec[] = [
  kickoff(1, 'main', 1), kickoff(2, 'main', 2), kickoff(3, 'main', 3), kickoff(4, 'main', 4),
  kickoff(2, 'second', 5), kickoff(4, 'second', 6),
  {
    ...base, name: 'resting ball', packSize: 1, ticks: 3000,
    setup: (s) => { place(s, 0, -3, 2); place(s, 1, 3, -2); },
    input: () => NOTHING,
  },
  {
    ...base, name: 'rolling ball', packSize: 1, ticks: 3000,
    setup: (s) => placeBall(s, -6, -3, R, 3, 1.5),
    input: () => NOTHING,
  },
  pushScript('push 1', 'train', 1, 'pitch'),
  pushScript('train 2', 'train', 2, 'pitch'),
  pushScript('train 3', 'train', 3, 'pitch'),
  pushScript('train 4', 'train', 4, 'pitch'),
  pushScript('abreast 2, pitch frame', 'round', 2, 'pitch'),
  pushScript('abreast 3, pitch frame', 'round', 3, 'pitch'),
  pushScript('abreast 4, pitch frame', 'round', 4, 'pitch'),
  pushScript('abreast 2, ball frame', 'round', 2, 'ball'),
  pushScript('abreast 3, ball frame', 'round', 3, 'ball'),
  pushScript('abreast 4, ball frame', 'round', 4, 'ball'),
  {
    ...base, name: 'squeeze', packSize: 1, ticks: 1200, mirrored: true,
    setup: (s) => { place(s, 0, -TOUCH_REACH - 1, 0); place(s, 1, TOUCH_REACH + 1, 0); },
    input: () => pitchDir(0),
  },
  pinch(1), pinch(2), pinch(3), pinch(4), pinch(4, 'drafted', true),
  pinch(2, 'flag42'), pinch(4, 'flag42', true), pinch(3, 'flag42E0'),
  kickoff(4, 'main', 8, 'flag42'), kickoff(3, 'second', 9, 'flag42E0'),
  scrum('drafted'), scrum('flag42'), scrum('flag42E0'), cornerScrum('drafted'), cornerScrum('flag42'),
  {
    ...base, name: 'pounces', packSize: 2, ticks: 3000,
    setup: (s) => {
      placeBall(s, 0, 0);
      place(s, 0, -4, 1); place(s, 1, 4, 1); place(s, 2, -3, -2); place(s, 3, 2, -3);
    },
    input: (k, t) => encodeInput({ step: [0, 0, 4, 28][(t >> 6) & 3]!, frame: FRAME_BALL, pounce: Math.floor((t + 20 * k) / 50) }),
  },
  {
    ...base, name: 'goals', packSize: 1, ticks: 3000,
    setup: (s) => { placeBall(s, -15, 0.5); place(s, 1, -13.5, 0.5); place(s, 0, -10, -6); },
    // B pushes the ball into A's goal, then both chase it from the kickoff.
    input: (k, t) => (t < 400 ? (k === 1 ? pitchDir(16) : NOTHING) : ballDir(0, (t & 255) < 64)),
  },
  { ...base, name: 'long run', packSize: 4, ticks: 20000, start: 'countdown', input: chasey(7, 'all') },
];

/** 4 a side scrumming at the ball against the +y side wall (M0 run 3):
 *  every terrier holds at it in the ball frame, each with zoomies in
 *  alternate 32-tick spells. */
function scrum(slipOut: SlipOutName): ScriptSpec {
  return {
    ...base, name: `scrum at the wall${slipOut !== 'drafted' ? `, ${slipOut}` : ''}`, packSize: 4, slipOut, ticks: 3000,
    setup: (s) => {
      placeBall(s, 0, 14 - R);
      for (let k = 0; k < 8; k++) {
        const side = (k & 1) === 0 ? -1 : 1;
        const j = k >> 1;
        place(s, k, side * (1.0 + 0.55 * j), 14 - R - 0.4 - 0.5 * (j & 1));
      }
    },
    input: (k, t) => ballDir(0, ((t >> 5) + k) % 2 === 0),
  };
}

/** The same in the (+x, +y) cut corner, the densest contact the spike has:
 *  the ball touching the corner wall, the terriers packed behind it. */
function cornerScrum(slipOut: SlipOutName): ScriptSpec {
  return {
    ...base, name: `scrum in the corner${slipOut !== 'drafted' ? `, ${slipOut}` : ''}`, packSize: 4, slipOut, ticks: 3000,
    setup: (s) => {
      // On the corner's inward normal, (−1, −1)/√2, R in from its wall.
      const back = Math.sqrt(0.5);
      const cx = 18 - (R / back) / 2 - 0.4;
      const cy = 12 - (R / back) / 2 + 0.4;
      placeBall(s, cx, cy);
      for (let k = 0; k < 8; k++) {
        const row = k >> 2;
        const col = (k & 3) - 1.5;
        // Rows 1.3 m and 1.9 m back along the normal, 0.55 m apart across it.
        const along = 1.3 + 0.6 * row;
        place(s, k, cx - along * back + col * 0.55 * back, cy - along * back - col * 0.55 * back);
      }
    },
    input: (k, t) => ballDir(0, ((t >> 5) + k) % 2 === 0),
  };
}

/** The script for the scene's page: a lively seeded match at any pack size. */
export function showcase(packSize: number, slipOut: SlipOutName = 'flag42'): ScriptSpec {
  return { ...base, name: `showcase ${packSize}`, packSize, slipOut, ticks: 1 << 30, start: 'countdown', input: chasey(1000 + packSize, 'all') };
}

/** D-23's canary, for the spike: the 4-a-side corner scrum's first 400 ticks. */
export const CANARY_SCRIPT: ScriptSpec = { ...cornerScrum('flag42'), name: 'canary', ticks: 400 };

export function findScript(name: string): ScriptSpec | undefined {
  return GOLDEN_SCRIPTS.find((s) => s.name === name);
}
