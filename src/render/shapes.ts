// The pitch's building blocks (PLAN §12): triangles and line segments with
// their own colours, and the vectors and colour mixes they're made with,
// shared by the floor, the goals and the nets (src/render/pitch.ts), the
// glass walls and their rail (glass.ts) and the ground beyond them
// (ground.ts). Colours are hex, mixed and shaded in three's linear working
// space, as M1's pitch mixed them. Metres, z up.

import { BufferAttribute, BufferGeometry, Color } from 'three';
import type { Piece, Point } from '../core/sim/pitch';

/** White itself, which the striped frames, the glass's details and the pack colours' bands mix with: no look's
 *  choice. */
export const WHITE = 0xffffff;

/** The floor's UVs: the grass texture repeats every this many metres. */
const GRASS_TILE_METRES = 4;

export type V = readonly [number, number, number];

export const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const along = (o: V, e: V, t: number): V => [o[0] + e[0] * t, o[1] + e[1] * t, o[2] + e[2] * t];
export const mix = (a: number, b: number, t: number): number => new Color(a).lerp(new Color(b), t).getHex();
export const shade = (c: number, k: number): number => new Color(c).multiplyScalar(k).getHex();
export const origin = (q: Piece): V => [q.ox, q.oy, q.oz];
export const edge1 = (q: Piece): V => [q.e1x, q.e1y, q.e1z];
export const edge2 = (q: Piece): V => [q.e2x, q.e2y, q.e2z];
/** A piece's plane offset along its normal: n·p equals it on the plane and exceeds it inside the pitch. */
export const offsetOf = (q: Piece): number => q.ox * q.nx + q.oy * q.ny + q.oz * q.nz;

/** Triangles with their own normals, colours and floor UVs. */
export class Triangles {
  private readonly position: number[] = [];
  private readonly normal: number[] = [];
  private readonly colour: number[] = [];
  private readonly uv: number[] = [];
  private readonly c = new Color();

  vertex(p: V, n: V, colour: number): void {
    this.c.setHex(colour);
    this.position.push(p[0], p[1], p[2]);
    this.normal.push(n[0], n[1], n[2]);
    this.colour.push(this.c.r, this.c.g, this.c.b);
    this.uv.push(p[0] / GRASS_TILE_METRES, p[1] / GRASS_TILE_METRES);
  }

  /** A convex polygon on the floor plan, counter-clockwise from above, at height z, facing up. */
  fan(points: readonly Point[], z: number, colour: number): void {
    const up: V = [0, 0, 1];
    for (let i = 1; i + 1 < points.length; i++) {
      for (const [x, y] of [points[0]!, points[i]!, points[i + 1]!]) this.vertex([x, y, z], up, colour);
    }
  }

  /** A flat quad a, b, c, d, wound so that its front faces n. */
  quad(a: V, b: V, c: V, d: V, n: V, colour: number): void {
    const u = sub(b, a);
    const v = sub(d, a);
    const facing = (u[1] * v[2] - u[2] * v[1]) * n[0] + (u[2] * v[0] - u[0] * v[2]) * n[1] + (u[0] * v[1] - u[1] * v[0]) * n[2];
    const order = facing >= 0 ? [a, b, c, a, c, d] : [a, d, c, a, c, b];
    for (const p of order) this.vertex(p, n, colour);
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.position), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.normal), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.colour), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    return g;
  }
}

/** Line segments with their colours. */
export class Lines {
  private readonly position: number[] = [];
  private readonly colour: number[] = [];
  private readonly c = new Color();

  /** The vertices so far, two a segment. */
  get vertices(): number {
    return this.position.length / 3;
  }

  line(a: V, b: V, hex: number): void {
    this.c.setHex(hex);
    this.position.push(...a, ...b);
    this.colour.push(this.c.r, this.c.g, this.c.b, this.c.r, this.c.g, this.c.b);
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.position), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.colour), 3));
    return g;
  }
}
