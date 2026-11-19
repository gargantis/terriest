import { describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import { botId, botIds, personId } from '../core/bot/bot-id';
import { defaultBotParams } from '../core/bot/brain';
import {
  type BotEntry, decode, encodeFwd, encodePeers, encodeState, encodeStateReq, encodeTick, type Hello, type Message, NO_TICK, PROTOCOL_VERSION,
  ROLE, T, type Tick, TIMELINE_KIND, ZERO_HASH,
} from '../core/protocol/messages';
import { commonRefusal, type Accepted, type Refusal, type RoomPeer } from '../core/session/room-peer';
import { Session } from '../core/session/session';
import { netSettings } from '../core/session/settings';
import { defaultParams, findTerrier, JOIN, type Pack } from '../core/sim/index';
import { expectAgreement, inside, NetPump, senderInput, TEST_BUILD } from '../core/timeline/testing';
import { type LinkSpec, LoopbackNet, type LoopNode, mulberry32 } from './loopback';
import type { Transport } from './transport';

// What a peer may say, over the loopback network (PLAN D-19, D-20, D-21;
// M3's design, research/m3/DESIGN.md, §4.10, §5.6, M3-Q10, §8.1, R-18): a
// flood and garbage close their connections, and the transport refuses the
// peer from then on; a forwarder serving three origins isn't a flood; no
// TICK or FWD speaks for this browser or its bots, so none decides their
// final inputs or votes; a FWD only for an origin its sender's PEERS lists
// and this browser has no connection to, and never for a bot; a PEERS over
// the cap, repeated STATE_REQs, an unsolicited STATE and one outside §5.5's
// bounds are invalid; and a forwarder skips a TICK too large for a FWD.

vi.setConfig({ testTimeout: 120_000 });

const NET = netSettings();
const ROOM = NET.room;
const P = defaultParams;
const B = defaultBotParams;
const D = NET.timeline.delay;
const MATCH = '3a173a173a173a17';
const id = (k: number): string => personId(19, k);

type Node = LoopNode<Session>;
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

/** An honest session, its own input a constant step, recording what it sent by tick. */
function node(room: Room, k: number, o: { verify?: number; forwarding?: boolean; sent?: Map<number, number> } = {}): Node {
  const me = id(k);
  return room.net.add(
    `n${k}`,
    room.peer(
      (link, mode) => {
        const s = new Session({ P, B, net: NET, me, name: `P${k}`, coat: k, build: TEST_BUILD, forwarding: o.forwarding ?? true, mode, verify: o.verify ?? 0 }, link);
        s.controls = () => {
          const v = 0x20 | (k & 31);
          o.sent?.set(s.timeline.localTick + D, v);
          return v;
        };
        return s;
      },
      (s) => ({ t: s.timeline, host: s.bots }),
    ),
  );
}

/** A peer of the test's own: it admits whatever commonRefusal passes, claims a timeline if it's given
 *  one, records what reaches it, and sends what the test hands it, each timer run through `each`. */
class Rogue implements RoomPeer {
  readonly got: { peer: string; m: Message | null; size: number }[] = [];
  readonly joined = new Set<string>();
  each: ((now: number) => void) | null = null;
  /** The timeline it claims in its HELLO, and that one's final tick. */
  claim: { timeline: string; finalTick: number } | null = null;

  readonly link: Transport;
  readonly me: string;

  constructor(link: Transport, me: string) {
    this.link = link;
    this.me = me;
  }

  hello(): Hello {
    const c = this.claim;
    return {
      type: T.HELLO, protocol: PROTOCOL_VERSION, build: TEST_BUILD, player: this.me, role: ROLE.UNDECIDED,
      timeline: c?.timeline ?? ZERO_HASH, timelineKind: c ? TIMELINE_KIND.LIVE : TIMELINE_KIND.NONE, phase: 0,
      finalTick: c?.finalTick ?? 0, hash: c ? 'abcdabcdabcdabcd' : ZERO_HASH, name: 'R',
    };
  }

  checkHello(hello: Hello): Accepted | Refusal {
    return commonRefusal(hello, TEST_BUILD, this.me) ?? { ok: true, hello };
  }

  onPeerJoin(peer: string): void {
    this.joined.add(peer);
  }

  onHandshakeFailed(): void {}

  onPeerLeave(peer: string): void {
    this.joined.delete(peer);
  }

  onRtt(): void {}

  onMessage(peer: string, bytes: Uint8Array): void {
    this.got.push({ peer, m: decode(bytes), size: bytes.length });
  }

  advance(now: number): void {
    this.each?.(now);
  }

  of(type: number): Message[] {
    return this.got.filter((g) => g.m?.type === type).map((g) => g.m!);
  }
}

function rogue(room: Room, nodeId: string, me: string): LoopNode<Rogue> {
  return room.net.add(nodeId, (link) => new Rogue(link, me));
}

/** A TICK of the rogue's own input for tick t, with these bots and this vote. */
function tickFor(t: number, input: number, o: { bots?: BotEntry[]; voteTick?: number; voteHash?: string } = {}): Omit<Tick, 'type'> {
  return {
    t, own: senderInput(new Map([[t, input]]), t), voteTick: o.voteTick ?? NO_TICK, voteHash: o.voteHash ?? ZERO_HASH, phase: 0, bots: o.bots ?? [],
  };
}

const runTo = (room: Room, t: number): void => room.run(t - room.net.now);
const agree = (nodes: readonly Node[]): void => expectAgreement(nodes.map((n) => ({ t: n.session.timeline })));
/** The run was clean (design §8.3, R-1): the drawn head's contract held on every node, and every chain
 *  a verifying node checked matched a full replay (reviewer S5). */
function expectClean(room: Room): void {
  expect(room.problems).toEqual([]);
  for (const n of room.nodes) expect(n.t.stats.verifyMismatches, `node ${n.k}: ${JSON.stringify(n.t.stats.log.slice(-4))}`).toBe(0);
}

/** n0 proposes and plays in pack A; n1 joins and plays in B. */
function pair(room: Room, packSize = 2): [Node, Node] {
  const a = node(room, 0, { verify: 8 });
  const b = node(room, 1);
  room.net.join(a, 0, (now) => {
    a.session.propose(a.local(now), { packSize, matchMinutes: 1 }, MATCH);
    a.session.play(0);
  });
  room.net.join(b, 200, () => b.session.play(1 as Pack));
  return [a, b];
}

describe('closing connections that misbehave (roslambo §9.3, §9.4)', () => {
  it('closes a flood of TICKs once the connection is floodMs old, and refuses the peer from then on', () => {
    const room = new NetPump(new LoopbackNet(1, uniform(51, 30, 60, 10)));
    const net = room.net;
    const [a, b] = pair(room);
    const r = rogue(room, 'r', id(9));
    net.join(r, 1000);
    // One TICK of its own every timer run, 4 ms apart: more than floodTicksPerTick a tick.
    r.session.each = () => {
      if (r.session.joined.has('n0')) r.session.link.send('n0', encodeTick(tickFor(a.session.timeline.localTick + D, 0)));
    };
    room.until(() => r.session.joined.has('n0'), 3000);
    const opened = net.now;
    runTo(room, opened + ROOM.floodMs - 100);
    expect(a.session.dropped).toEqual([]);
    runTo(room, opened + ROOM.floodMs + 500);
    expect(a.session.dropped).toEqual(['r']);
    expect(net.drops).toContainEqual(['n0', 'r']);
    // The transport refuses the peer ID from then on: it never connects again.
    net.leave(r, net.now);
    net.join(r, net.now + 100);
    runTo(room, net.now + 1000);
    expect(r.session.joined.has('n0')).toBe(false);
    expect(r.session.joined.has('n1')).toBe(true);
    expectClean(room);
    agree([a, b]);
  });

  it('closes a connection at its invalidMessagesMax-th invalid message, and not before', () => {
    const room = new NetPump(new LoopbackNet(2, uniform(52, 30, 60, 10)));
    const net = room.net;
    const [a, b] = pair(room);
    const r = rogue(room, 'r', id(9));
    net.join(r, 1000);
    room.until(() => r.session.joined.has('n0'), 3000);
    const garbage = [new Uint8Array([0xee]), new Uint8Array([T.TICK, 1, 2]), new Uint8Array([T.PEERS, 200]), new Uint8Array(0)];
    for (let k = 0; k < ROOM.invalidMessagesMax - 1; k++) r.session.link.send('n0', garbage[k % garbage.length]!);
    runTo(room, net.now + 500);
    expect(a.session.dropped).toEqual([]);
    r.session.link.send('n0', garbage[0]!);
    runTo(room, net.now + 500);
    expect(a.session.dropped).toEqual(['r']);
    expectClean(room);
    agree([a, b]);
  });

  it("isn't flooded by a forwarder serving three origins, its FWDs counted for each origin apart (design §4.10)", () => {
    const room = new NetPump(new LoopbackNet(3, uniform(53, 30, 60, 10)));
    const net = room.net;
    const f = node(room, 0, { verify: 8 });
    const origins = [1, 2, 3].map((k) => node(room, k));
    const far = node(room, 4);
    for (const o of origins) net.block(o.id, far.id);
    net.join(f, 0, (now) => {
      f.session.propose(f.local(now), { packSize: 3, matchMinutes: 1 }, MATCH);
      f.session.play(0);
    });
    origins.forEach((o, k) => net.join(o, 200 + 100 * k, () => o.session.play((k % 2) as Pack)));
    net.join(far, 600, () => far.session.play(1));
    // What reaches far from f, its TICKs and FWDs, with when.
    const fromF: { at: number; type: number }[] = [];
    const onMessage = far.session.onMessage.bind(far.session);
    far.session.onMessage = (peer, bytes, now) => {
      if (peer === f.id && (bytes[0] === T.TICK || bytes[0] === T.FWD)) fromF.push({ at: now, type: bytes[0]! });
      onMessage(peer, bytes, now);
    };
    runTo(room, 8000);
    // Over the flood's last window: together, more than one connection's limit; apart, within it.
    const last = fromF.filter((x) => x.at > far.local(net.now) - ROOM.floodMs);
    expect(last.length).toBeGreaterThan(ROOM.floodTicksMax);
    expect(last.filter((x) => x.type === T.TICK).length).toBeLessThanOrEqual(ROOM.floodTicksMax);
    expect(last.filter((x) => x.type === T.FWD).length).toBeGreaterThan(last.filter((x) => x.type === T.TICK).length);
    expect(far.session.dropped).toEqual([]);
    expect(far.session.peerCount()).toBe(1);
    expectClean(room);
    agree([f, ...origins, far]);
  });
});

describe('who may speak for whom (design §4.10, M3-Q10, R-18)', () => {
  it("never lets a TICK or a FWD decide this browser's or its bots' inputs, events or votes", () => {
    const room = new NetPump(new LoopbackNet(4, uniform(54, 30, 60, 10)));
    const net = room.net;
    // a keeps without playing and hosts a bot, so nothing of its own would replace a forged input of
    // its player's; b plays.
    const a = node(room, 0, { verify: 8 });
    const b = node(room, 1);
    net.join(a, 0, (now) => {
      a.session.propose(a.local(now), { packSize: 2, matchMinutes: 1 }, MATCH);
      a.session.addBot(1);
    });
    net.join(b, 200, () => b.session.play(1));
    const bot = botIds(id(0))[0]!;
    // The bot's own inputs, by the tick each is for.
    const botSent = new Map<number, number>();
    runTo(room, 300);
    const t = a.session.timeline;
    const sampler = t.bots.get(bot)!;
    t.bots.set(bot, () => {
      const v = sampler();
      botSent.set(t.localTick + D, v);
      return v;
    });
    const r = rogue(room, 'r', id(9));
    net.join(r, 1000);
    room.until(() => r.session.joined.has('n0'), 3000);
    // It says it's connected to a and its bot.
    r.session.link.send('n0', encodePeers([id(0), bot], ROLE.PLAYER));
    const forged = { inputs: new Set<number>(), votes: new Set<number>() };
    r.session.each = () => {
      if (!r.session.joined.has('n0')) return;
      // Ahead of a's clock, so they land before any input of its own, smaller than any it sends, with
      // a JOIN for a's player, and votes for a final tick a has voted on.
      const u = Math.floor(t.clock(a.local(net.now))) + D + 4;
      const vote = t.finalTick;
      forged.inputs.add(u);
      forged.votes.add(vote);
      const join = [{ back: 0, events: JOIN, joinPack: 0, coat: 0, name: 'Forged' }];
      const lie = { voteTick: vote, voteHash: 'feedfeedfeedfeed' };
      // A TICK of its own carrying a's bot, and FWDs as from a and from a's bot.
      r.session.link.send('n0', encodeTick(tickFor(u, 0x11, { ...lie, bots: [{ id: bot, ...senderInput(new Map([[u, 0]]), u) }] })));
      r.session.link.send('n0', encodeFwd(id(0), encodeTick({ ...tickFor(u, 0, lie), own: senderInput(new Map([[u, 0]]), u, join) })));
      r.session.link.send('n0', encodeFwd(bot, encodeTick(tickFor(u, 0, lie))));
    };
    runTo(room, 1400);
    r.session.each = null;
    expect(forged.inputs.size).toBeGreaterThan(3);
    // Each FWD speaking for a or for a bot was invalid: enough of them closed the connection.
    expect(a.session.dropped).toEqual(['r']);
    runTo(room, 3000);
    // a's player never joined, and has no input at any forged tick; the bot's are its own.
    expect(findTerrier(t.final, id(0))).toBe(-1);
    for (const u of forged.inputs) {
      expect(u, 'a forged tick is final').toBeLessThanOrEqual(t.finalTick);
      expect(t.receivedInput(id(0), u), `a's at ${u}`).toBeUndefined();
      expect(t.receivedInput(bot, u), `the bot's at ${u}`).toBe(botSent.get(u));
    }
    // a's own vote stands at every forged vote tick, and the forged hash is booked for nobody who counts.
    const book = inside(t).book;
    for (const g of forged.votes) {
      expect(book.voters(g, t.hashAt(g), id(9)), `the votes at ${g}`).toContain(id(0));
      expect(book.voters(g, 'feedfeedfeedfeed', id(9)), `the votes at ${g}`).toEqual([]);
    }
    expectClean(room);
    agree([a, b]);
  });

  it('takes a FWD only from a connection whose PEERS lists its origin, for an origin with no connection here', () => {
    const room = new NetPump(new LoopbackNet(5, uniform(55, 30, 60, 10)));
    const net = room.net;
    const [a, b] = pair(room);
    const r = rogue(room, 'r', id(9));
    net.join(r, 1000);
    room.until(() => r.session.joined.has('n0'), 3000);
    const x = id(7); // nobody's connection here
    const fwd = (): void => {
      const u = a.session.timeline.localTick + D;
      r.session.link.send('n0', encodeFwd(x, encodeTick(tickFor(u, 0x2a))));
    };
    fwd();
    runTo(room, net.now + 200);
    const t = a.session.timeline;
    const seen = (): boolean => {
      for (let u = t.finalTick; u <= t.localTick + 2 * D + 2; u++) if (t.receivedInput(x, u) !== undefined) return true;
      return false;
    };
    expect(seen()).toBe(false);
    // Listed, it's taken, as the honour system takes any input (L203), and invalid it isn't.
    r.session.link.send('n0', encodePeers([id(0), x], ROLE.UNDECIDED));
    runTo(room, net.now + 100);
    fwd();
    runTo(room, net.now + 200);
    expect(seen()).toBe(true);
    expect(a.session.dropped).toEqual([]);
    expectClean(room);
    agree([a, b]);
  });

  it('counts each PEERS over the cap as invalid, and takes no origin from one (reviewer T5)', () => {
    const room = new NetPump(new LoopbackNet(6, uniform(56, 30, 60, 10)));
    const net = room.net;
    const [a, b] = pair(room);
    const r = rogue(room, 'r', id(9));
    net.join(r, 1000);
    room.until(() => r.session.joined.has('n0'), 3000);
    const many = Array.from({ length: NET.room.meshPlayersMax + NET.room.spectatorsMax }, (_, k) => id(20 + k));
    for (let k = 0; k < ROOM.invalidMessagesMax - 1; k++) r.session.link.send('n0', encodePeers(many, ROLE.SPECTATOR));
    // A FWD for an origin only the PEERS over the cap listed is no FWD a's PEERS view allows.
    const u = a.session.timeline.localTick + D + 2;
    r.session.link.send('n0', encodeFwd(many[0]!, encodeTick(tickFor(u, 0x2a))));
    runTo(room, net.now + 500);
    expect(a.session.dropped).toEqual([]);
    expect(a.session.timeline.receivedInput(many[0]!, u)).toBeUndefined();
    // The invalidMessagesMax-th closes it.
    r.session.link.send('n0', encodePeers(many, ROLE.SPECTATOR));
    runTo(room, net.now + 500);
    expect(a.session.dropped).toEqual(['r']);
    expectClean(room);
    agree([a, b]);
  });

  it('answers one STATE_REQ per connection per resyncRetryMs, leaving the rest unanswered, never invalid (reviewers S3, H2)', () => {
    const room = new NetPump(new LoopbackNet(9, uniform(59, 30, 60, 10)));
    const net = room.net;
    const [a, b] = pair(room);
    const r = rogue(room, 'r', id(9));
    net.join(r, 1000);
    room.until(() => r.session.joined.has('n0'), 3000);
    // A STATE_REQ every 50 ms for 3 s, as no honest asker sends, but some honest re-asks come sooner
    // than resyncRetryMs, so none counts against the connection.
    let asks = 0;
    const from = net.now;
    r.session.each = (now) => {
      if (now % 50 < NET.timerMs && now - from < 3000 && r.session.joined.has('n0')) {
        r.session.link.send('n0', encodeStateReq(NO_TICK, ZERO_HASH));
        asks++;
      }
    };
    runTo(room, from + 3500);
    r.session.each = null;
    const states = r.session.got.filter((g) => g.m?.type === T.STATE).length;
    expect(asks).toBeGreaterThan(50);
    expect(states).toBeGreaterThanOrEqual(5);
    expect(states).toBeLessThanOrEqual(Math.ceil(3000 / ROOM.resyncRetryMs) + 1);
    expect(a.session.dropped).toEqual([]);
    expect(r.session.joined.has('n0')).toBe(true);
    expectClean(room);
    agree([a, b]);
  });

  it('takes no unsolicited STATE, nor one outside its tick bounds, and joins from the peer it asked', () => {
    // The newcomers' links to the rogue are fast and to the others slow, so the rogue speaks first.
    const fast = new Set(['r|n5', 'r|n6']);
    const base = uniform(57, 30, 60, 10);
    const room = new NetPump(new LoopbackNet(7, (x, y) => (fast.has(x < y ? `${y}|${x}` : `${x}|${y}`) || fast.has(`${x}|${y}`) ? { base: 5, jitter: 0 } : { ...base(x, y), base: 150 })));
    const net = room.net;
    const [a, b] = pair(room);
    const r = rogue(room, 'r', id(9));
    net.join(r, 300);
    room.until(() => r.session.joined.has('n0'), 2000);
    // A real STATE, which a answers the rogue with.
    r.session.link.send('n0', encodeStateReq(NO_TICK, ZERO_HASH));
    room.until(() => r.session.of(T.STATE).length > 0, 2000);
    const real = r.session.of(T.STATE)[0]! as Extract<Message, { type: typeof T.STATE }>;
    const bytes = encodeState(real, real.roster).bytes;
    // The same STATE, its sender's final tick past its clock: outside §5.5's bounds.
    const bad = bytes.slice();
    new DataView(bad.buffer).setUint32(19, real.senderTick + 5, true);
    expect(decode(bad)).toBeNull();
    // A newcomer the rogue hands that STATE unasked, before it holds a timeline.
    const j = node(room, 5);
    net.join(j, net.now + 100);
    let told = false;
    r.session.each = () => {
      if (!told && r.session.joined.has('n5')) {
        told = true;
        r.session.link.send('n5', bytes);
      }
    };
    room.until(() => told, 2000);
    runTo(room, net.now + 50);
    expect(j.session.timeline.started).toBe(false);
    room.until(() => j.session.timeline.started, 3000);
    expect(r.session.of(T.STATE_REQ)).toEqual([]);
    expect(j.session.timeline.id).toBe(MATCH);
    // Another, which the rogue tells it holds the best timeline: asked first, it answers out of bounds.
    r.session.claim = { timeline: 'ffffffffffffffff', finalTick: 0xfffff };
    const k = node(room, 6);
    net.join(k, net.now + 100);
    let answered = false;
    r.session.each = () => {
      if (!answered && r.session.of(T.STATE_REQ).length > 0) {
        answered = true;
        r.session.link.send('n6', bad);
      }
    };
    room.until(() => answered, 3000);
    runTo(room, net.now + 50);
    expect(k.session.timeline.started).toBe(false);
    // The next peer, stateRequestRetryMs on.
    room.until(() => k.session.timeline.started, NET.room.stateRequestRetryMs + 1000);
    expect(k.session.timeline.id).toBe(MATCH);
    r.session.each = null;
    runTo(room, net.now + 2000);
    expect([j.session.dropped, k.session.dropped]).toEqual([[], []]);
    // Unasked STATEs are invalid messages: enough of them close the connection.
    for (let n = 0; n < NET.room.invalidMessagesMax; n++) r.session.link.send('n5', bytes);
    runTo(room, net.now + 500);
    expect(j.session.dropped).toEqual(['r']);
    expectClean(room);
    agree([a, b, j, k]);
  });
});

describe('FWDs (design §4.10, D-19, R-18)', () => {
  /** The rogue's FWDs for origin, n a timer run, while connected to a, PEERS listing it, its input k. */
  function forging(a: Node, r: LoopNode<Rogue>, origin: string, n: number, input: number, net: LoopbackNet): void {
    r.session.each = () => {
      if (!r.session.joined.has('n0')) return;
      const u = Math.floor(a.session.timeline.clock(a.local(net.now))) + D;
      for (let k = 0; k < n; k++) r.session.link.send('n0', encodeFwd(origin, encodeTick(tickFor(u, input))));
    };
  }

  it('closes a connection that floods FWDs for one origin once it is floodMs old, whatever its PEERS lists meanwhile (reviewers T2, H4)', () => {
    const run = (toggle: boolean): { dropped: string[]; at: number } => {
      const room = new NetPump(new LoopbackNet(10, uniform(60, 30, 60, 10)));
      const net = room.net;
      const [a, b] = pair(room);
      const r = rogue(room, 'r', id(9));
      net.join(r, 1000);
      room.until(() => r.session.joined.has('n0'), 3000);
      const opened = net.now;
      const x = id(7); // nobody's connection here
      r.session.link.send('n0', encodePeers([id(0), x], ROLE.UNDECIDED));
      runTo(room, net.now + 100);
      // 4 a timer run, more than floodTicksPerTick a tick for x; a PEERS without x and one with it
      // every 250 ms, if toggling, which never resets x's count.
      forging(a, r, x, 4, 0x2a, net);
      const flood = r.session.each!;
      let last = net.now;
      r.session.each = (now) => {
        flood(now);
        if (toggle && now - last >= 250 && r.session.joined.has('n0')) {
          last = now;
          r.session.link.send('n0', encodePeers([id(0)], ROLE.UNDECIDED));
          r.session.link.send('n0', encodePeers([id(0), x], ROLE.UNDECIDED));
        }
      };
      let at = -1;
      room.until(() => {
        if (at < 0 && a.session.dropped.length > 0) at = net.now;
        return at >= 0 || net.now > opened + 3 * ROOM.floodMs;
      }, 4 * ROOM.floodMs);
      r.session.each = null;
      expectClean(room);
      agree([a, b]);
      return { dropped: a.session.dropped, at: at - opened };
    };
    for (const toggle of [false, true]) {
      const { dropped, at } = run(toggle);
      expect(dropped, `toggling ${toggle}`).toEqual(['r']);
      expect(at, `toggling ${toggle}`).toBeGreaterThanOrEqual(ROOM.floodMs);
      expect(at, `toggling ${toggle}`).toBeLessThan(ROOM.floodMs + 500);
    }
  });

  it("counts a FWD for a bot, another host's, as invalid, and never takes it (reviewer T2)", () => {
    const room = new NetPump(new LoopbackNet(11, uniform(61, 30, 60, 10)));
    const net = room.net;
    const [a, b] = pair(room);
    const r = rogue(room, 'r', id(9));
    net.join(r, 1000);
    room.until(() => r.session.joined.has('n0'), 3000);
    const bot = botId(id(7), 0); // a bot of a host with no connection here
    r.session.link.send('n0', encodePeers([id(0), bot], ROLE.UNDECIDED));
    runTo(room, net.now + 100);
    const ticks: number[] = [];
    for (let k = 0; k < ROOM.invalidMessagesMax - 1; k++) {
      const u = a.session.timeline.localTick + D + 2 + k;
      ticks.push(u);
      r.session.link.send('n0', encodeFwd(bot, encodeTick(tickFor(u, 0x2a))));
    }
    runTo(room, net.now + 400);
    expect(a.session.dropped).toEqual([]);
    for (const u of ticks) expect(a.session.timeline.receivedInput(bot, u), `${u}`).toBeUndefined();
    r.session.link.send('n0', encodeFwd(bot, encodeTick(tickFor(ticks.at(-1)! + 1, 0x2a))));
    runTo(room, net.now + 400);
    expect(a.session.dropped).toEqual(['r']);
    expectClean(room);
    agree([a, b]);
  });

  it('drops, never invalid, a FWD for an origin connected here, whose smaller input never stands for its own (reviewer T2)', () => {
    const room = new NetPump(new LoopbackNet(12, uniform(62, 30, 60, 10)));
    const net = room.net;
    const sent = new Map<number, number>();
    const a = node(room, 0, { verify: 8 });
    const b = node(room, 1, { sent });
    net.join(a, 0, (now) => {
      a.session.propose(a.local(now), { packSize: 2, matchMinutes: 1 }, MATCH);
      a.session.play(0);
    });
    net.join(b, 200, () => b.session.play(1));
    const r = rogue(room, 'r', id(9));
    net.join(r, 1000);
    room.until(() => r.session.joined.has('n0'), 3000);
    r.session.link.send('n0', encodePeers([id(0), id(1)], ROLE.UNDECIDED));
    runTo(room, net.now + 100);
    // b's own input is 0x21; the forged one, 0, would win the store's merge if it were taken.
    const forged = new Set<number>();
    r.session.each = () => {
      if (!r.session.joined.has('n0')) return;
      const u = Math.floor(a.session.timeline.clock(a.local(net.now))) + D;
      forged.add(u);
      r.session.link.send('n0', encodeFwd(id(1), encodeTick(tickFor(u, 0))));
    };
    runTo(room, net.now + 1000);
    r.session.each = null;
    runTo(room, net.now + 500);
    const t = a.session.timeline;
    expect(forged.size).toBeGreaterThan(30);
    for (const u of forged) expect(t.receivedInput(id(1), u), `b's at ${u}`).toBe(sent.get(u));
    expect([a.session.dropped, r.session.joined.has('n0')]).toEqual([[], true]);
    expectClean(room);
    agree([a, b]);
  });

  it('takes FWDs for at most peersMax origins from one connection in any floodMs, however its PEERS rotates them (reviewer H5)', () => {
    const room = new NetPump(new LoopbackNet(13, uniform(63, 30, 60, 10)));
    const net = room.net;
    const [a, b] = pair(room);
    const r = rogue(room, 'r', id(9));
    net.join(r, 1000);
    room.until(() => r.session.joined.has('n0'), 3000);
    // Every timer run, a PEERS of 11 made-up origins and a FWD for each.
    let seq = 1000;
    const from = net.now;
    const t = a.session.timeline;
    r.session.each = () => {
      if (!r.session.joined.has('n0')) return;
      const fresh = Array.from({ length: 11 }, () => personId(77, seq++));
      r.session.link.send('n0', encodePeers(fresh, ROLE.SPECTATOR));
      const u = Math.floor(t.clock(a.local(net.now))) + D;
      for (const x of fresh) r.session.link.send('n0', encodeFwd(x, encodeTick(tickFor(u, 0x2a))));
    };
    runTo(room, from + 5000);
    r.session.each = null;
    const senders = (t as unknown as { senders: ReadonlySet<string> }).senders;
    const madeUp = [...senders].filter((x) => x !== id(0) && x !== id(1));
    expect(seq - 1000).toBeGreaterThan(10_000);
    // peersMax at once, a window of floodMs at a time: 11 for each 2 s and the one under way.
    expect(madeUp.length).toBeLessThanOrEqual(NET.room.meshPlayersMax + NET.room.spectatorsMax - 1 + 11 * Math.ceil(5000 / ROOM.floodMs));
    // A STATE now keeps every record.
    r.session.link.send('n0', encodeStateReq(NO_TICK, ZERO_HASH));
    runTo(room, net.now + 300);
    expect(r.session.got.some((g) => g.m?.type === T.STATE)).toBe(true);
    expect(t.stats.statesTruncated).toBe(0);
    expect(a.session.dropped).toEqual([]);
    expectClean(room);
    agree([a, b]);
  });
});

describe('the merge rule against a HELLO that claims a better timeline (P7, reviewer H1)', () => {
  it('strands nobody: a rogue that claims a timeline nobody holds, and leaves, ends no match', () => {
    const room = new NetPump(new LoopbackNet(14, uniform(64, 30, 60, 10)));
    const net = room.net;
    const [a, b] = pair(room);
    const c = node(room, 2);
    net.join(c, 400, () => c.session.watch());
    const r = rogue(room, 'r', id(9));
    r.session.claim = { timeline: 'ffffffffffffffff', finalTick: 0xfffff };
    runTo(room, 3000);
    net.join(r, 3000);
    // It answers no STATE_REQ, and leaves half a second on.
    net.leave(r, 3500);
    runTo(room, 10_000);
    for (const n of [a, b, c]) {
      expect([n.session.timeline.started, n.session.timeline.id], n.id).toEqual([true, MATCH]);
      expect(n.session.failed(n.local(net.now)), n.id).toBe(false);
    }
    expect([a.session.inRoster(), b.session.inRoster(), c.session.role()]).toEqual([true, true, ROLE.SPECTATOR]);
    // They asked the rogue for its timeline, and played on meanwhile.
    expect(r.session.of(T.STATE_REQ).length).toBe(3);
    for (const n of [a, b]) expect(n.session.timeline.final.terriers.every((T) => !T.sitting), n.id).toBe(true);
    expectClean(room);
    agree([a, b, c]);
  });
});

describe('forwarding (D-19)', () => {
  it("skips a TICK too large for a FWD, so no honest forwarder is closed over another's oversized TICK", () => {
    const room = new NetPump(new LoopbackNet(8, uniform(58, 30, 60, 10)));
    const net = room.net;
    const f = node(room, 0, { verify: 8 });
    const b = node(room, 1);
    const r = rogue(room, 'r', id(9));
    net.block('r', b.id);
    net.join(f, 0, (now) => {
      f.session.propose(f.local(now), { packSize: 1, matchMinutes: 1 }, MATCH);
      f.session.play(0);
    });
    net.join(b, 200, () => b.session.play(1));
    net.join(r, 400);
    room.until(() => r.session.joined.has('n0'), 3000);
    r.session.link.send('n0', encodePeers([f.session.cfg.me], ROLE.UNDECIDED));
    runTo(room, net.now + 500);
    // A TICK for a tick far past any window, so nothing takes its writes: one of 16,000 bytes at
    // most, which the decoder takes, but with a FWD's 17 bytes past the limit.
    const far = (): number => f.session.timeline.localTick + 10 * NET.timeline.inputSpan;
    const name = 'x'.repeat(32);
    const big = (n: number): Uint8Array => {
      const t = far();
      const own = { ...senderInput(new Map(), t), present: 0xffff, events: Array.from({ length: 255 }, (_, k) => ({ back: k, events: JOIN, joinPack: 0, coat: 0, name })) };
      const bot = { id: botId(id(9), 0), ...senderInput(new Map(), t), present: 0xffff, events: Array.from({ length: n }, (_, k) => ({ back: k, events: JOIN, joinPack: 0, coat: 0, name })) };
      return encodeTick({ t, own, voteTick: NO_TICK, voteHash: ZERO_HASH, phase: 0, bots: [bot] });
    };
    const max = config.messageMaxBytes;
    let n = 1;
    while (big(n + 1).length <= max) n++;
    const bytes = big(n);
    // A FWD adds its type byte and the origin's 16 (design §5.4).
    expect(bytes.length).toBeLessThanOrEqual(max);
    expect(encodeFwd(id(9), bytes).length).toBeGreaterThan(max);
    expect(decode(bytes)).not.toBeNull();
    const fromF: { type: number; size: number; origin?: string }[] = [];
    const onMessage = b.session.onMessage.bind(b.session);
    b.session.onMessage = (peer, msg, now) => {
      if (peer === f.id) {
        const m = decode(msg);
        fromF.push({ type: msg[0]!, size: msg.length, ...(m?.type === T.FWD ? { origin: m.origin } : {}) });
      }
      onMessage(peer, msg, now);
    };
    // A small one is forwarded; the large one isn't.
    r.session.link.send('n0', encodeTick(tickFor(far(), 0)));
    r.session.link.send('n0', bytes);
    runTo(room, net.now + 1000);
    const forwarded = fromF.filter((x) => x.origin === id(9));
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]!.size).toBeLessThan(200);
    expect(Math.max(...fromF.map((x) => x.size))).toBeLessThanOrEqual(max);
    expect([f.session.dropped, b.session.dropped]).toEqual([[], []]);
    expectClean(room);
    agree([f, b]);
  });

  it("relays no flood from a connection too young to be closed, so no honest forwarder is closed over another's flood (reviewer H3)", () => {
    const room = new NetPump(new LoopbackNet(15, uniform(65, 30, 60, 10)));
    const net = room.net;
    const [f, b] = pair(room);
    const r = rogue(room, 'r', id(9));
    net.block('r', b.id);
    net.join(r, 3000);
    room.until(() => r.session.joined.has('n0'), 6000);
    // It lists f alone, so f forwards its TICKs to b.
    r.session.link.send('n0', encodePeers([f.session.cfg.me], ROLE.UNDECIDED));
    runTo(room, net.now + 300);
    const fwds: number[] = [];
    const onMessage = b.session.onMessage.bind(b.session);
    b.session.onMessage = (peer, bytes, now) => {
      if (peer === f.id && bytes[0] === T.FWD) {
        const m = decode(bytes);
        if (m?.type === T.FWD && m.origin === id(9)) fwds.push(now);
      }
      onMessage(peer, bytes, now);
    };
    // 5 TICKs a timer run for most of its first floodMs at f: f may not close it yet.
    const start = net.now;
    r.session.each = (now) => {
      if (now - start < ROOM.floodMs - 200 && r.session.joined.has('n0')) {
        for (let k = 0; k < 5; k++) r.session.link.send('n0', encodeTick(tickFor(f.session.timeline.localTick + D, 0)));
      }
    };
    runTo(room, start + ROOM.floodMs + 1000);
    r.session.each = null;
    // f relayed about half the limit, and closed r once it was old enough; b kept f.
    const most = Math.max(0, ...fwds.map((at) => fwds.filter((x) => x > at - ROOM.floodMs && x <= at).length));
    expect(fwds.length).toBeGreaterThan(0);
    expect(most).toBeLessThanOrEqual(ROOM.floodTicksMax / 2 + 1);
    expect([f.session.dropped, b.session.dropped, b.session.peerCount()]).toEqual([['r'], [], 1]);
    expectClean(room);
    agree([f, b]);
  });

  it('takes clock samples from direct TICKs only: a FWD says nothing of its origin\'s clock (design §4.10)', () => {
    const run = (direct: boolean): number => {
      const s = new Session({ P, B, net: NET, me: id(0), name: 'P0', coat: 0, build: TEST_BUILD, forwarding: false }, { send: () => undefined, broadcast: () => undefined });
      s.propose(0, { packSize: 1, matchMinutes: 1 }, MATCH);
      s.play(0);
      const hello = (player: string): Hello => ({
        type: T.HELLO, protocol: PROTOCOL_VERSION, build: TEST_BUILD, player, role: ROLE.PLAYER,
        timeline: ZERO_HASH, timelineKind: TIMELINE_KIND.NONE, phase: 0, finalTick: 0, hash: ZERO_HASH, name: '',
      });
      expect(s.checkHello(hello(id(1)), 0, 'f').ok).toBe(true);
      s.onPeerJoin('f', hello(id(1)), s.hello(), 0);
      const x = id(2); // reached through f alone
      s.onMessage('f', encodePeers([x], ROLE.PLAYER), 0);
      let last = -1;
      for (let now = 0; now <= 4000; now += NET.timerMs) {
        s.advance(now);
        const t = s.timeline;
        if (t.localTick === last) continue;
        last = t.localTick;
        // 100 ticks ahead of this clock, every tick: a clock that far off, if it were a sample.
        const tick = encodeTick(tickFor(t.localTick + 100, 0));
        s.onMessage('f', direct ? tick : encodeFwd(x, tick), now);
      }
      expect(s.dropped).toEqual([]);
      return s.timeline.stats.jumps;
    };
    expect(run(true)).toBeGreaterThan(0);
    expect(run(false)).toBe(0);
  });

  it('drops a message from a connection that never completed its handshake (design §4.10)', () => {
    const s = new Session({ P, B, net: NET, me: id(0), name: 'P0', coat: 0, build: TEST_BUILD, forwarding: true }, { send: () => undefined, broadcast: () => undefined });
    s.propose(0, { packSize: 1, matchMinutes: 1 }, MATCH);
    s.play(0);
    for (let now = 0; now < 500; now += NET.timerMs) s.advance(now);
    const t = s.timeline;
    s.onMessage('stranger', encodeTick(tickFor(t.localTick + D, 0x25)), 500);
    expect(t.receivedInput(id(9), t.localTick + D)).toBeUndefined();
    expect([s.dropped, s.peerCount()]).toEqual([[], 0]);
  });
});
