// The Trystero transport (PLAN D-18, D-19, D-21; design §1.20, §6.3), and
// the only file that imports Trystero's code. It joins one room, runs the
// two-round handshake (both HELLOs, then both verdicts, so a refused side
// learns why), carries every message on one binary action, pings each peer,
// and hands everything to a RoomPeer. roslambo's src/net/trystero.ts, with
// the design's changes:
// - the room config of src/net/room-config.ts, built by
//   vendor/hermet/room-config.ts, appId and the action 'terriest', no
//   passive rooms, and the handshake timeout and the ping period from
//   TransportSettings;
// - checkHello with the time and the peer ID. A handshake this side
//   accepted that then fails, inside onPeerHandshake (the other side
//   refused, or a receive rejected), through Trystero's onJoinError (a
//   timed-out handshake, by peer ID: handshake.mjs's failPeerHandshake), or
//   with no join handshakeTimeoutMs after the check, calls
//   onHandshakeFailed, so the place it holds is released (D-21);
// - an accepted HELLO that replaces a silent connection drops that one
//   first (C-12);
// - a ping to each peer every pingEveryMs, one at a time, each pong an
//   onRtt with the time (C-12's liveness);
// - every call into the room peer is guarded: whatever it throws never
//   reaches Trystero, whose own handler would log it as an "action handler
//   error" (actions.mjs), and is rethrown on a microtask instead, the page's
//   own uncaught error with its stack, which the e2e guard fails;
// - it leaves the room on pagehide too, beside Trystero's own beforeunload
//   cleanup, so M4's leave prompt may hold beforeunload back (M3-Q20); and
//   in WebKit, at once after, in the page's one pagehide listener, it
//   closes every connection the page's rooms joined, a left room's too, by
//   RTCPeerConnection.close() alone, so a far side sees an abort, which
//   Trystero ignores, rather than WebKit's teardown (pageHidden).
// Nothing imports it statically: src/ui/game.ts loads it with import() when
// a networked match opens, so a normal page never loads Trystero (L238,
// design §1.36).

import { getRelaySockets, joinRoom } from '@trystero-p2p/nostr';
import type { HandshakeReceiver, HandshakeSender, MessageAction, Room } from '@trystero-p2p/nostr';
import { decode, encodeHello, encodeRefuse, REFUSAL, T, type Hello } from '../core/protocol/messages';
import type { RoomPeer } from '../core/session/room-peer';
import type { TransportSettings } from '../core/session/settings';
import { ACTION, roomConfig } from './room-config';
import type { Transport, TransportOptions } from './transport';

/** A handshake this side accepted, from its check to the join or the failure (D-21). */
interface Admission {
  readonly hello: Hello;                 // theirs, as decoded
  readonly sent: Hello;                  // ours
  readonly replaces: string | undefined; // C-12
  passed: boolean;                       // both verdicts said yes
  readonly timer: ReturnType<typeof setTimeout>;
}

const noop = (): void => {};

/** A payload as bytes: an empty one for anything but binary, which no decoder takes. */
function bytesOf(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(0);
}

/** A call into the room peer, which never throws into Trystero: what it
 *  throws is rethrown on a microtask, the page's own uncaught error. */
function guarded<R>(call: () => R): R | undefined {
  try {
    return call();
  } catch (e) {
    queueMicrotask(() => {
      throw e;
    });
    return undefined;
  }
}

/** The page's open rooms, each with its Trystero room, and every connection a room of the page
 *  joined, left rooms' included: what pageHidden leaves and, in WebKit, closes. */
const openRooms = new Map<TrysteroRoom, Room>();
const joinedConnections = new Set<RTCPeerConnection>();

/** A connection a room of the page joined, kept for pageHidden; those closed since go, the list's one bound. */
function remember(connection: RTCPeerConnection | undefined): void {
  for (const c of joinedConnections) if (c.connectionState === 'closed') joinedConnections.delete(c);
  if (connection !== undefined) joinedConnections.add(connection);
}

/** Whether the page runs in WebKit: every WebKit browser, Safari and each one on iOS, names Apple as its
 *  vendor, and no other engine does (Chromium names Google, Firefox nobody). */
function inWebKit(): boolean {
  const vendor: unknown = typeof navigator === 'undefined' ? undefined : navigator.vendor;
  return typeof vendor === 'string' && vendor.startsWith('Apple');
}

/**
 * The page's one pagehide listener: every room adds this same function, and none removes it, so it
 * holds no room and still covers a page whose rooms have all left, Results' Home or Play again's old
 * room, while Trystero keeps their connections idle for 123 s (strategy.mjs, shared-peer.mjs).
 * First it leaves every open room, each leave's synchronous part handing Trystero's leave to every
 * channel (room.mjs, action-wire.mjs). Then, in WebKit and in the same task, it closes every
 * connection the page's rooms joined, and each open room's, by RTCPeerConnection.close() alone: the
 * channels close with it, raising no error here, and the far side gets one SCTP abort, "User-Initiated
 * Abort", which Trystero ignores (peer.mjs). Left to its own teardown, WebKit resets each channel's
 * stream tens of ms before its abort, and a far side that completes the reset with a send of its own
 * caught between ends the channel with an empty data-channel-failure, which Trystero logs as a peer
 * error. Closing the channel first, as Trystero's own destroy does, can too, and Trystero's leave
 * closes nothing for 99 ms, which an unloading page never reaches; so nothing here waits. The other
 * engines' teardowns reset nothing, and closing there would only let the abort overtake the leave,
 * which a WebKit far side that sends between the two logs as a failed send (PLAN D-18). A connection
 * whose handshake is in flight, or failed, which Trystero then keeps idle for 123 s, is in neither and
 * still the teardown's (PLAN D-18's residual).
 */
function pageHidden(): void {
  const rooms = [...openRooms];
  const connections = new Set(joinedConnections);
  for (const [, room] of rooms) for (const c of Object.values(room.getPeers())) connections.add(c);
  joinedConnections.clear();
  for (const [t] of rooms) void t.leave();
  if (!inWebKit()) return;
  for (const c of connections) {
    try {
      c.close();
    } catch {
      // already closed
    }
  }
}

export class TrysteroRoom implements Transport {
  /** The last refusal this side received, for the failure message (PLAN §11). */
  refusedBy: number | null = null;
  private readonly peer: RoomPeer;
  private readonly now: () => number;
  private readonly settings: TransportSettings;
  private readonly room: Room;
  private readonly action: MessageAction<Uint8Array>;
  private readonly admitted = new Map<string, Admission>();
  private readonly peers = new Set<string>(); // joined and not dropped
  private readonly blocked = new Set<string>(); // dropped: refused from then on (roslambo §9.4)
  private readonly pinging = new Set<string>(); // a ping out, its pong not yet back
  private readonly pingTimer: ReturnType<typeof setInterval>;
  private left = false;

  constructor(o: TransportOptions, peer: RoomPeer, now: () => number) {
    this.peer = peer;
    this.now = now;
    this.settings = o.settings;
    const config = roomConfig({ relays: o.relays, ice: o.ice, turn: o.turn, maxReceiveBytes: o.settings.maxReceiveBytes });
    this.room = joinRoom(config, o.matchId, {
      handshakeTimeoutMs: o.settings.handshakeTimeoutMs,
      onPeerHandshake: (id, send, receive) => this.handshake(id, send, receive),
      // A handshake that failed after this side's part, or timed out.
      onJoinError: (e) => this.failed(e.peerId),
    });
    this.action = this.room.makeAction<Uint8Array>(ACTION, { onMessage: (data, ctx) => this.received(ctx.peerId, data) });
    this.room.onPeerJoin = (id) => this.joined(id);
    this.room.onPeerLeave = (id) => this.gone(id);
    this.pingTimer = setInterval(() => {
      for (const id of this.peers) this.ping(id);
    }, o.settings.pingEveryMs);
    openRooms.set(this, this.room);
    // The same function every time, so the page has one listener however many rooms it opens.
    if (typeof addEventListener === 'function') addEventListener('pagehide', pageHidden);
  }

  /** The session's link: one action, to one peer or to all. */
  send(peer: string, bytes: Uint8Array): void {
    if (this.peers.has(peer)) void this.action.send(bytes, { target: peer }).catch(noop);
  }

  broadcast(bytes: Uint8Array): void {
    if (this.peers.size > 0) void this.action.send(bytes, { target: [...this.peers] }).catch(noop);
  }

  /** Closes this peer's connection, and refuses its peer ID from now on
   *  (roslambo §9.4): its page would have to reload to get a new one. A
   *  handshake in flight fails, and a joined connection's leave is reported. */
  drop(peer: string): void {
    if (this.blocked.has(peer)) return;
    this.blocked.add(peer);
    this.failed(peer);
    this.close(peer);
    this.gone(peer);
  }

  peerCount(): number {
    return this.peers.size;
  }

  async leave(): Promise<void> {
    if (!this.left) {
      this.left = true;
      openRooms.delete(this);
      clearInterval(this.pingTimer);
      for (const a of this.admitted.values()) clearTimeout(a.timer);
      this.admitted.clear();
      this.peers.clear();
    }
    await this.room.leave();
  }

  /** "n of m relays reachable", for M4's Settings (PLAN §11). */
  static relayHealth(): { open: number; total: number } {
    const sockets = Object.values(getRelaySockets() as Record<string, WebSocket>);
    return { open: sockets.filter((s) => s.readyState === WebSocket.OPEN).length, total: sockets.length };
  }

  /** Trystero's onPeerHandshake: throwing ends the handshake, and Trystero drops the peer. */
  private async handshake(id: string, send: HandshakeSender, receive: HandshakeReceiver): Promise<void> {
    if (this.left || this.blocked.has(id)) throw new Error('refused: dropped');
    const sent = guarded(() => this.peer.hello());
    if (sent === undefined) throw new Error('no HELLO to send');
    await send(encodeHello(sent));
    const theirs = decode(bytesOf((await receive()).data));
    if (theirs === null || theirs.type !== T.HELLO) throw new Error('no HELLO');
    const verdict = guarded(() => this.peer.checkHello(theirs, this.now(), id));
    if (verdict === undefined) throw new Error('no verdict');
    const admission = verdict.ok ? this.admit(id, theirs, sent, verdict.replaces) : undefined;
    try {
      await send(encodeRefuse(verdict.ok ? REFUSAL.ACCEPTED : verdict.reason));
      // Their verdict before throwing on ours, so ours is out before Trystero drops the peer.
      const answer = decode(bytesOf((await receive()).data));
      // Their refusal is recorded whatever ours says: a build or protocol mismatch, or one ID in two
      // tabs, is refused by both sides, and each shows why (design §1.18, §6.3).
      const refused = answer !== null && answer.type === T.REFUSE && answer.reason !== REFUSAL.ACCEPTED;
      if (refused) this.refusedBy = answer.reason;
      if (!verdict.ok) throw new Error(`refused: ${verdict.reason}`);
      if (answer === null || answer.type !== T.REFUSE) throw new Error('no verdict');
      if (refused) throw new Error(`refused by peer: ${answer.reason}`);
      if (admission !== undefined) admission.passed = true;
    } catch (e) {
      if (admission !== undefined) this.release(id, admission);
      throw e;
    }
  }

  /** Holds an accepted handshake's place until it joins or fails, at most handshakeTimeoutMs. */
  private admit(id: string, hello: Hello, sent: Hello, replaces: string | undefined): Admission {
    // A new handshake from the same peer ID ends the one before it.
    this.failed(id);
    const timer = setTimeout(() => this.release(id, admission), this.settings.handshakeTimeoutMs);
    const admission: Admission = { hello, sent, replaces, passed: false, timer };
    this.admitted.set(id, admission);
    return admission;
  }

  /** An accepted handshake that won't join: its place goes (D-21). Once for each. */
  private release(id: string, which: Admission): void {
    if (this.admitted.get(id) !== which) return;
    this.admitted.delete(id);
    clearTimeout(which.timer);
    guarded(() => this.peer.onHandshakeFailed(id));
  }

  /** The handshake under way with id fails, if this side accepted it. */
  private failed(id: string): void {
    const a = this.admitted.get(id);
    if (a !== undefined) this.release(id, a);
  }

  /** Trystero's onPeerJoin: both sides' handshakes passed. */
  private joined(id: string): void {
    const a = this.admitted.get(id);
    if (a === undefined || !a.passed || this.left || this.blocked.has(id)) {
      // Its place went first: no connection the room peer doesn't know.
      this.close(id);
      return;
    }
    this.admitted.delete(id);
    clearTimeout(a.timer);
    // C-12: the silent connection this HELLO replaces goes first.
    if (a.replaces !== undefined && a.replaces !== id) this.drop(a.replaces);
    this.peers.add(id);
    // Trystero's shared physical connection (room.mjs' getPeers, shared-peer.mjs), for pageHidden.
    remember(this.room.getPeers()[id]);
    guarded(() => this.peer.onPeerJoin(id, a.hello, a.sent, this.now()));
    this.ping(id);
  }

  /** Trystero's onPeerLeave, for a joined connection. */
  private gone(id: string): void {
    this.pinging.delete(id);
    if (this.peers.delete(id)) guarded(() => this.peer.onPeerLeave(id));
  }

  /** The action's handler: only a joined connection's messages reach the room peer. */
  private received(id: string, data: unknown): void {
    if (!this.peers.has(id)) return;
    const bytes = bytesOf(data);
    guarded(() => this.peer.onMessage(id, bytes, this.now()));
  }

  /** A ping, unless one to this peer is still out; its pong is an onRtt. */
  private ping(id: string): void {
    if (this.pinging.has(id) || !this.peers.has(id)) return;
    this.pinging.add(id);
    void this.room.ping(id).then(
      (ms) => {
        this.pinging.delete(id);
        if (this.peers.has(id)) guarded(() => this.peer.onRtt(id, ms, this.now()));
      },
      () => this.pinging.delete(id), // the peer went
    );
  }

  private close(id: string): void {
    try {
      this.room.getPeers()[id]?.close();
    } catch {
      // already closed
    }
  }
}

/** The room for one match: what NetGame.open's import() calls (design §1.24). */
export function openRoom(o: TransportOptions, peer: RoomPeer, now: () => number): Transport {
  return new TrysteroRoom(o, peer, now);
}
