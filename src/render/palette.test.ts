import { Color, type Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { pitch } from '../core/sim/pitch';
import { type Look, PLACEHOLDER_LOOK } from './look';
import {
  APART, checkPalette, describeCheck, halfFloors, linearRgb, oklab, oklabDistance, PACKS_APART, seenDistance, simulate, srgbHex, VISIONS,
} from './palette-check';
import { drawPitch } from './pitch';

// PLAN §12's palette test (M4's design §1.12, §9.2; C-51, L43, L44, L68),
// roslambo's method by src/render/palette-check.ts: each coat against both
// packs' colours and the grass, the packs against each other, and each pack
// against both halves' floors, for normal vision and under protanopia,
// deuteranopia and tritanopia. It runs on the placeholder look now, and on
// the owner's pick at M5 (PLAN §17), which must pass it whole.

describe("the palette check's colour science (roslambo's)", () => {
  it('turns sRGB to linear light and back, to the byte', () => {
    expect(linearRgb(0xffffff)).toEqual([1, 1, 1]);
    expect(linearRgb(0x000000)).toEqual([0, 0, 0]);
    expect(linearRgb(0x808080)[0]).toBeCloseTo(0.2158605, 6);
    for (const hex of [0x000000, 0x010203, 0x2f6bd8, 0x5c9e46, 0x7f7f80, 0xf07a1a, 0xfefdfc, 0xffffff]) expect(srgbHex(linearRgb(hex))).toBe(hex);
    expect(srgbHex([2, -1, 0.5])).toBe(0xff00bc);
  });

  it("puts white at L 1 and sRGB's red where Ottosson's reference does", () => {
    const white = oklab([1, 1, 1]);
    expect(white[0]).toBeCloseTo(1, 6);
    expect(Math.hypot(white[1], white[2])).toBeLessThan(1e-6);
    const red = oklab(linearRgb(0xff0000));
    expect(red[0]).toBeCloseTo(0.627955, 5);
    expect(red[1]).toBeCloseTo(0.224863, 5);
    expect(red[2]).toBeCloseTo(0.125846, 5);
  });

  it('keeps greys grey under each dichromacy, and leaves normal vision alone', () => {
    for (const vision of VISIONS) {
      for (const v of [0, 0.2, 1]) for (const c of simulate(vision, [v, v, v])) expect(c, vision).toBeCloseTo(v, 5);
    }
    expect(simulate('normal', [0.9, 0.1, 0.3])).toEqual([0.9, 0.1, 0.3]);
  });

  it('confuses a colour with the colour a dichromat sees it as, which normal vision tells apart', () => {
    const as = (hex: number, vision: (typeof VISIONS)[number]): number => srgbHex(simulate(vision, linearRgb(hex)));
    // A red and the olive protanopia and deuteranopia make of it; a blue and the teal tritanopia does.
    const red = 0xd03020;
    for (const vision of ['protanopia', 'deuteranopia'] as const) {
      expect(seenDistance(red, as(red, vision), vision), vision).toBeLessThan(0.02);
      expect(seenDistance(red, as(red, vision), 'normal'), vision).toBeGreaterThan(0.15);
    }
    const blue = 0x2050e0;
    expect(seenDistance(blue, as(blue, 'tritanopia'), 'tritanopia')).toBeLessThan(seenDistance(blue, as(blue, 'tritanopia'), 'normal') / 3);
    expect(oklabDistance([0.5, 0, 0], [0.5, 0.03, 0.04])).toBeCloseTo(0.05, 12);
  });
});

describe("the halves' floors are the pitch's (L68, C-51)", () => {
  /** Each half's floor colours as the drawn pitch holds them, from its floor's vertex colours, by the half's x. */
  function drawnFloors(look: Look): [number[], number[]] {
    const drawn = drawPitch(pitch, { ropeSpacingMetres: 1, nettingSpacingMetres: 0.25, anisotropy: 1 }, look);
    const g = (drawn.object.getObjectByName('floor') as Mesh).geometry;
    const p = g.getAttribute('position');
    const c = g.getAttribute('color');
    const halves: [Set<number>, Set<number>] = [new Set(), new Set()];
    for (let i = 0; i < p.count; i += 3) {
      const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
      halves[x < 0 ? 0 : 1].add(new Color(c.getX(i), c.getY(i), c.getZ(i)).getHex());
    }
    drawn.dispose();
    return [[...halves[0]].sort(), [...halves[1]].sort()];
  }
  const near = (a: number, b: number): boolean => [16, 8, 0].every((s) => Math.abs(((a >> s) & 255) - ((b >> s) & 255)) <= 1);

  const swapped: Look = {
    ...PLACEHOLDER_LOOK,
    packs: [{ name: 'green', colour: 0x22aa44, pattern: 'striped' }, { name: 'purple', colour: 0x8844cc, pattern: 'plain' }],
    pitch: { ...PLACEHOLDER_LOOK.pitch, grass: 0x406030 },
  };

  for (const [name, look] of [['the placeholder', PLACEHOLDER_LOOK], ['a look with its patterns swapped', swapped]] as const) {
    it(`checks each pack against the floors the pitch draws: ${name}`, () => {
      const drawn = drawnFloors(look);
      const checked = halfFloors(look);
      for (const h of [0, 1] as const) {
        expect(checked[h], `half ${h}`).toHaveLength(look.packs[h].pattern === 'plain' ? 1 : 2);
        expect(drawn[h], `half ${h}`).toHaveLength(checked[h].length);
        for (const colour of checked[h]) expect(drawn[h].some((d) => near(d, colour)), `half ${h}: ${colour.toString(16)}`).toBe(true);
      }
    });
  }
});

describe('the palette check (PLAN §12, C-51)', () => {
  // Blue and yellow packs, three coats: a look that passes, for the check's own sake, never a proposal.
  const passing: Look = {
    ...PLACEHOLDER_LOOK,
    name: 'passing',
    coats: [PLACEHOLDER_LOOK.coats[0]!, PLACEHOLDER_LOOK.coats[4]!, { name: 'black, white points', fur: 0x2d2b2e, marking: 0xf2efe6, markings: 'points' }],
    packs: [PLACEHOLDER_LOOK.packs[0], { name: 'yellow', colour: 0xf5c400, pattern: 'striped' }],
  };
  const failed = (look: Look): string[] => checkPalette(look).failures.map((c) => `${c.vision}: ${c.what}`);

  it('passes a look whose colours stay apart for every vision, and lists every pair it checked', () => {
    const v = checkPalette(passing);
    expect(v.failures.map(describeCheck)).toEqual([]);
    expect(v.pass).toBe(true);
    // Each coat's fur, and its markings' colour where they show, against two packs and the grass; the packs; and
    // each pack against its own half's floor and the other's, a striped half's two bands apart: under four visions.
    const coatColours = 1 + 2 + 2;
    const floors = 1 + 2;
    expect(v.checks).toHaveLength(4 * (coatColours * 3 + 1 + 2 * floors));
    expect(new Set(v.checks.map((c) => c.vision))).toEqual(new Set(VISIONS));
    expect(v.checks.filter((c) => c.what === 'pack A (blue) against pack B (yellow)').map((c) => c.min)).toEqual([PACKS_APART, PACKS_APART, PACKS_APART, PACKS_APART]);
    expect(v.checks.every((c) => c.min === (c.what === 'pack A (blue) against pack B (yellow)' ? PACKS_APART : APART))).toBe(true);
  });

  it('fails a coat in a pack\'s colour, or in the grass\'s, for every vision (L43)', () => {
    const inPack: Look = { ...passing, coats: [...passing.coats.slice(0, 2), { name: 'blue', fur: 0x2f6bd8, marking: 0, markings: 'none' }] };
    expect(failed(inPack)).toEqual(VISIONS.map((v) => `${v}: coat 2 (blue) fur against pack A (blue)`));
    const inGrass: Look = { ...passing, coats: [{ ...passing.coats[1]!, marking: passing.pitch.grass }, ...passing.coats.slice(1)] };
    expect(failed(inGrass)).toEqual(VISIONS.map((v) => `${v}: coat 0 (blue-grey) marking against the grass`));
  });

  it("checks a coat's marking colour only where its markings show", () => {
    const hidden: Look = { ...passing, coats: [{ ...passing.coats[0]!, marking: passing.packs[1].colour }, ...passing.coats.slice(1)] };
    expect(hidden.coats[0]!.markings).toBe('none');
    expect(checkPalette(hidden).pass).toBe(true);
  });

  it("fails packs that a dichromacy can't tell apart, though normal vision can", () => {
    // Blue and a purple: apart for normal vision, nearly one for deuteranopia.
    const purple: Look = { ...passing, packs: [passing.packs[0], { ...passing.packs[1], colour: 0x9b30d9 }] };
    const packs = failed(purple).filter((f) => f.includes('pack A (blue) against pack B'));
    expect(packs).toEqual(['protanopia: pack A (blue) against pack B (yellow)', 'deuteranopia: pack A (blue) against pack B (yellow)']);
  });

  it("fails a pack lost against a half's floor, its own or the other's (C-51)", () => {
    // Grass in pack B's colour: pack B's floor is its own colour, and pack A's is close to it.
    const lost: Look = { ...passing, pitch: { ...passing.pitch, grass: passing.packs[1].colour } };
    const floors = failed(lost).filter((f) => f.includes('half'));
    expect(floors).toContain('normal: pack B (yellow) against pack B (yellow)\'s half, band 1 of 2');
    expect(floors).toContain('normal: pack B (yellow) against pack B (yellow)\'s half, band 2 of 2');
    expect(floors).toContain('tritanopia: pack B (yellow) against pack A (blue)\'s half');
  });

  it("finds the placeholder look's packs apart for every vision, and pins its other failures for the owner's pick (Q-11)", () => {
    const v = checkPalette(PLACEHOLDER_LOOK);
    expect(v.checks.filter((c) => c.what.startsWith('pack A (blue) against pack B')).every((c) => c.distance >= PACKS_APART)).toBe(true);
    // The placeholder, the spike's look, fails seven pairs, all under protanopia or deuteranopia: its tan coat beside
    // the orange pack and the grass, two coats' markings on the grass, and the orange pack on its own half. The look
    // book shows them (§1.60), and M5's default, the owner's pick, must have none. A change to this list is a change
    // to the look: say so, and keep it here until the pick replaces the placeholder.
    expect(failed(PLACEHOLDER_LOOK)).toEqual([
      'protanopia: coat 1 (wheaten) marking against the grass',
      'deuteranopia: coat 2 (black and tan) marking against the grass',
      'protanopia: coat 3 (tan, dark saddle) fur against pack B (orange)',
      'deuteranopia: coat 3 (tan, dark saddle) fur against pack B (orange)',
      'protanopia: coat 3 (tan, dark saddle) fur against the grass',
      'protanopia: pack B (orange) against pack B (orange)\'s half, band 1 of 2',
      'protanopia: pack B (orange) against pack B (orange)\'s half, band 2 of 2',
    ]);
    expect(v.pass).toBe(false);
  });
});
