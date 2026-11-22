import { Color, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { insideFloorPlan, pitch, type Point } from '../core/sim/pitch';
import { fitSpectator, newPlaced, placeCamera, spectatorCamera } from './camera';
import { footprint, GROUND_FADE_METRES, GROUND_RINGS_METRES, groundGeometry, HOLE_INSET_METRES, inset } from './ground';
import { PLACEHOLDER_LOOK } from './look';

// The ground beyond the glass walls (C-57), without a GPU: its hole is the
// arena's footprint, the floor plan with each goal's floor, moved in under
// the floor; it covers everything else out to its edge, facing up; it fades
// into the sky's colour; and no camera's draw distance ends on ground that
// isn't the sky's colour yet, so no camera sees its edge.

const ground = groundGeometry(pitch, PLACEHOLDER_LOOK);

const area = (points: readonly Point[]): number =>
  points.reduce((s, [x, y], i) => {
    const [nx, ny] = points[(i + 1) % points.length]!;
    return s + (x * ny - nx * y) / 2;
  }, 0);

/** Whether (x, y) is inside a polygon, by crossings. */
function insidePolygon(points: readonly Point[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[i]!;
    const [bx, by] = points[j]!;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

interface Triangle {
  readonly a: Point;
  readonly b: Point;
  readonly c: Point;
  readonly area: number;
}

const triangles: Triangle[] = (() => {
  const p = ground.getAttribute('position');
  const out: Triangle[] = [];
  for (let i = 0; i < p.count; i += 3) {
    const [a, b, c] = [0, 1, 2].map((k): Point => [p.getX(i + k), p.getY(i + k)]);
    out.push({ a: a!, b: b!, c: c!, area: ((b![0] - a![0]) * (c![1] - a![1]) - (b![1] - a![1]) * (c![0] - a![0])) / 2 });
  }
  return out;
})();

/** How far (x, y) is from a polygon's nearest edge. */
function fromEdges(points: readonly Point[], x: number, y: number): number {
  let nearest = Infinity;
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i]!;
    const [bx, by] = points[(i + 1) % points.length]!;
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    nearest = Math.min(nearest, Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)));
  }
  return nearest;
}

/** How many of the ground's triangles cover (x, y). */
function covers(x: number, y: number): number {
  const side = (p: Point, q: Point): number => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
  return triangles.filter((t) => side(t.a, t.b) >= 0 && side(t.b, t.c) >= 0 && side(t.c, t.a) >= 0).length;
}

describe('the ground beyond the walls (C-57)', () => {
  it("takes the arena's footprint as the floor plan with each goal's floor spliced in, counter-clockwise", () => {
    const f = footprint(pitch);
    expect(f).toHaveLength(pitch.outline.length + 2 * 4);
    expect(area(f)).toBeCloseTo(area(pitch.outline) + area(pitch.goals[0].floor) + area(pitch.goals[1].floor), 9);
    for (const goal of pitch.goals) for (const corner of goal.floor) expect(f, `${corner.join(', ')}`).toContainEqual(corner);
    for (const corner of pitch.outline) expect(f).toContainEqual(corner);
  });

  it('holes the ground at the footprint moved in by 10 cm, under the floor, and covers the rest once, out to its edge, facing up', () => {
    const hole = inset(footprint(pitch), HOLE_INSET_METRES);
    // Moved in by the inset at every edge: a ring of the inset's width round its perimeter, less its corners.
    const f = footprint(pitch);
    const perimeter = f.reduce((s, [x, y], i) => s + Math.hypot(f[(i + 1) % f.length]![0] - x, f[(i + 1) % f.length]![1] - y), 0);
    expect(area(f) - area(hole)).toBeGreaterThan(perimeter * HOLE_INSET_METRES * 0.9);
    expect(area(f) - area(hole)).toBeLessThan(perimeter * HOLE_INSET_METRES * 1.1);
    // Every triangle faces up, and they cover the ground's last ring, a 64-gon, less the hole.
    expect(Math.min(...triangles.map((t) => t.area))).toBeGreaterThan(0);
    const edge = GROUND_RINGS_METRES.at(-1)!;
    const ring = 32 * edge * edge * Math.sin((2 * Math.PI) / 64);
    expect(triangles.reduce((s, t) => s + t.area, 0) / (ring - area(hole))).toBeCloseTo(1, 7);
    // Nothing inside the hole; everything outside it once, the strip under the floor's edge included: but on the
    // hole's edges, within a millimetre, where float32 corners may fall either way.
    for (let x = -30; x <= 30; x += 0.37) {
      for (let y = -22; y <= 22; y += 0.37) {
        if (fromEdges(hole, x, y) < 1e-3) continue;
        const n = covers(x, y);
        if (insidePolygon(hole, x, y)) expect(n, `${x}, ${y}, in the hole`).toBe(0);
        else expect(n, `${x}, ${y}, outside the hole`).toBeGreaterThanOrEqual(1);
      }
    }
    // Just inside each footprint edge's middle, under the floor's edge: covered. Just inside the hole there: not.
    for (let i = 0; i < f.length; i++) {
      const [ax, ay] = f[i]!;
      const [bx, by] = f[(i + 1) % f.length]!;
      const length = Math.hypot(bx - ax, by - ay);
      const [nx, ny] = [-(by - ay) / length, (bx - ax) / length];
      const [mx, my] = [(ax + bx) / 2, (ay + by) / 2];
      expect(covers(mx + nx * 0.05, my + ny * 0.05), `edge ${i}, under the floor's edge`).toBe(1);
      expect(covers(mx + nx * 0.15, my + ny * 0.15), `edge ${i}, inside the hole`).toBe(0);
      expect(covers(mx - nx * 0.05, my - ny * 0.05), `edge ${i}, outside the walls`).toBe(1);
    }
    // Just under the floor.
    const p = ground.getAttribute('position');
    for (let i = 0; i < p.count; i++) expect(p.getZ(i)).toBe(Math.fround(-0.01));
  });

  it('lays the apron round the arena, the outfield beyond it, and the sky colour from the fade\'s end to its edge', () => {
    const p = ground.getAttribute('position');
    const c = ground.getAttribute('color');
    const hex = (i: number): number => new Color(c.getX(i), c.getY(i), c.getZ(i)).getHex();
    const { apron, outfield, sky } = PLACEHOLDER_LOOK.pitch;
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getY(i));
      if (r <= 34.5) expect([apron, outfield], `${p.getX(i)}, ${p.getY(i)}`).toContain(hex(i));
      if (r <= GROUND_FADE_METRES[0]) expect([apron, outfield], `${r} m out`).toContain(hex(i));
      if (r >= GROUND_FADE_METRES[1] - 1e-3) expect(hex(i), `${r} m out`).toBe(sky);
    }
    expect(covers(0, -17)).toBe(1);
    expect(covers(0, 0)).toBe(0);
  });
});

describe("no camera sees the ground's edge (C-57)", () => {
  /** Where rays through the view, over a grid on it, meet the ground: the nearest radius from the centre spot at
   *  which the far plane cuts the ground in view, Infinity if it cuts none. */
  function cutFrom(camera: PerspectiveCamera): number {
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const forward = camera.getWorldDirection(new Vector3());
    let nearest = Infinity;
    for (let i = 0; i <= 48; i++) {
      for (let j = 0; j <= 48; j++) {
        const ray = new Vector3(-1 + i / 24, -1 + j / 24, 0.5).unproject(camera).sub(camera.position).normalize();
        if (ray.z >= 0) continue;
        const hit = camera.position.clone().addScaledVector(ray, -camera.position.z / ray.z);
        if (hit.clone().sub(camera.position).dot(forward) > camera.far) nearest = Math.min(nearest, Math.hypot(hit.x, hit.y));
      }
    }
    return nearest;
  }

  const sky = GROUND_FADE_METRES[1];
  const edge = GROUND_RINGS_METRES.at(-1)!;
  /** A camera at a placed position. */
  function camera(aspect: number, at: ReturnType<typeof newPlaced>): PerspectiveCamera {
    const c = new PerspectiveCamera(at.fovDegrees, aspect, at.near, at.far);
    c.up.copy(at.up);
    c.position.copy(at.position);
    c.lookAt(at.lookAt);
    return c;
  }

  it("ends a player's draw distance on the sky's colour, wherever round the arena the camera is, and short of the edge", () => {
    const far = newPlaced().far;
    // A player's camera stays over the apron, within 6 m of the walls and the goals' backs.
    const reach = Math.hypot(pitch.goalLineX + pitch.shape.goalDepthMetres + 6, pitch.shape.widthMetres / 2 + 6);
    expect(far - reach, "a player's far plane, from its camera's furthest from the centre spot").toBeGreaterThanOrEqual(sky);
    expect(far + reach).toBeLessThan(edge * Math.cos(Math.PI / 64));
    // Looking out over the far wall at the horizon, at the widest window the specs open, from a corner of the apron.
    for (const [x, y, yaw] of [[-27, -19, Math.PI / 4], [27, 0, 0], [0, -19, Math.PI / 2], [0, 0, -Math.PI / 2]] as const) {
      const placed = newPlaced();
      placed.position.set(x, y, 2.1);
      placed.lookAt.set(x + Math.cos(yaw), y + Math.sin(yaw), 2.1);
      placed.far = far;
      placed.fovDegrees = 55;
      expect(cutFrom(camera(1600 / 500, placed)), `${x}, ${y}`).toBeGreaterThanOrEqual(sky);
    }
  });

  it("ends the spectators' draw distance on the sky's colour, at any window's shape", () => {
    for (const aspect of [0.3, 0.45, 0.5625, 1, 16 / 9, 3.2]) {
      for (const x of [-20, 0, 20]) {
        for (const y of [-14, 0, 14]) {
          const placed = newPlaced();
          placeCamera({ mode: { kind: 'spectator', follow: null }, yaw: 0, target: { x, y, z: 0.8 }, subject: null }, pitch, aspect, placed);
          expect(cutFrom(camera(aspect, placed)), `${aspect}: ${x}, ${y}`).toBeGreaterThanOrEqual(sky);
        }
      }
    }
  });

  it("ends the overview's draw distance on the sky's colour, at any window's shape", () => {
    for (const aspect of [0.3, 0.4, 0.45, 0.5, 0.5625, 1, 16 / 9, 3.2, 4]) {
      const c = spectatorCamera();
      fitSpectator(c, aspect, pitch);
      expect(cutFrom(c), `aspect ${aspect}`).toBeGreaterThanOrEqual(sky);
    }
  });

  it('keeps the floor plan over its hole: the ground never shows on the pitch', () => {
    const hole = inset(footprint(pitch), HOLE_INSET_METRES);
    for (let x = -19.9; x <= 19.9; x += 0.5) {
      for (let y = -13.9; y <= 13.9; y += 0.5) if (insideFloorPlan(pitch.shape, x, y, 0.11)) expect(insidePolygon(hole, x, y)).toBe(true);
    }
  });
});
