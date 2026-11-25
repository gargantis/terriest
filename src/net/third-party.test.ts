// PLAN §20 and REQUIREMENTS "Stack": third-party.json is the one list of
// external hosts. It drives the room config (src/net/room-config.ts) and
// the dist audit, so it's pinned here: roslambo's six relays and two STUN
// servers, each with who runs it and what it sees (D-18, design §11), and,
// from C-58, Cloudflare's Web Analytics beacon, which Cloudflare's edge adds
// to the page and public/_headers' script-src lets run.

import { describe, expect, it } from 'vitest';
import thirdParty from '../../third-party.json';
import { CURATED_RELAYS, STUN_URLS } from './room-config';

describe('third-party.json', () => {
  it('names exactly the six curated relays, in order, as wss: URLs', () => {
    const relays = thirdParty.filter((e) => e.kind === 'signaling').map((e) => e.url);
    expect(relays).toEqual([
      'wss://relay.damus.io', 'wss://relay.primal.net', 'wss://nos.lol',
      'wss://relay.snort.social', 'wss://nostr-pub.wellorder.net', 'wss://yabu.me/v2',
    ]);
    expect(CURATED_RELAYS).toEqual(relays);
  });

  it('names exactly the two STUN servers and the analytics beacon, and nothing of any other kind', () => {
    const stun = thirdParty.filter((e) => e.kind === 'stun').map((e) => e.url);
    expect(stun).toEqual(['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302']);
    expect(STUN_URLS).toEqual(stun);
    // The room config takes none of it: CURATED_RELAYS and STUN_URLS are pinned above.
    expect(thirdParty.filter((e) => e.kind === 'analytics').map((e) => e.url))
      .toEqual(['https://static.cloudflareinsights.com/beacon.min.js']);
    expect(thirdParty.filter((e) => !['signaling', 'stun', 'analytics'].includes(e.kind))).toEqual([]);
  });

  it('says who runs each host and what it sees, under the host its URL names, each once', () => {
    for (const e of thirdParty) {
      expect(e.operator.length, e.host).toBeGreaterThan(0);
      expect(e.sees.length, e.host).toBeGreaterThan(0);
      expect(e.purpose.length, e.host).toBeGreaterThan(0);
      // A stun: URL has no authority, so its host is what follows the scheme.
      const host = new URL(e.url).hostname || e.url.split(':')[1];
      expect(host, e.url).toBe(e.host);
    }
    expect(new Set(thirdParty.map((e) => e.host)).size).toBe(thirdParty.length);
  });
});
