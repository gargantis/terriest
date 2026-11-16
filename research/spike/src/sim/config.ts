// Every setting the spike's simulation reads: REQUIREMENTS' Configuration
// table, PLAN Appendix A.4's implementation constants and A.5's starting
// values, plus switches the tests need to isolate one effect. Lengths in
// metres, times in ticks unless named otherwise. Exact operations only:
// derived values are built from + − × ÷ and Math.sqrt at load (D-1).

import { dir, fractionOfTurn, TURN } from './angle.ts';

export const TICK_RATE = 60;
/** D-3's substeps a tick, the default's; a configuration sets its own
 *  (SimConfig.substeps), which the simulation reads. */
export const SUBSTEPS = 4;
/** One substep at the default, 1/240 s (D-3). */
export const DT = 1 / (TICK_RATE * SUBSTEPS);

/** A tick value meaning "never" (A.1). */
export const NEVER = 0xffffffff;

export type Pack = 0 | 1;

export interface PitchShape {
  name: string;
  length: number; // x, end wall to end wall (the goal lines)
  width: number; // y, side wall to side wall
  height: number; // walls and the overhead net
  /** Corner cuts, measured along each wall: at (−x,−y), (+x,−y), (+x,+y), (−x,+y).
   *  Point symmetry needs cuts[0] = cuts[2] and cuts[1] = cuts[3] (D-4). */
  cuts: readonly [number, number, number, number];
  mouthWidth: number; // clear, between the posts' inner surfaces
  mouthHeight: number; // clear, under the crossbar
  goalDepth: number;
  postRadius: number; // posts and crossbar are capsules (A.5)
}

/** REQUIREMENTS' pitch: 40 × 28 m, walls and net 6 m, corners cut 4 m along
 *  each wall; goal mouth 8 × 3 m, 2 m deep; posts of radius 0.1 (A.5). */
export const MAIN_PITCH: PitchShape = {
  name: 'main', length: 40, width: 28, height: 6, cuts: [4, 4, 4, 4],
  mouthWidth: 8, mouthHeight: 3, goalDepth: 2, postRadius: 0.1,
};

/** D-4's second test shape: point-symmetric but not mirror-symmetric.
 *  50 × 30 m, 6 m cuts at two opposite corners and 3 m at the other two,
 *  a 10 m goal mouth. */
export const SECOND_PITCH: PitchShape = {
  name: 'second', length: 50, width: 30, height: 6, cuts: [6, 3, 6, 3],
  mouthWidth: 10, mouthHeight: 3, goalDepth: 2, postRadius: 0.1,
};

/** D-5 step 7's slip-out, as a switchable rule (M0 chooses among these). */
export interface SlipOutRule {
  name: string;
  /** A body is above a terrier "within the cone" when the contact normal,
   *  from the terrier to it, has a vertical part above this cosine. */
  cosCone: number;
  coneDeg: number; // for reports only
  /** The lower terrier's horizontal speed out from under it, m/s. */
  speed: number;
  /** A slipping flag holds the drive off toward the body above until that
   *  body is down. */
  flag: boolean;
  /** Restitution 0 on contacts within the cone (would need a §2 row, L311). */
  restitution0: boolean;
}

const cosDeg = (deg: number): number => {
  const d = new Float64Array(2);
  dir(fractionOfTurn(deg, 360), d);
  return d[0]!;
};

/** acos((R − r)/(R + r)) from vertical is where a ball on the floor meets a
 *  standing terrier: 58.4° at the provisional sizes. Cones must stay inside
 *  it, so they never fire on a ball that's down. */
export const FLOOR_CONTACT_COS = (0.8 - 0.25) / (0.8 + 0.25);

/** A slip-out rule from its parts: the cone, from vertical; the flag;
 *  restitution 0 within the cone; and the slip speed. */
export const slipRule = (name: string, coneDeg: number, flag: boolean, restitution0: boolean, speed = 2): SlipOutRule => ({
  name, coneDeg, cosCone: coneDeg === 45 ? Math.sqrt(0.5) : cosDeg(coneDeg), speed, flag, restitution0,
});
const rule = slipRule;

/** The candidates D-5 step 7 names, and the combinations M0 compares. The
 *  wide cone is 58°, just inside the 58.4° of a ball on the floor; 57° is
 *  the review's (research/audit/REPORT.md §9). */
export const SLIP_OUT_RULES = {
  none: { name: 'none', coneDeg: 0, cosCone: 2, speed: 0, flag: false, restitution0: false } as SlipOutRule,
  drafted: rule('drafted', 45, false, false),
  wide: rule('wide', 58, false, false),
  flag: rule('flag', 45, true, false),
  e0: rule('e0', 45, false, true),
  flagE0: rule('flag+e0', 45, true, true),
  wideFlag: rule('wide+flag', 58, true, false),
  wideE0: rule('wide+e0', 58, false, true),
  wideFlagE0: rule('wide+flag+e0', 58, true, true),
  review57: rule('57+flag+e0', 57, true, true),
  // Narrower cones, added at M0: a zoomies dribble lets the ball hop onto
  // its dribbler down to 44.86° from vertical, inside the 45° cone.
  flag42: rule('42+flag', 42, true, false),
  flag40: rule('40+flag', 40, true, false),
  flag42E0: rule('42+flag+e0', 42, true, true),
  flag40E0: rule('40+flag+e0', 40, true, true),
  flag44: rule('44+flag', 44, true, false),
  flag44E0: rule('44+flag+e0', 44, true, true),
} as const satisfies Record<string, SlipOutRule>;
export type SlipOutName = keyof typeof SLIP_OUT_RULES;

export interface SimConfig {
  pitch: PitchShape;
  slipOut: SlipOutRule;
  // Bodies (D-4, A.5)
  ballRadius: number;
  ballMass: number;
  terrierRadius: number;
  terrierMass: number;
  // Forces (D-5 step 1, D-6)
  gravity: number;
  runSpeed: number;
  zoomiesSpeed: number;
  accel: number; // the drive's cap, m/s²
  idleFriction: number; // m/s²
  rollingSlowdown: number; // the ball's, m/s² on the floor
  drive: boolean; // test switches: off isolates contacts (§16 simultaneous hits)
  friction: boolean;
  rolling: boolean;
  // Contacts (D-5, A.4, A.5)
  /** The floor's contacts also take part in steps 5 and 6, as non-pulling
   *  contacts with no bounce, after step 4's support. Off: the floor acts
   *  only through step 4. (D-5 doesn't say; see physics.ts.) */
  floorInSolve: boolean;
  iterations: number; // forward-and-back sweeps over mirror pairs
  positionPasses: number;
  /** Physics substeps a tick (D-3); a substep is 1/(60 × substeps) s. */
  substeps: number;
  restitutionThreshold: number; // m/s
  ballSurface: number; // floor, walls, overhead net, goal frame
  ballGoalNet: number;
  terrierBall: number;
  terrierTerrier: number;
  terrierSurface: number; // walls, nets, frame
  terrierFloor: number;
  // Movement (D-6, D-7)
  turnPerTick: number; // binary-angle units: 2 turns/s
  noseTurnPerTick: number; // 1 turn/s
  noseReverse: number; // m/s
  jumpSpeed: number; // √(2 g × 1 m)
  pounceSpeed: number;
  lungeTicks: number;
  pounceWaitTicks: number;
  tumbleTicks: number;
  getUpTicks: number;
  guardTicks: number;
  bowlingSpeed: number;
  meterFull: number; // half-ticks
  meterDrain: number;
  meterRefill: number;
  overheadEnter2: number; // squared horizontal centre distances
  overheadLeave2: number;
  rearmGap: number;
  sitAfterTicks: number;
  // Match (D-8)
  kickoffCountdownTicks: number;
  celebrationTicks: number; // 3 s seen plus the 0.4 s confirmation (Q-7)
  coats: number;
  /** Gait: binary-angle units per metre run (one stride cycle per 0.6 m). */
  gaitPerMetre: number;
}

const GRAVITY = 9.8;

export const DEFAULT_CONFIG: SimConfig = {
  pitch: MAIN_PITCH,
  // M0's pick: the only candidates that pass all four of §16's slip-out
  // cases are the 42° cone with the slipping flag, with or without
  // restitution 0 (slipout.test.ts). Without it, no §2 row is needed.
  slipOut: SLIP_OUT_RULES.flag42,
  ballRadius: 0.8,
  ballMass: 2,
  terrierRadius: 0.25,
  terrierMass: 1,
  gravity: GRAVITY,
  runSpeed: 6,
  zoomiesSpeed: 9,
  accel: 15,
  idleFriction: 8,
  rollingSlowdown: 0.5,
  drive: true,
  friction: true,
  rolling: true,
  floorInSolve: true,
  iterations: 8,
  positionPasses: 2,
  substeps: SUBSTEPS,
  restitutionThreshold: 0.3,
  ballSurface: 0.7,
  ballGoalNet: 0.3,
  terrierBall: 0.5,
  terrierTerrier: 0.3,
  terrierSurface: 0.3,
  terrierFloor: 0,
  turnPerTick: fractionOfTurn(2, TICK_RATE),
  noseTurnPerTick: TURN / TICK_RATE,
  noseReverse: 3,
  jumpSpeed: Math.sqrt(2 * GRAVITY * 1),
  pounceSpeed: 10,
  lungeTicks: 18,
  pounceWaitTicks: 90,
  tumbleTicks: 90,
  getUpTicks: 30,
  guardTicks: 90,
  bowlingSpeed: 4,
  meterFull: 360,
  meterDrain: 2,
  meterRefill: 1,
  overheadEnter2: 0.3 * 0.3,
  overheadLeave2: 0.4 * 0.4,
  rearmGap: 0.6,
  sitAfterTicks: 120,
  kickoffCountdownTicks: 180,
  celebrationTicks: 204,
  coats: 8,
  gaitPerMetre: TURN / 0.6,
};

export function makeConfig(over: Partial<SimConfig> = {}): SimConfig {
  return { ...DEFAULT_CONFIG, ...over };
}

/** One substep of a configuration, in seconds: 1/240 s at 4 substeps. */
export function substepDt(C: SimConfig): number {
  return 1 / (TICK_RATE * C.substeps);
}

/** Substeps a second, for turning substep counts into seconds. */
export function substepsPerSecond(C: SimConfig): number {
  return TICK_RATE * C.substeps;
}

/** The solver's switchable settings must be whole numbers in range. */
export function checkSolver(C: SimConfig): void {
  if (!Number.isInteger(C.substeps) || C.substeps < 1) throw new Error(`substeps must be a whole number from 1, not ${C.substeps}`);
  if (!Number.isInteger(C.iterations) || C.iterations < 1) throw new Error(`iterations must be a whole number from 1, not ${C.iterations}`);
  if (!Number.isInteger(C.positionPasses) || C.positionPasses < 0) throw new Error(`positionPasses must be a whole number from 0, not ${C.positionPasses}`);
}

/** Kickoff spots for pack A (pack 0), by pack size (A.5). Pack B's are the
 *  point mirror, (x, y) → (−x, −y). Spot k is taken by the k-th terrier. */
export const KICKOFF_SPOTS: readonly (readonly (readonly [number, number])[])[] = [
  [],
  [[-10, 0]],
  [[-9, 4], [-9, -4]],
  [[-9, 5], [-9, -5], [-15, 0]],
  [[-8, 6], [-8, -6], [-14, 3], [-14, -3]],
];
