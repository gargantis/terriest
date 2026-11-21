// The profile (M4's design, research/m4/DESIGN.md, §1.32, §6; PLAN §10,
// A.3, D-24, D-25): the player ID, the display name, the coat and the
// control hints used, under one key, every change one write of the whole
// record. roslambo's src/storage/profile.ts with terriest's fields, no
// balance or ledger:
// - the player ID: crypto.randomUUID() as 32 lowercase hex digits, once per
//   browser (D-25); a change never alters it;
// - the name, fitted by src/core/names.ts's fitName, so a JOIN keeps it;
// - the coat, an index in the coat list, drawn at random on the first visit
//   and stored at once (PLAN §10);
// - the hints, a bitmask of the six controls used for each kind of device
//   (M4-Q28).
// An unreadable record is copied verbatim to the backup key before a fresh
// one replaces it (D-24), and never overwritten while that copy fails: each
// write tries the copy first. Storage whose read fails is never written,
// since a record there is one the store can't see. A record whose identity
// and name read but whose coat or hints don't is kept, its coat drawn as
// coat 0, as D-12 draws a JOIN's outside the list, and its hints shown
// again, so a returning player keeps their ID. New at M4.

import { config } from '../config';
import { fitName } from '../core/names';
import { isPlayerId } from '../core/sim/index';
import { browserStorage, type KeyValue, tryWrite } from './kv';
import { type Profile, PROFILE_BACKUP_KEY, PROFILE_KEY, type ProfileSource } from './schema';

/** The six controls' bits in a kind's hints (src/input/hints.ts, M4-Q28). */
const CONTROL_BITS = 0x3f;

/** D-25: once per browser, 32 lowercase hex digits. */
export function newPlayerId(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

/** A coat in the list, at random (PLAN §10). */
export function randomCoat(): number {
  const word = crypto.getRandomValues(new Uint32Array(1))[0]!;
  return word % config.coatCount;
}

const isCoat = (c: unknown): c is number => Number.isInteger(c) && (c as number) >= 0 && (c as number) < config.coatCount;
const hintsOf = (x: unknown): number => (Number.isInteger(x) && (x as number) >= 0 ? (x as number) & CONTROL_BITS : 0);

/** The record as the store keeps it: frozen, its name fitted, its coat in the list (coat 0 if not), each
 *  kind's hints the six controls' bits. */
function record(playerId: string, name: string, coat: unknown, hints: unknown): Profile {
  const h = (typeof hints === 'object' && hints !== null ? hints : {}) as Record<string, unknown>;
  return Object.freeze({
    v: 1,
    playerId,
    name: fitName(name),
    coat: isCoat(coat) ? coat : 0,
    hints: Object.freeze({ keyboard: hintsOf(h['keyboard']), touch: hintsOf(h['touch']), gamepad: hintsOf(h['gamepad']) }),
  });
}

/** A stored profile, or null if it isn't one: not JSON, not version 1, or without a player ID and a name. */
export function parseProfile(raw: string): Profile | null {
  let x: unknown;
  try {
    x = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return null;
  const p = x as Record<string, unknown>;
  const id = p['playerId'];
  if (p['v'] !== 1 || typeof id !== 'string' || !isPlayerId(id) || typeof p['name'] !== 'string') return null;
  return record(id, p['name'], p['coat'], p['hints']);
}

const same = (a: Profile, b: Profile): boolean =>
  a.name === b.name && a.coat === b.coat &&
  a.hints.keyboard === b.hints.keyboard && a.hints.touch === b.hints.touch && a.hints.gamepad === b.hints.gamepad;

export class ProfileStore implements ProfileSource {
  /** null: no storage, or storage whose read failed, which is never written. */
  private readonly kv: KeyValue | null;
  private profile: Profile;
  private keptNow = true;
  /** An unreadable record not yet copied to the backup key: no write replaces it until the copy lands. */
  private backup: string | null = null;

  /** The stored profile, or a fresh one stored at once: a new player ID and a random coat. Without
   *  storage, or with it blocked, the fresh one lives in memory, for this page only. */
  constructor(kv: KeyValue | null = browserStorage(), makeId: () => string = newPlayerId, drawCoat: () => number = randomCoat) {
    let raw: string | null = null;
    let readable = kv !== null;
    try {
      raw = kv === null ? null : kv.getItem(PROFILE_KEY);
    } catch {
      readable = false;
    }
    this.kv = readable ? kv : null;
    const parsed = raw === null ? null : parseProfile(raw);
    if (parsed !== null) {
      this.profile = parsed;
      return;
    }
    this.profile = record(makeId(), '', drawCoat(), null);
    // The unreadable record goes to the backup first, verbatim (D-24).
    this.backup = raw;
    this.store();
  }

  /** The browser keeps the profile in force: false without storage or with its read failing, and from
   *  a failed write until a later one succeeds, while Home says so (PLAN §10). */
  get persistent(): boolean {
    return this.keptNow;
  }

  /** The profile in force, frozen: change it through update(). */
  get(): Profile {
    return this.profile;
  }

  /** The profile as `change` makes it from the one in force, its name fitted, its coat in the list and
   *  its player ID the browser's for good (D-25), stored by one write of the whole record (PLAN §10).
   *  True when that changed the profile in force; false when the change returned null or changed
   *  nothing, and nothing was written. A refused write (a full quota, storage blocked) keeps the change
   *  in force for this page and loses that write only: persistent turns false until a later write
   *  succeeds, which stores the whole record again. */
  update(change: (p: Profile) => Profile | null): boolean {
    const next = change(this.profile);
    if (next === null) return false;
    const fixed = record(this.profile.playerId, next.name, isCoat(next.coat) ? next.coat : this.profile.coat, next.hints);
    if (same(fixed, this.profile)) return false;
    this.profile = fixed;
    this.store();
    return true;
  }

  /** One write of the whole record, after the unreadable one's copy if that's still to land. */
  private store(): void {
    if (this.backup !== null) {
      if (!tryWrite(this.kv, PROFILE_BACKUP_KEY, this.backup)) {
        this.keptNow = false;
        return;
      }
      this.backup = null;
    }
    this.keptNow = tryWrite(this.kv, PROFILE_KEY, JSON.stringify(this.profile));
  }
}
