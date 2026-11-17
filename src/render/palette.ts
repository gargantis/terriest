// The pitch's colours: placeholders, from the M0 spike's look.ts, until
// M4's look book (PLAN §12, Q-11). Each pack has a colour and a pattern
// (L43), so the packs differ in pattern as well as colour, and a half and
// its goal carry the pack that defends it (L68). Pack A, 0, defends the
// goal at −x (D-4).

export type Pattern = 'plain' | 'striped';

export const PACKS: readonly [{ colour: number; pattern: Pattern }, { colour: number; pattern: Pattern }] = [
  { colour: 0x2f6bd8, pattern: 'plain' },
  { colour: 0xf07a1a, pattern: 'striped' },
];

export const SKY = 0xa9d3ef;
export const GRASS = 0x5c9e46;
export const LINE = 0xf4f4ee;
/** The walls above their padding. */
export const WALL_PANEL = 0xe6ecef;
export const ROPE = 0xcdb98c;
export const NETTING = 0xf6f6f2;
export const WHITE = 0xffffff;
