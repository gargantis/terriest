// M0's scenes and the helpers that build them, in one place (design §1.12),
// so the physics tests, the goldens, the canary, the cases, the marks, the
// tuning page and the metrics all run the same scenes; from M4 the placing
// helpers are placing.ts's, re-exported here (M4-Q5). From the M0 spike's
// scripts.ts (the placement helpers, the inputs, chasey, and the push,
// pinch, squeeze and scrum setups) and cases.ts (the rest and dribble
// setups). The spike's literal radii are read from SimParams; its
// coordinates and inputs stay, each marked where the configuration scan
// would read one as a setting. M2 adds design §9.6's shots into the
// netting, and C-18's lone pusher off the axes. It ships in the
// determinism chunk, so it keeps to exact operations (D-1).
//
// A placed state may hold fewer terriers than its pack size (members):
// warm-up has holes anyway, and in play it's a test-only state, the
// empty-goal mark's (design §2.3, §8.5), which step handles, since
// everything indexes by slot, and which stateProblems reports once the
// rules' checks are in (design §6.7), so it never comes from a peer.

import { encodeInput, FRAME_BALL, FRAME_NOSE, FRAME_PITCH, mirrorInput, type TickInput } from './input';
import { dir, fractionOfTurn, HALF_TURN, mix, TURN } from './math';
import { ballDir, NOTHING, park, pitchDir, place, placeBall, type Scene, type SceneInput, touchReach } from './placing';
import { IN_PLAY, KICKOFF_COUNTDOWN, type MatchState, type Pack } from './state';

// Placing a scene, placing.ts's from M4, re-exported here unchanged: the canary's replay, in the page's
// module, needs it without this module's scenes, the golden runs', named as the runs are (M4-Q5).
export {
  ballDir, NOTHING, park, pitchDir, place, placeBall, placedMatch, type PlacedOptions, rankedIds, type Scene, sceneStart, type SceneInput,
  touchReach,
} from './placing';

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

/** C-18's lone pusher off the axes, where dir() rounds: the angles round
 *  the back of the ball at which assist.test.ts and the metrics push. */
export const ONE_PUSHER_DEGREES: readonly number[] = [7, 30, 45, 61, 135, 200]; // not a setting: a scene's angles

/** Pack A's first terrier alone pushes the ball from rest at the centre
 *  spot, touching it from deg° round from −x, holding at it in the ball
 *  frame (C-18). Everyone else is parked. */
export function onePusherScene(deg: number): Scene {
  return {
    name: `one pusher at ${deg}°, ball frame`,
    packSize: 1, // not a setting
    phase: IN_PLAY,
    mirrored: false,
    setup: (s, P) => {
      park(P, s, 0);
      park(P, s, 1);
      placeBall(P, s, 0, 0);
      const reach = touchReach(P);
      const d = new Float64Array(2);
      dir((HALF_TURN + fractionOfTurn(deg, 360)) >>> 0, d);
      place(P, s, 0, reach * d[0]!, reach * d[1]!);
    },
    input: (pack, rank) => (pack === 0 && rank === 0 ? ballDir(0) : NOTHING),
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
        place(P, s, 2 * j + 1, -ax, -ay + (c.offMirror === true ? 0.02 : 0)); // not a setting: a scene's offset
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
 *  netting.test.ts holds the settled value with them in the gate (design
 *  §11). */
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
