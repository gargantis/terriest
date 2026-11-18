// The bot brain (PLAN D-39, Q-9, L142; design §1.18, §8). It runs on the
// host only, once a local tick, never in the timeline's re-simulations: it
// reads the state, the predicted head at M3, and returns the u16 input a
// person would send, in the pitch frame (A.2, D-7). Its memory is its own,
// and nothing it holds is in the state: its press counters, a ring of what
// it has seen, its aim noise, its bark times, its zoomies and its stuck
// tracking. It takes no time but the state's tick and no randomness but
// mix() seeded by its ID, with exact operations only, so its seeded marks
// count the same on every machine (D-39). It reads bodies by slot and skips
// empty ones, so the empty-goal mark's short pack is an ordinary state to
// it (design §0).
//
// In play, roles go by distance rank within the pack (Q-9): the nearest
// chases while no rival is nearer the ball, and falls back to get between
// the ball and its own goal when one is, meeting the ball from there
// (L142); the second supports behind the ball; the rest defend.

import { config, type Config, derive } from '../../config';
import { BARK_SHIFT, HELD, JUMP_SHIFT, jumpCount, POUNCE_SHIFT, pounceCount, ZOOMIES } from '../sim/input';
import { angleDiff, datan2, dir, fractionOfTurn, mix } from '../sim/math';
import type { SimParams } from '../sim/params';
import { ENDED, findTerrier, IN_PLAY, KICKOFF_COUNTDOWN, type MatchState, slotOf, START_COUNTDOWN, type Terrier, WARM_UP } from '../sim/state';
import { botSeed } from './bot-id';

/** The brain's settings (A.4's Bot brain, design §8.4), in its units. */
export interface BotParams {
  readonly reactionTicks: number; // it decides from what it saw this long ago
  readonly aimNoiseUnits: number; // binary-angle units either way
  readonly zoomiesBeyond: number; // metres to its target
  readonly pounceWithin: number; // metres from the ball's surface
  readonly pounceAlignUnits: number; // binary-angle units
  readonly supportMetres: number;
  readonly defendMetres: number;
  readonly barkEveryTicks: number;
  readonly barkGapTicks: number; // the Bark setting's gap (L327)
  readonly stuckTicks: number;
  readonly stuckMetres: number;
}

export function botParams(c: Config = config): BotParams {
  const d = derive(c);
  return Object.freeze({
    reactionTicks: d.botReactionTicks,
    aimNoiseUnits: fractionOfTurn(c.botAimNoiseDegrees, 360), // not a setting: degrees a turn
    zoomiesBeyond: c.botZoomiesBeyondMetres,
    pounceWithin: c.botPounceWithinMetres,
    pounceAlignUnits: fractionOfTurn(c.botPounceAlignDegrees, 360), // not a setting: degrees a turn
    supportMetres: c.botSupportMetres,
    defendMetres: c.botDefendMetres,
    barkEveryTicks: d.botBarkEveryTicks,
    barkGapTicks: d.barkGapTicks,
    stuckTicks: d.botStuckTicks,
    stuckMetres: c.botStuckMetres,
  });
}

/** The brain's settings from src/config.ts. */
export const defaultBotParams: BotParams = botParams(config);

// What it's doing: the roles in play (Q-9), and the phases' own behaviour.
export const CHASE = 0; // not a setting: a role's code
export const FALL_BACK = 1; // not a setting: a role's code
export const SUPPORT = 2; // not a setting: a role's code
export const DEFEND = 3; // not a setting: a role's code
export const WANDER = 4; // not a setting: warm-up's
export const FACE = 5; // not a setting: a countdown's
export const IDLE = 6; // not a setting: a celebration, the end, or absent
export type Role = typeof CHASE | typeof FALL_BACK | typeof SUPPORT | typeof DEFEND | typeof WANDER | typeof FACE | typeof IDLE;

/** A bot's brain: its ID, and host-local memory that never enters the state. */
export interface Brain {
  readonly id: string;
  /** What its last think() decided, for the tests and the tuning page. */
  readonly role: Role;
}

// The brain's geometry (design §8.2), each line marked for the
// configuration scan (src/config.ts holds the settings).
const APPROACH = 0.3; // not a setting: the brain's geometry, the approach point's slack behind the ball
const SIDE_WAYPOINT = 1; // not a setting: the brain's geometry, the side waypoint's offset beyond touching
const KEEP_OUT = 0.15; // not a setting: the brain's geometry, its berth round the ball
const ALIGNED = 0.4; // not a setting: the brain's geometry, |side| / behind under which it pushes, about 22°
const PUSH_ACROSS = 1; // not a setting: the brain's geometry, how far across the line it aims, per metre off it
const PUSH_LEAD = 0.25; // not a setting: the brain's geometry, the goalward velocity it pushes for, past run speed, as a fraction
// §16's fall-back mark measures the way to its own Q, 3 m from the ball
// (marks.ts's fallBackRun), so the brain's Q stays near it (bots-F1).
const FALL_BACK_METRES = 3; // not a setting: the brain's geometry, Q's distance from the ball
const MEET_METRES = 1.5; // not a setting: the brain's geometry, it meets the ball from within this of Q
const HOLD_METRES = 0.5; // not a setting: the brain's geometry, a support or defence target it holds at
const CLAMP_METRES = 1; // not a setting: the brain's geometry, targets stay this far inside the floor plan
const DEFEND_SPREAD = 1.5; // not a setting: the brain's geometry, each defender after the first, sideways
const POUNCE_HIGH = 2; // not a setting: the brain's geometry, the ball's centre under this
const JUMP_LOW = 1.5; // not a setting: the brain's geometry, the ball's centre from this, its underside over a terrier's back, …
const JUMP_HIGH = 2.5; // not a setting: the brain's geometry, … to this
const JUMP_REACH = 1.5; // not a setting: the brain's geometry, horizontally
const ESCAPE_TICKS = 30; // not a setting: the brain's geometry, the unstick's escape
const ESCAPE_STEPS = [16, 8, 24]; // not a setting: the brain's geometry, each escape's turn from the held step
const WANDER_TICKS = 90; // not a setting: the brain's geometry, a warm-up spell
const STEP_ROUND = 67108864; // not a setting: half of one of A.2's steps, 2^26 units
const OPEN_TURN = 24; // not a setting: the brain's geometry, a blocked push line turns by a 24th of a turn, 15°, at a time …
const OPEN_TURNS = 6; // not a setting: the brain's geometry, … up to 90° each way

// mix() streams, so the noise, the barks and the wander draw apart.
const NOISE_STREAM = 1; // not a setting: a stream's code
const BARK_STREAM = 2; // not a setting: a stream's code
const WANDER_STREAM = 3; // not a setting: a stream's code

// A ring entry: the ball's x, y, z, vx and vy, then each slot's flag, x and y.
const BALL_FLOATS = 5; // not a setting: the ring's layout
const ABSENT = 0; // not a setting: a slot's flag
const ACTING = 1; // not a setting: a slot's flag, present and able to act
const DOWN = 2; // not a setting: a slot's flag, present but sitting or tumbled

interface Mind extends Brain {
  role: Role;
  readonly P: SimParams;
  readonly B: BotParams;
  readonly seed: number;
  readonly entry: number; // floats in a ring entry
  readonly ring: Float64Array; // reactionTicks + 1 entries
  seen: number; // entries written since it last found its terrier
  jump: number; // press counters, mod 4 (D-10)
  pounce: number;
  bark: number;
  barks: number; // barks so far, and the tick of the next; −1 before the first think
  nextBark: number;
  held: boolean; // what its last input held
  step: number;
  zoom: boolean;
  streakTick: number; // where and since when it has held a direction, free
  streakX: number;
  streakY: number;
  escapes: number; // escapes in this streak, turned from the step it was stuck holding
  stuckStep: number;
  escapeEnd: number; // the tick its escape ends
  escapeStep: number;
  bx: number; // the ball as it decides from: seen reactionTicks ago, carried on by its velocity then
  by: number;
  bz: number;
  bvx: number; // and its velocity, as seen then
  bvy: number;
  far: boolean; // its target, before any way round the ball, is past the zoomies distance
  meeting: boolean; // FALL_BACK: it reached Q goal-side, and meets the ball until the ball gets past it
  readonly out: Float64Array; // a target point: scratch
  readonly d: Float64Array; // dir()'s output: scratch
  readonly w: Float64Array; // a push line: scratch
  readonly c: Float64Array; // an approach point: scratch
}

/** A brain for bot `id`, its press counters started from its terrier's
 *  stored previous input, so its first input presses nothing (D-10). */
export function newBrain(id: string, prevInput: number, P: SimParams, B: BotParams = defaultBotParams): Brain {
  const entry = BALL_FLOATS + 3 * 2 * P.packSizeMax; // not a setting: a slot's flag, x and y
  const mind: Mind = {
    id,
    role: IDLE,
    P,
    B,
    seed: botSeed(id),
    entry,
    ring: new Float64Array((B.reactionTicks + 1) * entry),
    seen: 0,
    jump: jumpCount(prevInput),
    pounce: pounceCount(prevInput),
    bark: 0,
    barks: 0,
    nextBark: -1,
    held: false,
    step: 0,
    zoom: false,
    streakTick: 0,
    streakX: 0,
    streakY: 0,
    escapes: 0,
    stuckStep: 0,
    escapeEnd: 0,
    escapeStep: 0,
    bx: 0,
    by: 0,
    bz: 0,
    bvx: 0,
    bvy: 0,
    far: false,
    meeting: false,
    out: new Float64Array(2),
    d: new Float64Array(2),
    w: new Float64Array(2),
    c: new Float64Array(2),
  };
  return mind;
}

/** The bot's u16 input for the tick after s (A.2, in the pitch frame), from
 *  the state alone. */
export function think(brain: Brain, s: Readonly<MatchState>): number {
  const m = brain as Mind;
  const k = findTerrier(s, m.id);
  if (k < 0) {
    // Absent: its JOIN, when the state shows it, starts a previous input of 0.
    m.role = IDLE;
    m.meeting = false;
    m.seen = 0;
    m.jump = 0;
    m.pounce = 0;
    m.bark = 0;
    m.held = false;
    m.zoom = false;
    return 0;
  }
  const T = s.terriers[k]!;
  if (s.phase === ENDED) {
    // Nothing held, and no counter moves: the end is terminal (design §6.6).
    m.role = IDLE;
    m.held = false;
    m.zoom = false;
    return counters(m);
  }
  const v = perceive(m, s);
  bark(m, s.tick);
  let step = -1;
  let zoom = false;
  let jumpPress = false;
  let pouncePress = false;
  const phase = s.phase;
  if (phase !== IN_PLAY) m.meeting = false;
  if (phase === IN_PLAY) {
    step = play(m, s, T, v);
    const role = m.role;
    zoom = step >= 0 && (role === CHASE || role === FALL_BACK) && m.far;
    pouncePress = role === CHASE && pounceReady(m, T);
    jumpPress = jumpReady(m, T);
  } else if (phase === WARM_UP) {
    m.role = WANDER;
    const h = mix(mix(m.seed, WANDER_STREAM), Math.floor(s.tick / WANDER_TICKS));
    if ((h & 7) !== 0) {
      // A seeded point on the floor plan, a spell at a time; zoomies one spell in four.
      const shape = m.P.pitch.shape;
      const x = (((h >>> 3) & 1023) / 1023 - 0.5) * shape.lengthMetres; // not a setting: a 10-bit fraction
      const y = (((h >>> 13) & 1023) / 1023 - 0.5) * shape.widthMetres; // not a setting: a 10-bit fraction
      clampInside(m.P, x, y, CLAMP_METRES + CLAMP_METRES, m.out);
      step = stepToward(m, s.tick, T.x, T.y, m.out[0]!, m.out[1]!);
      zoom = ((h >>> 23) & 3) === 0;
    }
  } else if (phase === START_COUNTDOWN || phase === KICKOFF_COUNTDOWN) {
    // Turn on its spot to face the ball: the held step acts from the first tick of play.
    m.role = FACE;
    step = stepToward(m, s.tick, T.x, T.y, m.bx, m.by);
  } else {
    // A celebration: nothing held.
    m.role = IDLE;
  }
  // The unstick rule (design §8.2), from where the last input left it.
  const free = !T.sitting && T.tumble === 0 && T.lunge === 0 && (phase === IN_PLAY || phase === WARM_UP);
  const sx = T.x - m.streakX;
  const sy = T.y - m.streakY;
  if (!(m.held && free) || sx * sx + sy * sy > m.B.stuckMetres * m.B.stuckMetres) {
    m.streakTick = s.tick;
    m.streakX = T.x;
    m.streakY = T.y;
    m.escapes = 0;
  }
  if (!free) {
    m.escapeEnd = 0;
  } else if (s.tick < m.escapeEnd) {
    step = m.escapeStep;
    zoom = false;
    pouncePress = false;
    jumpPress = false;
  } else if (m.held && s.tick - m.streakTick >= m.B.stuckTicks) {
    // Held for the stuck time without leaving its circle: the other way,
    // and if that fails, each side in turn. On the floor, with no jump: the
    // drive acts only there, and a jump's 0.9 s in the air outlasts the
    // escape (design §8.2, amended at M2's integration).
    if (m.escapes === 0) m.stuckStep = m.step;
    m.escapeStep = (m.stuckStep + ESCAPE_STEPS[m.escapes % ESCAPE_STEPS.length]!) & 31;
    m.escapeEnd = s.tick + ESCAPE_TICKS;
    m.escapes++;
    step = m.escapeStep;
    zoom = false;
    pouncePress = false;
    jumpPress = false;
  }
  // Zoomies: released while locked out, and begun again only from a meter half full.
  zoom = zoom && step >= 0 && !T.zoomLocked && (m.zoom || T.meter >= m.P.meterFull * 0.5);
  if (jumpPress) m.jump = (m.jump + 1) & 3;
  if (pouncePress) m.pounce = (m.pounce + 1) & 3;
  m.held = step >= 0;
  if (step >= 0) m.step = step;
  m.zoom = zoom;
  return (step >= 0 ? step | HELD : 0) | (zoom ? ZOOMIES : 0) | counters(m);
}

/** The press counters' bits. */
function counters(m: Mind): number {
  return (m.jump << JUMP_SHIFT) | (m.pounce << POUNCE_SHIFT) | (m.bark << BARK_SHIFT);
}

/** Writes this tick's entry, and returns the offset of the one it decides
 *  from: reactionTicks old, or the oldest it has, so a fresh brain acts on
 *  what it sees at once. It reads the ball's place from that entry carried
 *  on by the velocity it saw then, as a player judges a rolling ball, into
 *  m.bx and m.by. */
function perceive(m: Mind, s: Readonly<MatchState>): number {
  const n = m.B.reactionTicks + 1;
  const ring = m.ring;
  const at = (m.seen % n) * m.entry;
  const b = s.ball;
  ring[at] = b.x;
  ring[at + 1] = b.y;
  ring[at + 2] = b.z;
  ring[at + 3] = b.vx;
  ring[at + 4] = b.vy;
  for (let j = at + BALL_FLOATS; j < at + m.entry; j += 3) ring[j] = ABSENT;
  const list = s.terriers;
  for (let k = 0; k < list.length; k++) {
    const T = list[k]!;
    const j = at + BALL_FLOATS + 3 * slotOf(T);
    if (j >= at + m.entry) continue;
    ring[j] = T.sitting || T.tumble > 0 ? DOWN : ACTING;
    ring[j + 1] = T.x;
    ring[j + 2] = T.y;
  }
  m.seen++;
  const back = Math.min(m.B.reactionTicks, m.seen - 1);
  const v = ((m.seen - 1 - back) % n) * m.entry;
  // Where that ball is now, if it kept its velocity, inside the floor plan.
  const lead = back * m.P.tickSeconds;
  clampInside(m.P, ring[v]! + ring[v + 3]! * lead, ring[v + 1]! + ring[v + 4]! * lead, m.P.ballRadius, m.out);
  m.bx = m.out[0]!;
  m.by = m.out[1]!;
  m.bz = ring[v + 2]!;
  m.bvx = ring[v + 3]!;
  m.bvy = ring[v + 4]!;
  return v;
}

/** A bark about every barkEveryTicks, each drawn within the bark gap either
 *  side of it after the last, so none comes within the gap (L327). */
function bark(m: Mind, tick: number): void {
  if (m.nextBark < 0) {
    m.nextBark = tick + barkDelay(m, 0);
  } else if (tick >= m.nextBark) {
    m.bark = (m.bark + 1) & 3;
    m.barks++;
    m.nextBark = tick + barkDelay(m, m.barks);
  }
}

function barkDelay(m: Mind, n: number): number {
  const gap = m.B.barkGapTicks;
  return m.B.barkEveryTicks + (mix(mix(m.seed, BARK_STREAM), n) % (2 * gap + 1)) - gap;
}

/** The aim noise at a tick: a uniform offset of up to aimNoiseUnits either
 *  way, redrawn every reactionTicks (design §8.2). */
function noise(m: Mind, tick: number): number {
  const N = m.B.aimNoiseUnits;
  if (N === 0) return 0;
  const R = m.B.reactionTicks;
  const period = R > 0 ? Math.floor(tick / R) : tick;
  return (mix(mix(m.seed, NOISE_STREAM), period) % (2 * N + 1)) - N;
}

/** The pitch-frame step, 0–31, from (x, y) toward (tx, ty), with the aim
 *  noise, rounded to the nearest of A.2's 32. */
function stepToward(m: Mind, tick: number, x: number, y: number, tx: number, ty: number): number {
  return ((datan2(ty - y, tx - x) + noise(m, tick) + STEP_ROUND) >>> 27) & 31;
}

/** In play: its role, from the delayed view, and the step toward that role's
 *  target, in m.out; −1 to hold nothing. */
function play(m: Mind, s: Readonly<MatchState>, T: Readonly<Terrier>, v: number): number {
  const P = m.P;
  const B = m.B;
  const ring = m.ring;
  const reach = P.ballRadius + P.terrierRadius;
  const pack = T.pack;
  const own = pack === 0 ? -P.pitch.goalLineX : P.pitch.goalLineX; // its goal's centre, at y = 0
  // Its rank in the pack by horizontal distance to the ball, ties to the
  // lower slot, and whether a rival is nearer: terriers that can act only,
  // all as the entry saw them.
  const sbx = ring[v]!;
  const sby = ring[v + 1]!;
  const mine = slotOf(T);
  const base = v + BALL_FLOATS;
  let mx = T.x;
  let my = T.y;
  if (ring[base + 3 * mine] !== ABSENT) {
    mx = ring[base + 3 * mine + 1]!;
    my = ring[base + 3 * mine + 2]!;
  }
  const myD = (mx - sbx) * (mx - sbx) + (my - sby) * (my - sby);
  let rank = 0;
  let rival = false;
  const slots = 2 * s.packSize;
  for (let k = 0; k < slots; k++) {
    if (k === mine || ring[base + 3 * k] !== ACTING) continue;
    const dx = ring[base + 3 * k + 1]! - sbx;
    const dy = ring[base + 3 * k + 2]! - sby;
    const d = dx * dx + dy * dy;
    if ((k & 1) === pack) {
      if (d < myD || (d === myD && k < mine)) rank++;
    } else if (d < myD) {
      rival = true;
    }
  }
  // Steering is from where it is now, to where it judges the ball is.
  const x = T.x;
  const y = T.y;
  const bx = m.bx;
  const by = m.by;
  const out = m.out;
  const gx = own - bx;
  const gy = -by;
  const gl = Math.sqrt(gx * gx + gy * gy);
  if (rank !== 0 || !rival) m.meeting = false;
  if (rank === 0 && !rival) {
    // CHASE: push it toward the attacked goal's centre.
    m.role = CHASE;
    return steer(m, s.tick, x, y, push(m, x, y, bx, by, -own - bx, -by, pack));
  }
  if (rank === 0) {
    // FALL_BACK: to Q, 3 m from the ball toward its own goal's centre; then
    // from there, meet the ball and clear it away from that goal (L142).
    // The meet begins goal-side within MEET_METRES of Q and lasts while it
    // stays goal-side, so it carries on to the ball (design §8.2, amended
    // at M2's integration).
    m.role = FALL_BACK;
    let qx = own;
    let qy = 0;
    if (gl > FALL_BACK_METRES) {
      qx = bx + (gx / gl) * FALL_BACK_METRES;
      qy = by + (gy / gl) * FALL_BACK_METRES;
    }
    clampInside(P, qx, qy, P.terrierRadius, out);
    qx = out[0]!;
    qy = out[1]!;
    const goalSide = (x - bx) * gx + (y - by) * gy > 0;
    const dqx = x - qx;
    const dqy = y - qy;
    if (!(goalSide && gl > 0)) m.meeting = false;
    else if (dqx * dqx + dqy * dqy <= MEET_METRES * MEET_METRES) m.meeting = true;
    return steer(m, s.tick, x, y, m.meeting ? push(m, x, y, bx, by, -gx, -gy, pack) : true);
  }
  if (rank === 1) {
    // SUPPORT: behind the ball, toward its own goal.
    m.role = SUPPORT;
    const f = gl > 0 ? B.supportMetres / gl : 0;
    clampInside(P, bx + gx * f, by + gy * f, CLAMP_METRES, out);
  } else {
    // DEFEND: on the line from its own goal's centre to the ball, out from
    // the goal line, short of the ball; each after the first beside it.
    m.role = DEFEND;
    const far = Math.min(B.defendMetres, Math.max(CLAMP_METRES, gl - reach - APPROACH));
    const ux = gl > 0 ? -gx / gl : pack === 0 ? 1 : -1;
    const uy = gl > 0 ? -gy / gl : 0;
    const spread = (rank - 2) * DEFEND_SPREAD;
    clampInside(P, own + ux * far - uy * spread, uy * far + ux * spread, CLAMP_METRES, out);
  }
  const hx = out[0]! - x;
  const hy = out[1]! - y;
  if (hx * hx + hy * hy <= HOLD_METRES * HOLD_METRES) return -1;
  return steer(m, s.tick, x, y, true);
}

/** The step toward m.out, round the ball when `avoid`. m.far records
 *  whether the target itself, before any way round, is past the zoomies
 *  distance. */
function steer(m: Mind, tick: number, x: number, y: number, avoid: boolean): number {
  const out = m.out;
  const dx = out[0]! - x;
  const dy = out[1]! - y;
  m.far = dx * dx + dy * dy > m.B.zoomiesBeyond * m.B.zoomiesBeyond;
  if (avoid) avoidBall(m, x, y, m.bx, m.by, m.P.ballRadius + m.P.terrierRadius + KEEP_OUT);
  return stepToward(m, tick, x, y, out[0]!, out[1]!);
}

/** Where to go to send the ball along (wx, wy), into m.out: it pushes along
 *  the change of velocity the ball needs to roll that way at run speed, so
 *  a ball rolling off the line is struck from the side that turns it back
 *  (design §8.2). True when the ball is to be avoided on the way. */
function push(m: Mind, x: number, y: number, bx: number, by: number, wx: number, wy: number, pack: number): boolean {
  const own = pack === 0 ? -m.P.pitch.goalLineX : m.P.pitch.goalLineX;
  const wl = Math.sqrt(wx * wx + wy * wy);
  if (!(wl > 0)) openLine(m, bx, by, pack === 0 ? 1 : -1, 0, own);
  else {
    const S = m.P.runSpeed * (1 + PUSH_LEAD);
    const ux = (wx / wl) * S - m.bvx;
    const uy = (wy / wl) * S - m.bvy;
    const ul = Math.sqrt(ux * ux + uy * uy);
    if (ul > 0) openLine(m, bx, by, ux / ul, uy / ul, own);
    else openLine(m, bx, by, wx / wl, wy / wl, own);
  }
  return approach(m, x, y, bx, by, m.w[0]!, m.w[1]!);
}

/** The push line (wx, wy) into m.w, or, where a wall behind the ball would
 *  put its approach point, kept inside the floor plan, within the ball's
 *  reach, the line turned away from that wall: 15° at a time each way, the
 *  way that sends the ball further from its own goal's centre first, up to
 *  90°. A ball resting on its own end wall by a post is pushed off it from
 *  the side, so the bot never goes round into its own goal (design §8.2,
 *  amended at M2's integration). */
function openLine(m: Mind, bx: number, by: number, wx: number, wy: number, own: number): void {
  const w = m.w;
  w[0] = wx;
  w[1] = wy;
  if (opens(m, bx, by, wx, wy)) return;
  const ax = bx - own; // away from its own goal's centre, at y = 0
  for (let k = 1; k <= OPEN_TURNS; k++) {
    dir(fractionOfTurn(k, OPEN_TURN), m.d);
    const cos = m.d[0]!;
    const sin = m.d[1]!;
    const lx = wx * cos - wy * sin;
    const ly = wx * sin + wy * cos;
    const rx = wx * cos + wy * sin;
    const ry = wy * cos - wx * sin;
    const leftFirst = lx * ax + ly * by >= rx * ax + ry * by;
    for (let side = 0; side < 2; side++) {
      const left = (side === 0) === leftFirst;
      const tx = left ? lx : rx;
      const ty = left ? ly : ry;
      if (opens(m, bx, by, tx, ty)) {
        w[0] = tx;
        w[1] = ty;
        return;
      }
    }
  }
}

/** Whether the approach point for pushing along (wx, wy), kept inside the
 *  floor plan, is out of the ball's reach. */
function opens(m: Mind, bx: number, by: number, wx: number, wy: number): boolean {
  const reach = m.P.ballRadius + m.P.terrierRadius;
  const back = reach + APPROACH;
  const c = m.c;
  clampInside(m.P, bx - wx * back, by - wy * back, m.P.terrierRadius, c);
  const dx = c[0]! - bx;
  const dy = c[1]! - by;
  return dx * dx + dy * dy >= reach * reach;
}

/** Where to go to push the ball along the unit vector (wx, wy), in m.out:
 *  from the far side, round by a side waypoint on its own side; once
 *  behind, the approach point; once behind and aligned, through the ball's
 *  centre, which pushes it on. True when the ball is to be avoided on the
 *  way: everywhere but the push itself. */
function approach(m: Mind, x: number, y: number, bx: number, by: number, wx: number, wy: number): boolean {
  const reach = m.P.ballRadius + m.P.terrierRadius;
  const dx = x - bx;
  const dy = y - by;
  const behind = -(dx * wx + dy * wy);
  const side = wx * dy - wy * dx; // along (−wy, wx)
  const out = m.out;
  if (behind > 0 && side * side <= ALIGNED * ALIGNED * behind * behind) {
    // Through the ball's centre moved across the line by its own offset:
    // with no friction a push off the line slides off it further, so it
    // aims back over the line and slides onto it as it pushes.
    out[0] = bx + wy * side * PUSH_ACROSS;
    out[1] = by - wx * side * PUSH_ACROSS;
    return false;
  }
  if (behind > 0) {
    out[0] = bx - wx * (reach + APPROACH);
    out[1] = by - wy * (reach + APPROACH);
    clampInside(m.P, out[0]!, out[1]!, m.P.terrierRadius, out);
    return true;
  }
  const off = side >= 0 ? reach + SIDE_WAYPOINT : -(reach + SIDE_WAYPOINT);
  clampInside(m.P, bx - wy * off, by + wx * off, m.P.terrierRadius, out);
  // A wall that squeezes its own side's waypoint against the ball, past
  // half its offset, closes that way round: the other side's, if open
  // (design §8.2, amended at M2's integration).
  const squeeze = reach + SIDE_WAYPOINT * 0.5;
  if ((out[0]! - bx) * (out[0]! - bx) + (out[1]! - by) * (out[1]! - by) < squeeze * squeeze) {
    const c = m.c;
    clampInside(m.P, bx + wy * off, by - wx * off, m.P.terrierRadius, c);
    if ((c[0]! - bx) * (c[0]! - bx) + (c[1]! - by) * (c[1]! - by) >= squeeze * squeeze) {
      out[0] = c[0]!;
      out[1] = c[1]!;
    }
  }
  return true;
}

/** Turns the way to m.out round the ball (centre (cx, cy), radius rho), so
 *  it never crosses the ball's footprint: a tangent to the circle on the
 *  target's side, or round it from inside, and a little out. */
function avoidBall(m: Mind, x: number, y: number, cx: number, cy: number, rho: number): void {
  const out = m.out;
  const dx = out[0]! - x;
  const dy = out[1]! - y;
  const ex = cx - x;
  const ey = cy - y;
  const toward = ex * dx + ey * dy;
  if (toward <= 0) return; // the ball is behind it
  const len2 = dx * dx + dy * dy;
  const e2 = ex * ex + ey * ey;
  const rho2 = rho * rho;
  const cross = ex * dy - ey * dx; // > 0: the target is left of the line to the ball
  if (e2 > rho2) {
    // Clear if the closest point of the way, the target's included, is rho off.
    if (toward >= len2) {
      const fx = cx - out[0]!;
      const fy = cy - out[1]!;
      if (fx * fx + fy * fy >= rho2) return;
    } else if (cross * cross >= rho2 * len2) {
      return;
    }
    const e = Math.sqrt(e2);
    const sin = rho / e;
    const cos = Math.sqrt(e2 - rho2) / e;
    const ux = ex / e;
    const uy = ey / e;
    const turn = cross >= 0 ? sin : -sin;
    out[0] = x + ux * cos - uy * turn;
    out[1] = y + ux * turn + uy * cos;
    return;
  }
  // Inside the berth: round it toward the target's side, and out.
  const e = Math.sqrt(e2);
  if (e === 0) return;
  const ux = ex / e;
  const uy = ey / e;
  const turn = cross >= 0 ? 1 : -1;
  out[0] = x - uy * turn - ux * 0.5;
  out[1] = y + ux * turn - uy * 0.5;
}

/** (x, y) moved inside the floor plan by margin, into out: onto the box,
 *  then onto each cut corner's line (D-4). */
function clampInside(P: SimParams, x: number, y: number, margin: number, out: Float64Array): void {
  const shape = P.pitch.shape;
  const hx = shape.lengthMetres / 2;
  const hy = shape.widthMetres / 2;
  let px = Math.min(Math.max(x, margin - hx), hx - margin);
  let py = Math.min(Math.max(y, margin - hy), hy - margin);
  const cuts = shape.cornerCutsMetres;
  const m2 = margin * Math.sqrt(2);
  for (let c = 0; c < 4; c++) {
    // Corners (−x,−y), (+x,−y), (+x,+y), (−x,+y), as insideFloorPlan's.
    const sx = c === 1 || c === 2 ? 1 : -1;
    const sy = c >= 2 ? 1 : -1;
    const f = hx - sx * px + (hy - sy * py) - (cuts[c]! + m2);
    if (f < 0) {
      px += (sx * f) / 2;
      py += (sy * f) / 2;
    }
  }
  out[0] = px;
  out[1] = py;
}

/** CHASE's pounce (design §8.2): the ball's surface in reach, the ball
 *  low enough, no lunge or wait, the heading lined up with the ball, and
 *  the shot lined up with the goal (D-39). A lunge goes straight along the
 *  heading, and the ball leaves along the contact's normal, so the shot's
 *  line is found from where the lunge meets the ball: it must be within the
 *  align angle of the ball's line to the attacked goal's centre, and cross
 *  the goal line inside the mouth. */
function pounceReady(m: Mind, T: Readonly<Terrier>): boolean {
  if (T.lunge !== 0 || T.pounceWait !== 0 || T.tumble !== 0 || T.sitting) return false;
  const P = m.P;
  const bx = m.bx;
  const by = m.by;
  if (!(m.bz < POUNCE_HIGH)) return false;
  const cx = bx - T.x;
  const cy = by - T.y;
  const within = P.ballRadius + m.B.pounceWithin;
  if (cx * cx + cy * cy > within * within) return false;
  const align = m.B.pounceAlignUnits;
  const toBall = angleDiff(T.heading, datan2(cy, cx));
  if (toBall > align || toBall < -align) return false;
  // Where the lunge meets the ball, and the normal there.
  dir(T.heading, m.d);
  const hx = m.d[0]!;
  const hy = m.d[1]!;
  const reach = P.ballRadius + P.terrierRadius;
  const along = cx * hx + cy * hy;
  const miss = cx * hy - cy * hx;
  if (along <= 0 || miss * miss >= reach * reach) return false;
  const meet = along - Math.sqrt(reach * reach - miss * miss);
  const nx = (cx - hx * meet) / reach;
  const ny = (cy - hy * meet) / reach;
  const goal = P.pitch.goals[T.pack === 0 ? 1 : 0];
  const gx = goal.lineX - bx;
  const toGoal = angleDiff(datan2(ny, nx), datan2(-by, gx));
  if (toGoal > align || toGoal < -align || !(nx * gx > 0)) return false;
  const y = by + (ny * gx) / nx;
  const half = goal.mouthWidth / 2 - P.ballRadius;
  return y < half && y > -half;
}

/** A jump at a ball in the air over it, from the side away from the
 *  attacked goal, so the knock sends it goalward (design §8.2, D-39). */
function jumpReady(m: Mind, T: Readonly<Terrier>): boolean {
  if (!T.onFloor || T.lunge !== 0 || T.tumble !== 0 || T.sitting) return false;
  if (m.bz < JUMP_LOW || m.bz > JUMP_HIGH) return false;
  const dx = m.bx - T.x;
  const dy = m.by - T.y;
  if (dx * dx + dy * dy > JUMP_REACH * JUMP_REACH) return false;
  const att = T.pack === 0 ? m.P.pitch.goalLineX : -m.P.pitch.goalLineX;
  return dx * (att - m.bx) - dy * m.by > 0;
}
