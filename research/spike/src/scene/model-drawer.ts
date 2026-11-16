// The model drawer (PLAN D-27): GLTFLoader, a skeleton clone per terrier,
// and an AnimationMixer per terrier whose actions' times are set from the
// view every frame, never advanced by the clock, so a re-simulated state
// redraws the same pose. It's imported dynamically, so it and GLTFLoader are
// a chunk of their own (M0 measures it).
//
// The model's convention (D-27): glTF's axes (+y up, +z forward, metres),
// feet at y = 0 under the collider's centre; one clip per animation phase,
// named as the contract's AnimPhase; a material named `fur` takes the coat's
// fur colour and one named `bandana` the pack's colour. The stand-in made by
// scripts/make-standin.mjs follows it.

import {
  AnimationMixer, Group, LoopOnce, LoopRepeat, Matrix4, Mesh, MeshStandardMaterial, Quaternion, SkinnedMesh,
  type AnimationAction, type AnimationClip, type Bone, type Camera, type Material, type Object3D, type Scene, type Texture,
  type WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { TICK_RATE, type AnimPhase } from '../contract';
import { TERRIER_LAYER, phaseSeconds, textureBytes, type DrawerCounts, type TerrierDrawer } from './drawer';
import type { DrawFrame, TerrierPose } from './interpolate';
import { PACKS, coatOf } from './look';
import { COLLIDER_R } from './terrier-pose';

const PHASES: readonly AnimPhase[] = ['standing', 'running', 'zooming', 'airborne', 'lunging', 'tumbled', 'gettingUp', 'sitting'];
/** How each phase's clip is timed: by the gait, looping on the phase's age, or once and held. */
const TIMING: Record<AnimPhase, 'gait' | 'loop' | 'once'> = {
  standing: 'loop', running: 'gait', zooming: 'gait', airborne: 'once',
  lunging: 'once', tumbled: 'once', gettingUp: 'once', sitting: 'once',
};

/**
 * glTF's axes to the scene's: the model's +z (forward) to +x, its +y (up) to
 * +z, and its +x (the model's left) to +y. Matrix4.set takes rows.
 */
export const BASIS = new Quaternion().setFromRotationMatrix(new Matrix4().set(
  0, 0, 1, 0,
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 0, 1,
));

export interface ModelInfo {
  url: string;
  /** Milliseconds: fetch and parse, then the clones. */
  loadMs: number;
  setupMs: number;
  clips: string[];
  missingClips: string[];
  meshes: number;
  /** The `fur` material's texture: loaded with an image, or why not. */
  texture: { present: boolean; width: number; height: number; kind: string };
}

interface Slot {
  root: Group;
  mixer: AnimationMixer;
  actions: Map<string, AnimationAction>;
  current: AnimationAction | null;
  fur: MeshStandardMaterial[];
  bandana: MeshStandardMaterial[];
  coat: number;
  pack: number;
}

function standardMaterials(o: Object3D, name: string): MeshStandardMaterial[] {
  const out: MeshStandardMaterial[] = [];
  o.traverse((c) => {
    if (!(c instanceof Mesh)) return;
    const mats: Material[] = Array.isArray(c.material) ? c.material : [c.material];
    mats.forEach((m, i) => {
      if (m.name !== name || !(m instanceof MeshStandardMaterial)) return;
      // Each terrier paints its own copy; the texture is still shared.
      const own = m.clone();
      if (Array.isArray(c.material)) c.material[i] = own;
      else c.material = own;
      out.push(own);
    });
  });
  return out;
}

export class ModelDrawer implements TerrierDrawer {
  readonly kind = 'model' as const;
  readonly object = new Group();
  private readonly slots: Slot[] = [];
  private drawn = 0;
  private readonly counted: { trianglesPerTerrier: number; meshesPerTerrier: number; bonesPerTerrier: number; textures: Texture[] };

  private readonly template: Object3D;
  private readonly clips: AnimationClip[];
  readonly capacity: number;

  constructor(template: Object3D, clips: AnimationClip[], capacity: number) {
    this.template = template;
    this.clips = clips;
    this.capacity = capacity;
    let triangles = 0;
    let meshes = 0;
    const bones = new Set<Bone>();
    const textures = new Set<Texture>();
    template.traverse((c) => {
      if (!(c instanceof Mesh)) return;
      meshes++;
      const g = c.geometry;
      triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      if (c instanceof SkinnedMesh) for (const b of c.skeleton.bones) bones.add(b);
      const mats: Material[] = Array.isArray(c.material) ? c.material : [c.material];
      for (const m of mats) if (m instanceof MeshStandardMaterial && m.map) textures.add(m.map);
    });
    this.counted = { trianglesPerTerrier: triangles, meshesPerTerrier: meshes, bonesPerTerrier: bones.size, textures: [...textures] };
    for (let i = 0; i < capacity; i++) this.slots.push(this.makeSlot());
  }

  private makeSlot(): Slot {
    const model = cloneSkinned(this.template);
    model.quaternion.copy(BASIS);
    model.traverse((c) => {
      c.layers.enable(TERRIER_LAYER);
      // Skinned bounds don't follow the pose; every terrier is drawn and counted.
      if (c instanceof Mesh) c.frustumCulled = false;
    });
    const root = new Group();
    root.add(model);
    root.visible = false;
    this.object.add(root);
    const mixer = new AnimationMixer(model);
    const actions = new Map<string, AnimationAction>();
    for (const clip of this.clips) {
      const a = mixer.clipAction(clip);
      const once = TIMING[clip.name as AnimPhase] === 'once';
      a.setLoop(once ? LoopOnce : LoopRepeat, Infinity);
      a.clampWhenFinished = true;
      actions.set(clip.name, a);
    }
    return { root, mixer, actions, current: null, fur: standardMaterials(model, 'fur'), bandana: standardMaterials(model, 'bandana'), coat: -1, pack: -1 };
  }

  draw(frame: DrawFrame): void {
    const n = Math.min(frame.terriers.length, this.capacity);
    for (let i = 0; i < this.capacity; i++) {
      const s = this.slots[i]!;
      const p = frame.terriers[i];
      s.root.visible = i < n && p !== undefined;
      if (p && i < n) this.pose(s, p, frame.time);
    }
    this.drawn = n;
  }

  private pose(s: Slot, p: TerrierPose, time: number): void {
    s.root.position.set(p.x, p.y, p.z - COLLIDER_R);
    s.root.rotation.set(0, 0, p.heading);
    if (s.coat !== p.coat || s.pack !== p.pack) {
      s.coat = p.coat;
      s.pack = p.pack;
      for (const m of s.fur) m.color.setHex(coatOf(p.coat).fur);
      for (const m of s.bandana) m.color.setHex(PACKS[p.pack].colour);
    }
    const action = s.actions.get(p.phase) ?? s.actions.get('standing') ?? null;
    if (action !== s.current) {
      s.current?.stop();
      action?.play();
      s.current = action;
    }
    if (!action) return;
    const d = action.getClip().duration;
    const secs = phaseSeconds(time, p.phaseStartTick, TICK_RATE);
    const how = TIMING[p.phase];
    action.time = how === 'gait' ? p.gait * d : how === 'loop' ? secs % d : Math.min(secs, d);
    s.mixer.update(0);
  }

  counts(): DrawerCounts {
    const coats = new Set<number>();
    const packs = new Set<number>();
    for (const s of this.slots.slice(0, this.drawn)) {
      if (s.fur.length > 0) coats.add(s.coat);
      if (s.bandana.length > 0) packs.add(s.pack);
    }
    const c = this.counted;
    let bytes = 0;
    let size = '';
    let largest = 0;
    for (const t of c.textures) {
      const img = t.image as { width?: number; height?: number } | null;
      const w = img?.width ?? 0;
      const h = img?.height ?? 0;
      bytes += textureBytes(w, h, t.generateMipmaps);
      if (w * h > largest) {
        largest = w * h;
        size = `${w} x ${h}`;
      }
    }
    return {
      kind: 'model',
      terriers: this.drawn,
      trianglesPerTerrier: c.trianglesPerTerrier,
      triangles: c.trianglesPerTerrier * this.drawn,
      drawCalls: c.meshesPerTerrier * this.drawn,
      bonesPerTerrier: c.bonesPerTerrier,
      bones: c.bonesPerTerrier * this.drawn,
      textures: c.textures.length,
      textureBytes: bytes,
      textureSize: size,
      geometries: c.meshesPerTerrier,
      coatsPainted: [...coats].sort((a, b) => a - b),
      packsPainted: [...packs].sort((a, b) => a - b),
    };
  }

  async compile(renderer: WebGLRenderer, camera: Camera, scene: Scene): Promise<void> {
    for (const s of this.slots) s.root.visible = true;
    await renderer.compileAsync(this.object, camera, scene);
    for (const s of this.slots) s.root.visible = false;
  }

  dispose(): void {
    for (const s of this.slots) {
      s.mixer.stopAllAction();
      for (const m of [...s.fur, ...s.bandana]) m.dispose();
    }
    this.template.traverse((c) => {
      if (c instanceof Mesh) {
        c.geometry.dispose();
        const mats: Material[] = Array.isArray(c.material) ? c.material : [c.material];
        for (const m of mats) m.dispose();
      }
    });
    for (const t of this.counted.textures) t.dispose();
    this.object.removeFromParent();
  }
}

/** Loads a model and builds a drawer for `capacity` terriers. */
export async function loadModelDrawer(url: string, capacity: number): Promise<{ drawer: ModelDrawer; info: ModelInfo }> {
  const t0 = performance.now();
  const gltf = await new GLTFLoader().loadAsync(url);
  const t1 = performance.now();
  let meshes = 0;
  let skinned = 0;
  let fur: MeshStandardMaterial | null = null;
  gltf.scene.traverse((c) => {
    if (c instanceof Mesh) meshes++;
    if (c instanceof SkinnedMesh) skinned++;
    if (c instanceof Mesh && !Array.isArray(c.material) && c.material.name === 'fur' && c.material instanceof MeshStandardMaterial) fur = c.material;
  });
  if (skinned === 0) throw new Error(`the model at ${url} has no skinned mesh`);
  const names = gltf.animations.map((a) => a.name);
  const furMap = (fur as MeshStandardMaterial | null)?.map ?? null;
  const img = furMap?.image as { width?: number; height?: number; constructor?: { name?: string } } | undefined;
  const drawer = new ModelDrawer(gltf.scene, gltf.animations, capacity);
  const t2 = performance.now();
  return {
    drawer,
    info: {
      url,
      loadMs: t1 - t0,
      setupMs: t2 - t1,
      clips: names,
      missingClips: PHASES.filter((p) => !names.includes(p)),
      meshes,
      texture: {
        present: furMap !== null && (img?.width ?? 0) > 0,
        width: img?.width ?? 0,
        height: img?.height ?? 0,
        kind: img?.constructor?.name ?? 'none',
      },
    },
  };
}
