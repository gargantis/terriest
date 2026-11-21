// The settings (M4's design, research/m4/DESIGN.md, §1.33, §6; PLAN §10,
// §11, A.3): extra signalling relays and the player's own TURN server,
// checked as typed; names over the terriers, start in ball view, the calmer
// camera, the mirrored touch layout, sound and the render quality, under one
// key, every change one write of the whole object (A.3), A.3's fields and
// no others. calmCamera and quality stay null until the player chooses,
// and get() resolves them each time, by prefers-reduced-motion and the
// device's default quality, so a later change of the system's preference
// still applies. Subscribers hear the settings in force after every
// change, a change of the system's preference while the calmer camera
// follows it included, so what applies at once does (PLAN §11): names over
// the terriers, the calmer camera, the mirrored layout and sound; a
// subscriber that throws keeps no other from hearing, its error reported
// apart. A change that fails a check says why and stores nothing; the
// checks are exported, so the Settings screen checks the relays and the
// TURN server as they're typed by the same rules. A stored field that
// doesn't read takes its default; a relay or TURN server that fails its
// check is dropped. roslambo's src/storage/settings.ts, with terriest's
// fields. New at M4; phase 2's settings builder added the subscribers'
// rules, the system's preference and the exported checks.

import { config, type RenderQuality } from '../config';
import { browserStorage, type KeyValue, tryWrite } from './kv';
import { DEFAULT_SETTINGS, type Settings, SETTINGS_KEY, type SettingsSource, type StoredSettings, type TurnServer } from './schema';

/** At most this many extra relays (roslambo's, M4's design §6). */
export const RELAYS_MAX = 10;

/** What the nulls follow until the player chooses (A.3). */
export interface SettingsEnv {
  readonly reducedMotion: () => boolean;
  readonly qualityDefault: () => RenderQuality;
  /** fn on each change of the system's reduced-motion preference; returns its removal. Without it a
   *  change still applies at the next get(), but no subscriber hears it. */
  readonly watchReducedMotion?: (fn: () => void) => () => void;
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
let reducedMotionList: MediaQueryList | null | undefined;

/** The page's one query for the preference, made at its first use: its matches stay live. */
function reducedMotionQuery(): MediaQueryList | null {
  reducedMotionList ??= typeof matchMedia === 'function' ? matchMedia(REDUCED_MOTION) : null;
  return reducedMotionList;
}

/** The page's: the system's prefers-reduced-motion, watched, and the configuration's default quality,
 *  whether phones start at low waiting for their measurements (D-33). */
export const browserEnv: SettingsEnv = {
  reducedMotion: () => reducedMotionQuery()?.matches === true,
  qualityDefault: () => config.renderQualityDefault,
  watchReducedMotion: (fn) => {
    const q = reducedMotionQuery();
    if (q === null || typeof q.addEventListener !== 'function') return () => {};
    q.addEventListener('change', fn);
    return () => q.removeEventListener('change', fn);
  },
};

/** Null if this is a relay URL terriest will use, else why not (roslambo's). */
export function relayProblem(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return `“${url}” isn’t a URL.`;
  }
  if (u.protocol !== 'wss:') return `“${url}” must start with wss://.`;
  if (u.username !== '' || u.password !== '') return `“${url}” mustn’t contain a user name or password.`;
  return null;
}

/** Null if these are relays terriest will use, else the first problem: at most RELAYS_MAX, each a
 *  wss:// URL without credentials (roslambo's). */
export function relaysProblem(relays: readonly string[]): string | null {
  if (relays.length > RELAYS_MAX) return `At most ${RELAYS_MAX} extra relays.`;
  for (const r of relays) {
    const p = relayProblem(r);
    if (p !== null) return p;
  }
  return null;
}

/** A TURN server's fields, by name. */
export type TurnField = keyof TurnServer;

const TURN_INCOMPLETE = 'A TURN server needs its user name and credential.';

/** Null if this TURN server is complete, else what's missing and which field it's in: a turn: or turns:
 *  URL, then its user name, then its credential (roslambo's checks). */
export function turnProblemAt(t: TurnServer): { readonly field: TurnField; readonly problem: string } | null {
  if (!/^turns?:\S+$/.test(t.urls)) return { field: 'urls', problem: 'A TURN URL starts with turn: or turns:, for example turns:turn.example.com:443.' };
  if (t.username === '') return { field: 'username', problem: TURN_INCOMPLETE };
  if (t.credential === '') return { field: 'credential', problem: TURN_INCOMPLETE };
  return null;
}

/** Null if this TURN server is complete, else what's missing (roslambo's). */
export function turnProblem(t: TurnServer): string | null {
  return turnProblemAt(t)?.problem ?? null;
}

const isQuality = (q: unknown): q is RenderQuality => typeof q === 'string' && Object.hasOwn(config.renderQuality, q);

function isTurn(t: unknown): t is TurnServer {
  if (typeof t !== 'object' || t === null) return false;
  const o = t as Record<string, unknown>;
  return typeof o['urls'] === 'string' && typeof o['username'] === 'string' && typeof o['credential'] === 'string';
}

/** The first problem of a whole object, or null. */
function problemOf(s: StoredSettings): string | null {
  if (!Array.isArray(s.relays) || !s.relays.every((r) => typeof r === 'string')) return 'The relays are a list of wss:// addresses.';
  const relays = relaysProblem(s.relays);
  if (relays !== null) return relays;
  if (!Array.isArray(s.turn) || !s.turn.every(isTurn)) return 'A TURN server has a URL, a user name and a credential.';
  for (const t of s.turn) {
    const p = turnProblem(t);
    if (p !== null) return p;
  }
  for (const k of ['names', 'ballView', 'mirrorTouch', 'sound'] as const) if (typeof s[k] !== 'boolean') return `${k} is on or off.`;
  if (s.calmCamera !== null && typeof s.calmCamera !== 'boolean') return 'The calmer camera is on, off or the system’s choice.';
  if (s.quality !== null && !isQuality(s.quality)) return 'The render quality is high or low.';
  return null;
}

const frozen = (s: StoredSettings): StoredSettings =>
  Object.freeze({ ...s, relays: Object.freeze([...s.relays]), turn: Object.freeze(s.turn.map((t) => Object.freeze({ ...t }))) });

/** A.3's whole object: the change's fields over the stored ones, each a field A.3 names and no other, so
 *  a stray key is never written. A field the change leaves undefined keeps its value; a null stays, for
 *  the two that follow a rule while null, and fails the checks for the rest. */
function changed(s: StoredSettings, c: Partial<StoredSettings>): StoredSettings {
  const pick = <K extends Exclude<keyof StoredSettings, 'v'>>(k: K): StoredSettings[K] => {
    const v = c[k];
    return v === undefined ? s[k] : (v as StoredSettings[K]);
  };
  const turn = pick('turn');
  return {
    v: 1,
    relays: pick('relays'),
    turn: Array.isArray(turn) && turn.every(isTurn) ? turn.map((t) => ({ urls: t.urls, username: t.username, credential: t.credential })) : turn,
    names: pick('names'),
    ballView: pick('ballView'),
    calmCamera: pick('calmCamera'),
    mirrorTouch: pick('mirrorTouch'),
    sound: pick('sound'),
    quality: pick('quality'),
  };
}

/** A stored object, field by field: one that doesn't read takes its default, and a relay or TURN server
 *  that fails its check is dropped. */
export function parseSettings(raw: string | null): StoredSettings {
  if (raw === null) return DEFAULT_SETTINGS;
  let x: unknown;
  try {
    x = JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (typeof x !== 'object' || x === null || (x as Record<string, unknown>)['v'] !== 1) return DEFAULT_SETTINGS;
  const o = x as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const flag = (k: 'names' | 'ballView' | 'mirrorTouch' | 'sound'): boolean => (typeof o[k] === 'boolean' ? (o[k] as boolean) : d[k]);
  const relays = Array.isArray(o['relays']) ? o['relays'].filter((r): r is string => typeof r === 'string' && relayProblem(r) === null) : [];
  const turn = Array.isArray(o['turn']) ? o['turn'].filter((t): t is TurnServer => isTurn(t) && turnProblem(t) === null) : [];
  return frozen({
    v: 1,
    relays: relays.slice(0, RELAYS_MAX),
    turn: turn.map((t) => ({ urls: t.urls, username: t.username, credential: t.credential })),
    names: flag('names'),
    ballView: flag('ballView'),
    calmCamera: typeof o['calmCamera'] === 'boolean' ? o['calmCamera'] : null,
    mirrorTouch: flag('mirrorTouch'),
    sound: flag('sound'),
    quality: isQuality(o['quality']) ? o['quality'] : null,
  });
}

const sameStored = (a: StoredSettings, b: StoredSettings): boolean => JSON.stringify(a) === JSON.stringify(b);

export class SettingsStore implements SettingsSource {
  /** null: no storage, or storage whose read failed, which is never written over. */
  private readonly kv: KeyValue | null;
  private readonly env: SettingsEnv;
  private value: StoredSettings;
  private keptNow: boolean;
  private readonly listeners = new Set<(s: Settings) => void>();

  constructor(kv: KeyValue | null = browserStorage(), env: SettingsEnv = browserEnv) {
    this.env = env;
    let raw: string | null = null;
    let read = kv !== null;
    try {
      raw = kv === null ? null : kv.getItem(SETTINGS_KEY);
    } catch {
      read = false;
    }
    this.kv = read ? kv : null;
    this.value = parseSettings(raw);
    this.keptNow = read;
    // The store lives as long as the page, and so does its watch. While the calmer camera follows the
    // system, a change there changes the settings in force (A.3).
    env.watchReducedMotion?.(() => {
      if (this.value.calmCamera === null) this.tell();
    });
  }

  /** The browser keeps the settings in force: false without storage or with its read failing, and from
   *  a failed write until a later one succeeds, while Home says so (PLAN §10). */
  get persistent(): boolean {
    return this.keptNow;
  }

  /** The settings in force: the nulls resolved now, so a change of the system's preference still applies. */
  get(): Settings {
    const s = this.value;
    return Object.freeze({
      ...s,
      calmCamera: s.calmCamera ?? this.env.reducedMotion(),
      quality: s.quality ?? this.env.qualityDefault(),
    });
  }

  /** As stored: calmCamera and quality null until the player chooses. */
  stored(): StoredSettings {
    return this.value;
  }

  /** The change, checked whole: null, with the whole object written once (A.3) and every subscriber told,
   *  or the first problem, a relay's or a TURN server's among them, and nothing stored. A refused write
   *  keeps the change in force for this page and loses that write only, persistent false until a later
   *  write succeeds (PLAN §10). A change that changes nothing writes nothing. */
  set(change: Partial<StoredSettings>): string | null {
    const next = changed(this.value, change);
    const problem = problemOf(next);
    if (problem !== null) return problem;
    if (sameStored(next, this.value)) return null;
    this.value = frozen(next);
    this.keptNow = tryWrite(this.kv, SETTINGS_KEY, JSON.stringify(this.value));
    this.tell();
    return null;
  }

  /** fn hears the settings in force after each change, and after each change of the system's preference
   *  while the calmer camera follows it; returns its removal. */
  subscribe(fn: (s: Settings) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Every subscriber, in the order they came, but one removed meanwhile, as an EventTarget's; one that
   *  throws keeps no other from hearing, and its error is reported once they all have, as an event
   *  listener's is, never thrown at the change's caller. */
  private tell(): void {
    const now = this.get();
    for (const fn of [...this.listeners]) {
      if (!this.listeners.has(fn)) continue;
      try {
        fn(now);
      } catch (e) {
        queueMicrotask(() => {
          throw e;
        });
      }
    }
  }
}
