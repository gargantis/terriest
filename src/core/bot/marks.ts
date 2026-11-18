// Test support for Q-9's pass marks (PLAN §16; design §8.5, §8.6): the
// seeded setups, their runs, the never-stuck watch, and the scripted people
// of §16's end-to-end setups. Not shipped, but linted and scanned as bot
// code, so exact operations only (D-39). A seed picks the host, and through
// botIds(hostOf(seed)) the bots' IDs, coats and noise; it picks the
// placements through mix(). The measures don't depend on the brain
// (design §8.6): they read the state alone.

import { encodeInput, FRAME_BALL, heldDirection, JOIN, READY, type TickInput } from '../sim/input';
import { mix, TURN } from '../sim/math';
import { defaultParams, type SimParams } from '../sim/params';
import { insideFloorPlan } from '../sim/pitch';
import { place, placeBall, placedMatch } from '../sim/scenes';
import {
  ENDED, findTerrier, genesis, IN_PLAY, KICKOFF_COUNTDOWN, type MatchState, type Pack, START_COUNTDOWN, type Terrier, WARM_UP,
} from '../sim/state';
import { makeSim, step } from '../sim/step';
import { botCoat, botIds, botName } from './bot-id';
import { type BotParams, type Brain, defaultBotParams, newBrain, think } from './brain';

// §16's and §8.6's measures, which define the marks rather than tune the
// brain: settle records them in §16 (Q-9, design §9.6).
const STUCK_SECONDS = 5; // not a setting: §16's never-stuck mark, "for 5 s"
const STUCK_METRES = 0.5; // not a setting: §16's never-stuck mark, "within 0.5 m"
const EMPTY_GOAL_SECONDS = 20; // not a setting: §16's empty-goal mark
const PLACE_MARGIN = 2; // not a setting: §16's empty-goal mark, "at least 2 m from any wall"
const FALL_BACK_AFTER_SECONDS = 0.5; // not a setting: §16's fall-back mark, after the reaction delay
const FALL_BACK_METRES = 3; // not a setting: §8.6's Q, from the ball toward its own goal
const FALL_BACK_NEAR = 1.5; // not a setting: §8.6's measure, within this of Q
const FALL_BACK_SPEED = 1; // not a setting: §8.6's measure, m/s
const FALL_BACK_COS = 0.7071067811865476; // not a setting: §8.6's measure, cos 45°
const READY_EVERY_SECONDS = 50; // not a setting: a host re-sends its bots' READY inside the minute's expiry
const OVERTIME_CAP_SECONDS = 60; // not a setting: the regulation shards' overtime cap (design §8.5)
const HOLD_SECONDS = 1; // not a setting: §16's end-to-end setups, "the first second after each kickoff"
const BACK = 16; // not a setting: A.2's step, back along the ball line
const SIDEWAYS = 8; // not a setting: A.2's step, sideways from the ball line
const TICKS_MAX = 60000; // not a setting: a runaway match's end, far past any whole one

const hex8 = (v: number): string => (v >>> 0).toString(16).padStart(8, '0');

/** After each tick of a run: the state, and each player's brain, null for a person. For a test's diagnosis. */
export type Probe = (s: Readonly<MatchState>, brains: readonly (Brain | null)[]) => void;

/** A person's ID for a seed: 32 hex digits, version 4, as a browser's (D-25). */
export function personId(seed: number, k: number): string {
  const h = mix(seed, k);
  const id = hex8(mix(h, 11)) + hex8(mix(h, 12)) + hex8(mix(h, 13)) + hex8(mix(h, 14));
  return `${id.slice(0, 12)}4${id.slice(13)}`;
}

/** The host whose bots a seed's run plays. */
export function hostOf(seed: number): string {
  return personId(seed, 0);
}

/** A fraction in [0, 1) from two integers. */
const fraction = (a: number, b: number): number => mix(a, b) / TURN;

/** A seeded point inside the floor plan by margin, written into out, that
 *  ok() accepts; draws again until one does. */
function seededPoint(P: SimParams, seed: number, k: number, margin: number, ok: (x: number, y: number) => boolean, out: Float64Array): void {
  const shape = P.pitch.shape;
  for (let draw = 0; draw < 10000; draw++) {
    const h = mix(mix(seed, k), draw);
    const x = (fraction(h, 1) - 0.5) * shape.lengthMetres;
    const y = (fraction(h, 2) - 0.5) * shape.widthMetres;
    if (insideFloorPlan(shape, x, y, margin) && ok(x, y)) {
      out[0] = x;
      out[1] = y;
      return;
    }
  }
  throw new Error(`seed ${seed}: no point ${k} fits`);
}

// --- Never stuck (§16; design §8.6) ---

/** Each watched bot's current streak: where it began and how long it has
 *  lasted, and whether any reached the mark. */
export interface StuckWatch {
  readonly ids: readonly string[];
  readonly ticks: Int32Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly longest: Int32Array;
  readonly stuck: string[]; // the first time each bot was stuck: "<id> at tick <t>"
}

export function stuckWatch(ids: readonly string[]): StuckWatch {
  const n = ids.length;
  return { ids, ticks: new Int32Array(n), x: new Float64Array(n), y: new Float64Array(n), longest: new Int32Array(n), stuck: [] };
}

/** After a tick, from the state after it and the inputs each bot sent:
 *  a bot is stuck if it holds a direction, isn't sitting, tumbled, lunging
 *  or in a countdown, and its centre stays within 0.5 m of where that streak
 *  began for 5 s. The streak restarts whenever a condition breaks or it
 *  leaves the circle. */
export function watchStuck(w: StuckWatch, s: Readonly<MatchState>, inputs: readonly number[], P: SimParams = defaultParams): void {
  const limit = STUCK_SECONDS * P.config.ticksPerSecond;
  const countdown = s.phase === START_COUNTDOWN || s.phase === KICKOFF_COUNTDOWN;
  for (let b = 0; b < w.ids.length; b++) {
    const k = findTerrier(s, w.ids[b]!);
    const T: Terrier | undefined = k < 0 ? undefined : s.terriers[k];
    const free = T !== undefined && heldDirection(inputs[b]!) && !countdown && s.phase !== ENDED && !T.sitting && T.tumble === 0 && T.lunge === 0;
    if (!free) {
      w.ticks[b] = 0;
      continue;
    }
    const dx = T.x - w.x[b]!;
    const dy = T.y - w.y[b]!;
    if (w.ticks[b] === 0 || dx * dx + dy * dy > STUCK_METRES * STUCK_METRES) {
      w.ticks[b] = 1;
      w.x[b] = T.x;
      w.y[b] = T.y;
    } else {
      w.ticks[b]!++;
    }
    if (w.ticks[b]! > w.longest[b]!) w.longest[b] = w.ticks[b]!;
    if (w.ticks[b] === limit) w.stuck.push(`${w.ids[b]} at tick ${s.tick}`);
  }
}

// --- Bots and people ---

/** A player in a run: a bot with its brain, or a scripted person. */
interface Player {
  readonly id: string;
  readonly pack: Pack;
  readonly brain: Brain | null;
  /** A person's u16 for the tick after s. */
  readonly person: ((s: Readonly<MatchState>) => number) | null;
}

const botPlayer = (id: string, pack: Pack, P: SimParams, B: BotParams): Player => ({ id, pack, brain: newBrain(id, 0, P, B), person: null });

/** Each player's u16 for the tick after s, into inputs. */
function decide(players: readonly Player[], s: Readonly<MatchState>, inputs: number[]): void {
  for (let k = 0; k < players.length; k++) {
    const p = players[k]!;
    inputs[k] = p.brain ? think(p.brain, s) : p.person!(s);
  }
}

/** A placed match's terriers, in list order, given the IDs and coats of
 *  bots: the list keeps its (spot, pack) order. */
function botsFor(s: MatchState, ids: readonly string[], P: SimParams): void {
  for (let k = 0; k < s.terriers.length; k++) {
    const T = s.terriers[k]!;
    T.id = ids[k]!;
    T.name = botName(T.id);
    T.coat = botCoat(T.id, P.coatCount);
  }
}

// --- The empty goal (§16) ---

export interface EmptyGoalRun {
  readonly seed: number;
  /** The tick of the bot's pack's first goal, or −1: within 20 s passes. */
  readonly goalTick: number;
  readonly goals: number;
  readonly stuck: readonly string[];
}

/** 1 a side, placed in play, pack B empty (a test-only short pack, design
 *  §2.3): nobody defends. The bot and the resting ball at seeded points,
 *  each centre at least 2 m plus its radius inside the floor plan, apart.
 *  The whole 20 s, past any goal. */
export function emptyGoalRun(seed: number, P: SimParams = defaultParams, B: BotParams = defaultBotParams, probe?: Probe): EmptyGoalRun {
  const s = placedMatch(P, 1, { members: [1, 0], seed });
  const id = botIds(hostOf(seed))[0]!;
  botsFor(s, [id], P);
  const R = P.ballRadius;
  const r = P.terrierRadius;
  const ball = new Float64Array(2);
  seededPoint(P, seed, 1, PLACE_MARGIN + R, () => true, ball);
  placeBall(P, s, ball[0]!, ball[1]!);
  const me = new Float64Array(2);
  const apart = (R + r) * (R + r);
  seededPoint(P, seed, 2, PLACE_MARGIN + r, (x, y) => (x - ball[0]!) * (x - ball[0]!) + (y - ball[1]!) * (y - ball[1]!) > apart, me);
  place(P, s, 0, me[0]!, me[1]!);
  s.terriers[0]!.heading = mix(seed, 3);
  s.terriers[0]!.overheadRef = s.terriers[0]!.heading;
  const players = [botPlayer(id, 0, P, B)];
  const sim = makeSim(P, 1);
  const watch = stuckWatch([id]);
  const inputs = [0];
  const list: TickInput[] = [{ id, input: 0, events: 0 }];
  let goalTick = -1;
  const ticks = EMPTY_GOAL_SECONDS * P.config.ticksPerSecond;
  for (let t = 1; t <= ticks; t++) {
    decide(players, s, inputs);
    list[0] = { id, input: inputs[0]!, events: 0 };
    step(sim, s, list);
    probe?.(s, [players[0]!.brain]);
    watchStuck(watch, s, inputs, P);
    if (goalTick < 0 && s.score[0] > 0) goalTick = t;
  }
  return { seed, goalTick, goals: s.score[0], stuck: watch.stuck };
}

// --- The fall-back (§16, L142) ---

export interface FallBackRun {
  readonly packSize: number;
  readonly seed: number;
  readonly pass: boolean;
  /** Pack A's nearest bot at the measure: its distance from Q, its speed and the angle's cosine. */
  readonly distance: number;
  readonly speed: number;
  readonly cos: number;
}

/** Placed in play, every terrier a bot: a seeded ball, pack A on the
 *  attacking side of it, and a pack-B rival nearer the ball than pack A's
 *  nearest bot. At the reaction delay plus 0.5 s, that bot passes if it's
 *  within 1.5 m of Q, the point 3 m from the ball toward its own goal's
 *  centre (or the centre, if nearer), or is moving at 1 m/s or more within
 *  45° of Q (design §8.6). */
export function fallBackRun(packSize: number, seed: number, P: SimParams = defaultParams, B: BotParams = defaultBotParams, probe?: Probe): FallBackRun {
  const s = placedMatch(P, packSize, { seed });
  const ids = botIds(hostOf(seed)).slice(0, 2 * packSize);
  botsFor(s, ids, P);
  const R = P.ballRadius;
  const r = P.terrierRadius;
  const L = P.pitch.goalLineX;
  const ball = new Float64Array(2);
  // Room on the attacking side, +x for pack A.
  seededPoint(P, seed, 1, 3 + R, (x) => x < L - 8, ball); // not a setting: a scene's coordinate
  placeBall(P, s, ball[0]!, ball[1]!);
  const bx = ball[0]!;
  const by = ball[1]!;
  const placed: number[] = [];
  const clear = (x: number, y: number): boolean => {
    if ((x - bx) * (x - bx) + (y - by) * (y - by) <= (R + r + 0.3) * (R + r + 0.3)) return false; // not a setting: a scene's gap
    for (const j of placed) {
      const U = s.terriers[j]!;
      if ((x - U.x) * (x - U.x) + (y - U.y) * (y - U.y) <= (2 * r + 0.2) * (2 * r + 0.2)) return false; // not a setting: a scene's gap
    }
    return true;
  };
  const at = new Float64Array(2);
  // Pack A's, beyond the ball toward the goal they attack.
  let nearestA = -1;
  let nearestD = Infinity;
  for (let k = 0; k < s.terriers.length; k += 2) {
    seededPoint(P, seed, 10 + k, 1 + r, (x, y) => x > bx + 1.5 && clear(x, y), at); // not a setting: a scene's gap
    place(P, s, k, at[0]!, at[1]!);
    placed.push(k);
    const d = (at[0]! - bx) * (at[0]! - bx) + (at[1]! - by) * (at[1]! - by);
    if (d < nearestD) {
      nearestD = d;
      nearestA = k;
    }
  }
  // Pack B's first nearer the ball than that, the rest anywhere.
  for (let k = 1; k < s.terriers.length; k += 2) {
    const near = k === 1;
    seededPoint(P, seed, 10 + k, 1 + r, (x, y) => clear(x, y) && (!near || (x - bx) * (x - bx) + (y - by) * (y - by) < nearestD), at);
    place(P, s, k, at[0]!, at[1]!);
    placed.push(k);
  }
  for (let k = 0; k < s.terriers.length; k++) {
    const T = s.terriers[k]!;
    T.heading = mix(seed, 100 + k);
    T.overheadRef = T.heading;
  }
  const players = s.terriers.map((T) => botPlayer(T.id, T.pack, P, B));
  const sim = makeSim(P, packSize);
  const inputs: number[] = players.map(() => 0);
  const list: TickInput[] = [];
  const ticks = B.reactionTicks + FALL_BACK_AFTER_SECONDS * P.config.ticksPerSecond;
  for (let t = 1; t <= ticks; t++) {
    decide(players, s, inputs);
    list.length = 0;
    for (let k = 0; k < players.length; k++) list.push({ id: players[k]!.id, input: inputs[k]!, events: 0 });
    step(sim, s, list);
    probe?.(s, players.map((p) => p.brain));
  }
  const T = s.terriers[findTerrier(s, ids[nearestA]!)]!;
  const own = -L;
  const gx = own - s.ball.x;
  const gy = -s.ball.y;
  const gl = Math.sqrt(gx * gx + gy * gy);
  const qx = gl > FALL_BACK_METRES ? s.ball.x + (gx / gl) * FALL_BACK_METRES : own;
  const qy = gl > FALL_BACK_METRES ? s.ball.y + (gy / gl) * FALL_BACK_METRES : 0;
  const dx = qx - T.x;
  const dy = qy - T.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const speed = Math.sqrt(T.vx * T.vx + T.vy * T.vy);
  const cos = distance > 0 && speed > 0 ? (T.vx * dx + T.vy * dy) / (distance * speed) : 0;
  const pass = distance <= FALL_BACK_NEAR || (speed >= FALL_BACK_SPEED && cos >= FALL_BACK_COS);
  return { packSize, seed, pass, distance, speed, cos };
}

// --- Whole matches from genesis: the regulation mark and the end-to-end setups ---

export interface MatchRun {
  readonly seed: number;
  /** The first goal's tick, its pack and how many ticks of play it came after; −1 for none. */
  readonly firstGoalTick: number;
  readonly firstGoalPack: number;
  readonly firstGoalPlay: number;
  /** The first goal came before the clock reached 0. */
  readonly regulationGoal: boolean;
  readonly ended: boolean;
  readonly overtime: boolean;
  readonly score: readonly [number, number];
  readonly ticks: number;
  readonly stuck: readonly string[];
}

interface MatchOptions {
  readonly packSize: number;
  readonly matchMinutes: number;
  readonly players: readonly Player[];
  /** The bots watched for being stuck. */
  readonly watched: readonly string[];
  /** Stop at the first goal. */
  readonly toFirstGoal: boolean;
  readonly seed: number;
  readonly P: SimParams;
  readonly probe: Probe | undefined;
}

/** A match from genesis: every player's JOIN and READY at tick 1, each
 *  bot's READY again every 50 s as its host keeps it ready, then play to
 *  ENDED, through any overtime up to a minute of it, or to the first goal. */
function playMatch(o: MatchOptions): MatchRun {
  const P = o.P;
  const s = genesis({ packSize: o.packSize, matchMinutes: o.matchMinutes }, P);
  const sim = makeSim(P, o.packSize);
  const players = o.players;
  const inputs: number[] = players.map(() => 0);
  const list: TickInput[] = [];
  const watch = stuckWatch(o.watched);
  const indexOf: number[] = o.watched.map((id) => players.findIndex((p) => p.id === id));
  const watchedInputs: number[] = o.watched.map(() => 0);
  const readyEvery = READY_EVERY_SECONDS * P.config.ticksPerSecond;
  const overtimeCap = OVERTIME_CAP_SECONDS * P.config.ticksPerSecond;
  let firstGoalTick = -1;
  let firstGoalPack = -1;
  let firstGoalPlay = -1;
  let regulationGoal = false;
  let t = 1;
  for (; t <= TICKS_MAX; t++) {
    decide(players, s, inputs);
    list.length = 0;
    for (let k = 0; k < players.length; k++) {
      const p = players[k]!;
      let events = 0;
      if (t === 1) events = JOIN | READY;
      else if (p.brain && t % readyEvery === 1) events = READY;
      list.push(
        events & JOIN
          ? { id: p.id, input: inputs[k]!, events, joinPack: p.pack, coat: p.brain ? botCoat(p.id, P.coatCount) : 0, name: p.brain ? botName(p.id) : '' }
          : { id: p.id, input: inputs[k]!, events },
      );
    }
    const wasOvertime = s.overtime;
    const clock = s.clock;
    step(sim, s, list);
    o.probe?.(s, players.map((p) => p.brain));
    for (let b = 0; b < indexOf.length; b++) watchedInputs[b] = inputs[indexOf[b]!]!;
    watchStuck(watch, s, watchedInputs, P);
    if (firstGoalTick < 0 && s.score[0] + s.score[1] > 0) {
      firstGoalTick = t;
      firstGoalPack = s.score[0] > 0 ? 0 : 1;
      firstGoalPlay = wasOvertime ? s.matchLengthTicks + clock : s.matchLengthTicks - s.clock;
      regulationGoal = !wasOvertime;
      if (o.toFirstGoal) break;
    }
    if (s.phase === ENDED) break;
    // A count of regulation goals is done at 0:00; a whole match plays a minute of overtime.
    if (s.overtime && (o.toFirstGoal || s.clock >= overtimeCap)) break;
    if (t === 2 * P.startCountdownTicks && s.phase === WARM_UP) {
      throw new Error(`seed ${o.seed}: still in warm-up at tick ${t}, with ${s.terriers.length} terriers: no start countdown`);
    }
  }
  if (t > TICKS_MAX) throw new Error(`seed ${o.seed}: no end in ${TICKS_MAX} ticks`);
  return {
    seed: o.seed, firstGoalTick, firstGoalPack, firstGoalPlay, regulationGoal,
    ended: s.phase === ENDED, overtime: s.overtime, score: [s.score[0], s.score[1]], ticks: s.tick, stuck: watch.stuck,
  };
}

/** The regulation mark's match (§16): 2 a side at the default 3 minutes,
 *  four bots of one host, JOIN and READY at tick 1. Whole, through any
 *  overtime up to a minute of it, or to its first goal; the first part is
 *  the same either way, bit for bit. */
export function regulationMatch(
  seed: number, toFirstGoal: boolean, P: SimParams = defaultParams, B: BotParams = defaultBotParams, probe?: Probe,
): MatchRun {
  const packSize = 2; // not a setting: §16's "2-a-side bot matches"
  const ids = botIds(hostOf(seed)).slice(0, 2 * packSize);
  const players = ids.map((id, k) => botPlayer(id, (k & 1) as Pack, P, B));
  return playMatch({ packSize, matchMinutes: P.config.matchLengthDefaultMinutes, players, watched: ids, toFirstGoal, seed, P, probe });
}

/** A scripted person's u16 (design §8.6): `held` for the first second of
 *  play after each kickoff, and then nothing, present every tick. */
const person = (held: number, P: SimParams) => (s: Readonly<MatchState>): number =>
  s.phase === IN_PLAY && s.tick - s.phaseStart < HOLD_SECONDS * P.config.ticksPerSecond ? held : 0;

/** §16's end-to-end setups, which M3's and M4's specs rest on, 1 minute
 *  each. 'three-engine': 2 a side; pack A's person holds back in ball view
 *  for the first second of play after each kickoff, then nothing, and hosts
 *  pack A's bot; pack B's two people hold nothing. 'practice': 1 a side;
 *  pack A's person holds sideways in ball view for that second, then
 *  nothing; pack B is a bot. Whole matches: each must end at 0:00 with the
 *  bot's pack ahead. */
export function e2eMatch(
  setup: 'three-engine' | 'practice', seed: number, P: SimParams = defaultParams, B: BotParams = defaultBotParams, probe?: Probe,
): MatchRun & { readonly botPack: Pack } {
  const host = personId(seed, 0);
  const bot = botIds(host)[0]!;
  const minutes = 1; // not a setting: §16's "every match these tests play is 1 minute long"
  if (setup === 'three-engine') {
    const players: Player[] = [
      { id: host, pack: 0, brain: null, person: person(encodeInput({ step: BACK, frame: FRAME_BALL }), P) },
      botPlayer(bot, 0, P, B),
      { id: personId(seed, 1), pack: 1, brain: null, person: () => 0 },
      { id: personId(seed, 2), pack: 1, brain: null, person: () => 0 },
    ];
    return { ...playMatch({ packSize: 2, matchMinutes: minutes, players, watched: [bot], toFirstGoal: false, seed, P, probe }), botPack: 0 };
  }
  const players: Player[] = [
    { id: host, pack: 0, brain: null, person: person(encodeInput({ step: SIDEWAYS, frame: FRAME_BALL }), P) },
    botPlayer(bot, 1, P, B),
  ];
  return { ...playMatch({ packSize: 1, matchMinutes: minutes, players, watched: [bot], toFirstGoal: false, seed, P, probe }), botPack: 1 };
}
