import { describe, expect, it } from 'vitest';
import { personId } from '../core/bot/bot-id';
import { decode, encodeTick, type Hello, NO_TICK, NO_TIMELINE, PROTOCOL_VERSION, ROLE, T, type Tick } from '../core/protocol/messages';
import type { RoomPeer } from '../core/session/room-peer';
import type { Transport } from '../net/transport';
import { netSettings } from '../core/session/settings';
import { defaultParams, genesis, IN_PLAY, JOIN, type MatchState, type Phase } from '../core/sim/index';
import { TEST_BUILD } from '../core/timeline/testing';
import type { TimelineStats } from '../core/timeline/timeline';
import { FakeClock } from '../ui/clock-testing';
import { type FromWitness, PAGE_PEER, type PageTimeline, type ToWitness, virtualRoom, type VirtualRoomOptions, type WitnessPort } from './virtual-room';

// The bench's room as a transport (M4's design, research/m4/DESIGN.md, §1.53, §8.3; PLAN §16), in
// virtual time against a page of the test's own, whose timeline's clock is the FakeClock's: seven
// players, each link's delay spread over 20–80 ms by the seed with 15 ms of jitter and FIFO; a TICK
// for each of the page's local ticks from a player's join on, sent when the page's clock reached it,
// and voting the page's own final hash (M4-Q16); every message to the page in a task of its own; the
// capacity; the hold; and the backlog every second. A whole match over it, on the real NetGame, is
// virtual-room-match.test.ts's; the forced repair with its witness, witness.test.ts's.

const NET = netSettings();
const D = NET.timeline.delay;
const W = NET.timeline.window;
const ME = personId(7, 0);

/** A page that takes everything: what it got, when, and on which connection. */
class Page implements RoomPeer {
  readonly got: { readonly peer: string; readonly at: number; readonly m: Tick }[] = [];
  readonly joined: string[] = [];
  readonly rtts = new Map<string, number>();
  private readonly t: FakeTimeline;
  constructor(t: FakeTimeline) {
    this.t = t;
  }
  hello(): Hello {
    return { type: T.HELLO, protocol: PROTOCOL_VERSION, build: TEST_BUILD, player: ME, role: ROLE.KEEPER, ...NO_TIMELINE, phase: 0, name: 'Page' };
  }
  checkHello(hello: Hello): { ok: true; hello: Hello } {
    return { ok: true, hello };
  }
  onPeerJoin(peer: string): void {
    this.joined.push(peer);
  }
  onHandshakeFailed(): void {}
  onPeerLeave(): void {}
  onRtt(peer: string, ms: number): void {
    this.rtts.set(peer, ms);
  }
  onMessage(peer: string, bytes: Uint8Array, now: number): void {
    const m = decode(bytes) as Tick;
    expect(m?.type).toBe(T.TICK);
    this.got.push({ peer, at: now, m });
    // Each one its clock's sample, so the room keeps its age.
    this.t.stats.clockSamples++;
  }
  advance(): void {}
}

/** The page's timeline as the room reads it: its clock the FakeClock's, at the base rate. */
class FakeTimeline implements PageTimeline {
  readonly started = true;
  readonly stats = { clockSamples: 0, steps: 0, resyncs: 0 } as TimelineStats;
  readonly repairing = false;
  readonly head: MatchState;
  private readonly c: FakeClock;
  constructor(c: FakeClock, phase: Phase = 0) {
    this.c = c;
    this.head = genesis({ packSize: 4, matchMinutes: 1 }, defaultParams);
    this.head.phase = phase;
  }
  get final(): MatchState {
    return this.head;
  }
  get localTick(): number {
    return Math.floor(this.clock(this.c.now()));
  }
  get finalTick(): number {
    return Math.max(0, this.localTick - W);
  }
  get headTick(): number {
    return this.localTick;
  }
  clock(now: number): number {
    return now / NET.tickMs;
  }
  hashAt(t: number): string {
    return t <= this.finalTick ? t.toString(16).padStart(16, '0') : '';
  }
}

interface Rig {
  readonly clock: FakeClock;
  readonly t: FakeTimeline;
  readonly page: Page;
  readonly room: ReturnType<typeof virtualRoom>;
  readonly tasks: { n: number };
}

async function rig(o: Partial<VirtualRoomOptions> & { phase?: Phase } = {}): Promise<Rig> {
  const clock = new FakeClock(0);
  const t = new FakeTimeline(clock, o.phase);
  const page = new Page(t);
  const tasks = { n: 0 };
  const room = virtualRoom({
    peers: 7, seed: 7, latencyMs: [20, 80], jitterMs: 15, build: TEST_BUILD, capacityPerSecond: null, holdAtMs: null, holdMs: 4100,
    witness: false, clock,
    task: (fn) => {
      tasks.n++;
      clock.after(0, fn);
    },
    ...o,
  });
  await room(page, () => clock.now(), { matchId: 'x', relays: ['ws://127.0.0.1:9'], ice: 'none', settings: NET.transport });
  room.attach(() => t);
  return { clock, t, page, room, tasks };
}

/** Each link's TICKs as the page got them, in order. */
const byLink = (r: Rig): Map<string, Rig['page']['got']> => {
  const out = new Map<string, Rig['page']['got']>();
  for (const g of r.page.got) out.set(g.peer, [...(out.get(g.peer) ?? []), g]);
  return out;
};

/** When the page's clock read a TICK's local tick, t − d: its earliest send. */
const tickStart = (m: Tick): number => (m.t - D) * NET.tickMs;

describe("the bench's room (§1.53, §8.3)", () => {
  it('opens a connection to each of seven players, their delays spread over 20–80 ms by the seed, each round trip twice its delay and the jitter', async () => {
    const r = await rig();
    expect(r.page.joined).toEqual(Array.from({ length: 7 }, (_, k) => `virtual-${k + 1}`));
    const peers = r.room.report().peers;
    expect(peers.map((p) => p.id)).toEqual(Array.from({ length: 7 }, (_, k) => personId(7, k + 1)));
    for (const p of peers) {
      expect(p.latencyMs).toBeGreaterThanOrEqual(20);
      expect(p.latencyMs).toBeLessThanOrEqual(80);
    }
    expect(Math.max(...peers.map((p) => p.latencyMs)) - Math.min(...peers.map((p) => p.latencyMs))).toBeGreaterThan(20);
    for (const p of peers) expect(r.page.rtts.get(`virtual-${peers.indexOf(p) + 1}`)).toBeCloseTo(2 * p.latencyMs + 15, 6);
    // The packs alternate from B, so with the page in A both have four.
    expect(peers.map((p) => p.pack)).toEqual([1, 0, 1, 0, 1, 0, 1]);
    const again = await rig();
    expect(again.room.report().peers).toEqual(peers);
  });

  it('sends a TICK from each for every local tick from its join on, FIFO a link, its delay to its delay and the jitter after it was due to be sent, a task a message', async () => {
    const r = await rig();
    r.clock.advance(5000);
    const links = byLink(r);
    expect([...links.keys()].sort()).toEqual(Array.from({ length: 7 }, (_, k) => `virtual-${k + 1}`).sort());
    const peers = r.room.report().peers;
    for (const [peer, got] of links) {
      const latency = peers[Number(peer.slice('virtual-'.length)) - 1]!.latencyMs;
      const ticks = got.map((g) => g.m.t);
      // Every tick, in order, from its join on.
      expect(ticks).toEqual(Array.from({ length: ticks.length }, (_, k) => ticks[0]! + k));
      for (const g of got) {
        const delay = g.at - tickStart(g.m);
        expect(delay, `${peer} t${g.m.t}`).toBeGreaterThanOrEqual(latency);
        // Its timer's phase in the tick, at most a timer period, and the jitter.
        expect(delay, `${peer} t${g.m.t}`).toBeLessThanOrEqual(latency + 15 + NET.timerMs);
      }
    }
    // Staggered joins: the first at local tick 30, the seventh at 90.
    const firsts = [...links.values()].map((got) => got[0]!.m.t - D).sort((a, b) => a - b);
    expect(firsts).toEqual([30, 40, 50, 60, 70, 80, 90]);
    expect(r.tasks.n).toBe(r.page.got.length);
    expect(r.room.report().delivered).toEqual({ total: r.page.got.length, byKind: { TICK: r.page.got.length } });
    // Each TICK the page's clock took, from its due time to its handling: none waited here.
    const ages = r.room.report().keptSampleAgeMs;
    expect(ages.count).toBe(r.page.got.length);
    expect(ages.max).toBe(0);
    // Over a window of the page clock, those handled in it alone.
    const second = r.page.got.filter((g) => g.at >= 2000 && g.at < 3000).length;
    expect(r.room.report({ fromMs: 2000, toMs: 3000 }).keptSampleAgeMs.count).toBe(second);
    expect(second).toBeGreaterThan(300);
  });

  it("votes the page's own final hash for each sender's newest final tick (M4-Q16), and JOINs its pack, again while the page's final state lacks it", async () => {
    const r = await rig();
    r.clock.advance(3000);
    const got = byLink(r).get('virtual-1')!;
    for (const g of got) {
      const voted = g.m.t - D - W;
      expect([g.m.voteTick, g.m.voteHash], `t${g.m.t}`).toEqual([voted, r.t.hashAt(voted)]);
    }
    // The page's final state never shows it here, so its JOIN goes again every 2 (d + w) ticks.
    const joins = got.filter((g) => g.m.own!.events.some((e) => (e.events & JOIN) !== 0 && e.back === 0)).map((g) => g.m.t);
    expect(joins.length).toBeGreaterThan(3);
    for (let k = 1; k < joins.length; k++) expect(joins[k]! - joins[k - 1]!).toBe(2 * (D + W) + 1);
    const join = got[0]!.m.own!.events.find((e) => (e.events & JOIN) !== 0)!;
    expect(join).toMatchObject({ joinPack: 1, coat: 1, name: 'Peer 2' });
  });

  it('holds every link to the page holdMs from holdAtMs into play, FIFO, then delivers the backlog a task a message', async () => {
    const r = await rig({ phase: IN_PLAY, holdAtMs: 2000, holdMs: 4100 });
    r.clock.advance(12_000);
    const hold = r.room.report().hold!;
    // The room saw play at its first run, so the hold began 2 s on.
    expect(hold.fromMs).toBeGreaterThanOrEqual(2000);
    expect(hold.fromMs).toBeLessThanOrEqual(2000 + 2 * NET.timerMs);
    expect(hold.toMs - hold.fromMs).toBe(4100);
    for (const [peer, got] of byLink(r)) {
      const sentAfter = got.filter((g) => tickStart(g.m) >= hold.fromMs + NET.tickMs);
      const sentBefore = got.filter((g) => tickStart(g.m) + NET.tickMs <= hold.fromMs);
      // Nothing sent from the hold's start comes before it ends; what was sent before comes as it would.
      expect(Math.min(...sentAfter.map((g) => g.at)), peer).toBeGreaterThanOrEqual(hold.toMs);
      expect(Math.max(...sentBefore.map((g) => g.at)), peer).toBeLessThan(hold.fromMs + 80 + 15 + 2 * NET.tickMs);
      // FIFO through it.
      const ticks = got.map((g) => g.m.t);
      expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
    }
    // The hold's end: about 4.1 s of seven links' TICKs fall due at once, each delivered in a task of its own.
    const released = r.page.got.filter((g) => g.at >= hold.toMs && g.at < hold.toMs + 200 && tickStart(g.m) < hold.toMs - 100);
    expect(released.length).toBeGreaterThan(1500);
    expect(r.tasks.n).toBe(r.page.got.length);
  });

  it('delivers at most capacityPerSecond, and keeps the backlog every second, by link and summed', async () => {
    const r = await rig({ capacityPerSecond: 200 });
    r.clock.advance(10_000);
    const at = r.page.got.map((g) => g.at);
    for (let k = 1; k < at.length; k++) expect(at[k]! - at[k - 1]!).toBeGreaterThanOrEqual(1000 / 200 - 1e-9);
    // And at that rate once a backlog has built.
    expect(at.filter((x) => x >= 5000 && x < 6000).length).toBe(200);
    const backlog = r.room.report().backlog;
    expect(backlog.map((b) => b.atMs)).toEqual(Array.from({ length: 10 }, (_, k) => 1000 * (k + 1)));
    for (const b of backlog) expect(b.total).toBe(b.byLink.reduce((x, y) => x + y, 0));
    // Seven links at 60 TICKs a second through 200 a second: the backlog grows, each link's share of it.
    expect(backlog.at(-1)!.total).toBeGreaterThan(backlog[2]!.total);
    expect(backlog.at(-1)!.total).toBeGreaterThan(1000);
    expect(backlog.at(-1)!.byLink.every((n) => n > 0)).toBe(true);
    const open = await rig();
    open.clock.advance(10_000);
    expect(Math.max(...open.room.report().backlog.map((b) => b.total))).toBeLessThanOrEqual(7);
  });

  it("sends a TICK the room made late, its timer held with the page's, as sent on time: its phase its timer's, and it comes as a backlog", async () => {
    const r = await rig();
    r.clock.advance(3000);
    const before = r.page.got.length;
    // The thread held 500 ms: no timer runs, then each runs once, late.
    r.clock.stall(500);
    const late = r.page.got.slice(before);
    r.clock.advance(200);
    const all = r.page.got.slice(before);
    // What the players would have sent through the stall comes at once, in the tasks right after it.
    expect(late.length).toBeGreaterThan(0);
    const burst = all.filter((g) => g.at === 3500);
    expect(burst.length).toBeGreaterThan(7 * 15);
    for (const g of all) expect(g.m.phase).toBeLessThan(NET.timerMs / NET.tickMs);
  });

  it("hands the witness each STATE_REQ the page sends another player, its STATE back on that player's connection, and the witness's own ask of one to the page, its answer as from that player", async () => {
    const clock = new FakeClock(0);
    const t = new FakeTimeline(clock);
    const toWorker: ToWitness[] = [];
    let terminated = false;
    const port: WitnessPort = { postMessage: (m) => toWorker.push(m), onmessage: null, onerror: null, terminate: () => (terminated = true) };
    const fromWorker = (m: FromWitness): void => port.onmessage!({ data: m } as MessageEvent<FromWitness>);
    const votes: number[] = [];
    const got: { peer: string; type: number }[] = [];
    let transport: Transport | null = null;
    const STATE = Uint8Array.of(T.STATE, 7);
    const page: RoomPeer = {
      hello: () => ({ type: T.HELLO, protocol: PROTOCOL_VERSION, build: TEST_BUILD, player: ME, role: ROLE.KEEPER, ...NO_TIMELINE, phase: 0, name: 'Page' }),
      checkHello: (hello) => ({ ok: true, hello }),
      onPeerJoin: () => {}, onHandshakeFailed: () => {}, onPeerLeave: () => {}, onRtt: () => {}, advance: () => {},
      // The page answers a STATE_REQ on the connection it came on, as a session does.
      onMessage: (peer, bytes) => {
        got.push({ peer, type: bytes[0]! });
        if (bytes[0] === T.STATE_REQ) transport!.send(peer, STATE);
        if (bytes[0] === T.TICK && peer === 'virtual-1') votes.push((decode(bytes) as Tick).voteTick);
      },
    };
    const room = virtualRoom({
      peers: 7, seed: 7, latencyMs: [20, 80], jitterMs: 15, build: TEST_BUILD, capacityPerSecond: null, holdAtMs: null, holdMs: 4100,
      witness: true, clock, origin: 0, task: (fn) => clock.after(0, fn), worker: () => port,
    });
    transport = await room(page, () => clock.now(), { matchId: 'x', relays: ['ws://127.0.0.1:9'], ice: 'none', settings: NET.transport });
    room.attach(() => t);
    const witness = room.report().peers.find((p) => p.witness)!;
    expect(witness.id).toBe(personId(7, 1));
    // It starts the witness with the other six's connections, and joins it to the page once it says hello.
    expect(toWorker[0]).toMatchObject({ kind: 'init', me: witness.id, pack: 1 });
    expect((toWorker[0] as Extract<ToWitness, { kind: 'init' }>).peers.map((x) => x.peer)).toEqual(Array.from({ length: 6 }, (_, k) => `virtual-${k + 2}`));
    fromWorker({ kind: 'hello', hello: { type: T.HELLO, protocol: PROTOCOL_VERSION, build: TEST_BUILD, player: witness.id, role: ROLE.PLAYER, ...NO_TIMELINE, phase: 0, name: 'Peer 2' } });
    expect(toWorker.at(-1)).toMatchObject({ kind: 'join', peer: PAGE_PEER });
    const asked = (): ToWitness[] => toWorker.filter((m) => m.kind === 'message');
    // The page asks virtual-3: the witness is asked, by the page, to answer as virtual-3.
    transport.send('virtual-3', Uint8Array.of(T.STATE_REQ, 1));
    expect(asked().at(-1)).toMatchObject({ from: PAGE_PEER, replyAs: 'virtual-3' });
    fromWorker({ kind: 'send', to: PAGE_PEER, bytes: STATE, as: 'virtual-3', at: clock.now(), state: { g: 100, senderTick: 340 } });
    clock.advance(200);
    expect(got.filter((g) => g.type === T.STATE)).toEqual([{ peer: 'virtual-3', type: T.STATE }]);
    expect(room.report()).toMatchObject({ witnessStates: 1, states: [{ g: 100, senderTick: 340 }] });
    // The witness's join asks virtual-2: the page takes it on the witness's connection, and its STATE goes back
    // to the witness as from virtual-2, whom it asked.
    fromWorker({ kind: 'send', to: 'virtual-2', bytes: Uint8Array.of(T.STATE_REQ, 2), as: null, at: clock.now() });
    clock.advance(200);
    expect(got.at(-1)).toEqual({ peer: 'virtual-1', type: T.STATE_REQ });
    expect(asked().at(-1)).toMatchObject({ from: 'virtual-2', replyAs: null, bytes: STATE });
    // The page's own messages to the witness come from the page; anything else to a virtual player goes nowhere.
    const before = asked().length;
    transport.broadcast(Uint8Array.of(T.PEERS));
    transport.send('virtual-1', Uint8Array.of(T.AGAIN));
    transport.send('virtual-4', Uint8Array.of(T.AGAIN));
    expect(asked().slice(before).map((m) => [(m as Extract<ToWitness, { kind: 'message' }>).from, (m as Extract<ToWitness, { kind: 'message' }>).bytes[0]])).toEqual([
      [PAGE_PEER, T.PEERS], [PAGE_PEER, T.AGAIN],
    ]);
    // A message the page gets from the witness arrives due on the shared origin, its link's delay after it was sent.
    expect(asked().every((m) => (m as Extract<ToWitness, { kind: 'message' }>).dueAt >= 0)).toBe(true);
    // Its TICKs reach the page without their votes, there being no hold: the page's tallies are its own and the six's.
    const tick = encodeTick({ t: 40, own: { input: 0, present: 0, hist: Array(16).fill(0), events: [] }, voteTick: 25, voteHash: 'a'.repeat(16), phase: 0, bots: [] });
    fromWorker({ kind: 'broadcast', bytes: tick, at: clock.now() });
    clock.advance(200);
    expect(votes).toEqual([NO_TICK]);
    await transport.leave();
    expect(toWorker.at(-1)).toEqual({ kind: 'close' });
    expect(terminated).toBe(true);
  });

  it("strips the votes of the side the hold doesn't decide: the witness's TICKs to the page before the hold, the page's to the witness during it", async () => {
    const clock = new FakeClock(0);
    const t = new FakeTimeline(clock, IN_PLAY);
    const toWorker: ToWitness[] = [];
    const port: WitnessPort = { postMessage: (m) => toWorker.push(m), onmessage: null, onerror: null, terminate: () => {} };
    const fromWorker = (m: FromWitness): void => port.onmessage!({ data: m } as MessageEvent<FromWitness>);
    const pageGot: number[] = [];
    const page: RoomPeer = {
      hello: () => ({ type: T.HELLO, protocol: PROTOCOL_VERSION, build: TEST_BUILD, player: ME, role: ROLE.KEEPER, ...NO_TIMELINE, phase: 0, name: 'Page' }),
      checkHello: (hello) => ({ ok: true, hello }),
      onPeerJoin: () => {}, onHandshakeFailed: () => {}, onPeerLeave: () => {}, onRtt: () => {}, advance: () => {},
      onMessage: (peer, bytes) => {
        if (peer === 'virtual-1' && bytes[0] === T.TICK) pageGot.push((decode(bytes) as Tick).voteTick);
      },
    };
    const room = virtualRoom({
      peers: 7, seed: 7, latencyMs: [20, 80], jitterMs: 15, build: TEST_BUILD, capacityPerSecond: null, holdAtMs: 1000, holdMs: 1000,
      witness: true, clock, origin: 0, task: (fn) => clock.after(0, fn), worker: () => port,
    });
    const transport = await room(page, () => clock.now(), { matchId: 'x', relays: ['ws://127.0.0.1:9'], ice: 'none', settings: NET.transport });
    room.attach(() => t);
    const tick = (vote: number): Uint8Array =>
      encodeTick({ t: 40, own: { input: 0, present: 0, hist: Array(16).fill(0), events: [] }, voteTick: vote, voteHash: 'a'.repeat(16), phase: 0, bots: [] });
    const witnessGot = (): number[] => toWorker.flatMap((m) => (m.kind === 'message' && m.from === PAGE_PEER && m.bytes[0] === T.TICK ? [(decode(m.bytes) as Tick).voteTick] : []));
    // The room sees play at its first run: the hold from 1 s on, for 1 s.
    clock.advance(500);
    transport.broadcast(tick(25));
    fromWorker({ kind: 'broadcast', bytes: tick(26), at: clock.now() });
    clock.advance(1000);
    transport.broadcast(tick(27));
    fromWorker({ kind: 'broadcast', bytes: tick(28), at: clock.now() });
    clock.advance(1000);
    transport.broadcast(tick(29));
    fromWorker({ kind: 'broadcast', bytes: tick(30), at: clock.now() });
    clock.advance(1500);
    expect(room.report().hold).toMatchObject({ fromMs: 1004, toMs: 2004 });
    // Before the hold the page's vote goes through and the witness's doesn't; in it, the other way round.
    expect(witnessGot()).toEqual([25, NO_TICK, 29]);
    expect(pageGot).toEqual([NO_TICK, 28, 30]);
  });
});
