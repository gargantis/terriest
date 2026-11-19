import { describe, expect, it, vi } from 'vitest';
import { personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import { type ScriptName, scriptSampler } from '../core/bot/setups';
import {
  decode, encodeTick, type Hello, NO_TICK, PROTOCOL_VERSION, ROLE, type StateReq, T, TIMELINE_KIND, ZERO_HASH,
} from '../core/protocol/messages';
import { Session } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import { defaultParams, encodeInput, findTerrier, IN_PLAY, JOIN, jumpCount, KEPT_BITS, LEAVE, type MatchState, type Pack, WARM_UP } from '../core/sim/index';
import { Timeline } from '../core/timeline/timeline';
import { expectAgreement, NetPump, senderInput, TEST_BUILD } from '../core/timeline/testing';
import { type LinkSpec, LoopbackNet, type LoopNode, mulberry32, type ThawOrder } from './loopback';

// Stalls over the loopback network (PLAN D-31, A.4's Timer stall; M3's
// design, research/m3/DESIGN.md, §4.12, M3-Q9, §8.1): a page whose timers
// stop for more than stallMs pauses, rejoins only from a peer whose clock ran
// on, keeping its old timeline until a STATE is adopted, or re-anchors when
// none did. A frozen node runs nothing until it thaws (M3 phase 3's
// answers), and its round trips across the freeze set no one-way delay.
// The freezes under the stall threshold, and a stall every page shares,
// thaw both ways, the late timer run first or the messages held first, and
// move no clock either way (M3 phase 5).

vi.setConfig({ testTimeout: 120_000 });

/** A thawing page's late timer run first, as the loopback's default, or the messages held for it
 *  first: a browser may run a woken page's tasks either way (M3 phase 5). */
const THAWS = ['timer', 'messages'] as const satisfies readonly ThawOrder[];
const NET = netSettings();
const P = defaultParams;
const B = defaultBotParams;
const MATCH = '57a1157a1157a115';
const id = (k: number): string => personId(17, k);

/** A session as NetGame drives it (design §1.24): a gap over stallMs between timer runs is a stall. */
class GameSession extends Session {
  stalls = 0;
  private last = -1;

  override advance(now: number): void {
    if (this.last >= 0 && now - this.last > this.cfg.net.stallMs) {
      this.stalls++;
      this.stalled(now);
    }
    this.last = now;
    super.advance(now);
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

/** k's session, its terrier on a script made again from each base onControl hands it. */
function node(room: Room, k: number, o: { script?: ScriptName; verify?: number; bases?: number[] } = {}): Node {
  const me = id(k);
  return room.net.add(
    `n${k}`,
    room.peer(
      (link, mode) => {
        const s = new GameSession({ P, B, net: NET, me, name: `P${k}`, coat: k, build: TEST_BUILD, forwarding: true, mode, verify: o.verify ?? 0 }, link);
        let sample = scriptSampler(o.script ?? 'none', me, 0, P, B);
        s.controls = () => sample(s.timeline.head, s.timeline.headTick);
        s.onControl = (base) => {
          o.bases?.push(base);
          sample = scriptSampler(o.script ?? 'none', me, base, P, B);
        };
        return s;
      },
      (s) => ({ t: s.timeline, host: s.bots }),
    ),
  );
}

const runTo = (room: Room, t: number): void => room.run(t - room.net.now);
const finalOf = (n: Node): Readonly<MatchState> => n.session.timeline.final;
const terrier = (n: Node, who: string): MatchState['terriers'][number] | undefined => finalOf(n).terriers[findTerrier(finalOf(n), who)];
const agree = (nodes: readonly Node[]): void => expectAgreement(nodes.map((n) => ({ t: n.session.timeline })));
/** The run was clean (design §8.3, R-1): the drawn head's contract held on every node, and every chain
 *  a verifying node checked matched a full replay (reviewer S5). */
function expectClean(room: Room): void {
  expect(room.problems).toEqual([]);
  for (const n of room.nodes) expect(n.t.stats.verifyMismatches, `node ${n.k}: ${JSON.stringify(n.t.stats.log.slice(-4))}`).toBe(0);
}
const rosterOf = (n: Node): string[] => finalOf(n).terriers.map((T) => `${T.id}:${T.pack}`).sort();
/** When the node's clock last took the median (design §1.6): its private state, read for a freeze's place. */
const lastRebalance = (n: Node): number => (n.session.timeline as unknown as { ticks: { lastRebalance: number } }).ticks.lastRebalance;

/** n0 proposes and plays in pack A, three players join and play, alternate packs; Ready at 2 s if asked. */
function lobby(room: Room, ready: boolean, bases: number[][] = []): Node[] {
  const net = room.net;
  const nodes: Node[] = [];
  for (let k = 0; k < 4; k++) nodes.push(node(room, k, { script: k === 0 ? 'brain' : 'none', verify: k === 0 ? 8 : 0, bases: (bases[k] ??= []) }));
  net.join(nodes[0]!, 0, (now) => {
    nodes[0]!.session.propose(nodes[0]!.local(now), { packSize: 2, matchMinutes: 1 }, MATCH);
    nodes[0]!.session.play(0);
  });
  for (let k = 1; k < 4; k++) net.join(nodes[k]!, 200 * k, () => nodes[k]!.session.play((k % 2) as Pack));
  if (ready) nodes.forEach((n, k) => net.at(2000 + 50 * k, () => n.session.ready(true)));
  return nodes;
}

describe('stalls (D-31, §4.12, M3-Q9)', () => {
  it('rejoins a page frozen 3 s in play from a peer whose clock ran on, in control again within 30 ticks, its clock in step (roslambo D-23)', () => {
    const room = new NetPump(new LoopbackNet(1, uniform(41, 30, 60, 20)));
    const bases: number[][] = [];
    const nodes = lobby(room, true, bases);
    const frozen = nodes[2]!;
    // It joined at 400 ms, so its timer pings at 10,400: frozen just after, its pongs come back while
    // it sleeps, a freeze's round trip when it wakes.
    room.net.pace(frozen, 10_405, Infinity);
    room.net.pace(frozen, 13_405, NET.timerMs);
    runTo(room, 13_300);
    expect(finalOf(nodes[0]!).phase).toBeGreaterThanOrEqual(IN_PLAY);
    // Away 2 s and more: it sits, in the others' final state (D-16).
    expect(terrier(nodes[0]!, id(2))!.sitting).toBe(true);
    const old: Timeline = frozen.session.timeline;
    // Its JOIN's base, when it joined at the start (D-10).
    expect(bases[2]).toEqual([0]);
    runTo(room, 13_405);
    expect([frozen.session.stalls, frozen.session.stall]).toEqual([1, 'deciding']);
    expect(frozen.session.timeline).toBe(old);
    room.until(() => frozen.session.timeline !== old, 1000);
    // Adopted from a peer, the old timeline kept until then, its clock in step.
    expect(frozen.session.stall).toBe('none');
    expect(Math.abs(frozen.session.timeline.localTick - nodes[0]!.session.timeline.localTick)).toBeLessThanOrEqual(3);
    // In the roster still: control from its terrier's stored previous input, once; and no returning
    // player, which only a page's first timeline makes (reviewer S12).
    expect(bases[2]).toHaveLength(2);
    expect(frozen.session.returning).toBe(false);
    runTo(room, 15_400);
    for (const n of nodes) {
      const T = terrier(n, id(2))!;
      expect(finalOf(n).tick - T.lastInputTick, n.id).toBeLessThan(30);
      expect(T.sitting, n.id).toBe(false);
    }
    runTo(room, 20_000);
    for (const n of nodes) expect([n.session.timeline.stats.jumps, n.session.timeline.stats.resyncs], n.id).toEqual([0, 0]);
    expectClean(room);
    agree(nodes);
  });

  it('removes a page frozen 4 s in warm-up, which JOINs its pack again once it rejoins (roslambo Q-15)', () => {
    const room = new NetPump(new LoopbackNet(2, uniform(42, 30, 60, 20)));
    const bases: number[][] = [];
    const nodes = lobby(room, false, bases);
    const frozen = nodes[1]!;
    room.net.pace(frozen, 4000, Infinity);
    room.net.pace(frozen, 8000, NET.timerMs);
    runTo(room, 7900);
    expect(rosterOf(nodes[0]!)).toEqual([`${id(0)}:0`, `${id(2)}:0`, `${id(3)}:1`].sort());
    expect(bases[1]).toEqual([0]);
    runTo(room, 11_000);
    // Pressed Play before: its pack again, as a new terrier, its counters from 0 (D-10).
    expect(rosterOf(nodes[0]!)).toEqual([`${id(0)}:0`, `${id(1)}:1`, `${id(2)}:0`, `${id(3)}:1`].sort());
    expect(frozen.session.inRoster()).toBe(true);
    expect(bases[1]).toEqual([0, 0]);
    expect(finalOf(nodes[0]!).phase).toBe(WARM_UP);
    expectClean(room);
    agree(nodes);
  });

  it.each(THAWS)('re-anchors every page frozen together, with nobody removed, sitting or rejoining, and every hash equal (thawing %s first)', (thaw) => {
    // Taking its messages first, a page takes those that reached it frozen before its timer sees the
    // stall: no clock samples, though its clock is still running (M3 phase 5).
    const room = new NetPump(new LoopbackNet(3, uniform(43, 30, 60, 20), { thaw }));
    const nodes = lobby(room, true);
    for (const n of nodes) {
      room.net.pace(n, 10_000, Infinity);
      room.net.pace(n, 14_000, NET.timerMs);
    }
    runTo(room, 9_990);
    expect(finalOf(nodes[0]!).phase).toBe(IN_PLAY);
    const timelines = nodes.map((n) => n.session.timeline);
    const rosters = nodes.map(rosterOf);
    const ticks = nodes.map((n) => n.session.timeline.localTick);
    runTo(room, 14_500);
    expect(nodes.map((n) => n.session.stall)).toEqual(nodes.map(() => 'deciding'));
    runTo(room, 18_000);
    expect(nodes.map((n) => n.session.stalls)).toEqual([1, 1, 1, 1]);
    expect(nodes.map((n) => n.session.stall)).toEqual(nodes.map(() => 'none'));
    expect(nodes.map((n) => n.session.timeline)).toEqual(timelines);
    expect(nodes.map(rosterOf)).toEqual(rosters);
    // The gap was skipped: each page went on from its own tick.
    nodes.forEach((n, k) => expect(n.session.timeline.localTick - ticks[k]!, n.id).toBeLessThan(((18_000 - 15_000) / NET.tickMs) + 10));
    for (const n of nodes) {
      for (const T of finalOf(n).terriers) expect(T.sitting, `${n.id} ${T.id}`).toBe(false);
      expect([n.session.timeline.stats.resyncs, n.session.timeline.stats.jumps], n.id).toEqual([0, 0]);
    }
    expectClean(room);
    agree(nodes);
  });

  it('rejoins the pages frozen while one ran on from that one', () => {
    const room = new NetPump(new LoopbackNet(4, uniform(44, 30, 60, 20)));
    const nodes = lobby(room, true);
    const [runner, ...rest] = nodes as [Node, ...Node[]];
    for (const n of rest) {
      room.net.pace(n, 10_000, Infinity);
      room.net.pace(n, 14_000, NET.timerMs);
    }
    runTo(room, 13_900);
    const sent = runner.session.timeline.stats.statesSent;
    const old = rest.map((n) => n.session.timeline);
    runTo(room, 17_000);
    rest.forEach((n, k) => {
      expect(n.session.timeline, n.id).not.toBe(old[k]);
      expect(n.session.stall, n.id).toBe('none');
      expect(n.session.timeline.stats.statesSent, n.id).toBe(0);
    });
    // The one that ran on answered each of them.
    expect(runner.session.timeline.stats.statesSent - sent).toBe(rest.length);
    for (const n of nodes) {
      for (const p of rest) expect(finalOf(n).tick - terrier(n, p.session.cfg.me)!.lastInputTick, `${n.id} ${p.id}`).toBeLessThan(30);
    }
    expectClean(room);
    agree(nodes);
  });

  it("sets no one-way delay from a round trip longer than the stall threshold, a freeze's, not the network's (M3 phase 3's answers)", () => {
    // A keeper's timeline, and a fresh session that joins it through a link played by hand.
    const replies: Uint8Array[] = [];
    const keeper = new Timeline({ ...NET.timeline, P, me: id(0) }, {
      broadcast: () => undefined, sendToPlayer: () => true, sendToPeer: (_p, bytes) => replies.push(bytes),
    });
    keeper.start(0, { packSize: 1, matchMinutes: 1 }, MATCH);
    for (let now = 0; now <= 5000; now += NET.timerMs) keeper.advance(now);
    const asked: Uint8Array[] = [];
    const s = new Session(
      { P, B, net: NET, me: id(1), name: 'P1', coat: 1, build: TEST_BUILD, forwarding: true },
      { send: (_p, bytes) => asked.push(bytes), broadcast: () => undefined },
    );
    const hello: Hello = {
      type: T.HELLO, protocol: PROTOCOL_VERSION, build: TEST_BUILD, player: id(0), role: ROLE.KEEPER, timeline: MATCH,
      timelineKind: TIMELINE_KIND.LIVE, phase: keeper.final.phase, finalTick: keeper.finalTick, hash: keeper.hashAt(keeper.finalTick), name: 'P0',
    };
    expect(s.checkHello(hello, 5000, 'p').ok).toBe(true);
    s.onPeerJoin('p', hello, s.hello(), 5000);
    s.onRtt('p', 80, 5000);
    // A pong the peer held through a freeze: 3 s.
    s.onRtt('p', 3000, 5004);
    s.advance(5004);
    const req = asked.map((b) => decode(b)).find((m) => m?.type === T.STATE_REQ);
    expect(req).toBeDefined();
    expect(keeper.onStateReq('q', req as StateReq, 5004)).toBe(true);
    s.onMessage('p', replies[0]!, 5044);
    expect(s.timeline.started).toBe(true);
    // Its clock from the sender's and the 40 ms one-way delay the 80 ms round trip gave, not 1.5 s.
    expect(Math.abs(s.timeline.clock(5044) - keeper.clock(5044))).toBeLessThan(0.5);
  });

  it.each(THAWS)("takes no one-way delay from a shorter freeze's pong either: a 1.5 s freeze moves nobody's clock (reviewer H6; thawing %s first)", (thaw) => {
    const room = new NetPump(new LoopbackNet(5, () => ({ base: 40, jitter: 0 }), { thaw }));
    const net = room.net;
    const a = node(room, 0, { verify: 8 });
    const b = node(room, 1);
    net.join(a, 0, (now) => {
      a.session.propose(a.local(now), { packSize: 1, matchMinutes: 1 }, MATCH);
      a.session.play(0);
    });
    net.join(b, 200, () => b.session.play(1));
    runTo(room, 9000);
    const before = [a, b].map((n) => ({ ...n.session.timeline.stats }));
    // Under the stall threshold: no stall, and its pong to a comes back a freeze late.
    net.pace(b, 10_020, Infinity);
    net.pace(b, 11_520, NET.timerMs);
    const oneWay: number[] = [];
    const look = (): void => {
      const info = (a.session as unknown as { peers: Map<string, { oneWayMs: number | null }> }).peers.get(b.id);
      if (info?.oneWayMs != null) oneWay.push(info.oneWayMs);
      if (net.now < 15_000) net.at(net.now + 50, look);
    };
    net.at(9000, look);
    runTo(room, 16_000);
    expect(b.session.stalls).toBe(0);
    expect(Math.max(...oneWay)).toBeLessThan(60);
    // a's clock never moved, nor did its inputs come late; b catches up, its newest ticks only, and
    // repairs what it finalised before a's TICKs held at it were handled.
    const after = [a, b].map((n) => n.session.timeline.stats);
    expect([after[0]!.jumps - before[0]!.jumps, after[0]!.resyncs - before[0]!.resyncs, after[0]!.late - before[0]!.late]).toEqual([0, 0, 0]);
    expect(after[1]!.jumps - before[1]!.jumps).toBe(0);
    expectClean(room);
    agree([a, b]);
  });

  it.each(THAWS)('moves no clock at 1 a side after a 1 s freeze in play, and the page that ran on misses none of its own inputs (M3 phase 5; thawing %s first)', (thaw) => {
    // Two people, each the other's one peer (C-10). The frozen page's TICKs held for it are as old as
    // the freeze: as samples they'd jump its clock, and D-15's full jumps would then swap the two
    // clocks each rebalanceMs, the one that ran on skipping its own inputs as it jumped forward. The
    // last freeze, 850 ms, ends 40 ms before the frozen page takes the median: its held TICKs first.
    for (const [seed, start, ms] of [[7, 12_000, 1000], [8, 12_250, 1000], [9, 12_610, 1000], [10, null, 850]] as const) {
      const room = new NetPump(new LoopbackNet(seed, uniform(seed * 5, 30, 60, 20), { thaw }));
      const net = room.net;
      const a = node(room, 0, { script: 'brain', verify: 8 });
      const b = node(room, 1, { script: 'brain' });
      net.join(a, 0, (now) => {
        a.session.propose(a.local(now), { packSize: 1, matchMinutes: 1 }, MATCH);
        a.session.play(0);
      });
      net.join(b, 200, () => b.session.play(1));
      for (const [k, n] of [a, b].entries()) net.at(2000 + 50 * k, () => n.session.ready(true));
      let at = start ?? 12_000;
      if (start === null) {
        runTo(room, at);
        const last = lastRebalance(b);
        room.until(() => lastRebalance(b) !== last, 2 * NET.timeline.clock.rebalanceMs);
        at = lastRebalance(b) + NET.timeline.clock.rebalanceMs - 40 - ms;
      }
      net.pace(b, at, Infinity);
      net.pace(b, at + ms, NET.timerMs);
      runTo(room, at - 10);
      expect(finalOf(a).phase, `seed ${seed}`).toBe(IN_PLAY);
      const before = [a, b].map((n) => ({ ...n.session.timeline.stats }));
      const ta = a.session.timeline;
      let from = ta.finalTick + 1;
      let absent = 0;
      for (let t = at; t < at + 12_000; t += 100) {
        runTo(room, t);
        for (let u = from; u <= ta.finalTick; u++) if (ta.receivedInput(id(0), u) === undefined) absent++;
        from = Math.max(from, ta.finalTick + 1);
      }
      expect(b.session.stalls, `seed ${seed}`).toBe(0);
      const after = [a, b].map((n) => n.session.timeline.stats);
      const label = `seed ${seed}: a ${JSON.stringify(after[0]!.log.slice(-3))}, b ${JSON.stringify(after[1]!.log.slice(-3))}`;
      expect([after[0]!.jumps - before[0]!.jumps, after[1]!.jumps - before[1]!.jumps], label).toEqual([0, 0]);
      // The page that ran on: every one of its own final ticks has its input, and none of b's came late.
      expect([absent, after[0]!.late - before[0]!.late], label).toEqual([0, 0]);
      expectClean(room);
      agree([a, b]);
    }
  });

  it('sends a Leave pressed while a stall decides in the timeline it rejoins, and takes no control there (reviewer S7)', () => {
    const room = new NetPump(new LoopbackNet(6, uniform(46, 30, 60, 10)));
    const net = room.net;
    const nodes = [0, 1, 2].map((k) => node(room, k, { verify: k === 0 ? 8 : 0 }));
    net.join(nodes[0]!, 0, (now) => {
      nodes[0]!.session.propose(nodes[0]!.local(now), { packSize: 2, matchMinutes: 1 }, MATCH);
      nodes[0]!.session.play(0);
    });
    net.join(nodes[1]!, 200, () => nodes[1]!.session.play(1));
    net.join(nodes[2]!, 400, () => nodes[2]!.session.play(0));
    const p = nodes[2]!;
    // Frozen 2.5 s in warm-up: over the 2 s stall, under the 3 s removal.
    net.pace(p, 3000, Infinity);
    net.pace(p, 5500, NET.timerMs);
    let leftAt = -1;
    const press = (): void => {
      if (p.session.stall !== 'none' && leftAt < 0) {
        p.session.leave();
        leftAt = net.now;
      } else if (net.now < 7000) net.at(net.now + 1, press);
    };
    net.at(5500, press);
    runTo(room, 5500);
    const held = p.session.timeline;
    room.until(() => p.session.timeline !== held, 2000);
    expect(leftAt).toBeGreaterThan(0);
    // Rejoined: its LEAVE rides in the new timeline, and nothing of a player's is wanted any more.
    expect(p.session.timeline.eventsInFlight(id(2)) & LEAVE).toBe(LEAVE);
    runTo(room, net.now + 1000);
    expect(nodes.map((n) => findTerrier(finalOf(n), id(2)))).toEqual([-1, -1, -1]);
    expect(finalOf(nodes[0]!).phase).toBe(WARM_UP);
    expect(p.session.timeline.eventsInFlight(id(2)) & JOIN).toBe(0);
    expectClean(room);
    agree(nodes);
  });

  /** A session in the roster alone, three peers connected, as its transport would hand them over. */
  function connected(asked: string[]): { s: Session; now: number } {
    const s = new Session(
      { P, B, net: NET, me: personId(1, 0), name: 'P0', coat: 0, build: TEST_BUILD, forwarding: false },
      { send: (peer, bytes) => (decode(bytes)?.type === T.STATE_REQ ? asked.push(peer) : undefined), broadcast: () => undefined },
    );
    s.propose(0, { packSize: 2, matchMinutes: 1 }, 'a'.repeat(16));
    s.play(0);
    let now = 0;
    for (; now < 1000; now += NET.timerMs) s.advance(now);
    [1, 2, 3].forEach((k) => {
      const hello: Hello = {
        type: T.HELLO, protocol: PROTOCOL_VERSION, build: TEST_BUILD, player: personId(1, k), role: ROLE.PLAYER,
        timeline: ZERO_HASH, timelineKind: TIMELINE_KIND.NONE, phase: 0, finalTick: 0, hash: ZERO_HASH, name: '',
      };
      expect(s.checkHello(hello, now, `p${k}`).ok).toBe(true);
      s.onPeerJoin(`p${k}`, hello, s.hello(), now);
    });
    return { s, now };
  }

  it('asks every peer whose clock ran on, TICKs that came before the stall was seen included, though one asked leaves (reviewers S8, S12)', () => {
    const asked: string[] = [];
    const c = connected(asked);
    const s = c.s;
    let now = c.now + 3000;
    // A 3 s stall, and each peer's TICK from a clock that ran on through it, all before the page's own
    // timer saw the gap: a thawing page may take its messages first.
    const u = s.timeline.localTick + 200;
    for (const p of ['p3', 'p2', 'p1']) s.onMessage(p, encodeTick({ t: u, own: senderInput(new Map([[u, 0]]), u), voteTick: NO_TICK, voteHash: ZERO_HASH, phase: 0, bots: [] }), now);
    s.stalled(now);
    s.advance(now);
    // In ID order, whatever the order they came in.
    const order = ['p1', 'p2', 'p3'].sort((x, y) => (personId(1, Number(x[1])) < personId(1, Number(y[1])) ? -1 : 1));
    expect([s.stall, asked]).toEqual(['rejoining', [order[0]]]);
    // The first asked leaves before answering; the next goes stateRequestRetryMs on, then the last.
    s.onPeerLeave(order[0]!);
    for (const end = now + 2 * NET.room.stateRequestRetryMs + 10; now < end; now += NET.timerMs) s.advance(now);
    expect(asked).toEqual(order);
  });

  it("bases its press counters on the newest input of its own a STATE's records hold past its final tick (D-10, reviewer S12)", () => {
    // A keeper's timeline holds this player in its roster, its last final input a jump counter of 1,
    // and in its records past the final tick an input with the counter at 2: the reloading page's own
    // previous page sent it, and the state will take it.
    const me = id(1);
    const replies: Uint8Array[] = [];
    const keeper = new Timeline({ ...NET.timeline, P, me: id(0) }, { broadcast: () => undefined, sendToPlayer: () => true, sendToPeer: (_p, bytes) => replies.push(bytes) });
    keeper.start(0, { packSize: 1, matchMinutes: 1 }, MATCH);
    const inputs = new Map<number, number>();
    const tick = (t: number, events = 0): Uint8Array => {
      const ev = events === 0 ? [] : [{ back: 0, events, joinPack: 1, coat: 1, name: 'P1' }];
      return encodeTick({ t, own: senderInput(inputs, t, ev), voteTick: NO_TICK, voteHash: ZERO_HASH, phase: 0, bots: [] });
    };
    let now = 0;
    for (; keeper.localTick < 120; now += NET.timerMs) {
      keeper.advance(now);
      const t = keeper.localTick + NET.timeline.delay;
      if (!inputs.has(t)) {
        inputs.set(t, encodeInput({ jump: t > 60 ? 1 : 0 }));
        const m = decode(tick(t, t === 10 ? JOIN : 0));
        if (m?.type === T.TICK) keeper.onTick(me, m, now, true);
      }
    }
    expect(findTerrier(keeper.final, me)).toBeGreaterThanOrEqual(0);
    // Its newest input, past the keeper's final tick: the counter at 2, for the next tick.
    for (const at = keeper.localTick; keeper.localTick === at; now += NET.timerMs) keeper.advance(now);
    const last = keeper.localTick + NET.timeline.delay;
    inputs.set(last, encodeInput({ jump: 2 }));
    const m = decode(tick(last));
    if (m?.type === T.TICK) keeper.onTick(me, m, now, true);
    expect(jumpCount(keeper.final.terriers[findTerrier(keeper.final, me)]!.prevInput)).toBe(1);
    // A fresh page under that player ID asks the keeper, and takes the STATE.
    const bases: number[] = [];
    const asked: Uint8Array[] = [];
    const s = new Session({ P, B, net: NET, me, name: 'P1', coat: 1, build: TEST_BUILD, forwarding: true }, { send: (_p, bytes) => asked.push(bytes), broadcast: () => undefined });
    s.onControl = (base) => bases.push(base);
    const hello: Hello = {
      type: T.HELLO, protocol: PROTOCOL_VERSION, build: TEST_BUILD, player: id(0), role: ROLE.KEEPER, timeline: MATCH,
      timelineKind: TIMELINE_KIND.LIVE, phase: keeper.final.phase, finalTick: keeper.finalTick, hash: keeper.hashAt(keeper.finalTick), name: 'P0',
    };
    expect(s.checkHello(hello, now, 'k').ok).toBe(true);
    s.onPeerJoin('k', hello, s.hello(), now);
    s.advance(now);
    const req = asked.map((b) => decode(b)).find((x) => x?.type === T.STATE_REQ);
    expect(req).toBeDefined();
    expect(keeper.onStateReq('k', req as StateReq, now)).toBe(true);
    s.onMessage('k', replies.at(-1)!, now + 40);
    expect([s.timeline.started, s.returning]).toEqual([true, true]);
    expect(bases.map(jumpCount)).toEqual([2]);
    expect(bases[0]! & ~KEPT_BITS).toBe(0);
  });
});

describe('a clock set off at 1 a side, as a re-anchor can leave two pages (D-15, §4.12; M3 phase 5)', () => {
  // D-15's jump at 1 a side moves half the median (M3 phase 5), so two pages alone with each other that
  // both jump at one rebalance meet rather than cross; the cost is a slower close from a genuine offset.
  // These four took 3.1 to 4.8 s to come within 1.5 ticks, and the phase's review measured 2.3 to 4.9 s
  // over 16 seeds, against 0.6 to 3.4 s with the whole jump; a quarter jump takes 7.5 s here. The bound
  // keeps a later change from slowing it further unseen (review clock-F2).
  const SETTLE_MS = 6000; // not a setting: the bound, over the slowest measured
  const SPREAD_TICKS = 1.5; // not a setting: in step, the review's measure
  it('closes 20 and 120 ticks either way within the bound, with every hash equal', () => {
    for (const [seed, ticks] of [[31, 20], [32, -20], [33, 120], [34, -120]] as const) {
      const room = new NetPump(new LoopbackNet(seed, uniform(seed * 5, 30, 60, 20)));
      const net = room.net;
      const a = node(room, 0, { script: 'brain', verify: 8 });
      const b = node(room, 1, { script: 'brain' });
      net.join(a, 0, (now) => {
        a.session.propose(a.local(now), { packSize: 1, matchMinutes: 1 }, MATCH);
        a.session.play(0);
      });
      net.join(b, 200, () => b.session.play(1));
      for (const [k, n] of [a, b].entries()) net.at(2000 + 50 * k, () => n.session.ready(true));
      const at = 12_000;
      // b's clock, its private TickClock, set off as a re-anchor from another peer's reading would.
      net.at(at, () => {
        const c = (b.session.timeline as unknown as { ticks: { read(now: number): number; set(now: number, at: number): void } }).ticks;
        const now = b.local(net.now);
        c.set(now, c.read(now) + ticks);
      });
      runTo(room, at - 10);
      expect(finalOf(a).phase, `seed ${seed}`).toBe(IN_PLAY);
      let since = -1;
      for (let t = at; t <= at + 2 * SETTLE_MS; t += 20) {
        runTo(room, t);
        const spread = Math.abs(a.session.timeline.clock(a.local(net.now)) - b.session.timeline.clock(b.local(net.now)));
        if (spread > SPREAD_TICKS) since = -1;
        else if (since < 0) since = t;
      }
      const label = `seed ${seed}, ${ticks} ticks: a ${JSON.stringify(a.session.timeline.stats.log.slice(-3))}, b ${JSON.stringify(b.session.timeline.stats.log.slice(-3))}`;
      expect(since, label).toBeGreaterThanOrEqual(at);
      expect(since - at, label).toBeLessThanOrEqual(SETTLE_MS);
      expect([a.session.stalls, b.session.stalls], label).toEqual([0, 0]);
      expectClean(room);
      agree([a, b]);
    }
  });
});
