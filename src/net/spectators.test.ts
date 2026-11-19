import { describe, expect, it, vi } from 'vitest';
import { personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import {
  decode, encodeTick, NO_TICK, PROTOCOL_VERSION, REFUSAL, ROLE, T, type Hello, TIMELINE_KIND, ZERO_HASH,
} from '../core/protocol/messages';
import type { Link } from '../core/session/room-peer';
import { Session, type SessionConfig } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import { defaultParams, type MatchState, type Pack } from '../core/sim/index';
import { expectAgreement, NetPump, senderInput, TEST_BUILD } from '../core/timeline/testing';
import { type LinkSpec, LoopbackNet, type LoopNode, mulberry32 } from './loopback';
import type { Transport } from './transport';

// Spectators and duplicate IDs over the loopback network (PLAN D-21, C-11,
// C-12; M3's design, research/m3/DESIGN.md, §4.3 to §4.5, §8.1): a burst of
// undecided peers whose handshakes overlap stays within the mesh's cap, by
// each admission's reservation (M3-Q16, R-17); a fifth spectator leaves, as
// NetGame takes it out, and the room holds four; a peer lingering on Join
// doesn't turn a watcher away; two newcomers handshake without a state; a
// duplicate ID replaces a silent connection and is refused by one that
// answers pings, a live spectator's included; and a replacement survives
// its old connection's late leave.

vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const P = defaultParams;
const B = defaultBotParams;
const MATCH = '5ec7a70f5ec7a70f';
const id = (k: number): string => personId(11, k);

/** A session as NetGame drives it (design §1.24): a stall's gap, and the room left on spectatorsFull or
 *  a REFUSE 4, leaveGraceMs on (§4.5). */
class GameSession extends Session {
  transport: Transport | null = null;
  leaveAt = Infinity;
  private last = -1;

  override advance(now: number): void {
    if (this.last >= 0 && now - this.last > this.cfg.net.stallMs) this.stalled(now);
    this.last = now;
    super.advance(now);
    const out = this.spectatorsFull || this.transport?.refusedBy === REFUSAL.SPECTATORS_FULL;
    if (out && this.leaveAt === Infinity) this.leaveAt = now + this.cfg.net.room.leaveGraceMs;
  }
}

type Node = LoopNode<GameSession>;
type Room = NetPump<LoopbackNet>;

function uniform(seed: number, lo: number, hi: number, jitter: number): (a: string, b: string) => LinkSpec {
  const r = mulberry32(seed);
  const memo = new Map<string, number>();
  return (a, b) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!memo.has(k)) memo.set(k, lo + r() * (hi - lo));
    return { base: memo.get(k)!, jitter };
  };
}

/** k's session, leaving its room when NetGame would (GameSession). */
function node(room: Room, k: number, o: { me?: string; nodeId?: string; verify?: number; over?: Partial<SessionConfig> } = {}): Node {
  const me = o.me ?? id(k);
  const n = room.net.add(
    o.nodeId ?? `n${k}`,
    room.peer(
      (link, mode) => {
        const s = new GameSession(
          { P, B, net: NET, me, name: `P${k}`, coat: k % P.coatCount, build: TEST_BUILD, forwarding: true, mode, verify: o.verify ?? 0, ...o.over },
          link,
        );
        s.transport = link as Transport;
        return s;
      },
      (s) => ({ t: s.timeline, host: s.bots }),
    ),
  );
  // NetGame's leave, leaveGraceMs after it decided.
  const check = (): void => {
    if (n.online && n.session.leaveAt <= room.net.now) room.net.leave(n, room.net.now);
    else room.net.at(room.net.now + 20, check);
  };
  room.net.at(0, check);
  return n;
}

/** Runs the room's network to virtual time t. */
const runTo = (room: Room, t: number): void => room.run(t - room.net.now);
const finalOf = (n: Node): Readonly<MatchState> => n.session.timeline.final;
const agree = (nodes: readonly Node[]): void => expectAgreement(nodes.map((n) => ({ t: n.session.timeline })));
/** The run was clean (design §8.3, R-1): the drawn head's contract held on every node, and every chain
 *  a verifying node checked matched a full replay (reviewer S5). */
function expectClean(room: Room): void {
  expect(room.problems).toEqual([]);
  for (const n of room.nodes) expect(n.t.stats.verifyMismatches, `node ${n.k}: ${JSON.stringify(n.t.stats.log.slice(-4))}`).toBe(0);
}
const roles = (n: Node): number[] => [...n.session.connectedRoles().values()];
const count = (xs: readonly number[], v: number): number => xs.filter((x) => x === v).length;

/** A keeper that plays and `players` − 1 more, each in alternate packs, settled by 3 s. */
function players(room: Room, n: number, packSize: number): Node[] {
  const keeper = node(room, 0, { verify: 8 });
  room.net.join(keeper, 0, (now) => {
    keeper.session.propose(keeper.local(now), { packSize, matchMinutes: 1 }, MATCH);
    keeper.session.play(0);
  });
  const out = [keeper];
  for (let k = 1; k < n; k++) {
    const p = node(room, k);
    room.net.join(p, 100 * k, () => p.session.play((k % 2) as Pack));
    out.push(p);
  }
  return out;
}

describe('the spectator count (D-21, C-11, M3-Q16)', () => {
  it('holds a burst of undecided peers, their handshakes overlapping, within 8 players and 4 spectators, and frees the places it held', () => {
    const room = new NetPump(new LoopbackNet(1, uniform(1, 30, 60, 20)));
    const net = room.net;
    const mesh = players(room, 8, 4);
    runTo(room, 4000);
    expect(finalOf(mesh[0]!).terriers).toHaveLength(8);
    const ids = new Set(finalOf(mesh[0]!).terriers.map((T) => T.id));
    // No browser that holds the state ever has more than the cap's browsers outside the roster.
    let most = 0;
    const look = (): void => {
      for (const p of mesh) most = Math.max(most, [...p.session.connectedRoles().keys()].filter((x) => !ids.has(x)).length);
      if (net.now < 11_000) net.at(net.now + 5, look);
    };
    net.at(4000, look);
    // Eight newcomers at once, their handshakes overlapping as Trystero's do (design §6.2).
    const burst = [20, 21, 22, 23, 24, 25, 26, 27].map((k) => node(room, k));
    for (const n of burst) net.join(n, 5000);
    runTo(room, 7000);
    expect(most).toBeLessThanOrEqual(NET.room.spectatorsMax);
    const stayed = burst.filter((n) => n.online);
    expect(stayed.length).toBeLessThanOrEqual(NET.room.spectatorsMax);
    // Each refused by any that held the state left (§4.5), so a place each held is free again: four
    // more, one at a time, fill the room to the cap exactly.
    const wave = [30, 31, 32, 33].map((k) => node(room, k));
    wave.forEach((n, k) => net.join(n, 7000 + 300 * k));
    runTo(room, 11_000);
    const online = [...burst, ...wave].filter((n) => n.online);
    expect(online).toHaveLength(NET.room.spectatorsMax);
    expect(most).toBeLessThanOrEqual(NET.room.spectatorsMax);
    for (const n of online) expect(n.session.peerCount(), n.id).toBe(mesh.length + online.length - 1);
    for (const p of mesh) expect(p.session.peerCount(), p.id).toBe(mesh.length - 1 + online.length);
    expectClean(room);
    agree([...mesh, ...online]);
  });

  it('takes out a fifth spectator, whose connections close, and the room holds four (§4.5)', () => {
    const room = new NetPump(new LoopbackNet(2, uniform(2, 30, 60, 20)));
    const net = room.net;
    // Three players at 2 a side: one place free, so five browsers outside the roster may connect.
    const mesh = players(room, 3, 2);
    const watchers = [20, 21, 22, 23].map((k) => node(room, k));
    watchers.forEach((n, k) => net.join(n, 2000 + 300 * k, () => n.session.watch()));
    runTo(room, 4000);
    expect(watchers.map((n) => n.session.spectatorsFull)).toEqual([false, false, false, false]);
    const fifth = node(room, 24);
    net.join(fifth, 4000);
    runTo(room, 5000);
    // Admitted while undecided: the free place counts. Watching makes it the fifth spectator.
    expect(fifth.session.peerCount()).toBe(7);
    expect(fifth.session.role()).toBe(ROLE.UNDECIDED);
    fifth.session.watch();
    expect(fifth.session.spectatorsFull).toBe(true);
    runTo(room, 6000);
    expect(fifth.online).toBe(false);
    for (const n of [...mesh, ...watchers]) {
      expect(n.session.peerCount(), n.id).toBe(6);
      expect(count(roles(n), ROLE.SPECTATOR), n.id).toBe(mesh.includes(n) ? 4 : 3);
    }
    expectClean(room);
    agree([...mesh, ...watchers]);
  });

  it('takes out a fifth that pressed Watch before it held the state, and a Play-again spectator, counting the room as it meets it (reviewer S2)', () => {
    for (const how of ['watch', 'again'] as const) {
      const room = new NetPump(new LoopbackNet(6, uniform(6, 30, 60, 20)));
      const net = room.net;
      const mesh = players(room, 3, 2);
      const watchers = [20, 21, 22, 23].map((k) => node(room, k));
      watchers.forEach((n, k) => net.join(n, 2000 + 300 * k, () => n.session.watch()));
      runTo(room, 4000);
      // It watches from the start: as it opens the room, or as Play again's spectator stays one.
      const fifth = how === 'watch' ? node(room, 24) : node(room, 24, { over: { again: { pack: null, bots: [], againSeen: true } } });
      net.join(fifth, 4000, () => {
        if (how === 'watch') fifth.session.watch();
      });
      let peak = 0;
      const look = (): void => {
        peak = Math.max(peak, count(roles(mesh[0]!), ROLE.SPECTATOR));
        if (net.now < 7000) net.at(net.now + 5, look);
      };
      net.at(4000, look);
      runTo(room, 7000);
      expect([fifth.session.spectatorsFull, fifth.online], how).toEqual([true, false]);
      for (const n of [...mesh, ...watchers]) expect(n.session.peerCount(), `${how} ${n.id}`).toBe(6);
      expect(count(roles(mesh[0]!), ROLE.SPECTATOR), how).toBe(4);
      expectClean(room);
      agree([...mesh, ...watchers]);
    }
  });

  it("doesn't turn a watcher away for a peer lingering on Join, who is undecided, not a spectator (§4.5)", () => {
    const room = new NetPump(new LoopbackNet(3, uniform(3, 30, 60, 20)));
    const net = room.net;
    const mesh = players(room, 3, 2);
    const watchers = [20, 21, 22].map((k) => node(room, k));
    watchers.forEach((n, k) => net.join(n, 2000 + 300 * k, () => n.session.watch()));
    const lingering = node(room, 23);
    net.join(lingering, 2000);
    runTo(room, 4000);
    const watcher = node(room, 24);
    net.join(watcher, 4000, () => watcher.session.watch());
    runTo(room, 6000);
    expect(lingering.session.role()).toBe(ROLE.UNDECIDED);
    expect([watcher.session.spectatorsFull, watcher.online, watcher.session.role()]).toEqual([false, true, ROLE.SPECTATOR]);
    expect(count(roles(mesh[0]!), ROLE.SPECTATOR)).toBe(4);
    expect(count(roles(mesh[0]!), ROLE.UNDECIDED)).toBe(1);
    expectClean(room);
    agree([...mesh, ...watchers, lingering, watcher]);
  });

  it('lets two newcomers handshake without a state, though every browser that holds one refuses them (§16)', () => {
    const room = new NetPump(new LoopbackNet(4, uniform(4, 30, 60, 20)));
    const net = room.net;
    const mesh = players(room, 4, 2);
    const watchers = [20, 21, 22, 23].map((k) => node(room, k));
    watchers.forEach((n, k) => net.join(n, 2000 + 300 * k, () => n.session.watch()));
    runTo(room, 4000);
    // Full: four players and four spectators. Two more arrive at once.
    const late = [node(room, 30), node(room, 31)];
    for (const n of late) net.join(n, 4000);
    const refusedBy = (n: Node): Set<string> => new Set(net.refusals.filter((r) => r.to === n.id && r.reason === REFUSAL.SPECTATORS_FULL).map((r) => r.from));
    const holders = new Set([...mesh, ...watchers].map((x) => x.id));
    room.until(() => late.every((n) => refusedBy(n).size === holders.size), 1000);
    for (const n of late) expect(refusedBy(n)).toEqual(holders);
    // Neither holds the state, so they admit each other.
    room.until(() => late.every((n) => n.neighbours.size === 1), 1000);
    expect(late.map((n) => [...n.neighbours])).toEqual([['n31'], ['n30']]);
    expect(net.refusals.filter((r) => late.some((n) => n.id === r.from))).toEqual([]);
    // And NetGame takes them out, refused by those that hold it (§4.5).
    room.run(1000);
    expect(late.map((n) => n.online)).toEqual([false, false]);
    expectClean(room);
  });
});

describe('admissions, one session alone (D-21, design §4.3)', () => {
  it("counts every HELLO from outside the roster, whatever role it announces, each holding its place until it joins, fails or times out (M3-Q16, R-17)", () => {
    const s = new Session({ P, B, net: NET, me: id(0), name: 'P0', coat: 0, build: TEST_BUILD, forwarding: true }, { send: () => undefined, broadcast: () => undefined });
    s.propose(0, { packSize: 1, matchMinutes: 1 }, MATCH);
    s.play(0);
    let now = 0;
    const run = (ms: number): void => {
      for (const end = now + ms; now < end; now += NET.timerMs) s.advance(now);
    };
    run(1000);
    expect(s.inRoster()).toBe(true);
    const outsider = (k: number, role: number): Hello => ({
      type: T.HELLO, protocol: PROTOCOL_VERSION, build: TEST_BUILD, player: id(10 + k), role,
      timeline: ZERO_HASH, timelineKind: TIMELINE_KIND.NONE, phase: 0, finalTick: 0, hash: ZERO_HASH, name: '',
    });
    // One place free at 1 a side, and four for spectators: five browsers outside the roster, whatever
    // each says it is.
    const roles = [ROLE.KEEPER, ROLE.PLAYER, ROLE.SPECTATOR, ROLE.UNDECIDED, ROLE.SPECTATOR];
    roles.forEach((role, k) => expect(s.checkHello(outsider(k, role), now, `p${k}`).ok, `role ${role}`).toBe(true));
    for (const role of [ROLE.KEEPER, ROLE.PLAYER, ROLE.SPECTATOR, ROLE.UNDECIDED]) {
      expect(s.checkHello(outsider(9, role), now, 'p9'), `role ${role}`).toEqual({ ok: false, reason: REFUSAL.SPECTATORS_FULL });
    }
    // A handshake that failed frees its place; one that joined holds it as a connection.
    s.onHandshakeFailed('p0');
    expect(s.checkHello(outsider(5, ROLE.UNDECIDED), now, 'p5').ok).toBe(true);
    s.onPeerJoin('p1', outsider(1, ROLE.PLAYER), s.hello(), now);
    expect(s.checkHello(outsider(9, ROLE.UNDECIDED), now, 'p9').ok).toBe(false);
    // A handshake under way for handshakeTimeoutMs has timed out: its place goes.
    run(NET.room.handshakeTimeoutMs);
    for (const k of [6, 7, 8, 9]) expect(s.checkHello(outsider(k, ROLE.SPECTATOR), now, `p${k}`).ok, `p${k}`).toBe(true);
    expect(s.checkHello(outsider(11, ROLE.SPECTATOR), now, 'p11').ok).toBe(false);
  });
});

describe('duplicate HELLOs, one session alone (C-12, D-24, design §4.3)', () => {
  const lone = (): { s: Session; now: () => number; run: (ms: number) => void } => {
    const s = new Session({ P, B, net: NET, me: id(0), name: 'P0', coat: 0, build: TEST_BUILD, forwarding: true }, { send: () => undefined, broadcast: () => undefined });
    s.propose(0, { packSize: 1, matchMinutes: 1 }, MATCH);
    s.play(0);
    let now = 0;
    const run = (ms: number): void => {
      for (const end = now + ms; now < end; now += NET.timerMs) s.advance(now);
    };
    run(1000);
    return { s, now: () => now, run };
  };
  const outsider = (k: number, role: number = ROLE.SPECTATOR): Hello => ({
    type: T.HELLO, protocol: PROTOCOL_VERSION, build: TEST_BUILD, player: id(10 + k), role,
    timeline: ZERO_HASH, timelineKind: TIMELINE_KIND.NONE, phase: 0, finalTick: 0, hash: ZERO_HASH, name: '',
  });

  it('logs a silent connection\'s duplicate with the verdict it gets, REFUSE 4 when no place is left (reviewer S9)', () => {
    const { s, now, run } = lone();
    expect(s.inRoster()).toBe(true);
    // One place free and four for spectators: five outsiders connect.
    for (let k = 0; k < 5; k++) {
      expect(s.checkHello(outsider(k), now(), `p${k}`).ok).toBe(true);
      s.onPeerJoin(`p${k}`, outsider(k), s.hello(), now());
    }
    // This browser's bot takes the free place; p0 to p3 answer pings, p4 falls silent.
    expect(s.addBot(1)).toBe(true);
    for (let i = 0; i < 6; i++) {
      run(500);
      for (let k = 0; k < 4; k++) s.onRtt(`p${k}`, 60, now());
    }
    expect(s.timeline.final.terriers).toHaveLength(2);
    // p4's player reloads: its old connection has been silent over 2 s, but no place is left for it.
    expect(s.checkHello(outsider(4), now(), 'p4b')).toEqual({ ok: false, reason: REFUSAL.SPECTATORS_FULL });
    // Logged once, with the verdict it got, and how long the old connection had been silent.
    const logged = s.duplicates.filter((d) => d.player === id(14));
    expect(logged.map((d) => [d.verdict, d.oldSilentMs >= NET.room.duplicateSilentMs])).toEqual([[REFUSAL.SPECTATORS_FULL, true]]);
    // A live one's is refused as a duplicate, and logged so.
    expect(s.checkHello(outsider(0), now(), 'p0b')).toEqual({ ok: false, reason: REFUSAL.DUPLICATE });
    expect(s.duplicates.at(-1)!.verdict).toBe(REFUSAL.DUPLICATE);
  });

  it('refuses a second handshake under way for one player, as two tabs before the tab lock (D-24)', () => {
    const { s, now } = lone();
    expect(s.checkHello(outsider(1, ROLE.UNDECIDED), now(), 'tab1').ok).toBe(true);
    expect(s.checkHello(outsider(1, ROLE.UNDECIDED), now(), 'tab2')).toEqual({ ok: false, reason: REFUSAL.DUPLICATE });
    expect(s.duplicates.map((d) => [d.player, d.verdict, d.oldSilentMs])).toEqual([[id(11), REFUSAL.DUPLICATE, 0]]);
    // The same connection's own HELLO again, as a transport retries, isn't the other tab's.
    expect(s.checkHello(outsider(1, ROLE.UNDECIDED), now(), 'tab1').ok).toBe(true);
    // Once the first fails, the second may come.
    s.onHandshakeFailed('tab1');
    expect(s.checkHello(outsider(1, ROLE.UNDECIDED), now(), 'tab2').ok).toBe(true);
  });
});

describe('duplicate IDs (C-12, M3-Q23)', () => {
  it("refuses a duplicate of a live spectator, who answers pings though it sends only PEERS, and lets one replace it once it's silent", () => {
    const room = new NetPump(new LoopbackNet(5, uniform(5, 30, 60, 20)));
    const net = room.net;
    const mesh = players(room, 4, 2);
    const spectator = node(room, 20);
    net.join(spectator, 2000, () => spectator.session.watch());
    // The spectator's messages, as the mesh's keeper hears them.
    const said: number[] = [];
    const heard = mesh[0]!.session.onMessage.bind(mesh[0]!.session);
    mesh[0]!.session.onMessage = (peer, bytes, now) => {
      if (peer === spectator.id) said.push(now);
      heard(peer, bytes, now);
    };
    // The same player's page in another tab at 5 s, more than duplicateSilentMs after the spectator's
    // last PEERS and before its next: only its pongs keep it alive (reviewers S6, T3).
    const second = node(room, 20, { nodeId: 'second' });
    net.join(second, 5000);
    runTo(room, 9000);
    const refusals = (n: Node, reason: number): string[] => net.refusals.filter((r) => r.to === n.id && r.reason === reason).map((r) => r.from).sort();
    expect(refusals(second, REFUSAL.DUPLICATE)).toEqual([...mesh.map((x) => x.id), spectator.id].sort());
    const log = mesh[0]!.session.duplicates;
    expect(log.map((d) => [d.player, d.verdict])).toEqual([[id(20), REFUSAL.DUPLICATE]]);
    const lastSaid = Math.max(...said.filter((at) => at < log[0]!.at));
    expect(log[0]!.at - lastSaid).toBeGreaterThan(NET.room.duplicateSilentMs);
    // Its last pong had come within a ping period and a round trip, though it sent no message since.
    expect(log[0]!.oldSilentMs).toBeLessThan(NET.transport.pingEveryMs + 2 * 60 + 40);
    expect(log[0]!.oldLeftAt).toBeNull();
    net.leave(second, 9000);
    // Frozen, it answers no ping: once it's silent, a third page's HELLO replaces it.
    net.pace(spectator, 10_000, Infinity);
    const third = node(room, 20, { nodeId: 'third' });
    net.join(third, 13_000, () => third.session.watch());
    runTo(room, 16_000);
    for (const p of mesh) {
      expect(p.neighbours.has('third'), p.id).toBe(true);
      expect(p.neighbours.has(spectator.id), p.id).toBe(false);
      expect(net.drops).toContainEqual([p.id, spectator.id]);
      const d = p.session.duplicates.at(-1)!;
      expect([d.player, d.verdict], p.id).toEqual([id(20), REFUSAL.ACCEPTED]);
      expect(d.oldSilentMs, p.id).toBeGreaterThanOrEqual(NET.room.duplicateSilentMs);
      expect(d.oldLeftAt, p.id).not.toBeNull();
      expect(p.session.connectedRoles().get(id(20)), p.id).toBe(ROLE.SPECTATOR);
    }
    expect(third.session.timeline.started).toBe(true);
    expectClean(room);
    agree([...mesh, third]);
  });

  it("keeps a replacement's connection through its old connection's late leave (§4.4)", () => {
    // The session alone, its transport played by hand, as Trystero may report the old leave late.
    const sent: { peer: string | null; bytes: Uint8Array }[] = [];
    const link: Link = {
      send: (peer, bytes) => sent.push({ peer, bytes }),
      broadcast: (bytes) => sent.push({ peer: null, bytes }),
    };
    const s = new Session({ P, B, net: NET, me: id(0), name: 'P0', coat: 0, build: TEST_BUILD, forwarding: true }, link);
    s.propose(0, { packSize: 1, matchMinutes: 1 }, MATCH);
    s.play(0);
    const other = id(1);
    const hello = (): Hello => ({
      type: T.HELLO, protocol: PROTOCOL_VERSION, build: TEST_BUILD, player: other, role: ROLE.UNDECIDED,
      timeline: ZERO_HASH, timelineKind: TIMELINE_KIND.NONE, phase: 0, finalTick: 0, hash: ZERO_HASH, name: 'P1',
    });
    let now = 0;
    const run = (ms: number): void => {
      for (const end = now + ms; now < end; now += NET.timerMs) s.advance(now);
    };
    const sentHello = s.hello();
    expect(s.checkHello(hello(), now, 'old')).toEqual({ ok: true, hello: hello() });
    s.onPeerJoin('old', hello(), sentHello, now);
    s.onRtt('old', 80, now);
    run(500);
    // Silent, and replaced.
    run(NET.room.duplicateSilentMs);
    const verdict = s.checkHello(hello(), now, 'new');
    expect(verdict).toEqual({ ok: true, hello: hello(), replaces: 'old' });
    // The transport joins the new connection before it reports the old one's leave.
    s.onPeerJoin('new', hello(), s.hello(), now);
    s.onRtt('new', 60, now);
    run(100);
    const t = s.timeline;
    const tick = (u: number, input: number): Uint8Array =>
      encodeTick({ t: u, own: senderInput(new Map([[u, input]]), u), voteTick: NO_TICK, voteHash: ZERO_HASH, phase: 0, bots: [] });
    // What the timeline keeps of the player's connection (§4.4): its one-way delay and clock samples.
    const kept = (): [number | undefined, boolean] => {
      const x = t as unknown as { oneWayMs: ReadonlyMap<string, number>; ticks: { offsets: ReadonlyMap<string, number> } };
      return [x.oneWayMs.get(other), x.ticks.offsets.has(other)];
    };
    // The new connection's TICK, a clock sample with the new one-way delay.
    s.onMessage('new', tick(t.localTick + 1, 0x21), now);
    expect(kept()).toEqual([30, true]);
    // Its player maps to the new connection: the old one, not yet gone, speaks for it no more.
    s.onMessage('old', tick(t.localTick + 2, 0x22), now);
    expect(t.receivedInput(other, t.localTick + 2)).toBeUndefined();
    s.onPeerLeave('old');
    expect(s.connectedRoles()).toEqual(new Map([[other, ROLE.UNDECIDED]]));
    expect(s.peerCount()).toBe(1);
    expect(s.duplicates.map((d) => [d.verdict, d.oldLeftAt !== null])).toEqual([[REFUSAL.ACCEPTED, true]]);
    // The late leave left the replacement's one-way delay and clock samples (reviewer S11).
    expect(kept()).toEqual([30, true]);
    // The new connection's TICKs are its player's still.
    s.onMessage('new', tick(t.localTick + 3, 0x21), now);
    expect(t.receivedInput(other, t.localTick + 3)).toBe(0x21);
    // PEERS lists it.
    sent.length = 0;
    run(NET.room.peersEveryMs + NET.timerMs);
    const peers = sent.map((m) => decode(m.bytes)).find((m) => m?.type === T.PEERS);
    // And the timeline it holds (P7's peer side).
    expect(peers).toMatchObject({ type: T.PEERS, players: [other], role: ROLE.PLAYER, timeline: MATCH, timelineKind: TIMELINE_KIND.LIVE });
    // Its own leave takes them: a departed player's clock samples and one-way delay go.
    s.onPeerLeave('new');
    expect(kept()).toEqual([undefined, false]);
  });
});
