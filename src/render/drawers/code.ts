// The code-built terrier drawer, the MVP's default (PLAN D-27, §12; L43,
// L44, L97–L99; M4's design, research/m4/DESIGN.md, §1.4, §2.4, §2.5,
// §2.9, §2.11): rounded shapes, one InstancedMesh per part across all the
// terriers, so the draw calls don't grow with their number. A coat is
// painted as instance colours, its markings picking which parts take its
// marking colour; a bandana takes its pack's colour, in a part of its own
// for each pattern, so the packs differ in pattern as well as colour (L43);
// and the look's pack cue, if it has one (Q-11, C-51), is a tenth part. It
// reads only the frame it's handed, poses each terrier by src/render/
// drawers/pose.ts and returns its counts; it feeds nothing back (D-27).
//
// The pack cue keeps a minimum size on screen and differs in shape between
// the packs (§2.9): a marker over each terrier, a cone pointing up for pack
// A and down for pack B, or a ring on the floor round it, round for pack A
// and square for pack B. Pack B's cue is turned over, a rotation, which a
// cone shows and a ring doesn't, so the ring's vertex hook squares the ring
// it finds turned over; the same hook grows a far cue so it never shrinks
// below CUE_MIN_SHARE of the view's height, its bottom kept where it was.
// Each cue's program has one constant cache key, so it compiles once, at
// prepare (PLAN §12).
//
// Its counts are the drawing budget's (§2.11) and the specs' (§9.1): the
// coats and packs painted in the frame drawn last, as the spike's were, so
// prepare()'s frame of placeholders leaves nothing behind it; the overlays
// drawing now; and the overlays shown since it was made, each bark and
// celebration counted once as it starts showing, its start forgotten when
// a frame hands its terrier none, since the drawer outlives each match on
// its stage and the next one's ticks count from 0 again; each push once as
// it begins.
//
// A port of the M0 spike's research/spike/src/scene/code-drawer.ts
// (terrierGeometries, triangleCount, the parts, their painting and counts),
// with M4's changes (§1.4): the shape, the coats and the packs are a Look's;
// each terrier's pose is its layers' blend with the overlays (pose.ts); the
// bark opens a jaw, a second instance of the snout, so no draw call is
// added; the collider's radius is defaultParams'; the pack cue is new; and
// its counts add the overlays. The eyes' and nose's dark is no look's
// choice, as M1's pitch keeps white.

import {
  BufferAttribute, type BufferGeometry, type Camera, CapsuleGeometry, Color, ConeGeometry, Group, InstancedMesh, Matrix4,
  MeshLambertMaterial, type Scene, SphereGeometry, TorusGeometry, type WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { defaultParams } from '../../core/sim/params';
import type { Pack } from '../../core/sim/state';
import { type DrawerCounts, type DrawerFrame, TERRIER_LAYER, type TerrierDrawer } from '../drawer';
import { type Coat, coatOf, type Look, type PackCue, type TerrierShape } from '../look';
import { newOverlayWeights, newPartMatrices, newPoseParams, type PartMatrices, poseParts, rootMatrix, terrierPose } from './pose';

/** The code-built terrier's geometries, by part. */
export type CodePart = 'body' | 'head' | 'snout' | 'face' | 'ear' | 'leg' | 'tail' | 'bandanaPlain' | 'bandanaStriped' | 'cue';

/** terrierGeometries' parts: the cue's is null for a look without one. */
export type TerrierGeometries = Readonly<Record<Exclude<CodePart, 'cue'>, BufferGeometry>> & { readonly cue: BufferGeometry | null };

/** The eyes and the nose: no look's choice. */
const FACE_DARK = 0x1b1714;
/** The striped bandana's stripes round the band, and their dark's share of the pack's colour. */
const STRIPES = 8;
const STRIPE_DARK = 0.28;

// The pack cue's own look (§2.9, Q-11).
/** A cue never shows smaller than this share of the view's height (C-51: 9 px of the phone's 355). */
const CUE_MIN_SHARE = 0.025;
/** The marker: a cone this tall and this wide, centred this high above the terrier's floor point, over its head. */
const MARKER_HEIGHT = 0.2;
const MARKER_RADIUS = 0.09;
const MARKER_ABOVE = 0.72;
/** The ring: round the terrier on the floor, its centre this high, clear of the floor's markings. */
const RING_RADIUS = 0.36;
const RING_TUBE = 0.025;
const RING_LIFT = RING_TUBE + 0.005;

export function triangleCount(g: BufferGeometry): number {
  const n = g.index ? g.index.count : g.getAttribute('position').count;
  return n / 3;
}

/** The pack cue's geometry, in its own frame: a marker's cone tip up, centred on its height; a ring flat round the
 *  origin. Null for none. */
export function cueGeometry(cue: PackCue): BufferGeometry | null {
  if (cue === 'marker') return new ConeGeometry(MARKER_RADIUS, MARKER_HEIGHT, 12).rotateX(Math.PI / 2);
  if (cue === 'ring') return new TorusGeometry(RING_RADIUS, RING_TUBE, 4, 24);
  return null;
}

/** The code-built terrier's geometries, in its own frame (src/render/drawers/pose.ts): the head's parts about the
 *  neck pivot, the rest about the floor point; and the look's pack cue, if any. */
export function terrierGeometries(shape: TerrierShape, cue: PackCue = 'none'): TerrierGeometries {
  const s = shape;
  const body = new SphereGeometry(1, 16, 10).scale(s.body.radii[0], s.body.radii[1], s.body.radii[2]);
  const head = new SphereGeometry(s.head.radius, 16, 10).translate(s.head.centre[0], 0, s.head.centre[2]);
  const snout = new SphereGeometry(1, 10, 6).scale(s.snout.radii[0], s.snout.radii[1], s.snout.radii[2]).translate(s.snout.centre[0], 0, s.snout.centre[2]);
  const eye = (side: number): BufferGeometry => new SphereGeometry(s.eyes.radius, 6, 4).translate(s.eyes.centre[0], side * s.eyes.centre[1], s.eyes.centre[2]);
  const nose = new SphereGeometry(s.nose.radius, 6, 4).translate(s.nose.centre[0], 0, s.nose.centre[2]);
  const parts = [eye(1), eye(-1), nose];
  const face = mergeGeometries(parts);
  for (const g of parts) g.dispose();
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
    const shade = Math.floor(around * STRIPES) % 2 === 0 ? 1 : STRIPE_DARK;
    for (let k = 0; k < 3; k++) colours.set([shade, shade, shade], (i + k) * 3);
  }
  bandanaStriped.setAttribute('color', new BufferAttribute(colours, 3));
  return { body, head, snout, face, ear, leg, tail, bandanaPlain, bandanaStriped, cue: cueGeometry(cue) };
}

/** The cue's vertex hook (§2.9): a far cue grows to CUE_MIN_SHARE of the view's height, its bottom where it was;
 *  a ring turned over, pack B's, is squared. `size` is the cue's height, or a ring's width; `half` how far its
 *  bottom is below its centre. */
function cueVertex(ring: boolean, size: number, half: number): string {
  const growth = ((2 * CUE_MIN_SHARE) / size).toFixed(6);
  const lift = half.toFixed(6);
  return `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
	vec4 terriestCueAt = modelViewMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
	float terriestCueGrowth = max( 1.0, - terriestCueAt.z * ${growth} / projectionMatrix[ 1 ][ 1 ] );
	vec3 terriestCue = transformed;${ring ? `
	if ( instanceMatrix[ 2 ][ 2 ] < 0.0 ) {
		float terriestCueEdge = max( abs( terriestCue.x ), abs( terriestCue.y ) );
		if ( terriestCueEdge > 0.0 ) terriestCue.xy *= length( terriestCue.xy ) / terriestCueEdge;
	}` : ''}
	mvPosition = modelViewMatrix * instanceMatrix * vec4( terriestCue * terriestCueGrowth, 1.0 );
	mvPosition.xyz += ( viewMatrix * vec4( 0.0, 0.0, ( terriestCueGrowth - 1.0 ) * ${lift}, 0.0 ) ).xyz;
#else
	mvPosition = modelViewMatrix * mvPosition;
#endif
gl_Position = projectionMatrix * mvPosition;`;
}

/** The cue's material: its pack's colour from the instance colours, through the vertex hook. */
function cueMaterial(cue: 'marker' | 'ring'): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ color: 0xffffff });
  const ring = cue === 'ring';
  const chunk = ring ? cueVertex(true, 2 * (RING_RADIUS + RING_TUBE), RING_TUBE) : cueVertex(false, MARKER_HEIGHT, MARKER_HEIGHT / 2);
  m.name = `terrier-cue-${cue}`;
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', chunk);
  };
  const key = `terriest cue ${cue}`;
  m.customProgramCacheKey = () => key;
  return m;
}

type PartName = 'body' | 'head' | 'snout' | 'face' | 'ears' | 'legs' | 'tail' | 'bandanaPlain' | 'bandanaStriped' | 'cue';

/** Which parts take the coat's marking colour, by its markings. */
function markingParts(c: Coat): readonly PartName[] {
  switch (c.markings) {
    case 'ears': return ['ears'];
    case 'points': return ['ears', 'snout', 'legs'];
    case 'saddle': return ['body', 'tail'];
    default: return [];
  }
}

/** The coat's place in the list as drawn: one outside it draws as coat 0 (L44, D-12). */
function coatIndex(look: Look, index: number): number {
  return coatOf(look, index) === look.coats[index] ? index : 0;
}

type Shown = { barking: number; celebrating: number; pushing: number };

/** Each terrier's bark and celebration counted as it shows, by its start, null when a frame hands it none; and
 *  whether it was pushing in the last frame. */
interface Seen {
  bark: number | null;
  celebrate: number | null;
  pushing: boolean;
}

class CodeDrawer implements TerrierDrawer {
  readonly kind = 'code' as const;
  readonly object = new Group();
  private readonly look: Look;
  private readonly capacity: number;
  private readonly meshes: Readonly<Record<Exclude<PartName, 'cue'>, InstancedMesh>>;
  private readonly cue: InstancedMesh | null;
  private readonly geometries: BufferGeometry[];
  private readonly materials: MeshLambertMaterial[];
  private readonly parts: PartMatrices = newPartMatrices();
  private readonly root = new Matrix4();
  private readonly cueAt = new Matrix4();
  private readonly turn = new Matrix4().makeRotationX(Math.PI);
  private readonly pose = newPoseParams();
  private readonly weights = newOverlayWeights();
  private readonly painted: { coat: number; pack: Pack }[] = [];
  private readonly colour = new Color();
  private readonly trianglesPerTerrier: number;
  private drawn = 0;
  private now: Shown = { barking: 0, celebrating: 0, pushing: 0 };
  private readonly shown: Shown = { barking: 0, celebrating: 0, pushing: 0 };
  private readonly seen = new Map<string, Seen>();

  constructor(look: Look, capacity: number) {
    this.look = look;
    this.capacity = capacity;
    this.object.name = 'code-built terriers';
    const g = terrierGeometries(look.terrier, look.packCue);
    const fur = new MeshLambertMaterial({ color: 0xffffff });
    const face = new MeshLambertMaterial({ color: FACE_DARK });
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
      // Instance colours from the start, so the program prepare() compiles is the one every frame draws with.
      if (material !== face) m.setColorAt(0, this.colour.setHex(0xffffff));
      this.object.add(m);
      return m;
    };
    this.meshes = {
      body: mesh('body', g.body, fur, 1),
      head: mesh('head', g.head, fur, 1),
      // The snout and the jaw beneath it.
      snout: mesh('snout', g.snout, fur, 2),
      face: mesh('face', g.face, face, 1),
      ears: mesh('ears', g.ear, fur, 2),
      legs: mesh('legs', g.leg, fur, 4),
      tail: mesh('tail', g.tail, fur, 1),
      bandanaPlain: mesh('bandana-plain', g.bandanaPlain, plain, 1),
      bandanaStriped: mesh('bandana-striped', g.bandanaStriped, striped, 1),
    };
    this.geometries = [g.body, g.head, g.snout, g.face, g.ear, g.leg, g.tail, g.bandanaPlain, g.bandanaStriped];
    let cueTriangles = 0;
    if (g.cue !== null && look.packCue !== 'none') {
      const material = cueMaterial(look.packCue);
      this.materials.push(material);
      this.geometries.push(g.cue);
      this.cue = mesh('cue', g.cue, material, 1);
      cueTriangles = triangleCount(g.cue);
    } else {
      this.cue = null;
    }
    this.trianglesPerTerrier =
      triangleCount(g.body) + triangleCount(g.head) + 2 * triangleCount(g.snout) + triangleCount(g.face) +
      2 * triangleCount(g.ear) + 4 * triangleCount(g.leg) + triangleCount(g.tail) +
      Math.max(triangleCount(g.bandanaPlain), triangleCount(g.bandanaStriped)) + cueTriangles;
  }

  draw(frame: DrawerFrame): void {
    const ts = frame.terriers;
    const n = Math.min(ts.length, this.capacity);
    const M = this.meshes;
    const P = this.parts;
    const now: Shown = { barking: 0, celebrating: 0, pushing: 0 };
    let plain = 0;
    let striped = 0;
    for (let i = 0; i < n; i++) {
      const t = ts[i]!;
      terrierPose(t, frame.time, this.look.terrier, this.pose, this.weights);
      poseParts(rootMatrix(this.root, t, defaultParams.terrierRadius), this.pose, this.look.terrier, P);
      M.body.setMatrixAt(i, P.body);
      M.head.setMatrixAt(i, P.head);
      M.snout.setMatrixAt(2 * i, P.head);
      M.snout.setMatrixAt(2 * i + 1, P.jaw);
      M.face.setMatrixAt(i, P.head);
      M.ears.setMatrixAt(2 * i, P.ears[0]);
      M.ears.setMatrixAt(2 * i + 1, P.ears[1]);
      for (let k = 0; k < 4; k++) M.legs.setMatrixAt(4 * i + k, P.legs[k]!);
      M.tail.setMatrixAt(i, P.tail);
      const pack = this.look.packs[t.pack];
      const band = pack.pattern === 'striped' ? M.bandanaStriped : M.bandanaPlain;
      const slot = pack.pattern === 'striped' ? striped++ : plain++;
      band.setMatrixAt(slot, P.bandana);
      band.setColorAt(slot, this.colour.setHex(pack.colour));
      if (this.cue !== null) {
        this.cue.setMatrixAt(i, this.cueMatrix(P.cue, t.pack));
        this.cue.setColorAt(i, this.colour.setHex(pack.colour));
      }
      this.paint(i, coatIndex(this.look, t.coat), t.pack);
      this.count(t.id, t.bark?.start ?? null, t.celebrate?.start ?? null, now);
    }
    for (const name of ['body', 'head', 'face', 'tail'] as const) M[name].count = n;
    M.snout.count = 2 * n;
    M.ears.count = 2 * n;
    M.legs.count = 4 * n;
    M.bandanaPlain.count = plain;
    M.bandanaStriped.count = striped;
    for (const m of Object.values(M)) m.instanceMatrix.needsUpdate = true;
    // Bandana colours follow the slot order, which can change with the packs.
    for (const m of [M.bandanaPlain, M.bandanaStriped]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    if (this.cue !== null) {
      this.cue.count = n;
      this.cue.instanceMatrix.needsUpdate = true;
      if (this.cue.instanceColor) this.cue.instanceColor.needsUpdate = true;
    }
    this.drawn = n;
    this.now = now;
  }

  /** The cue on its base: a marker over the head, a ring on the floor; pack B's turned over. */
  private cueMatrix(base: Matrix4, pack: Pack): Matrix4 {
    const b = base.elements;
    const z = this.look.packCue === 'ring' ? RING_LIFT : b[14]! + MARKER_ABOVE;
    this.cueAt.makeTranslation(b[12]!, b[13]!, z);
    return pack === 1 ? this.cueAt.multiply(this.turn) : this.cueAt;
  }

  /** Counts the overlays the pose just showed for one terrier: drawing now, and shown once each as it starts. */
  private count(id: string, barkStart: number | null, celebrateStart: number | null, now: Shown): void {
    const w = this.weights;
    let seen = this.seen.get(id);
    if (seen === undefined) {
      seen = { bark: null, celebrate: null, pushing: false };
      this.seen.set(id, seen);
    }
    // A frame that hands the terrier none has ended its last: the drawer outlives each match on its stage,
    // whose ticks count from 0 again, so the same terrier's next one may start at the same tick.
    if (barkStart === null) seen.bark = null;
    if (celebrateStart === null) seen.celebrate = null;
    if (w.bark > 0) {
      now.barking++;
      if (barkStart !== seen.bark) this.shown.barking++;
      seen.bark = barkStart;
    }
    if (w.celebrate > 0) {
      now.celebrating++;
      if (celebrateStart !== seen.celebrate) this.shown.celebrating++;
      seen.celebrate = celebrateStart;
    }
    const pushing = w.pushing > 0;
    if (pushing) {
      now.pushing++;
      if (!seen.pushing) this.shown.pushing++;
    }
    seen.pushing = pushing;
  }

  /** Sets a terrier's coat colours, only when its coat or pack changed. */
  private paint(i: number, coat: number, pack: Pack): void {
    const was = this.painted[i];
    if (was && was.coat === coat && was.pack === pack) return;
    this.painted[i] = { coat, pack };
    const c = coatOf(this.look, coat);
    const marked = markingParts(c);
    const set = (name: Exclude<PartName, 'cue'>, index: number): void => {
      const m = this.meshes[name];
      m.setColorAt(index, this.colour.setHex(marked.includes(name) ? c.marking : c.fur));
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    };
    for (const name of ['body', 'head', 'tail'] as const) set(name, i);
    for (let k = 0; k < 2; k++) {
      set('snout', 2 * i + k);
      set('ears', 2 * i + k);
    }
    for (let k = 0; k < 4; k++) set('legs', 4 * i + k);
  }

  counts(): DrawerCounts {
    const parts = [...Object.values(this.meshes), ...(this.cue === null ? [] : [this.cue])].filter((m) => m.count > 0);
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
      overlays: { ...this.now },
      overlaysShown: { ...this.shown },
    };
  }

  async compile(renderer: WebGLRenderer, camera: Camera, scene: Scene): Promise<void> {
    await renderer.compileAsync(this.object, camera, scene);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const m of [...Object.values(this.meshes), ...(this.cue === null ? [] : [this.cue])]) m.dispose();
    this.object.removeFromParent();
  }
}

/** The code-built drawer for `capacity` terriers, painted from `look`: a DrawerFactory (§1.4). */
export function createCodeDrawer(look: Look, capacity: number): TerrierDrawer {
  return new CodeDrawer(look, capacity);
}
