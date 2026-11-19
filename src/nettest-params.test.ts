import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { config } from './config';
import { BOT_SLOTS, personId } from './core/bot/bot-id';
import { CURATED_RELAYS } from './net/room-config';
import { acceptedRelay, type NetParams, parseNetParams } from './nettest-params';

// The #test=net page's parameters and relays (M3's design, research/m3/
// DESIGN.md, §1.26, §6.7, §7.2; PLAN §16): every parameter read, with its
// default; a production build refusing a foreign wss: relay and taking a
// curated or a loopback one, by the parsed URL's parts; a dev build taking
// any ws: or wss: relay, or none for npm run dev:local's; a malformed %
// escape reported, never thrown; Practice taking no room, relay, ICE, role,
// pack or bots; and a typo or a repeat refused rather than ignored.

const ROOM = 'K7QM2XDP4TR8WHZN3VBCK'; // not a setting: a match ID (C-15)
const LOCAL = 'ws://127.0.0.1:41234'; // not a setting: a local relay's address
const FOREIGN = 'wss://relay.example';

const net = (rest: string, dev = false): ReturnType<typeof parseNetParams> => parseNetParams(`#test=net&room=${ROOM}&${rest}`, dev);
const params = (r: ReturnType<typeof parseNetParams>): NetParams => {
  if ('error' in r) throw new Error(`expected parameters, got: ${r.error}`);
  return r;
};
const error = (r: ReturnType<typeof parseNetParams>): string => {
  if (!('error' in r)) throw new Error(`expected an error, got ${JSON.stringify(r)}`);
  return r.error;
};
const relayParam = (url: string): string => `relay=${encodeURIComponent(url)}`;

describe("the #test=net page's parameters (§7.2)", () => {
  it('reads every parameter of a networked page', () => {
    const p = params(
      net(`${relayParam(LOCAL)}&ice=none&k=3&seed=11&role=keeper&pack=1&packSize=4&minutes=2&bots=0,1,1&ready=600&script=back&name=Rex&coat=5`),
    );
    expect(p).toEqual({
      mode: 'net', room: ROOM, relay: LOCAL, ice: 'none', k: 3, seed: 11, me: personId(11, 3), role: 'keeper', pack: 1,
      packSize: 4, minutes: 2, bots: [0, 1, 1], ready: 600, script: 'back', name: 'Rex', coat: 5,
    });
  });

  it("takes its defaults: player ID personId(7, 0), the configuration's genesis, ICE local beside a relay, P<k> and k's coat", () => {
    const p = params(net(`${relayParam(LOCAL)}&pack=0&k=9`));
    expect(p).toMatchObject({
      ice: 'local', k: 9, seed: 7, me: personId(7, 9), role: 'player', pack: 0, packSize: config.packSizeDefault,
      minutes: config.matchLengthDefaultMinutes, bots: [], ready: null, script: 'none', name: 'P9', coat: 9 % config.coatCount,
    });
    // A keeper without a pack watches; a room ID is read as normalizeMatchId reads it.
    expect(params(net(`${relayParam(LOCAL)}&role=keeper`)).pack).toBeNull();
    expect(params(parseNetParams(`#test=net&room=k7qm-2xdp-4tr8-whzn-3vbc-k&${relayParam(LOCAL)}&pack=0`, false)).room).toBe(ROOM);
    expect(params(net(`${relayParam(LOCAL)}&role=spectator`))).toMatchObject({ role: 'spectator', pack: null });
  });

  it('reports a missing or bad room, and a malformed % escape, without throwing', () => {
    expect(error(parseNetParams(`#test=net&${relayParam(LOCAL)}&pack=0`, false))).toMatch(/^room: /);
    expect(error(parseNetParams(`#test=net&room=K7QM2XDP4TR8WHZN3VBCX&${relayParam(LOCAL)}&pack=0`, false))).toMatch(/^room: not a match ID/);
    expect(() => parseNetParams('#test=net&room=%', false)).not.toThrow();
    expect(error(parseNetParams('#test=net&room=%', false))).toMatch(/^room: not a match ID/);
    expect(error(parseNetParams('#test=net&room=%E0%A4%A', true))).toMatch(/^room: /);
  });

  it('refuses a parameter it takes not, one given twice, and a fragment of another page', () => {
    expect(error(net(`${relayParam(LOCAL)}&pack=0&reday=600`))).toMatch(/^reday: this page takes no such parameter/);
    expect(error(net(`${relayParam(LOCAL)}&pack=0&pack=1`))).toMatch(/^pack: given more than once/);
    expect(error(parseNetParams(`#test=determinism&room=${ROOM}&${relayParam(LOCAL)}&pack=0`, false))).toMatch(/^test: /);
  });

  it('holds a role to its pack: a player plays in one, a spectator in none', () => {
    expect(error(net(relayParam(LOCAL)))).toMatch(/^pack: a player plays/);
    expect(error(net(`${relayParam(LOCAL)}&role=spectator&pack=0`))).toMatch(/^pack: a spectator/);
    expect(error(net(`${relayParam(LOCAL)}&role=host&pack=0`))).toMatch(/^role: one of keeper, player, spectator/);
    expect(error(net(`${relayParam(LOCAL)}&pack=2`))).toMatch(/^pack: a pack is 0 or 1/);
  });

  it('takes bots as packs, at most a browser hosts, and none from an empty list', () => {
    expect(params(net(`${relayParam(LOCAL)}&role=spectator&bots=1,0`)).bots).toEqual([1, 0]);
    expect(params(net(`${relayParam(LOCAL)}&pack=0&bots=`)).bots).toEqual([]);
    expect(error(net(`${relayParam(LOCAL)}&pack=0&bots=0,2`))).toMatch(/^bots: a pack is 0 or 1/);
    expect(error(net(`${relayParam(LOCAL)}&pack=0&bots=0,,1`))).toMatch(/^bots: /);
    const full = new Array<string>(BOT_SLOTS).fill('0').join(',');
    expect(params(net(`${relayParam(LOCAL)}&pack=0&bots=${full}`)).bots).toHaveLength(BOT_SLOTS);
    expect(error(net(`${relayParam(LOCAL)}&pack=0&bots=${full},1`))).toMatch(/^bots: a browser hosts at most/);
  });

  it('reads whole numbers only, each within its range', () => {
    for (const k of ['01', '1e3', ' 1', '-1', '1.5', '0x10', '', '4294967296']) {
      expect(error(net(`${relayParam(LOCAL)}&pack=0&k=${encodeURIComponent(k)}`)), k).toMatch(/^k: a whole number/);
    }
    expect(params(net(`${relayParam(LOCAL)}&pack=0&k=4294967295`)).me).toBe(personId(7, 4294967295));
    expect(error(net(`${relayParam(LOCAL)}&pack=0&packSize=${config.packSizeMax + 1}`))).toMatch(/^packSize: /);
    expect(error(net(`${relayParam(LOCAL)}&pack=0&packSize=0`))).toMatch(/^packSize: /);
    expect(error(net(`${relayParam(LOCAL)}&pack=0&minutes=${config.matchLengthMaxMinutes + 1}`))).toMatch(/^minutes: /);
    expect(error(net(`${relayParam(LOCAL)}&pack=0&coat=${config.coatCount}`))).toMatch(/^coat: /);
    expect(params(net(`${relayParam(LOCAL)}&pack=0&ready=0`)).ready).toBe(0);
    expect(error(net(`${relayParam(LOCAL)}&pack=0&ready=soon`))).toMatch(/^ready: /);
    expect(error(net(`${relayParam(LOCAL)}&pack=0&script=dance`))).toMatch(/^script: one of none, back, sideways, brain/);
    expect(error(net(`${relayParam(LOCAL)}&pack=0&ice=turn`))).toMatch(/^ice: one of default, none, local/);
    expect(error(net(`${relayParam(LOCAL)}&pack=0&mode=solo`))).toMatch(/^mode: /);
  });

  it("takes a display name C-17's rule allows, and refuses one it doesn't", () => {
    expect(params(net(`${relayParam(LOCAL)}&pack=0&name=${encodeURIComponent('Rex the 🐕')}`)).name).toBe('Rex the 🐕');
    expect(error(net(`${relayParam(LOCAL)}&pack=0&name=${'x'.repeat(config.displayNameMaxChars + 1)}`))).toMatch(/^name: /);
    expect(error(net(`${relayParam(LOCAL)}&pack=0&name=${encodeURIComponent('a\u0007b')}`))).toMatch(/^name: /);
  });

  it('opens Practice with no room, relay, ICE, role, pack or bots: the player in pack A (Q-15, D-22)', () => {
    const p = params(parseNetParams('#test=net&mode=practice&packSize=1&seed=7&script=sideways&ready=0', false));
    expect(p).toEqual({
      mode: 'practice', room: null, relay: null, ice: 'none', k: 0, seed: 7, me: personId(7, 0), role: 'player', pack: 0,
      packSize: 1, minutes: config.matchLengthDefaultMinutes, bots: [], ready: 0, script: 'sideways', name: 'P0', coat: 0,
    });
    for (const extra of [`room=${ROOM}`, relayParam(LOCAL), 'ice=local', 'role=keeper', 'pack=0', 'bots=1']) {
      expect(error(parseNetParams(`#test=net&mode=practice&${extra}`, true)), extra).toMatch(/Practice joins no room/);
    }
  });
});

describe('the relays a build takes (§6.7)', () => {
  it("takes in a production build only third-party.json's signalling relays, however written", () => {
    expect(CURATED_RELAYS.length).toBeGreaterThan(0);
    for (const r of CURATED_RELAYS) {
      expect(acceptedRelay(r, false), r).toBe(true);
      const u = new URL(r);
      // The same URL with the default port, an upper-case host, or a root path written out.
      expect(acceptedRelay(`${u.protocol}//${u.hostname.toUpperCase()}:443${u.pathname}`, false), r).toBe(true);
    }
    for (const bad of [
      FOREIGN, 'wss://relay.damus.io.example', 'wss://user@relay.damus.io', 'wss://relay.damus.io/?x=1', 'wss://relay.damus.io/other',
      'wss://relay.damus.io:4443', 'ws://relay.damus.io', 'https://relay.damus.io', 'relay.damus.io', '', 'wss://',
    ]) {
      expect(acceptedRelay(bad, false), bad).toBe(false);
    }
  });

  it('takes in a production build a ws: relay on the loopback, and nothing else unencrypted', () => {
    for (const ok of [LOCAL, 'ws://localhost:41234', 'ws://[::1]:41234/', 'ws://127.1:41234', 'ws://127.0.0.1/']) {
      expect(acceptedRelay(ok, false), ok).toBe(true);
    }
    for (const bad of [
      'wss://127.0.0.1:41234', 'ws://127.0.0.2:41234', 'ws://10.0.0.1:41234', 'ws://localhost.example:41234', 'ws://me@127.0.0.1:41234',
      'ws://192.168.1.2:41234', 'http://127.0.0.1:41234',
    ]) {
      expect(acceptedRelay(bad, false), bad).toBe(false);
    }
  });

  it('takes in a dev build any ws: or wss: relay, and no other scheme', () => {
    for (const ok of [FOREIGN, LOCAL, 'ws://192.168.1.2:41234', CURATED_RELAYS[0]!]) expect(acceptedRelay(ok, true), ok).toBe(true);
    for (const bad of ['https://relay.example', 'relay.example', '']) expect(acceptedRelay(bad, true), bad).toBe(false);
  });

  it('refuses a foreign relay, and a missing one, in a production build, before the page contacts anything', () => {
    expect(error(net(`${relayParam(FOREIGN)}&pack=0`))).toMatch(/^relay: this build takes only/);
    expect(error(net('pack=0'))).toMatch(/^relay: none given/);
    // A dev build takes it, and without one leaves the relay to npm run dev:local's, on the default ICE.
    expect(params(net(`${relayParam(FOREIGN)}&pack=0`, true))).toMatchObject({ relay: FOREIGN, ice: 'local' });
    expect(params(net('pack=0', true))).toMatchObject({ relay: null, ice: 'default' });
    expect(error(net(`${relayParam('https://relay.example')}&pack=0`, true))).toMatch(/^relay: a ws: or wss: URL/);
  });

  it('holds no URL-shaped address of its own, which the dist audit would read as a host (design §6.6)', () => {
    const source = readFileSync(new URL('./nettest-params.ts', import.meta.url), 'utf8');
    expect(source.match(/\bwss?:\/\/\S*/g)).toBeNull();
  });
});
