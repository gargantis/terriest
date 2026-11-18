// The golden runs and the canary (PLAN §16 Determinism, D-23; design §1.15,
// §7.1–§7.3): what each run plays, what it must show (its covers, which
// golden.test.ts asserts from the run's result, so a run that stops
// covering its column fails even after a re-emit), and the states it must
// reach (its checks). Every input is a pure function of the script, the
// player, the tick and the state before the tick, so every engine replays a
// run bit for bit.
// The M0 spike's scripts.ts and roslambo's: genesis runs drive the rules
// through roster events, IDs are ranked within packs so mirrored pairs match
// by rank, placed runs take their scenes from scenes.ts, and each tick's
// inputs are handed over reversed (P4). D-4's second shape and the bot brain
// stay out of the goldens (design §7.1, §14 Q-14). It ships in the
// determinism chunk, so exact operations only (D-1).

import {
  encodeInput, FRAME_BALL, FRAME_NOSE, FRAME_PITCH, JOIN, LEAVE, mirrorInput, READY, SWITCH, type TickInput, UNREADY,
} from './input';
import { dir, HALF_TURN, mix } from './math';
import { defaultParams } from './params';
import {
  ballDir, chasey, CORNER_SCRUM, NOTHING, park, pinchScene, pitchDir, place, placeBall, pushScene, rankedIds, RESTING_BALL,
  ROLLING_BALL, type Scene, type SceneInput, SQUEEZE, touchReach, WALL_SCRUM,
} from './scenes';
import {
  CELEBRATION, ENDED, findTerrier, IN_PLAY, KICKOFF_COUNTDOWN, type MatchState, NEVER, type Pack, packCount, type Phase,
  START_COUNTDOWN, type Terrier, WARM_UP,
} from './state';

// --- The spec ---

/** What a run must show, asserted from its result (design §7.2): at least
 *  these counts, these phases seen, this ending. */
export interface Coverage {
  readonly goals?: number;
  readonly pounces?: number;
  readonly tumbles?: number;
  readonly hits?: number;
  /** Terrier-ticks that end zooming. */
  readonly zooms?: number;
  /** floorBounces + pieceBounces. */
  readonly bounces?: number;
  readonly pushes?: number;
  readonly slipOuts?: number;
  /** The most contacts in one substep: the scrums' densest contacts (C-2). */
  readonly maxContacts?: number;
  /** Each seen at a tick's end at least once. */
  readonly phases?: readonly Phase[];
  /** Overtime seen, or never seen. */
  readonly overtime?: boolean;
  /** ENDED at 0:00 with a pack ahead, or by an overtime goal. */
  readonly end?: 'lead' | 'overtime';
}

/** A state the run must reach: holds(s) after tick `tick`. */
export interface ScriptCheck {
  readonly tick: number;
  readonly what: string;
  readonly holds: (s: Readonly<MatchState>) => boolean;
}

/** A player's TickInput without its ID. */
export type ScriptInput = Omit<TickInput, 'id'>;

export interface ScriptSpec {
  readonly name: string;
  readonly packSize: number;
  /** A genesis run's length; 0 for a placed run, whose clock is 2^31 ticks. */
  readonly matchMinutes: number;
  readonly ticks: number;
  /** Events from tick 1, or a placed scene, whose phase, members and setup the run takes. */
  readonly start: 'genesis' | Scene;
  /** For the IDs (rankedIds). */
  readonly seed: number;
  /** Players in each pack's group of IDs; the pack size by default. Only
   *  the roster run has more, who join, switch and leave. */
  readonly players?: number;
  /** Pack B's rank-k player sends the mirror of pack A's rank-k (P8). */
  readonly mirrored: boolean;
  /** Player (pack, rank)'s input at tick t, or null when absent; s is the
   *  state before the tick. pack is the player's group of IDs, which is the
   *  pack it joins in every run but the roster's. */
  readonly input: (pack: Pack, rank: number, t: number, s: Readonly<MatchState>) => ScriptInput | null;
  readonly covers: Coverage;
  readonly checks?: readonly ScriptCheck[];
}

// --- The inputs of a tick ---

/** The last IDs asked for: every tick asks again, and rankedIds sorts. */
let idCache: { seed: number; players: number; ids: readonly [readonly string[], readonly string[]] } | null = null;

function idsFor(seed: number, players: number): readonly [readonly string[], readonly string[]] {
  if (idCache === null || idCache.seed !== seed || idCache.players !== players) idCache = { seed, players, ids: rankedIds(seed, players) };
  return idCache.ids;
}

/** Player (pack, rank)'s ID in a run. */
export function scriptId(spec: ScriptSpec, pack: Pack, rank: number): string {
  return idsFor(spec.seed, spec.players ?? spec.packSize)[pack]![rank]!;
}

const otherPack = (p: number): number => (p === 0 ? 1 : p === 1 ? 0 : p);

type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** The mirror of a player's input (P8): its u16 mirrored, and the packs its
 *  JOIN and SWITCH name swapped. */
function mirrorPlayer(x: ScriptInput | null): ScriptInput | null {
  if (x === null) return null;
  const m: Writable<ScriptInput> = { ...x, input: mirrorInput(x.input) };
  if (x.joinPack !== undefined) m.joinPack = otherPack(x.joinPack);
  if (x.switchPack !== undefined) m.switchPack = otherPack(x.switchPack);
  return m;
}

/** Tick t's TickInputs, handed over reversed (P4); s is the state before the tick. */
export function scriptTickInputs(spec: ScriptSpec, t: number, s: Readonly<MatchState>, out: TickInput[] = []): TickInput[] {
  out.length = 0;
  const players = spec.players ?? spec.packSize;
  const ids = idsFor(spec.seed, players);
  for (let pack = 1; pack >= 0; pack--) {
    for (let rank = players - 1; rank >= 0; rank--) {
      const x = spec.mirrored && pack === 1 ? mirrorPlayer(spec.input(0, rank, t, s)) : spec.input(pack as Pack, rank, t, s);
      if (x !== null) out.push({ id: ids[pack]![rank]!, ...x });
    }
  }
  return out;
}

// --- Helpers for the runs ---

const P = defaultParams;
const NOBODY: ScriptCheck[] = [];

/** The terrier with this ID, or null. */
function member(s: Readonly<MatchState>, id: string): Readonly<Terrier> | null {
  const k = findTerrier(s, id);
  return k < 0 ? null : s.terriers[k]!;
}

/** Whether s is point-mirrored (P8), by the fields the goldens' mirrored
 *  runs move: each pair's positions, velocities and headings, and the
 *  ball's horizontal parts each their own negation, ±0 (design §7.6). */
function isMirrored(s: Readonly<MatchState>): boolean {
  const b = s.ball;
  if (b.x !== -b.x || b.y !== -b.y || b.vx !== -b.vx || b.vy !== -b.vy) return false;
  const list = s.terriers;
  if (list.length % 2 !== 0) return false;
  for (let k = 0; k < list.length; k += 2) {
    const A = list[k]!;
    const B = list[k + 1]!;
    if (A.spot !== B.spot || A.pack === B.pack) return false;
    if (B.x !== -A.x || B.y !== -A.y || B.z !== A.z || B.vx !== -A.vx || B.vy !== -A.vy || B.vz !== A.vz) return false;
    if (B.heading !== ((A.heading + HALF_TURN) >>> 0) || B.tumble !== A.tumble || B.lunge !== A.lunge) return false;
  }
  return true;
}

/** A placed run: its scene's state at tick 0 (scenes.ts), its inputs the
 *  scene's, with no events. */
function placed(name: string, scene: Scene, ticks: number, covers: Coverage, checks: readonly ScriptCheck[] = NOBODY, seed = 0): ScriptSpec {
  return {
    name, packSize: scene.packSize, matchMinutes: 0, ticks, start: scene, seed, mirrored: scene.mirrored,
    input: (pack, rank, t, s) => {
      const v = scene.input(pack, rank, t, s);
      return v === null ? null : { input: v, events: 0 };
    },
    covers, checks,
  };
}

/** A genesis member's input: JOIN at tick 1 with its pack, a coat and a
 *  name, READY at its ready tick, and its play's u16 every tick. */
function joining(play: SceneInput, readyAt: (pack: Pack, rank: number) => number): ScriptSpec['input'] {
  return (pack, rank, t, s) => {
    const input = play(pack, rank, t, s) ?? NOTHING;
    const events = t === readyAt(pack, rank) ? READY : 0;
    if (t !== 1) return { input, events };
    return { input, events: events | JOIN, joinPack: pack, coat: (2 * rank + pack) % P.coatCount, name: `${pack === 0 ? 'A' : 'B'}${rank + 1}` };
  };
}

/** READY a few ticks after the JOINs, one a tick, so the start countdown
 *  begins once the last is in. */
const soonAfter = (pack: Pack, rank: number): number => 2 + 2 * rank + pack;

const ALL_PHASES: readonly Phase[] = [WARM_UP, START_COUNTDOWN, KICKOFF_COUNTDOWN, IN_PLAY, CELEBRATION, ENDED];
/** A match from genesis that scores: warm-up, the start countdown, play, a
 *  celebration and the kickoff after it. */
const SCORING_MATCH: readonly Phase[] = [WARM_UP, START_COUNTDOWN, IN_PLAY, CELEBRATION, KICKOFF_COUNTDOWN];

// --- Seeded matches from genesis (design §7.1) ---

/** A match from genesis under the spike's seeded play, in all three frames:
 *  its seed picked so that it scores and kicks off again (design §7.1). */
function seededMatch(name: string, packSize: number, matchMinutes: number, ticks: number, seed: number, covers: Coverage): ScriptSpec {
  return {
    name, packSize, matchMinutes, ticks, start: 'genesis', seed, mirrored: false,
    input: joining(chasey(seed, 'all'), soonAfter), covers,
  };
}

/** P8's runs, hashed: a mirrored kickoff from genesis, pack B sending the
 *  mirror of pack A's seeded play at the ball, so the state stays mirrored
 *  from the placement on. */
function mirroredKickoff(packSize: number, seed: number): ScriptSpec {
  const kickoff = 2 + P.startCountdownTicks; // the READYs come at tick 2, all at once
  return {
    name: `mirrored kickoff ${packSize}`, packSize, matchMinutes: 1, ticks: 3000, // not a setting: the run's length
    start: 'genesis', seed, mirrored: true,
    input: joining(chasey(seed, 'contact'), () => 2),
    covers: { pushes: 1, hits: 1, phases: [WARM_UP, START_COUNTDOWN, IN_PLAY] },
    checks: [
      { tick: kickoff - 1, what: 'placed mirrored for the kickoff', holds: (s) => s.phase === START_COUNTDOWN && isMirrored(s) },
      { tick: 1000, what: 'mirrored in play', holds: (s) => s.phase === IN_PLAY && isMirrored(s) },
      { tick: 3000, what: 'still mirrored at the end', holds: (s) => s.phase === IN_PLAY && isMirrored(s) },
    ],
  };
}

// --- Scripted matches from genesis: the clock's two endings ---

/** Pack A's terrier holds at the +x goal from the whistle, pushing the ball
 *  along the long axis into it, while pack B's steps aside, off the ball's
 *  path, for the countdown and the first ticks of play; nothing is held once
 *  A has scored. `when` says in which part of the match. */
function pushIntoGoal(when: (s: Readonly<MatchState>) => boolean): SceneInput {
  return (pack, _rank, t, s) => {
    if (!when(s) || s.score[0] > 0) return NOTHING;
    if (pack === 0) return s.phase === WARM_UP ? NOTHING : pitchDir(0);
    const countdown = s.phase === START_COUNTDOWN || s.phase === KICKOFF_COUNTDOWN;
    return countdown || (s.phase === IN_PLAY && t - s.phaseStart <= 40) ? pitchDir(8) : NOTHING; // not a setting: a sidestep's ticks
  };
}

/** Pack A scores, then nothing is held: the clock reaches 0 with A ahead,
 *  and the match ends with no overtime (design §7.1). */
const REGULATION_END: ScriptSpec = {
  name: 'regulation end', packSize: 1, matchMinutes: 1, ticks: 4500, // not a setting: the run's shape
  start: 'genesis', seed: 21, mirrored: false,
  input: joining(pushIntoGoal(() => true), soonAfter),
  covers: { goals: 1, phases: ALL_PHASES, overtime: false, end: 'lead' }, // not a setting: the run's coverage
  checks: [{ tick: 4500, what: 'ended 1–0 in regulation', holds: (s) => s.phase === ENDED && !s.overtime && s.score[0] === 1 && s.score[1] === 0 && s.clock === 0 }],
};

/** Regulation 0–0 with nothing held, the overtime kickoff, then pack A's
 *  push into the +x goal: the overtime goal's celebration, then ENDED. */
const OVERTIME: ScriptSpec = {
  name: 'overtime', packSize: 1, matchMinutes: 1, ticks: 5000, // not a setting: the run's shape
  start: 'genesis', seed: 22, mirrored: false,
  input: joining(pushIntoGoal((s) => s.overtime), soonAfter),
  covers: { goals: 1, phases: ALL_PHASES, overtime: true, end: 'overtime' }, // not a setting: the run's coverage
  checks: [{ tick: 5000, what: 'ended 1–0 by an overtime goal', holds: (s) => s.phase === ENDED && s.overtime && s.score[0] === 1 && s.score[1] === 0 }],
};

// --- The roster: joins, leaves, switches, Ready, presence (D-12, D-16) ---

const ROSTER_SEED = 23; // not a setting: the roster run's IDs
/** Four players in each group: more than the two places a pack has. */
const ROSTER_IDS = rankedIds(ROSTER_SEED, 4);
const [A0, A1, A2, A3] = ROSTER_IDS[0] as [string, string, string, string];
const [B0, B1] = ROSTER_IDS[1] as [string, string];

/** A name a tick over each of A.4's limits, which the JOIN cleans to ''
 *  (C-17): a character too many, a byte too many in 3-byte characters, a
 *  control character, a C1 character and a lone surrogate. */
const TOO_LONG = 'Abcdefghij'.repeat(3).slice(0, P.nameMaxChars + 1);
const TOO_MANY_BYTES = '\u20ac'.repeat(Math.floor(P.nameMaxBytes / 3) + 1);
const BAD_NAMES = ['Bo\u0007b', 'Bo\u0085b', 'Bo\ud800b'] as const;

/** Ready from tick 20 expires 60 s later; then the packs fill, ready, and
 *  the start countdown begins; a LEAVE in it is ignored, and its terrier,
 *  silent, sits, then stands when it's heard from again. */
const EXPIRES = 20 + P.readyExpiryTicks; // not a setting: a script's tick
const REFILL = EXPIRES + 1;
const START = EXPIRES + 2;
const LEAVE_IN_COUNTDOWN = START + 78; // not a setting: a script's tick
const SITS = LEAVE_IN_COUNTDOWN + P.sitAfterTicks;
const STANDS = SITS + 80; // not a setting: a script's tick, still in the countdown
const REMOVED = 20 + P.removeAfterTicks; // not a setting: a0's last input is at tick 20

type Ev = Writable<ScriptInput>;
const join = (joinPack: number, name: string, coat = 1): Ev => ({ input: NOTHING, events: JOIN, joinPack, coat, name });
const rejoin = (name: string): Ev => ({ input: NOTHING, events: LEAVE | JOIN, joinPack: 1, coat: 2, name });
const only = (events: number): Ev => ({ input: NOTHING, events });
const moveTo = (switchPack: number, also = 0): Ev => ({ input: NOTHING, events: SWITCH | also, switchPack });
const joinAndSwitch: Ev = { input: NOTHING, events: JOIN | SWITCH, joinPack: 1, switchPack: 0, coat: 4, name: 'Cy' }; // not a setting: a pack and a coat

/** Each player's events, by tick (design §7.1's roster run). */
const ROSTER_EVENTS: readonly (readonly [id: string, tick: number, ev: Ev])[] = [
  [A0, 1, join(0, 'Ada', 3)], [B0, 1, join(1, 'Bea', 200)], // a JOIN to each pack; a bad coat
  [A1, 2, join(2, 'Al')], [A2, 2, join(255, 'Di')], // bad pack bytes
  [A1, 3, join(0, TOO_LONG)], // pack A is full now
  [A2, 4, join(0, 'Di')], // a JOIN to a full pack
  [B1, 5, join(1, TOO_MANY_BYTES)], // pack B is full now
  [B1, 6, rejoin(BAD_NAMES[0])], [B1, 7, rejoin(BAD_NAMES[1])], [B1, 8, rejoin(BAD_NAMES[2])], [B1, 9, rejoin('Bob')],
  [A0, 10, moveTo(1, READY)], // a SWITCH without room, and READY
  [B1, 11, only(LEAVE)],
  [A0, 12, moveTo(1)], // a SWITCH with room, which cancels Ready
  [A2, 13, join(0, 'Di')], [A3, 13, join(0, 'Cy', 4)], // two JOINs for pack A's last place
  [B0, 14, only(LEAVE)], [A3, 14, joinAndSwitch], // a non-member's JOIN and SWITCH: the JOIN applies
  [A2, 15, only(LEAVE)], [A3, 15, joinAndSwitch], // a member's: the SWITCH applies
  [A1, 16, only(READY)], [A1, 17, only(UNREADY)], [A1, 18, only(READY)], [A1, 19, only(READY | UNREADY)],
  [A3, 20, only(READY)], // expires at EXPIRES
  [B0, REFILL, join(1, 'Bea', 5)], [B1, REFILL, join(1, 'Bob', 6)],
  [A1, START, only(READY)], [A3, START, only(READY)], [B0, START, only(READY)], [B1, START, only(READY)],
  [B1, LEAVE_IN_COUNTDOWN, only(LEAVE)],
];

/** When each player is heard from: [first, last] tick ranges. a0 falls
 *  silent after tick 20, and b1 after its LEAVE in the countdown. */
const ROSTER_HEARD: readonly (readonly [id: string, from: number, to: number])[] = [
  [A0, 1, 20], [A1, 2, Infinity], [A2, 2, 15], [A3, 13, Infinity],
  [B0, 1, 14], [B0, REFILL, Infinity], [B1, 5, 11], [B1, REFILL, LEAVE_IN_COUNTDOWN], [B1, STANDS, Infinity],
];

const rosterPlay = chasey(ROSTER_SEED, 'all');

function rosterInput(id: string, pack: Pack, rank: number, t: number, s: Readonly<MatchState>): ScriptInput | null {
  let heard = false;
  for (const [who, from, to] of ROSTER_HEARD) if (who === id && t >= from && t <= to) heard = true;
  if (!heard) return null;
  // Held directions only once the match is under way.
  const input = s.phase === WARM_UP ? NOTHING : (rosterPlay(pack, rank, t, s) ?? NOTHING);
  for (const [who, tick, ev] of ROSTER_EVENTS) if (who === id && tick === t) return { ...ev, input };
  return { input, events: 0 };
}

const inPack = (s: Readonly<MatchState>, id: string, pack: Pack): boolean => member(s, id)?.pack === pack;
const absent = (s: Readonly<MatchState>, id: string): boolean => member(s, id) === null;
const readyUntil = (s: Readonly<MatchState>, id: string): number => member(s, id)?.readyUntil ?? -1;
const named = (s: Readonly<MatchState>, id: string, name: string, joinTick: number): boolean => {
  const T = member(s, id);
  return T !== null && T.name === name && T.joinTick === joinTick;
};

const ROSTER: ScriptSpec = {
  name: 'roster', packSize: 2, matchMinutes: 1, ticks: 6000, // not a setting: the run's shape
  start: 'genesis', seed: ROSTER_SEED, players: 4, mirrored: false, // not a setting: the roster's players
  input: (pack, rank, t, s) => rosterInput(ROSTER_IDS[pack]![rank]!, pack, rank, t, s),
  covers: { phases: [WARM_UP, START_COUNTDOWN, IN_PLAY] },
  checks: [
    { tick: 1, what: 'a JOIN to each pack: Ada in pack A with coat 3', holds: (s) => inPack(s, A0, 0) && member(s, A0)!.coat === 3 && named(s, A0, 'Ada', 1) },
    { tick: 1, what: 'a JOIN with coat 200 takes coat 0', holds: (s) => inPack(s, B0, 1) && member(s, B0)!.coat === 0 && named(s, B0, 'Bea', 1) },
    { tick: 2, what: 'JOINs to packs 2 and 255 are refused', holds: (s) => absent(s, A1) && absent(s, A2) && s.terriers.length === 2 },
    { tick: 3, what: `a name of ${TOO_LONG.length} characters joins as ''`, holds: (s) => inPack(s, A1, 0) && named(s, A1, '', 3) },
    { tick: 4, what: 'a JOIN to a full pack is refused', holds: (s) => absent(s, A2) && packCount(s, 0) === 2 },
    { tick: 5, what: `a name of ${3 * TOO_MANY_BYTES.length} bytes joins as ''`, holds: (s) => inPack(s, B1, 1) && named(s, B1, '', 5) },
    { tick: 6, what: "LEAVE and JOIN in one tick re-join; a control character's name joins as ''", holds: (s) => inPack(s, B1, 1) && named(s, B1, '', 6) },
    { tick: 7, what: "a C1 character's name joins as ''", holds: (s) => named(s, B1, '', 7) },
    { tick: 8, what: "a lone surrogate's name joins as ''", holds: (s) => named(s, B1, '', 8) },
    { tick: 9, what: 'a good name is kept', holds: (s) => inPack(s, B1, 1) && named(s, B1, 'Bob', 9) && s.terriers.length === 4 },
    { tick: 10, what: 'a SWITCH to a full pack is refused, and READY readies', holds: (s) => inPack(s, A0, 0) && readyUntil(s, A0) === 10 + P.readyExpiryTicks },
    { tick: 11, what: 'LEAVE frees the place', holds: (s) => absent(s, B1) && packCount(s, 1) === 1 },
    { tick: 12, what: 'a SWITCH with room moves, and cancels Ready', holds: (s) => inPack(s, A0, 1) && readyUntil(s, A0) === 0 && packCount(s, 0) === 1 },
    { tick: 13, what: "two JOINs for a pack's last place: the lower ID takes it", holds: (s) => inPack(s, A2, 0) && absent(s, A3) && packCount(s, 0) === 2 },
    { tick: 14, what: "a non-member's JOIN and SWITCH in one input: the JOIN applies", holds: (s) => absent(s, B0) && inPack(s, A3, 1) },
    { tick: 15, what: "a member's JOIN and SWITCH in one input: the SWITCH applies", holds: (s) => absent(s, A2) && inPack(s, A3, 0) && packCount(s, 1) === 1 },
    { tick: 16, what: 'READY', holds: (s) => readyUntil(s, A1) === 16 + P.readyExpiryTicks },
    { tick: 17, what: 'UNREADY', holds: (s) => readyUntil(s, A1) === 0 },
    { tick: 18, what: 'READY again', holds: (s) => readyUntil(s, A1) === 18 + P.readyExpiryTicks },
    { tick: 19, what: 'READY and UNREADY in one input leave it not ready', holds: (s) => readyUntil(s, A1) === 0 },
    { tick: REMOVED - 1, what: 'a silent member stays a tick short of the removal', holds: (s) => inPack(s, A0, 1) },
    { tick: REMOVED, what: 'a member silent for the removal time is removed', holds: (s) => absent(s, A0) && s.terriers.length === 2 },
    { tick: EXPIRES - 1, what: 'Ready holds a tick short of its expiry', holds: (s) => readyUntil(s, A3) === EXPIRES },
    { tick: EXPIRES, what: 'Ready expires after 60 s', holds: (s) => readyUntil(s, A3) === 0 && s.phase === WARM_UP },
    { tick: REFILL, what: 'both packs full, not all ready: still warm-up', holds: (s) => s.terriers.length === 4 && s.phase === WARM_UP },
    { tick: START, what: 'all ready: the start countdown', holds: (s) => s.phase === START_COUNTDOWN && s.phaseStart === START },
    { tick: LEAVE_IN_COUNTDOWN, what: 'a LEAVE in the start countdown is ignored', holds: (s) => inPack(s, B1, 1) && s.terriers.length === 4 },
    { tick: SITS - 1, what: 'a silent terrier stands a tick short of the sitting time', holds: (s) => member(s, B1)?.sitting === false },
    { tick: SITS, what: 'a silent terrier sits', holds: (s) => member(s, B1)?.sitting === true },
    { tick: STANDS, what: 'and stands when heard from again', holds: (s) => member(s, B1)?.sitting === false },
    { tick: START + P.startCountdownTicks, what: 'play begins', holds: (s) => s.phase === IN_PLAY && s.terriers.length === 4 },
  ],
};

// --- Warm-up: play around the fixed ball (D-8; design §4.2) ---

const WARM_UP_SEED = 24; // not a setting: the warm-up run's IDs
const WARM_UP_ENDS = 1200; // not a setting: a script's tick
const WARM_UP_IDS = rankedIds(WARM_UP_SEED, 2);

/** The ball as genesis put it: its body's bits on the centre spot, at rest. */
function ballAtRest(s: Readonly<MatchState>): boolean {
  const b = s.ball;
  return Object.is(b.x, 0) && Object.is(b.y, 0) && b.z === P.ballRadius && Object.is(b.vx, 0) && Object.is(b.vy, 0) && Object.is(b.vz, 0) && b.onFloor;
}

/** Warm-up play: pack A's rank 0 and pack B's rank 1, which arrive on the
 *  same line, charge at each other, and A's pounces once they're close,
 *  tumbling B's; then all four run at the fixed ball, jumping and pouncing
 *  into it, until READY. Then the start countdown, and play with nothing
 *  held, so every pounce and tumble counted is warm-up's. */
function warmUpPlay(pack: Pack, rank: number, t: number, s: Readonly<MatchState>): number {
  if (s.phase !== WARM_UP) return NOTHING;
  const k = 2 * rank + pack;
  const charging = t <= 150; // not a setting: a script's tick
  if (charging && k === 0) {
    const me = member(s, WARM_UP_IDS[0]![0]!);
    const rival = member(s, WARM_UP_IDS[1]![1]!);
    const close = me !== null && rival !== null && Math.abs(rival.x - me.x) < 2.5; // not a setting: a script's distance
    return encodeInput({ step: 0, frame: FRAME_PITCH, pounce: close || (me !== null && me.lunge + me.pounceWait > 0) ? 1 : 0 });
  }
  if (charging && k === 3) return pitchDir(16);
  return encodeInput({
    step: 0, frame: FRAME_BALL, zoomies: ((t >> 5) + k) % 3 === 0,
    jump: Math.floor((t + 11 * k) / 45), pounce: Math.floor((t + 17 * k) / 70),
  });
}

const WARM_UP_RUN: ScriptSpec = {
  name: 'warm-up', packSize: 2, matchMinutes: 1, ticks: 2400, // not a setting: the run's shape
  start: 'genesis', seed: WARM_UP_SEED, mirrored: false,
  input: joining(warmUpPlay, () => WARM_UP_ENDS),
  covers: { pounces: 1, tumbles: 1, hits: 1, phases: [WARM_UP, START_COUNTDOWN, IN_PLAY] }, // not a setting: the run's coverage
  checks: [
    ...[100, 300, 500, 700, 900, 1100, WARM_UP_ENDS - 1].map((tick) => ({ tick, what: `the ball still on the centre spot at tick ${tick}`, holds: ballAtRest })),
    { tick: 140, what: "a warm-up pounce tumbles a rival", holds: (s) => s.phase === WARM_UP && (member(s, WARM_UP_IDS[1]![1]!)?.tumble ?? 0) > 0 },
    {
      tick: WARM_UP_ENDS - 1, what: 'every terrier has met the fixed ball, which counts no touch, and the ball was hit',
      holds: (s) => s.phase === WARM_UP && s.terriers.length === 4 && s.ball.lastHitTick !== NEVER && s.ball.lastContactTick !== NEVER &&
        s.terriers.every((T) => T.lastBallContactTick !== NEVER && T.touches === 0),
    },
    { tick: WARM_UP_ENDS, what: 'READY starts the countdown', holds: (s) => s.phase === START_COUNTDOWN && ballAtRest(s) },
    { tick: WARM_UP_ENDS + P.startCountdownTicks, what: 'play begins', holds: (s) => s.phase === IN_PLAY },
  ],
};

// --- Placed runs (design §7.1) ---

/** The pushes of C-18, scoring into the +x goal. */
function pushRun(name: string, layout: 'train' | 'round', m: number, frame: 'pitch' | 'ball'): ScriptSpec {
  return placed(name, pushScene(layout, m, frame), 600, { pushes: 120, goals: 1 }); // not a setting: the run's length, and pushes in substeps
}

/** A ball at rest between two standing terriers stays at rest. */
const RESTING: ScriptSpec = placed('resting ball', RESTING_BALL, 3000, {}, [ // not a setting: the run's length
  { tick: 3000, what: 'the ball still at rest on the centre spot', holds: (s) => ballAtRest(s) && s.ball.lastContactTick === NEVER },
]);

/** The rolling slowdown brings the rolling ball to an exact stop. */
const ROLLING: ScriptSpec = placed('rolling ball', ROLLING_BALL, 3000, {}, [ // not a setting: the run's length
  { tick: 60, what: 'the ball rolling', holds: (s) => s.ball.vx > 0 && s.ball.vy > 0 && s.ball.onFloor },
  { tick: 3000, what: 'the ball stopped exactly, far along', holds: (s) => s.ball.vx === 0 && s.ball.vy === 0 && s.ball.x > 0 && s.ball.y > 0 },
]);

/** The pounces: pack A's rank 0 charges at pack B's rank 0 and pounces into
 *  it from close; a ball rolled at pack B's rank 1 bowls it over (Q-8); then
 *  everyone pounces at the ball on a schedule, as the spike's run did. */
const POUNCE_SCENE: Scene = {
  name: 'pounces and tumbles', packSize: 2, phase: IN_PLAY, mirrored: false, // not a setting: the scene's size
  setup: (s, P) => {
    place(P, s, 0, -6, 4);
    place(P, s, 1, 6, 4);
    park(P, s, 2);
    place(P, s, 3, 4, -4);
    placeBall(P, s, -4, -4, P.ballRadius, 7, 0); // not a setting: a scene's coordinate and speed
  },
  input: (pack, rank, t, s) => {
    const k = 2 * rank + pack;
    if (t <= 200) {
      if (k !== 0) return NOTHING;
      const me = s.terriers[0]!;
      const close = s.terriers[1]!.x - me.x < 2.5;
      return encodeInput({ step: 0, frame: FRAME_PITCH, pounce: close || me.lunge + me.pounceWait > 0 ? 1 : 0 });
    }
    return encodeInput({ step: [0, 0, 4, 28][(t >> 6) & 3]!, frame: FRAME_BALL, pounce: Math.floor((t + 20 * k) / 50) });
  },
};

const POUNCES: ScriptSpec = placed('pounces and tumbles', POUNCE_SCENE, 3000, { pounces: 2, tumbles: 2, hits: 1 }, [ // not a setting: the run's length
  { tick: 100, what: 'Q-8: the rolling ball bowls a standing terrier over', holds: (s) => s.terriers[3]!.tumble > 0 && s.terriers[3]!.lastBallContactTick !== NEVER },
  { tick: 160, what: 'a pounce tumbles a rival that never met the ball', holds: (s) => s.terriers[1]!.tumble > 0 && s.terriers[1]!.lastBallContactTick === NEVER },
]);

/** The nose frame's steps: forward, the arcs, reverse, the reversing arcs,
 *  and turning on the spot (D-7). */
const NOSE_STEPS = [0, 0, 4, 28, 16, 20, 12, 8, 24, 2, 30, 0] as const;

/** Vehicle-style steering: pack A's rank 0 drives forward, reverses, turns
 *  on its spot to the left, then arcs right; everyone else, and it after,
 *  drives seeded spells of the nose frame's steps, some with zoomies. */
const NOSE_SCENE: Scene = {
  name: 'nose frame', packSize: 2, phase: IN_PLAY, mirrored: false, // not a setting: the scene's size
  input: (pack, rank, t) => {
    const k = 2 * rank + pack;
    if (k === 0 && t <= 240) return encodeInput({ step: [0, 16, 8, 28][Math.floor((t - 1) / 60)]!, frame: FRAME_NOSE });
    const h = mix(mix(25, k), Math.floor(t / 37)); // not a setting: the seed and the spell
    if ((h & 7) === 0) return NOTHING;
    const step = NOSE_STEPS[(h >>> 3) % NOSE_STEPS.length]!;
    return encodeInput({ step, frame: FRAME_NOSE, zoomies: step === 0 && ((h >>> 8) & 3) === 0 });
  },
};

/** Every terrier on its kickoff spot, at rest (D-8). */
function onKickoffSpots(s: Readonly<MatchState>): boolean {
  return s.terriers.every((T) => {
    const spot = P.kickoffSpots[T.pack][s.packSize]?.[T.spot];
    return spot !== undefined && T.x === spot[0] && T.y === spot[1] && T.vx === 0 && T.vy === 0 && T.onFloor;
  });
}

/** The speed along the heading. */
function forwardSpeed(T: Readonly<Terrier>): number {
  const d = new Float64Array(2);
  dir(T.heading, d);
  return T.vx * d[0]! + T.vy * d[1]!;
}

const NOSE: ScriptSpec = placed('nose frame', NOSE_SCENE, 2000, { hits: 1 }, [ // not a setting: the run's length
  { tick: 42, what: 'forward, along the heading', holds: (s) => forwardSpeed(s.terriers[0]!) > 4 && s.terriers[0]!.headingChange === 0 },
  { tick: 108, what: 'reverse: back brakes, then reverses', holds: (s) => forwardSpeed(s.terriers[0]!) < -2 },
  { tick: 153, what: 'turning on the spot, to the left', holds: (s) => s.terriers[0]!.headingChange > 0 && Math.abs(forwardSpeed(s.terriers[0]!)) < 1 },
  { tick: 214, what: 'an arc to the right', holds: (s) => s.terriers[0]!.headingChange < 0 && forwardSpeed(s.terriers[0]!) > 2 },
]);

/** An own goal, a credited goal and the kickoff between them: pack A's
 *  terrier pushes the ball into its own goal; after the kickoff it pushes
 *  it into the +x goal while pack B's steps aside; then both chase it. */
const GOALS_SCENE: Scene = {
  name: 'goals and own goals', packSize: 1, phase: IN_PLAY, mirrored: false, // not a setting: the scene's size
  setup: (s, P) => {
    placeBall(P, s, -15, 0.5);
    place(P, s, 0, -15 + touchReach(P) + 0.5, 0.5);
    park(P, s, 1);
  },
  input: (pack, _rank, t, s) => {
    const [a, b] = s.score;
    if (a === 0 && b === 0) return pack === 0 ? pitchDir(16) : NOTHING;
    if (a === 0) {
      if (pack === 0) return pitchDir(0);
      const aside = s.phase === KICKOFF_COUNTDOWN || (s.phase === IN_PLAY && t - s.phaseStart <= 40); // not a setting: a sidestep's ticks
      return aside ? pitchDir(8) : NOTHING;
    }
    return ballDir(0, (t & 255) < 64);
  },
};

const GOALS: ScriptSpec = placed('goals and own goals', GOALS_SCENE, 3000, { goals: 2, phases: [IN_PLAY, CELEBRATION, KICKOFF_COUNTDOWN] }, [ // not a setting: the run's length
  {
    tick: 200, what: 'an own goal: it counts for pack B and credits nobody',
    holds: (s) => s.phase === CELEBRATION && s.score[0] === 0 && s.score[1] === 1 && s.ownGoal && s.scorers === 0 && s.lastGoalPack === 1 && s.terriers.every((T) => T.goals === 0),
  },
  {
    tick: 400, what: 'the kickoff after it: the ball on the centre spot, the terriers on theirs',
    holds: (s) => s.phase === KICKOFF_COUNTDOWN && ballAtRest(s) && onKickoffSpots(s) && s.scorers === 0,
  },
  {
    tick: 900, what: "a goal for pack A, credited to its terrier",
    holds: (s) => s.phase === CELEBRATION && s.score[0] === 1 && s.score[1] === 1 && !s.ownGoal && s.scorers === 1 && s.lastGoalPack === 0 && s.terriers[0]!.goals === 1,
  },
]);

/** The scrums hold the densest contacts the spike has (C-2). */
const scrum = (name: string, scene: Scene): ScriptSpec => placed(name, scene, 3000, { pushes: 1, slipOuts: 1, maxContacts: 16 }); // not a setting: the run's length, and a scrum's contacts

/** The kickoff pinch (C-21) and its slip-out, mirrored. */
const pinch = (name: string, scene: Scene, more: Coverage = {}): ScriptSpec =>
  placed(name, scene, 1500, { slipOuts: 1, phases: [KICKOFF_COUNTDOWN, IN_PLAY], ...more }, [ // not a setting: the run's length
    { tick: 1500, what: 'still mirrored', holds: isMirrored },
  ]);

// --- The suite ---

/** The golden runs, in design §7.1's order. Seeds and scripts are fixed
 *  once their coverage passes; a change that loses a run's coverage fails
 *  golden.test.ts, re-emitted or not. */
export const GOLDEN_SCRIPTS: readonly ScriptSpec[] = [
  // A kickoff after a goal, not the overtime kickoff's countdown, which sets the same phase.
  seededMatch('match 1', 1, 1, 4500, 1, { goals: 1, phases: SCORING_MATCH, overtime: false }), // not a setting: the run's shape
  // Seed 9 since M2's slip release (bots-F4): at seed 1 it no longer scored.
  seededMatch('match 4', 4, 1, 4500, 9, { goals: 1, pounces: 1, tumbles: 1, zooms: 1, phases: SCORING_MATCH, overtime: false }), // not a setting: the run's shape
  REGULATION_END,
  OVERTIME,
  ROSTER,
  WARM_UP_RUN,
  mirroredKickoff(1, 11), mirroredKickoff(2, 12), mirroredKickoff(3, 13), mirroredKickoff(4, 14),
  RESTING,
  ROLLING,
  pushRun('push 1', 'train', 1, 'pitch'),
  pushRun('train 4', 'train', 4, 'pitch'),
  pushRun('abreast 2, ball frame', 'round', 2, 'ball'),
  pushRun('abreast 4, ball frame', 'round', 4, 'ball'),
  placed('squeeze', SQUEEZE, 1200, { pushes: 1, slipOuts: 1 }, [{ tick: 1200, what: 'still mirrored', holds: isMirrored }]), // not a setting: the run's length
  pinch('pinch 2', pinchScene(2)),
  pinch('pinch 4, zoomies', pinchScene(4, true), { zooms: 1 }),
  scrum('scrum at the wall', WALL_SCRUM),
  scrum('scrum in the corner', CORNER_SCRUM),
  POUNCES,
  NOSE,
  GOALS,
  seededMatch('long run', 4, 3, 10000, 7, { // not a setting: the run's shape
    goals: 1, pounces: 1, tumbles: 1, hits: 1, zooms: 1, bounces: 1, pushes: 1, slipOuts: 1, phases: SCORING_MATCH,
  }),
];

// --- The canary (D-23; design §7.3) ---

/** Pack A's four in a train behind the ball, 4 m in front of pack B's
 *  goal, holding at it with zoomies in spells; pack B's four off the
 *  train's flanks, holding across it and pouncing on a schedule into pack
 *  A's terriers and the ball. */
const CANARY_B: readonly (readonly [x: number, y: number, step: number, at: number])[] = [
  [-1.2, 1.7, 28, 14], [-1.2, -1.7, 4, 20], [-2.6, 1.7, 28, 26], [-2.6, -1.7, 4, 32], // not a setting: a scene's coordinates, steps and ticks
];

const CANARY_SCENE: Scene = {
  name: 'canary', packSize: 4, phase: IN_PLAY, mirrored: false, // not a setting: the scene's size
  setup: (s, P) => {
    const x = P.pitch.goalLineX - 4; // not a setting: 4 m in front of the goal line
    placeBall(P, s, x, 0);
    const reach = touchReach(P);
    for (let j = 0; j < 4; j++) {
      place(P, s, 2 * j, x - reach - 0.5 * j, 0);
      place(P, s, 2 * j + 1, x + CANARY_B[j]![0], CANARY_B[j]![1]);
    }
  },
  input: (pack, rank, t) => {
    if (pack === 0) return ballDir(0, ((t >> 5) + rank) % 2 === 0);
    const [, , step, at] = CANARY_B[rank]!;
    return encodeInput({ step, frame: FRAME_PITCH, pounce: t >= at ? 1 : 0 });
  },
};

export const CANARY_SCRIPT: ScriptSpec = placed('canary', CANARY_SCENE, 300, { pushes: 1, bounces: 1, pounces: 1, tumbles: 1, goals: 1, zooms: 1 }); // not a setting: D-23's length
