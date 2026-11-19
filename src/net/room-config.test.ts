// The room config (PLAN D-18, §20; design §1.19, §6.3, §8.1): exactly the
// relays given, the curated ones by default, and exactly third-party.json's
// STUN servers; iceServers always set, so Trystero adds no STUN servers of
// its own; an empty relay list refused; only 'local' rewriting mDNS; no
// passive rooms. And dev:local's relay URL (design §1.29), the page's one
// relay under the dev server.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { netSettings } from '../core/session/settings';
import { ACTION, APP_ID, CURATED_RELAYS, roomConfig, STUN_URLS } from './room-config';

const RELAYS = [
  'wss://relay.damus.io', 'wss://relay.primal.net', 'wss://nos.lol',
  'wss://relay.snort.social', 'wss://nostr-pub.wellorder.net', 'wss://yabu.me/v2',
];
const STUN = ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'];
const MAX = netSettings().transport.maxReceiveBytes;
const base = { relays: CURATED_RELAYS, ice: 'default', maxReceiveBytes: MAX } as const;
const TURN = { urls: 'turn:turn.example.test:3478', username: 'u', credential: 'c' };

describe('the room config (D-18)', () => {
  it('passes exactly the curated relays and STUN servers by default, under the keys Trystero reads', () => {
    expect(CURATED_RELAYS).toEqual(RELAYS);
    expect(STUN_URLS).toEqual(STUN);
    expect(roomConfig(base)).toEqual({
      appId: 'terriest',
      relayConfig: { urls: RELAYS },
      rtcConfig: { iceServers: [{ urls: STUN }] },
      maxReceiveBytes: MAX,
      passive: false,
    });
    expect(MAX).toBe(1024 * 1024);
    expect(APP_ID).toBe('terriest');
    expect(ACTION).toBe('terriest');
  });

  it('takes the relays it is given in their place: a local relay alone, for the tests', () => {
    const local = 'ws://127.0.0.1:4567';
    expect(roomConfig({ ...base, relays: [local] }).relayConfig?.urls).toEqual([local]);
    expect(roomConfig({ ...base, relays: [...CURATED_RELAYS, 'wss://mine.example.test'] }).relayConfig?.urls).toEqual([...RELAYS, 'wss://mine.example.test']);
  });

  it('always sets iceServers: STUN only for default, none for none and local, and TURN after them', () => {
    expect(roomConfig({ ...base, ice: 'none' }).rtcConfig).toEqual({ iceServers: [] });
    expect(roomConfig({ ...base, ice: 'local' }).rtcConfig).toEqual({ iceServers: [] });
    expect(roomConfig({ ...base, turn: [TURN] }).rtcConfig?.iceServers).toEqual([{ urls: STUN }, TURN]);
    expect(roomConfig({ ...base, ice: 'none', turn: [TURN] }).rtcConfig?.iceServers).toEqual([TURN]);
    expect(roomConfig({ ...base, ice: 'local', turn: [TURN] }).rtcConfig?.iceServers).toEqual([TURN]);
  });

  it('rewrites mDNS host candidates to loopback for local alone, and makes no passive room', () => {
    expect(roomConfig({ ...base, ice: 'local' })._test_only_mdnsHostFallbackToLoopback).toBe(true);
    for (const ice of ['default', 'none'] as const) {
      expect(Object.keys(roomConfig({ ...base, ice }))).not.toContain('_test_only_mdnsHostFallbackToLoopback');
    }
    for (const ice of ['default', 'none', 'local'] as const) expect(roomConfig({ ...base, ice }).passive).toBe(false);
  });

  it('refuses an empty relay list, which would meet no one, or fall back to the library’s own', () => {
    expect(() => roomConfig({ ...base, relays: [] })).toThrow();
  });

  it("copies what it's given, so a caller's later change reaches no room", () => {
    const relays = ['wss://relay.example.test'];
    const turn = [{ urls: 'turn:t.example.test:3478' }];
    const c = roomConfig({ ...base, relays, turn });
    relays.push('wss://other.example.test');
    turn.push({ urls: 'turn:u.example.test:3478' });
    expect(c.relayConfig?.urls).toEqual(['wss://relay.example.test']);
    expect(c.rtcConfig?.iceServers).toEqual([{ urls: STUN }, { urls: 'turn:t.example.test:3478' }]);
  });
});

describe("dev:local's relay (design §1.29, §6.6)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  // Loaded as the page loads it, with import(): never statically (design §1.36).
  const relay = async (hostname: string): Promise<string | null> => (await import('./dev-relay')).devRelay(hostname);

  it("is ws:// on the page's own host name at the port dev-local.mjs hands Vite", async () => {
    vi.stubEnv('VITE_TERRIEST_LOCAL_RELAY_PORT', '4567');
    expect(await relay('localhost')).toBe('ws://localhost:4567');
    expect(await relay('127.0.0.1')).toBe('ws://127.0.0.1:4567');
    expect(await relay('[::1]')).toBe('ws://[::1]:4567');
    expect(await relay('::1')).toBe('ws://[::1]:4567');
  });

  it("is null outside dev:local, and for a port or a host name that isn't one", async () => {
    vi.stubEnv('VITE_TERRIEST_LOCAL_RELAY_PORT', undefined);
    expect(await relay('localhost')).toBeNull();
    for (const port of ['', '0', '65536', '4567x', '-1', '04567']) {
      vi.stubEnv('VITE_TERRIEST_LOCAL_RELAY_PORT', port);
      expect(await relay('localhost'), port).toBeNull();
    }
    vi.stubEnv('VITE_TERRIEST_LOCAL_RELAY_PORT', '4567');
    for (const host of ['', 'evil.test/x', 'a@b', 'host name']) expect(await relay(host), host).toBeNull();
  });
});
