import { describe, expect, it } from 'vitest';
import { type BufferGeometry, Color, type LineSegments, type Mesh } from 'three';
import { insideFloorPlan, pitch, type Point } from '../core/sim/pitch';
import { type Look, PLACEHOLDER_LOOK } from './look';
import { drawPitch } from './pitch';

// The empty pitch as drawn from the simulation's pieces (PLAN §12, D-4,
// L68), checked on its geometry, without a GPU: M1's, with M4's look
// (M4's design §1.11, §1.18), its parts apart, and each occluder's other
// variant (§2.6).
const detail = { ropeSpacingMetres: 1, nettingSpacingMetres: 0.25, anisotropy: 1 };
const drawn = drawPitch(pitch, detail, PLACEHOLDER_LOOK);
const PACKS = PLACEHOLDER_LOOK.packs;
const part = (name: string, d = drawn): BufferGeometry => (d.object.getObjectByName(name) as Mesh).geometry;

interface Triangle {
  area: number;
  /** The centre's x. */
  x: number;
  colour: string;
}

function triangles(g: BufferGeometry): Triangle[] {
  const p = g.getAttribute('position');
  const c = g.getAttribute('color');
  const out: Triangle[] = [];
  for (let i = 0; i < p.count; i += 3) {
    const [ax, ay, bx, by, cx, cy] = [p.getX(i), p.getY(i), p.getX(i + 1), p.getY(i + 1), p.getX(i + 2), p.getY(i + 2)];
    out.push({
      area: ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2,
      x: (ax + bx + cx) / 3,
      colour: [c.getX(i), c.getY(i), c.getZ(i)].map((v) => v.toFixed(5)).join(' '),
    });
  }
  return out;
}

/** Each vertex colour of a part, as hex. */
function colours(g: BufferGeometry): Set<string> {
  const c = g.getAttribute('color');
  const out = new Set<string>();
  for (let i = 0; i < c.count; i++) out.add(new Color(c.getX(i), c.getY(i), c.getZ(i)).getHexString());
  return out;
}

/** A part's mean vertex colour over its vertices with x on one side of the halfway line. */
function meanColour(g: BufferGeometry, side: -1 | 1): [number, number, number] {
  const p = g.getAttribute('position');
  const c = g.getAttribute('color');
  let [red, green, blue, n] = [0, 0, 0, 0];
  for (let i = 0; i < p.count; i++) {
    if (Math.sign(p.getX(i)) !== side) continue;
    red += c.getX(i);
    green += c.getY(i);
    blue += c.getZ(i);
    n++;
  }
  return [red / n, green / n, blue / n];
}

const shoelace = (points: readonly Point[]): number =>
  points.reduce((s, [x, y], i) => {
    const [nx, ny] = points[(i + 1) % points.length]!;
    return s + (x * ny - nx * y) / 2;
  }, 0);

describe('the drawn pitch', () => {
  it("covers the floor plan and both goals' floors, once, facing up", () => {
    const floor = triangles(part('floor'));
    const expected = shoelace(pitch.outline) + shoelace(pitch.goals[0].floor) + shoelace(pitch.goals[1].floor);
    // Counter-clockwise from above, so every area is positive: none face down.
    expect(Math.min(...floor.map((t) => t.area))).toBeGreaterThan(0);
    expect(floor.reduce((s, t) => s + t.area, 0)).toBeCloseTo(expected, 6);
  });

  it('gives each half the pattern of the pack that defends it (L68)', () => {
    expect(PACKS.map((p) => p.pattern)).toEqual(['plain', 'striped']);
    const floor = triangles(part('floor'));
    // Pack A's half, plain: one colour.
    expect(new Set(floor.filter((t) => t.x < 0).map((t) => t.colour)).size).toBe(1);
    // Pack B's, striped: two colours, alternating in 2 m bands across the pitch.
    const b = floor.filter((t) => t.x > 0);
    const byBand = new Map<number, Set<string>>();
    for (const t of b) byBand.set(Math.floor(t.x / 2), (byBand.get(Math.floor(t.x / 2)) ?? new Set()).add(t.colour));
    expect(new Set(b.map((t) => t.colour)).size).toBe(2);
    for (const [band, colours] of byBand) {
      expect(colours.size, `band ${band}`).toBe(1);
      expect(byBand.get(band + 1)?.has([...colours][0]!) ?? false, `bands ${band} and ${band + 1}`).toBe(false);
    }
  });

  it("keeps the overhead ropes over the floor plan, at the net's height", () => {
    const p = part('overhead net').getAttribute('position');
    let ropes = 0;
    for (let i = 0; i < p.count; i++) {
      expect(p.getZ(i)).toBe(pitch.shape.heightMetres);
      ropes++;
      expect(insideFloorPlan(pitch.shape, p.getX(i), p.getY(i), -1e-9), `${p.getX(i)}, ${p.getY(i)}`).toBe(true);
    }
    // Ropes 1 m apart, half a metre off the centre lines: 40 across the length and 28 along it, two ends each.
    expect(ropes).toBe((40 + 28) * 2);
    // The goals' netting is a part of its own, none of it at the net's height.
    const n = part('goal netting').getAttribute('position');
    for (let i = 0; i < n.count; i++) expect(n.getZ(i)).toBeLessThanOrEqual(pitch.shape.mouthHeightMetres);
  });

  it('draws in six parts: the floor, its lines, the walls, the goal frames, the overhead net and the netting', () => {
    const shown = drawn.object.children.filter((o) => o.visible).map((o) => o.name);
    expect(shown).toEqual(['floor', 'markings', 'walls', 'goal frames', 'overhead net', 'goal netting']);
  });
});

describe("the pitch in a look's colours (M4)", () => {
  // Pack A green and striped, pack B purple and plain; every pitch colour its own.
  const look: Look = {
    ...PLACEHOLDER_LOOK,
    name: 'test',
    packs: [{ name: 'green', colour: 0x22aa44, pattern: 'striped' }, { name: 'purple', colour: 0x8844cc, pattern: 'plain' }],
    pitch: { sky: 0x000001, grass: 0x406030, line: 0xffff00, wallPanel: 0x123456, rope: 0x654321, netting: 0xabcdef },
  };
  const other = drawPitch(pitch, detail, look);

  it("tints each half and its goal by its pack's colour and pattern", () => {
    const floor = triangles(part('floor', other));
    expect(new Set(floor.filter((t) => t.x < 0).map((t) => t.colour)).size, "pack A's striped half").toBe(2);
    expect(new Set(floor.filter((t) => t.x > 0).map((t) => t.colour)).size, "pack B's plain half").toBe(1);
    const [a, b] = [meanColour(part('floor', other), -1), meanColour(part('floor', other), 1)];
    expect(a[1] - b[1], 'the green pack\'s half the greener').toBeGreaterThan(0.01);
    expect(b[2] - a[2], 'the purple pack\'s half the bluer').toBeGreaterThan(0.01);
  });

  it("draws the lines, the walls' panels and the ropes in the look's colours, the netting tinted by its pack", () => {
    expect([...colours(part('markings', other))]).toEqual(['ffff00']);
    expect(colours(part('walls', other)).has('123456')).toBe(true);
    expect([...colours(part('overhead net', other))]).toEqual(['654321']);
    const netting = [meanColour(part('goal netting', other), -1), meanColour(part('goal netting', other), 1)];
    expect(netting[0]![1] - netting[1]![1], "pack A's goal the greener").toBeGreaterThan(0.01);
    // And nothing of the placeholder's in it.
    for (const name of ['markings', 'walls', 'overhead net']) {
      expect(colours(part(name, other)).has(new Color(PLACEHOLDER_LOOK.pitch.wallPanel).getHexString()), name).toBe(false);
    }
  });
});

describe("the occluders' variants (M4's design §2.6, M4-Q11)", () => {
  it('holds one hidden object for each occluder\'s other variant, on its geometry, for prepare()\'s compile', () => {
    expect(drawn.variants.map((v) => v.name)).toEqual(['walls, dithered', 'goal frames, dithered', 'overhead net, dithered']);
    for (const v of drawn.variants) {
      const of = drawn.object.getObjectByName(v.name.replace(', dithered', '')) as Mesh | LineSegments;
      expect(v.visible, v.name).toBe(false);
      expect(v.parent, v.name).toBe(drawn.object);
      expect((v as Mesh).geometry, v.name).toBe(of.geometry);
    }
  });

  it('keeps every occluder on its opaque variant while nothing crosses the fade (phase 1)', () => {
    drawn.setFade();
    drawn.setBulge(null);
    for (const v of drawn.variants) {
      const of = drawn.object.getObjectByName(v.name.replace(', dithered', '')) as Mesh;
      // Phase 1's fadeVariants gives the material as both.
      expect(of.material, v.name).toBe((v as Mesh).material);
    }
  });
});
