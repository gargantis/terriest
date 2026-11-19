// The network simulator (design §1.22, §6.2, §8.2): an in-memory room in
// virtual time, for the session tests and the correction measurement.
// roslambo's src/net/loopback.ts, with the design's changes:
// - the handshake runs in two rounds over each link's latency, as
//   TrysteroRoom's does: both HELLOs leave when a pair meets; each side's
//   checkHello runs, with its time and the other's peer ID, as the other's
//   HELLO arrives, and its verdict leaves; each side joins as the other's
//   verdict arrives if both accepted, and otherwise the refusal is recorded
//   and a side that had accepted gets onHandshakeFailed. So a burst's
//   handshakes overlap as Trystero's do, and D-21's reservations are tested
//   where they matter; roslambo's ran both checks and joins in one event.
//   An accepted HELLO's replaces drops the connection it replaces (C-12);
// - pings to each neighbour every pingEveryMs of the pinger's timers, and
//   on joining, as TrysteroRoom's; a frozen page answers none, and each pong
//   is an onRtt, C-12's liveness;
// - a loss chance per link: a lost message on the reliable ordered channel
//   arrives an extra round trip late, its retransmission (§17's "an
//   occasional extra round trip"), and FIFO holds the messages behind it,
//   head-of-line blocking (§8.2);
// - the link's spec read with the time a message leaves; counts by type
//   (D-20's traffic); dropNext and delayNext;
// - each node's link is a Transport (design §6.1): its peer count, the last
//   refusal it received, and leave().
// The handshake's messages and the pings travel each link in order with
// the session's own, but only the session's are counted or matched by
// dropNext and delayNext. A frozen node's timers stop and it answers no
// ping, but messages still reach its session, as roslambo's did. Virtual
// time, a seeded PRNG and a heap of events, so every run repeats exactly.

import { decode, encodeHello, encodeRefuse, REFUSAL, T, type Hello } from '../core/protocol/messages';
import type { Accepted, Refusal, RoomPeer } from '../core/session/room-peer';
import { netSettings } from '../core/session/settings';
import type { Transport } from './transport';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Ev {
  readonly at: number;
  readonly seq: number;
  readonly fn: () => void;
}

const less = (x: Ev, y: Ev): boolean => x.at < y.at || (x.at === y.at && x.seq < y.seq);

class Heap {
  private readonly a: Ev[] = [];

  get size(): number {
    return this.a.length;
  }

  peek(): Ev | undefined {
    return this.a[0];
  }

  push(e: Ev): void {
    const a = this.a;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(a[p]!, a[i]!)) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }

  pop(): Ev {
    const a = this.a;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && less(a[l]!, a[m]!)) m = l;
        if (r < a.length && less(a[r]!, a[m]!)) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

export interface LinkSpec {
  readonly base: number;      // one-way ms
  readonly jitter: number;    // extra ms, uniform in [0, jitter)
  readonly loss?: number;     // the chance a message waits an extra round trip (2·base) on top
}

export interface NodeOptions { readonly clockOffset?: number; readonly drift?: number; readonly pingEveryMs?: number }

export interface LoopNode<S extends RoomPeer = RoomPeer> {
  readonly id: string; readonly session: S;
  paceMs: number;             // between advance() calls: the timer, 1000 for a hidden page, Infinity frozen
  online: boolean;
  local(now: number): number;
  readonly neighbours: Set<string>;
}

/** A node as the net keeps it. */
interface Node extends LoopNode {
  readonly pingEveryMs: number;
  lastPing: number; // local time of its last round of pings
  gen: number; // a join or a leave ends the timers before it
  stopped: boolean; // its timers stopped at an infinite pace, until pace() starts them again
  refusedBy: number | null; // the last refusal it received
}

/** One side of a handshake under way. */
interface Side {
  readonly node: Node;
  readonly sent: Hello; // its HELLO, as it built it
  heard?: Hello; // the other side's, as decoded
  verdict?: Accepted | Refusal; // its check of heard
  done: boolean; // joined, failed or refused
}

interface Handshake {
  readonly key: string;
  readonly sides: readonly [Side, Side];
  over: boolean;
}

interface Rule {
  readonly from: string;
  readonly to: string;
  readonly which: (bytes: Uint8Array) => boolean;
  readonly lose: boolean;
  readonly ms: number;
}

const DEFAULTS = netSettings();
// The loss draws come from a stream of their own, so a lossy run's jitter
// is the loss-free run's.
const LOSS_STREAM = 0x5bd1e995; // not a setting: a seed's mix
const STOP_EVERY_MS = 500; // not a setting: how often run() asks stop(), roslambo's
const frozen = (n: LoopNode): boolean => !Number.isFinite(n.paceMs);

export class LoopbackNet {
  now = 0;
  messages = 0;
  bytes = 0;
  readonly byType = new Map<number, { messages: number; bytes: number }>();
  readonly nodes = new Map<string, LoopNode>();
  /** Each refusal as the refused side received it: from the side that refused. */
  readonly refusals: { from: string; to: string; reason: number }[] = [];
  /** Connections closed with drop(), as [by, peer]: a session's, or a replaced one's (C-12). */
  readonly drops: [string, string][] = [];
  private readonly all = new Map<string, Node>();
  private readonly q = new Heap();
  private seq = 0;
  private readonly rand: () => number;
  private readonly lossRand: () => number;
  private readonly latency: (from: string, to: string, now: number) => LinkSpec;
  private readonly blocked = new Set<string>();
  private readonly handshakes = new Map<string, Handshake>();
  private readonly last = new Map<string, Map<string, number>>(); // by link: its last arrival, for FIFO
  private readonly rules: Rule[] = [];

  /** latency(a, b, now): a link's spec when a message leaves, so a test can slow a link for a while. */
  constructor(seed: number, latency: (from: string, to: string, now: number) => LinkSpec) {
    this.rand = mulberry32(seed);
    this.lossRand = mulberry32(seed ^ LOSS_STREAM);
    this.latency = latency;
  }

  /** Adds a node, offline until join(). `make` builds its room peer around
   *  the link this network provides, which is a Transport too. */
  add<S extends RoomPeer>(id: string, make: (link: Transport) => S, opts: NodeOptions = {}): LoopNode<S> {
    if (this.all.has(id)) throw new Error(`there is a node ${id} already`);
    const offset = opts.clockOffset ?? 0;
    const drift = opts.drift ?? 0;
    const node: Omit<Node, 'session'> & { session: S | undefined } = {
      id,
      session: undefined,
      paceMs: DEFAULTS.timerMs,
      online: false,
      local: (now: number) => now * (1 + drift) + offset,
      neighbours: new Set<string>(),
      pingEveryMs: opts.pingEveryMs ?? DEFAULTS.transport.pingEveryMs,
      lastPing: -Infinity,
      gen: 0,
      stopped: false,
      refusedBy: null,
    };
    const self = node as Node & LoopNode<S>;
    const link: Transport = {
      send: (peer, bytes) => {
        if (self.online && self.neighbours.has(peer)) this.deliver(self, peer, bytes);
      },
      broadcast: (bytes) => {
        if (!self.online) return;
        for (const peer of self.neighbours) this.deliver(self, peer, bytes);
      },
      drop: (peer) => this.dropLink(self, peer),
      peerCount: () => self.neighbours.size,
      get refusedBy() {
        return self.refusedBy;
      },
      leave: () => {
        this.leave(self, this.now);
        return Promise.resolve();
      },
    };
    node.session = make(link);
    this.all.set(id, self);
    this.nodes.set(id, self);
    return self;
  }

  /** The node enters the room at virtual time `at`, and meets every online
   *  node it isn't blocked from about a round trip later, through the relay. */
  join(node: LoopNode, at: number, then?: (now: number) => void): void {
    this.at(at, () => {
      const n = this.node(node);
      if (n.online) return;
      n.online = true;
      n.gen++;
      n.stopped = false;
      n.lastPing = -Infinity;
      for (const other of this.all.values()) {
        if (other === n || !other.online) continue;
        const l = this.latency(n.id, other.id, this.now);
        this.at(this.now + 2 * l.base, () => this.meet(n, other));
      }
      then?.(this.now);
      this.timers(n, n.gen);
    });
  }

  /** The node drops out (a closed tab, a lost network) at virtual time `at`:
   *  its connections close both ways, and its handshakes under way fail. */
  leave(node: LoopNode, at: number): void {
    this.at(at, () => {
      const n = this.node(node);
      if (!n.online) return;
      n.online = false;
      n.gen++;
      for (const hs of [...this.handshakes.values()]) if (hs.sides.some((s) => s.node === n)) this.endHandshake(hs);
      for (const peer of [...n.neighbours]) this.disconnect(n, peer);
      for (const other of this.all.values()) if (other.neighbours.has(n.id)) this.disconnect(other, n.id);
    });
  }

  /** The pair can't connect directly (strict NATs, no TURN). Connections already made stay. */
  block(a: string, b: string): void {
    this.blocked.add(pairKey(a, b));
  }

  /** The pair can connect again, and meets now if both are online. */
  unblock(a: string, b: string): void {
    this.blocked.delete(pairKey(a, b));
    const na = this.all.get(a);
    const nb = this.all.get(b);
    if (na?.online && nb?.online) this.meet(na, nb);
  }

  /** The node's timers run every `ms` from virtual time `at`; Infinity stops them until paced again. */
  pace(node: LoopNode, at: number, ms: number): void {
    this.at(at, () => {
      const n = this.node(node);
      n.paceMs = ms;
      if (Number.isFinite(ms) && n.stopped) {
        n.stopped = false;
        this.timers(n, n.gen);
      }
    });
  }

  /** Loses the next message from `from` to `to` that `which` matches: D-11's lost-and-filled TICK. */
  dropNext(from: string, to: string, which: (bytes: Uint8Array) => boolean): void {
    this.rules.push({ from, to, which, lose: true, ms: 0 });
  }

  /** Holds the next matching message ms longer; FIFO holds those behind it (§8.2's loss, on purpose). */
  delayNext(from: string, to: string, which: (bytes: Uint8Array) => boolean, ms: number): void {
    this.rules.push({ from, to, which, lose: false, ms });
  }

  /** Runs fn at virtual time t, or now if t has passed. */
  at(t: number, fn: () => void): void {
    this.q.push({ at: Math.max(t, this.now), seq: this.seq++, fn });
  }

  /** Runs every event up to `until`; or stops early once stop() holds, which it asks every 500 ms of virtual time. */
  run(until: number, stop?: () => boolean): void {
    let ask = (Math.floor(this.now / STOP_EVERY_MS) + 1) * STOP_EVERY_MS;
    while (this.q.size > 0 && this.q.peek()!.at <= until) {
      const e = this.q.pop();
      this.now = e.at;
      e.fn();
      if (stop && this.now >= ask) {
        ask = (Math.floor(this.now / STOP_EVERY_MS) + 1) * STOP_EVERY_MS;
        if (stop()) return;
      }
    }
    this.now = until;
  }

  private node(n: LoopNode): Node {
    const node = this.all.get(n.id);
    if (node !== n) throw new Error(`${n.id} is no node of this network`);
    return node;
  }

  /** The node's timer: advance now, a round of pings when one is due, then again after its pace. A
   *  ping falls due within half a pace, as an interval timer fires on the run nearest it: so a hidden
   *  page whose clock runs slow still pings on each of its runs a second apart. */
  private timers(n: Node, gen: number): void {
    if (!n.online || n.gen !== gen) return;
    n.session.advance(n.local(this.now));
    if (!n.online || n.gen !== gen) return;
    const local = n.local(this.now);
    const early = Number.isFinite(n.paceMs) ? n.paceMs / 2 : 0;
    if (local - n.lastPing >= n.pingEveryMs - early) {
      n.lastPing = local;
      for (const peer of n.neighbours) this.ping(n, peer);
    }
    if (Number.isFinite(n.paceMs)) this.at(this.now + n.paceMs, () => this.timers(n, gen));
    else n.stopped = true;
  }

  /** A pair finds each other: both HELLOs leave (design §6.2). */
  private meet(a: Node, b: Node): void {
    const key = pairKey(a.id, b.id);
    if (a === b || !a.online || !b.online || this.blocked.has(key) || this.handshakes.has(key)) return;
    if (a.neighbours.has(b.id) || b.neighbours.has(a.id)) return;
    const hs: Handshake = {
      key,
      sides: [
        { node: a, sent: a.session.hello(), done: false },
        { node: b, sent: b.session.hello(), done: false },
      ],
      over: false,
    };
    this.handshakes.set(key, hs);
    for (const [me, other] of [[hs.sides[0], hs.sides[1]], [hs.sides[1], hs.sides[0]]] as const) {
      const bytes = encodeHello(me.sent);
      this.carry(me.node, other.node.id, 0, () => this.heard(hs, other, me, bytes));
    }
  }

  /** A HELLO reaches `me`: its check runs, and its verdict leaves. One that
   *  doesn't decode gets none, and the handshake fails, as TrysteroRoom's. */
  private heard(hs: Handshake, me: Side, other: Side, bytes: Uint8Array): void {
    if (hs.over || me.done) return;
    const m = decode(bytes);
    if (m === null || m.type !== T.HELLO) {
      this.endHandshake(hs);
      return;
    }
    me.heard = m;
    const verdict = me.node.session.checkHello(m, me.node.local(this.now), other.node.id);
    me.verdict = verdict;
    const reply = encodeRefuse(verdict.ok ? REFUSAL.ACCEPTED : verdict.reason);
    this.carry(me.node, other.node.id, 0, () => this.answered(hs, other, me, reply));
  }

  /** The other's verdict reaches `me`, after its HELLO on the same link: `me` joins if both accepted. */
  private answered(hs: Handshake, me: Side, other: Side, bytes: Uint8Array): void {
    if (hs.over || me.done) return;
    const m = decode(bytes);
    const reason = m !== null && m.type === T.REFUSE ? m.reason : -1;
    me.done = true;
    if (reason !== REFUSAL.ACCEPTED) {
      this.refusals.push({ from: other.node.id, to: me.node.id, reason });
      me.node.refusedBy = reason;
    }
    const mine = me.verdict;
    if (mine?.ok && reason === REFUSAL.ACCEPTED) this.connect(me, other.node.id, mine);
    else if (mine?.ok) me.node.session.onHandshakeFailed(other.node.id);
    if (hs.sides.every((s) => s.done)) {
      hs.over = true;
      this.handshakes.delete(hs.key);
    }
  }

  /** One side's join: the connection it replaces goes first (C-12), then a ping, as TrysteroRoom's. */
  private connect(me: Side, peer: string, verdict: Accepted): void {
    const n = me.node;
    if (verdict.replaces !== undefined && verdict.replaces !== peer) this.dropLink(n, verdict.replaces);
    n.neighbours.add(peer);
    n.session.onPeerJoin(peer, me.heard!, me.sent, n.local(this.now));
    if (n.online && n.neighbours.has(peer) && !frozen(n)) this.ping(n, peer);
  }

  /** Ends a handshake under way: each side that had accepted and not yet joined fails. */
  private endHandshake(hs: Handshake): void {
    if (hs.over) return;
    hs.over = true;
    this.handshakes.delete(hs.key);
    for (const [s, other] of [[hs.sides[0], hs.sides[1]], [hs.sides[1], hs.sides[0]]] as const) {
      if (s.done) continue;
      s.done = true;
      if (s.verdict?.ok) s.node.session.onHandshakeFailed(other.node.id);
    }
  }

  /** A connection closed by `n`, which refuses the peer from then on (roslambo §9.4): drop blocks the pair. */
  private dropLink(n: Node, peer: string): void {
    this.drops.push([n.id, peer]);
    const key = pairKey(n.id, peer);
    this.blocked.add(key);
    const hs = this.handshakes.get(key);
    if (hs) this.endHandshake(hs);
    this.disconnect(n, peer);
  }

  /** Closes the connection between n and peer, on each side that had it. */
  private disconnect(n: Node, peer: string): void {
    const other = this.all.get(peer);
    const had = n.neighbours.delete(peer);
    const theyHad = other !== undefined && other.neighbours.delete(n.id);
    if (had) n.session.onPeerLeave(peer);
    if (theyHad) other.session.onPeerLeave(n.id);
  }

  /** A ping from n to peer, answered on arrival unless the peer is frozen; the pong is n's onRtt. */
  private ping(n: Node, peer: string): void {
    const sent = n.local(this.now);
    this.carry(n, peer, 0, () => {
      const p = this.all.get(peer);
      if (p === undefined || !p.online || !p.neighbours.has(n.id) || frozen(p)) return;
      this.carry(p, n.id, 0, () => {
        if (!n.online || !n.neighbours.has(peer)) return;
        const now = n.local(this.now);
        n.session.onRtt(peer, now - sent, now);
      });
    });
  }

  /** A session's message: counted, matched against dropNext and delayNext, and carried. */
  private deliver(from: Node, to: string, bytes: Uint8Array): void {
    this.messages++;
    this.bytes += bytes.length;
    const type = bytes.length > 0 ? bytes[0]! : -1;
    const counts = this.byType.get(type) ?? { messages: 0, bytes: 0 };
    counts.messages++;
    counts.bytes += bytes.length;
    this.byType.set(type, counts);
    const copy = bytes.slice();
    const k = this.rules.findIndex((r) => r.from === from.id && r.to === to && r.which(copy));
    const rule = k < 0 ? undefined : this.rules.splice(k, 1)[0];
    this.carry(from, to, rule?.ms ?? 0, () => {
      const n = this.all.get(to);
      if (n?.online && n.neighbours.has(from.id)) n.session.onMessage(from.id, copy, n.local(this.now));
    }, rule?.lose ?? false);
  }

  /** Carries something over the link from → to: after its latency and
   *  jitter, an extra round trip if it's lost and sent again, `extra` ms
   *  more on purpose, and never before what left ahead of it (FIFO). A
   *  message lost for good holds nothing back. */
  private carry(from: Node, to: string, extra: number, fn: () => void, lost = false): void {
    const l = this.latency(from.id, to, this.now);
    let t = this.now + l.base + this.rand() * l.jitter + extra;
    const loss = l.loss ?? 0;
    if (loss > 0 && this.lossRand() < loss) t += 2 * l.base;
    if (lost) return;
    let links = this.last.get(from.id);
    if (links === undefined) {
      links = new Map();
      this.last.set(from.id, links);
    }
    t = Math.max(t, links.get(to) ?? -Infinity);
    links.set(to, t);
    this.at(t, fn);
  }
}

/** A pair's key, whichever way round. */
function pairKey(a: string, b: string): string {
  return JSON.stringify(a < b ? [a, b] : [b, a]);
}
