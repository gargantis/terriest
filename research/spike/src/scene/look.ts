// Placeholder colours for the spike (PLAN §12: the look is picked at M4,
// Q-11). A coat is a fur colour and markings, defined apart from drawing and
// referred to by its index (L44); each pack has a colour and a pattern (L43).

export type Markings = 'none' | 'ears' | 'points' | 'saddle';

export interface Coat {
  name: string;
  fur: number;
  marking: number;
  markings: Markings;
}

export const COATS: readonly Coat[] = [
  { name: 'white', fur: 0xf2efe6, marking: 0xe4dccb, markings: 'none' },
  { name: 'wheaten', fur: 0xe0c08a, marking: 0xb8935c, markings: 'ears' },
  { name: 'black and tan', fur: 0x2d2b2e, marking: 0xa8764a, markings: 'points' },
  { name: 'tan, dark saddle', fur: 0xc98b4f, marking: 0x3b302b, markings: 'saddle' },
  { name: 'blue-grey', fur: 0x8b9099, marking: 0x5b6069, markings: 'ears' },
  { name: 'red', fur: 0x9c4a2a, marking: 0x6e3018, markings: 'points' },
  { name: 'cream, brown ears', fur: 0xefe2c4, marking: 0x8a5a35, markings: 'ears' },
  { name: 'brindle', fur: 0x7a5a3e, marking: 0x4a3524, markings: 'saddle' },
];

export function coatOf(index: number): Coat {
  // A coat outside the list draws as coat 0, as D-12 treats a bad JOIN.
  return COATS[index] ?? COATS[0]!;
}

/** Pack 0 is plain, pack 1 striped, so the packs differ in pattern as well as colour. */
export const PACKS = [
  { colour: 0x2f6bd8, pattern: 'plain' },
  { colour: 0xf07a1a, pattern: 'striped' },
] as const;

export const GRASS = 0x5c9e46;
export const LINE = 0xf4f4ee;
export const SKY = 0xa9d3ef;
