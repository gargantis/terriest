// The empty pitch (PLAN §12), drawn from the simulation's own pieces in
// src/core/sim/pitch.ts, so the pitch the page draws is the one played on
// (D-4). Ported from the M0 spike's scene/pitch.ts:
// - grass, with a texture made at run time;
// - each half, and the goal at its end, in the colour and pattern of the
//   pack that defends it (L68): a plain pack's half is plain and its goal
//   frame one colour; a striped pack's half is mown in bands and its frame
//   banded;
// - the halfway line, the centre spot and the goal lines;
// - the rope net overhead, and each goal's posts, crossbar and netting.
// From C-57 the walls and cut corners are glass, with a rail along their
// top (src/render/glass.ts), the arena stands on the ground beyond them
// (ground.ts), and the goals' frames and netting give way to the camera
// (goal-fade.ts), so a player's camera can go outside the arena. Its
// colours are the look's (src/render/look.ts, M4's design §1.11, §1.18), so
// the look book draws the pitch of each sample; white, which a striped
// frame and the glass's details mix with, is no look's choice. Eight draw
// calls: the floor, its lines, the ground, the rail, the glass's inner
// draw, the goal frames, the overhead net and the goals' netting; and a
// ninth, the glass's outer draw, only while the camera is outside some
// wall's plane. The goal frames and the overhead net are occluders (D-28,
// L89, §2.6): each material is made in two variants by src/render/fade.ts,
// with an object holding the other variant for prepare()'s compile, and
// setFade() puts each part on the variant it needs, the dithered one only
// in a frame one of its pieces crosses the fade's capsule. The glass, the
// frames and the netting fade round the capsule's line by their alpha too
// (fade.ts's line fade), which setFade() updates; and setFade() decides,
// from the camera's place, which panes each of the glass's draws keeps and
// how much of each netting face shows, which their shaders read, and
// reports both (C-57). Phase 3's effects builder adds the netting's bulge
// (setBulge) and fills the fade. Metres, z up.

import {
  Box3, BufferAttribute, type BufferGeometry, CapsuleGeometry, DataTexture, Group, LineBasicMaterial, LineSegments,
  LinearFilter, LinearMipmapLinearFilter, type Material, Mesh, MeshLambertMaterial, type Object3D, Quaternion, RepeatWrapping,
  SRGBColorSpace, Vector3,
} from 'three';
import { FRAME, GOAL_NET, NET, type Pack, type Piece, type Pitch, type Point } from '../core/sim/pitch';
import { crossesFade, type Faded, fadeVariants, lineFadeUniforms, updateLineFade } from './fade';
import type { Bulge } from './frame';
import { glassGeometry, glassMaterial, outerDrawn, railGeometry, wallPlanes, wallSides, wallSidesUniform } from './glass';
import { facesShown, facesShownUniform, goalFrameMaterial, goalNettingMaterial, nettingFaces } from './goal-fade';
import { groundGeometry, groundMaterial } from './ground';
import type { Look } from './look';
import { along, edge1, edge2, Lines, mix, origin, shade, Triangles, type V, WHITE } from './shapes';

export interface PitchDetail {
  readonly ropeSpacingMetres: number;
  readonly nettingSpacingMetres: number;
  readonly anisotropy: number;
}

export interface DrawnPitch {
  readonly object: Group;
  /** One object for each occluder's other variant, hidden but for prepare()'s compile (M4's design §2.1). */
  readonly variants: readonly Object3D[];
  /** Each frame, after fade.ts's setFade, with the placed camera's position, whichever camera it is, the
   *  overview's included: each occluder on the variant it needs, the line fade from the capsule, the panes each of
   *  the glass's draws keeps, the outer draw only while the camera is outside some wall's plane, and how much of
   *  each netting face shows. */
  setFade(camera: Readonly<Vector3>): void;
  /** The glass as the last setFade decided it (C-57): outer, whether its outer draw draws; outside, the walls whose
   *  plane the camera is outside of, by the simulation's names, whose panes the outer draw keeps and the inner
   *  draw drops. */
  readonly glass: { readonly outer: boolean; readonly outside: readonly string[] };
  /** The goals' netting as the last setFade decided it (C-57): each face drawn less than whole, by the simulation's
   *  name, with how much of it shows, 0 for none. */
  readonly netting: readonly { readonly name: string; readonly shown: number }[];
  /** A goal's netting bulging round the ball (§2.6): phase 3's; nothing until then. */
  setBulge(b: Bulge | null): void;
  dispose(): void;
}

/** How much of its pack's colour a half's grass takes. */
const HALF_TINT = 0.24;
/** A striped pack's mown bands, across the pitch. */
const BAND_METRES = 2;
const BAND_SHADE = 0.86;
const LINE_WIDTH_METRES = 0.12;
const SPOT_RADIUS_METRES = 0.22;
/** The markings sit this far above the floor, with a polygon offset too. */
const MARKING_LIFT_METRES = 0.004;
/** A striped pack's goal frame, in bands about this long. */
const FRAME_BAND_METRES = 0.5;
/** How much of its pack's colour a goal's netting takes. */
const NETTING_TINT = 0.35;
/** The transparent things' order (C-57): the glass's inner draw first, as from inside the walls everything else
 *  transparent is in front of it; the goals' frames, then their netting; the blob shadows (src/render/shadows.ts's
 *  1) and phase 3's dust; and the glass's outer draw last, as from outside everything else is behind it. */
const ORDER = { innerGlass: -3, goalFrames: -2, goalNetting: -1, outerGlass: 2 } as const;

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
function floor(p: Pitch, look: Look): BufferGeometry {
  const t = new Triangles();
  for (const pack of [0, 1] as const) {
    const tint = mix(look.pitch.grass, look.packs[pack].colour, HALF_TINT);
    for (const area of [p.halves[pack].outline, p.goals[pack].floor]) {
      if (look.packs[pack].pattern === 'plain') {
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
function markings(p: Pitch, look: Look): BufferGeometry {
  const t = new Triangles();
  const paint = look.pitch.line;
  const z = MARKING_LIFT_METRES;
  const half = LINE_WIDTH_METRES / 2;
  const across = chord(p.outline, 0, 0);
  if (across) t.fan([[-half, across[0]], [half, across[0]], [half, across[1]], [-half, across[1]]], z, paint);
  const spot: Point[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * 2 * Math.PI;
    spot.push([SPOT_RADIUS_METRES * Math.cos(a), SPOT_RADIUS_METRES * Math.sin(a)]);
  }
  t.fan(spot, z, paint);
  for (const goal of p.goals) {
    // On the pitch's side of the line, across the mouth.
    const inward = goal.lineX < 0 ? LINE_WIDTH_METRES : -LINE_WIDTH_METRES;
    const x0 = Math.min(goal.lineX, goal.lineX + inward);
    const x1 = Math.max(goal.lineX, goal.lineX + inward);
    const y = goal.mouthWidth / 2;
    t.fan([[x0, -y], [x1, -y], [x1, y], [x0, y]], z, paint);
  }
  return t.geometry();
}

/** A post or crossbar: a capsule along its piece's segment, in its goal's
 *  pack's colour, banded with white for a striped pack. */
function frame(q: Piece, pack: Pack, look: Look, t: Triangles): void {
  const axis = new Vector3(q.e1x, q.e1y, q.e1z);
  const length = axis.length();
  axis.normalize();
  const colour = look.packs[pack].colour;
  const bands = look.packs[pack].pattern === 'striped' ? Math.max(1, Math.round(length / FRAME_BAND_METRES)) : 1;
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

/** The rope net over the floor plan, as lines. */
function overheadNet(p: Pitch, detail: PitchDetail, look: Look): BufferGeometry {
  const t = new Lines();
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
        t.line(at(range[0]), at(range[1]), look.pitch.rope);
      }
    }
  }
  return t.geometry();
}

/** Each goal's back, side and top netting, as lines tinted by its pack, each vertex with its face's index in
 *  goal-fade.ts's nettingFaces order, by which the netting's shader reads how much of the face shows. */
function goalNetting(p: Pitch, detail: PitchDetail, look: Look): BufferGeometry {
  const t = new Lines();
  const face: number[] = [];
  const faces = nettingFaces(p).map((f) => f.name);
  for (const goal of p.goals) {
    const hex = mix(look.pitch.netting, look.packs[goal.pack].colour, NETTING_TINT);
    for (const k of goal.pieces) {
      const q = p.pieces[k]!;
      if (q.surface !== GOAL_NET) continue;
      const o = origin(q);
      const e1 = edge1(q);
      const e2 = edge2(q);
      const n1 = Math.max(1, Math.round(Math.hypot(...e1) / detail.nettingSpacingMetres));
      const n2 = Math.max(1, Math.round(Math.hypot(...e2) / detail.nettingSpacingMetres));
      const first = t.vertices;
      for (let i = 0; i <= n1; i++) t.line(along(o, e1, i / n1), along(along(o, e1, i / n1), e2, 1), hex);
      for (let j = 0; j <= n2; j++) t.line(along(o, e2, j / n2), along(along(o, e2, j / n2), e1, 1), hex);
      const index = faces.indexOf(q.name);
      for (let v = first; v < t.vertices; v++) face.push(index);
    }
  }
  const g = t.geometry();
  g.setAttribute('face', new BufferAttribute(new Float32Array(face), 1));
  return g;
}

/** A piece's bound box, for the fade's test; the overhead net's is the floor plan's, at its height. */
function boundsOf(p: Pitch, q: Piece): Box3 {
  if (q.surface !== NET) return new Box3(new Vector3(q.minX, q.minY, q.minZ), new Vector3(q.maxX, q.maxY, q.maxZ));
  const box = new Box3();
  for (const [x, y] of p.outline) box.expandByPoint(new Vector3(x, y, q.oz));
  return box;
}

/** An occluder: its part, its material's two variants, the object holding the other one, and its
 *  pieces' bounds. */
interface Occluder {
  readonly part: Mesh | LineSegments;
  readonly faded: Faded<Material>;
  readonly variant: Object3D;
  readonly bounds: readonly Box3[];
}

export function drawPitch(p: Pitch, detail: PitchDetail, look: Look): DrawnPitch {
  const object = new Group();
  object.name = 'pitch';
  const grass = grassTexture();
  grass.anisotropy = detail.anisotropy;
  // The line fade's uniforms, shared by the glass's two draws, the goals' frames and their netting; the walls' sides,
  // which both of the glass's draws read; and how much of each netting face shows.
  const fade = lineFadeUniforms();
  const planes = wallPlanes(p);
  const sides = wallSidesUniform(planes);
  const faces = nettingFaces(p);
  const shown = facesShownUniform(faces);

  const frames = new Triangles();
  for (const goal of p.goals) {
    for (const k of goal.pieces) if (p.pieces[k]!.surface === FRAME) frame(p.pieces[k]!, goal.pack, look, frames);
  }

  const floorMaterial = new MeshLambertMaterial({ map: grass, vertexColors: true });
  const markingsMaterial = new MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  // The rail's, lit as the markings are, so it shares their program.
  const railMaterial = new MeshLambertMaterial({ vertexColors: true });
  const floorPart = new Mesh(floor(p, look), floorMaterial);
  floorPart.name = 'floor';
  const markingsPart = new Mesh(markings(p, look), markingsMaterial);
  markingsPart.name = 'markings';
  const groundPart = new Mesh(groundGeometry(p, look), groundMaterial());
  groundPart.name = 'ground';
  const railPart = new Mesh(railGeometry(p, look), railMaterial);
  railPart.name = 'rail';
  // The glass: one geometry, its inner draw first of the transparent things and its outer draw last.
  const glass = glassGeometry(p);
  const innerGlass = new Mesh(glass, glassMaterial(look, false, fade, sides));
  innerGlass.name = 'glass, inner';
  innerGlass.renderOrder = ORDER.innerGlass;
  const outerGlass = new Mesh(glass, glassMaterial(look, true, fade, sides));
  outerGlass.name = 'glass, outer';
  outerGlass.renderOrder = ORDER.outerGlass;
  // Until a frame finds the camera outside; prepare()'s compile and upload reach it hidden.
  outerGlass.visible = false;
  const nettingPart = new LineSegments(goalNetting(p, detail, look), goalNettingMaterial(fade, shown));
  nettingPart.name = 'goal netting';
  nettingPart.renderOrder = ORDER.goalNetting;

  const piecesOf = (surface: number): Box3[] => p.pieces.filter((q) => q.surface === surface).map((q) => boundsOf(p, q));
  const occluder = (name: string, make: (m: Material) => Mesh | LineSegments, m: Material, bounds: Box3[]): Occluder => {
    const faded = fadeVariants(m);
    const part = make(faded.opaque);
    part.name = name;
    // The same geometry, so the variant adds a program to compile and nothing to upload.
    const variant = make(faded.dithered);
    variant.name = `${name}, dithered`;
    variant.visible = false;
    return { part, faded, variant, bounds };
  };
  const frameGeometry = frames.geometry();
  const netGeometry = overheadNet(p, detail, look);
  const frameOccluder = occluder('goal frames', (m) => new Mesh(frameGeometry, m), goalFrameMaterial(fade), piecesOf(FRAME));
  frameOccluder.part.renderOrder = ORDER.goalFrames;
  frameOccluder.variant.renderOrder = ORDER.goalFrames;
  const occluders: Occluder[] = [
    frameOccluder,
    occluder('overhead net', (m) => new LineSegments(netGeometry, m), new LineBasicMaterial({ vertexColors: true }), piecesOf(NET)),
  ];

  object.add(
    floorPart, markingsPart, groundPart, railPart, innerGlass, ...occluders.map((o) => o.part), nettingPart, outerGlass,
    ...occluders.map((o) => o.variant),
  );
  const parts = [floorPart, markingsPart, groundPart, railPart, innerGlass, outerGlass, nettingPart];
  const geometries = new Set<BufferGeometry>([...parts.map((o) => o.geometry), frameGeometry, netGeometry]);
  const materials = new Set<Material>(parts.map((o) => o.material));
  for (const o of occluders) materials.add(o.faded.opaque).add(o.faded.dithered);
  return {
    object,
    variants: occluders.map((o) => o.variant),
    setFade(camera: Readonly<Vector3>) {
      for (const o of occluders) o.part.material = o.bounds.some((b) => crossesFade(b)) ? o.faded.dithered : o.faded.opaque;
      updateLineFade(fade);
      outerGlass.visible = outerDrawn(wallSides(planes, camera, sides.value));
      facesShown(faces, p.goalLineX, camera, shown.value);
    },
    get glass() {
      return { outer: outerGlass.visible, outside: planes.filter((_, k) => sides.value[k] === 0).map((q) => q.name) };
    },
    get netting() {
      return faces.flatMap((f, k) => (shown.value[k]! < 1 ? [{ name: f.name, shown: shown.value[k]! }] : []));
    },
    setBulge(_b: Bulge | null) {},
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      grass.dispose();
      object.removeFromParent();
    },
  };
}
