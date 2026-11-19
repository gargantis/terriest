import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { botIds, personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { scriptSampler } from '../core/bot/setups';
import { netSettings } from '../core/session/settings';
import { defaultParams, findTerrier, type MatchState } from '../core/sim/index';
import { TEST_BUILD } from '../core/timeline/testing';
import type { Timeline } from '../core/timeline/timeline';
import type { PageEvents } from './clock';
import { FakeClock, fakePage, type FakePage } from './clock-testing';
import { PracticeGame, type PracticeGameOptions } from './practice';

// Practice's glue (PLAN D-22, D-31, Q-15, P10; M3's design, research/m3/
// DESIGN.md, §1.25, §8.1, §8.3), on FakeClock and fakePage in virtual time
// (C-6): the timer and the scoreboard, a stall that pauses and opens the
// menu, a shorter one caught up, a hidden page that does the same, the
// menu's pause, close and Play again; and P10's unit half: no route to
// src/net/trystero.ts, src/ui/game.ts or any package in Practice's import
// graph, and none of the network's globals touched through a Practice to
// its first goal.

vi.setConfig({ testTimeout: 60_000 });

const NET = netSettings();
const P = defaultParams;
const B = defaultBotParams;
const D = NET.timeline.delay;
const SECOND = 1000;

interface Glue {
  readonly game: PracticeGame;
  readonly clock: FakeClock;
  readonly page: FakePage;
  readonly pauses: string[];
  readonly me: string;
}

/** A Practice on a fake clock and page, the person on §16's sideways script (design §7.2). */
function glue(size = 1, o: Partial<PracticeGameOptions> = {}): Glue {
  const clock = new FakeClock(1000);
  const page = fakePage();
  const pauses: string[] = [];
  const me = personId(7, 0);
  const game = new PracticeGame({
    me, name: 'P0', coat: 0, settings: { packSize: size, matchMinutes: 1 }, build: TEST_BUILD, clock, page,
    onPause: (why) => pauses.push(why), ...o,
  });
  const sample = scriptSampler('sideways', me, 0, P, B);
  game.controls = () => sample(timeline(game).head, timeline(game).headTick);
  return { game, clock, page, pauses, me };
}

const timeline = (g: PracticeGame): Timeline => g.practice.session.timeline;
const finalOf = (g: PracticeGame): Readonly<MatchState> => timeline(g).final;
const inRoster = (x: Glue): boolean => findTerrier(finalOf(x.game), x.me) >= 0;

/** Ticks in [from, to] with no input recorded for id. */
function missing(t: Timeline, id: string, from: number, to: number): number[] {
  const out: number[] = [];
  for (let u = from; u <= to; u++) if (t.receivedInput(id, u) === undefined) out.push(u);
  return out;
}

describe('PracticeGame (design §1.25)', () => {
  it("runs on the glue's timer, 60 ticks a second, the scoreboard latching the bot's goal", () => {
    const x = glue();
    const t = timeline(x.game);
    expect([t.started, t.localTick, x.clock.pending]).toEqual([true, 0, 1]);
    expect(t.id).toMatch(/^[0-9a-f]{16}$/);
    x.clock.advance(SECOND);
    expect(t.localTick).toBe(60);
    x.clock.until(() => inRoster(x), SECOND);
    x.game.ready(true);
    x.clock.until(() => x.game.scoreboard.goals.length > 0, 30 * SECOND);
    const [goal] = x.game.scoreboard.goals;
    expect([goal!.pack, goal!.ownGoal, goal!.scorers]).toEqual([1, false, [botIds(x.me)[0]]]);
    expect(x.game.scoreboard.score).toEqual([0, 1]);
    // A lone timeline: nothing received, late or repaired; a cost for each run that moved the clock.
    const s = x.game.summary();
    expect([s.remoteInputs, s.late, s.lateAbsent, s.resyncs, s.resyncFailed]).toEqual([0, 0, 0, 0, 0]);
    expect(s.ticks).toBe(t.finalTick);
    expect(x.game.tickCosts.length).toBeGreaterThanOrEqual(t.localTick - 1);
    expect(x.pauses).toEqual([]);
    x.game.close();
  });

  it('pauses on a stall over stallMs and opens the menu, none of it caught up; a shorter one is caught up, every tick sent', () => {
    // The chain checked against a full replay after every advance (§2.7).
    const x = glue(1, { verify: 1 });
    const t = timeline(x.game);
    expect(t.cfg.verify).toBe(1);
    x.clock.advance(SECOND);
    const L = t.localTick;
    x.clock.stall(NET.stallMs + 500);
    expect([x.pauses, x.game.paused, t.localTick]).toEqual([['stall'], true, L]);
    x.clock.advance(5 * SECOND);
    expect(t.localTick).toBe(L);
    x.game.resume();
    x.clock.advance(100);
    expect(t.localTick).toBe(L + 6);
    // Shorter: caught up at once, the person's and the bot's inputs recorded for every tick (D-22).
    const M = t.localTick;
    x.clock.stall(NET.stallMs - 500);
    expect(t.localTick).toBeGreaterThanOrEqual(M + 89);
    expect(x.pauses).toEqual(['stall']);
    for (const id of [x.me, botIds(x.me)[0]!]) expect(missing(t, id, 1 + D, t.localTick + D), id).toEqual([]);
    expect(t.stats.verifyMismatches).toBe(0);
    x.game.close();
  });

  it('counts its start as run zero: a page frozen before its first timer run stalls, none of it caught up (D-22)', () => {
    const x = glue();
    const t = timeline(x.game);
    x.clock.stall(NET.stallMs + 500);
    expect([x.pauses, x.game.paused, t.localTick]).toEqual([['stall'], true, 0]);
    x.game.resume();
    x.clock.advance(100);
    expect(t.localTick).toBe(6);
    x.game.close();
  });

  it("calls onRun after each timer run's advance, and passes each correction on to onCorrection, as NetGame does", () => {
    const x = glue();
    const t = timeline(x.game);
    const seen: [number, number][] = [];
    x.game.onRun = () => {
      seen.push([x.clock.now(), t.localTick]);
    };
    x.clock.advance(SECOND);
    expect(seen).toHaveLength(Math.floor(SECOND / NET.timerMs));
    for (const [now, tick] of seen) expect(tick, `at ${now} ms`).toBe(Math.floor(t.clock(now)));
    // Practice's inputs are all its own, recorded ahead of the head, so none corrects it: one handed to
    // the timeline's hook reaches the summary and the glue's.
    const got: unknown[] = [];
    x.game.onCorrection = (c) => got.push(c);
    const c = { tick: t.headTick, from: t.headTick, before: t.head, after: t.head, repair: true };
    t.onCorrection!(c);
    expect([got, x.game.summary().repair.count]).toEqual([[c], 1]);
    x.game.close();
    x.clock.advance(100);
    expect(seen).toHaveLength(Math.floor(SECOND / NET.timerMs));
  });

  it('pauses when the page hides and opens the menu, which stays open when it shows, until Resume', () => {
    const x = glue();
    const t = timeline(x.game);
    x.clock.advance(SECOND);
    x.page.hide();
    expect([x.pauses, x.game.paused]).toEqual([['hidden'], true]);
    const L = t.localTick;
    x.clock.throttle = SECOND;
    x.clock.advance(10 * SECOND);
    x.clock.throttle = null;
    x.page.show();
    x.clock.advance(SECOND);
    expect([t.localTick, x.game.paused]).toEqual([L, true]);
    x.game.resume();
    x.clock.advance(100);
    expect(t.localTick).toBe(L + 6);
    // Hiding again opens it again; hiding with the menu open already opens nothing new.
    x.page.hide();
    expect(x.pauses).toEqual(['hidden', 'hidden']);
    x.page.show();
    x.game.resume();
    x.game.pause();
    x.page.hide();
    expect([x.pauses, x.game.paused]).toEqual([['hidden', 'hidden'], true]);
    x.game.close();
  });

  it('pauses at a timer run that finds the page hidden before its visibilitychange, and after a Resume on a hidden page', () => {
    let hidden = false;
    const page: PageEvents = { hidden: () => hidden, onVisibility: () => () => {} };
    const x = glue(1, { page });
    const t = timeline(x.game);
    x.clock.advance(SECOND);
    hidden = true;
    x.clock.advance(NET.timerMs);
    expect([x.pauses, x.game.paused]).toEqual([['hidden'], true]);
    const L = t.localTick;
    x.game.resume();
    x.clock.advance(SECOND);
    expect([x.pauses, t.localTick]).toEqual([['hidden', 'hidden'], L]);
    x.game.close();
  });

  it('pauses and resumes for the menu with no onPause, and a long pause is no stall', () => {
    const x = glue();
    const t = timeline(x.game);
    x.clock.advance(SECOND);
    x.game.pause();
    expect(x.game.paused).toBe(true);
    const L = t.localTick;
    x.clock.advance(10 * SECOND);
    expect(t.localTick).toBe(L);
    x.game.resume();
    x.clock.advance(SECOND);
    expect(t.localTick - L).toBeGreaterThanOrEqual(59);
    expect(x.pauses).toEqual([]);
    x.game.close();
  });

  it("swaps the person with the other pack's newest bot (Q-15)", () => {
    const x = glue(2);
    x.clock.until(() => finalOf(x.game).terriers.length === 4, SECOND);
    expect(x.game.switchPack()).toBe(true);
    x.clock.advance(SECOND);
    const F = finalOf(x.game);
    expect(F.terriers[findTerrier(F, x.me)]!.pack).toBe(1);
    expect(F.terriers.length).toBe(4);
    x.game.close();
  });

  it('stops its timer and its listener on close; Play again starts a new Practice with the same options and controls', () => {
    const x = glue(2);
    expect([x.clock.pending, x.page.listeners]).toEqual([1, 1]);
    x.clock.advance(SECOND);
    let calls = 0;
    x.game.controls = () => {
      calls++;
      return 0;
    };
    const next = x.game.again();
    // The old one is closed: its timer and listener gone, its clock still.
    expect([x.clock.pending, x.page.listeners]).toEqual([1, 1]);
    const old = timeline(x.game);
    const L = old.localTick;
    const t = timeline(next);
    expect(t).not.toBe(old);
    expect(t.id).not.toBe(old.id);
    expect([t.started, t.localTick, t.final.packSize, t.final.matchLengthTicks]).toEqual([true, 0, 2, old.final.matchLengthTicks]);
    x.clock.advance(SECOND);
    expect(old.localTick).toBe(L);
    expect(t.localTick).toBe(60);
    expect(calls).toBeGreaterThan(0);
    expect(finalOf(next).terriers.find((T) => T.id === x.me)?.pack).toBe(0);
    expect(finalOf(next).terriers).toHaveLength(4);
    // A closed game takes no more pauses, and its transport holds no one.
    x.game.pause();
    expect(x.game.paused).toBe(false);
    expect([next.transport.peerCount(), x.game.transport.peerCount()]).toEqual([0, 0]);
    next.close();
    next.close();
    expect([x.clock.pending, x.page.listeners]).toEqual([0, 0]);
  });
});

// --- P10's unit half (design §6.4, §8.1) ---

const root = fileURLToPath(new URL('../..', import.meta.url));
const COMMENT = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
const SPECIFIER = /\b(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

/** A source's value imports, static or import(), as written; import type and export type are erased. */
function specifiers(source: string): string[] {
  const out: string[] = [];
  for (const m of source.replace(COMMENT, '').matchAll(SPECIFIER)) if (m[1] === undefined) out.push(m[2] ?? m[3]!);
  return out;
}

/** The file a relative specifier names, as the bundler finds it. */
function resolveFile(from: string, spec: string): string {
  const base = join(dirname(from), spec);
  for (const p of [base, `${base}.ts`, join(base, 'index.ts'), base.replace(/\.js$/, '.ts')]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  throw new Error(`${spec}, from ${from}, names no file`);
}

/** Every module a source reaches through its value imports: repo paths, and package names, which it
 *  doesn't follow. As src/net/local.test.ts walks it. */
function reached(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    const path = relative(root, file).split('\\').join('/');
    if (seen.has(path)) return;
    seen.add(path);
    if (!/\.[cm]?[jt]sx?$/.test(file)) return; // data, such as a .json
    for (const spec of specifiers(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.')) visit(resolveFile(file, spec));
      else seen.add(spec);
    }
  };
  visit(join(root, entry));
  return seen;
}

describe('Practice sends nothing over any network (P10)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has no route to Trystero: neither src/net/trystero.ts, src/ui/game.ts nor any package is in its import graph', () => {
    for (const entry of ['src/ui/practice.ts', 'src/core/session/practice.ts']) {
      const graph = reached(entry);
      expect(graph.has('src/net/trystero.ts'), entry).toBe(false);
      expect(graph.has('src/ui/game.ts'), entry).toBe(false);
      expect([...graph].filter((m) => !m.startsWith('src/')), entry).toEqual([]);
    }
    const graph = reached('src/ui/practice.ts');
    for (const m of ['src/core/session/practice.ts', 'src/core/session/session.ts', 'src/net/local.ts', 'src/ui/clock.ts']) expect(graph.has(m), m).toBe(true);
    // The walk reads what it must: import() as a route, a type import as none; and it finds the
    // package behind src/net/trystero.ts.
    expect(specifiers("const m = await import('../net/trystero');\nimport type { X } from './game';\nexport { y } from './y';")).toEqual(['../net/trystero', './y']);
    expect(reached('src/net/trystero.ts').has('@trystero-p2p/nostr')).toBe(true);
  });

  it("touches none of the network's globals or the fragment through a Practice to its first goal, and offers its transport only what it drops", () => {
    const touched: string[] = [];
    const refuse = (name: string) =>
      function refused(): never {
        touched.push(name);
        throw new Error(`Practice reached ${name}`);
      };
    for (const name of ['fetch', 'WebSocket', 'RTCPeerConnection', 'XMLHttpRequest', 'EventSource']) vi.stubGlobal(name, refuse(name));
    // No #join= fragment, so a reload goes Home (D-22): neither location nor history is read or set.
    const watched = (name: string): object =>
      new Proxy({}, {
        get: (_, key) => touched.push(`${name}.${String(key)}`),
        set: (_, key) => touched.push(`${name}.${String(key)} =`) > 0,
      });
    vi.stubGlobal('location', watched('location'));
    vi.stubGlobal('history', watched('history'));
    const x = glue(1);
    const t = timeline(x.game);
    x.clock.until(() => inRoster(x), SECOND);
    x.game.ready(true);
    x.clock.until(() => x.game.scoreboard.goals.length > 0, 30 * SECOND);
    x.game.pause();
    x.game.resume();
    const next = x.game.again();
    x.clock.advance(SECOND);
    next.close();
    expect(touched).toEqual([]);
    // Each TICK sent went to the local transport, which dropped it and holds no peer.
    expect(x.game.transport.offered).toBe(t.stats.sent);
    expect(t.stats.sent).toBeGreaterThan(t.localTick - 1);
    expect([t.stats.received, x.game.transport.peerCount(), x.game.practice.session.peerCount()]).toEqual([0, 0, 0]);
    expect(next.transport.offered).toBe(timeline(next).stats.sent);
  });
});
