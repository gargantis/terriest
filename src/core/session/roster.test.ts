import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { botIds, personId } from '../bot/bot-id';
import { ZERO_HASH } from '../protocol/messages';
import { defaultParams, genesis, newTerrier } from '../sim/index';
import { admits, againTimelineId, freePlaces, inRoster, outranks, spectatorsOverCap } from './roster';

// The roster's questions (PLAN D-17, D-21, C-11, P7; M3's design,
// research/m3/DESIGN.md, §1.10, §4.3, §4.5, M3-Q16): who is in it, the free
// places, D-21's admission count and spectator cap, and which of two
// timelines a room keeps: outranks, and Play again's IDs (Q-7, P7, §4.9).

const P = defaultParams;
const host = personId(23, 0);
const other = personId(23, 1);
const bots = (h: string): readonly string[] => botIds(h);

describe('inRoster (D-17, D-21)', () => {
  it('finds a player, or a bot derived from it, and nobody else', () => {
    expect(inRoster(host, new Set([host]), bots)).toBe(true);
    expect(inRoster(host, new Set([botIds(host)[5]!]), bots)).toBe(true);
    expect(inRoster(host, new Set([other, botIds(other)[0]!]), bots)).toBe(false);
    expect(inRoster(host, new Set(), bots)).toBe(false);
  });
});

describe('freePlaces', () => {
  it('is twice the pack size less the terriers', () => {
    const s = genesis({ packSize: 2, matchMinutes: 1 }, P);
    expect(freePlaces(s)).toBe(4);
    for (const [k, id] of [host, other, botIds(host)[0]!].entries()) s.terriers.push(newTerrier(id, 'x', k % 2 === 0 ? 0 : 1, 0, 1, P));
    expect(freePlaces(s)).toBe(1);
  });
});

describe('admits (D-21, M3-Q16)', () => {
  const o = { holdsState: true, outsideConnected: 0, reserved: 0, selfOutside: false, freePlaces: 0, spectatorsMax: 4 };

  it('admits every HELLO without the state', () => {
    expect(admits({ ...o, holdsState: false, outsideConnected: 99, reserved: 99, selfOutside: true })).toBe(true);
  });

  it('counts the connected browsers outside the roster, the handshakes it admitted, and itself, never the newcomer', () => {
    expect(admits({ ...o, outsideConnected: 3 })).toBe(true);
    // A fifth spectator, with four connected and no place free.
    expect(admits({ ...o, outsideConnected: 4 })).toBe(false);
    expect(admits({ ...o, outsideConnected: 2, reserved: 2 })).toBe(false);
    expect(admits({ ...o, outsideConnected: 3, selfOutside: true })).toBe(false);
    expect(admits({ ...o, outsideConnected: 2, reserved: 1 })).toBe(true);
  });

  it('adds the free places to the cap', () => {
    expect(admits({ ...o, outsideConnected: 4, freePlaces: 1 })).toBe(true);
    expect(admits({ ...o, outsideConnected: 4, reserved: 1, freePlaces: 1 })).toBe(false);
    expect(admits({ ...o, outsideConnected: 0, reserved: 11, freePlaces: 8, spectatorsMax: 4 })).toBe(true);
    expect(admits({ ...o, outsideConnected: 0, reserved: 12, freePlaces: 8, spectatorsMax: 4 })).toBe(false);
  });
});

describe('spectatorsOverCap (D-21, C-11)', () => {
  it('is over the cap with the spectators announced and itself past it', () => {
    expect(spectatorsOverCap(4, 4)).toBe(false);
    expect(spectatorsOverCap(5, 4)).toBe(true);
    expect(spectatorsOverCap(1, 0)).toBe(true);
  });
});

describe('outranks (Q-7, P7; M3 phase 4a)', () => {
  const tie = 60;

  it('takes the older timeline past the tie, and the smaller ID within it', () => {
    expect(outranks('2222222222222222', 161, '1111111111111111', 100, tie)).toBe(true);
    expect(outranks('1111111111111111', 100, '2222222222222222', 161, tie)).toBe(false);
    expect(outranks('1111111111111111', 100, '2222222222222222', 160, tie)).toBe(true);
    expect(outranks('2222222222222222', 160, '1111111111111111', 100, tie)).toBe(false);
    expect(outranks('1111111111111111', 100, '1111111111111111', 100, tie)).toBe(false);
  });

  it('ranks two different timelines one way, whoever compares them', () => {
    const hex = fc.stringMatching(/^[0-9a-f]{16}$/);
    const age = fc.double({ min: 0, max: 40000, noNaN: true });
    fc.assert(
      fc.property(hex, age, hex, age, (a, x, b, y) => {
        fc.pre(a !== b);
        expect(outranks(a, x, b, y, tie) !== outranks(b, y, a, x, tie)).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });
});

describe("againTimelineId (§4.9; M3 phase 4)", () => {
  const r = (...b: number[]): Uint8Array => Uint8Array.from(b);

  it('is the press tick as a big-endian u32, then 4 random bytes, in lowercase hex', () => {
    expect(againTimelineId(0x0a0b0c0d, r(0xde, 0xad, 0xbe, 0xef, 9, 9))).toBe('0a0b0c0ddeadbeef');
    expect(againTimelineId(36000, r(1, 2, 3, 4))).toBe('00008ca001020304');
    expect(againTimelineId(12.9, r(0, 0, 0, 5))).toBe('0000000c00000005');
  });

  it('holds the tick to the u32 and is never all zero, which means none', () => {
    expect(againTimelineId(0, r(0, 0, 0, 0))).not.toBe(ZERO_HASH);
    expect(againTimelineId(0, r(0, 0, 0, 0))).toBe('0000000000000001');
    expect(againTimelineId(-5, r(0, 0, 0, 0))).toBe('0000000000000001');
    expect(againTimelineId(Number.NaN, r(0, 0, 0, 7))).toBe('0000000000000007');
    expect(againTimelineId(2 ** 40, r(0, 0, 0, 1))).toBe('ffffffff00000001');
    expect(() => againTimelineId(5, r(1, 2, 3))).toThrow(RangeError);
  });

  it('gives an earlier press the smaller ID, whatever the random bytes', () => {
    const bytes = fc.uint8Array({ minLength: 4, maxLength: 4 });
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xfffffffe }), fc.integer({ min: 1, max: 1000 }), bytes, bytes, (t, gap, x, y) => {
        expect(againTimelineId(t, x) < againTimelineId(Math.min(t + gap, 0xffffffff), y)).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  // The point of the ID: pages estimate the two new timelines' ages with errors, and outranks then
  // picks the earlier press on every page, at any spacing, the tie's edge included, so presses of one
  // old match never split a room or rank in a cycle. With estimates within a quarter of the tie each
  // way, an age gap past the tie comes only from presses more than half the tie apart, where the
  // older is the earlier; within the tie the smaller ID is the earlier.
  it("ranks presses a tie and a tick apart alike on a page that sees a tie and on one that doesn't", () => {
    const a = againTimelineId(1000, r(0xff, 0xff, 0xff, 0xff)); // the earlier press, its random part the larger
    const b = againTimelineId(1061, r(0, 0, 0, 1));
    expect(outranks(a, 9061 - 1, b, 9000, 60)).toBe(true); // ages 60 apart here: a tie, the smaller ID
    expect(outranks(a, 9061 + 1, b, 9000, 60)).toBe(true); // 62 apart there: the older
    expect(outranks(b, 9000, a, 9061 - 1, 60)).toBe(false);
  });

  it('makes every page rank the presses of one old match alike, at any spacing, and never in a cycle', () => {
    const tie = 60;
    const err = fc.double({ min: -tie / 4, max: tie / 4, noNaN: true });
    // Spacings of up to two and a half ties, so most pairs sit near the tie's edge.
    const offsets = fc.uniqueArray(fc.integer({ min: 0, max: 150 }), { minLength: 3, maxLength: 3 });
    const randoms = fc.array(fc.uint8Array({ minLength: 4, maxLength: 4 }), { minLength: 3, maxLength: 3 });
    const pressesOf = fc.tuple(fc.integer({ min: 0, max: 36000 }), offsets, randoms).map(([base, o, rs]) => o.map((x, i) => ({ tick: base + x, random: rs[i]! })));
    fc.assert(
      fc.property(pressesOf, fc.array(fc.array(err, { minLength: 3, maxLength: 3 }), { minLength: 4, maxLength: 4 }), (presses, pages) => {
        const now = 40000;
        const ids = presses.map((p) => againTimelineId(p.tick, p.random));
        const earliest = presses.reduce((m, p, i) => (p.tick < presses[m]!.tick ? i : m), 0);
        for (const e of pages) {
          const age = (i: number): number => now - presses[i]!.tick + e[i]!;
          for (let i = 0; i < 3; i++)
            for (let j = 0; j < 3; j++) {
              if (i === j) continue;
              const earlier = presses[i]!.tick < presses[j]!.tick;
              expect(outranks(ids[i]!, age(i), ids[j]!, age(j), tie)).toBe(earlier);
            }
          const best = [0, 1, 2].find((i) => [0, 1, 2].every((j) => j === i || outranks(ids[i]!, age(i), ids[j]!, age(j), tie)));
          expect(best).toBe(earliest);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
