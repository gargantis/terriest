import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { personId } from '../core/bot/bot-id';
import { nextMatchId } from '../core/match-id';
import {
  encodeAgain, encodeStateReq, type Hello, NO_TICK, NO_TIMELINE, PROTOCOL_VERSION, REFUSAL, ROLE, T, ZERO_HASH,
} from '../core/protocol/messages';
import type { RoomPeer } from '../core/session/room-peer';
import { againTimelineId } from '../core/session/roster';
import { netSettings } from '../core/session/settings';
import { defaultParams, encodeInput, findTerrier, IN_PLAY, LEAVE, type MatchState, type Terrier, WARM_UP } from '../core/sim/index';
import { expectAgreement, TEST_BUILD } from '../core/timeline/testing';
import { LocalTransport } from '../net/local';
import { type LinkSpec, LoopbackNet, type LoopNode, mulberry32 } from '../net/loopback';
import { CURATED_RELAYS } from '../net/room-config';
import type { Transport, TransportOptions } from '../net/transport';
import { FakeClock, type FakePage, fakePage } from './clock-testing';
import { NetGame, type NetGameOptions } from './game';

// The match glue (M3's design, research/m3/DESIGN.md, §1.24, §4.5, §4.9,
// §4.12, §8.3, §8.5; PLAN D-31, Q-16): NetGame in virtual time, each page on
// a FakeClock and a fakePage, over the loopback network or a transport the
// test holds, never Trystero's. A stall between timer runs decides, rejoins
// or re-anchors, and is checked again when the page shows; a hidden page
// keeps sending; leave() closes after its grace, with its LEAVE out first;
// a fifth spectator, and a page a full room refused, leave; Play again
// proposes only without an AGAIN, under the press tick's ID, and the earlier
// of two presses wins; the counting link; the summary over every timeline a
// match passes through, a rejoin's and a merge's, and from M4 the clock's
// samples taken and dropped over a rejoin's; and only this glue loads
// src/net/trystero.ts, by import().

vi.setConfig({ testTimeout: 60_000 });

const NET = netSettings();
const P = defaultParams;
const SEED = 29;
const id = (k: number): string => personId(SEED, k);
const ROOM = 'GLUE-TEST-ROOM'; // not a setting: a room's name, which NetGame never parses
const ONE_A_SIDE = { packSize: 1, matchMinutes: 1 };

afterEach(() => {
  vi.restoreAllMocks();
});

/** crypto.getRandomValues filling each call's bytes from the next of these lists, in turn. */
function randomBytes(...lists: number[][]): void {
  let call = 0;
  vi.spyOn(crypto, 'getRandomValues').mockImplementation(<A extends ArrayBufferView | null>(a: A): A => {
    const bytes = lists[call++ % lists.length]!;
    if (a instanceof Uint8Array) for (let k = 0; k < a.length; k++) a[k] = bytes[k % bytes.length]!;
    return a;
  });
}

function uniform(seed: number, lo: number, hi: number, jitter: number): (a: string, b: string) => LinkSpec {
  const r = mulberry32(seed);
  const memo = new Map<string, number>();
  return (a, b) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!memo.has(k)) memo.set(k, lo + r() * (hi - lo));
    return { base: memo.get(k)!, jitter };
  };
}

// ---- A world of pages over the loopback ----

/** A tab: its clock, its page, the NetGame it holds now, and its loopback node in each room it opened. */
interface Tab {
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
 *  frozen page's clock and node stand still; when it thaws its timer runs first, late, and then what
 *  reached it meanwhile, as the loopback thaws a node (§6.2). */
class World {
  now = 0;
  readonly tabs: Tab[] = [];
  private readonly seed: number;
  private readonly nets = new Map<string, LoopbackNet>();
  private readonly watchers: (() => void)[] = [];

  constructor(seed: number) {
    this.seed = seed;
  }

  /** The room's network, made when a page first opens it. */
  net(matchId: string): LoopbackNet {
    let n = this.nets.get(matchId);
    if (n === undefined) {
      const k = this.nets.size;
      n = new LoopbackNet(this.seed * 7 + k, uniform(this.seed * 13 + k, 30, 60, 20));
      n.now = this.now;
      this.nets.set(matchId, n);
    }
    return n;
  }

  /** Page k opens room matchId, with NetGame's own options but its clock, page and transport. */
  async open(k: number, matchId = ROOM): Promise<Tab> {
    const tab = { k, me: id(k), clock: new FakeClock(this.now), page: fakePage(), rooms: new Map(), frozen: false } as Omit<Tab, 'game'> as Tab;
    tab.game = await NetGame.open(this.options(tab, matchId));
    this.tabs.push(tab);
    return tab;
  }

  private options(tab: Tab, matchId: string): NetGameOptions {
    return {
      matchId, me: tab.me, name: `P${tab.k}`, coat: tab.k % P.coatCount, build: TEST_BUILD, relays: null, ice: 'local',
      clock: tab.clock, page: tab.page, verify: tab.k === 0 ? 8 : 0,
      transport: (peer, _now, o) => Promise.resolve(this.connect(tab, peer, o)),
    };
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

  thaw(tab: Tab): void {
    tab.frozen = false;
    tab.clock.stall(this.now - tab.clock.now());
    for (const { net, node } of tab.rooms.values()) {
      net.pace(node, this.now, NET.timerMs);
      net.run(this.now);
    }
  }

  /** Hidden: its timers wake every `every` ms, its pings with them (D-31). */
  hide(tab: Tab, every: number): void {
    tab.clock.throttle = every;
    tab.page.hide();
    for (const { net, node } of tab.rooms.values()) net.pace(node, this.now, every);
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

const finalOf = (t: Tab): Readonly<MatchState> => t.game.session.timeline.final;
const terrierIn = (t: Tab, who: string): Readonly<Terrier> | undefined => {
  const s = finalOf(t);
  const k = findTerrier(s, who);
  return k < 0 ? undefined : s.terriers[k];
};
const inRoster = (t: Tab, who: string): boolean => t.game.session.timeline.started && terrierIn(t, who) !== undefined;
const online = (t: Tab, matchId = ROOM): boolean => t.rooms.get(matchId)!.node.online;
const ticksSent = (t: Tab): number => t.game.traffic.byType[T.TICK]?.sent ?? 0;
const spectatorsSeenBy = (t: Tab): number => [...t.game.session.connectedRoles().values()].filter((r) => r === ROLE.SPECTATOR).length;

/** Page 0 proposes 1 a side and plays pack A; page 1 joins and plays pack B; both in the roster. */
async function pair(world: World): Promise<[Tab, Tab]> {
  const a = await world.open(0);
  a.game.propose(ONE_A_SIDE);
  a.game.play(0);
  world.run(200);
  const b = await world.open(1);
  b.game.play(1);
  world.until(() => inRoster(a, b.me) && inRoster(b, b.me) && inRoster(b, a.me), 5000);
  return [a, b];
}

/** Both Ready, and on to play. */
function toPlay(world: World, tabs: readonly Tab[]): void {
  for (const t of tabs) t.game.ready(true);
  world.until(() => tabs.every((t) => finalOf(t).phase === IN_PLAY), 10_000);
}

/** The verifying page's chains all matched a full replay (design §8.3). */
function expectClean(world: World): void {
  for (const t of world.tabs) expect(t.game.stats().verifyMismatches, `page ${t.k}`).toBe(0);
}

/** These pages hold one timeline, and one hash at each final tick they share (P2). */
const agree = (tabs: readonly Tab[]): void => expectAgreement(tabs.map((t) => ({ t: t.game.session.timeline })));

// ---- A transport the test holds ----

/** Records what the session sends, and claims `peers` connections. */
class HeldTransport implements Transport {
  refusedBy: number | null = null;
  peers = 0;
  left = 0;
  readonly out: { readonly to: string | null; readonly bytes: Uint8Array }[] = [];

  send(peer: string, bytes: Uint8Array): void {
    this.out.push({ to: peer, bytes: bytes.slice() });
  }

  broadcast(bytes: Uint8Array): void {
    this.out.push({ to: null, bytes: bytes.slice() });
  }

  peerCount(): number {
    return this.peers;
  }

  leave(): Promise<void> {
    this.left++;
    return Promise.resolve();
  }
}

/** A page alone on a transport the test holds, with the room peer the transport was handed. */
async function held(over: Partial<NetGameOptions> = {}): Promise<{ game: NetGame; clock: FakeClock; page: FakePage; t: HeldTransport; peer: RoomPeer; room: TransportOptions }> {
  const clock = new FakeClock();
  const page = fakePage();
  const t = new HeldTransport();
  const got: { peer: RoomPeer | null; room: TransportOptions | null } = { peer: null, room: null };
  const game = await NetGame.open({
    matchId: ROOM, me: id(0), name: 'P0', coat: 0, build: TEST_BUILD, relays: null, ice: 'none', clock, page,
    transport: (p, _now, o) => {
      got.peer = p;
      got.room = o;
      return Promise.resolve(t);
    },
    ...over,
  });
  if (got.peer === null || got.room === null) throw new Error('the transport was never made');
  return { game, clock, page, t, peer: got.peer, room: got.room };
}

const helloOf = (player: string): Hello => ({
  type: T.HELLO, protocol: PROTOCOL_VERSION, build: TEST_BUILD, player, role: ROLE.UNDECIDED, ...NO_TIMELINE, phase: 0, name: 'X',
});

describe('opening a room (§1.24)', () => {
  it('hands the transport the curated relays and the extra ones, or exactly those given, and never none', async () => {
    const extra = ['wss://relay.example/extra', CURATED_RELAYS[0]!];
    const a = await held({ extraRelays: extra, turn: [{ urls: 'turn:turn.example:3478' }] });
    expect(a.room).toEqual({
      matchId: ROOM, relays: [...CURATED_RELAYS, extra[0]], ice: 'none', turn: [{ urls: 'turn:turn.example:3478' }], settings: NET.transport,
    });
    const b = await held({ relays: ['ws://127.0.0.1:41234'], extraRelays: extra, ice: 'local' });
    expect(b.room).toEqual({ matchId: ROOM, relays: ['ws://127.0.0.1:41234'], ice: 'local', settings: NET.transport });
    await expect(held({ relays: [] })).rejects.toThrow(/signalling relay/);
    for (const g of [a, b]) {
      g.game.close();
      expect(g.t.left).toBe(1);
    }
  });

  it('proposes under 8 random bytes, never all zero, and runs the timeline on its clock every timerMs', async () => {
    randomBytes([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08], [0]);
    const a = await held();
    a.game.propose(ONE_A_SIDE);
    expect([a.game.session.timeline.id, a.game.session.timeline.started, a.game.session.role()]).toEqual(['0102030405060708', true, ROLE.KEEPER]);
    expect(a.game.arrivedTick).toBe(0);
    a.clock.advance(1000);
    // Advanced by the timer due at 1,000 ms: a second's ticks.
    const t = a.game.session.timeline;
    expect(t.localTick).toBe(Math.floor(t.clock(1000)));
    expect(Math.abs(t.localTick - 1000 / NET.tickMs)).toBeLessThanOrEqual(1);
    const b = await held();
    b.game.propose(ONE_A_SIDE);
    expect(b.game.session.timeline.id).toBe('0000000000000001');
    a.game.close();
    b.game.close();
    expect([a.clock.pending, a.page.listeners]).toEqual([0, 0]);
  });

  it("calls onRun after each timer run's advance, where the page presses Ready at its tick (§7.2)", async () => {
    const a = await held();
    a.game.propose(ONE_A_SIDE);
    const t = a.game.session.timeline;
    const seen: [number, number][] = [];
    a.game.onRun = () => {
      seen.push([a.clock.now(), t.localTick]);
    };
    a.clock.advance(1000);
    expect(seen).toHaveLength(Math.floor(1000 / NET.timerMs));
    for (const [now, tick] of seen) expect(tick, `at ${now} ms`).toBe(Math.floor(t.clock(now)));
    a.game.close();
    a.clock.advance(100);
    expect(seen).toHaveLength(Math.floor(1000 / NET.timerMs));
  });
});

describe('the counting link (§1.24, §8.5)', () => {
  it("counts the session's messages by type byte: a send once, a broadcast once a connection, and each one the transport hands in", async () => {
    const a = await held();
    a.t.peers = 2;
    a.game.propose(ONE_A_SIDE);
    a.game.play(0);
    a.clock.advance(500);
    // A peer that the test handshakes by hand asks for the state: the answer is a send.
    const x = id(9);
    const verdict = a.peer.checkHello(helloOf(x), a.clock.now(), 'x');
    expect(verdict.ok).toBe(true);
    a.peer.onPeerJoin('x', helloOf(x), a.peer.hello(), a.clock.now());
    const ask = encodeStateReq(NO_TICK, ZERO_HASH);
    a.peer.onMessage('x', ask, a.clock.now());
    // Whatever the session makes of it, a message handed in is counted: one from no connection too.
    a.peer.onMessage('nobody', encodeAgain(), a.clock.now());
    a.clock.advance(500);
    const want: Record<number, { sent: number; sentBytes: number }> = {};
    for (const m of a.t.out) {
      const copies = m.to === null ? a.t.peers : 1;
      const row = (want[m.bytes[0]!] ??= { sent: 0, sentBytes: 0 });
      row.sent += copies;
      row.sentBytes += copies * m.bytes.length;
    }
    expect(Object.keys(want).map(Number).sort((p, q) => p - q)).toEqual([T.TICK, T.PEERS, T.STATE].sort((p, q) => p - q));
    expect(want[T.STATE]!.sent).toBe(1);
    for (const [type, w] of Object.entries(want)) expect(a.game.traffic.byType[Number(type)], `type ${type}`).toMatchObject(w);
    expect(a.game.traffic.byType[T.STATE_REQ]).toEqual({ sent: 0, sentBytes: 0, received: 1, receivedBytes: ask.length });
    expect(a.game.traffic.byType[T.AGAIN]).toMatchObject({ received: 1, receivedBytes: 1 });
    const total = Object.values(a.game.traffic.byType).reduce((s, r) => s + r.sent, 0);
    expect([a.game.traffic.sent, a.game.traffic.received]).toEqual([total, 2]);
    a.game.close();
    // After its close the room hands nothing in.
    a.peer.onMessage('x', ask, a.clock.now());
    expect(a.game.traffic.received).toBe(2);
  });

  it("matches the network's own count: two pages' messages and bytes, type by type", async () => {
    const world = new World(1);
    const [a, b] = await pair(world);
    // The page's own input, as the session samples it once a sent tick.
    const input = encodeInput({ step: 4, zoomies: true });
    a.game.controls = () => input;
    world.run(3000);
    const tb = b.game.session.timeline;
    expect(tb.receivedInput(a.me, tb.finalTick)).toBe(input);
    const net = world.net(ROOM);
    const none = { sent: 0, received: 0, sentBytes: 0, receivedBytes: 0 };
    expect(net.byType.size).toBeGreaterThanOrEqual(3);
    for (const [type, n] of net.byType) {
      const [x, y] = [a.game.traffic.byType[type] ?? none, b.game.traffic.byType[type] ?? none];
      expect([x.sent + y.sent, x.sentBytes + y.sentBytes], `type ${type}`).toEqual([n.messages, n.bytes]);
    }
    for (const g of [a.game, b.game]) for (const type of Object.keys(g.traffic.byType)) expect(net.byType.has(Number(type)), `type ${type}`).toBe(true);
    // What arrived is what the other sent, but for those still on their way.
    const [x, y] = [a.game.traffic.byType[T.TICK]!, b.game.traffic.byType[T.TICK]!];
    expect(x.received).toBeLessThanOrEqual(y.sent);
    expect(x.received).toBeGreaterThan(y.sent - 10);
    expect(y.received).toBeLessThanOrEqual(x.sent);
    expect(y.received).toBeGreaterThan(x.sent - 10);
    agree([a, b]);
    expectClean(world);
  });
});

/** A page alone on Practice's local transport, which sends nothing anywhere. */
function alone(clock: FakeClock): Promise<NetGame> {
  return NetGame.open({
    matchId: ROOM, me: id(0), name: 'P0', coat: 0, build: TEST_BUILD, relays: null, ice: 'none', clock, page: fakePage(),
    transport: () => Promise.resolve(new LocalTransport()),
  });
}

describe('stalls and hidden pages (D-31, §4.12)', () => {
  it('counts from the timer starting: its first run is no stall, unless the page froze before it', async () => {
    // A browser's clock reads well past stallMs when a match opens.
    const clock = new FakeClock(10_000);
    const game = await alone(clock);
    game.propose(ONE_A_SIDE);
    clock.advance(NET.timerMs);
    expect(game.session.stall).toBe('none');
    const frozen = new FakeClock(10_000);
    const other = await alone(frozen);
    other.propose(ONE_A_SIDE);
    frozen.stall(NET.stallMs + 1);
    expect(other.session.stall).toBe('deciding');
    game.close();
    other.close();
  });

  it('takes a gap over stallMs between timer runs as a stall, not one of stallMs, and re-anchors with no peer that ran on', async () => {
    const clock = new FakeClock();
    const game = await alone(clock);
    // Each run that moves the clock leaves its cost: 0 on a FakeClock, which stands still in a run.
    let moved = 0;
    const advance = game.session.advance.bind(game.session);
    vi.spyOn(game.session, 'advance').mockImplementation((now: number) => {
      const t = game.session.timeline;
      const before = t.localTick;
      advance(now);
      if (game.session.timeline !== t || game.session.timeline.localTick !== before) moved++;
    });
    game.propose(ONE_A_SIDE);
    game.play(0);
    clock.advance(1000);
    const t = game.session.timeline;
    clock.stall(NET.stallMs);
    expect(game.session.stall).toBe('none');
    // It caught up, its newest ticks sent.
    expect(t.localTick).toBe(Math.floor(t.clock(clock.now())));
    expect(Math.abs(t.localTick - (1000 + NET.stallMs) / NET.tickMs)).toBeLessThanOrEqual(1);
    clock.advance(100);
    const before = t.localTick;
    clock.stall(NET.stallMs + 1);
    expect(game.session.stall).toBe('deciding');
    // Paused where the stall found it: no catch-up.
    const at = t.localTick;
    expect(at).toBe(before);
    clock.advance(NET.room.stateRequestRetryMs);
    expect(game.session.stall).toBe('none');
    expect(game.session.timeline).toBe(t);
    // It goes on from its own tick, skipping the gap, rather than catching up its 120 ticks.
    clock.advance(500);
    expect(t.localTick - at).toBeGreaterThanOrEqual(Math.floor(500 / NET.tickMs) - 1);
    expect(t.localTick - at).toBeLessThanOrEqual(Math.ceil(500 / NET.tickMs) + 1);
    // About a second's ticks, one run for the catch-up, 100 ms's and 500 ms's: the paused runs move none.
    expect(moved).toBeGreaterThan(Math.floor(1500 / NET.tickMs));
    expect(game.tickCosts).toHaveLength(moved);
    expect(game.tickCosts.every((c) => c === 0)).toBe(true);
    game.close();
  });

  it('checks the stall at once when the page shows again, before its next timer', async () => {
    const a = await held();
    a.game.propose(ONE_A_SIDE);
    a.game.play(0);
    a.clock.advance(1000);
    // Hidden, with timers held back for 5 s, as a background app's: 3 s pass with no run.
    a.clock.throttle = 5000;
    a.page.hide();
    a.clock.advance(3000);
    expect(a.game.session.stall).toBe('none');
    a.clock.throttle = null;
    a.page.show();
    expect(a.game.session.stall).toBe('deciding');
    a.game.close();
  });

  it('keeps a hidden page sending, its timers once a second: no stall, and its terrier never sits or leaves (D-31, D-16)', async () => {
    const world = new World(3);
    const [a, b] = await pair(world);
    toPlay(world, [a, b]);
    world.hide(b, 1000);
    const before = ticksSent(b);
    let stalled = false;
    let sat = false;
    let gone = false;
    world.watch(() => {
      if (b.game.session.stall !== 'none') stalled = true;
      const T = terrierIn(a, b.me);
      if (T === undefined) gone = true;
      else if (T.sitting) sat = true;
    });
    world.run(8000);
    expect([stalled, sat, gone]).toEqual([false, false, false]);
    // Each wake sends its newest stallSendTicks ticks, to its one peer.
    const sent = ticksSent(b) - before;
    expect(sent).toBeGreaterThanOrEqual(7 * NET.timeline.stallSendTicks);
    expect(sent).toBeLessThanOrEqual(9 * NET.timeline.stallSendTicks);
    expect([a.game.stats().resyncs, b.game.stats().resyncs]).toEqual([0, 0]);
    agree([a, b]);
    expectClean(world);
  });

  it('rejoins a page frozen 3 s from a peer whose clock ran on, in control again, its summary covering both timelines', async () => {
    const world = new World(5);
    const [a, b] = await pair(world);
    toPlay(world, [a, b]);
    world.run(500);
    const old = b.game.session.timeline;
    // The session's onControl, passed through: the rejoin hands its terrier's base once (D-10, §4.6).
    const bases: number[] = [];
    const onControl = (base: number): void => {
      bases.push(base);
    };
    b.game.onControl = onControl;
    expect([b.game.onControl, b.game.session.onControl]).toEqual([onControl, onControl]);
    world.freeze(b);
    world.run(3000);
    world.thaw(b);
    expect(b.game.session.stall).toBe('deciding');
    expect(b.game.session.timeline).toBe(old);
    world.until(() => b.game.session.stall === 'rejoining', 200);
    world.until(() => b.game.session.stall === 'none', 2000);
    const now = b.game.session.timeline;
    expect(now).not.toBe(old);
    expect([now.started, now.id]).toEqual([true, old.id]);
    expect(bases).toEqual([terrierIn(b, b.me)!.prevInput]);
    world.run(1500);
    // In control again: its inputs final in the other's state, and it doesn't sit.
    const T = terrierIn(a, b.me)!;
    expect(finalOf(a).tick - T.lastInputTick).toBeLessThan(30);
    expect(T.sitting).toBe(false);
    expect(b.game.arrivedTick).toBeGreaterThan(old.finalTick);
    // The summary and the stats cover the old timeline and the new one.
    const [o, n] = [old.stats, now.stats];
    const s = b.game.summary();
    expect(o.reusedFinals + o.steppedFinals).toBeGreaterThan(0);
    expect(n.reusedFinals + n.steppedFinals).toBeGreaterThan(0);
    expect(s.ticks).toBe(o.reusedFinals + o.steppedFinals + n.reusedFinals + n.steppedFinals);
    expect(s.remoteInputs).toBe(o.receivedInputs + n.receivedInputs);
    expect([s.late, s.lateAbsent, s.rollbacks]).toEqual([o.late + n.late, o.lateAbsent + n.lateAbsent, o.rollbacks + n.rollbacks]);
    expect(s.corrections).toBe(o.corrections + n.corrections);
    expect(s.lateBy).toEqual(o.lateBy.map((v, k) => v + n.lateBy[k]!));
    // Every correction of both reached the summary's bins: one ball each.
    expect(o.corrections).toBeGreaterThan(0);
    expect(s.ball.count + s.repair.count).toBe(s.corrections);
    // The counts summed; the clock's state and the arrival's the timeline held now.
    const st = b.game.stats();
    expect([st.sent, st.received, st.agree]).toEqual([o.sent + n.sent, o.received + n.received, o.agree + n.agree]);
    expect(o.medianOffset).not.toBe(n.medianOffset);
    expect([st.medianOffset, st.rateAdj, st.warmMs, st.joinedAt]).toEqual([n.medianOffset, n.rateAdj, n.warmMs, n.joinedAt]);
    agree([a, b]);
    expectClean(world);
  });

  it("sums the clock's samples over the timelines a rejoin passes through, those its freeze rule dropped among them (M4's design §8.4's run 4)", async () => {
    const world = new World(5);
    const [a, b] = await pair(world);
    toPlay(world, [a, b]);
    world.run(500);
    const old = b.game.session.timeline;
    // A freeze past d + w ticks but short of a stall: the TICKs held through it are dropped, no samples (D-15).
    world.freeze(b);
    world.run(400);
    world.thaw(b);
    world.run(500);
    expect([old.stats.clockSamples, old.stats.clockSamplesDropped].every((x) => x > 0)).toBe(true);
    // Then one past the stall: a rejoin, into a new timeline, which samples the clock in turn.
    world.freeze(b);
    world.run(3000);
    world.thaw(b);
    world.until(() => b.game.session.timeline !== old && b.game.session.stall === 'none', 3000);
    world.run(500);
    const [o, n] = [old.stats, b.game.session.timeline.stats];
    expect(n.clockSamples).toBeGreaterThan(0);
    const st = b.game.stats();
    expect([st.clockSamples, st.clockSamplesDropped]).toEqual([o.clockSamples + n.clockSamples, o.clockSamplesDropped + n.clockSamplesDropped]);
    agree([a, b]);
    expectClean(world);
  });

  it('re-anchors every page frozen together, as on a machine that paused: nobody rejoins, sits for good or leaves, and the hashes agree', async () => {
    const world = new World(9);
    const [a, b] = await pair(world);
    toPlay(world, [a, b]);
    world.run(500);
    const held = [a.game.session.timeline, b.game.session.timeline];
    const ticks = held.map((t) => t.localTick);
    world.freeze(a);
    world.freeze(b);
    world.run(3000);
    world.thaw(a);
    world.thaw(b);
    expect([a.game.session.stall, b.game.session.stall]).toEqual(['deciding', 'deciding']);
    world.until(() => a.game.session.stall === 'none' && b.game.session.stall === 'none', NET.room.stateRequestRetryMs + 100);
    // Each went on from its own tick, its timeline kept: no catch-up over the gap, and no rejoin.
    expect(a.game.session.timeline).toBe(held[0]);
    expect(b.game.session.timeline).toBe(held[1]);
    held.forEach((t, k) => expect(t.localTick - ticks[k]!, `page ${k}`).toBeLessThan(Math.ceil((500 + NET.room.stateRequestRetryMs + 200) / NET.tickMs)));
    world.run(2000);
    for (const t of [a, b]) {
      for (const who of [a.me, b.me]) {
        const T = terrierIn(t, who)!;
        expect([T.sitting, finalOf(t).tick - T.lastInputTick < 30], `${who} on page ${t.k}`).toEqual([false, true]);
      }
      expect(t.game.stats().resyncs, `page ${t.k}`).toBe(0);
    }
    agree([a, b]);
    expectClean(world);
  });
});

describe('leaving (§4.2, §4.5)', () => {
  it('sends its LEAVE in the TICKs it goes on sending, and closes leaveGraceMs later', async () => {
    const world = new World(7);
    const [a, b] = await pair(world);
    expect(finalOf(a).phase).toBe(WARM_UP);
    b.game.leave();
    expect(b.game.leaving).toBe(true);
    expect(b.game.session.timeline.eventsInFlight(b.me) & LEAVE).toBe(LEAVE);
    const sent = ticksSent(b);
    world.run(NET.room.leaveGraceMs - 1);
    expect([b.game.closed, online(b)]).toEqual([false, true]);
    expect(ticksSent(b)).toBeGreaterThan(sent);
    world.run(1);
    expect(b.game.closed).toBe(true);
    expect([b.clock.pending, b.page.listeners]).toEqual([0, 0]);
    world.run(10);
    expect(online(b)).toBe(false);
    // Its LEAVE took it out at once, not the 3 s a silent terrier waits in warm-up.
    world.until(() => !inRoster(a, b.me), 1000);
    expect([b.game.refusal(), b.game.failed()]).toEqual([null, false]);
    expectClean(world);
  });

  it('takes a fifth spectator out of the room, and a page a full room refused with REFUSE 4, each after its grace', async () => {
    const world = new World(11);
    const a = await world.open(0);
    a.game.propose(ONE_A_SIDE);
    a.game.play(0);
    world.run(200);
    // 1 a side: one place free, so five browsers outside the roster may connect, four of them watching.
    const watchers: Tab[] = [];
    for (let k = 1; k <= 4; k++) {
      const s = await world.open(k);
      s.game.watch();
      watchers.push(s);
      world.run(300);
    }
    world.until(() => spectatorsSeenBy(a) === 4 && watchers.every((s) => s.game.peers() === 4), 5000);
    const fifth = await world.open(5);
    world.until(() => fifth.game.session.timeline.started && fifth.game.peers() === 5, 5000);
    expect(fifth.game.session.role()).toBe(ROLE.UNDECIDED);
    // A sixth finds every place taken: each browser that holds the state refuses it.
    const sixth = await world.open(6);
    world.until(() => sixth.game.leaving, 5000);
    expect([sixth.game.peers(), sixth.game.refusedBy, sixth.game.refusal()]).toEqual([0, REFUSAL.SPECTATORS_FULL, REFUSAL.SPECTATORS_FULL]);
    world.run(NET.room.leaveGraceMs + 10);
    expect([sixth.game.closed, online(sixth)]).toEqual([true, false]);
    // The fifth to watch is one too many: its own count says so (§4.5).
    fifth.game.watch();
    expect([fifth.game.session.spectatorsFull, fifth.game.leaving, fifth.game.closed]).toEqual([true, true, false]);
    expect(fifth.game.refusal()).toBe(REFUSAL.SPECTATORS_FULL);
    world.run(NET.room.leaveGraceMs + 10);
    expect([fifth.game.closed, online(fifth)]).toEqual([true, false]);
    expect(spectatorsSeenBy(a)).toBe(4);
    for (const s of watchers) expect([s.game.leaving, s.game.peers()], `page ${s.k}`).toEqual([false, 4]);
    agree([a, ...watchers]);
    expectClean(world);
  });

  it('leaves the room as soon as a peer refuses it for the cap, though others accepted it', async () => {
    const a = await held();
    a.t.peers = 3;
    a.clock.advance(100);
    expect(a.game.leaving).toBe(false);
    a.t.refusedBy = REFUSAL.DUPLICATE;
    a.clock.advance(100);
    // Another refusal, with peers connected, says nothing yet (roslambo's).
    expect([a.game.leaving, a.game.refusal()]).toEqual([false, null]);
    a.t.refusedBy = REFUSAL.SPECTATORS_FULL;
    a.clock.advance(NET.timerMs);
    expect([a.game.leaving, a.game.refusal(), a.t.left]).toEqual([true, REFUSAL.SPECTATORS_FULL, 0]);
    a.clock.advance(NET.room.leaveGraceMs);
    expect([a.game.closed, a.t.left]).toEqual([true, 1]);
  });
});

describe('a connection failure and an abandoned match (PLAN §8, Q-16, §4.7)', () => {
  it('fails a page holding no timeline connectionFailureMs after its first timer run, and never a keeper', async () => {
    const joiner = await held();
    joiner.game.play(0);
    const keeper = await held();
    keeper.game.propose(ONE_A_SIDE);
    // The session counts from its first timer run, timerMs after the room opened.
    joiner.clock.advance(NET.room.connectionFailureMs);
    expect(joiner.game.failed()).toBe(false);
    joiner.clock.advance(NET.timerMs);
    expect(joiner.game.failed()).toBe(true);
    keeper.clock.advance(2 * NET.room.connectionFailureMs);
    expect(keeper.game.failed()).toBe(false);
    joiner.game.close();
    keeper.game.close();
  });

  it('reads a match its players left as abandoned on a watching page, abandonedMs after their last TICK reached it', async () => {
    const world = new World(13);
    const [a, b] = await pair(world);
    const w = await world.open(2);
    w.game.watch();
    toPlay(world, [a, b]);
    world.until(() => finalOf(w).phase === IN_PLAY, 5000);
    const t = w.game.session.timeline;
    // Both players' pages close in play: their TICKs stop.
    a.game.close();
    b.game.close();
    world.run(1000);
    const last = Math.max(t.heardAt(a.me)!, t.heardAt(b.me)!);
    world.run(last + NET.room.abandonedMs - 1 - world.now);
    expect([w.game.abandoned(), finalOf(w).phase]).toEqual([false, IN_PLAY]);
    world.run(1);
    expect(w.game.abandoned()).toBe(true);
    w.game.close();
  });
});

describe('Play again (§4.9, D-12, C-42)', () => {
  it("proposes under the press tick's ID only without an AGAIN, joins with one, and closes the old room after its grace", async () => {
    const world = new World(13);
    const [a, b] = await pair(world);
    const next = await nextMatchId(ROOM);
    randomBytes([0xa1, 0xb2, 0xc3, 0xd4]);
    const pressTick = a.game.session.timeline.clock(a.clock.now());
    const old = a.game;
    a.game = await old.playAgain();
    const want = againTimelineId(pressTick, Uint8Array.of(0xa1, 0xb2, 0xc3, 0xd4));
    expect(want.slice(0, 8)).toBe((Math.floor(pressTick) >>> 0).toString(16).padStart(8, '0'));
    expect([a.game.matchId, a.game.session.timeline.started, a.game.session.timeline.id]).toEqual([next, true, want]);
    expect(old.leaving).toBe(true);
    world.until(() => b.game.session.againSeen, 500);
    const pressed = world.now;
    const bOld = b.game;
    b.game = await bOld.playAgain();
    // The AGAIN said the next match exists: it joins it, proposing nothing.
    expect([b.game.matchId, b.game.session.timeline.started]).toEqual([next, false]);
    world.until(() => old.closed, NET.room.leaveGraceMs);
    expect(online(a)).toBe(true);
    world.run(10);
    expect(online(a)).toBe(false);
    world.until(() => bOld.closed, NET.room.leaveGraceMs + 10);
    expect(world.now - pressed).toBe(NET.room.leaveGraceMs);
    // Each back in its own pack, in the one match.
    world.until(() => inRoster(a, a.me) && inRoster(a, b.me) && inRoster(b, a.me) && inRoster(b, b.me), 5000);
    expect(b.game.session.timeline.id).toBe(want);
    expect([terrierIn(b, a.me)!.pack, terrierIn(b, b.me)!.pack]).toEqual([0, 1]);
    expect(finalOf(b).packSize).toBe(ONE_A_SIDE.packSize);
    expect(finalOf(b).matchLengthTicks).toBe(ONE_A_SIDE.matchMinutes * P.ticksPerMinute);
    agree([a, b]);
    expectClean(world);
  });

  it('ranks two presses that each saw no AGAIN by their ticks: both propose, and the earlier wins on both pages', async () => {
    const world = new World(17);
    const [a, b] = await pair(world);
    // The earlier press's random bytes sort last, so only its tick can make it win the tie.
    randomBytes([0xff, 0xff, 0xff, 0xff], [0x00, 0x00, 0x00, 0x00]);
    const first = a.game.playAgain();
    world.run(2 * Math.ceil(NET.tickMs));
    const second = b.game.playAgain();
    [a.game, b.game] = await Promise.all([first, second]);
    const [ta, tb] = [a.game.session.timeline, b.game.session.timeline];
    expect([ta.started, tb.started]).toEqual([true, true]);
    expect(ta.id < tb.id).toBe(true);
    world.until(() => b.game.session.timeline.id === ta.id && inRoster(b, b.me) && inRoster(a, b.me) && inRoster(b, a.me), 8000);
    expect(a.game.session.timeline).toBe(ta);
    expect([terrierIn(a, a.me)!.pack, terrierIn(a, b.me)!.pack]).toEqual([0, 1]);
    agree([a, b]);
    expectClean(world);
  });

  it('brings its bots along, in their packs, and watches again after watching', async () => {
    const world = new World(19);
    const a = await world.open(0);
    a.game.propose({ packSize: 2, matchMinutes: 1 });
    a.game.play(0);
    expect(a.game.addBot(1)).toBe(true);
    world.run(200);
    const s = await world.open(1);
    s.game.watch();
    world.until(() => s.game.session.timeline.started && inRoster(s, a.game.session.hostedBots()[0]!), 3000);
    a.game = await a.game.playAgain();
    world.run(100);
    s.game = await s.game.playAgain();
    world.until(() => s.game.session.timeline.started && finalOf(s).terriers.length === 2, 5000);
    const bot = a.game.session.hostedBots()[0]!;
    expect([terrierIn(s, a.me)!.pack, terrierIn(s, bot)!.pack]).toEqual([0, 1]);
    expect(s.game.session.role()).toBe(ROLE.SPECTATOR);
    agree([a, s]);
    expectClean(world);
  });
});

describe('the summary across timelines (§1.16, M3-Q24)', () => {
  it("covers a merge: the losing page's old timeline and the winner's it took", async () => {
    const world = new World(23);
    const a = await world.open(0);
    const b = await world.open(1);
    world.net(ROOM).block('p0', 'p1');
    a.game.propose(ONE_A_SIDE);
    a.game.play(0);
    world.run(2000);
    // The younger timeline by over the tie's 60 ticks: b's loses to a's.
    b.game.propose(ONE_A_SIDE);
    b.game.play(1);
    world.run(1000);
    const old = b.game.session.timeline;
    expect(b.game.arrivedTick).toBe(0);
    world.net(ROOM).unblock('p0', 'p1');
    world.until(() => b.game.session.timeline !== old && inRoster(b, b.me) && inRoster(a, b.me), 5000);
    world.run(1000);
    const now = b.game.session.timeline;
    expect(now.id).toBe(a.game.session.timeline.id);
    expect(b.game.arrivedTick).toBeGreaterThan(0);
    const [o, n] = [old.stats, now.stats];
    const s = b.game.summary();
    expect(o.reusedFinals + o.steppedFinals).toBeGreaterThan(0);
    expect(o.sent).toBeGreaterThan(0);
    expect(s.ticks).toBe(o.reusedFinals + o.steppedFinals + n.reusedFinals + n.steppedFinals);
    expect(s.remoteInputs).toBe(o.receivedInputs + n.receivedInputs);
    expect([s.corrections, s.resyncs]).toEqual([o.corrections + n.corrections, o.resyncs + n.resyncs]);
    expect(s.ball.count + s.repair.count).toBe(s.corrections);
    const st = b.game.stats();
    expect([st.sent, st.received, st.steps]).toEqual([o.sent + n.sent, o.received + n.received, o.steps + n.steps]);
    expect(st.maxStepsPerAdvance).toBe(Math.max(o.maxStepsPerAdvance, n.maxStepsPerAdvance));
    expect([st.medianOffset, st.joinedAt]).toEqual([n.medianOffset, n.joinedAt]);
    // Another match's goals aren't this one's: the scoreboard follows the timeline held.
    const update = vi.spyOn(b.game.scoreboard, 'update');
    world.run(100);
    expect(update.mock.calls.length).toBeGreaterThanOrEqual(Math.floor(100 / NET.timerMs) - 1);
    for (const [t] of update.mock.calls) expect(t).toBe(now);
    agree([a, b]);
    expectClean(world);
  });
});

// ---- The import graph (design §0, §1.36; L238) ----

const root = fileURLToPath(new URL('../..', import.meta.url));
const COMMENT = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
const SPECIFIER = /\b(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
const SCRIPT = /\.(?:[cm]?[jt]sx?)$/;

/** The file a relative specifier names, as the bundler finds it; null for none, an import written in a
 *  test's string, such as the configuration scan's planted sources. */
function resolveFile(from: string, spec: string): string | null {
  const base = join(dirname(from), spec);
  for (const p of [base, `${base}.ts`, join(base, 'index.ts'), base.replace(/\.js$/, '.ts')]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

const repoPath = (file: string): string => relative(root, file).split('\\').join('/');

/** Each value import of a source, static or import(), as [the repo path or package it names, how]. */
function importsOf(file: string): [string, 'static' | 'dynamic'][] {
  const out: [string, 'static' | 'dynamic'][] = [];
  for (const m of readFileSync(file, 'utf8').replace(COMMENT, '').matchAll(SPECIFIER)) {
    if (m[1] !== undefined) continue; // import type and export type are erased
    const spec = m[2] ?? m[3]!;
    const to = spec.startsWith('.') ? resolveFile(file, spec) : spec;
    if (to !== null) out.push([spec.startsWith('.') ? repoPath(to) : to, m[3] !== undefined ? 'dynamic' : 'static']);
  }
  return out;
}

/** Every module an entry reaches through static value imports alone. */
function staticGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (path: string): void => {
    if (seen.has(path)) return;
    seen.add(path);
    if (!SCRIPT.test(path) || path.startsWith('@') || !path.includes('/')) return;
    for (const [to, how] of importsOf(join(root, path))) if (how === 'static') visit(to);
  };
  visit(entry);
  return seen;
}

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, dir))) {
    const path = `${dir}/${name}`;
    if (statSync(join(root, path)).isDirectory()) out.push(...sources(path));
    else if (SCRIPT.test(name)) out.push(path);
  }
  return out;
}

describe('the import graph (L238, design §0, §1.36)', () => {
  it('loads src/net/trystero.ts from this glue alone, by import(), and never through its static imports', () => {
    // Every source but the unit tests, which no build bundles: TrysteroRoom's own imports it against a
    // mocked Trystero, as the lint allows, and others hold import()s in strings for their own walks.
    const shipped = ['src', 'dev', 'e2e'].flatMap(sources).filter((f) => !/\.test\.[cm]?[jt]sx?$/.test(f));
    expect(shipped).toContain('src/ui/game.ts');
    const importers = shipped.flatMap((f) =>
      importsOf(join(root, f))
        .filter(([to]) => to === 'src/net/trystero.ts')
        .map(([, how]) => `${f} ${how}`),
    );
    expect(importers).toEqual(['src/ui/game.ts dynamic']);
    const graph = staticGraph('src/ui/game.ts');
    expect(graph.has('src/core/session/session.ts')).toBe(true);
    expect([...graph].filter((m) => m === 'src/net/trystero.ts' || m.startsWith('@trystero-p2p/'))).toEqual([]);
    // And Trystero is one step on, through the import().
    expect(importsOf(join(root, 'src/net/trystero.ts')).map(([to]) => to)).toContain('@trystero-p2p/nostr');
  });
});
