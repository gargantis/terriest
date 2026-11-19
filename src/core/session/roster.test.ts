import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { botIds, personId } from '../bot/bot-id';
import { type Hello, PROTOCOL_VERSION, ROLE, T, TIMELINE_KIND, ZERO_HASH } from '../protocol/messages';
import { defaultParams, genesis, newTerrier } from '../sim/index';
import { admits, beats, freePlaces, inRoster, spectatorsOverCap } from './roster';

// The roster's questions (PLAN D-17, D-21, C-11, P7; M3's design,
// research/m3/DESIGN.md, §1.10, §4.3, §4.5, M3-Q16): who is in it, the free
// places, D-21's admission count and spectator cap, and which of two
// timelines a room keeps (roslambo D-12, Q-7, without saves).

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

describe('beats (roslambo D-12, Q-7, P7)', () => {
  const hello = (o: Partial<Hello>): Hello => ({
    type: T.HELLO, protocol: PROTOCOL_VERSION, build: '0123456789abcdef', player: host, role: ROLE.PLAYER,
    timeline: '1111111111111111', timelineKind: TIMELINE_KIND.LIVE, phase: 0, finalTick: 100, hash: 'aaaaaaaaaaaaaaaa', name: '', ...o,
  });
  const none = hello({ timeline: ZERO_HASH, timelineKind: TIMELINE_KIND.NONE, finalTick: 0, hash: ZERO_HASH });

  it('takes a live timeline over none, and none over nothing', () => {
    expect(beats(hello({}), none)).toBe(true);
    expect(beats(none, hello({}))).toBe(false);
    expect(beats(none, none)).toBe(false);
  });

  it('takes the later final tick, the older timeline; then the smaller hash; then the smaller ID', () => {
    expect(beats(hello({ finalTick: 101 }), hello({}))).toBe(true);
    expect(beats(hello({}), hello({ finalTick: 101 }))).toBe(false);
    expect(beats(hello({ hash: '0aaaaaaaaaaaaaaa' }), hello({}))).toBe(true);
    expect(beats(hello({ timeline: '0111111111111111' }), hello({}))).toBe(true);
    expect(beats(hello({}), hello({}))).toBe(false);
  });

  it('orders live HELLOs strictly, whoever compares them: one beats the other, never both, and transitively', () => {
    const hex = (n: number): fc.Arbitrary<string> => fc.stringMatching(new RegExp(`^[0-9a-f]{${n}}$`));
    const live = fc.record({ finalTick: fc.integer({ min: 0, max: 5 }), hash: fc.constantFrom('aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'), timeline: hex(16) }).map(hello);
    fc.assert(
      fc.property(live, live, live, (a, b, c) => {
        const same = a.finalTick === b.finalTick && a.hash === b.hash && a.timeline === b.timeline;
        expect(beats(a, b) && beats(b, a)).toBe(false);
        if (!same) expect(beats(a, b) || beats(b, a)).toBe(true);
        if (beats(a, b) && beats(b, c)) expect(beats(a, c)).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });
});
