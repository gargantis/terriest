// The pitch (PLAN §12, D-4): grass with a procedural texture made at run
// time; each half and its goal in the colour and pattern of the pack that
// defends it (L68), stripes for pack 0 and checks for pack 1; the halfway
// line, centre circle and spot, and the goal lines; padded walls with cut
// corners; a rope net overhead; and goals with posts, crossbar and netting.
// Sizes are REQUIREMENTS' Configuration: 40 x 28 m, walls and net 6 m high,
// corners cut 4 m along each wall, mouths 8 m wide, 3 m high and 2 m deep.
// Each kind of surface is one merged geometry, so the pitch is a handful of
// draw calls.

import {
  BufferAttribute, BufferGeometry, CapsuleGeometry, CircleGeometry, Color, DataTexture, Group, LineBasicMaterial,
  LineSegments, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshLambertMaterial, PlaneGeometry, RepeatWrapping,
  RingGeometry, SRGBColorSpace, Vector3, type Texture,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GRASS, LINE, PACKS } from './look';

export const PITCH = {
  halfLength: 20,
  halfWidth: 14,
  cut: 4,
  height: 6,
  mouthHalfWidth: 4,
  mouthHeight: 3,
  goalDepth: 2,
  frameRadius: 0.1,
} as const;

export interface PitchOptions {
  /** Net spacing in metres: overhead and goal netting (D-33: low simplifies the net). */
  netSpacing: number;
  goalNetSpacing: number;
  anisotropy: number;
}

export interface Pitch {
  object: Group;
  /** The goal nets, x < 0 then x > 0, whose origin is on the goal line, for the bulge. */
  goalNets: [LineSegments, LineSegments];
  textures: Texture[];
  dispose(): void;
}

/** A deterministic hash in [0, 1) of two integers. */
function hash2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The grass texture: light, so the halves' vertex colours tint it; it tiles. */
export function grassTexture(size = 256): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const cell = 16;
  const noise = (x: number, y: number): number => {
    // Tileable value noise on a 16-pixel lattice.
    const n = size / cell;
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    const fx = x / cell - gx;
    const fy = y / cell - gy;
    const s = (a: number): number => a * a * (3 - 2 * a);
    const v = (i: number, j: number): number => hash2(((i % n) + n) % n, ((j % n) + n) % n);
    const a = v(gx, gy) + (v(gx + 1, gy) - v(gx, gy)) * s(fx);
    const b = v(gx, gy + 1) + (v(gx + 1, gy + 1) - v(gx, gy + 1)) * s(fx);
    return a + (b - a) * s(fy);
  };
  const shade = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) shade[y * size + x] = 0.84 + 0.1 * noise(x, y);
  }
  // Blades: short light and dark strokes, wrapping at the edges.
  for (let k = 0; k < 2600; k++) {
    const x0 = Math.floor(hash2(k, 1) * size);
    const y0 = Math.floor(hash2(k, 2) * size);
    const len = 3 + Math.floor(hash2(k, 3) * 5);
    const lean = hash2(k, 4) - 0.5;
    const d = hash2(k, 5) < 0.5 ? 0.09 : -0.08;
    for (let i = 0; i < len; i++) {
      const x = (((x0 + Math.round(lean * i)) % size) + size) % size;
      const y = (y0 + i) % size;
      shade[y * size + x] = Math.min(1, Math.max(0, shade[y * size + x]! + d * (1 - i / len)));
    }
  }
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(shade[i]! * 255);
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

/** A builder for flat-shaded quads with their own colours. */
class Quads {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];
  readonly uv: number[] = [];
  private readonly c = new Color();

  /** a, b, c, d counter-clockwise seen from the front. */
  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, colour: number, uvScale = 0): void {
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(d, a)).normalize();
    this.c.setHex(colour);
    for (const p of [a, b, c, a, c, d]) {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(n.x, n.y, n.z);
      this.col.push(this.c.r, this.c.g, this.c.b);
      this.uv.push(p.x * uvScale, p.y * uvScale);
    }
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    return g;
  }
}

const mix = (a: number, b: number, t: number): number => new Color(a).lerp(new Color(b), t).getHex();
const scale = (c: number, k: number): number => new Color(c).multiplyScalar(k).getHex();
const v3 = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

/** The floor's colour at a 2 m cell: its half's tint, striped or checked. */
function floorColour(cx: number, cy: number, x: number): number {
  const pack = x < 0 ? 0 : 1;
  const tint = mix(GRASS, PACKS[pack].colour, 0.24);
  const light = PACKS[pack].pattern === 'plain' ? cx % 2 === 0 : (cx + cy) % 2 === 0;
  return light ? tint : scale(tint, 0.86);
}

function floor(): BufferGeometry {
  const q = new Quads();
  const P = PITCH;
  const cell = 2;
  const add = (x0: number, x1: number, y0: number, y1: number): void => {
    for (let x = x0; x < x1; x += cell) {
      for (let y = y0; y < y1; y += cell) {
        const xb = Math.min(x + cell, x1);
        const yb = Math.min(y + cell, y1);
        const cx = Math.round((x + 40) / cell);
        const cy = Math.round((y + 40) / cell);
        q.quad(v3(x, y, 0), v3(xb, y, 0), v3(xb, yb, 0), v3(x, yb, 0), floorColour(cx, cy, x + cell / 2), 0.25);
      }
    }
  };
  add(-P.halfLength, P.halfLength, -P.halfWidth, P.halfWidth);
  // The goals' floors, in their pack's half.
  const m = P.mouthHalfWidth + P.frameRadius;
  add(P.halfLength, P.halfLength + P.goalDepth, -m, m);
  add(-P.halfLength - P.goalDepth, -P.halfLength, -m, m);
  return q.geometry();
}

function lines(): BufferGeometry {
  const P = PITCH;
  const w = 0.12;
  const parts: BufferGeometry[] = [
    new PlaneGeometry(w, 2 * P.halfWidth),
    new RingGeometry(3 - w / 2, 3 + w / 2, 72),
    new CircleGeometry(0.22, 20),
    new PlaneGeometry(w, 2 * P.mouthHalfWidth).translate(P.halfLength - w / 2, 0, 0),
    new PlaneGeometry(w, 2 * P.mouthHalfWidth).translate(-P.halfLength + w / 2, 0, 0),
  ];
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  if (!g) throw new Error('could not merge the lines');
  for (const p of parts) p.dispose();
  return g.translate(0, 0, 0.002);
}

/** The wall's inner outline, counter-clockwise seen from above, as panels. */
function wallSegments(): [number, number, number, number][] {
  const L = PITCH.halfLength;
  const W = PITCH.halfWidth;
  const C = PITCH.cut;
  const m = PITCH.mouthHalfWidth + PITCH.frameRadius;
  return [
    [-L + C, -W, 0, -W], [0, -W, L - C, -W], [L - C, -W, L, -W + C],
    [L, -W + C, L, -m], [L, m, L, W - C],
    [L, W - C, L - C, W], [L - C, W, 0, W], [0, W, -L + C, W], [-L + C, W, -L, W - C],
    [-L, W - C, -L, m], [-L, -m, -L, -W + C], [-L, -W + C, -L + C, -W],
  ];
}

const PAD = 1.2;

function walls(): BufferGeometry {
  const q = new Quads();
  const H = PITCH.height;
  const upper = 0xe6ecef;
  const panel = (x0: number, y0: number, x1: number, y1: number, z0: number, z1: number): void => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.round(len / 2));
    for (let i = 0; i < n; i++) {
      const a = i / n;
      const b = (i + 1) / n;
      const ax = x0 + (x1 - x0) * a;
      const ay = y0 + (y1 - y0) * a;
      const bx = x0 + (x1 - x0) * b;
      const by = y0 + (y1 - y0) * b;
      const pack = (ax + bx) / 2 < 0 ? 0 : 1;
      // Padding: cushions in the half's colour, seams between them; panels above.
      const pad = scale(mix(PACKS[pack].colour, 0xffffff, 0.15), i % 2 === 0 ? 0.92 : 0.8);
      // Wound so the front face looks into the pitch: left of the outline's direction.
      const face = (lo: number, hi: number, colour: number): void =>
        q.quad(v3(bx, by, lo), v3(ax, ay, lo), v3(ax, ay, hi), v3(bx, by, hi), colour);
      if (z0 < PAD) face(z0, Math.min(PAD, z1), pad);
      if (z1 > PAD) face(Math.max(PAD, z0), z1, i % 2 === 0 ? upper : scale(upper, 0.94));
    }
  };
  for (const [x0, y0, x1, y1] of wallSegments()) panel(x0, y0, x1, y1, 0, H);
  // Above each mouth.
  const L = PITCH.halfLength;
  const m = PITCH.mouthHalfWidth + PITCH.frameRadius;
  const top = PITCH.mouthHeight + PITCH.frameRadius;
  panel(L, -m, L, m, top, H);
  panel(-L, m, -L, -m, top, H);
  return q.geometry();
}

function goalFrames(): BufferGeometry {
  const P = PITCH;
  const r = P.frameRadius;
  const m = P.mouthHalfWidth + r;
  const h = P.mouthHeight + r;
  const parts: BufferGeometry[] = [];
  const c = new Color();
  const coloured = (g: BufferGeometry, colour: number): BufferGeometry => {
    const n = g.getAttribute('position').count;
    c.setHex(colour);
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new BufferAttribute(a, 3));
    return g;
  };
  for (const pack of [0, 1] as const) {
    const x = pack === 0 ? -P.halfLength : P.halfLength;
    const colour = PACKS[pack].colour;
    // Capsules stand along +y; posts turned to +z, the crossbar to +y.
    for (const y of [-m, m]) parts.push(coloured(new CapsuleGeometry(r, h, 4, 12).rotateX(Math.PI / 2).translate(x, y, h / 2), colour));
    parts.push(coloured(new CapsuleGeometry(r, 2 * m, 4, 12).translate(x, 0, h), colour));
  }
  const g = mergeGeometries(parts);
  if (!g) throw new Error('could not merge the goal frames');
  for (const p of parts) p.dispose();
  return g;
}

/** Grid lines over a rectangle in a plane, for netting. */
function grid(out: number[], o: Vector3, u: Vector3, v: Vector3, lu: number, lv: number, step: number): void {
  const nu = Math.max(1, Math.round(lu / step));
  const nv = Math.max(1, Math.round(lv / step));
  const p = (a: number, b: number): Vector3 => o.clone().addScaledVector(u, a).addScaledVector(v, b);
  for (let i = 0; i <= nu; i++) {
    const a = (lu * i) / nu;
    const s = p(a, 0);
    const e = p(a, lv);
    out.push(s.x, s.y, s.z, e.x, e.y, e.z);
  }
  for (let j = 0; j <= nv; j++) {
    const b = (lv * j) / nv;
    const s = p(0, b);
    const e = p(lu, b);
    out.push(s.x, s.y, s.z, e.x, e.y, e.z);
  }
}

function lineGeometry(points: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(points), 3));
  return g;
}

/** The overhead rope net, clipped to the outline with its cut corners. */
function overheadNet(step: number): BufferGeometry {
  const P = PITCH;
  const z = P.height;
  const pts: number[] = [];
  const reach = P.halfLength + P.halfWidth - P.cut;
  for (let x = -P.halfLength; x <= P.halfLength + 1e-9; x += step) {
    const y = Math.min(P.halfWidth, reach - Math.abs(x));
    pts.push(x, -y, z, x, y, z);
  }
  for (let y = -P.halfWidth; y <= P.halfWidth + 1e-9; y += step) {
    const x = Math.min(P.halfLength, reach - Math.abs(y));
    pts.push(-x, y, z, x, y, z);
  }
  return lineGeometry(pts);
}

/** One goal's netting, with its origin on the goal line; +1 or -1 for the end. */
function goalNet(side: number, step: number): BufferGeometry {
  const P = PITCH;
  const m = P.mouthHalfWidth + P.frameRadius;
  const h = P.mouthHeight + P.frameRadius;
  const d = P.goalDepth;
  const pts: number[] = [];
  const X = v3(side, 0, 0);
  const Y = v3(0, 1, 0);
  const Z = v3(0, 0, 1);
  grid(pts, v3(side * d, -m, 0), Y, Z, 2 * m, h, step); // back
  grid(pts, v3(0, -m, 0), X, Z, d, h, step); // sides
  grid(pts, v3(0, m, 0), X, Z, d, h, step);
  grid(pts, v3(0, -m, h), X, Y, d, 2 * m, step); // top
  return lineGeometry(pts);
}

export function buildPitch(o: PitchOptions): Pitch {
  const object = new Group();
  object.name = 'pitch';
  const grass = grassTexture();
  grass.anisotropy = o.anisotropy;
  const floorMat = new MeshLambertMaterial({ map: grass, vertexColors: true });
  const lineMat = new MeshLambertMaterial({ color: LINE, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const wallMat = new MeshLambertMaterial({ vertexColors: true });
  const frameMat = new MeshLambertMaterial({ vertexColors: true });
  const ropeMat = new LineBasicMaterial({ color: 0xcdb98c });
  const netMat = new LineBasicMaterial({ color: 0xf6f6f2 });
  const meshes = [
    new Mesh(floor(), floorMat),
    new Mesh(lines(), lineMat),
    new Mesh(walls(), wallMat),
    new Mesh(goalFrames(), frameMat),
  ];
  const names = ['floor', 'lines', 'walls', 'goal-frames'];
  meshes.forEach((m, i) => {
    m.name = names[i]!;
    object.add(m);
  });
  const rope = new LineSegments(overheadNet(o.netSpacing), ropeMat);
  rope.name = 'overhead-net';
  object.add(rope);
  const nets: LineSegments[] = [];
  for (const side of [-1, 1]) {
    const n = new LineSegments(goalNet(side, o.goalNetSpacing), netMat);
    n.name = side < 0 ? 'goal-net-0' : 'goal-net-1';
    n.position.x = side * PITCH.halfLength;
    object.add(n);
    nets.push(n);
  }
  const materials = [floorMat, lineMat, wallMat, frameMat, ropeMat, netMat];
  return {
    object,
    goalNets: [nets[0]!, nets[1]!],
    textures: [grass],
    dispose() {
      object.traverse((c) => {
        if (c instanceof Mesh || c instanceof LineSegments) c.geometry.dispose();
      });
      for (const m of materials) m.dispose();
      grass.dispose();
      object.removeFromParent();
    },
  };
}
