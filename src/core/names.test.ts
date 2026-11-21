import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fitName, shownName } from './names';
import { cleanName, defaultParams, nameAllowed } from './sim/index';

// Display names (M4's design §1.35, §9.2; PLAN C-17): a typed name fitted
// by fitName is one the simulation's cleanName keeps, for any string,
// unpaired surrogates and every control unit among them; roslambo's cases;
// and the label of a terrier without a name.

const P = defaultParams;

/** Any UTF-16 string: lone surrogates, C0, DEL and C1 included, which fast-check's text units rarely make. */
const units = fc.array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 60 }).map((us) => String.fromCharCode(...us));
const anyString = fc.oneof(units, fc.string({ unit: 'binary', maxLength: 60 }), fc.string({ maxLength: 60 }));

describe('fitName (C-17)', () => {
  it('makes a name cleanName keeps, for any string', () => {
    fc.assert(
      fc.property(anyString, (s) => {
        const name = fitName(s);
        expect(nameAllowed(name, P)).toBe(true);
        expect(cleanName(name, P)).toBe(name);
        expect(fitName(name)).toBe(name); // fitted once, fitted for good
        expect(name).toBe(name.trim());
      }),
      { numRuns: 2000 },
    );
  });

  it('keeps a name the rule allows, once trimmed', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 30 }), (s) => {
        const t = s.trim();
        if (nameAllowed(t, P)) expect(fitName(s)).toBe(t);
      }),
      { numRuns: 2000 },
    );
  });

  it('keeps a short name and trims spaces', () => {
    expect(fitName('  Ada  ')).toBe('Ada');
    expect(fitName('Ada Lovelace')).toBe('Ada Lovelace');
    expect(fitName('')).toBe('');
    expect(fitName('   ')).toBe('');
  });

  it('cuts to 20 characters, counting code points rather than code units', () => {
    expect(fitName('x'.repeat(25))).toBe('x'.repeat(20));
    expect([...fitName('🐕'.repeat(25))]).toHaveLength(8); // 4 bytes each, so the byte limit binds
    expect(fitName(`${'x'.repeat(19)} y`)).toBe('x'.repeat(19)); // the cut leaves a space, trimmed
  });

  it('cuts to 32 bytes on a code point', () => {
    expect(fitName('é'.repeat(20))).toBe('é'.repeat(16)); // 2 bytes each
    expect(fitName(`${'é'.repeat(15)}aa`)).toBe(`${'é'.repeat(15)}aa`); // 32 bytes exactly
    expect(fitName(`${'é'.repeat(16)}a`)).toBe('é'.repeat(16)); // 33: the a goes
    expect(fitName(`${'é'.repeat(14)}🐕`)).toBe(`${'é'.repeat(14)}🐕`); // 32 with a pair
    expect(fitName(`${'é'.repeat(15)}🐕`)).toBe('é'.repeat(15)); // 34: the pair goes whole, never half of it
  });

  it('drops control units, C0, DEL and C1, and lone surrogates', () => {
    expect(fitName('a\u0000b\nc\u007f')).toBe('abc');
    expect(fitName('a\u0085b\u009fc\u0080')).toBe('abc');
    expect(fitName('a\ud800b')).toBe('ab'); // a high surrogate alone
    expect(fitName('a\udc00b')).toBe('ab'); // a low one alone
    expect(fitName('\udc00🐕\ud800')).toBe('🐕'); // a pair kept between two strays
    expect(fitName('\t Ada \n')).toBe('Ada');
  });
});

describe('shownName (M4\'s design §6)', () => {
  it('shows the name, or for a terrier without one "Player" and four hex digits of its ID', () => {
    const id = `3f2a${'0'.repeat(28)}`;
    expect(shownName('Ada', id)).toBe('Ada');
    expect(shownName('', id)).toBe('Player 3F2A');
    expect(shownName('Bot 1A2B', id)).toBe('Bot 1A2B');
  });
});
