// The Practice spec's setup replayed in Node (M4's design, research/m4/
// DESIGN.md, §9.1, §9.2, §9.5, M4-Q36; PLAN §16's Practice), for
// practice-spec-whole-1 to -6 and practice-spec-goal-1 to -4, split so that
// no file runs much over 8 s alone, as M3's setups were (M3's design §13).
// Played as e2e/practice.spec.ts plays it through the real page: seed 7's
// person, personId(7, 0), in Practice at 1 a side for 1 minute against its
// bot, on PracticeGame, the page's own glue, in virtual time on its timer
// (D-31); Ready pressed after the first timer run at or past a local tick,
// as the spec's Enter at its first poll at or past it; and A, the validated
// SIDEWAYS, held from each countdown and let go at the first sample whose
// head shows a second of play and e ticks more (setups.ts' specSampler).
// e counts the head's ticks: a page whose hook shows it the final state
// adds the window, w ticks, to its own. Test support: only those tests
// import it, so no build bundles it.

import { expect } from 'vitest';
import { botIds, personId } from '../core/bot/bot-id';
import { type HoldFrom, SIDEWAYS_IN_BALL_VIEW, specSampler } from '../core/bot/setups';
import type { ConfirmedEnd, ConfirmedGoal } from '../core/session/scoreboard';
import { netSettings } from '../core/session/settings';
import {
  defaultParams, encodeInput, FRAME_BALL, FRAME_PITCH, findTerrier, hashState, heldDirection, IN_PLAY, KICKOFF_COUNTDOWN, type MatchState,
  type Phase, START_COUNTDOWN, type Terrier, WARM_UP, ZOOMIES,
} from '../core/sim/index';
import { TEST_BUILD } from '../core/timeline/testing';
import type { Timeline } from '../core/timeline/timeline';
import { FakeClock, fakePage } from '../ui/clock-testing';
import { PracticeGame } from '../ui/practice';
import { mulberry32 } from './loopback';

const NET = netSettings();
const P = defaultParams;
const D = NET.timeline.delay;
const TPS = P.config.ticksPerSecond;

/** The spec's seed: its profile holds personId(7, 0) (M4's design §9.1). */
export const SEED = 7; // not a setting: the specs' seed
export const ME = personId(SEED, 0);
/** Practice's one bot at 1 a side, in pack B, whose pack must lead (PLAN §16). */
export const BOT = botIds(ME)[0]!;
const SETTINGS = { packSize: 1, matchMinutes: 1 }; // not a setting: PLAN §16's Practice, 1 a side, 1 minute

/** The whole match's Ready tick, and the anchors of the runs through the controls (M4's design §9.1). */
export const WHOLE_ANCHOR = 600; // not a setting: M4's design §9.1's fixed tick
export const GOAL_ANCHORS = [600, 1200, 1800, 2400] as const; // not a setting: M4's design §9.1's anchors
/** Every tick from an anchor to this many later is validated (M4's design §9.1): the Ready press's latitude. */
export const READY_LATITUDE = 60; // not a setting: M4's design §9.1's latitude
/** e's latitude: the release up to this many ticks after a second of play (M4's design §9.1). */
export const RELEASE_LATITUDE = 60; // not a setting: M4's design §9.1's latitude
/** The latest a hold may begin: this many ticks before its countdown's end (M4's design §9.2). */
export const LATEST_START_TICKS = 30; // not a setting: M4's design §9.2's latitude
/** The whole-match spec's menu (M4's design §9.5): opened at the second goal's latch, the clock checked still
 *  over 30 ticks' worth of time, then Resume; and at the fourth's, closed at once. As [goal, ms open]. */
export const SPEC_PAUSES = [[2, 600], [4, 100]] as const; // not a setting: M4's design §9.5's steps, and a guess at their length

/** The Ready ticks of an anchor's band: every one from it to READY_LATITUDE later. */
export const band = (anchor: number): number[] => Array.from({ length: READY_LATITUDE + 1 }, (_, k) => anchor + k);

/** e, the release's lateness, by the countdown's number, the start's 0: the same each time it's asked. */
export type Late = (kickoff: number) => number;
export const ON_TIME: Late = () => 0;
export const LATEST: Late = () => RELEASE_LATITUDE;

/** e drawn for each kickoff, 0 to RELEASE_LATITUDE, by a generator seeded from `seed` (M4's design §9.2). */
export function drawn(seed: number): Late {
  const r = mulberry32(seed);
  const e: number[] = [];
  return (k) => {
    while (e.length <= k) e.push(Math.floor(r() * (RELEASE_LATITUDE + 1)));
    return e[k]!;
  };
}

/** A run's drawn e: its own stream for each Ready tick, the whole matches' apart from the first goals',
 *  so the first goals at 600–660 draw other releases than the whole matches there do. */
export const drawnFor = (ready: number, run: 'whole' | 'goal'): Late => drawn(4 * ready + (run === 'whole' ? 1 : 2));

/** The whole matches' releases for a Ready tick (M4's design §9.2): e at 0, at 60, and drawn for each kickoff. */
export const releases = (ready: number): readonly (readonly [string, Late])[] => [['0', ON_TIME], ['60', LATEST], ['drawn', drawnFor(ready, 'whole')]];

/** practice-spec-whole-k's Ready ticks, k from 1 to 6: 9, 9, 11, 11, 11 and 10 of 600–660, so that
 *  with whole-1's and whole-2's other checks no file plays more than 33 matches, none much over 8 s
 *  alone (CLAUDE.md), as M3's bots-setups files are. */
export const WHOLE_SHARES = [9, 9, 11, 11, 11, 10] as const; // not a setting: the files' shares
export function wholeShare(k: number): number[] {
  const from = WHOLE_SHARES.slice(0, k - 1).reduce((a, b) => a + b, 0);
  return band(WHOLE_ANCHOR).slice(from, from + WHOLE_SHARES[k - 1]!);
}

/** Where in the countdown the hold begins (M4's design §9.2): its first tick, its middle, or 30 ticks before its end. */
export const HOLD_STARTS: Readonly<Record<'first' | 'middle' | 'latest', HoldFrom>> = {
  first: () => 0,
  middle: (n) => n / 2,
  latest: (n) => n - LATEST_START_TICKS,
};

// The controls run's warm-up (M4's design §9.5): each control once on Pre-match,
// by the head's tick in warm-up: W, A, S and D in ball view, W long enough
// to reach the ball from the arrival spot, 10 m off, and push on it, a
// jump, zoomies, a pounce and a bark, then S in chase view's pitch frame.
// Its presses leave their counters at 1, which every later input keeps.
const W = 0; // not a setting: A.2's step, at the ball in ball view
const A = 8; // not a setting: A.2's step, sideways
const S = 16; // not a setting: A.2's step, away
const RIGHT = 24; // not a setting: A.2's step, D
const WARM_UP_HELD: readonly (readonly [from: number, to: number, input: number])[] = [ // not a setting: a script's ticks
  [60, 200, encodeInput({ step: W, frame: FRAME_BALL })],
  [200, 230, encodeInput({ step: A, frame: FRAME_BALL })],
  [230, 260, encodeInput({ step: S, frame: FRAME_BALL })],
  [260, 290, encodeInput({ step: RIGHT, frame: FRAME_BALL })],
  [320, 380, encodeInput({ step: W, frame: FRAME_BALL }) | ZOOMIES],
  [420, 480, encodeInput({ step: S, frame: FRAME_PITCH })],
];
const WARM_UP_PRESSES = { jump: 300, pounce: 390, bark: 400 }; // not a setting: a script's ticks
/** The warm-up's last input: Ready goes at least 120 ticks after it (M4's design §9.1). */
export const WARM_UP_ENDS = 480; // not a setting: a script's tick
const PRESSED = encodeInput({ jump: 1, pounce: 1 }); // not a setting: its presses' counters
const BARKED = encodeInput({ bark: 1 }); // not a setting: its bark's counter, which the simulation never reads (D-10)
/** A.2's press counters, which a hold leaves as they were. */
const COUNTERS = encodeInput({ jump: 3, pounce: 3, bark: 3 }); // not a setting: A.2's bits

function warmUpInput(s: Readonly<MatchState>): number {
  let v = 0;
  for (const [from, to, input] of WARM_UP_HELD) if (s.tick >= from && s.tick < to) v = input;
  const at = WARM_UP_PRESSES;
  return v | encodeInput({ jump: s.tick >= at.jump ? 1 : 0, pounce: s.tick >= at.pounce ? 1 : 0, bark: s.tick >= at.bark ? 1 : 0 });
}

export interface SpecOptions {
  /** The local tick at or past which Ready is pressed. */
  readonly ready: number;
  readonly late: Late;
  readonly from?: HoldFrom;
  /** Played to the confirmed end, or to the first confirmed goal. */
  readonly to: 'end' | 'goal';
  /** Jump presses in the start countdown, as setups.ts' SpecScript takes them. */
  readonly jumps?: readonly number[];
  /** The menu opened at each of these goals' latches, 1 for the first, and closed ms later (M4's design §9.5). */
  readonly pauses?: readonly (readonly [goal: number, ms: number])[];
  /** The controls run's warm-up first, its counters kept (M4's design §9.5). */
  readonly warmUp?: boolean;
}

/** A play period's first tick, as the final state had it. */
export interface PlayStart {
  readonly tick: number;
  readonly hash: string;
  readonly person: Readonly<Terrier>;
}

/** A countdown, the start's or a kickoff's, and the play after it: first ticks, and play's end. A
 *  kickoff with a tick left on the clock ends the match at play's first tick, so no state shows play. */
export interface Period {
  readonly countdown: number;
  readonly countdownTicks: number;
  readonly play: number | null; // null: no state showed it
  readonly playEnd: number; // the first tick out of play; Infinity if the run stopped in it
}

/** One run, as the final state and the scoreboard had it when it stopped. */
export interface SpecRun {
  readonly ready: number;
  readonly late: readonly number[]; // e for each period, the start's first
  readonly goals: readonly ConfirmedGoal[];
  readonly end: ConfirmedEnd | null;
  readonly overtime: boolean;
  readonly clock: number;
  readonly periods: readonly Period[];
  readonly plays: readonly PlayStart[];
  /** The ticks the person's recorded input held a direction, first and last of each span; in a run with
   *  the warm-up, from the first input sampled in the start countdown. */
  readonly holds: readonly (readonly [number, number])[];
  /** Recorded inputs, their press counters aside, that were neither the hold nor nothing; the warm-up's
   *  aren't looked at. */
  readonly strays: readonly string[];
  /** The goals at whose latch the menu opened on a held direction (M4's design §4.8): none, or the page's
   *  menu would let go of what this replay holds on. */
  readonly heldAtMenus: readonly number[];
  readonly readyMs: number; // virtual ms from Practice's start to the Ready press
  readonly stopMs: number; // and to the stop: the first goal's latch, or the end's
  readonly stopTick: number; // the final tick then
  readonly stopHash: string;
  /** The bodies' places and motion at the stop, with the phase, the clock and the score. */
  readonly bodies: string;
}

const RUN_MS = 400_000; // not a setting: a runaway run's end, far past any whole match
const STEP_MS = 100; // not a setting: the virtual time advanced between looks

const isCountdown = (p: Phase): boolean => p === START_COUNTDOWN || p === KICKOFF_COUNTDOWN;

/** The final state's figures at a run's stop, taken then: the timeline steps it on. */
interface Stop {
  readonly ms: number;
  readonly tick: number;
  readonly overtime: boolean;
  readonly clock: number;
  readonly hash: string;
  readonly bodies: string;
}

function stopOf(ms: number, F: Readonly<MatchState>): Stop {
  const body = (x: { x: number; y: number; z: number; vx: number; vy: number; vz: number }): number[] => [x.x, x.y, x.z, x.vx, x.vy, x.vz];
  const bodies = JSON.stringify([
    F.tick, F.phase, F.phaseStart, F.clock, F.score, body(F.ball),
    F.terriers.map((T) => [T.id, ...body(T), T.heading, T.meter, T.lunge, T.pounceWait, T.tumble, T.touches, T.goals]),
  ]);
  return { ms, tick: F.tick, overtime: F.overtime, clock: F.clock, hash: hashState(F), bodies };
}

/** One run of the Practice spec's setup (M4's design §9.5): the person on the spec's hold, Ready at its
 *  tick, played until the scoreboard latches the first goal or the end. */
export function playSpec(o: SpecOptions): SpecRun {
  const clock = new FakeClock(0);
  const game = new PracticeGame({ me: ME, name: 'P0', coat: 0, settings: SETTINGS, build: TEST_BUILD, clock, page: fakePage() });
  const t = (): Timeline => game.practice.session.timeline;
  const hold = { input: SIDEWAYS_IN_BALL_VIEW, late: o.late, ...(o.from !== undefined ? { from: o.from } : {}) };
  const warmUp = o.warmUp === true;
  const spec = specSampler({ hold, ...(o.jumps !== undefined ? { jumps: o.jumps } : {}) }, warmUp ? PRESSED : 0, P);
  game.controls = () => {
    const head = t().head;
    if (!warmUp) return spec(head);
    return head.phase === WARM_UP ? warmUpInput(head) : spec(head) | BARKED;
  };
  const phases: [Phase, number][] = [];
  const plays: PlayStart[] = [];
  const inputs: [number, number][] = []; // the person's recorded inputs, as [tick, u16]
  const heldAtMenus: number[] = [];
  let recorded = 0; // the input ticks looked at
  let readyAt = -1;
  let readyMs = -1;
  let latched = 0;
  const pauses = o.pauses ?? [];
  // The final state at the timer run that stopped it.
  const stop: { at: Stop | null } = { at: null };
  game.onRun = () => {
    if (stop.at !== null) return;
    const tl = t();
    if (readyAt < 0 && tl.localTick >= o.ready) {
      game.ready(true);
      readyAt = tl.localTick;
      readyMs = clock.now();
    }
    const F = tl.final;
    const last = phases.at(-1);
    if (last === undefined || last[0] !== F.phase || last[1] !== F.phaseStart) {
      phases.push([F.phase, F.phaseStart]);
      if (F.phase === IN_PLAY && F.tick === F.phaseStart) plays.push({ tick: F.tick, hash: hashState(F), person: { ...F.terriers[findTerrier(F, ME)]! } });
    }
    for (const top = tl.localTick + D; recorded < top; ) {
      const u = ++recorded;
      const v = tl.receivedInput(ME, u);
      if (v !== undefined) inputs.push([u, v]);
    }
    const goals = game.scoreboard.goals.length;
    for (; latched < goals; latched++) {
      for (const [goal, ms] of pauses) {
        if (goal !== latched + 1) continue;
        // The menu lets go of what's held (M4's design §4.8), and this replay doesn't: the latest sample
        // holds nothing, or the page's match isn't this one.
        if (heldDirection(tl.receivedInput(ME, tl.localTick + D) ?? 0)) heldAtMenus.push(goal);
        game.pause();
        clock.after(ms, () => game.resume());
      }
    }
    if (o.to === 'goal' ? goals > 0 : game.scoreboard.end !== null) stop.at = stopOf(clock.now(), F);
  };
  while (stop.at === null && clock.now() < RUN_MS) clock.advance(STEP_MS);
  game.close();
  const at = stop.at ?? stopOf(clock.now(), t().final);
  const periods: Period[] = [];
  phases.forEach(([phase, start], k) => {
    if (!isCountdown(phase)) return;
    const next = phases[k + 1];
    const play = next?.[0] === IN_PLAY ? next[1] : null;
    const after = play === null ? next : phases[k + 2];
    const countdownTicks = phase === START_COUNTDOWN ? P.startCountdownTicks : P.kickoffCountdownTicks;
    periods.push({ countdown: start, countdownTicks, play, playEnd: after?.[1] ?? Infinity });
  });
  // The warm-up's own inputs aside: from the first sampled in the start countdown, d + 1 ticks on.
  const from = warmUp ? (periods[0]?.countdown ?? Infinity) + 1 + D : 0;
  const holds: [number, number][] = [];
  const strays: string[] = [];
  for (const [u, v] of inputs) {
    if (u < from) continue;
    if (heldDirection(v)) {
      const span = holds.at(-1);
      if (span !== undefined && span[1] === u - 1) span[1] = u;
      else holds.push([u, u]);
    }
    const rest = v & ~COUNTERS;
    if (rest !== 0 && rest !== SIDEWAYS_IN_BALL_VIEW) strays.push(`${u}: ${v}`);
  }
  // e as the run had it, from o.late, whose values don't change, rather than from what the sampler asked.
  const late = periods.map((_, k) => o.late(k));
  return {
    ready: readyAt, late, goals: [...game.scoreboard.goals], end: game.scoreboard.end, overtime: at.overtime, clock: at.clock, periods, plays,
    holds, strays, heldAtMenus, readyMs, stopMs: at.ms, stopTick: at.tick, stopHash: at.hash, bodies: at.bodies,
  };
}

/** A run's figures, for a failure's message. */
export function label(r: SpecRun): string {
  const score = r.end?.score ?? r.goals.at(-1)?.score ?? [0, 0];
  return `Ready at ${r.ready}, e ${r.late.join(' ')}: ${score.join('–')}${r.overtime ? ' after overtime' : ''}, stopped at tick ${r.stopTick}`;
}

/** Ready pressed at the tick asked, its READY riding in the input d + 1 ticks on, which starts the
 *  countdown since the bot is always ready (D-22): so each Ready tick is a start of its own. */
export function expectReadyAt(r: SpecRun, ready: number): void {
  expect([r.ready, r.periods[0]?.countdown], label(r)).toEqual([ready, ready + 1 + D]);
}

/** Ended at 0:00 with the bot's pack, B, ahead: confirmed, no overtime, not level (PLAN §16); with the
 *  goals whose latches the spec opens the menu at (M4's design §9.5), each opened on nothing held. */
export function expectWhole(r: SpecRun): void {
  const end = r.end;
  const menus = SPEC_PAUSES.every(([goal]) => r.goals.length >= goal);
  expect([end !== null, end?.winner, r.overtime, r.clock, menus, r.heldAtMenus], label(r)).toEqual([true, 1, false, 0, true, []]);
}

/** A whole match as the spec plays it, its menu opened at the second and fourth goals (M4's design §9.5). */
export const playWhole = (ready: number, late: Late, from?: HoldFrom): SpecRun =>
  playSpec({ ready, late, to: 'end', pauses: SPEC_PAUSES, ...(from !== undefined ? { from } : {}) });

/** The first confirmed goal is the bot's own, for its pack, B (PLAN §16). */
export function expectBotFirst(r: SpecRun): void {
  const g = r.goals[0];
  expect([g?.pack, g?.ownGoal, g?.scorers], label(r)).toEqual([1, false, [BOT]]);
}

/** The spec's holds, as the timeline recorded the person's input (M4's design §9.1): each from the sample
 *  its countdown shows `from` ticks in, unless one is still held, to the sample a second of play and e
 *  ticks more shows, each sample's input d + 1 ticks after the head it read; nothing else held. A play
 *  shorter than that, or none, lets nothing go: the next countdown finds it held, or the end does. */
export function expectHoldsAsPlayed(r: SpecRun, from: HoldFrom = HOLD_STARTS.first): void {
  const want: [number, number][] = [];
  let open: number | null = null;
  r.periods.forEach((p, k) => {
    open ??= p.countdown + from(p.countdownTicks) + 1 + D;
    if (p.play === null) return;
    const release = p.play + TPS + r.late[k]!;
    if (release < p.playEnd) {
      want.push([open, release + D]);
      open = null;
    }
  });
  const got = r.holds.map(([a, b]): [number, number] => [a, b]);
  // A hold the run stopped in ends where the recorded inputs do.
  if (open !== null) want.push([open, got.at(-1)?.[1] ?? open]);
  expect({ holds: got, strays: r.strays }, label(r)).toEqual({ holds: want, strays: [] });
}

const seconds = (ticks: number): string => (ticks / TPS).toFixed(1);

/** The latest end, from genesis and from Ready, for e2e/practice.spec.ts's timeout (M4's design §9.1). */
export function printEnds(file: string, runs: readonly SpecRun[]): void {
  if (runs.length === 0) return; // every run failed: its own failure says why
  const last = runs.reduce((a, b) => ((b.end?.tick ?? 0) > (a.end?.tick ?? 0) ? b : a));
  const goals = runs.map((r) => r.goals.length);
  console.log(
    `${file}: ${runs.length} whole matches; the latest end at tick ${last.end?.tick}, ${seconds(last.end?.tick ?? 0)} s from genesis, ` +
      `latched ${((last.stopMs - last.readyMs) / 1000).toFixed(1)} s after Ready (${label(last)}); ${Math.min(...goals)} to ${Math.max(...goals)} goals`,
  );
}

/** The slowest first goal, from Practice's start and from Ready, for the spec's timeouts (M4's design §9.1). */
export function printFirstGoals(file: string, runs: readonly SpecRun[]): void {
  if (runs.length === 0) return;
  const slow = runs.reduce((a, b) => (b.stopMs - b.readyMs > a.stopMs - a.readyMs ? b : a));
  const play = runs.map((r) => (r.goals[0]?.tick ?? 0) - (r.periods[0]?.play ?? 0));
  console.log(
    `${file}: ${runs.length} first goals; the slowest latched ${(slow.stopMs / 1000).toFixed(1)} s after Practice started, ` +
      `${((slow.stopMs - slow.readyMs) / 1000).toFixed(1)} s after Ready (${label(slow)}); after ${seconds(Math.min(...play))} to ${seconds(Math.max(...play))} s of play`,
  );
}
