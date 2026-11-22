// TrysteroRoom (design §1.20, §6.3; D-18, D-21, C-12) against a mocked
// Trystero, which records the room it's asked for and hands the test each
// handshake's send and receive, so nothing reaches a relay: the room config,
// the two-round handshake with the time and the peer ID, the refusal each
// side receives, a place this side accepted released through onJoinError or
// the timeout, a replaced connection dropped before the new one joins, the
// guard around the room peer, pings, and leaving: on pagehide, every open
// room's leave and then, in WebKit and in the same task, every connection the
// page's rooms joined closed, each once, but those closed since, which the
// next join drops from the page's list, and in Chromium and Firefox none,
// through the page's one listener, on Node's own EventTarget as the window,
// its engine by navigator.vendor, and a module loaded afresh for each such
// test, since the page's rooms and connections are the module's. The only file
// besides src/ui/game.ts that loads src/net/trystero.ts, which the lint
// allows because no build bundles it (M3 phase 2's integration).

import { getEventListeners } from 'node:events';
import type { DataPayload, HandshakePayload, JoinError, JoinRoomCallbacks, JoinRoomConfig } from '@trystero-p2p/nostr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decode, encodeHello, encodeRefuse, PROTOCOL_VERSION, REFUSAL, ROLE, T, TIMELINE_KIND, ZERO_HASH, type Hello } from '../core/protocol/messages';
import { commonRefusal, type Accepted, type Refusal, type RoomPeer } from '../core/session/room-peer';
import { netSettings } from '../core/session/settings';
import { roomConfig } from './room-config';
import { openRoom, TrysteroRoom } from './trystero';
import type { TransportOptions } from './transport';

/** A peer's connection as getPeers() hands it over, Trystero's shared physical RTCPeerConnection: one for
 *  each remote peer, whichever rooms joined it. close() writes "close <id>" to the test's log each time it's
 *  called; on one closed already it throws, as no engine does (the spec makes it a no-op), so a test sees
 *  each close stand alone. */
interface FakeConnection {
  connectionState: string;
  close(): void;
}

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
  /** getPeers(): the peers joined and not yet left, as Trystero's activePeerMap holds them. */
  readonly peers: Record<string, FakeConnection>;
  left: boolean;
}

/** The rooms made, the test's one log of closes and leaves, and each remote peer's connection. */
const fake = vi.hoisted(() => ({ rooms: [] as FakeRoom[], log: [] as string[], connections: {} as Record<string, FakeConnection> }));

vi.mock('@trystero-p2p/nostr', () => {
  const connectionOf = (id: string): FakeConnection => {
    const log = fake.log; // this test's, whenever it's closed
    const c: FakeConnection = {
      connectionState: 'connected',
      close: () => {
        log.push(`close ${id}`);
        if (c.connectionState === 'closed') throw new Error(`${id}'s connection closed twice`);
        c.connectionState = 'closed';
      },
    };
    return c;
  };
  return {
    getRelaySockets: () => ({ a: { readyState: 1 }, b: { readyState: 3 } }),
    joinRoom: (config: JoinRoomConfig, roomId: string, callbacks: JoinRoomCallbacks) => {
      const r: FakeRoom = {
        config, roomId, callbacks, action: [], onPeerJoin: null, onPeerLeave: null, onMessage: null, sent: [], pings: [],
        pong: () => Promise.resolve(42), peers: {}, left: false,
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
        // As Trystero's: a peer is active before onPeerJoin hears of it, and inactive before onPeerLeave does.
        set onPeerJoin(f: (id: string) => void) {
          r.onPeerJoin = (id) => {
            r.peers[id] = fake.connections[id] ??= connectionOf(id);
            f(id);
          };
        },
        set onPeerLeave(f: (id: string) => void) {
          r.onPeerLeave = (id) => {
            delete r.peers[id];
            f(id);
          };
        },
        ping: (id: string) => {
          r.pings.push(id);
          return r.pong(id);
        },
        getPeers: () => ({ ...r.peers }),
        // Trystero's leave is one promise however often it's called (room.mjs).
        leave: () => {
          if (!r.left) fake.log.push(`leave ${roomId}`);
          r.left = true;
          return Promise.resolve();
        },
      };
    },
  };
});

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
const room = (peer: RoomPeer, Room: typeof TrysteroRoom = TrysteroRoom, matchId = OPTIONS.matchId): TrysteroRoom => {
  const r = new Room({ ...OPTIONS, matchId }, peer, () => now);
  made.push(r);
  return r;
};

/** src/net/trystero.ts loaded afresh, its page-wide state new: the open rooms, the connections they joined and
 *  the one pagehide listener, which a module keeps from one test to the next. */
async function freshModule(): Promise<typeof TrysteroRoom> {
  vi.resetModules();
  return (await import('./trystero')).TrysteroRoom;
}

/** Each engine's navigator.vendor, as the gate's engines report it. */
const VENDOR = { webkit: 'Apple Computer, Inc.', chromium: 'Google Inc.', firefox: '' } as const;

/** The window for the page's listeners: Node's own EventTarget, whose listeners are kept as the DOM keeps
 *  them, once for each type and function, never a hand-made fake; and the page's engine, by its vendor,
 *  WebKit's unless another is named. */
function pageWindow(vendor: string = VENDOR.webkit): EventTarget {
  const w = new EventTarget();
  vi.stubGlobal('addEventListener', w.addEventListener.bind(w));
  vi.stubGlobal('removeEventListener', w.removeEventListener.bind(w));
  vi.stubGlobal('navigator', { vendor });
  return w;
}

/** The page's pagehide, as the browser fires it when the page goes. */
const pageHides = (w: EventTarget): boolean => w.dispatchEvent(new Event('pagehide'));

/** Each id's handshake accepted both ways in r, then its join. */
async function joinAll(r: FakeRoom, ids: readonly string[]): Promise<void> {
  for (const [k, id] of ids.entries()) {
    const x = remote([encodeHello(new Peer(player(k + 1)).hello()), encodeRefuse(REFUSAL.ACCEPTED)]);
    await r.callbacks.onPeerHandshake!(id, x.send, x.receive, true);
    r.onPeerJoin!(id);
  }
}

beforeEach(() => {
  fake.rooms.length = 0;
  fake.log = [];
  fake.connections = {};
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
    expect([p.of('failed'), p.of('join'), fake.log, t.peerCount()]).toEqual([['failed p1', 'failed p2'], [], ['close p2'], 0]);
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
    expect([fake.log, t.peerCount()]).toEqual([['close old'], 1]);
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

  it('drops a peer: its connection closed, its leave reported once, its ID refused', async () => {
    const p = new Peer(player(0));
    const t = room(p);
    const r = fake.rooms[0]!;
    await joinAll(r, ['p1']);
    t.drop('p1');
    t.drop('p1');
    r.onPeerLeave!('p1');
    expect([p.of('leave'), fake.log, t.peerCount()]).toEqual([['leave p1'], ['close p1'], 0]);
  });
});

describe("the page's pagehide: its rooms left, then their connections closed at once (src/net/trystero.ts' pageHidden)", () => {
  it('leaves the room, then closes each connection it joined, each once, in the listener itself; its pings stop', async () => {
    const Room = await freshModule();
    const w = pageWindow();
    room(new Peer(player(0)), Room);
    const r = fake.rooms[0]!;
    await joinAll(r, ['p1', 'p2']);
    expect(fake.log).toEqual([]);
    pageHides(w);
    // No timer advanced, no microtask run: the leave's synchronous part, then the closes, in one task.
    expect(fake.log).toEqual(['leave room-1', 'close p1', 'close p2']);
    const pings = r.pings.length;
    await vi.advanceTimersByTimeAsync(5 * NET.transport.pingEveryMs);
    expect([r.pings.length, fake.log.length]).toEqual([pings, 3]);
  });

  it("leaves both rooms of Play again's overlap before closing any connection, a connection they share closed once", async () => {
    const Room = await freshModule();
    const w = pageWindow();
    room(new Peer(player(0)), Room);
    room(new Peer(player(0)), Room, 'room-2'); // the next match's, its old room still open for leaveGraceMs
    const [old, next] = [fake.rooms[0]!, fake.rooms[1]!];
    await joinAll(old, ['p1', 'p2']);
    await joinAll(next, ['p1', 'p3']); // p1's connection is the one both rooms ride, as Trystero shares it
    pageHides(w);
    expect(fake.log.slice(0, 2).sort(), 'the leaves, first').toEqual(['leave room-1', 'leave room-2']);
    expect(fake.log.slice(2).sort(), 'then the closes, each once').toEqual(['close p1', 'close p2', 'close p3']);
  });

  it("closes a left room's connections too and a dropped peer's again, harmlessly; a second pagehide closes nothing", async () => {
    const Room = await freshModule();
    const w = pageWindow();
    const home = room(new Peer(player(0)), Room); // left, as Results' Home leaves it: Trystero keeps its connections idle
    const open = room(new Peer(player(0)), Room, 'room-2');
    const [left, r] = [fake.rooms[0]!, fake.rooms[1]!];
    await joinAll(left, ['p1']);
    await home.leave();
    await joinAll(r, ['p2', 'p3']);
    open.drop('p2'); // closed by the drop, and still among the room's peers, as Trystero hears nothing of a local close
    expect(fake.log).toEqual(['leave room-1', 'close p2']);
    pageHides(w);
    // p2's second close throws in the fake, and p3's still follows it.
    expect(fake.log).toEqual(['leave room-1', 'close p2', 'leave room-2', 'close p1', 'close p2', 'close p3']);
    pageHides(w);
    expect(fake.log).toHaveLength(6);
  });

  it("drops a connection Trystero closed from the page's list at the next join, the list's one bound: pagehide never closes it", async () => {
    const Room = await freshModule();
    const w = pageWindow();
    room(new Peer(player(0)), Room);
    const r = fake.rooms[0]!;
    await joinAll(r, ['p1']);
    // Trystero ends p1, as when its far side goes: its own destroy closes the connection, set here so the
    // log holds only the page's closes, and then the room reports p1 gone.
    fake.connections.p1!.connectionState = 'closed';
    r.onPeerLeave!('p1');
    await joinAll(r, ['p2']);
    pageHides(w);
    expect(fake.log).toEqual(['leave room-1', 'close p2']);
  });

  it.each([['Chromium', VENDOR.chromium], ['Firefox', VENDOR.firefox]])(
    'in %s leaves every room and closes nothing: its own teardown resets no stream, and a far side takes the leave first',
    async (_, vendor) => {
      const Room = await freshModule();
      const w = pageWindow(vendor);
      const home = room(new Peer(player(0)), Room);
      room(new Peer(player(0)), Room, 'room-2');
      await joinAll(fake.rooms[0]!, ['p1']);
      await home.leave();
      await joinAll(fake.rooms[1]!, ['p2', 'p3']);
      pageHides(w);
      expect(fake.log).toEqual(['leave room-1', 'leave room-2']);
      expect(Object.values(fake.connections).map((c) => c.connectionState)).toEqual(['connected', 'connected', 'connected']);
    },
  );

  it('is one listener on the page however many rooms open, which no leave removes', async () => {
    const Room = await freshModule();
    const w = pageWindow();
    const rooms = ['room-1', 'room-2', 'room-3'].map((id) => room(new Peer(player(0)), Room, id));
    expect(getEventListeners(w, 'pagehide')).toHaveLength(1);
    for (const t of rooms) await t.leave();
    expect(getEventListeners(w, 'pagehide')).toHaveLength(1);
  });
});
