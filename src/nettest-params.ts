// The #test=net page's parameters, its hook's shapes, and the relays a
// build accepts (M3's design, research/m3/DESIGN.md, §1.26, §6.7, §7.2,
// §7.4), apart from the page, src/nettest.ts, so that e2e/lib/browsers.ts
// and the harness compile against them before the page exists.
// - The fragment is read with URLSearchParams, which never throws on a
//   malformed % escape: #test=net&room=% reports a bad room, and the page
//   still starts (roslambo's router threw URIError there). A parameter this
//   page doesn't take, or one given twice, is an error too, so a spec's typo
//   fails at once rather than playing another setup.
// - A dev build takes any ws: or wss: relay, and npm run dev:local's when
//   none is given (src/net/dev-relay.ts, which the page loads under
//   import.meta.env.DEV). A production build takes only third-party.json's
//   signalling relays, which M5's relay check uses, or a ws: relay on the
//   loopback, which the gate's vite preview runs use; it compares the
//   parsed URL's parts, so this chunk holds no URL-shaped loopback string
//   for the dist audit. Anything else, the page says so and contacts
//   nothing: the CSP allows any wss: host, so without this a crafted link
//   could send a visitor's browser to a relay third-party.json doesn't list
//   (CLAUDE.md, PLAN §16).
// - Practice (mode=practice) joins no room, so it takes no room, relay,
//   ICE, role, pack or bots: the player is in pack A and bots fill every
//   other place (Q-15, D-22).

import { config } from './config';
import { BOT_SLOTS, personId } from './core/bot/bot-id';
import type { ScriptName } from './core/bot/setups';
import { normalizeMatchId } from './core/match-id';
import type { ResultRow } from './core/session/scoreboard';
import type { DuplicateHello } from './core/session/session';
import type { MatchNetSummary } from './core/session/summary';
import { defaultParams, nameAllowed, type Pack } from './core/sim/index';
import type { TimelineStats } from './core/timeline/timeline';
import { CURATED_RELAYS } from './net/room-config';
import type { IceMode } from './net/transport';
import type { Traffic } from './ui/game';

export type NetRole = 'keeper' | 'player' | 'spectator';
export type NetMode = 'net' | 'practice';

/** The page's setup (§7.2). */
export interface NetParams {
  readonly mode: NetMode;
  /** The match ID, as normalizeMatchId writes it; null in Practice, which joins no room. */
  readonly room: string | null;
  /** The only relay, one acceptedRelay takes; null: none given, so npm run dev:local's in a dev build
   *  (the page's to find), and none in Practice. */
  readonly relay: string | null;
  /** local when a relay is given and ice isn't, as roslambo's local: true; else default. Practice's
   *  is none: it opens no room. */
  readonly ice: IceMode;
  readonly k: number;
  readonly seed: number;
  /** personId(seed, k), so the end-to-end setups' IDs match M2's offline runs and the loopback's. */
  readonly me: string;
  /** keeper: proposes, then plays in pack, or watches without one; player: plays in pack; spectator:
   *  watches. Practice's is player. */
  readonly role: NetRole;
  /** null: a keeper that watches, or a spectator. Practice's is pack A. */
  readonly pack: Pack | null;
  /** The keeper's and Practice's genesis settings. */
  readonly packSize: number;
  readonly minutes: number;
  /** A pack for each bot to host, in order. */
  readonly bots: readonly Pack[];
  /** The match tick at or after which the page presses Ready, once its terrier is in the final roster;
   *  null: never. A tick, not a time, so the start countdown begins at the same tick in every run. */
  readonly ready: number | null;
  /** The page's own input (src/core/bot/setups.ts). */
  readonly script: ScriptName;
  readonly name: string;
  readonly coat: number;
}

/** What the page reports through window.terriestTest.net (§7.4). */
export interface NetReport {
  me: string;
  role: string;
  mode: NetMode;
  build: string;
  started: boolean;
  timeline: string;
  localTick: number;
  finalTick: number;
  headTick: number;
  phase: number;
  phaseStart: number;
  overtime: boolean;
  /** The match clock, the final state's. */
  clock: number;
  score: [number, number];
  roster: { id: string; pack: number; spot: number; sitting: boolean; lastInputTick: number; goals: number; touches: number }[];
  /** The scoreboard's. */
  goals: { tick: number; pack: number; ownGoal: boolean; scorers: string[] }[];
  end: { tick: number; score: [number, number]; winner: number | null; rows: ResultRow[] } | null;
  /** The tick at which this page adopted or started the timeline. */
  arrivedTick: number;
  peers: number;
  refused: string | null;
  refusedBy: number | null;
  returning: boolean;
  spectatorsFull: boolean;
  abandoned: boolean;
  failed: boolean;
  stall: 'none' | 'deciding' | 'rejoining';
  stats: Omit<TimelineStats, 'log' | 'resyncMs'> & { resyncMsMax: number };
  /** §1.16's. */
  summary: MatchNetSummary;
  /** C-12's rule at work (§4.3). */
  duplicates: DuplicateHello[];
  /** ms per timer run that moved the clock. */
  cpu: { mean: number; p95: number; max: number } | null;
  /** Messages and bytes, sent and received, by type (§1.24). */
  traffic: Traffic;
  /** window.__rtcCount, when a spec counts them. */
  rtcConnections: number | null;
}

/** window.terriestTest.net, which the page adds once started, only when a spec set
 *  window.terriestTest before load (M3-Q7). */
export interface NetHook {
  report(): NetReport;
  /** '' if not held. */
  hashAt(t: number): string;
}

const KEYS = [
  'test', 'mode', 'room', 'relay', 'ice', 'k', 'seed', 'role', 'pack', 'packSize', 'minutes', 'bots', 'ready', 'script', 'name', 'coat',
] as const; // not a setting: the page's parameters (§7.2)
const MODES: readonly NetMode[] = ['net', 'practice'];
const ROLES: readonly NetRole[] = ['keeper', 'player', 'spectator'];
const ICE: readonly IceMode[] = ['default', 'none', 'local'];
const SCRIPTS: readonly ScriptName[] = ['none', 'back', 'sideways', 'brain'];
/** Practice opens no room, so these are a networked page's alone. */
const NET_ONLY = ['room', 'relay', 'ice', 'role', 'pack', 'bots'] as const; // not a setting: §7.2's
const SEED_DEFAULT = 7; // not a setting: the end-to-end setups' seed (§16)
const U32_MAX = 0xffffffff; // not a setting
const WHOLE = /^(?:0|[1-9][0-9]*)$/;
/** The hosts a production build takes a ws: relay on: the loopback, as URL.hostname writes them. */
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]']; // not a setting: §6.7's
const CURATED = CURATED_RELAYS.map((r) => new URL(r).href);

/** Whether a build takes this relay (§6.7): in a dev build any ws: or wss: URL; in a production one,
 *  only third-party.json's signalling URLs, or a ws: URL on the loopback, without credentials. */
export function acceptedRelay(url: string, dev: boolean): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (dev) return u.protocol === 'ws:' || u.protocol === 'wss:';
  if (u.protocol === 'ws:') return u.username === '' && u.password === '' && LOOPBACK_HOSTS.includes(u.hostname);
  return u.protocol === 'wss:' && CURATED.includes(u.href);
}

class Bad extends Error {}

/** The #test=net page's parameters from its fragment (§7.2), or what's wrong with them, for the page
 *  to say before it contacts anything. dev: a dev build (import.meta.env.DEV). */
export function parseNetParams(hash: string, dev: boolean): NetParams | { error: string } {
  const q = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  try {
    return read(q, dev);
  } catch (e) {
    if (e instanceof Bad) return { error: e.message };
    throw e;
  }
}

function read(q: URLSearchParams, dev: boolean): NetParams {
  for (const key of new Set(q.keys())) {
    if (!(KEYS as readonly string[]).includes(key)) throw new Bad(`${key}: this page takes no such parameter`);
    if (q.getAll(key).length > 1) throw new Bad(`${key}: given more than once`);
  }
  if (q.get('test') !== 'net') throw new Bad('test: this is the #test=net page');
  const mode = oneOf(q, 'mode', MODES, 'net');
  const k = whole(q, 'k', 0, U32_MAX, 0);
  const seed = whole(q, 'seed', 0, U32_MAX, SEED_DEFAULT);
  const packSize = whole(q, 'packSize', config.packSizeMin, config.packSizeMax, config.packSizeDefault);
  const minutes = whole(q, 'minutes', config.matchLengthMinMinutes, config.matchLengthMaxMinutes, config.matchLengthDefaultMinutes);
  const readyText = q.get('ready');
  const ready = readyText === null ? null : whole(q, 'ready', 0, U32_MAX, 0);
  const script = oneOf(q, 'script', SCRIPTS, 'none');
  const name = q.get('name') ?? `P${k}`;
  if (!nameAllowed(name, defaultParams)) {
    throw new Bad(`name: at most ${config.displayNameMaxChars} characters and ${config.displayNameMaxBytes} bytes, with no control character (C-17)`);
  }
  const coat = whole(q, 'coat', 0, config.coatCount - 1, k % config.coatCount);
  const common = { k, seed, me: personId(seed, k), packSize, minutes, ready, script, name, coat };
  if (mode === 'practice') {
    for (const key of NET_ONLY) if (q.has(key)) throw new Bad(`${key}: Practice joins no room, and takes none`);
    return { mode, room: null, relay: null, ice: 'none', role: 'player', pack: 0, bots: [], ...common };
  }
  const roomText = q.get('room');
  if (roomText === null) throw new Bad('room: a match ID is needed');
  const room = normalizeMatchId(roomText);
  if (room === null) throw new Bad('room: not a match ID');
  const relay = q.get('relay');
  if (relay !== null && !acceptedRelay(relay, dev)) {
    throw new Bad(dev ? 'relay: a ws: or wss: URL' : "relay: this build takes only third-party.json's relays, or a ws: relay on this machine");
  }
  if (relay === null && !dev) throw new Bad('relay: none given, and only a dev build has a local one');
  const ice = oneOf(q, 'ice', ICE, relay !== null ? 'local' : 'default');
  const role = oneOf(q, 'role', ROLES, 'player');
  const pack = packOf(q.get('pack'), 'pack');
  if (role === 'player' && pack === null) throw new Bad('pack: a player plays in pack 0 or 1');
  if (role === 'spectator' && pack !== null) throw new Bad('pack: a spectator plays in no pack');
  const botsText = q.get('bots');
  const bots = botsText === null || botsText === '' ? [] : botsText.split(',').map((p) => packOf(p, 'bots')!);
  if (bots.length > BOT_SLOTS) throw new Bad(`bots: a browser hosts at most ${BOT_SLOTS}`);
  return { mode, room, relay, ice, role, pack, bots, ...common };
}

function whole(q: URLSearchParams, key: string, lo: number, hi: number, fallback: number): number {
  const text = q.get(key);
  if (text === null) return fallback;
  const n = WHOLE.test(text) ? Number(text) : NaN;
  if (!(n >= lo && n <= hi)) throw new Bad(`${key}: a whole number from ${lo} to ${hi}`);
  return n;
}

function oneOf<V extends string>(q: URLSearchParams, key: string, values: readonly V[], fallback: V): V {
  const text = q.get(key);
  if (text === null) return fallback;
  const v = values.find((x) => x === text);
  if (v === undefined) throw new Bad(`${key}: one of ${values.join(', ')}`);
  return v;
}

/** 0 or 1; null for none given. */
function packOf(text: string | null, key: string): Pack | null {
  if (text === null) return null;
  if (text === '0') return 0;
  if (text === '1') return 1;
  throw new Bad(`${key}: a pack is 0 or 1`);
}
