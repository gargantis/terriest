// The code-built drawer (PLAN D-27): rounded shapes, one InstancedMesh per
// part across all terriers, so draw calls don't grow with the terrier count.
// Coats are instance colours plus a markings index (which parts take the
// coat's marking colour); bandanas take the pack's colour, plain for pack 0
// and striped for pack 1.

import {
  BufferAttribute, CapsuleGeometry, Color, ConeGeometry, Group, InstancedMesh, Matrix4, MeshLambertMaterial,
  SphereGeometry, TorusGeometry, type BufferGeometry, type Camera, type Scene, type WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TICK_RATE } from '../contract';
import { TERRIER_LAYER, phaseSeconds, type DrawerCounts, type TerrierDrawer } from './drawer';
import type { DrawFrame } from './interpolate';
import { PACKS, coatOf, type Coat } from './look';
import { SHAPE, newPartMatrices, poseParams, poseParts, rootMatrix, type PartMatrices } from './terrier-pose';

export function triangleCount(g: BufferGeometry): number {
  const n = g.index ? g.index.count : g.getAttribute('position').count;
  return n / 3;
}

/** The code-built terrier's geometries, in its own frame (see terrier-pose.ts). */
export function terrierGeometries(): Record<'body' | 'head' | 'snout' | 'face' | 'ear' | 'leg' | 'tail' | 'bandanaPlain' | 'bandanaStriped', BufferGeometry> {
  const s = SHAPE;
  const body = new SphereGeometry(1, 16, 10).scale(s.body.radii.x, s.body.radii.y, s.body.radii.z);
  const head = new SphereGeometry(s.head.radius, 16, 10).translate(s.head.centre.x, s.head.centre.y, s.head.centre.z);
  const snout = new SphereGeometry(1, 10, 6).scale(s.snout.radii.x, s.snout.radii.y, s.snout.radii.z).translate(s.snout.centre.x, 0, s.snout.centre.z);
  const eye = (side: number): BufferGeometry => new SphereGeometry(s.eyes.radius, 6, 4).translate(s.eyes.centre.x, side * s.eyes.centre.y, s.eyes.centre.z);
  const face = mergeGeometries([eye(1), eye(-1), new SphereGeometry(s.nose.radius, 6, 4).translate(s.nose.centre.x, 0, s.nose.centre.z)]);
  if (!face) throw new Error('could not merge the face');
  // Cones and capsules stand along +y; turned to stand along +z from their pivot.
  const ear = new ConeGeometry(s.ear.radius, s.ear.height, 8).rotateX(Math.PI / 2).translate(0, 0, s.ear.height / 2);
  const leg = new CapsuleGeometry(s.legs.radius, s.legs.length - 2 * s.legs.radius, 3, 8).rotateX(Math.PI / 2).translate(0, 0, -s.legs.length / 2);
  const tail = new CapsuleGeometry(s.tail.radius, s.tail.length - 2 * s.tail.radius, 2, 6).rotateX(Math.PI / 2).translate(0, 0, s.tail.length / 2);
  const bandanaPlain = new TorusGeometry(s.bandana.radius, s.bandana.tube, 6, 16);
  // Stripes need crisp edges, so each triangle is coloured alone.
  const bandanaStriped = new TorusGeometry(s.bandana.radius, s.bandana.tube, 6, 16).toNonIndexed();
  const pos = bandanaStriped.getAttribute('position');
  const colours = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i += 3) {
    let cx = 0;
    let cy = 0;
    for (let k = 0; k < 3; k++) {
      cx += pos.getX(i + k);
      cy += pos.getY(i + k);
    }
    const around = (Math.atan2(cy, cx) / (2 * Math.PI) + 1) % 1;
    const shade = Math.floor(around * 8) % 2 === 0 ? 1 : 0.28;
    for (let k = 0; k < 3; k++) colours.set([shade, shade, shade], (i + k) * 3);
  }
  bandanaStriped.setAttribute('color', new BufferAttribute(colours, 3));
  return { body, head, snout, face, ear, leg, tail, bandanaPlain, bandanaStriped };
}

type PartName = 'body' | 'head' | 'snout' | 'face' | 'ears' | 'legs' | 'tail' | 'bandanaPlain' | 'bandanaStriped';

/** Which parts take the coat's marking colour, by markings index. */
function markingParts(c: Coat): ReadonlySet<PartName> {
  switch (c.markings) {
    case 'ears': return new Set(['ears']);
    case 'points': return new Set(['ears', 'snout', 'legs']);
    case 'saddle': return new Set(['body', 'tail']);
    default: return new Set();
  }
}

export class CodeDrawer implements TerrierDrawer {
  readonly kind = 'code' as const;
  readonly object = new Group();
  private readonly meshes: Record<PartName, InstancedMesh>;
  private readonly geometries: BufferGeometry[];
  private readonly materials: MeshLambertMaterial[];
  private readonly parts: PartMatrices = newPartMatrices();
  private readonly root = new Matrix4();
  private readonly painted: { coat: number; pack: number }[] = [];
  private readonly colour = new Color();
  private drawn = 0;
  private readonly trianglesPerTerrier: number;
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    const g = terrierGeometries();
    const fur = new MeshLambertMaterial({ color: 0xffffff });
    const face = new MeshLambertMaterial({ color: 0x1b1714 });
    const plain = new MeshLambertMaterial({ color: 0xffffff });
    const striped = new MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    this.materials = [fur, face, plain, striped];
    const mesh = (name: string, geometry: BufferGeometry, material: MeshLambertMaterial, perTerrier: number): InstancedMesh => {
      const m = new InstancedMesh(geometry, material, capacity * perTerrier);
      m.name = `terrier-${name}`;
      m.count = 0;
      // The instances move every frame; a stale bounding sphere would cull them.
      m.frustumCulled = false;
      m.layers.enable(TERRIER_LAYER);
      if (material !== face) m.setColorAt(0, this.colour.setHex(0xffffff));
      this.object.add(m);
      return m;
    };
    this.meshes = {
      body: mesh('body', g.body, fur, 1),
      head: mesh('head', g.head, fur, 1),
      snout: mesh('snout', g.snout, fur, 1),
      face: mesh('face', g.face, face, 1),
      ears: mesh('ears', g.ear, fur, 2),
      legs: mesh('legs', g.leg, fur, 4),
      tail: mesh('tail', g.tail, fur, 1),
      bandanaPlain: mesh('bandana-plain', g.bandanaPlain, plain, 1),
      bandanaStriped: mesh('bandana-striped', g.bandanaStriped, striped, 1),
    };
    this.geometries = Object.values(g);
    this.trianglesPerTerrier =
      triangleCount(g.body) + triangleCount(g.head) + triangleCount(g.snout) + triangleCount(g.face) +
      2 * triangleCount(g.ear) + 4 * triangleCount(g.leg) + triangleCount(g.tail) +
      Math.max(triangleCount(g.bandanaPlain), triangleCount(g.bandanaStriped));
  }

  draw(frame: DrawFrame): void {
    const ts = frame.terriers;
    const n = Math.min(ts.length, this.capacity);
    const M = this.meshes;
    let plain = 0;
    let striped = 0;
    for (let i = 0; i < n; i++) {
      const p = ts[i]!;
      const q = poseParams(p, phaseSeconds(frame.time, p.phaseStartTick, TICK_RATE), frame.time);
      poseParts(rootMatrix(this.root, p), q, this.parts);
      const P = this.parts;
      M.body.setMatrixAt(i, P.body);
      M.head.setMatrixAt(i, P.head);
      M.snout.setMatrixAt(i, P.head);
      M.face.setMatrixAt(i, P.head);
      M.ears.setMatrixAt(2 * i, P.ears[0]);
      M.ears.setMatrixAt(2 * i + 1, P.ears[1]);
      for (let k = 0; k < 4; k++) M.legs.setMatrixAt(4 * i + k, P.legs[k]!);
      M.tail.setMatrixAt(i, P.tail);
      const stripedPack = PACKS[p.pack].pattern === 'striped';
      const band = stripedPack ? M.bandanaStriped : M.bandanaPlain;
      const slot = stripedPack ? striped++ : plain++;
      band.setMatrixAt(slot, P.bandana);
      band.setColorAt(slot, this.colour.setHex(PACKS[p.pack].colour));
      this.paint(i, p.coat, p.pack);
    }
    for (const name of ['body', 'head', 'snout', 'face', 'tail'] as const) M[name].count = n;
    M.ears.count = 2 * n;
    M.legs.count = 4 * n;
    M.bandanaPlain.count = plain;
    M.bandanaStriped.count = striped;
    for (const m of Object.values(M)) {
      m.instanceMatrix.needsUpdate = true;
    }
    // Bandana colours follow the slot order, which can change with the packs.
    for (const m of [M.bandanaPlain, M.bandanaStriped]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    this.drawn = n;
  }

  /** Sets a terrier's coat colours, only when its coat or pack changed. */
  private paint(i: number, coat: number, pack: number): void {
    const was = this.painted[i];
    if (was && was.coat === coat && was.pack === pack) return;
    this.painted[i] = { coat, pack };
    const c = coatOf(coat);
    const marked = markingParts(c);
    const set = (name: PartName, index: number): void => {
      const m = this.meshes[name];
      m.setColorAt(index, this.colour.setHex(marked.has(name) ? c.marking : c.fur));
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    };
    for (const name of ['body', 'head', 'snout', 'tail'] as const) set(name, i);
    set('ears', 2 * i);
    set('ears', 2 * i + 1);
    for (let k = 0; k < 4; k++) set('legs', 4 * i + k);
  }

  counts(): DrawerCounts {
    const parts = Object.values(this.meshes).filter((m) => m.count > 0);
    const coats = new Set<number>();
    const packs = new Set<number>();
    for (const p of this.painted.slice(0, this.drawn)) {
      coats.add(p.coat);
      packs.add(p.pack);
    }
    return {
      kind: 'code',
      terriers: this.drawn,
      trianglesPerTerrier: this.trianglesPerTerrier,
      triangles: this.trianglesPerTerrier * this.drawn,
      drawCalls: parts.length,
      bonesPerTerrier: 0,
      bones: 0,
      textures: 0,
      textureBytes: 0,
      textureSize: '',
      geometries: this.geometries.length,
      coatsPainted: [...coats].sort((a, b) => a - b),
      packsPainted: [...packs].sort((a, b) => a - b),
    };
  }

  async compile(renderer: WebGLRenderer, camera: Camera, scene: Scene): Promise<void> {
    await renderer.compileAsync(this.object, camera, scene);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const m of Object.values(this.meshes)) m.dispose();
    this.object.removeFromParent();
  }
}
