import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { isPlayerId, nameAllowed, defaultParams } from '../core/sim/index';
import { MemoryStorage } from './kv';
import { newPlayerId, parseProfile, ProfileStore, randomCoat } from './profile';
import { type Profile, PROFILE_BACKUP_KEY, PROFILE_KEY } from './schema';

// The profile (M4's design §1.32, §6, §9.2; PLAN §10, A.3, D-24, D-25):
// A.3's shape; a fresh one stored at once with a random coat; an unreadable
// one backed up verbatim before a fresh one replaces it, and never
// overwritten while that copy fails; every change one write of the whole
// record, which reads back as it was; and a refused write losing that write
// only, the store saying so until a later write succeeds.

const ID = `0123456789abcdef4123456789abcdef`;
const OTHER_ID = `fedcba98765432104fedcba987654321`;
const stored = (kv: MemoryStorage): unknown => JSON.parse(kv.data.get(PROFILE_KEY) ?? 'null');
const fixedId = (): string => ID;
const coat3 = (): number => 3;

describe('the profile (A.3, D-24, D-25)', () => {
  it('makes a fresh one on the first visit, a player ID and a random coat, stored at once', () => {
    const kv = new MemoryStorage();
    const p = new ProfileStore(kv, fixedId, coat3);
    expect(p.get()).toEqual({ v: 1, playerId: ID, name: '', coat: 3, hints: { keyboard: 0, touch: 0, gamepad: 0 } });
    expect(stored(kv)).toEqual(p.get());
    expect(p.persistent).toBe(true);
    // The next visit reads it back.
    expect(new ProfileStore(kv, () => OTHER_ID).get()).toEqual(p.get());
  });

  it('draws player IDs of 32 lowercase hex digits, version 4, and coats in the list (D-25)', () => {
    for (let k = 0; k < 50; k++) {
      const id = newPlayerId();
      expect(isPlayerId(id), id).toBe(true);
      expect(id[12]).toBe('4');
      const c = randomCoat();
      expect(Number.isInteger(c) && c >= 0 && c < config.coatCount, `${c}`).toBe(true);
    }
    expect(new Set(Array.from({ length: 20 }, newPlayerId)).size).toBe(20);
  });

  it('backs up an unreadable record verbatim before a fresh one replaces it (D-24)', () => {
    for (const raw of ['{not json', '[]', '"a"', JSON.stringify({ v: 2, playerId: ID, name: 'Ada' }), JSON.stringify({ v: 1, playerId: 'nope', name: 'Ada' }),
      JSON.stringify({ v: 1, playerId: ID.toUpperCase(), name: 'Ada' }), JSON.stringify({ v: 1, playerId: ID, name: 7 })]) {
      const kv = new MemoryStorage();
      kv.data.set(PROFILE_KEY, raw);
      const p = new ProfileStore(kv, () => OTHER_ID, coat3);
      expect(kv.data.get(PROFILE_BACKUP_KEY), raw).toBe(raw);
      expect(p.get().playerId, raw).toBe(OTHER_ID);
      expect(stored(kv), raw).toEqual(p.get());
      expect(p.persistent).toBe(true);
    }
  });

  it("never overwrites an unreadable record while its backup fails: each write tries the copy first", () => {
    const kv = new MemoryStorage();
    kv.data.set(PROFILE_KEY, '{lost?');
    kv.failNextWrite = true;
    const p = new ProfileStore(kv, () => OTHER_ID, coat3);
    expect(kv.data.get(PROFILE_KEY)).toBe('{lost?');
    expect(kv.data.has(PROFILE_BACKUP_KEY)).toBe(false);
    expect(p.get().playerId).toBe(OTHER_ID);
    expect(p.persistent).toBe(false);
    kv.full = true; // a change while the copy still fails: the record stays
    expect(p.update((x) => ({ ...x, name: 'Ada' }))).toBe(true);
    expect([kv.data.get(PROFILE_KEY), kv.data.has(PROFILE_BACKUP_KEY), p.persistent]).toEqual(['{lost?', false, false]);
    kv.full = false; // the next one copies it, then stores the whole record
    expect(p.update((x) => ({ ...x, coat: 1 }))).toBe(true);
    expect(kv.data.get(PROFILE_BACKUP_KEY)).toBe('{lost?');
    expect(stored(kv)).toEqual({ v: 1, playerId: OTHER_ID, name: 'Ada', coat: 1, hints: { keyboard: 0, touch: 0, gamepad: 0 } });
    expect(p.persistent).toBe(true);
  });

  it('never writes to storage whose read failed: a record there is one it cannot see', () => {
    const kv = new MemoryStorage();
    kv.data.set(PROFILE_KEY, JSON.stringify({ v: 1, playerId: ID, name: 'Ada', coat: 2 }));
    kv.getItem = () => {
      throw new Error('the read is refused');
    };
    const p = new ProfileStore(kv, () => OTHER_ID, coat3);
    expect(p.update((x) => ({ ...x, name: 'Bea' }))).toBe(true);
    expect([p.get().playerId, p.get().name, p.persistent]).toEqual([OTHER_ID, 'Bea', false]);
    expect(JSON.parse(kv.data.get(PROFILE_KEY)!)).toMatchObject({ playerId: ID, name: 'Ada' });
    expect(kv.data.has(PROFILE_BACKUP_KEY)).toBe(false);
  });

  it('keeps a record whose coat or hints are out of the list: coat 0 (D-12) and the hints shown again', () => {
    const kv = new MemoryStorage();
    kv.data.set(PROFILE_KEY, JSON.stringify({ v: 1, playerId: ID, name: 'Ada', coat: config.coatCount, hints: { keyboard: 'x', touch: 0x7f, gamepad: -1 } }));
    const p = new ProfileStore(kv);
    expect(p.get()).toEqual({ v: 1, playerId: ID, name: 'Ada', coat: 0, hints: { keyboard: 0, touch: 0x3f, gamepad: 0 } });
    expect(kv.data.has(PROFILE_BACKUP_KEY)).toBe(false);
    expect(parseProfile(JSON.stringify({ v: 1, playerId: ID, name: 'Ada', coat: 2.5 }))?.coat).toBe(0);
    expect(parseProfile(JSON.stringify({ v: 1, playerId: ID, name: `  ${'x'.repeat(30)}` }))?.name).toBe('x'.repeat(20));
  });

  it('stores a change as one write of the whole record, which reads back unchanged', () => {
    const kv = new MemoryStorage();
    const p = new ProfileStore(kv, fixedId, coat3);
    let writes = 0;
    const setItem = kv.setItem.bind(kv);
    kv.setItem = (k, v) => {
      writes++;
      setItem(k, v);
    };
    expect(p.update((x) => ({ ...x, name: '  Ada\u0000 ', coat: 5 }))).toBe(true);
    expect(writes).toBe(1);
    expect(p.get()).toMatchObject({ playerId: ID, name: 'Ada', coat: 5 });
    expect(parseProfile(kv.data.get(PROFILE_KEY)!)).toEqual(p.get());
    expect(nameAllowed(p.get().name, defaultParams)).toBe(true);
    expect(p.update((x) => ({ ...x, hints: { ...x.hints, keyboard: 0b101 } }))).toBe(true);
    expect(p.get().hints).toEqual({ keyboard: 5, touch: 0, gamepad: 0 });
    expect(writes).toBe(2);
  });

  it('writes nothing for no change, or for one that changes nothing; keeps the player ID and a coat in the list', () => {
    const kv = new MemoryStorage();
    const p = new ProfileStore(kv, fixedId, coat3);
    const before = kv.data.get(PROFILE_KEY);
    expect(p.update(() => null)).toBe(false);
    expect(p.update((x) => ({ ...x }))).toBe(false);
    expect(p.update((x) => ({ ...x, name: ' ' }))).toBe(false); // fitted to '', as it was
    expect(p.update((x): Profile => ({ ...x, playerId: OTHER_ID }))).toBe(false); // the browser's for good
    expect(p.update((x) => ({ ...x, coat: config.coatCount }))).toBe(false); // outside the list: kept as it was
    expect(kv.data.get(PROFILE_KEY)).toBe(before);
    expect(p.get().playerId).toBe(ID);
    // An ID beside a real change: the change lands, the ID stays the browser's (D-25).
    expect(p.update((x): Profile => ({ ...x, playerId: OTHER_ID, name: 'Ada' }))).toBe(true);
    expect([p.get().playerId, (stored(kv) as Profile).playerId, p.get().name]).toEqual([ID, ID, 'Ada']);
  });

  it('loses a refused write only: the change stays in force, and persistent is false until a later write lands', () => {
    const kv = new MemoryStorage();
    const p = new ProfileStore(kv, fixedId, coat3);
    kv.full = true;
    expect(p.update((x) => ({ ...x, name: 'Ada' }))).toBe(true);
    expect(p.get().name).toBe('Ada');
    expect(p.persistent).toBe(false);
    expect((stored(kv) as Profile).name).toBe('');
    kv.full = false;
    expect(p.update((x) => ({ ...x, coat: 6 }))).toBe(true);
    expect(p.persistent).toBe(true);
    expect(stored(kv)).toEqual({ v: 1, playerId: ID, name: 'Ada', coat: 6, hints: { keyboard: 0, touch: 0, gamepad: 0 } });
  });

  it('plays from memory without storage, or with it blocked, and says so', () => {
    const none = new ProfileStore(null, fixedId, coat3);
    expect(none.persistent).toBe(false);
    expect(none.update((x) => ({ ...x, name: 'Ada' }))).toBe(true);
    expect(none.get().name).toBe('Ada');
    const kv = new MemoryStorage();
    kv.blocked = true;
    const blocked = new ProfileStore(kv, fixedId, coat3);
    expect([blocked.persistent, blocked.get().playerId]).toEqual([false, ID]);
  });
});
