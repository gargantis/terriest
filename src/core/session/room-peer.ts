// What a transport drives, and the checks every room peer makes (design
// §1.8, §4.3, §6.1; PLAN §8, D-21). TrysteroRoom and the loopback network
// both drive a RoomPeer through the same two-round handshake, and Practice's
// local transport is a Link alone. roslambo's src/core/session/room-peer.ts,
// with the design's changes: checkHello takes the time and the transport's
// peer ID, so an admission holds its place until onPeerJoin or
// onHandshakeFailed (D-21's reservations); onPeerJoin and onRtt take the
// time, for C-12's silence; onHandshakeFailed is new; an accepted HELLO may
// name the silent connection it replaces (C-12); commonRefusal refuses a
// bot's ID, and leaves a connected player's ID to C-12's rule, which the
// session applies; and roslambo's INVALID_LIMIT is the configuration's
// invalidMessagesMax (design §10).

import { isBot } from '../bot/bot-id';
import { PROTOCOL_VERSION, REFUSAL, type Hello } from '../protocol/messages';

export type Refusal = { readonly ok: false; readonly reason: number };
/** replaces: the peer ID of a silent connection this HELLO replaces (C-12). */
export type Accepted = { readonly ok: true; readonly hello: Hello; readonly replaces?: string };

/** What a room peer needs of its transport. */
export interface Link {
  send(peer: string, bytes: Uint8Array): void;
  broadcast(bytes: Uint8Array): void;
  /** Close one connection and refuse its peer ID from then on (roslambo
   *  §9.4). The transport reports the connection's leave, as any other's. */
  drop?(peer: string): void;
}

export interface RoomPeer {
  hello(): Hello;
  /** peer: the transport's ID for the connection, so an admission holds its
   *  place until onPeerJoin or onHandshakeFailed (D-21, design §4.3). */
  checkHello(hello: Hello, now: number, peer: string): Accepted | Refusal;
  /** The handshake completed; sent is the HELLO this side sent. */
  onPeerJoin(peer: string, hello: Hello, sent: Hello, now: number): void;
  /** A handshake this side accepted ended without a join: refused by the
   *  other side, timed out, or the peer went. Idempotent. */
  onHandshakeFailed(peer: string): void;
  onPeerLeave(peer: string): void;
  /** A pong: the connection is alive (C-12), and its round trip. */
  onRtt(peer: string, ms: number, now: number): void;
  onMessage(peer: string, bytes: Uint8Array, now: number): void;
  advance(now: number): void;
}

/** Protocol, build, this browser's own ID, and a bot's ID, which only ever
 *  rides in its host's TICK (D-21; roslambo D-16): a HELLO under a bot's ID
 *  speaks for a bot that has no connection of its own, and its TICKs would
 *  race the host's entries for the same bot and tick (design §4.3). */
export function commonRefusal(hello: Hello, build: string, me: string): Refusal | null {
  if (hello.protocol !== PROTOCOL_VERSION) return { ok: false, reason: REFUSAL.PROTOCOL };
  if (hello.build !== build) return { ok: false, reason: REFUSAL.BUILD };
  if (hello.player === me || isBot(hello.player)) return { ok: false, reason: REFUSAL.DUPLICATE };
  return null;
}
