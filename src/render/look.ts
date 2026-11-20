// The look, defined apart from drawing (M4's design, research/m4/DESIGN.md,
// §1.11, §2.9; PLAN §12, D-27, Q-11; L43, L44): the coats, each pack's
// colour and pattern, the ball's and the pitch's colours, the code-built
// terrier's shape and the pack cue. The look book varies it, the owner
// picks one (Q-11), and both drawers paint from it. The state, storage and
// messages carry a coat as its index in the list and a pack as 0 or 1;
// only a Look turns them into colours and patterns. Three-free.
//
// PLACEHOLDER_LOOK is the M0 spike's (research/spike/src/scene/look.ts, its
// ball's colours and its terrier pose's SHAPE) and M1's pitch colours,
// until the owner's pick.

export type Markings = 'none' | 'ears' | 'points' | 'saddle';

/** A fur colour and markings, by its place in the list (L44). */
export interface Coat {
  readonly name: string;
  readonly fur: number;
  readonly marking: number;
  readonly markings: Markings;
}

export type Pattern = 'plain' | 'striped';

/** A pack's bandana: its colour and its pattern, so the packs differ in
 *  pattern as well as colour (L43). */
export interface PackLook {
  readonly name: string;
  readonly colour: number;
  readonly pattern: Pattern;
}

/** A shape cue that keeps a minimum size on screen (Q-11, C-51): none
 *  until the owner picks one (M4-Q29). */
export type PackCue = 'none' | 'marker' | 'ring';

export type V3 = readonly [number, number, number];

/** The code-built terrier's shape: the spike's SHAPE, as plain numbers, in
 *  metres, x forward and z up. The head's parts, its snout, eyes, nose and
 *  ears among them, are placed from the neck pivot; the rest from the
 *  terrier's floor point. */
export interface TerrierShape {
  readonly body: { readonly centre: V3; readonly radii: V3 };
  readonly neck: V3;
  readonly head: { readonly centre: V3; readonly radius: number };
  readonly snout: { readonly centre: V3; readonly radii: V3 };
  readonly eyes: { readonly centre: V3; readonly radius: number };
  readonly nose: { readonly centre: V3; readonly radius: number };
  readonly ear: { readonly pivot: V3; readonly radius: number; readonly height: number };
  readonly legs: {
    readonly radius: number; readonly length: number; readonly front: number; readonly back: number; readonly side: number; readonly top: number;
  };
  readonly tail: { readonly pivot: V3; readonly radius: number; readonly length: number };
  readonly bandana: { readonly centre: V3; readonly radius: number; readonly tube: number; readonly tilt: number };
}

export interface Look {
  readonly name: string;
  /** config.coatCount of them. */
  readonly coats: readonly Coat[];
  /** Pack A, 0, defends the goal at −x (D-4). */
  readonly packs: readonly [PackLook, PackLook];
  readonly ball: { readonly colour: number; readonly band: number };
  readonly pitch: {
    readonly sky: number; readonly grass: number; readonly line: number;
    /** The walls above their padding. */
    readonly wallPanel: number;
    readonly rope: number; readonly netting: number;
  };
  readonly terrier: TerrierShape;
  readonly packCue: PackCue;
}

/** The spike's look and palette, with its 8 coats. No coat uses a pack's colour (L43). */
export const PLACEHOLDER_LOOK: Look = {
  name: 'placeholder',
  coats: [
    { name: 'white', fur: 0xf2efe6, marking: 0xe4dccb, markings: 'none' },
    { name: 'wheaten', fur: 0xe0c08a, marking: 0xb8935c, markings: 'ears' },
    { name: 'black and tan', fur: 0x2d2b2e, marking: 0xa8764a, markings: 'points' },
    { name: 'tan, dark saddle', fur: 0xc98b4f, marking: 0x3b302b, markings: 'saddle' },
    { name: 'blue-grey', fur: 0x8b9099, marking: 0x5b6069, markings: 'ears' },
    { name: 'red', fur: 0x9c4a2a, marking: 0x6e3018, markings: 'points' },
    { name: 'cream, brown ears', fur: 0xefe2c4, marking: 0x8a5a35, markings: 'ears' },
    { name: 'brindle', fur: 0x7a5a3e, marking: 0x4a3524, markings: 'saddle' },
  ],
  packs: [
    { name: 'blue', colour: 0x2f6bd8, pattern: 'plain' },
    { name: 'orange', colour: 0xf07a1a, pattern: 'striped' },
  ],
  ball: { colour: 0xe0412f, band: 0xf7f3ea },
  pitch: { sky: 0xa9d3ef, grass: 0x5c9e46, line: 0xf4f4ee, wallPanel: 0xe6ecef, rope: 0xcdb98c, netting: 0xf6f6f2 },
  terrier: {
    body: { centre: [-0.03, 0, 0.215], radii: [0.19, 0.115, 0.095] },
    neck: [0.1, 0, 0.31],
    head: { centre: [0.05, 0, 0.05], radius: 0.105 },
    snout: { centre: [0.135, 0, 0.02], radii: [0.05, 0.05, 0.042] },
    eyes: { centre: [0.135, 0.045, 0.075], radius: 0.018 },
    nose: { centre: [0.182, 0, 0.035], radius: 0.02 },
    ear: { pivot: [0.03, 0.06, 0.11], radius: 0.036, height: 0.08 },
    legs: { radius: 0.036, length: 0.18, front: 0.1, back: -0.13, side: 0.065, top: 0.18 },
    tail: { pivot: [-0.19, 0, 0.255], radius: 0.022, length: 0.114 },
    bandana: { centre: [0.075, 0, 0.29], radius: 0.078, tube: 0.024, tilt: 0.89 },
  },
  packCue: 'none',
};

/** A coat outside the list draws as coat 0, as D-12 treats a JOIN's (L44). */
export function coatOf(look: Look, index: number): Coat {
  return look.coats[index] ?? look.coats[0]!;
}
