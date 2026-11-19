// The transports' shape (design §1.18, §6.1): what the glue needs of a
// room. Three implement it: TrysteroRoom (src/net/trystero.ts), Practice's
// LocalTransport (src/net/local.ts) and, as its per-node Link, the loopback
// network (src/net/loopback.ts). The session sees only the Link.

import type { Link } from '../core/session/room-peer';
import type { TransportSettings } from '../core/session/settings';

/** What the glue needs of a room: Trystero's, or Practice's local one. */
export interface Transport extends Link {
  peerCount(): number;
  /** The last refusal this side received, a REFUSE reason (PLAN §9), for the failure message. */
  readonly refusedBy: number | null;
  leave(): Promise<void>;
}

/** default: third-party.json's STUN; none: no ICE servers; local: none, and
 *  mDNS host candidates rewritten to loopback, for the end-to-end tests'
 *  specially launched engines alone (PLAN §15, design §6.6). */
export type IceMode = 'default' | 'none' | 'local';

export interface TransportOptions {
  readonly matchId: string;            // the Trystero room ID (REQUIREMENTS "Match ID")
  readonly relays: readonly string[];  // never empty
  readonly ice: IceMode;
  readonly turn?: readonly RTCIceServer[];   // Settings' own TURN server (PLAN §11)
  readonly settings: TransportSettings;
}
