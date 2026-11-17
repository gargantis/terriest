import { describe, expect, it } from 'vitest';
import type { BufferGeometry, Mesh } from 'three';
import { insideFloorPlan, pitch, type Point } from '../core/sim/pitch';
import { PACKS } from './palette';
import { drawPitch } from './pitch';

// The empty pitch as drawn from the simulation's pieces (PLAN §12, D-4,
// L68), checked on its geometry, without a GPU.
const drawn = drawPitch(pitch, { ropeSpacingMetres: 1, nettingSpacingMetres: 0.25, anisotropy: 1 });
const part = (name: string): BufferGeometry => (drawn.object.getObjectByName(name) as Mesh).geometry;

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
    const p = part('nets').getAttribute('position');
    let ropes = 0;
    for (let i = 0; i < p.count; i++) {
      if (p.getZ(i) !== pitch.shape.heightMetres) continue;
      ropes++;
      expect(insideFloorPlan(pitch.shape, p.getX(i), p.getY(i), -1e-9), `${p.getX(i)}, ${p.getY(i)}`).toBe(true);
    }
    // Ropes 1 m apart, half a metre off the centre lines: 40 across the length and 28 along it, two ends each.
    expect(ropes).toBe((40 + 28) * 2);
  });
});
