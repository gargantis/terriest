import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type TallyResult, VoteBook } from './votes';

// The vote book and D-13's tally (design §1.5, §2.12, §3.1, §3.2, §3.4,
// §8.3): the plurality, ties by the smallest hash, a bot's host counted
// once, a voter outside the roster ignored, every arrival order, and the
// ring's retirement.

const SIZE = 1024; // netSettings' inputSpan
const hash = (n: bigint | number): string => n.toString(16).padStart(16, '0');
const player = (k: number): string => k.toString(16).padStart(32, '0');
const [P1, P2, P3, P4, ME] = [1, 2, 3, 4, 0xe].map(player) as [string, string, string, string, string];
const everyone = (): boolean => true;

describe('the tally (D-13, design §3.2)', () => {
  it('gives the hash with the most counted votes, and says whether it is mine and whether votes split', () => {
    const v = new VoteBook(SIZE);
    v.add(10, ME, hash(1));
    v.add(10, P1, hash(2));
    v.add(10, P2, hash(2));
    expect(v.tally(10, hash(1), everyone)).toStrictEqual({ win: hash(2), agree: false, split: true });
    expect(v.tally(10, hash(2), everyone)).toStrictEqual({ win: hash(2), agree: true, split: true });
    v.add(11, P1, hash(5));
    v.add(11, ME, hash(5));
    expect(v.tally(11, hash(5), everyone)).toStrictEqual({ win: hash(5), agree: true, split: false });
  });

  it('breaks a tie by the smallest hash, as the unsigned number its 16 hex digits spell', () => {
    const v = new VoteBook(SIZE);
    // 0x100 beats 0xff by digits, not by length or a locale.
    v.add(1, P1, hash(0x100));
    v.add(1, P2, hash(0xff));
    expect(v.tally(1, hash(0x100), everyone)?.win).toBe(hash(0xff));
    v.add(2, P1, hash(0xffffffffffffffffn));
    v.add(2, P2, hash(0x8000000000000000n));
    v.add(2, P3, hash(0x7fffffffffffffffn));
    expect(v.tally(2, hash(0xffffffffffffffffn), everyone)?.win).toBe(hash(0x7fffffffffffffffn));
    // The most votes first, whatever their hash.
    v.add(3, P1, hash(9));
    v.add(3, P2, hash(9));
    v.add(3, P3, hash(1));
    expect(v.tally(3, hash(1), everyone)).toStrictEqual({ win: hash(9), agree: false, split: true });
  });

  it('counts one vote per voter that controls a terrier in my roster: a bot’s host once, an outsider never', () => {
    const v = new VoteBook(SIZE);
    // P3 hosts three bots in the roster and plays none itself; P4 is a spectator.
    const bots = new Map([[P3, ['b1', 'b2', 'b3']]]);
    const roster = new Set([P1, P2, 'b1', 'b2', 'b3']);
    const counts = (voter: string): boolean => roster.has(voter) || (bots.get(voter) ?? []).some((b) => roster.has(b));
    v.add(20, P3, hash(1));
    v.add(20, P4, hash(1));
    v.add(20, P1, hash(2));
    v.add(20, P2, hash(2));
    expect(v.tally(20, hash(2), counts)).toStrictEqual({ win: hash(2), agree: true, split: true });
    // Without P4's vote counted, the host's alone can't tie.
    v.add(21, P3, hash(1));
    v.add(21, P1, hash(2));
    expect(v.tally(21, hash(2), counts)).toStrictEqual({ win: hash(1), agree: false, split: true });
    v.add(22, P4, hash(3));
    expect(v.tally(22, hash(3), counts)).toBeNull();
  });

  it('is null with no counted vote, no hash of mine, or no votes at the tick', () => {
    const v = new VoteBook(SIZE);
    expect(v.tally(5, hash(1), everyone)).toBeNull();
    v.add(5, P1, hash(1));
    expect(v.tally(5, '', everyone)).toBeNull();
    expect(v.tally(5, hash(1), () => false)).toBeNull();
    expect(v.tally(5, hash(2), everyone)).toStrictEqual({ win: hash(1), agree: false, split: false });
  });

  it('keeps one vote per voter, its newest: a repaired vote replaces its stale one (design §3.1, §3.6)', () => {
    const v = new VoteBook(SIZE);
    v.add(30, P1, hash(7));
    v.add(30, P2, hash(8));
    v.add(30, ME, hash(7));
    expect(v.tally(30, hash(7), everyone)?.win).toBe(hash(7));
    v.add(30, P1, hash(8));
    expect(v.tally(30, hash(7), everyone)).toStrictEqual({ win: hash(8), agree: false, split: true });
    expect(v.voters(30, hash(7), ME)).toEqual([]);
  });

  it('gives the same result whatever order the votes arrive in, and the one a count of them gives', () => {
    const voters = [P1, P2, P3, P4, ME, player(0x99)];
    const ballot = fc.uniqueArray(fc.tuple(fc.constantFrom(...voters), fc.integer({ min: 1, max: 4 }), fc.nat()), {
      selector: ([voter]) => voter,
      maxLength: voters.length,
    });
    fc.assert(
      fc.property(ballot, fc.subarray(voters), fc.integer({ min: 0, max: 4 }), (rows, inRoster, mine) => {
        const counts = (voter: string): boolean => inRoster.includes(voter);
        const results = [rows, [...rows].sort((a, b) => a[2] - b[2]), [...rows].reverse()].map((order): TallyResult | null => {
          const v = new VoteBook(SIZE);
          for (const [voter, h] of order) v.add(40, voter, hash(h));
          return v.tally(40, mine === 0 ? '' : hash(mine), counts);
        });
        // The count: per hash, the counted voters; the most, then the smallest hash.
        const tally = new Map<number, number>();
        for (const [voter, h] of rows) if (counts(voter)) tally.set(h, (tally.get(h) ?? 0) + 1);
        const [win] = [...tally].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] ?? [];
        const want = mine === 0 || win === undefined ? null : { win: hash(win), agree: win === mine, split: tally.size > 1 };
        for (const r of results) expect(r).toStrictEqual(want);
      }),
      { numRuns: 300 },
    );
  });
});

describe('a resync’s candidates (design §3.4)', () => {
  it('are the voters for a hash at a tick, but me, sorted by ID with `<`', () => {
    const v = new VoteBook(SIZE);
    // By code unit 'F' sorts before 'a', where a locale's order puts 'a' first.
    const [upper, lower] = ['F'.repeat(32), 'a'.repeat(32)];
    for (const voter of [P3, lower, ME, P1, upper, P2]) v.add(50, voter, voter === P2 ? hash(2) : hash(1));
    expect(v.voters(50, hash(1), ME)).toEqual([P1, P3, upper, lower]);
    expect(v.voters(50, hash(2), ME)).toEqual([P2]);
    expect(v.voters(50, hash(3), ME)).toEqual([]);
    expect(v.voters(51, hash(1), ME)).toEqual([]);
  });
});

describe('the losers of a tally (design §3.6, M3 phase 4)', () => {
  it('are the counted voters for any hash but the winner, me included, sorted by ID with `<`', () => {
    const v = new VoteBook(SIZE);
    const [upper, lower] = ['F'.repeat(32), 'a'.repeat(32)];
    for (const [voter, h] of [[lower, 3], [P2, 1], [ME, 2], [upper, 3], [P1, 1], [P3, 4]] as const) v.add(60, voter, hash(h));
    expect(v.losers(60, hash(1), everyone)).toEqual([P3, ME, upper, lower]);
    // Only counted votes lose: an outsider's never.
    expect(v.losers(60, hash(1), (voter) => voter !== P3 && voter !== lower)).toEqual([ME, upper]);
    expect(v.losers(60, hash(9), (voter) => voter === P1)).toEqual([P1]);
    expect([v.losers(61, hash(1), everyone), v.losers(-1, hash(1), everyone)]).toEqual([[], []]);
    v.retire(60);
    expect(v.losers(60, hash(1), everyone)).toEqual([]);
  });
});

describe('the ring: a slot is reused only once its tick is retired (design §2.12)', () => {
  it('drops a retired tick’s votes, refuses votes for it, and reuses its slot', () => {
    const v = new VoteBook(8);
    v.add(3, P1, hash(1));
    expect(v.add(11, P1, hash(2))).toBe(false); // slot 3 holds a needed tick
    expect(v.tally(3, hash(1), everyone)?.win).toBe(hash(1));
    v.retire(3);
    expect([v.tally(3, hash(1), everyone), v.voters(3, hash(1), ME), v.add(3, P2, hash(1)), v.add(1, P2, hash(1))]).toEqual([null, [], false, false]);
    expect(v.add(11, P1, hash(2))).toBe(true);
    expect(v.tally(11, hash(2), everyone)).toStrictEqual({ win: hash(2), agree: true, split: false });
    // Retiring never moves back.
    v.retire(2);
    expect(v.add(3, P2, hash(1))).toBe(false);
  });

  it('refuses ticks that are no ticks', () => {
    const v = new VoteBook(8);
    for (const t of [-1, 2.5, Number.NaN, Infinity, 2 ** 53]) {
      expect(v.add(t, P1, hash(1))).toBe(false);
      expect([v.tally(t, hash(1), everyone), v.voters(t, hash(1), ME)]).toEqual([null, []]);
    }
    expect(v.add(0xfffffffe, P1, hash(1))).toBe(true);
    expect(() => new VoteBook(0)).toThrow(RangeError);
  });

  it('keeps every vote it took until its tick retires, and refuses only a retired tick or a slot a needed tick holds', () => {
    const size = 8;
    const step = fc.oneof(
      { weight: 5, arbitrary: fc.record({ t: fc.integer({ min: 0, max: 40 }), voter: fc.constantFrom(P1, P2, P3), h: fc.integer({ min: 1, max: 3 }) }) },
      { weight: 1, arbitrary: fc.record({ retire: fc.integer({ min: -1, max: 40 }) }) },
    );
    fc.assert(
      fc.property(fc.array(step, { maxLength: 80 }), (steps) => {
        const v = new VoteBook(size);
        // What disagrees with the model, asserted once: an expect a tick would take seconds.
        const wrong: string[] = [];
        let retired = -1;
        const held = new Map<number, number>(); // slot → its tick
        const book = new Map<number, Map<string, string>>(); // tick → voter → hash
        steps.forEach((s, n) => {
          if ('retire' in s) {
            v.retire(s.retire);
            retired = Math.max(retired, s.retire);
          } else {
            const h = held.get(s.t % size);
            const ok = s.t > retired && (h === undefined || h === s.t || h <= retired);
            if (v.add(s.t, s.voter, hash(s.h)) !== ok) wrong.push(`step ${n}: add ${s.t} ${ok ? 'refused' : 'taken'}`);
            if (ok) {
              if (h !== s.t) {
                if (h !== undefined) book.delete(h);
                held.set(s.t % size, s.t);
              }
              const votes = book.get(s.t) ?? new Map<string, string>();
              book.set(s.t, votes.set(s.voter, hash(s.h)));
            }
          }
          for (let t = 0; t <= 40; t++) {
            const votes = t > retired && held.get(t % size) === t ? (book.get(t) ?? new Map<string, string>()) : new Map<string, string>();
            for (let h = 1; h <= 3; h++) {
              const want = [...votes].filter(([, x]) => x === hash(h)).map(([voter]) => voter).sort().join();
              const got = v.voters(t, hash(h), ME).join();
              if (got !== want) wrong.push(`after step ${n}, tick ${t}, hash ${h}: ${got}, not ${want}`);
            }
          }
        });
        expect(wrong.slice(0, 5)).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});
