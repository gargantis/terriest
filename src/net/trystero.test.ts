// TrysteroRoom (design §1.20, §6.3; D-18, D-21, C-12) against a mocked
// Trystero, which records the room it's asked for and hands the test each
// handshake's send and receive, so nothing reaches a relay: the room config,
// the two-round handshake with the time and the peer ID, the refusal each
// side receives, a place this side accepted released through onJoinError or
// the timeout, a replaced connection dropped before the new one joins, the
// guard around the room peer, pings, and leaving. The only file besides
// src/ui/game.ts that loads src/net/trystero.ts, which the lint allows
// because no build bundles it (M3 phase 2's integration).

import type { DataPayload, HandshakePayload, JoinError, JoinRoomCallbacks, JoinRoomConfig } from '@trystero-p2p/nostr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decode, encodeHello, encodeRefuse, PROTOCOL_VERSION, REFUSAL, ROLE, T, TIMELINE_KIND, ZERO_HASH, type Hello } from '../core/protocol/messages';
import { commonRefusal, type Accepted, type Refusal, type RoomPeer } from '../core/session/room-peer';
import { netSettings } from '../core/session/settings';
import { roomConfig } from './room-config';
import { openRoom, TrysteroRoom } from './trystero';
import type { TransportOptions } from './transport';

/** The room the mock made for one joinRoom call. */
interface FakeRoom {
  readonly config: JoinRoomConfig;
  readonly roomId: string;
  readonly callbacks: JoinRoomCallbacks;
  readonly action: string[];
  onPeerJoin: ((id: string) => void) | null;
  onPeerLeave: ((id: string) => void) | null;
  onMessage: ((data: unknown, ctx: { peerId: string }) => void) | null;
  readonly sent: { data: unknown; target: unknown }[];
  readonly pings: string[];
  pong: (id: string) => Promise<number>;
  readonly closed: string[];
  left: boolean;
}

const fake = vi.hoisted(() => ({ rooms: [] as FakeRoom[] }));

vi.mock('@trystero-p2p/nostr', () => ({
  getRelaySockets: () => ({ a: { readyState: 1 }, b: { readyState: 3 } }),
  joinRoom: (config: JoinRoomConfig, roomId: string, callbacks: JoinRoomCallbacks) => {
    const r: FakeRoom = {
      config, roomId, callbacks, action: [], onPeerJoin: null, onPeerLeave: null, onMessage: null, sent: [], pings: [],
      pong: () => Promise.resolve(42), closed: [], left: false,
    };
    fake.rooms.push(r);
    return {
      makeAction: (name: string, o: { onMessage: (data: unknown, ctx: { peerId: string }) => void }) => {
        r.action.push(name);
        r.onMessage = o.onMessage;
        return {
          send: (data: unknown, opts?: { target?: unknown }) => {
            r.sent.push({ data, target: opts?.target });
            return Promise.resolve();
          },
        };
      },
      set onPeerJoin(f: (id: string) => void) {
        r.onPeerJoin = f;
      },
      set onPeerLeave(f: (id: string) => void) {
        r.onPeerLeave = f;
      },
      ping: (id: string) => {
        r.pings.push(id);
        return r.pong(id);
      },
      getPeers: () => new Proxy({}, { get: (_t, id) => ({ close: () => r.closed.push(String(id)) }) }),
      leave: () => {
        r.left = true;
        return Promise.resolve();
      },
    };
  },
}));

const NET = netSettings();
const BUILD = '0123456789abcdef';
const OTHER_BUILD = 'fedcba9876543210';
const player = (k: number): string => (k + 1).toString(16).padStart(32, '0');
const OPTIONS: TransportOptions = { matchId: 'room-1', relays: ['ws://127.0.0.1:1'], ice: 'local', settings: NET.transport };

/** A room peer that records what the transport calls, refusing by commonRefusal, or by verdict. */
class Peer implements RoomPeer {
  readonly calls: string[] = [];
  readonly me: string;
  readonly build: string;
  verdict: ((h: Hello) => Accepted | Refusal) | null = null;
  throwOn: string | null = null;

  constructor(me: string, build = BUILD) {
    this.me = me;
    this.build = build;
  }

  hello(): Hello {
    return {
      type: T.HELLO, protocol: PROTOCOL_VERSION, build: this.build, player: this.me, role: ROLE.UNDECIDED,
      timeline: ZERO_HASH, timelineKind: TIMELINE_KIND.NONE, phase: 0, finalTick: 0, hash: ZERO_HASH, name: 'P',
    };
  }

  checkHello(hello: Hello, now: number, peer: string): Accepted | Refusal {
    this.calls.push(`check ${peer} ${now}`);
    if (this.throwOn === 'check') throw new Error('check went wrong');
    return this.verdict?.(hello) ?? commonRefusal(hello, this.build, this.me) ?? { ok: true, hello };
  }

  onPeerJoin(peer: string, hello: Hello, sent: Hello, now: number): void {
    this.calls.push(`join ${peer} ${hello.player === this.me ? 'self' : 'other'} ${sent.player === this.me ? 'mine' : '?'} ${now}`);
  }

  onHandshakeFailed(peer: string): void {
    this.calls.push(`failed ${peer}`);
  }

  onPeerLeave(peer: string): void {
    this.calls.push(`leave ${peer}`);
  }

  onRtt(peer: string, ms: number, now: number): void {
    this.calls.push(`rtt ${peer} ${ms} ${now}`);
  }

  onMessage(peer: string, bytes: Uint8Array, now: number): void {
    this.calls.push(`message ${peer} ${bytes.length} ${now}`);
    if (this.throwOn === 'message') throw new Error('message went wrong');
  }

  advance(): void {}

  of(what: string): string[] {
    return this.calls.filter((c) => c.startsWith(`${what} `));
  }
}

/** A remote side whose part of a handshake is scripted: what receive() hands over, in order. */
function remote(answers: readonly Uint8Array[]): { sent: Message[]; send: (d: DataPayload) => Promise<void>; receive: () => Promise<HandshakePayload> } {
  const sent: Message[] = [];
  const queue = [...answers];
  return {
    sent,
    send: (d) => {
      sent.push(decode(d as Uint8Array));
      return Promise.resolve();
    },
    receive: () => {
      const data = queue.shift();
      return data === undefined ? Promise.reject(new Error('peer disconnected during handshake')) : Promise.resolve({ data });
    },
  };
}
type Message = ReturnType<typeof decode>;

/** One side's receive queue, which the other side's send fills. */
class Pipe {
  private readonly items: HandshakePayload[] = [];
  private readonly waiting: ((p: HandshakePayload) => void)[] = [];

  push(p: HandshakePayload): void {
    const w = this.waiting.shift();
    if (w) w(p);
    else this.items.push(p);
  }

  receive = (): Promise<HandshakePayload> => {
    const p = this.items.shift();
    return p ? Promise.resolve(p) : new Promise((res) => this.waiting.push(res));
  };
}

/** Two rooms' handshakes run against each other, as Trystero runs them; then each joins if both passed,
 *  or hears its handshake failed. Each side's outcome: 'ok', or the error it threw. */
async function meet(a: FakeRoom, ida: string, b: FakeRoom, idb: string): Promise<[string, string]> {
  const [toA, toB] = [new Pipe(), new Pipe()];
  const outcome = (p: Promise<void>): Promise<string> => p.then(() => 'ok', (e: Error) => e.message);
  const [x, y] = await Promise.all([
    outcome(a.callbacks.onPeerHandshake!(idb, async (data) => toB.push({ data }), toA.receive, true)),
    outcome(b.callbacks.onPeerHandshake!(ida, async (data) => toA.push({ data }), toB.receive, false)),
  ]);
  const failed = (peerId: string, error: string): JoinError => ({ peerId, error, appId: 'terriest', roomId: 'room-1' });
  if (x !== 'ok') a.callbacks.onJoinError?.(failed(idb, x));
  if (y !== 'ok') b.callbacks.onJoinError?.(failed(ida, y));
  if (x === 'ok' && y === 'ok') {
    a.onPeerJoin?.(idb);
    b.onPeerJoin?.(ida);
  }
  return [x, y];
}

const made: TrysteroRoom[] = [];
let now = 1000;
const room = (peer: RoomPeer): TrysteroRoom => {
  const r = new TrysteroRoom(OPTIONS, peer, () => now);
  made.push(r);
  return r;
};

beforeEach(() => {
  fake.rooms.length = 0;
  now = 1000;
  vi.useFakeTimers();
});

afterEach(async () => {
  for (const r of made) await r.leave();
  made.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('TrysteroRoom (design §6.3)', () => {
  it("joins one room with room-config's literal, the transport's settings and the action 'terriest'", () => {
    const t = openRoom(OPTIONS, new Peer(player(0)), () => now);
    made.push(t as TrysteroRoom);
    expect(t).toBeInstanceOf(TrysteroRoom);
    const r = fake.rooms[0]!;
    expect([r.roomId, r.action, r.callbacks.handshakeTimeoutMs]).toEqual(['room-1', ['terriest'], NET.transport.handshakeTimeoutMs]);
    expect(r.config).toEqual(roomConfig({ relays: OPTIONS.relays, ice: 'local', maxReceiveBytes: NET.transport.maxReceiveBytes }));
    expect([t.peerCount(), t.refusedBy, TrysteroRoom.relayHealth()]).toEqual([0, null, { open: 1, total: 2 }]);
  });

  it('runs the two-round handshake: its HELLO, the check with the time and peer ID, its verdict, then the join and a ping', async () => {
    const p = new Peer(player(0));
    const t = room(p);
    const r = fake.rooms[0]!;
    const x = remote([encodeHello(new Peer(player(1)).hello()), encodeRefuse(REFUSAL.ACCEPTED)]);
    await r.callbacks.onPeerHandshake!('p1', x.send, x.receive, true);
    expect(x.sent).toEqual([p.hello(), { type: T.REFUSE, reason: REFUSAL.ACCEPTED }]);
    expect(p.calls).toEqual(['check p1 1000']);
    now = 1100;
    r.onPeerJoin!('p1');
    expect([p.of('join'), t.peerCount()]).toEqual([['join p1 other mine 1100'], 1]);
    await vi.advanceTimersByTimeAsync(0);
    expect([r.pings, p.of('rtt')]).toEqual([['p1'], ['rtt p1 42 1100']]);
    // Then every pingEveryMs, one at a time: a pong still out holds the next ping back.
    r.pong = () => new Promise(() => {});
    await vi.advanceTimersByTimeAsync(NET.transport.pingEveryMs);
    await vi.advanceTimersByTimeAsync(NET.transport.pingEveryMs);
    expect(r.pings).toEqual(['p1', 'p1']);
  });

  it('records the refusal each side receives, whichever refused: a build mismatch is refused both ways', async () => {
    const [pa, pb] = [new Peer(player(0)), new Peer(player(1), OTHER_BUILD)];
    const [a, b] = [room(pa), room(pb)];
    const outcome = await meet(fake.rooms[0]!, 'tA', fake.rooms[1]!, 'tB');
    expect(outcome).toEqual([`refused: ${REFUSAL.BUILD}`, `refused: ${REFUSAL.BUILD}`]);
    expect([a.refusedBy, b.refusedBy]).toEqual([REFUSAL.BUILD, REFUSAL.BUILD]);
    // Neither accepted, so neither held a place to release.
    expect([pa.of('failed'), pb.of('failed'), a.peerCount(), b.peerCount()]).toEqual([[], [], 0, 0]);
  });

  it('a one-sided refusal: the refused side records it and releases the place it held, once', async () => {
    const [pa, pb] = [new Peer(player(0)), new Peer(player(1))];
    pb.verdict = () => ({ ok: false, reason: REFUSAL.SPECTATORS_FULL });
    const [a, b] = [room(pa), room(pb)];
    const outcome = await meet(fake.rooms[0]!, 'tA', fake.rooms[1]!, 'tB');
    expect(outcome).toEqual([`refused by peer: ${REFUSAL.SPECTATORS_FULL}`, `refused: ${REFUSAL.SPECTATORS_FULL}`]);
    expect([a.refusedBy, b.refusedBy]).toEqual([REFUSAL.SPECTATORS_FULL, null]);
    // Released in the handshake, and onJoinError's report after it changes nothing.
    expect([pa.of('failed'), pb.of('failed')]).toEqual([['failed tB'], []]);
  });

  it('releases a place it accepted through onJoinError, or after handshakeTimeoutMs with no join, once; a late join is closed', async () => {
    const p = new Peer(player(0));
    const t = room(p);
    const r = fake.rooms[0]!;
    for (const id of ['p1', 'p2']) {
      const x = remote([encodeHello(new Peer(player(1)).hello()), encodeRefuse(REFUSAL.ACCEPTED)]);
      await r.callbacks.onPeerHandshake!(id, x.send, x.receive, true);
    }
    // Trystero reports p1's handshake timed out after this side's part.
    r.callbacks.onJoinError!({ peerId: 'p1', error: 'handshake timed out', appId: 'terriest', roomId: 'room-1' });
    expect(p.of('failed')).toEqual(['failed p1']);
    // p2 never joins, and Trystero says nothing: its place goes after handshakeTimeoutMs.
    await vi.advanceTimersByTimeAsync(NET.transport.handshakeTimeoutMs - 1);
    expect(p.of('failed')).toEqual(['failed p1']);
    await vi.advanceTimersByTimeAsync(1);
    expect(p.of('failed')).toEqual(['failed p1', 'failed p2']);
    r.callbacks.onJoinError!({ peerId: 'p2', error: 'late', appId: 'terriest', roomId: 'room-1' });
    r.onPeerJoin!('p2');
    expect([p.of('failed'), p.of('join'), r.closed, t.peerCount()]).toEqual([['failed p1', 'failed p2'], [], ['p2'], 0]);
  });

  it('releases a place it accepted when a receive rejects after its check, and checks nothing that is no HELLO', async () => {
    const p = new Peer(player(0));
    room(p);
    const r = fake.rooms[0]!;
    const gone = remote([encodeHello(new Peer(player(1)).hello())]);
    await expect(r.callbacks.onPeerHandshake!('p1', gone.send, gone.receive, true)).rejects.toThrow('disconnected');
    const garbage = remote([Uint8Array.of(0xff)]);
    await expect(r.callbacks.onPeerHandshake!('p2', garbage.send, garbage.receive, true)).rejects.toThrow('no HELLO');
    expect(p.calls).toEqual(['check p1 1000', 'failed p1']);
  });

  it('drops the connection a HELLO replaces before reporting the new one (C-12), and refuses that peer ID from then on', async () => {
    const p = new Peer(player(0));
    const t = room(p);
    const r = fake.rooms[0]!;
    const join = async (id: string): Promise<void> => {
      const x = remote([encodeHello(new Peer(player(7)).hello()), encodeRefuse(REFUSAL.ACCEPTED)]);
      await r.callbacks.onPeerHandshake!(id, x.send, x.receive, true);
      r.onPeerJoin!(id);
    };
    await join('old');
    p.verdict = (hello) => ({ ok: true, hello, replaces: 'old' });
    await join('new');
    expect(p.calls.filter((c) => c.startsWith('leave') || c.startsWith('join')).map((c) => c.split(' ').slice(0, 2).join(' '))).toEqual([
      'join old', 'leave old', 'join new',
    ]);
    expect([r.closed, t.peerCount()]).toEqual([['old'], 1]);
    const again = remote([encodeHello(new Peer(player(7)).hello()), encodeRefuse(REFUSAL.ACCEPTED)]);
    await expect(r.callbacks.onPeerHandshake!('old', again.send, again.receive, true)).rejects.toThrow('dropped');
    r.onMessage!(Uint8Array.of(T.PEERS), { peerId: 'old' });
    expect(p.of('message')).toEqual([]);
  });

  it("keeps what the room peer throws out of Trystero's handlers, rethrowing it on a microtask", async () => {
    const thrown: (() => void)[] = [];
    vi.stubGlobal('queueMicrotask', (f: () => void) => thrown.push(f));
    const p = new Peer(player(0));
    room(p);
    const r = fake.rooms[0]!;
    const x = remote([encodeHello(new Peer(player(1)).hello()), encodeRefuse(REFUSAL.ACCEPTED)]);
    await r.callbacks.onPeerHandshake!('p1', x.send, x.receive, true);
    r.onPeerJoin!('p1');
    p.throwOn = 'message';
    expect(() => r.onMessage!(Uint8Array.of(T.PEERS), { peerId: 'p1' })).not.toThrow();
    p.throwOn = 'check';
    const y = remote([encodeHello(new Peer(player(2)).hello()), encodeRefuse(REFUSAL.ACCEPTED)]);
    await expect(r.callbacks.onPeerHandshake!('p2', y.send, y.receive, true)).rejects.toThrow('no verdict');
    expect(thrown).toHaveLength(2);
    expect(thrown[0]!).toThrow('message went wrong');
    expect(thrown[1]!).toThrow('check went wrong');
  });

  it("passes on only joined peers' messages, a non-binary one as empty bytes, and sends only to joined peers", async () => {
    const p = new Peer(player(0));
    const t = room(p);
    const r = fake.rooms[0]!;
    const x = remote([encodeHello(new Peer(player(1)).hello()), encodeRefuse(REFUSAL.ACCEPTED)]);
    await r.callbacks.onPeerHandshake!('p1', x.send, x.receive, true);
    t.broadcast(Uint8Array.of(1));
    r.onPeerJoin!('p1');
    r.onMessage!(Uint8Array.of(1, 2, 3), { peerId: 'p1' });
    r.onMessage!(Uint8Array.of(1, 2), { peerId: 'stranger' });
    r.onMessage!('text', { peerId: 'p1' });
    expect(p.of('message')).toEqual(['message p1 3 1000', 'message p1 0 1000']);
    t.send('p1', Uint8Array.of(9));
    t.send('stranger', Uint8Array.of(9));
    t.broadcast(Uint8Array.of(8));
    expect(r.sent.map((s) => s.target)).toEqual(['p1', ['p1']]);
    // A leave reported once, and nothing goes to the peer after it.
    r.onPeerLeave!('p1');
    r.onPeerLeave!('p1');
    t.broadcast(Uint8Array.of(8));
    expect([p.of('leave'), r.sent.length, t.peerCount()]).toEqual([['leave p1'], 2, 0]);
  });

  it('drops a peer: its connection closed, its leave reported once, its ID refused; and leaves on pagehide, its pings stopped', async () => {
    const listeners = new Map<string, () => void>();
    vi.stubGlobal('addEventListener', (type: string, f: () => void) => listeners.set(type, f));
    vi.stubGlobal('removeEventListener', (type: string) => listeners.delete(type));
    const p = new Peer(player(0));
    const t = room(p);
    const r = fake.rooms[0]!;
    const x = remote([encodeHello(new Peer(player(1)).hello()), encodeRefuse(REFUSAL.ACCEPTED)]);
    await r.callbacks.onPeerHandshake!('p1', x.send, x.receive, true);
    r.onPeerJoin!('p1');
    t.drop('p1');
    t.drop('p1');
    r.onPeerLeave!('p1');
    expect([p.of('leave'), r.closed, t.peerCount()]).toEqual([['leave p1'], ['p1'], 0]);
    expect([...listeners.keys()]).toEqual(['pagehide']);
    listeners.get('pagehide')!();
    await vi.advanceTimersByTimeAsync(0);
    expect([r.left, [...listeners.keys()]]).toEqual([true, []]);
    const pings = r.pings.length;
    await vi.advanceTimersByTimeAsync(5 * NET.transport.pingEveryMs);
    expect(r.pings).toHaveLength(pings);
  });
});
