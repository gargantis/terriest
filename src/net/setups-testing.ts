// R-7's replay of §16's three-engine setup over the loopback network (M3's
// design, research/m3/DESIGN.md, §8.1, §8.4, R-7; PLAN §16), for
// bots-setups.test.ts and bots-setups-1 to -6, split so that no file runs
// much over 8 s alone, as the marks' are (design §13). Played as §8.4 has
// e2e/match.net.spec.ts play it through the #test=net page (design §7.2):
// page k is personId(seed, k); the keeper, Chromium's page, proposes 1
// minute at pack size 2 and plays in pack A with script=back, hosting pack
// A's bot; Firefox's and WebKit's pages, opened 0.3 s apart after it, play
// in pack B with script=none; each presses Ready at the first timer run
// whose local tick is at or past the Ready tick with its terrier in the
// final roster (ready=600 in the spec); a fourth page joins as a spectator
// once the keeper's final state is in play with under 50 s on the clock,
// and WebKit's page reloads once it's under 35 s, each with no celebration
// under way, away for 0.5, 2 or 5 s. Links of 30 to 60 ms one way, with
// 20 ms of jitter. The keeper's node verifies its chain at 8 (design §8.3).
//
// From M4, the screens match's setup in the same room, with the same
// triggers and checks (M4's design, research/m4/DESIGN.md, §8.1, §9.1,
// §9.2, §9.4, M4-Q6, M4-Q36), for screens-setup-1 to -13, as
// e2e/match.screens.net.spec.ts plays it through the screens: each page's
// keys are setups.ts' specSampler, after W held for 30 ticks in warm-up;
// the keeper's player holds S, back in ball view, from each countdown to a
// second and e ticks of play, and presses Space from the head's end;
// WebKit's presses Space three times in the start countdown; Firefox's
// holds nothing; the reloaded page skips Pre-match, so presses no Ready,
// and its keys start again from the base onControl gives it; and in the
// paced runs the keeper's timers run every 50 or 100 ms, so its bot plays
// with the inputs a slow proposer skips (M4's design §8.1's last bullet):
// none at 50 ms, whose catch-ups of at most 3 ticks all go, and half at
// 100 ms, whose catch-ups of about 6 send their newest 3.
// Test support: only those tests import it, so no build bundles it.

import { expect } from 'vitest';
import { botIds, personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { BACK_IN_BALL_VIEW, type ScriptName, scriptSampler, type SpecScript, specSampler } from '../core/bot/setups';
import { ROLE } from '../core/protocol/messages';
import { Session, type SessionConfig } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import {
  CELEBRATION, defaultParams, encodeInput, ENDED, findTerrier, FRAME_BALL, heldDirection, IN_PLAY, jumpCount, KICKOFF_COUNTDOWN, type MatchState,
  NEVER, type Pack, type Phase, pounceCount, START_COUNTDOWN, type Terrier, WARM_UP,
} from '../core/sim/index';
import { expectAgreement, NetPump, TEST_BUILD } from '../core/timeline/testing';
import { type LinkSpec, LoopbackNet, type LoopNode, mulberry32 } from './loopback';
import { drawn, LATEST, type Late, ON_TIME, type Period } from './practice-spec-testing';

const NET = netSettings();
const P = defaultParams;
const B = defaultBotParams;
const D = NET.timeline.delay;
const TPS = P.config.ticksPerSecond;
const MATCH = 'e7e7e7e7e7e7e7e7'; // not a setting: a timeline ID, which no state holds
const SPECTATOR_UNDER_SECONDS = 50; // not a setting: §8.4's trigger, on the clock
const RELOAD_UNDER_SECONDS = 35; // not a setting: §8.4's trigger, on the clock
const IN_CONTROL_TICKS = 30; // not a setting: §8.4's check, the reloaded terrier's last input before the end

/** The spec's Ready tick (design §8.4). */
export const SPEC_READY = 600; // not a setting: e2e/match.net.spec.ts's ready=600
/** The reload's absences, ms (design §8.1). */
export const ABSENCES = [500, 2000, 5000] as const; // not a setting: §8.1's 0.5, 2 and 5 s

/** A page as the #test=net page drives its session (design §1.24, §7.2): a gap over stallMs between
 *  timer runs is a stall; it presses Ready at the first timer run whose local tick is at or past
 *  readyAt with its terrier in the final roster; and the test looks after each timer run. */
class Page extends Session {
  readyAt: number | null = null;
  /** The virtual ms of its Ready press, −1 before. */
  readyMs = -1;
  /** Each onControl's base (D-10), and the first input sampled after it, null until then. */
  readonly rebases: { readonly base: number; first: number | null }[] = [];
  readonly after: (() => void)[] = [];
  private pressed = false;
  private last = -1;

  override advance(now: number): void {
    if (this.last >= 0 && now - this.last > this.cfg.net.stallMs) this.stalled(now);
    this.last = now;
    super.advance(now);
    if (this.readyAt !== null && !this.pressed && this.timeline.localTick >= this.readyAt && this.inRoster()) {
      this.pressed = true;
      this.readyMs = now;
      this.ready(true);
    }
    for (const f of this.after) f();
  }
}

type Node = LoopNode<Page>;

/** Links of lo to hi ms one way, fixed per pair, with jitter. */
function uniform(seed: number, lo: number, hi: number, jitter: number): (a: string, b: string) => LinkSpec {
  const r = mulberry32(seed);
  const memo = new Map<string, number>();
  return (a, b) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!memo.has(k)) memo.set(k, lo + r() * (hi - lo));
    return { base: memo.get(k)!, jitter };
  };
}

/** A page's own input, sampled once a sent tick on its timeline's head as it stands then (design §7.2). */
type Sampler = (head: Readonly<MatchState>, headTick: number) => number;
/** A page's keys for its terrier, their press counters from the terrier's stored previous input (D-10):
 *  made as the page opens, from 0, and again at each onControl, from the base it gives. */
type Keys = (me: string, base: number) => Sampler;

/** The pages' keys; the reloaded page's are WebKit's. */
interface Scripts {
  readonly keeper: Keys;
  readonly firefox: Keys;
  readonly webkit: Keys;
  readonly spectator: Keys;
}

interface RoomOptions {
  readonly seed: number;
  readonly ready: number;
  readonly absence: number;
  readonly scripts: Scripts;
  /** The reloaded page presses Ready too: the #test=net page does, at ready=600 (M3); a page that returns
   *  through the screens skips Pre-match (M4's design §9.4). */
  readonly backReady: boolean;
  /** The keeper's timer period, ms; the timer's own if absent (M4's design §8.1). */
  readonly paceMs?: number;
}

/** What the keeper's final state showed, after each of its timer runs. */
interface Seen {
  spectatorClock: number; // ticks on the clock when the spectator joined
  reloadClock: number; // and when WebKit's page left
  countdownTick: number; // the start countdown's first tick
  firstGoalTick: number;
  /** WebKit's terrier as the keeper's final state had it when its page left. */
  leaving: Readonly<Terrier> | null;
}

/** The room of one run: the pages, what the keeper saw, and when each page's end was confirmed. */
interface Room {
  readonly seed: number;
  readonly ready: number;
  readonly absence: number;
  readonly label: string;
  readonly room: NetPump<LoopbackNet>;
  readonly keeper: Node;
  readonly firefox: Node;
  readonly webkit: Node;
  readonly spectator: Node;
  readonly back: Node;
  /** The pages that play on to the end: the keeper, Firefox's, the spectator and the reloaded page. */
  readonly pages: readonly Node[];
  readonly seen: Seen;
  /** The virtual ms at which each of `pages` first held its confirmed end, −1 before. */
  readonly endMs: Map<Node, number>;
}

const final = (n: Node): Readonly<MatchState> => n.session.timeline.final;
const ended = (n: Node): boolean => final(n).phase === ENDED && n.session.timeline.isConfirmed(final(n).phaseStart);

/** §8.4's room for a seed, a Ready tick, the reload's absence and the pages' keys, its pages joined
 *  and its triggers set, not yet run. */
function openRoom(o: RoomOptions): Room {
  const { seed, ready, absence, scripts } = o;
  const room = new NetPump(new LoopbackNet(seed, uniform(seed * 31 + 7, 30, 60, 20)));
  const net = room.net;
  const page = (k: number, keys: Keys, nodeId = `n${k}`, verify = 0): Node =>
    net.add(
      nodeId,
      room.peer(
        (link, mode) => {
          const me = personId(seed, k);
          const cfg: SessionConfig = { P, B, net: NET, me, name: `P${k}`, coat: k % P.coatCount, build: TEST_BUILD, forwarding: true, mode, verify };
          const s = new Page(cfg, link);
          let sample = keys(me, 0);
          s.controls = () => {
            const v = sample(s.timeline.head, s.timeline.headTick);
            const r = s.rebases.at(-1);
            if (r !== undefined && r.first === null) r.first = v;
            return v;
          };
          s.onControl = (base) => {
            sample = keys(me, base);
            s.rebases.push({ base, first: null });
          };
          return s;
        },
        (s) => ({ t: s.timeline, host: s.bots }),
      ),
    );
  const keeper = page(0, scripts.keeper, 'n0', 8);
  const firefox = page(1, scripts.firefox);
  const webkit = page(2, scripts.webkit);
  const spectator = page(3, scripts.spectator);
  const back = page(2, scripts.webkit, 'n2-back');
  for (const n of o.backReady ? [keeper, firefox, webkit, back] : [keeper, firefox, webkit]) n.session.readyAt = ready;
  if (o.paceMs !== undefined) net.pace(keeper, 0, o.paceMs);
  net.join(keeper, 0, (now) => {
    keeper.session.propose(keeper.local(now), { packSize: 2, matchMinutes: 1 }, MATCH);
    keeper.session.play(0);
    expect(keeper.session.addBot(0)).toBe(true);
  });
  net.join(firefox, 300, () => firefox.session.play(1));
  net.join(webkit, 600, () => webkit.session.play(1));
  // The triggers and the first goal, from the keeper's final state after each of its timer runs.
  const seen: Seen = { spectatorClock: -1, reloadClock: -1, countdownTick: -1, firstGoalTick: -1, leaving: null };
  keeper.session.after.push(() => {
    const s = final(keeper);
    if (seen.countdownTick < 0 && s.phase === START_COUNTDOWN) seen.countdownTick = s.phaseStart;
    if (seen.firstGoalTick < 0 && s.score[0] + s.score[1] > 0) seen.firstGoalTick = s.lastGoalTick;
    if (s.phase !== IN_PLAY) return;
    if (seen.spectatorClock < 0 && s.clock < SPECTATOR_UNDER_SECONDS * TPS) {
      seen.spectatorClock = s.clock;
      net.join(spectator, net.now, () => spectator.session.watch());
    }
    if (seen.reloadClock < 0 && s.clock < RELOAD_UNDER_SECONDS * TPS) {
      seen.reloadClock = s.clock;
      seen.leaving = { ...s.terriers[findTerrier(s, personId(seed, 2))]! };
      net.leave(webkit, net.now);
      net.join(back, net.now + absence);
    }
  });
  const pages = [keeper, firefox, spectator, back];
  const endMs = new Map(pages.map((n) => [n, -1]));
  for (const n of pages) {
    n.session.after.push(() => {
      if (endMs.get(n)! < 0 && ended(n)) endMs.set(n, net.now);
    });
  }
  const label = `seed ${seed}, Ready at ${ready}, away ${absence} ms${o.paceMs !== undefined ? `, the keeper paced at ${o.paceMs} ms` : ''}`;
  return { seed, ready, absence, label, room, keeper, firefox, webkit, spectator, back, pages, seen, endMs };
}

/** Plays the room until every page holds the confirmed end, and checks it as §8.4 does: every page at
 *  one end with one score, agreeing; the reloaded page back in its terrier and in control by the end;
 *  the spectator watching; the roster the setup's. */
function playToEnd(r: Room): void {
  const { seed, label, room, keeper, back, spectator, pages, seen } = r;
  room.run(400_000, () => seen.reloadClock >= 0 && pages.every(ended));
  for (const n of pages) expect(ended(n), `${label}: ${n.id} ${final(n).phase}`).toBe(true);
  expect(room.problems, label).toEqual([]);
  for (const n of room.nodes) expect(n.t.stats.verifyMismatches, `${label}: node ${n.k}`).toBe(0);
  expectAgreement(pages.map((n) => ({ t: n.session.timeline })));
  const end = final(keeper).phaseStart;
  for (const n of pages) expect([final(n).phaseStart, final(n).score.join(':')], `${label}: ${n.id}`).toEqual([end, final(keeper).score.join(':')]);
  const me = personId(seed, 2);
  expect([back.session.returning, back.session.inRoster()], label).toEqual([true, true]);
  for (const n of pages) expect(end - final(n).terriers[findTerrier(final(n), me)]!.lastInputTick, `${label}: ${n.id}`).toBeLessThan(IN_CONTROL_TICKS);
  expect([spectator.session.role(), spectator.session.inRoster()], label).toEqual([ROLE.SPECTATOR, false]);
  const roster: [string, Pack][] = [[personId(seed, 0), 0], [botIds(personId(seed, 0))[0]!, 0], [personId(seed, 1), 1], [me, 1]];
  expect(final(keeper).terriers.map((T): [string, Pack] => [T.id, T.pack]).sort(), label).toEqual(roster.sort());
}

/** One run of the setup, as the keeper's final state had it. */
export interface Outcome {
  readonly seed: number;
  readonly ready: number; // the Ready tick
  readonly absence: number; // ms the reloading page was away
  readonly score: readonly [number, number];
  readonly overtime: boolean;
  readonly countdownTick: number; // the start countdown's first tick
  readonly endTick: number;
  readonly firstGoalTick: number;
  readonly firstGoalPlayTicks: number; // ticks of play before it
  readonly spectatorClock: number; // ticks on the clock when the spectator joined
  readonly reloadClock: number; // and when WebKit's page left
}

function outcome(r: Room): Outcome {
  const s = final(r.keeper);
  const { seed, ready, absence, seen } = r;
  const playFrom = seen.countdownTick + P.startCountdownTicks;
  return {
    seed, ready, absence, score: [s.score[0], s.score[1]], overtime: s.overtime, countdownTick: seen.countdownTick, endTick: s.phaseStart,
    firstGoalTick: seen.firstGoalTick, firstGoalPlayTicks: seen.firstGoalTick - playFrom,
    spectatorClock: seen.spectatorClock, reloadClock: seen.reloadClock,
  };
}

/** §8.4's setup for a seed, a Ready tick and the reload's absence, played until every page holds the
 *  confirmed end: every page at one end with one score, agreeing; the reloaded page back in its
 *  terrier and in control by the end; the spectator watching; the roster the setup's. */
export function playSetup(seed: number, ready: number, absence: number): Outcome {
  const script = (name: ScriptName): Keys => (me, base) => scriptSampler(name, me, base, P, B);
  const scripts = { keeper: script('back'), firefox: script('none'), webkit: script('none'), spectator: script('none') };
  const r = openRoom({ seed, ready, absence, scripts, backReady: true });
  playToEnd(r);
  return outcome(r);
}

/** The run ended at 0:00 with the bot's pack, A, ahead: no overtime, a goal for A, not level (§16). */
export function expectDecisive(r: Outcome): void {
  expect([r.overtime, r.score[0] > r.score[1], r.firstGoalTick >= 0, r.spectatorClock >= 0, r.reloadClock >= 0], JSON.stringify(r)).toEqual([
    false, true, true, true, true,
  ]);
}

/** Prints the slowest first goal and the latest end of these runs, for e2e/match.net.spec.ts's
 *  timeout (design §8.1): the play before the goal, and the ticks from genesis to it and to the end,
 *  as seconds. */
export function printSlowest(file: string, runs: readonly Outcome[]): void {
  if (runs.length === 0) return; // every run failed: its own failure says why
  const goal = runs.reduce((a, b) => (b.firstGoalPlayTicks > a.firstGoalPlayTicks ? b : a));
  const last = runs.reduce((a, b) => (b.endTick > a.endTick ? b : a));
  console.log(
    `${file}: the slowest first goal came after ${(goal.firstGoalPlayTicks / TPS).toFixed(1)} s of play, ${(goal.firstGoalTick / TPS).toFixed(1)} s from genesis (seed ${goal.seed}); ` +
      `the latest end, ${(last.endTick / TPS).toFixed(1)} s from genesis (seed ${last.seed}), scores ${runs.map((r) => r.score.join('–')).join(', ')}`,
  );
}

// ---- M4: the screens match's setup (M4's design §8.1, §9.1, §9.2, §9.4, M4-Q6, M4-Q36) ----

/** The spec's seed: each page's profile holds personId(7, k) (M4's design §9.4). */
export const SCREENS_SEED = 7; // not a setting: the specs' seed
/** The Ready ticks the setup is played at (M4's design §9.2): every page presses at its first timer run at
 *  or past one, as the spec's press at their first poll at or past 600, within §9.1's 60 ticks. */
export const SCREENS_READY = [600, 630, 660] as const; // not a setting: M4's design §9.2's ticks
/** The paced runs' Ready ticks, and the keeper's timer periods in them, ms (M4's design §8.1, §9.2). */
export const PACED_READY = [600, 660] as const; // not a setting: M4's design §9.2's ticks
export const PACES = [50, 100] as const; // not a setting: M4's design §8.1's slow proposer
/** WebKit's three Space presses, ticks into the start countdown, by turns: at three polls in a row from
 *  its first tick, spread, and late, the last at the latest that leaves a second of it, 240 (M4's
 *  design §9.4's step 4). */
export const JUMPS = [[0, 3, 6], [60, 120, 180], [200, 220, 240]] as const; // not a setting: a script's ticks
/** Every player's warm-up (M4's design §9.4's step 3): W, at the ball in ball view, held for 30 ticks of
 *  its head from tick 300, 5 s in, once every page has joined. */
const WARM_UP_FROM = 300; // not a setting: a script's tick
const WARM_UP_TICKS = 30; // not a setting: §9.4's 30 ticks
const W_IN_BALL_VIEW = encodeInput({ step: 0, frame: FRAME_BALL }); // not a setting: A.2's step, at the ball
/** The keeper's closing Space (M4's design §9.4's step 7): pressed at the first sample whose head shows
 *  the end, then mashed, a press every 6 head ticks. */
const MASH_TICKS = 6; // not a setting: a script's mash, ten presses a second
/** A.2's jump counter's bits. */
const JUMP_BITS = encodeInput({ jump: 3 }); // not a setting: A.2's bits
/** A.2's press counters, which a hold leaves as they were. */
const COUNTERS = encodeInput({ jump: 3, pounce: 3, bark: 3 }); // not a setting: A.2's bits

/** e's names: at 0, at 60, and drawn for each kickoff (M4's design §9.2). */
export type ReleaseName = '0' | '60' | 'drawn';

/** One run of the screens' setup (M4's design §9.2). */
export interface ScreensOptions {
  readonly ready: number;
  readonly e: ReleaseName;
  readonly absence: number;
  /** WebKit's presses, ticks into the start countdown. */
  readonly jumps: readonly number[];
  /** The keeper's timer period, ms; null: the timer's own. */
  readonly paceMs: number | null;
  /** Every player's W in warm-up; true unless false. */
  readonly warmUp?: boolean;
}

/** The screens' e drawn for each kickoff: its own stream for each Ready tick, apart from Practice's
 *  (4 × ready + 1 and + 2, practice-spec-testing.ts' drawnFor), the paced runs sharing the unpaced
 *  run's at that tick. */
export const screensDrawn = (ready: number): Late => drawn(4 * ready + 3);

const lateOf = (o: ScreensOptions): Late => (o.e === '0' ? ON_TIME : o.e === '60' ? LATEST : screensDrawn(o.ready));

/** §9.2's 13 runs (M4's design): Ready at 600, 630 and 660, each with e at 0, at 60 and drawn, the
 *  reload's absence by turns so that each Ready tick and each e meets every absence; then the keeper
 *  paced at 50 and at 100 ms, Ready at 600 and 660, e drawn, the absences by turns. WebKit's presses
 *  by turns too. screens-setup-k plays the k-th, one a file, so that none runs much over 8 s alone
 *  (CLAUDE.md). */
export const SCREENS_RUNS: readonly ScreensOptions[] = [
  ...SCREENS_READY.flatMap((ready, r) =>
    (['0', '60', 'drawn'] as const).map((e, j): ScreensOptions => ({ ready, e, absence: ABSENCES[(r + j) % 3]!, jumps: JUMPS[j]!, paceMs: null })),
  ),
  ...PACES.flatMap((paceMs, q) =>
    PACED_READY.map((ready, r): ScreensOptions => ({ ready, e: 'drawn', absence: ABSENCES[(2 * q + r) % 3]!, jumps: JUMPS[(2 * q + r) % 3]!, paceMs })),
  ),
];

/** screens-setup-k's run, k from 1 to 13. */
export function screensRun(k: number): ScreensOptions {
  const o = SCREENS_RUNS[k - 1];
  if (o === undefined) throw new Error(`there is no screens run ${k}: screens-setup-1 to -${SCREENS_RUNS.length} play them`);
  return o;
}

/** A run's options, for a test's name and a failure's message. */
export const screensName = (o: ScreensOptions): string =>
  `Ready at ${o.ready}, e ${o.e}, away ${o.absence / 1000} s, WebKit's presses at ${o.jumps.join(', ')}` +
  (o.paceMs !== null ? `, the proposer paced at ${o.paceMs} ms` : '') + (o.warmUp === false ? ', no warm-up' : '');

/** W held over the warm-up's window of head ticks, its press counters the script's. */
const warmedUp = (sample: (head: Readonly<MatchState>) => number): ((head: Readonly<MatchState>) => number) => (head) => {
  const v = sample(head);
  const w = head.phase === WARM_UP && head.tick >= WARM_UP_FROM && head.tick < WARM_UP_FROM + WARM_UP_TICKS;
  return w ? v | W_IN_BALL_VIEW : v;
};

/** The keeper's closing Space on its script: a press at the first sample whose head shows the end, and one
 *  every MASH_TICKS of it after, a counter step a sample at most (M4-Q25). */
function closingSpace(sample: (head: Readonly<MatchState>) => number): (head: Readonly<MatchState>) => number {
  let presses = 0;
  return (head) => {
    const v = sample(head);
    if (head.phase === ENDED && presses < 1 + Math.floor((head.tick - head.phaseStart) / MASH_TICKS)) presses++;
    return (v & ~JUMP_BITS) | encodeInput({ jump: jumpCount(v) + presses });
  };
}

/** The spec's keys for each page (M4's design §9.4), each from its base (D-10). */
function screensScripts(o: ScreensOptions): Scripts {
  const late = lateOf(o);
  const warm = o.warmUp ?? true;
  const person = (script: SpecScript, closing = false): Keys => (_me, base) => {
    const spec = specSampler(script, base, P);
    const keys = warm ? warmedUp(spec) : spec;
    const all = closing ? closingSpace(keys) : keys;
    return (head) => all(head);
  };
  return {
    keeper: person({ hold: { input: BACK_IN_BALL_VIEW, late } }, true),
    firefox: person({}),
    webkit: person({ jumps: o.jumps }),
    spectator: () => () => 0,
  };
}

/** The screens' room for a run of seed 7: the reloaded page presses no Ready, and a paced keeper's
 *  timers run at its pace. */
const screensRoom = (o: ScreensOptions): Room =>
  openRoom({
    seed: SCREENS_SEED, ready: o.ready, absence: o.absence, scripts: screensScripts(o), backReady: false,
    ...(o.paceMs !== null ? { paceMs: o.paceMs } : {}),
  });

/** The keeper's figures as a slow page counts them (§8.1, src/ui/match.ts's OwnTally): after each timer
 *  run, the ticks its local tick moved and the TICKs sent, and, while it sends for anyone, the ticks a
 *  catch-up marked absent, for every sender at once. */
interface Own {
  ticks: number;
  sent: number;
  skipped: number;
  senders: number;
}

/** One run of the screens' setup, as the keeper's final state and the pages had it at the end. */
export interface ScreensRun extends Outcome {
  readonly options: ScreensOptions;
  readonly late: readonly number[]; // e for each countdown, the start's first
  /** The start countdown and each kickoff's, with the play after it, from the keeper's final state. */
  readonly periods: readonly Period[];
  /** Each countdown's first tick, with the keeper's local tick after the first timer run whose head
   *  showed it: the start's comes once the other pages' READYs have reached it, the kickoffs' on time. */
  readonly headSaw: readonly (readonly [countdown: number, local: number])[];
  /** The goals' ticks and packs, as the keeper's final state latched them. */
  readonly goals: readonly (readonly [tick: number, pack: Pack])[];
  /** The virtual ms of the latest Ready press, and of the last page's confirmed end. */
  readonly readyMs: number;
  readonly endMs: number;
  /** The keeper's own recorded inputs, as [tick, u16], from the start countdown's first sampled input. */
  readonly keeperInputs: readonly (readonly [number, number])[];
  /** The final ticks, from the start countdown's first, at which the keeper's timeline received an input
   *  holding a direction from pack B's players, as `id tick`. */
  readonly bHeld: readonly string[];
  /** The shortest and the longest gap between the keeper's timer runs, virtual ms. */
  readonly gapsMs: readonly [number, number];
  readonly own: Readonly<Own>;
  /** The keeper's player's terrier at each page's end: its stored input's jump counter, which a closing
   *  press that acted would have moved. */
  readonly keeperJumpsAtEnd: readonly number[];
  /** WebKit's terrier: at the first final state in play, as its page left, and at each page's end. */
  readonly webkitAtPlay: Readonly<Terrier> | null;
  readonly webkitLeaving: Readonly<Terrier> | null;
  readonly webkitAtEnd: readonly Readonly<Terrier>[];
  /** The reloaded page's onControl bases, each with the first input sampled after it. */
  readonly rebases: readonly { readonly base: number; readonly first: number | null }[];
}

/** One run of the screens' setup, seed 7, played until every page holds the confirmed end, with §8.4's
 *  checks of it (M4's design §9.2, §9.4). */
export function playScreens(o: ScreensOptions): ScreensRun {
  const seed = SCREENS_SEED;
  const r = screensRoom(o);
  const { keeper } = r;
  const me = personId(seed, 0);
  const packB = [personId(seed, 1), personId(seed, 2)];
  const webkitId = packB[1]!;
  const phases: [Phase, number][] = [];
  const headSaw: [number, number][] = [];
  const goals: [number, Pack][] = [];
  const inputs: [number, number][] = [];
  const bHeld: [string, number][] = [];
  const own: Own = { ticks: 0, sent: 0, skipped: 0, senders: 0 };
  const gaps = { last: -1, min: Infinity, max: -Infinity };
  let atPlay: Readonly<Terrier> | null = null;
  let recorded = 0; // the keeper's own input ticks looked at
  let finals = 0; // and its final ticks, for pack B's
  let local = -1; // the keeper's local tick and TICKs sent at its last run, −1 before its timeline holds
  let sent = 0;
  keeper.session.after.push(() => {
    const now = r.room.net.now;
    if (gaps.last >= 0) [gaps.min, gaps.max] = [Math.min(gaps.min, now - gaps.last), Math.max(gaps.max, now - gaps.last)];
    gaps.last = now;
    const t = keeper.session.timeline;
    if (!t.started) return;
    const F = t.final;
    const last = phases.at(-1);
    if (last === undefined || last[0] !== F.phase || last[1] !== F.phaseStart) {
      phases.push([F.phase, F.phaseStart]);
      if (F.phase === CELEBRATION) goals.push([F.lastGoalTick, F.lastGoalPack]);
    }
    if (atPlay === null && F.phase === IN_PLAY) atPlay = { ...F.terriers[findTerrier(F, webkitId)]! };
    const h = t.head;
    if ((h.phase === START_COUNTDOWN || h.phase === KICKOFF_COUNTDOWN) && !headSaw.some(([c]) => c === h.phaseStart)) headSaw.push([h.phaseStart, t.localTick]);
    for (const top = t.localTick + D; recorded < top; ) {
      const u = ++recorded;
      const v = t.receivedInput(me, u);
      if (v !== undefined) inputs.push([u, v]);
    }
    for (; finals < t.finalTick; ) {
      const u = ++finals;
      for (const id of packB) if (heldDirection(t.receivedInput(id, u) ?? 0)) bHeld.push([id, u]);
    }
    const senders = (t.sending ? 1 : 0) + t.bots.size;
    if (local >= 0) {
      const moved = t.localTick - local;
      const went = t.stats.sent - sent;
      own.ticks += moved;
      own.sent += went;
      if (senders > 0 && moved > went) own.skipped += moved - went;
    }
    local = t.localTick;
    sent = t.stats.sent;
    own.senders = senders;
  });
  playToEnd(r);
  const base = outcome(r);
  const late = lateOf(o);
  const periods: Period[] = [];
  phases.forEach(([phase, start], k) => {
    if (phase !== START_COUNTDOWN && phase !== KICKOFF_COUNTDOWN) return;
    const next = phases[k + 1];
    const play = next?.[0] === IN_PLAY ? next[1] : null;
    const after = play === null ? next : phases[k + 2];
    const countdownTicks = phase === START_COUNTDOWN ? P.startCountdownTicks : P.kickoffCountdownTicks;
    periods.push({ countdown: start, countdownTicks, play, playEnd: after?.[1] ?? Infinity });
  });
  const c0 = periods[0]?.countdown ?? Infinity;
  const readyMs = Math.max(...[r.keeper, r.firefox, r.webkit].map((n) => n.session.readyMs));
  const endMs = Math.max(...r.pages.map((n) => r.endMs.get(n)!));
  const at = (n: Node, id: string): Readonly<Terrier> => final(n).terriers[findTerrier(final(n), id)]!;
  return {
    ...base, options: o, late: periods.map((_, k) => late(k)), periods, headSaw, goals, readyMs, endMs,
    keeperInputs: inputs.filter(([u]) => u >= c0 + 1 + D), bHeld: bHeld.filter(([, u]) => u >= c0).map(([id, u]) => `${id} ${u}`),
    gapsMs: [gaps.min, gaps.max], own,
    keeperJumpsAtEnd: r.pages.map((n) => jumpCount(at(n, me).prevInput)),
    webkitAtPlay: atPlay, webkitLeaving: r.seen.leaving, webkitAtEnd: r.pages.map((n) => ({ ...at(n, webkitId) })),
    rebases: r.back.session.rebases.map((x) => ({ ...x })),
  };
}

/** A run's figures, for a failure's message. */
export const screensLabel = (r: ScreensRun): string =>
  `${screensName(r.options)}: ${r.score.join('–')}${r.overtime ? ' after overtime' : ''}, ended at tick ${r.endTick}, e ${r.late.join(' ')}`;

/** Ended at 0:00 with pack A ahead: no overtime, a goal for A, not level, the spectator in and the
 *  reload made (PLAN §16, M4's design §9.4). */
export function expectScreensDecisive(r: ScreensRun): void {
  expect([r.overtime, r.score[0] > r.score[1], r.firstGoalTick >= 0, r.spectatorClock >= 0, r.reloadClock >= 0], screensLabel(r)).toEqual([
    false, true, true, true, true,
  ]);
}

/** The spec's presses acted nowhere (M4's design §4.6, §9.4, D-10): WebKit's three in the start countdown
 *  moved its terrier's stored jump counter to 3 by play and took it off nowhere; the reloaded page's
 *  first input after its rebase held the base's counters, which held those 3, and its terrier's
 *  take-off tick stayed as it was when its page left, and its counters at 3, on every page to the
 *  end; and the keeper's closing Space, pressed, never reached its terrier's stored input. */
export function expectPressesDropped(r: ScreensRun): void {
  const label = screensLabel(r);
  const a = r.webkitAtPlay;
  expect([a !== null && jumpCount(a.prevInput), a?.takeOffTick], `${label}: WebKit's terrier at play`).toEqual([3, NEVER]);
  const back = r.rebases.map((x) => [jumpCount(x.base), pounceCount(x.base), x.first !== null && jumpCount(x.first), x.first !== null && pounceCount(x.first)]);
  expect(back, `${label}: the reloaded page's rebase`).toEqual([[3, 0, 3, 0]]);
  const takeOff = r.webkitLeaving?.takeOffTick;
  expect(r.webkitAtEnd.map((T) => [T.takeOffTick, jumpCount(T.prevInput)]), `${label}: WebKit's terrier at each page's end`).toEqual(
    r.webkitAtEnd.map(() => [takeOff, 3]),
  );
  const pressed = r.keeperInputs.some(([u, v]) => u > r.endTick && jumpCount(v) !== 0);
  expect([pressed, r.keeperJumpsAtEnd], `${label}: the keeper's closing Space`).toEqual([true, r.keeperJumpsAtEnd.map(() => 0)]);
}

/** The keeper's player's holds, as its timeline recorded its own input (M4's design §9.1): from the
 *  sample after the timer run whose head first showed each countdown, d + 1 ticks past that run's
 *  local tick, unless one is still held, to the sample a second of play and e ticks more shows, d
 *  ticks on; nothing else held from the start countdown on. A paced keeper's catch-ups skip ticks,
 *  which hold nothing either way, and its release comes after a timer run that moved up to a run's
 *  ticks past the second and e, so the release may be that much later. And pack B's players held
 *  nothing from the start countdown on, as the keeper's timeline received them. */
export function expectHolds(r: ScreensRun): void {
  const lag = r.options.paceMs === null ? 0 : Math.ceil(r.options.paceMs / NET.tickMs);
  const spans: [number, number][] = [];
  let open: number | null = null;
  r.periods.forEach((p, k) => {
    open ??= (r.headSaw.find(([c]) => c === p.countdown)?.[1] ?? p.countdown) + 1 + D;
    if (p.play === null) return;
    const release = p.play + TPS + r.late[k]!;
    if (release < p.playEnd) {
      spans.push([open, release + D]);
      open = null;
    }
  });
  // A hold the end found down runs past every recorded input.
  if (open !== null) spans.push([open, Infinity]);
  const wrong: string[] = [];
  for (const [u, v] of r.keeperInputs) {
    const rest = v & ~COUNTERS;
    if (rest !== 0 && rest !== BACK_IN_BALL_VIEW) wrong.push(`${u}: ${v}`);
    const held = heldDirection(v);
    const want = spans.some(([a, b]) => u >= a && u <= b);
    const either = spans.some(([, b]) => u > b && u <= b + lag);
    if (held !== want && !either) wrong.push(`${u}: ${held ? 'held' : 'let go'}`);
  }
  const holds = r.keeperInputs.filter(([, v]) => heldDirection(v)).length;
  expect({ wrong: wrong.slice(0, 10), any: holds > 0, b: r.bHeld.slice(0, 10) }, `${screensLabel(r)}: spans ${JSON.stringify(spans)}`).toEqual({
    wrong: [], any: true, b: [],
  });
}

/** The keeper's timers ran at its pace, every one of its gaps, and it sent for its player and its bot
 *  (M4's design §8.1). */
export function expectPaced(r: ScreensRun): void {
  const pace = r.options.paceMs ?? NET.timerMs;
  expect([r.gapsMs, r.own.senders], screensLabel(r)).toEqual([[pace, pace], 2]);
}

/** Every check a screens run takes (M4's design §9.2, §9.4). */
export function expectScreens(r: ScreensRun): void {
  expectScreensDecisive(r);
  expectPressesDropped(r);
  expectHolds(r);
  expectPaced(r);
}

const seconds = (ticks: number): string => (ticks / TPS).toFixed(1);

/** Each run's figures, for e2e/match.screens.net.spec.ts's timeout (M4's design §9.4): its score and
 *  goals, the end's tick from genesis, every page's confirmed end in virtual seconds after the last
 *  Ready press, and the keeper's skipped share. */
export function printScreens(file: string, runs: readonly ScreensRun[]): void {
  const after = (r: ScreensRun): number => (r.endMs - r.readyMs) / 1000;
  for (const r of runs) {
    const share = r.own.ticks > 0 ? (100 * r.own.skipped) / r.own.ticks : 0;
    console.log(
      `${file}: ${screensName(r.options)}: ${r.score.join('–')}, ${r.goals.length} goals, the first after ${seconds(r.firstGoalPlayTicks)} s of play; ` +
        `the end at tick ${r.endTick}, ${seconds(r.endTick)} s from genesis, every page's confirmed ${after(r).toFixed(1)} s after Ready; ` +
        `the keeper skipped ${r.own.skipped} of ${r.own.ticks} ticks (${share.toFixed(1)}%) for ${r.own.senders} senders`,
    );
  }
}

/** The run's room played only until the keeper's final state is a second into the start countdown, for
 *  the warm-up's check: the countdown's first tick; the keeper's final state then, as JSON, but for each
 *  terrier's gait and animation start, the drawing's (L345), which neither the simulation nor the bots
 *  read; whether every page held one hash of it; and whether each player's terrier moved between the
 *  warm-up's first tick and a second after its window, in the keeper's final state. */
export interface ToCountdown {
  readonly countdownTick: number;
  readonly placed: string;
  readonly agreed: boolean;
  readonly moved: readonly boolean[];
}

export function playToCountdown(o: ScreensOptions): ToCountdown {
  const r = screensRoom(o);
  const players = [0, 1, 2].map((k) => personId(SCREENS_SEED, k));
  const spots: Map<string, [number, number]>[] = [new Map(), new Map()];
  let placed = '';
  r.keeper.session.after.push(() => {
    const t = r.keeper.session.timeline;
    if (!t.started) return;
    const F = t.final;
    if (placed === '' && F.phase === START_COUNTDOWN && F.tick === F.phaseStart) {
      placed = JSON.stringify({ ...F, terriers: F.terriers.map(({ gait: _gait, animStart: _animStart, ...T }) => T) });
    }
    const k = F.tick >= WARM_UP_FROM + WARM_UP_TICKS + TPS ? 1 : F.tick >= WARM_UP_FROM ? 0 : -1;
    if (k < 0 || F.phase !== WARM_UP || spots[k]!.size > 0) return;
    for (const id of players) {
      const T = F.terriers[findTerrier(F, id)];
      if (T !== undefined) spots[k]!.set(id, [T.x, T.y]);
    }
  });
  r.room.run(60_000, () => r.seen.countdownTick >= 0 && final(r.keeper).tick >= r.seen.countdownTick + TPS);
  const c = r.seen.countdownTick;
  // Two runs that both missed it would compare nothing.
  if (placed === '') throw new Error(`the keeper's final state never stood at the start countdown's first tick, ${c}`);
  const moved = players.map((id) => {
    const [a, b] = [spots[0]!.get(id), spots[1]!.get(id)];
    return a !== undefined && b !== undefined && (a[0] !== b[0] || a[1] !== b[1]);
  });
  const hashes = [r.keeper, r.firefox, r.webkit].map((n) => n.session.timeline.hashAt(c));
  return { countdownTick: c, placed, agreed: hashes[0] !== '' && hashes.every((h) => h === hashes[0]), moved };
}
