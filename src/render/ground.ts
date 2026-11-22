// The ground beyond the glass walls (C-57): with the walls see-through, the
// arena stands on a gravel apron reaching APRON_METRES beyond the walls and
// the goals' backs, with grass beyond it that fades into the sky colour,
// the scene's background, between GROUND_FADE_METRES from the centre spot,
// in rings out to the last of GROUND_RINGS_METRES. A camera's draw distance
// (src/render/camera.ts) then ends on ground already the sky's colour, so no
// camera sees an edge. The arena's footprint, its floor plan with each
// goal's floor, is the ground's hole, moved in by HOLE_INSET_METRES under
// the floor so no crack shows at the walls' foot; the ground sits just
// under the floor, with a polygon offset too. Its colours are the look's
// apron, outfield and sky, a placeholder until phase 4's look book. Unlit,
// one colour a vertex. Metres, z up.

import { BufferAttribute, BufferGeometry, Color, MeshBasicMaterial, ShapeUtils, Vector2 } from 'three';
import type { Pitch, Point } from '../core/sim/pitch';
import type { Look } from './look';
import { mix } from './shapes';

/** The gravel apron reaches this far beyond the walls and the goals' backs. */
const APRON_METRES = 6;
/** The grass fades into the sky colour between these distances from the centre spot, */
export const GROUND_FADE_METRES: readonly [number, number] = [90, 150];
/** in rings at these radii, the last the ground's edge. */
export const GROUND_RINGS_METRES: readonly number[] = [40, 90, 105, 120, 135, 150, 400];
/** Each ring's segments. */
const RING_SEGMENTS = 64;
/** Just under the floor. */
const GROUND_Z_METRES = -0.01;
/** The footprint, moved in this far, is the ground's hole: the floor overlaps the ground by it. */
export const HOLE_INSET_METRES = 0.1;

/** The arena's footprint: the floor plan with each goal's floor spliced in at its mouth, counter-clockwise from
 *  above. */
export function footprint(p: Pitch): Point[] {
  const out: Point[] = [];
  const o = p.outline;
  for (let i = 0; i < o.length; i++) {
    const a = o[i]!;
    const b = o[(i + 1) % o.length]!;
    out.push(a);
    // An end wall's edge: the goal's floor, at its mouth, on the way along it.
    const goal = a[0] === b[0] ? p.goals.find((g) => g.lineX === a[0]) : undefined;
    if (goal === undefined) continue;
    const back = goal.lineX + Math.sign(goal.lineX) * goal.depth;
    const way = Math.sign(b[1] - a[1]);
    const y = goal.mouthWidth / 2;
    out.push([goal.lineX, -way * y], [back, -way * y], [back, way * y], [goal.lineX, way * y]);
  }
  return out;
}

/** A counter-clockwise polygon moved in by d: each corner where its two edges' lines, moved in, meet. */
export function inset(points: readonly Point[], d: number): Point[] {
  const n = points.length;
  const lines = points.map(([ax, ay], i) => {
    const [bx, by] = points[(i + 1) % n]!;
    const length = Math.hypot(bx - ax, by - ay);
    const nx = -(by - ay) / length;
    const ny = (bx - ax) / length;
    return { nx, ny, c: ax * nx + ay * ny + d };
  });
  return lines.map((l, i) => {
    const m = lines[(i + n - 1) % n]!;
    const det = m.nx * l.ny - m.ny * l.nx;
    return [(m.c * l.ny - m.ny * l.c) / det, (m.nx * l.c - m.c * l.nx) / det] as Point;
  });
}

/** A ring's corners, counter-clockwise from above. */
function circle(r: number): Point[] {
  return Array.from({ length: RING_SEGMENTS }, (_, k): Point => {
    const a = (2 * Math.PI * k) / RING_SEGMENTS;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
}

/** The ground beyond the walls: the apron round the footprint, its hole the footprint moved in by
 *  HOLE_INSET_METRES; the outfield's grass round the apron; and rings fading the grass into the sky colour, out to
 *  the last ring. Every triangle faces up. */
export function groundGeometry(p: Pitch, look: Look): BufferGeometry {
  const position: number[] = [];
  const colour: number[] = [];
  const c = new Color();
  const { apron, outfield, sky } = look.pitch;
  const vertex = ([x, y]: Point, hex: number): void => {
    c.setHex(hex);
    position.push(x, y, GROUND_Z_METRES);
    colour.push(c.r, c.g, c.b);
  };
  /** A triangle, wound counter-clockwise from above, so its front faces up. */
  const triangle = (a: Point, b: Point, d: Point, ca: number, cb: number, cd: number): void => {
    const area = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
    vertex(a, ca);
    if (area >= 0) {
      vertex(b, cb);
      vertex(d, cd);
    } else {
      vertex(d, cd);
      vertex(b, cb);
    }
  };
  /** A polygon with a hole in it, in one colour. */
  const fill = (outer: readonly Point[], hole: readonly Point[], hex: number): void => {
    const toVector = ([x, y]: Point): Vector2 => new Vector2(x, y);
    const all = [...outer, ...hole];
    for (const [i, j, k] of ShapeUtils.triangulateShape(outer.map(toVector), [hole.map(toVector)])) {
      triangle(all[i!]!, all[j!]!, all[k!]!, hex, hex, hex);
    }
  };
  const ax = p.goalLineX + p.shape.goalDepthMetres + APRON_METRES;
  const ay = p.shape.widthMetres / 2 + APRON_METRES;
  const rectangle: Point[] = [[-ax, -ay], [ax, -ay], [ax, ay], [-ax, ay]];
  fill(rectangle, inset(footprint(p), HOLE_INSET_METRES), apron);
  fill(circle(GROUND_RINGS_METRES[0]!), rectangle, outfield);
  const [f0, f1] = GROUND_FADE_METRES;
  const at = (r: number): number => {
    const u = Math.max(0, Math.min(1, (r - f0) / (f1 - f0)));
    return mix(outfield, sky, u * u * (3 - 2 * u));
  };
  for (let i = 0; i + 1 < GROUND_RINGS_METRES.length; i++) {
    const [r0, r1] = [GROUND_RINGS_METRES[i]!, GROUND_RINGS_METRES[i + 1]!];
    const [in0, in1] = [circle(r0), circle(r1)];
    const [c0, c1] = [at(r0), at(r1)];
    for (let k = 0; k < RING_SEGMENTS; k++) {
      const k1 = (k + 1) % RING_SEGMENTS;
      triangle(in0[k]!, in0[k1]!, in1[k1]!, c0, c0, c1);
      triangle(in0[k]!, in1[k1]!, in1[k]!, c0, c1, c1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(colour), 3));
  return g;
}

/** The ground's material: unlit, its vertices' colours, pushed back behind the floor where they overlap. */
export function groundMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({ name: 'ground', vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
}
