// Test support for the match glue's clock tests (M3's design §1.24, §8.3;
// PLAN D-15, D-31): src/ui/game.test.ts's World, pages in virtual time over
// the loopback, copied with a thaw order of its own, since a browser may
// run a woken page's queued tasks either way: its late timer run first, as
// that World does, or the messages held for it first; and the phase 4
// reviewer's case, a page frozen under the stall threshold in play (M3
// phase 5). Only tests import it, so no build bundles it.

import { personId } from '../core/bot/bot-id';
import type { RoomPeer } from '../core/session/room-peer';
import { netSettings } from '../core/session/settings';
import { defaultParams, findTerrier, IN_PLAY, type MatchState, type Pack } from '../core/sim/index';
import { expectAgreement, TEST_BUILD } from '../core/timeline/testing';
import type { Timeline } from '../core/timeline/timeline';
import { type LinkSpec, LoopbackNet, type LoopNode, mulberry32, type ThawOrder } from '../net/loopback';
import type { Transport, TransportOptions } from '../net/transport';
import { FakeClock, type FakePage, fakePage } from './clock-testing';
import { NetGame, type NetGameOptions } from './game';

const NET = netSettings();
const P = defaultParams;
const SEED = 29; // not a setting: the player IDs' seed, game.test.ts's, as the reviewer's probes ran it
const ROOM = 'FREEZE-TEST-ROOM'; // not a setting: a room's name, which NetGame never parses

/** Page k's player ID. */
export const playerOf = (k: number): string => personId(SEED, k);

function uniform(seed: number, lo: number, hi: number, jitter: number): (a: string, b: string) => LinkSpec {
  const r = mulberry32(seed);
  const memo = new Map<string, number>();
  return (a, b) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!memo.has(k)) memo.set(k, lo + r() * (hi - lo));
    return { base: memo.get(k)!, jitter };
  };
}

/** A tab: its clock, its page, the NetGame it holds now, and its loopback node in each room it opened. */
export interface Tab {
  readonly k: number;
  readonly me: string;
  readonly clock: FakeClock;
  readonly page: FakePage;
  game: NetGame;
  readonly rooms: Map<string, { readonly net: LoopbackNet; readonly node: LoopNode }>;
  frozen: boolean;
}

/** Pages in virtual time: every room a LoopbackNet of its own, and every page's FakeClock, run in step a
 *  millisecond at a time, the network's events of each millisecond before the timers due at its end. A
 *  frozen page's clock and node stand still; when it thaws, its late timer run and what reached it
 *  meanwhile run in the world's thaw order, which its rooms' networks take too. */
export class World {
  now = 0;
  readonly tabs: Tab[] = [];
  readonly thawOrder: ThawOrder;
  private readonly seed: number;
  private readonly nets = new Map<string, LoopbackNet>();
  private readonly watchers: (() => void)[] = [];

  constructor(seed: number, thaw: ThawOrder = 'timer') {
    this.seed = seed;
    this.thawOrder = thaw;
  }

  /** The room's network, made when a page first opens it. */
  net(matchId: string): LoopbackNet {
    let n = this.nets.get(matchId);
    if (n === undefined) {
      const k = this.nets.size;
      n = new LoopbackNet(this.seed * 7 + k, uniform(this.seed * 13 + k, 30, 60, 20), { thaw: this.thawOrder });
      n.now = this.now;
      this.nets.set(matchId, n);
    }
    return n;
  }

  /** Page k opens room matchId, with NetGame's own options but its clock, page and transport; page 0
   *  verifies every 8th advance. */
  async open(k: number, matchId = ROOM): Promise<Tab> {
    const tab = { k, me: playerOf(k), clock: new FakeClock(this.now), page: fakePage(), rooms: new Map(), frozen: false } as Omit<Tab, 'game'> as Tab;
    const o: NetGameOptions = {
      matchId, me: tab.me, name: `P${k}`, coat: k % P.coatCount, build: TEST_BUILD, relays: null, ice: 'local',
      clock: tab.clock, page: tab.page, verify: k === 0 ? 8 : 0,
      transport: (peer, _now, t) => Promise.resolve(this.connect(tab, peer, t)),
    };
    tab.game = await NetGame.open(o);
    this.tabs.push(tab);
    return tab;
  }

  /** fn after each millisecond. */
  watch(fn: () => void): void {
    this.watchers.push(fn);
  }

  run(ms: number): void {
    const end = this.now + ms;
    while (this.now < end) this.step();
  }

  until(cond: () => boolean, ms: number): void {
    const end = this.now + ms;
    while (!cond()) {
      if (this.now >= end) throw new Error(`not reached within ${ms} ms, at ${this.now}`);
      this.step();
    }
  }

  freeze(tab: Tab): void {
    tab.frozen = true;
    for (const { net, node } of tab.rooms.values()) net.pace(node, this.now, Infinity);
  }

  /** Its late timer run, a stall's length after the last if the freeze was one, and what reached it
   *  meanwhile, in the world's order. */
  thaw(tab: Tab): void {
    tab.frozen = false;
    if (this.thawOrder === 'timer') tab.clock.stall(this.now - tab.clock.now());
    for (const { net, node } of tab.rooms.values()) {
      net.pace(node, this.now, NET.timerMs);
      net.run(this.now);
    }
    if (this.thawOrder === 'messages') tab.clock.stall(this.now - tab.clock.now());
  }

  private connect(tab: Tab, peer: RoomPeer, o: TransportOptions): Transport {
    const net = this.net(o.matchId);
    const got: { link: Transport | null } = { link: null };
    const node = net.add(`p${tab.k}`, (link) => {
      got.link = link;
      return peer;
    });
    net.join(node, this.now);
    tab.rooms.set(o.matchId, { net, node });
    if (got.link === null) throw new Error('the loopback made no link');
    return got.link;
  }

  private step(): void {
    this.now++;
    for (const n of this.nets.values()) n.run(this.now);
    for (const t of this.tabs) if (!t.frozen) t.clock.advance(this.now - t.clock.now());
    for (const fn of this.watchers) fn();
  }
}

export const timelineOf = (t: Tab): Timeline => t.game.session.timeline;
export const finalOf = (t: Tab): Readonly<MatchState> => timelineOf(t).final;
const inRoster = (t: Tab, who: string): boolean => timelineOf(t).started && findTerrier(finalOf(t), who) >= 0;

/** n pages, 200 ms apart: page 0 proposes packSize a side and plays pack A, the others play packs B, A,
 *  B; then all Ready, and on to play. */
export async function inPlay(world: World, n: number, packSize: number): Promise<Tab[]> {
  const a = await world.open(0);
  a.game.propose({ packSize, matchMinutes: 1 });
  a.game.play(0);
  const tabs = [a];
  for (let k = 1; k < n; k++) {
    world.run(200);
    const t = await world.open(k);
    t.game.play((k % 2) as Pack);
    tabs.push(t);
  }
  world.until(() => tabs.every((t) => tabs.every((u) => inRoster(t, u.me))), 8000);
  for (const t of tabs) t.game.ready(true);
  world.until(() => tabs.every((t) => finalOf(t).phase === IN_PLAY), 15_000);
  return tabs;
}

/** What a freeze left, from its start on, by page: page 1 is the frozen one. */
export interface FreezeRun {
  readonly label: string;
  readonly jumps: number[]; // its clock's jumps
  readonly ownAbsent: number[]; // its own final ticks with no input of its own
  readonly late: number[]; // the inputs it took late
  readonly verifyMismatches: number[];
  readonly stalled: boolean; // the frozen page saw a stall
}

export interface FreezeOptions {
  /** Pages, half a side: 2 by default. */
  readonly players?: number;
  /** The freeze ends this many ms before the frozen page's next rebalance, rather than at the seed's
   *  time: the median is taken just after the TICKs held for it are, in either order. */
  readonly before?: number;
}

/** When the page's clock last took the median (§1.6): its private state, read for the freeze's place. */
const lastRebalance = (t: Tab): number => (timelineOf(t) as unknown as { ticks: { lastRebalance: number } }).ticks.lastRebalance;

/** The phase 4 reviewer's case (M3 phase 5): pages in play, half a side; page 1 frozen `ms` from
 *  1000 + 37·seed ms of play, under the stall threshold, then thawed in the order given; 20 s on,
 *  every page holds one hash at every final tick they share. Seeds 1 to 16 are the reviewer's 601 to
 *  616. */
export async function freezeOnce(seed: number, thaw: ThawOrder, ms: number, o: FreezeOptions = {}): Promise<FreezeRun> {
  const players = o.players ?? 2;
  const world = new World(600 + seed, thaw);
  const tabs = await inPlay(world, players, players / 2);
  world.run(1000 + seed * 37);
  const frozen = tabs[1]!;
  if (o.before !== undefined) {
    const lead = NET.timeline.clock.rebalanceMs - o.before - ms;
    if (!(lead >= 0)) throw new RangeError(`a ${ms} ms freeze can't end ${o.before} ms before a rebalance`);
    const last = lastRebalance(frozen);
    world.until(() => lastRebalance(frozen) !== last, 2 * NET.timeline.clock.rebalanceMs);
    world.run(lead);
  }
  const before = tabs.map((t) => t.game.stats());
  const absent = ownAbsent(world);
  let stalled = false;
  world.watch(() => {
    if (frozen.game.session.stall !== 'none') stalled = true;
  });
  world.freeze(frozen);
  world.run(ms);
  world.thaw(frozen);
  world.run(20_000);
  const after = tabs.map((t) => t.game.stats());
  const run: FreezeRun = {
    label: `seed ${600 + seed}, ${thaw} first, ${ms} ms${o.before === undefined ? '' : ` ending ${o.before} ms before a rebalance`}, ${players} pages: ${after.map((s, k) => `${k} ${JSON.stringify(s.log.slice(-3))}`).join('; ')}`,
    jumps: after.map((s, k) => s.jumps - before[k]!.jumps),
    ownAbsent: absent(),
    late: after.map((s, k) => s.late - before[k]!.late),
    verifyMismatches: after.map((s) => s.verifyMismatches),
    stalled,
  };
  expectAgreement(tabs.map((t) => ({ t: timelineOf(t) })));
  for (const t of tabs) t.game.close();
  return run;
}

/** From now on, each page's own final ticks with no input of its own, whatever timeline it holds. */
export function ownAbsent(world: World): () => number[] {
  const counts = world.tabs.map(() => 0);
  const held = world.tabs.map(timelineOf);
  const last = held.map((t) => t.finalTick);
  world.watch(() => {
    world.tabs.forEach((tab, k) => {
      const t = timelineOf(tab);
      if (t !== held[k]) {
        held[k] = t;
        last[k] = t.finalTick;
      }
      for (let u = last[k]! + 1; u <= t.finalTick; u++) if (t.receivedInput(tab.me, u) === undefined) counts[k]!++;
      last[k] = Math.max(last[k]!, t.finalTick);
    });
  });
  return () => [...counts];
}
