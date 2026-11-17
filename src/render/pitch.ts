// The empty pitch (PLAN §12), drawn from the simulation's own pieces in
// src/core/sim/pitch.ts, so the pitch the page draws is the one played on
// (D-4). Ported from the M0 spike's scene/pitch.ts:
// - grass, with a texture made at run time;
// - each half, and the goal at its end, in the colour and pattern of the
//   pack that defends it (L68): a plain pack's half is plain and its goal
//   frame one colour; a striped pack's half is mown in bands and its frame
//   banded;
// - the halfway line, the centre spot and the goal lines;
// - padded walls and cut corners, the padding in its half's colour;
// - the rope net overhead, and each goal's posts, crossbar and netting.
// Four draw calls: the floor, its lines, the walls with the goal frames,
// and the nets. Metres, z up.

import {
  BufferAttribute, BufferGeometry, CapsuleGeometry, Color, DataTexture, Group, LineBasicMaterial, LineSegments,
  LinearFilter, LinearMipmapLinearFilter, Mesh, MeshLambertMaterial, Quaternion, RepeatWrapping, SRGBColorSpace,
  Vector3, type Material,
} from 'three';
import { FRAME, GOAL_NET, NET, WALL, type Pack, type Piece, type Pitch, type Point } from '../core/sim/pitch';
import { GRASS, LINE, NETTING, PACKS, ROPE, WALL_PANEL, WHITE } from './palette';

export interface PitchDetail {
  readonly ropeSpacingMetres: number;
  readonly nettingSpacingMetres: number;
  readonly anisotropy: number;
}

export interface DrawnPitch {
  readonly object: Group;
  dispose(): void;
}

/** How much of its pack's colour a half's grass takes. */
const HALF_TINT = 0.24;
/** A striped pack's mown bands, across the pitch. */
const BAND_METRES = 2;
const BAND_SHADE = 0.86;
/** The grass texture repeats every this many metres. */
const GRASS_TILE_METRES = 4;
const LINE_WIDTH_METRES = 0.12;
const SPOT_RADIUS_METRES = 0.22;
/** The markings sit this far above the floor, with a polygon offset too. */
const MARKING_LIFT_METRES = 0.004;
/** The walls' padding reaches this high, */
const PADDING_TOP_METRES = 1.2;
/** in cushions, and panels above them, about this long. */
const PANEL_METRES = 2;
/** A striped pack's goal frame, in bands about this long. */
const FRAME_BAND_METRES = 0.5;
/** How much of its pack's colour a goal's netting takes. */
const NETTING_TINT = 0.35;

type V = readonly [number, number, number];

/** Triangles with their own normals, colours and floor UVs. */
class Triangles {
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

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const along = (o: V, e: V, t: number): V => [o[0] + e[0] * t, o[1] + e[1] * t, o[2] + e[2] * t];
const mix = (a: number, b: number, t: number): number => new Color(a).lerp(new Color(b), t).getHex();
const shade = (c: number, k: number): number => new Color(c).multiplyScalar(k).getHex();
const origin = (q: Piece): V => [q.ox, q.oy, q.oz];
const edge1 = (q: Piece): V => [q.e1x, q.e1y, q.e1z];
const edge2 = (q: Piece): V => [q.e2x, q.e2y, q.e2z];

/** The part of a convex polygon with x0 <= x <= x1. A corner on a cut
 *  line is kept once, and a cut is made only where an edge crosses. */
function clipX(points: readonly Point[], x0: number, x1: number): Point[] {
  const keep = (list: Point[], cut: number, sign: 1 | -1): Point[] => {
    const out: Point[] = [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      const b = list[(i + 1) % list.length]!;
      const da = sign * (a[0] - cut);
      const db = sign * (b[0] - cut);
      if (da >= 0) out.push(a);
      if (da * db < 0) out.push([cut, a[1] + ((b[1] - a[1]) * (cut - a[0])) / (b[0] - a[0])]);
    }
    return out;
  };
  return keep(keep([...points], x0, 1), x1, -1);
}

/** Where the line x = c (axis 0) or y = c (axis 1) crosses a convex polygon: the other coordinate's range. */
function chord(points: readonly Point[], axis: 0 | 1, c: number): [number, number] | null {
  const o = axis === 0 ? 1 : 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    if ((a[axis] - c) * (b[axis] - c) > 0) continue;
    if (a[axis] === b[axis]) {
      lo = Math.min(lo, a[o], b[o]);
      hi = Math.max(hi, a[o], b[o]);
    } else {
      const v = a[o] + ((b[o] - a[o]) * (c - a[axis])) / (b[axis] - a[axis]);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  return lo < hi ? [lo, hi] : null;
}

/** A deterministic hash in [0, 1) of two integers. */
function hash2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The grass texture, made at run time: light, so each half's colour tints
 *  it, tileable value noise with short blade strokes over it. */
function grassTexture(size = 256): DataTexture {
  const cell = 16;
  const n = size / cell;
  const smooth = (a: number): number => a * a * (3 - 2 * a);
  const corner = (i: number, j: number): number => hash2(((i % n) + n) % n, ((j % n) + n) % n);
  const noise = (x: number, y: number): number => {
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    const fx = smooth(x / cell - gx);
    const fy = smooth(y / cell - gy);
    const a = corner(gx, gy) + (corner(gx + 1, gy) - corner(gx, gy)) * fx;
    const b = corner(gx, gy + 1) + (corner(gx + 1, gy + 1) - corner(gx, gy + 1)) * fx;
    return a + (b - a) * fy;
  };
  const light = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) light[y * size + x] = 0.84 + 0.1 * noise(x, y);
  }
  // Blades: short light and dark strokes, wrapping at the edges.
  for (let k = 0; k < 2600; k++) {
    const x0 = Math.floor(hash2(k, 1) * size);
    const y0 = Math.floor(hash2(k, 2) * size);
    const length = 3 + Math.floor(hash2(k, 3) * 5);
    const lean = hash2(k, 4) - 0.5;
    const d = hash2(k, 5) < 0.5 ? 0.09 : -0.08;
    for (let i = 0; i < length; i++) {
      const x = (((x0 + Math.round(lean * i)) % size) + size) % size;
      const y = (y0 + i) % size;
      const at = y * size + x;
      light[at] = Math.min(1, Math.max(0, light[at]! + d * (1 - i / length)));
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(light[i]! * 255);
    data[i * 4] = v;
    data[i * 4 + 1] = Math.min(255, v + 6);
    data[i * 4 + 2] = Math.max(0, v - 10);
    data[i * 4 + 3] = 255;
  }
  const t = new DataTexture(data, size, size);
  t.name = 'grass';
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.generateMipmaps = true;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Each half, and the floor of the goal at its end, in its pack's colour
 *  and pattern; a striped pack's in bands across the pitch. */
function floor(p: Pitch): BufferGeometry {
  const t = new Triangles();
  for (const pack of [0, 1] as const) {
    const tint = mix(GRASS, PACKS[pack].colour, HALF_TINT);
    for (const area of [p.halves[pack].outline, p.goals[pack].floor]) {
      if (PACKS[pack].pattern === 'plain') {
        t.fan(area, 0, tint);
        continue;
      }
      const xs = area.map(([x]) => x);
      const first = Math.floor(Math.min(...xs) / BAND_METRES);
      const last = Math.ceil(Math.max(...xs) / BAND_METRES);
      for (let k = first; k < last; k++) {
        const band = clipX(area, k * BAND_METRES, (k + 1) * BAND_METRES);
        if (band.length >= 3) t.fan(band, 0, k % 2 === 0 ? tint : shade(tint, BAND_SHADE));
      }
    }
  }
  return t.geometry();
}

/** The halfway line, the centre spot and the goal lines. */
function markings(p: Pitch): BufferGeometry {
  const t = new Triangles();
  const z = MARKING_LIFT_METRES;
  const half = LINE_WIDTH_METRES / 2;
  const across = chord(p.outline, 0, 0);
  if (across) t.fan([[-half, across[0]], [half, across[0]], [half, across[1]], [-half, across[1]]], z, LINE);
  const spot: Point[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * 2 * Math.PI;
    spot.push([SPOT_RADIUS_METRES * Math.cos(a), SPOT_RADIUS_METRES * Math.sin(a)]);
  }
  t.fan(spot, z, LINE);
  for (const goal of p.goals) {
    // On the pitch's side of the line, across the mouth.
    const inward = goal.lineX < 0 ? LINE_WIDTH_METRES : -LINE_WIDTH_METRES;
    const x0 = Math.min(goal.lineX, goal.lineX + inward);
    const x1 = Math.max(goal.lineX, goal.lineX + inward);
    const y = goal.mouthWidth / 2;
    t.fan([[x0, -y], [x1, -y], [x1, y], [x0, y]], z, LINE);
  }
  return t.geometry();
}

/** A wall piece as padded panels: split where it crosses the halfway line,
 *  so each panel's padding takes one half's colour, then into cushions. */
function wall(q: Piece, t: Triangles): void {
  const o = origin(q);
  const e1 = edge1(q);
  const e2 = edge2(q);
  const n: V = [q.nx, q.ny, q.nz];
  const length = Math.hypot(e1[0], e1[1], e1[2]);
  const splits = [0, 1];
  const crossing = q.e1x === 0 ? -1 : -q.ox / q.e1x;
  if (crossing > 0 && crossing < 1) splits.splice(1, 0, crossing);
  // Where the padding ends, as a fraction of e2 (the walls stand upright).
  const padTop = q.e2z > 0 ? Math.min(1, Math.max(0, (PADDING_TOP_METRES - q.oz) / q.e2z)) : 0;
  let cushion = 0;
  for (let s = 0; s + 1 < splits.length; s++) {
    const a = splits[s]!;
    const b = splits[s + 1]!;
    const count = Math.max(1, Math.round((length * (b - a)) / PANEL_METRES));
    for (let i = 0; i < count; i++, cushion++) {
      const f0 = a + ((b - a) * i) / count;
      const f1 = a + ((b - a) * (i + 1)) / count;
      const p0 = along(o, e1, f0);
      const p1 = along(o, e1, f1);
      const pack: Pack = p0[0] + p1[0] < 0 ? 0 : 1;
      const even = cushion % 2 === 0;
      const band = (lo: number, hi: number, colour: number): void =>
        t.quad(along(p0, e2, lo), along(p1, e2, lo), along(p1, e2, hi), along(p0, e2, hi), n, colour);
      if (padTop > 0) band(0, padTop, shade(mix(PACKS[pack].colour, WHITE, 0.15), even ? 0.92 : 0.8));
      if (padTop < 1) band(padTop, 1, even ? WALL_PANEL : shade(WALL_PANEL, 0.94));
    }
  }
}

/** A post or crossbar: a capsule along its piece's segment, in its goal's
 *  pack's colour, banded with white for a striped pack. */
function frame(q: Piece, pack: Pack, t: Triangles): void {
  const axis = new Vector3(q.e1x, q.e1y, q.e1z);
  const length = axis.length();
  axis.normalize();
  const colour = PACKS[pack].colour;
  const bands = PACKS[pack].pattern === 'striped' ? Math.max(1, Math.round(length / FRAME_BAND_METRES)) : 1;
  const capsule = new CapsuleGeometry(q.radius, length, 4, 12, bands);
  const g = capsule.toNonIndexed();
  capsule.dispose();
  const position = g.getAttribute('position');
  const normal = g.getAttribute('normal');
  const turn = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis);
  const centre = new Vector3(q.ox + q.e1x / 2, q.oy + q.e1y / 2, q.oz + q.e1z / 2);
  const p = new Vector3();
  const nv = new Vector3();
  for (let i = 0; i < position.count; i += 3) {
    // The band of the triangle's centre along the capsule (its local y).
    const y = (position.getY(i) + position.getY(i + 1) + position.getY(i + 2)) / 3;
    const band = Math.min(bands - 1, Math.max(0, Math.floor(((y + length / 2) / length) * bands)));
    const c = band % 2 === 0 ? colour : WHITE;
    for (let j = i; j < i + 3; j++) {
      p.fromBufferAttribute(position, j).applyQuaternion(turn).add(centre);
      nv.fromBufferAttribute(normal, j).applyQuaternion(turn);
      t.vertex([p.x, p.y, p.z], [nv.x, nv.y, nv.z], c);
    }
  }
  g.dispose();
}

/** The rope net over the floor plan, and each goal's netting, as lines. */
function nets(p: Pitch, detail: PitchDetail): BufferGeometry {
  const position: number[] = [];
  const colour: number[] = [];
  const c = new Color();
  const line = (a: V, b: V, hex: number): void => {
    c.setHex(hex);
    position.push(...a, ...b);
    colour.push(c.r, c.g, c.b, c.r, c.g, c.b);
  };
  const net = p.pieces.find((q) => q.surface === NET);
  if (net) {
    // Half a spacing off the centre lines, so no rope lies over the
    // halfway line from the spectators' camera, straight above it.
    const s = detail.ropeSpacingMetres;
    for (const axis of [0, 1] as const) {
      const values = p.outline.map((q) => q[axis]);
      const last = Math.floor(Math.max(...values) / s - 0.5);
      for (let k = Math.ceil(Math.min(...values) / s - 0.5); k <= last; k++) {
        const across = (k + 0.5) * s;
        const range = chord(p.outline, axis, across);
        if (!range) continue;
        const at = (v: number): V => (axis === 0 ? [across, v, net.oz] : [v, across, net.oz]);
        line(at(range[0]), at(range[1]), ROPE);
      }
    }
  }
  for (const goal of p.goals) {
    const hex = mix(NETTING, PACKS[goal.pack].colour, NETTING_TINT);
    for (const k of goal.pieces) {
      const q = p.pieces[k]!;
      if (q.surface !== GOAL_NET) continue;
      const o = origin(q);
      const e1 = edge1(q);
      const e2 = edge2(q);
      const n1 = Math.max(1, Math.round(Math.hypot(...e1) / detail.nettingSpacingMetres));
      const n2 = Math.max(1, Math.round(Math.hypot(...e2) / detail.nettingSpacingMetres));
      for (let i = 0; i <= n1; i++) line(along(o, e1, i / n1), along(along(o, e1, i / n1), e2, 1), hex);
      for (let j = 0; j <= n2; j++) line(along(o, e2, j / n2), along(along(o, e2, j / n2), e1, 1), hex);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(colour), 3));
  return g;
}

export function drawPitch(p: Pitch, detail: PitchDetail): DrawnPitch {
  const object = new Group();
  object.name = 'pitch';
  const grass = grassTexture();
  grass.anisotropy = detail.anisotropy;

  const solid = new Triangles();
  for (const q of p.pieces) if (q.surface === WALL) wall(q, solid);
  for (const goal of p.goals) {
    for (const k of goal.pieces) if (p.pieces[k]!.surface === FRAME) frame(p.pieces[k]!, goal.pack, solid);
  }

  const materials: Material[] = [
    new MeshLambertMaterial({ map: grass, vertexColors: true }),
    new MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    new MeshLambertMaterial({ vertexColors: true }),
    new LineBasicMaterial({ vertexColors: true }),
  ];
  const parts = [
    new Mesh(floor(p), materials[0]),
    new Mesh(markings(p), materials[1]),
    new Mesh(solid.geometry(), materials[2]),
    new LineSegments(nets(p, detail), materials[3]),
  ];
  const names = ['floor', 'markings', 'walls and goal frames', 'nets'];
  parts.forEach((part, i) => {
    part.name = names[i]!;
    object.add(part);
  });
  return {
    object,
    dispose() {
      for (const part of parts) part.geometry.dispose();
      for (const m of materials) m.dispose();
      grass.dispose();
      object.removeFromParent();
    },
  };
}
