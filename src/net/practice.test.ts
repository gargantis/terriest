import { describe, expect, it, vi } from 'vitest';
import { BOT_SLOTS, botIds, isBot, personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { type ScriptName, scriptSampler } from '../core/bot/setups';
import { T } from '../core/protocol/messages';
import { type PracticeRun, PracticeSession, practiceTimelineId } from '../core/session/practice';
import type { Link } from '../core/session/room-peer';
import { type ConfirmedGoal, Scoreboard } from '../core/session/scoreboard';
import { type NetSettings, netSettings } from '../core/session/settings';
import { defaultParams, findTerrier, hash64, type MatchState, START_COUNTDOWN, WARM_UP } from '../core/sim/index';
import { type Mode, TEST_BUILD, twin, type Twinned, Watch, type Watched } from '../core/timeline/testing';
import type { Timeline } from '../core/timeline/timeline';
import { LocalTransport } from './local';

// Practice over the local transport (PLAN D-11, D-22, Q-15, P10; M3's
// design, research/m3/DESIGN.md, §1.17, §2.7, §6.4, §8.1): the person in the
// first pack and this browser's bots in every other place, each always
// ready; nothing but TICKs offered to the transport, each dropped; a gap
// over stallMs pausing it at its local tick, and a shorter catch-up
// recording every tick's local inputs; the menu's pause; Switch pack's swap
// in one tick; Play again; §16's Practice setup ending with the bot's first
// confirmed goal, seed 7 and 10 more, the slowest printed for
// e2e/practice-net.spec.ts's timeout; and Practice's catch-ups under the
// replay checks, as replay.test.ts runs the networked scenarios.

vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const P = defaultParams;
const B = defaultBotParams;
const MATCH = '9ac71ce09ac71ce0';
const D = NET.timeline.delay;

interface Spec {
  readonly size?: number; // a side
  readonly seed?: number; // the person's ID is personId(seed, 0)
  readonly script?: ScriptName;
  readonly net?: NetSettings;
  readonly verify?: number;
}

/** A Practice over the local transport in virtual time, as PracticeGame runs it: a timer run every
 *  timerMs, or after a gap a test gives. Each message offered is counted by its type byte. */
class Practice {
  readonly me: string;
  readonly transport = new LocalTransport();
  /** Each message offered to the transport, by its type byte. */
  readonly offered: number[] = [];
  readonly link: Link;
  p: PracticeSession;
  now = 0;

  constructor(spec: Spec = {}) {
    this.me = personId(spec.seed ?? 3, 0);
    this.link = {
      send: (peer, bytes) => {
        this.offered.push(bytes[0]!);
        this.transport.send(peer, bytes);
      },
      broadcast: (bytes) => {
        this.offered.push(bytes[0]!);
        this.transport.broadcast(bytes);
      },
    };
    this.p = new PracticeSession(
      {
        P, B, net: spec.net ?? NET, me: this.me, name: 'P0', coat: 0, settings: { packSize: spec.size ?? 2, matchMinutes: 1 },
        build: TEST_BUILD, verify: spec.verify ?? 8,
      },
      this.link,
    );
    const sample = scriptSampler(spec.script ?? 'none', this.me, 0, P, B);
    this.p.controls = () => sample(this.t.head, this.t.headTick);
    this.p.start(0, MATCH);
  }

  get t(): Timeline {
    return this.p.session.timeline;
  }

  get F(): Readonly<MatchState> {
    return this.t.final;
  }

  /** Timer runs every timerMs, for ms. */
  run(ms: number): void {
    for (let k = Math.floor(ms / NET.timerMs); k > 0; k--) this.gap(NET.timerMs);
  }

  /** One timer run, ms after the last. */
  gap(ms: number): PracticeRun {
    this.now += ms;
    return this.p.advance(this.now);
  }

  /** Timer runs until cond holds, at most ms. */
  until(cond: () => boolean, ms: number): void {
    const end = this.now + ms;
    while (!cond() && this.now < end) this.gap(NET.timerMs);
    if (!cond()) throw new Error(`not reached within ${ms} ms`);
  }

  /** The final roster, each ID with its pack, in the state's order. */
  roster(): string[] {
    return this.F.terriers.map((x) => `${x.id}:${x.pack}`);
  }
}

const full = (x: Practice): boolean => x.F.terriers.length === 2 * x.F.packSize;

describe('Practice over the local transport (D-22, Q-15)', () => {
  it('puts the person in the first pack and its bots in every other place, at each pack size', () => {
    for (const size of [1, 2, 3, 4]) {
      const x = new Practice({ size });
      x.until(() => full(x), 1000);
      // BotHost gives out its IDs in order: the first pack's bots, then the other's (§4.8).
      const ids = botIds(x.me);
      const want = [`${x.me}:0`, ...ids.slice(0, size - 1).map((b) => `${b}:0`), ...ids.slice(size - 1, 2 * size - 1).map((b) => `${b}:1`)];
      expect([...x.roster()].sort(), `${size} a side`).toEqual([...want].sort());
      expect(x.p.session.hostedBots()).toEqual(ids.slice(0, 2 * size - 1));
      // The bots joined ready; the person waits for its own Ready.
      for (const T of x.F.terriers) expect(T.readyUntil > x.F.tick, `${size} a side: ${T.id}`).toBe(isBot(T.id));
      expect(x.t.sending).toBe(true);
    }
  });

  it('keeps every bot ready through a long warm-up, past the Ready expiry, until the Ready begins the countdown (C-41)', () => {
    const x = new Practice({ size: 4 });
    x.until(() => full(x), 1000);
    const lapses: string[] = [];
    let seenTick = -1;
    while (x.F.tick < P.readyExpiryTicks + 10 * P.config.ticksPerSecond) {
      x.gap(NET.timerMs);
      if (x.F.tick === seenTick) continue;
      seenTick = x.F.tick;
      for (const T of x.F.terriers) if (isBot(T.id) && !(T.readyUntil > x.F.tick)) lapses.push(`${T.id} at ${x.F.tick}`);
    }
    expect(lapses).toEqual([]);
    expect([x.F.phase, x.F.terriers.length]).toEqual([WARM_UP, 8]);
    x.p.ready(true);
    x.until(() => x.F.phase === START_COUNTDOWN, 1000);
    expect(x.F.terriers.length).toBe(8);
  });

  it('offers the local transport nothing but TICKs, each dropped, and holds no peer (P10)', () => {
    const x = new Practice({ size: 2, script: 'brain' });
    x.until(() => full(x), 1000);
    x.run(500);
    expect(x.p.switchPack()).toBe(true);
    x.run(500);
    expect(x.gap(1500)).toBe('ran');
    expect(x.gap(2500)).toBe('stalled');
    x.p.resume(x.now);
    x.p.ready(true);
    x.run(6000);
    // Play again: AGAIN goes to no one, and the next Practice offers its TICKs to the same transport.
    x.p.session.announceAgain();
    const sent = x.t.stats.sent;
    const next = x.p.again(x.now, practiceTimelineId(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])));
    x.p = next;
    x.run(1000);
    expect(new Set(x.offered)).toEqual(new Set([T.TICK]));
    expect(x.offered.length).toBe(sent + x.t.stats.sent);
    expect(x.transport.offered).toBe(x.offered.length);
    expect([x.transport.peerCount(), x.p.session.peerCount(), x.t.stats.received]).toEqual([0, 0, 0]);
  });
});

describe('the clock (D-22, Q-15)', () => {
  it('stops for a gap over stallMs at its local tick, catching up none of it; a gap of stallMs itself catches up', () => {
    const x = new Practice({ size: 1 });
    x.run(1000);
    const L = x.t.localTick;
    const sent = x.offered.length;
    expect(x.gap(NET.stallMs + 1)).toBe('stalled');
    expect([x.p.paused, x.t.localTick, x.offered.length]).toEqual([true, L, sent]);
    // The menu is open: nothing runs, however long.
    expect(x.gap(60_000)).toBe('paused');
    expect([x.t.localTick, x.offered.length]).toEqual([L, sent]);
    x.p.resume(x.now);
    x.run(100);
    // On from its local tick: 6 ticks in 100 ms, every tick's input sent and recorded, none skipped.
    expect(x.t.localTick).toBe(L + 6);
    expect(x.offered.length).toBe(sent + 6);
    const missing = (from: number, to: number): number[] => {
      const out: number[] = [];
      for (let u = from; u <= to; u++) if (x.t.receivedInput(x.me, u) === undefined) out.push(u);
      return out;
    };
    expect(missing(1 + D, x.t.localTick + D)).toEqual([]);
    // A gap of stallMs exactly is a catch-up.
    const M = x.t.localTick;
    expect(x.gap(NET.stallMs)).toBe('ran');
    expect(x.t.localTick).toBeGreaterThanOrEqual(M + NET.stallMs / NET.tickMs - 1);
    expect(missing(1 + D, x.t.localTick + D)).toEqual([]);
  });

  it('counts the start as run zero: a first run over stallMs late stalls at tick 0, as NetGame counts it; one of stallMs catches up', () => {
    const x = new Practice({ size: 1 });
    expect(x.gap(NET.stallMs + 1000)).toBe('stalled');
    expect([x.p.paused, x.t.localTick, x.offered.length]).toEqual([true, 0, 0]);
    x.p.resume(x.now);
    x.run(100);
    expect(x.t.localTick).toBe(6);
    const y = new Practice({ size: 1 });
    expect(y.gap(NET.stallMs)).toBe('ran');
    expect(y.t.localTick).toBe(Math.floor(y.t.clock(y.now)));
    expect(y.t.localTick).toBeGreaterThanOrEqual(NET.stallMs / NET.tickMs - 1);
    expect(y.offered.length).toBe(y.t.localTick);
    expect(y.gap(NET.stallMs + 1)).toBe('stalled');
  });

  it("pauses for the menu where it stopped, and a pause over stallMs isn't a stall; one begun after a stall's gap catches none of it up", () => {
    const x = new Practice({ size: 2 });
    x.run(2000);
    const L = x.t.localTick;
    x.p.pause(x.now);
    expect(x.p.paused).toBe(true);
    expect(x.gap(NET.timerMs)).toBe('paused');
    x.run(5000);
    expect(x.t.localTick).toBe(L);
    x.p.resume(x.now);
    expect(x.gap(NET.timerMs)).toBe('ran');
    x.run(1000);
    expect(x.t.localTick - L).toBeGreaterThanOrEqual(59);
    expect(x.t.localTick - L).toBeLessThanOrEqual(61);
    // The menu opened after a gap over stallMs since the last timer run, as a hidden page's
    // visibilitychange may come after a freeze: the clock stops at the local tick.
    const M = x.t.localTick;
    x.now += 3000;
    x.p.pause(x.now);
    x.p.resume(x.now + 1000);
    x.now += 1000;
    x.run(100);
    expect(x.t.localTick).toBe(M + 6);
  });

  it("records every tick's inputs, the person's and each bot's, through a shorter catch-up, even given a networked page's settings", () => {
    // netSettings() sends only the newest stallSendTicks after a catch-up; Practice sends them all (D-22).
    expect(NET.timeline.stallSendTicks).toBeLessThan(10);
    const x = new Practice({ size: 2, net: NET, script: 'brain' });
    expect(x.p.cfg.net.timeline.stallSendTicks).toBe(Infinity);
    x.until(() => full(x), 1000);
    x.run(500);
    const before = x.t.localTick;
    const sent = x.offered.length;
    expect(x.gap(NET.stallMs - 1)).toBe('ran');
    const moved = x.t.localTick - before;
    expect(moved).toBeGreaterThan(100);
    expect(x.offered.length - sent).toBe(moved);
    const who = [x.me, ...x.p.session.hostedBots()];
    expect(who).toHaveLength(4);
    const missing: string[] = [];
    for (let u = before + 1 + D; u <= x.t.localTick + D; u++) for (const id of who) if (x.t.receivedInput(id, u) === undefined) missing.push(`${id} ${u}`);
    expect(missing).toEqual([]);
    x.run(1000);
    expect([x.F.terriers.length, x.t.stats.verifyMismatches]).toEqual([4, 0]);
  });
});

describe('Switch pack (Q-15, D-22)', () => {
  /** The final roster at each final tick from now, until stop holds. */
  function watchRosters(x: Practice, stop: () => boolean, ms: number): Map<number, string[]> {
    const seen = new Map<number, string[]>();
    const end = x.now + ms;
    while (!stop() && x.now < end) {
      x.gap(NET.timerMs);
      seen.set(x.F.tick, [...x.roster()].sort());
    }
    if (!stop()) throw new Error(`not reached within ${ms} ms`);
    return seen;
  }

  it("swaps the person with the other pack's newest bot in one tick, each pack full at every tick", () => {
    const x = new Practice({ size: 2 });
    const ids = botIds(x.me);
    x.until(() => full(x), 1000);
    x.run(200);
    // ids[2] is pack B's newest; the new bot takes the first ID neither hosted nor in the roster.
    expect(x.p.switchPack()).toBe(true);
    const at = x.t.localTick + 1 + D;
    // One swap at a time.
    expect(x.p.switchPack()).toBe(false);
    const seen = watchRosters(x, () => x.F.tick > at + 2, 1000);
    const before = [`${x.me}:0`, `${ids[0]}:0`, `${ids[1]}:1`, `${ids[2]}:1`].sort();
    const after = [`${ids[0]}:0`, `${ids[3]}:0`, `${ids[1]}:1`, `${x.me}:1`].sort();
    expect(seen.get(at - 1)).toEqual(before);
    expect(seen.get(at)).toEqual(after);
    for (const [tick, r] of seen) expect(r, `tick ${tick}`).toEqual(tick < at ? before : after);
    // The new bot joined ready; pack B's old bot is unhosted once its LEAVE is final.
    const fresh = x.F.terriers[findTerrier(x.F, ids[3]!)]!;
    expect(fresh.readyUntil).toBeGreaterThan(x.F.tick);
    expect(x.p.session.hostedBots()).toEqual([ids[0], ids[1], ids[3]]);
    expect(x.p.session.bots.hosted.map((b) => b.id)).toEqual([ids[0], ids[1], ids[3]]);
    // And back: pack A's newest bot, ids[3], leaves, and the freed ids[2] joins pack B.
    expect(x.p.switchPack()).toBe(true);
    const back = x.t.localTick + 1 + D;
    const again = watchRosters(x, () => x.F.tick > back + 2, 1000);
    expect(again.get(back)).toEqual([`${x.me}:0`, `${ids[0]}:0`, `${ids[1]}:1`, `${ids[2]}:1`].sort());
    expect(x.t.stats.verifyMismatches).toBe(0);
  });

  it("swaps at 4 a side with the spare bot ID, and again once the last swap's bot has gone (BOT_SLOTS)", () => {
    const x = new Practice({ size: 4 });
    const ids = botIds(x.me);
    expect(ids).toHaveLength(BOT_SLOTS);
    x.until(() => full(x), 1000);
    expect(x.p.session.hostedBots()).toEqual(ids.slice(0, 7));
    expect(x.p.switchPack()).toBe(true);
    const at = x.t.localTick + 1 + D;
    x.until(() => x.F.tick >= at, 1000);
    expect(x.F.terriers[findTerrier(x.F, x.me)]!.pack).toBe(1);
    // ids[6], pack B's newest, left; ids[7], the spare, took the person's place in pack A.
    expect(findTerrier(x.F, ids[6]!)).toBe(-1);
    expect(x.F.terriers[findTerrier(x.F, ids[7]!)]!.pack).toBe(0);
    x.run(100);
    expect(x.p.switchPack()).toBe(true);
    const back = x.t.localTick + 1 + D;
    x.until(() => x.F.tick >= back, 1000);
    expect(x.F.terriers[findTerrier(x.F, x.me)]!.pack).toBe(0);
    expect(x.F.terriers[findTerrier(x.F, ids[6]!)]!.pack).toBe(1);
    expect(findTerrier(x.F, ids[7]!)).toBe(-1);
    expect([x.F.terriers.length, x.F.phase]).toEqual([8, WARM_UP]);
  });

  it('refuses before the JOINs land, with a Ready on its way, and from the start countdown on, queueing nothing', () => {
    const x = new Practice({ size: 1 });
    expect(x.p.switchPack()).toBe(false);
    x.gap(NET.timerMs);
    expect(x.p.switchPack()).toBe(false);
    x.until(() => full(x), 1000);
    x.p.ready(true);
    expect(x.p.switchPack()).toBe(false);
    x.until(() => x.F.phase === START_COUNTDOWN, 1000);
    expect(x.F.terriers[findTerrier(x.F, x.me)]!.pack).toBe(0);
    expect(x.p.switchPack()).toBe(false);
    expect(x.p.session.bots.hosted).toHaveLength(1);
    expect(x.t.eventsInFlight(x.me)).toBe(0);
  });
});

describe('Play again (Q-15)', () => {
  it('starts a new Practice now, with the same settings, the same transport and the controls, contacting no one', () => {
    const x = new Practice({ size: 2, script: 'brain' });
    x.until(() => full(x), 1000);
    x.p.ready(true);
    x.run(8000);
    const old = x.p;
    let calls = 0;
    old.controls = () => {
      calls++;
      return 0;
    };
    const next = old.again(x.now, practiceTimelineId(new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9])));
    x.p = next;
    expect(next).not.toBe(old);
    expect([x.t.started, x.t.id, x.t.localTick, x.F.phase, x.F.packSize]).toEqual([true, '0909090909090909', 0, WARM_UP, 2]);
    x.until(() => full(x), 1000);
    expect(x.roster().filter((r) => r === `${x.me}:0`)).toHaveLength(1);
    expect(calls).toBeGreaterThan(0);
    expect([x.transport.peerCount(), new Set(x.offered).size]).toEqual([0, 1]);
    // Without one given, a fresh ID: 16 lowercase hex characters, never all zero.
    const third = next.again(x.now);
    expect(third.session.timeline.id).toMatch(/^[0-9a-f]{16}$/);
    expect(third.session.timeline.id).not.toBe(x.t.id);
    expect(practiceTimelineId(new Uint8Array(8))).toBe('0000000000000001');
  });
});

// --- §16's Practice setup (design §8.1, R-7) ---

interface SetupRun {
  readonly seed: number;
  readonly late: number;
  readonly bot: string;
  readonly goals: readonly ConfirmedGoal[];
  readonly pressedAt: number; // ms: when the page pressed Ready
  readonly latchedAt: number; // ms: when the first goal latched
}

/** §16's Practice setup as e2e/practice-net.spec.ts plays it through #test=net&mode=practice: 1 a
 *  side, 1 minute, the person personId(seed, 0) on script=sideways, its bot botIds(me)[0], and Ready
 *  pressed at once (ready=0), at the first timer run with its terrier in the final roster, or `late`
 *  local ticks after, as a page's late timer would; played to the first goal the scoreboard latches. */
function setupRun(seed: number, late: number): SetupRun {
  const x = new Practice({ size: 1, seed, script: 'sideways' });
  const board = new Scoreboard(P);
  let landed = -1;
  let pressedAt = -1;
  while (board.goals.length === 0 && x.now < 60_000) {
    x.gap(NET.timerMs);
    board.update(x.t);
    if (landed < 0 && findTerrier(x.F, x.me) >= 0) landed = x.t.localTick;
    if (pressedAt < 0 && landed >= 0 && x.t.localTick >= landed + late) {
      x.p.ready(true);
      pressedAt = x.now;
    }
  }
  return { seed, late, bot: botIds(x.me)[0]!, goals: [...board.goals], pressedAt, latchedAt: x.now };
}

describe("§16's Practice setup over the timeline (design §8.1)", () => {
  it("ends with the bot's first confirmed goal: seed 7 pressed at once and up to 10 ticks late, and 10 more seeds", () => {
    const runs = [
      ...Array.from({ length: 11 }, (_, late) => setupRun(7, late)),
      ...[0, 1, 2, 3, 4, 5, 6, 8, 9, 10].map((seed) => setupRun(seed, 0)),
    ];
    const bad = runs
      .filter((r) => !(r.goals.length === 1 && r.goals[0]!.pack === 1 && !r.goals[0]!.ownGoal && r.goals[0]!.scorers.join() === r.bot))
      .map((r) => `seed ${r.seed}, ${r.late} ticks late: ${JSON.stringify(r.goals)}`);
    expect(bad).toEqual([]);
    // For the spec's timeout: from Practice's start, and from the Ready press, to the latch.
    const slowest = (f: (r: SetupRun) => number): number => Math.max(...runs.map(f)) / 1000;
    const goal = runs.reduce((a, r) => (r.goals[0]!.tick > a.goals[0]!.tick ? r : a));
    console.log(
      `practice: the bot's first confirmed goal latched at most ${slowest((r) => r.latchedAt).toFixed(1)} s after Practice started, ` +
        `${slowest((r) => r.latchedAt - r.pressedAt).toFixed(1)} s after Ready; the latest at match tick ${goal.goals[0]!.tick} (seed ${goal.seed})`,
    );
  });
});

// --- Practice's catch-ups under the replay checks (design §2.7, §8.1, R-1) ---

/** One Practice over a link that traces what it's offered, its timeline watched (§2.8) around each
 *  timer run, at verify 1. */
class Twin implements Twinned {
  readonly mode: Mode;
  readonly problems: string[] = [];
  readonly trace: string[] = [];
  readonly nodes: readonly Watched[];
  readonly me = personId(5, 0);
  readonly p: PracticeSession;
  /** The most ticks one timer run moved the clock, and each run's outcome. */
  maxMoved = 0;
  readonly outcomes: PracticeRun[] = [];
  now = 0;
  private readonly watch: Watch;

  constructor(mode: Mode) {
    this.mode = mode;
    const link: Link = {
      send: (peer, bytes) => this.trace.push(`${this.now} ${peer} ${hash64(bytes)}`),
      broadcast: (bytes) => this.trace.push(`${this.now} * ${hash64(bytes)}`),
    };
    this.p = new PracticeSession(
      { P, B, net: NET, me: this.me, name: 'P0', coat: 0, settings: { packSize: 2, matchMinutes: 1 }, build: TEST_BUILD, mode, verify: 1 },
      link,
    );
    // The bot brain drives the person too, so its inputs change through every catch-up.
    const sample = scriptSampler('brain', this.me, 0, P, B);
    this.p.controls = () => sample(this.t.head, this.t.headTick);
    this.watch = new Watch(this.problems, { corrections: true });
    const p = this.p;
    this.nodes = [{ get t() { return p.session.timeline; }, watch: this.watch }];
    this.p.start(0, MATCH);
    this.watch.adopt(this.t);
  }

  get t(): Timeline {
    return this.p.session.timeline;
  }

  /** One timer run, ms after the last, under the watch. */
  gap(ms: number): PracticeRun {
    this.now += ms;
    const before = this.t.localTick;
    const b = this.watch.before(this.t);
    const r = this.p.advance(this.now);
    this.watch.advanced(this.t, `at ${this.now}`, b);
    this.maxMoved = Math.max(this.maxMoved, this.t.localTick - before);
    this.outcomes.push(r);
    this.trace.push(`${this.now} ${r} ${this.t.localTick}`);
    return r;
  }

  /** Timer runs every timerMs, for ms. */
  run(ms: number): void {
    for (let k = Math.floor(ms / NET.timerMs); k > 0; k--) this.gap(NET.timerMs);
  }
}

/** Warm-up and a swap, the countdown and play, with timer runs late by every kind of gap Practice
 *  catches up, a stall it doesn't, and the menu; the timer on time between them. Most of the
 *  countdown passes in catch-ups, since verify 1 replays the window after every advance, a clock
 *  that didn't move included. */
function catchUps(x: Twin): void {
  x.run(300);
  x.gap(250);
  expect(x.p.switchPack()).toBe(true);
  x.run(200);
  // The longest catch-up, just under the stall.
  expect(x.gap(NET.stallMs - 1)).toBe('ran');
  x.run(100);
  x.p.ready(true);
  x.run(200);
  for (const late of [700, 1300, 999, 1500, 600]) x.gap(late);
  x.run(400);
  expect(x.gap(NET.stallMs + 500)).toBe('stalled');
  x.run(100);
  x.p.resume(x.now);
  for (const late of [37, 133, 500, 61, 999, 17, 1500, 250, 250]) {
    x.run(100);
    x.gap(late);
  }
  x.p.pause(x.now);
  x.now += 3000;
  x.p.resume(x.now);
  x.run(400);
}

describe("Practice's catch-ups under the replay checks (D-11, D-22, §2.7)", () => {
  it('verifies the chain after every advance, and plays the same in fullReplay mode', () => {
    const runs: Twin[] = [];
    const inc = twin((mode) => {
      const r = new Twin(mode);
      runs.push(r);
      return r;
    }, catchUps);
    // A catch-up's budget, spreadCap a tick moved, covers it in either mode, so neither run spread and
    // twin compared every message, head and correction (§2.8).
    expect(runs.map((r) => [r.mode, r.t.stats.spreadTicks])).toEqual([['incremental', 0], ['fullReplay', 0]]);
    // It ran what it was meant to: the swap, play, a catch-up of nearly stallMs, and one stall.
    const F = inc.t.final;
    expect(F.terriers[findTerrier(F, inc.me)]!.pack).toBe(1);
    expect(F.phase).not.toBe(WARM_UP);
    expect(F.phase).not.toBe(START_COUNTDOWN);
    expect(F.clock).toBeLessThan(F.matchLengthTicks - 5 * P.config.ticksPerSecond);
    expect(inc.maxMoved).toBeGreaterThanOrEqual(NET.stallMs / NET.tickMs - 2);
    expect(inc.outcomes.filter((r) => r === 'stalled')).toHaveLength(1);
    expect(inc.t.stats.reusedFinals).toBeGreaterThan(0);
  });
});
