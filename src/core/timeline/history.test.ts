import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FinalHistory } from './history';

// The final states' history (design §1.4, §2.1, §3.4, §8.3): the last
// `size` final ticks' bytes, hashes and rosters, and dropAfter for a STATE
// adopted at g.

const SIZE = 256; // config.stateHistoryTicks
const hashOf = (t: number): string => t.toString(16).padStart(16, '0');
const bytesOf = (t: number): Uint8Array => Uint8Array.of(t & 0xff, (t >>> 8) & 0xff, 7);
const rosterOf = (t: number): string[] => [t.toString(16).padStart(32, '0')];

function put(h: FinalHistory, t: number): void {
  h.put(t, bytesOf(t), hashOf(t), rosterOf(t));
}

/** What the history says of tick t. */
const read = (h: FinalHistory, t: number) => ({ has: h.has(t), bytes: h.bytes(t), hash: h.hash(t), roster: h.roster(t) });
const held = (t: number) => ({ has: true, bytes: bytesOf(t), hash: hashOf(t), roster: rosterOf(t) });
const NOT_HELD = { has: false, bytes: null, hash: '', roster: [] };

describe('the final history (design §1.4)', () => {
  it('holds what each finalisation stored: bytes, hash and roster', () => {
    const h = new FinalHistory(SIZE);
    for (let t = 0; t <= 10; t++) put(h, t);
    for (let t = 0; t <= 10; t++) expect(read(h, t)).toStrictEqual(held(t));
    expect(read(h, 11)).toStrictEqual(NOT_HELD);
    // The bytes are kept as given: encodeState hands over a copy of its own.
    const bytes = bytesOf(99);
    h.put(99, bytes, hashOf(99), []);
    expect(h.bytes(99)).toBe(bytes);
  });

  it('keeps the last `size` ticks, each put taking the slot of the tick `size` before it', () => {
    const h = new FinalHistory(4);
    for (let t = 0; t <= 9; t++) put(h, t);
    expect([...Array(10).keys()].map((t) => h.has(t))).toEqual([false, false, false, false, false, false, true, true, true, true]);
    expect(read(h, 5)).toStrictEqual(NOT_HELD);
    expect(read(h, 9)).toStrictEqual(held(9));
  });

  it('copies the roster, which nobody can write to after', () => {
    const h = new FinalHistory(SIZE);
    const roster = ['a'.repeat(32), 'b'.repeat(32)];
    h.put(3, bytesOf(3), hashOf(3), roster);
    roster.push('c'.repeat(32));
    expect(h.roster(3)).toEqual(['a'.repeat(32), 'b'.repeat(32)]);
    expect(Object.isFrozen(h.roster(3)) && Object.isFrozen(h.roster(4))).toBe(true);
  });

  it('forgets every tick after an adopted STATE’s g, which re-finalisation writes again (design §3.4)', () => {
    const h = new FinalHistory(SIZE);
    for (let t = 700; t <= 1000; t++) put(h, t);
    // The losing lineage's entry at g is replaced, and every tick after it dropped.
    const g = 900;
    h.put(g, bytesOf(1), 'ffffffffffffffff', []);
    h.dropAfter(g);
    expect(read(h, g)).toStrictEqual({ has: true, bytes: bytesOf(1), hash: 'ffffffffffffffff', roster: [] });
    for (const t of [901, 950, 1000]) expect(read(h, t)).toStrictEqual(NOT_HELD);
    // The ticks before g that the ring still holds stay: 745 to 899.
    expect([744, 745, 899].map((t) => h.has(t))).toEqual([false, true, true]);
    for (let t = g + 1; t <= 1000; t++) put(h, t);
    // The last 256 final ticks again, 745 to 1000.
    const kept = Array.from({ length: 258 }, (_, k) => 744 + k).filter((t) => h.has(t));
    expect([kept[0], kept.at(-1), kept.length]).toEqual([745, 1000, SIZE]);
    expect(read(h, 1000)).toStrictEqual(held(1000));
  });

  it('holds nothing at a tick that is no tick, NO_TICK’s u32 included', () => {
    const h = new FinalHistory(8);
    put(h, 0);
    for (const t of [-1, 0.5, Number.NaN, Infinity, 0xffffffff]) expect(read(h, t)).toStrictEqual(NOT_HELD);
    h.put(-8, bytesOf(1), hashOf(1), []);
    h.put(Number.NaN, bytesOf(1), hashOf(1), []);
    expect(read(h, 0)).toStrictEqual(held(0));
    expect(() => new FinalHistory(0)).toThrow(RangeError);
  });

  it('clears to an empty history', () => {
    const h = new FinalHistory(8);
    for (let t = 0; t < 8; t++) put(h, t);
    h.clear();
    for (let t = 0; t < 8; t++) expect(read(h, t)).toStrictEqual(NOT_HELD);
    put(h, 5);
    expect(read(h, 5)).toStrictEqual(held(5));
  });

  it('matches a model of its ring through puts and drops in any order', () => {
    const size = 8;
    const step = fc.oneof(
      { weight: 4, arbitrary: fc.record({ put: fc.integer({ min: 0, max: 40 }) }) },
      { weight: 1, arbitrary: fc.record({ drop: fc.integer({ min: -1, max: 40 }) }) },
    );
    fc.assert(
      fc.property(fc.array(step, { maxLength: 60 }), (steps) => {
        const h = new FinalHistory(size);
        const slots = new Map<number, number>(); // slot → the tick it holds
        // What disagrees with the model, asserted once: an expect a tick would take seconds.
        const wrong: string[] = [];
        const text = (r: ReturnType<typeof read>): string => JSON.stringify({ ...r, bytes: r.bytes && [...r.bytes] });
        steps.forEach((s, n) => {
          if ('put' in s) {
            put(h, s.put);
            slots.set(s.put % size, s.put);
          } else {
            h.dropAfter(s.drop);
            for (const [slot, t] of slots) if (t > s.drop) slots.delete(slot);
          }
          for (let t = 0; t <= 40; t++) {
            const [got, want] = [read(h, t), slots.get(t % size) === t ? held(t) : NOT_HELD].map(text);
            if (got !== want) wrong.push(`after step ${n}, tick ${t}: ${got}, not ${want}`);
          }
        });
        expect(wrong.slice(0, 5)).toEqual([]);
      }),
    );
  });
});
