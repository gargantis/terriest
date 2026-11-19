// The exact config handed to Trystero's joinRoom (PLAN D-18, §20; design
// §1.19, §6.3): roslambo's src/net/room-config.ts, built by the shared
// vendor/hermet/room-config.ts from the hosts third-party.json declares, as
// a literal typed against the library's own JoinRoomConfig. So a misspelt or
// renamed key is a compile error, where an untyped spread would be silently
// ignored: that is how amorfus once ran on the library's default relays
// (CLAUDE.md). The relays are never empty and iceServers is always set, so
// Trystero adds neither relays nor STUN servers of its own. Type-only
// imports of Trystero: src/net/trystero.ts stays its one runtime importer.

import type { JoinRoomConfig } from '@trystero-p2p/nostr';
import thirdParty from '../../third-party.json';
import { declaredUrls, roomConfig as sharedRoomConfig } from '../../vendor/hermet/room-config';
import type { IceMode } from './transport';

export const APP_ID = 'terriest';
export const ACTION = 'terriest'; // not a setting: the one Trystero action (D-18)
export const CURATED_RELAYS: string[] = declaredUrls(thirdParty, 'signaling');
export const STUN_URLS: string[] = declaredUrls(thirdParty, 'stun');

export interface RoomConfigOptions {
  readonly relays: readonly string[];
  readonly ice: IceMode;
  readonly turn?: readonly RTCIceServer[] | undefined;
  readonly maxReceiveBytes: number;
}

export function roomConfig(o: RoomConfigOptions): JoinRoomConfig {
  return sharedRoomConfig({
    appId: APP_ID,
    relays: o.relays,
    // third-party.json's STUN servers only for 'default'; Settings' TURN
    // after them in every mode, as roslambo's (PLAN §11).
    iceServers: [...(o.ice === 'default' ? [{ urls: [...STUN_URLS] }] : []), ...(o.turn ?? [])],
    maxReceiveBytes: o.maxReceiveBytes,
    passive: false, // no passive rooms (D-18)
    // The end-to-end tests' engines on one machine only (PLAN §15).
    loopbackMdns: o.ice === 'local',
  });
}
