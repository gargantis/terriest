import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatMatchId, generateMatchId, joinLink, matchIdFromHash, nextMatchId, normalizeMatchId } from './match-id';

const SHAPE = /^[0-9A-HJKMNP-TV-Z]{21}$/;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** The first 100 bits of SHA-256(prefix + id) as 20 characters, worked out
 *  apart from the module's own encoder. */
async function derivedBody(prefix: string, id: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(prefix + id)));
  const bits = Array.from(digest, (b) => b.toString(2).padStart(8, '0')).join('').slice(0, 100);
  return bits.replace(/.{5}/g, (five) => ALPHABET[parseInt(five, 2)]!);
}

describe('match ID', () => {
  it('generates 21 Crockford characters with a valid check', () => {
    for (let i = 0; i < 100; i++) {
      const id = generateMatchId();
      expect(id).toMatch(SHAPE);
      expect(normalizeMatchId(id)).toBe(id);
    }
  });

  it('formats in groups of four', () => {
    expect(formatMatchId('K7QM2XDP4TR8WHZN3VBCK')).toBe('K7QM-2XDP-4TR8-WHZN-3VBC-K');
  });

  it('accepts the documented example and rejects the old one, which fails its check (C-15)', () => {
    expect(normalizeMatchId('K7QM-2XDP-4TR8-WHZN-3VBC-K')).toBe('K7QM2XDP4TR8WHZN3VBCK');
    expect(normalizeMatchId('K7QM-2XDP-4TR8-WHZN-3VBC-7')).toBeNull();
  });

  it('accepts dashes, spaces, lowercase and the Crockford look-alikes', () => {
    const id = generateMatchId();
    expect(normalizeMatchId(formatMatchId(id).toLowerCase())).toBe(id);
    expect(normalizeMatchId(formatMatchId(id).replace(/-/g, ' '))).toBe(id);
    expect(normalizeMatchId(id.replace(/0/g, 'O').replace(/1/g, 'I'))).toBe(id);
    expect(normalizeMatchId(id.replace(/1/g, 'l'))).toBe(id);
  });

  it('rejects every single wrong character', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), fc.integer({ min: 1, max: 31 }), (pos, shift) => {
        const id = generateMatchId();
        const swapped = ALPHABET[(ALPHABET.indexOf(id[pos]!) + shift) % 32]!;
        const bad = id.slice(0, pos) + swapped + id.slice(pos + 1);
        return normalizeMatchId(bad) === null;
      }),
    );
  });

  it('rejects wrong lengths and letters outside the alphabet', () => {
    const id = generateMatchId();
    expect(normalizeMatchId(id.slice(0, 20))).toBeNull();
    expect(normalizeMatchId(id + '0')).toBeNull();
    expect(normalizeMatchId('')).toBeNull();
    expect(normalizeMatchId('UUUU-UUUU-UUUU-UUUU-UUUU-U')).toBeNull();
  });

  it('derives the same Play again ID for every press, and a different one each match (C-42)', async () => {
    const id = generateMatchId();
    const next = await nextMatchId(id);
    expect(next).toMatch(SHAPE);
    expect(normalizeMatchId(next)).toBe(next);
    expect(await nextMatchId(id)).toBe(next);
    expect(next).not.toBe(id);
    expect(await nextMatchId(next)).not.toBe(next);
  });

  it("derives Play again with terriest's own prefix, not roslambo's (Q-2)", async () => {
    const id = generateMatchId();
    const next = await nextMatchId(id);
    expect(next.slice(0, 20)).toBe(await derivedBody('terriest again', id));
    expect(next.slice(0, 20)).not.toBe(await derivedBody('roslambo again', id));
  });

  it('reads and writes #join= links', () => {
    const id = generateMatchId();
    const link = joinLink('https://example.test/play/?x=1#old', id);
    expect(link).toBe(`https://example.test/play/?x=1#join=${id}`);
    expect(matchIdFromHash(`#join=${id}`)).toBe(id);
    expect(matchIdFromHash(`#join=${formatMatchId(id).toLowerCase()}`)).toBe(id);
    expect(matchIdFromHash('#join=nonsense')).toBeNull();
    expect(matchIdFromHash('')).toBeNull();
  });

  it('reads escapes in #join= links, and a malformed one as no ID, never throwing', () => {
    const id = generateMatchId();
    expect(matchIdFromHash(`#join=${encodeURIComponent(formatMatchId(id).replace(/-/g, ' '))}`)).toBe(id);
    expect(matchIdFromHash('#join=%')).toBeNull();
    expect(matchIdFromHash('#join=%E0%A4%A')).toBeNull();
    const unit = fc.constantFrom('%', '0', '2', 'A', 'E', 'k', '-', ' ', '&');
    fc.assert(
      fc.property(fc.string({ unit }), (s) => {
        matchIdFromHash(`#join=${s}`);
      }),
    );
  });
});
