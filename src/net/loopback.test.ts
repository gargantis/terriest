// The network simulator (design §6.2, §8.2), driven by a minimal RoomPeer
// of the test's own, before any session uses it: the two-round handshake
// over each link's latency, so a burst's handshakes overlap and only
// reservations keep a count; refusals, and onHandshakeFailed for a side that
// had accepted; C-12's replacement of a silent connection; pings on each
// pinger's timers; a frozen node, which runs nothing until it thaws, its
// messages, pings, pongs, handshakes and closes waiting for it (M3 phase 3's
// answers); FIFO per link, loss as head-of-line blocking, dropNext and
// delayNext; drop, block, leave, pace, the clocks, and runs that repeat
// exactly from a seed.

import { describe, expect, it } from 'vitest';
import { botId } from '../core/bot/bot-id';
import {
  PROTOCOL_VERSION, REFUSAL, ROLE, T, TIMELINE_KIND, ZERO_HASH, type Hello,
} from '../core/protocol/messages';
import { commonRefusal, type Accepted, type Refusal, type RoomPeer } from '../core/session/room-peer';
import { netSettings } from '../core/session/settings';
import { LoopbackNet, mulberry32, type LinkSpec, type LoopNode } from './loopback';
import type { Transport } from './transport';

const BUILD = '0123456789abcdef';
const OTHER_BUILD = 'fedcba9876543210';
const player = (k: number): string => (k + 1).toString(16).padStart(32, '0');
const NET = netSettings();
const PING_MS = NET.transport.pingEveryMs;

interface Call {
  readonly what: 'check' | 'join' | 'failed' | 'leave' | 'rtt' | 'message';
  readonly peer: string;
  readonly now: number;
  readonly ms?: number;
  readonly bytes?: Uint8Array;
}

/** A room peer of the test's own. It refuses by commonRefusal; admits at
 *  most admitMax peers, counting the joined and, with reserve, the
 *  handshakes it has accepted that are still under way (D-21); and, with
 *  replaceSilentMs, accepts a HELLO under a joined player's ID once that
 *  connection has been silent that long, naming it in replaces (C-12). */
class TestPeer implements RoomPeer {
  readonly calls: Call[] = [];
  readonly joined = new Map<string, Hello>();
  readonly reserved = new Set<string>();
  readonly heard = new Map<string, number>();
  readonly link: Transport;
  readonly me: string;
  build = BUILD;
  protocol: number = PROTOCOL_VERSION;
  admitMax = Infinity;
  reserve = true;
  replaceSilentMs: number | null = null;
  advances: number[] = [];

  constructor(link: Transport, me: string) {
    this.link = link;
    this.me = me;
  }

  hello(): Hello {
    return {
      type: T.HELLO, protocol: this.protocol, build: this.build, player: this.me, role: ROLE.UNDECIDED,
      timeline: ZERO_HASH, timelineKind: TIMELINE_KIND.NONE, phase: 0, finalTick: 0, hash: ZERO_HASH, name: 'P',
    };
  }

  checkHello(hello: Hello, now: number, peer: string): Accepted | Refusal {
    this.calls.push({ what: 'check', peer, now });
    const common = commonRefusal(hello, this.build, this.me);
    if (common) return common;
    const old = [...this.joined].find(([, h]) => h.player === hello.player)?.[0];
    if (old !== undefined) {
      const silent = now - (this.heard.get(old) ?? -Infinity);
      if (this.replaceSilentMs === null || silent < this.replaceSilentMs) return { ok: false, reason: REFUSAL.DUPLICATE };
    }
    if (this.joined.size + (this.reserve ? this.reserved.size : 0) >= this.admitMax) return { ok: false, reason: REFUSAL.SPECTATORS_FULL };
    this.reserved.add(peer);
    return old === undefined ? { ok: true, hello } : { ok: true, hello, replaces: old };
  }

  onPeerJoin(peer: string, hello: Hello, sent: Hello, now: number): void {
    expect(sent.player).toBe(this.me);
    this.reserved.delete(peer);
    this.joined.set(peer, hello);
    this.heard.set(peer, now);
    this.calls.push({ what: 'join', peer, now });
  }

  onHandshakeFailed(peer: string): void {
    this.reserved.delete(peer);
    this.calls.push({ what: 'failed', peer, now: NaN });
  }

  onPeerLeave(peer: string): void {
    this.joined.delete(peer);
    this.calls.push({ what: 'leave', peer, now: NaN });
  }

  onRtt(peer: string, ms: number, now: number): void {
    this.heard.set(peer, now);
    this.calls.push({ what: 'rtt', peer, now, ms });
  }

  onMessage(peer: string, bytes: Uint8Array, now: number): void {
    this.heard.set(peer, now);
    this.calls.push({ what: 'message', peer, now, bytes });
  }

  advance(now: number): void {
    this.advances.push(now);
  }

  of(what: Call['what'], peer?: string): Call[] {
    return this.calls.filter((c) => c.what === what && (peer === undefined || c.peer === peer));
  }
}

type Node = LoopNode<TestPeer>;
const fixed = (base: number, jitter = 0): (() => LinkSpec) => () => ({ base, jitter });
const add = (net: LoopbackNet, k: number, playerId = player(k), opts = {}): Node =>
  net.add(`n${k}`, (link) => new TestPeer(link, playerId), opts);
/** A message of the given type byte and a sequence number. */
const msg = (type: number, n: number): Uint8Array => Uint8Array.of(type, n);

describe('mulberry32', () => {
  it('repeats from a seed, in [0, 1)', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(Array.from({ length: 1000 }, () => b())).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(mulberry32(8)()).not.toBe(xs[0]);
  });
});

describe('the handshake (design §6.2)', () => {
  it('runs in two rounds over the link: both HELLOs, both checks with the time and peer ID, then both joins', () => {
    const net = new LoopbackNet(1, fixed(50));
    const a = add(net, 0);
    const b = add(net, 1, player(1), { clockOffset: 7 });
    net.join(a, 0);
    net.join(b, 1000);
    net.run(1149);
    expect(a.session.of('check')).toEqual([]);
    net.run(1199);
    // They meet a round trip after b joins, and each HELLO takes 50 ms.
    expect(a.session.of('check')).toEqual([{ what: 'check', peer: 'n1', now: 1150 }]);
    expect(b.session.of('check')).toEqual([{ what: 'check', peer: 'n0', now: 1157 }]);
    expect(a.session.of('join')).toEqual([]);
    expect(a.neighbours.has('n1')).toBe(false);
    net.run(1200);
    expect(a.session.of('join')).toEqual([{ what: 'join', peer: 'n1', now: 1200 }]);
    expect(b.session.of('join')).toEqual([{ what: 'join', peer: 'n0', now: 1207 }]);
    expect(a.session.joined.get('n1')).toEqual(b.session.hello());
    expect([...a.neighbours, ...b.neighbours]).toEqual(['n1', 'n0']);
    expect(net.refusals).toEqual([]);
    // The handshake isn't the session's traffic.
    expect(net.messages).toBe(0);
  });

  it("carries the HELLO as the wire does: a name that isn't wire-safe arrives empty", () => {
    const net = new LoopbackNet(2, fixed(20));
    const a = add(net, 0);
    const b = add(net, 1);
    b.session.hello = () => ({ ...TestPeer.prototype.hello.call(b.session), name: 'x'.repeat(40) });
    net.join(a, 0);
    net.join(b, 0);
    net.run(1000);
    expect(a.session.joined.get('n1')?.name).toBe('');
  });

  it("overlaps a burst's handshakes, so only a count of reservations holds the cap (D-21, R-17)", () => {
    const burst = (reserve: boolean): { keeper: Node; newcomers: Node[]; net: LoopbackNet } => {
      const net = new LoopbackNet(3, fixed(40, 10));
      const keeper = add(net, 0);
      keeper.session.admitMax = 2;
      keeper.session.reserve = reserve;
      net.join(keeper, 0);
      const newcomers = [1, 2, 3, 4, 5].map((k) => add(net, k));
      for (const n of newcomers) net.join(n, 1000);
      net.run(3000);
      return { keeper, newcomers, net };
    };
    const raced = burst(false);
    const checks = raced.keeper.session.of('check');
    const joins = raced.keeper.session.of('join');
    expect(checks).toHaveLength(5);
    // Every check ran before the first join: the handshakes overlapped.
    expect(Math.max(...checks.map((c) => c.now))).toBeLessThan(Math.min(...joins.map((c) => c.now)));
    expect(joins).toHaveLength(5); // past the cap of 2, as C-11 feared

    const held = burst(true);
    expect(held.keeper.session.of('join')).toHaveLength(2);
    expect(held.keeper.session.reserved.size).toBe(0);
    const refused = held.net.refusals.filter((r) => r.from === 'n0');
    expect(refused).toHaveLength(3);
    expect(refused.every((r) => r.reason === REFUSAL.SPECTATORS_FULL)).toBe(true);
    // Each refused newcomer had accepted the keeper, and learns its handshake failed.
    for (const r of refused) {
      const n = held.newcomers.find((x) => x.id === r.to)!;
      expect(n.session.of('failed', 'n0')).toHaveLength(1);
      expect(n.session.reserved.has('n0')).toBe(false);
      expect(n.neighbours.has('n0')).toBe(false);
    }
    // The newcomers, with no cap, all meet each other.
    for (const n of held.newcomers) expect(n.session.joined.size).toBe(4 + (n.neighbours.has('n0') ? 1 : 0));
  });

  it('refuses by commonRefusal: a protocol, a build, its own ID and a bot’s ID (D-21, design §4.3)', () => {
    const net = new LoopbackNet(4, fixed(30));
    const a = add(net, 0);
    net.join(a, 0);
    const protocol = add(net, 1);
    protocol.session.protocol = PROTOCOL_VERSION + 1;
    const build = add(net, 2);
    build.session.build = OTHER_BUILD;
    const twin = add(net, 3, player(0));
    const bot = add(net, 4, botId(player(9), 0));
    for (const n of [protocol, build, twin, bot]) net.join(n, 100);
    // Only a meets the others: they block one another.
    for (const x of [protocol, build, twin, bot]) for (const y of [protocol, build, twin, bot]) if (x !== y) net.block(x.id, y.id);
    net.run(2000);
    const from = (id: string): { to: string; reason: number }[] => net.refusals.filter((r) => r.from === id).map(({ to, reason }) => ({ to, reason }));
    expect(from('n0').sort((x, y) => (x.to < y.to ? -1 : 1))).toEqual([
      { to: 'n1', reason: REFUSAL.PROTOCOL },
      { to: 'n2', reason: REFUSAL.BUILD },
      { to: 'n3', reason: REFUSAL.DUPLICATE },
      { to: 'n4', reason: REFUSAL.DUPLICATE },
    ]);
    // The other build refuses a's too, and the twin sees its own ID; the one
    // that sent another version and the bot's ID accept a, and learn that
    // their handshakes failed.
    expect(from('n1')).toEqual([]);
    expect(from('n2')).toEqual([{ to: 'n0', reason: REFUSAL.BUILD }]);
    expect(from('n3')).toEqual([{ to: 'n0', reason: REFUSAL.DUPLICATE }]);
    expect(from('n4')).toEqual([]);
    for (const n of [protocol, bot]) expect(n.session.of('failed')).toEqual([{ what: 'failed', peer: 'n0', now: NaN }]);
    for (const n of [build, twin]) expect(n.session.of('failed')).toEqual([]);
    expect(a.session.of('failed')).toEqual([]);
    expect(a.neighbours.size).toBe(0);
  });

  it('fails a handshake under way when a side leaves, for each side that had accepted', () => {
    const net = new LoopbackNet(5, fixed(100));
    const a = add(net, 0);
    const b = add(net, 1);
    net.join(a, 0);
    net.join(b, 1000); // they meet at 1200, check at 1300, would join at 1400
    net.leave(b, 1350);
    net.run(3000);
    expect(a.session.of('check')).toHaveLength(1);
    expect(a.session.of('failed', 'n1')).toHaveLength(1);
    expect(a.session.of('join')).toEqual([]);
    expect(a.session.reserved.size).toBe(0);
    expect(a.neighbours.size + b.neighbours.size).toBe(0);
  });

  it('drops the silent connection an accepted HELLO replaces, and refuses one that answers pings (C-12)', () => {
    const replay = (freezeOld: boolean): { net: LoopbackNet; a: Node; old: Node; fresh: Node } => {
      const net = new LoopbackNet(6, fixed(30, 5));
      const a = add(net, 0);
      a.session.replaceSilentMs = NET.room.duplicateSilentMs;
      const old = add(net, 1, player(7));
      const fresh = add(net, 2, player(7)); // the same player, reloaded elsewhere
      net.join(a, 0);
      net.join(old, 0);
      if (freezeOld) net.pace(old, 2000, Infinity);
      net.join(fresh, 5000);
      net.run(8000);
      return { net, a, old, fresh };
    };
    // The old page answers a's pings, so it isn't silent: a duplicate.
    const live = replay(false);
    expect(live.net.refusals).toContainEqual({ from: 'n0', to: 'n2', reason: REFUSAL.DUPLICATE });
    expect(live.a.neighbours.has('n1')).toBe(true);
    expect(live.a.neighbours.has('n2')).toBe(false);
    expect(live.net.drops).toEqual([]);

    // Frozen, it sends nothing and answers no ping: the new connection replaces it.
    const silent = replay(true);
    expect(silent.net.drops).toEqual([['n0', 'n1']]);
    expect(silent.a.neighbours.has('n1')).toBe(false);
    expect(silent.a.neighbours.has('n2')).toBe(true);
    const order = silent.a.session.calls.filter((c) => (c.what === 'leave' && c.peer === 'n1') || (c.what === 'join' && c.peer === 'n2'));
    expect(order.map((c) => c.what)).toEqual(['leave', 'join']);
    // The old page, frozen, learns its connection closed once it thaws.
    expect(silent.old.session.of('leave', 'n0')).toEqual([]);
    silent.net.pace(silent.old, 8000, NET.timerMs);
    silent.net.run(8500);
    expect(silent.old.session.of('leave', 'n0')).toHaveLength(1);
    // The pair stays blocked: the old connection's peer ID never connects again.
    silent.net.leave(silent.old, 9000);
    silent.net.join(silent.old, 9100);
    silent.net.run(13_000);
    expect(silent.a.neighbours.has('n1')).toBe(false);
    expect(silent.a.session.of('check', 'n1')).toHaveLength(1);
  });
});

describe('pings (design §4.4, §6.2)', () => {
  it("go to each neighbour on joining and every pingEveryMs of the pinger's timers, each pong an onRtt", () => {
    const net = new LoopbackNet(7, fixed(25));
    const a = add(net, 0);
    const b = add(net, 1, player(1), { pingEveryMs: 250 });
    net.join(a, 0);
    net.join(b, 0);
    net.run(10_000);
    const joinedAt = a.session.of('join')[0]!.now;
    const fromA = a.session.of('rtt', 'n1');
    const fromB = b.session.of('rtt', 'n0');
    expect(fromA.every((c) => c.ms === 50)).toBe(true);
    // The join's ping, then one a second; b's every 250 ms.
    expect(fromA[0]!.now).toBe(joinedAt + 50);
    expect(fromA.length).toBeGreaterThanOrEqual(Math.floor((10_000 - joinedAt) / PING_MS));
    expect(fromA.length).toBeLessThanOrEqual(Math.floor((10_000 - joinedAt) / PING_MS) + 2);
    expect(fromB.length).toBeGreaterThanOrEqual(4 * Math.floor((10_000 - joinedAt) / 1000));
    // A hidden page's timers wake once a second, and so do its pings.
    net.pace(b, 10_000, 1000);
    net.run(20_000);
    const hidden = b.session.of('rtt', 'n0').filter((c) => c.now > 11_000);
    expect(hidden.length).toBeGreaterThanOrEqual(8);
    expect(hidden.length).toBeLessThanOrEqual(10);
  });

  it('go on each run of a hidden page a second apart, whatever its clock drift (C-12, design §9.2)', () => {
    for (const drift of [-0.001, 0, 0.001]) {
      const net = new LoopbackNet(23, fixed(25));
      const a = add(net, 0);
      const b = add(net, 1, player(1), { drift });
      net.join(a, 0);
      net.join(b, 0);
      net.pace(b, 1000, 1000);
      net.run(21_000);
      // b's own clock times its pongs: about a second apart on each, never two.
      const at = b.session.of('rtt', 'n0').filter((c) => c.now > 2000).map((c) => c.now);
      const gaps = at.slice(1).map((t, k) => t - at[k]!);
      expect(gaps.length, `drift ${drift}`).toBeGreaterThanOrEqual(17);
      expect(Math.max(...gaps), `drift ${drift}`).toBeLessThan(1100);
    }
  });

  it('stop for a frozen node, both ways, and start again when it wakes', () => {
    const net = new LoopbackNet(8, fixed(40, 20));
    const a = add(net, 0);
    const b = add(net, 1);
    net.join(a, 0);
    net.join(b, 0);
    net.pace(b, 5000, Infinity);
    net.pace(b, 12_000, NET.timerMs);
    net.at(8000, () => a.session.link.send('n1', msg(T.PEERS, 1)));
    net.run(16_000);
    // Anything in flight at the freeze lands within a round trip and a ping period.
    const settled = 5000 + PING_MS + 2 * 60;
    const quiet = (c: Call): boolean => c.now > settled && c.now < 12_000;
    expect(a.session.of('rtt', 'n1').filter(quiet)).toEqual([]);
    expect(b.session.of('rtt', 'n0').filter(quiet)).toEqual([]);
    expect(b.session.advances.filter((t) => t > 5000 && t < 12_000)).toEqual([]);
    // Pings were answered before, and are again after.
    expect(a.session.of('rtt', 'n1').filter((c) => c.now > 3000 && c.now <= 5000).length).toBeGreaterThan(0);
    expect(a.session.of('rtt', 'n1').filter((c) => c.now > 12_000).length).toBeGreaterThanOrEqual(3);
    expect(b.session.of('rtt', 'n0').filter((c) => c.now > 12_000).length).toBeGreaterThanOrEqual(3);
    // A message to a frozen node waits until it thaws, after its first timer run there.
    const got = b.session.of('message', 'n0');
    expect(got).toHaveLength(1);
    expect(got[0]!.now).toBe(12_000);
    expect(b.session.advances.filter((t) => t >= 12_000)[0]).toBe(12_000);
  });
});

describe('a frozen node (M3 phase 3\'s answers, design §8.2)', () => {
  it('runs nothing until it thaws: its handshakes wait, a close waits, and its pongs come a freeze late', () => {
    const net = new LoopbackNet(24, fixed(30));
    const a = add(net, 0);
    const b = add(net, 1);
    const c = add(net, 2);
    net.join(a, 0);
    net.join(b, 0);
    net.pace(b, 1000, Infinity);
    net.join(c, 2000); // meets a, and b only once b thaws
    net.leave(a, 3000);
    net.pace(b, 5000, NET.timerMs);
    net.run(4999);
    // Frozen: no check of c's HELLO, no word of a's leave, no pong.
    expect(b.session.of('check', 'n2')).toEqual([]);
    expect(b.session.of('leave')).toEqual([]);
    expect(b.session.calls.filter((x) => x.now > 1000)).toEqual([]);
    expect(c.session.of('join', 'n0')).toHaveLength(1);
    expect(c.neighbours.has('n1')).toBe(false);
    // a pinged b while b was frozen, and had no answer before a left.
    expect(a.session.of('rtt', 'n1').filter((x) => x.now > 1100)).toEqual([]);
    net.run(6000);
    // Thawed: the close first, as it reached b first, then the handshake with c, a round trip later.
    expect(b.session.of('leave', 'n0').map((x) => x.what)).toEqual(['leave']);
    expect(b.session.of('check', 'n2').map((x) => x.now)).toEqual([5030]);
    expect(b.session.of('join', 'n2').map((x) => x.now)).toEqual([5060]);
    expect(c.session.of('join', 'n1').map((x) => x.now)).toEqual([5060]);
    expect(b.neighbours.has('n2')).toBe(true);
  });

  it("answers the ping that reached it frozen when it thaws, the pinger's round trip a freeze long, one ping out at a time", () => {
    const net = new LoopbackNet(25, fixed(40));
    const a = add(net, 0);
    const b = add(net, 1);
    net.join(a, 0);
    net.join(b, 0);
    // Frozen just after its timer pinged a, at 2000.
    net.pace(b, 2010, Infinity);
    net.pace(b, 6000, NET.timerMs);
    net.run(8000);
    const rtt = a.session.of('rtt', 'n1');
    // None while b slept: a's ping out to it waited, and a sent no other meanwhile, as TrysteroRoom
    // sends none while one is out (reviewer L1). It comes back once b wakes, 40 ms later: a freeze's
    // round trip; then a's next round, at 7000, pings it again.
    expect(rtt.filter((x) => x.now > 2080 && x.now < 6040)).toEqual([]);
    const late = rtt.filter((x) => x.ms! > 1000);
    expect(late.map((x) => x.now)).toEqual([6040]);
    expect(late[0]!.ms).toBeGreaterThan(3000);
    expect(rtt.filter((x) => x.now > 6040).map((x) => [x.now, x.ms])).toEqual([[7080, 80]]);
    // b's own ping before it froze came back while it slept, and is handled when it wakes.
    const own = b.session.of('rtt', 'n0').filter((x) => x.now >= 6000 && x.now < 6040);
    expect(own.map((x) => x.now)).toEqual([6000]);
    expect(own[0]!.ms).toBeGreaterThan(3900);
  });

  it('fails a handshake with a frozen node handshakeTimeoutMs after it began, on both sides, and meets again once it thaws (reviewer L1)', () => {
    const net = new LoopbackNet(26, fixed(40));
    const a = add(net, 0);
    const b = add(net, 1);
    net.join(a, 0);
    net.join(b, 1000);
    // b meets a at 1080, both HELLOs leaving; b freezes before a's arrives, and a's verdict waits too.
    net.pace(b, 1100, Infinity);
    net.pace(b, 1100 + 2 * NET.room.handshakeTimeoutMs, NET.timerMs);
    net.run(1080 + NET.room.handshakeTimeoutMs - 1);
    expect([a.session.of('check', 'n1').length, a.session.of('failed', 'n1').length, a.neighbours.has('n1')]).toEqual([1, 0, false]);
    net.run(1080 + NET.room.handshakeTimeoutMs + 1);
    // a's place for b goes at the timeout, as TrysteroRoom releases it; b, frozen, hears of it later.
    expect(a.session.of('failed', 'n1')).toHaveLength(1);
    expect(a.session.reserved.has('n1')).toBe(false);
    const thaw = 1100 + 2 * NET.room.handshakeTimeoutMs;
    net.run(thaw - 1);
    expect(b.session.calls.filter((x) => x.what !== 'check' && x.what !== 'rtt')).toEqual([]);
    net.run(thaw + 500);
    // Thawed: the old handshake's steps do nothing, and a new one joins the pair.
    expect(b.session.of('check', 'n0').map((x) => x.now)).toEqual([thaw + 40]);
    expect(b.session.of('join', 'n0').map((x) => x.now)).toEqual([thaw + 80]);
    expect(a.session.of('join', 'n1').map((x) => x.now)).toEqual([thaw + 80]);
    expect([a.session.of('check', 'n1').length, a.neighbours.has('n1'), b.neighbours.has('n0')]).toEqual([2, true, true]);
  });
});

describe('links (design §8.2)', () => {
  /** a sends a message of type T.TICK every 10 ms from `from` to `to`, numbered from 0. */
  const stream = (net: LoopbackNet, a: Node, peer: string, from: number, to: number): number[] => {
    const sent: number[] = [];
    for (let t = from, n = 0; t < to; t += 10, n++) {
      const k = n;
      net.at(t, () => {
        a.session.link.send(peer, msg(T.TICK, k));
        sent.push(net.now);
      });
    }
    return sent;
  };
  const arrivals = (b: Node, peer: string): { n: number; at: number }[] =>
    b.session.of('message', peer).map((c) => ({ n: c.bytes![1]!, at: c.now }));

  it('deliver after the latency, in order on each link, and count by type (D-20)', () => {
    const net = new LoopbackNet(9, fixed(30, 25));
    const a = add(net, 0);
    const b = add(net, 1);
    net.join(a, 0);
    net.join(b, 0);
    stream(net, a, 'n1', 1000, 2000);
    net.at(1500, () => a.session.link.broadcast(msg(T.PEERS, 0)));
    net.run(3000);
    const got = arrivals(b, 'n0');
    const ticks = b.session.of('message', 'n0').filter((c) => c.bytes![0] === T.TICK);
    expect(ticks.map((c) => c.bytes![1])).toEqual(Array.from({ length: 100 }, (_, n) => n));
    for (let i = 1; i < got.length; i++) expect(got[i]!.at).toBeGreaterThanOrEqual(got[i - 1]!.at);
    ticks.forEach((c, n) => {
      expect(c.now).toBeGreaterThanOrEqual(1000 + 10 * n + 30);
    });
    expect(net.messages).toBe(101);
    expect(net.bytes).toBe(202);
    expect(net.byType.get(T.TICK)).toEqual({ messages: 100, bytes: 200 });
    expect(net.byType.get(T.PEERS)).toEqual({ messages: 1, bytes: 2 });
  });

  it('read the link with the time a message leaves, so a test can slow a link for a while', () => {
    const asked: number[] = [];
    const net = new LoopbackNet(10, (from, to, now) => {
      if (from === 'n0' && to === 'n1') asked.push(now);
      return { base: now >= 2000 && now < 2500 ? 200 : 20, jitter: 0 };
    });
    const a = add(net, 0);
    const b = add(net, 1);
    net.join(a, 0);
    net.join(b, 0);
    stream(net, a, 'n1', 1900, 2600);
    net.run(4000);
    expect(asked).toContain(1900);
    expect(asked).toContain(2000);
    const at = new Map(arrivals(b, 'n0').map((x) => [x.n, x.at]));
    expect(at.get(0)).toBe(1920);
    expect(at.get(10)).toBe(2200); // left at 2000, slow
    // Left at 2500 and after, fast again, but behind the slow ones on the link.
    expect(at.get(59)).toBe(2690);
    expect(at.get(60)).toBe(2690);
    expect(at.get(69)).toBe(2690);
  });

  it('turn a loss into an extra round trip, and FIFO into head-of-line blocking (§17, design §8.2)', () => {
    const net = new LoopbackNet(11, (from, to, now) => ({ base: 40, jitter: 0, loss: from === 'n0' && now === 1500 ? 1 : 0 }));
    const a = add(net, 0);
    const b = add(net, 1);
    net.join(a, 0);
    net.join(b, 0);
    stream(net, a, 'n1', 1000, 2000);
    net.run(3000);
    const at = new Map(arrivals(b, 'n0').map((x) => [x.n, x.at]));
    expect(at.get(49)).toBe(1530);
    expect(at.get(50)).toBe(1620); // lost once: 40 ms, and 80 more for the retransmission
    // The ones behind it wait for it, until the link catches up.
    for (const n of [51, 52, 57]) expect(at.get(n)).toBe(1620);
    expect(at.get(58)).toBe(1620);
    expect(at.get(59)).toBe(1630);
    expect(at.size).toBe(100);
  });

  it('keep the jitter of a loss-free run when only the loss differs', () => {
    const run = (loss: number): number[] => {
      const net = new LoopbackNet(12, () => ({ base: 30, jitter: 20, loss }));
      const a = add(net, 0);
      const b = add(net, 1);
      net.join(a, 0);
      net.join(b, 0);
      stream(net, a, 'n1', 1000, 1500);
      net.run(3000);
      return arrivals(b, 'n0').map((x) => x.at);
    };
    const clean = run(0);
    const tiny = run(1e-12);
    expect(tiny).toEqual(clean);
    expect(run(0.5)).not.toEqual(clean);
  });

  it('lose the next match for good with dropNext, and hold it with delayNext, FIFO behind it', () => {
    // Message 5 leaves at 1050, when nothing else leaves n0, on a slow link: kept, it would hold
    // message 6 back to 1250.
    const net = new LoopbackNet(13, (from, _to, now) => ({ base: from === 'n0' && now === 1050 ? 200 : 30, jitter: 0 }));
    const a = add(net, 0);
    const b = add(net, 1);
    net.join(a, 0);
    net.join(b, 0);
    net.at(999, () => {
      net.dropNext('n0', 'n1', (bytes) => bytes[1] === 5);
      net.delayNext('n0', 'n1', (bytes) => bytes[1] === 20, 100);
      net.dropNext('n1', 'n0', () => true); // the other way: nothing is sent that way
    });
    stream(net, a, 'n1', 1000, 1500);
    net.run(3000);
    const at = new Map(arrivals(b, 'n0').map((x) => [x.n, x.at]));
    expect(at.has(5)).toBe(false);
    expect([at.get(4), at.get(6)]).toEqual([1070, 1090]); // nothing held behind a message lost for good
    expect(at.get(20)).toBe(1330);
    for (const n of [21, 25, 29]) expect(at.get(n)).toBe(1330);
    expect(at.get(30)).toBe(1330);
    expect(at.get(31)).toBe(1340);
    expect(at.size).toBe(49);
    // Each rule is used once: a later match goes through.
    expect(net.messages).toBe(50);
  });
});

describe('the room (design §8.2)', () => {
  it('drops a connection both ways, blocks the pair, records it, and unblock lets it meet again', () => {
    const net = new LoopbackNet(14, fixed(20));
    const a = add(net, 0);
    const b = add(net, 1);
    net.join(a, 0);
    net.join(b, 0);
    net.at(1000, () => a.session.link.drop!('n1'));
    net.run(2000);
    expect(net.drops).toEqual([['n0', 'n1']]);
    expect(a.session.of('leave', 'n1')).toHaveLength(1);
    expect(b.session.of('leave', 'n0')).toHaveLength(1);
    expect(a.neighbours.size + b.neighbours.size).toBe(0);
    net.at(2000, () => a.session.link.send('n1', msg(T.TICK, 0)));
    net.run(3000);
    expect(b.session.of('message')).toEqual([]);
    net.at(3000, () => net.unblock('n0', 'n1'));
    net.run(4000);
    expect(a.session.of('join', 'n1')).toHaveLength(2);
    expect(a.neighbours.has('n1')).toBe(true);
  });

  it("makes each node's link a Transport: its peer count, the last refusal it received, and leave() (design §6.1)", async () => {
    const net = new LoopbackNet(20, fixed(20));
    const a = add(net, 0);
    const b = add(net, 1);
    const c = add(net, 2);
    c.session.build = OTHER_BUILD;
    for (const n of [a, b, c]) net.join(n, 0);
    net.run(1000);
    expect(a.session.link.peerCount()).toBe(1);
    expect(a.session.link.refusedBy).toBe(REFUSAL.BUILD);
    expect(b.session.link.refusedBy).toBe(REFUSAL.BUILD);
    expect(c.session.link.refusedBy).toBe(REFUSAL.BUILD);
    expect(c.session.link.peerCount()).toBe(0);
    await b.session.link.leave();
    net.run(1001);
    expect(b.online).toBe(false);
    expect(a.session.link.peerCount()).toBe(0);
    expect(a.session.of('leave', 'n1')).toHaveLength(1);
  });

  it('keeps a blocked pair apart, so a third node is all that joins them (forwarding, D-19)', () => {
    const net = new LoopbackNet(15, fixed(20));
    const [a, b, c] = [0, 1, 2].map((k) => add(net, k)) as [Node, Node, Node];
    net.block('n0', 'n1');
    for (const n of [a, b, c]) net.join(n, 0);
    net.run(2000);
    expect([...a.neighbours]).toEqual(['n2']);
    expect([...b.neighbours]).toEqual(['n2']);
    expect([...c.neighbours].sort()).toEqual(['n0', 'n1']);
    // A send to a node that isn't a neighbour goes nowhere.
    net.at(2000, () => a.session.link.send('n1', msg(T.TICK, 0)));
    net.run(3000);
    expect(b.session.of('message')).toEqual([]);
  });

  it('closes every connection of a node that leaves, and runs one set of timers when it joins again', () => {
    const net = new LoopbackNet(16, fixed(20));
    const a = add(net, 0);
    const b = add(net, 1);
    net.join(a, 0);
    net.join(b, 0);
    net.leave(b, 1000);
    net.join(b, 1002);
    net.run(3000);
    expect(a.session.of('leave', 'n1')).toHaveLength(1);
    expect(b.session.of('leave', 'n0')).toHaveLength(1);
    expect(a.neighbours.has('n1')).toBe(true); // met again
    // One timer chain: every 4 ms, not twice that.
    const after = b.session.advances.filter((t) => t >= 2000 && t < 3000);
    expect(after).toHaveLength(1000 / NET.timerMs);
    const offline = b.session.advances.filter((t) => t > 1000 && t < 1002);
    expect(offline).toEqual([]);
  });

  it("paces a node's timers, stops them while it's frozen, and starts them at once when it wakes", () => {
    const net = new LoopbackNet(17, fixed(20));
    const a = add(net, 0);
    net.join(a, 0);
    net.pace(a, 1000, 1000);
    net.pace(a, 5000, Infinity);
    net.pace(a, 9000, NET.timerMs);
    net.run(10_000);
    const t = a.session.advances;
    expect(t.filter((x) => x < 1000)).toHaveLength(1000 / NET.timerMs);
    expect(t.filter((x) => x >= 1000 && x < 5000)).toHaveLength(4);
    expect(t.filter((x) => x > 5000 && x < 9000)).toEqual([]);
    expect(t.filter((x) => x >= 9000)).toHaveLength(1000 / NET.timerMs + 1);
    expect(t.filter((x) => x >= 9000)[0]).toBe(9000);
  });

  it("gives each node its own clock, offset and drifting, in everything it's told", () => {
    const net = new LoopbackNet(18, fixed(20));
    const a = add(net, 0, player(0), { clockOffset: 1000, drift: 0.01 });
    const b = add(net, 1);
    net.join(a, 0);
    net.join(b, 0);
    net.at(2000, () => b.session.link.send('n0', msg(T.TICK, 0)));
    net.run(3000);
    expect(a.local(2020)).toBeCloseTo(2020 * 1.01 + 1000, 9);
    expect(a.session.of('message', 'n1')[0]!.now).toBeCloseTo(a.local(2020), 9);
    expect(a.session.advances[0]).toBe(1000);
    // Its pings time a round trip of 40 ms on its own, drifting, clock.
    expect(a.session.of('rtt', 'n1')[0]!.ms).toBeCloseTo(40 * 1.01, 9);
  });

  it('repeats a run exactly from a seed', () => {
    const run = (seed: number): string => {
      const net = new LoopbackNet(seed, (from, to) => ({ base: 20 + (from < to ? 10 : 30), jitter: 25, loss: 0.05 }));
      const nodes = [0, 1, 2, 3].map((k) => add(net, k));
      nodes.forEach((n, k) => net.join(n, 100 * k));
      for (const n of nodes) {
        for (let t = 500; t < 3000; t += 17) net.at(t, () => n.session.link.broadcast(msg(T.TICK, t % 251)));
      }
      net.run(4000);
      return JSON.stringify(nodes.map((n) => n.session.calls.map((c) => [c.what, c.peer, c.now, c.ms ?? null])));
    };
    expect(run(21)).toBe(run(21));
    expect(run(22)).not.toBe(run(21));
  });

  it('runs to until, or stops once stop() holds, asking every 500 ms', () => {
    const net = new LoopbackNet(19, fixed(20));
    const a = add(net, 0);
    net.join(a, 0);
    let asked = 0;
    net.run(10_000, () => {
      asked++;
      return net.now >= 3000;
    });
    expect(net.now).toBeGreaterThanOrEqual(3000);
    expect(net.now).toBeLessThan(3000 + NET.timerMs);
    expect(asked).toBe(6);
    net.run(5000);
    expect(net.now).toBe(5000);
    // An event for a time gone runs now, never back in time.
    let ranAt = -1;
    net.at(1000, () => (ranAt = net.now));
    net.run(5000);
    expect(ranAt).toBe(5000);
  });
});
