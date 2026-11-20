// D-27's one replaceable terrier drawer (M4's design, research/m4/DESIGN.md,
// §1.2, §2.4, §2.5, §2.10): the interface the code-built drawer and the
// model drawer both implement, their input for a frame and their counts.
// From the M0 spike's src/scene/drawer.ts, with M4's changes: a terrier's
// animation arrives as weighted layers (src/render/blends.ts), so both
// drawers cross-fade alike; its bark and its celebration as overlays with
// their starts; and the counts add the overlays drawing now and a latched
// count of those shown, so a spec never has to catch a 0.4 s bark as it
// plays. A drawer takes each frame's drawn terriers and returns its counts;
// it never feeds anything back to the match.

import type { Camera, Object3D, Scene, WebGLRenderer } from 'three';
import type { AnimPhase, Pack } from '../core/sim/index';
import type { Look } from './look';

/** One animation in a terrier's blend: its phase, the tick it started at, and its weight. */
export interface AnimLayer {
  readonly anim: AnimPhase;
  readonly start: number;
  readonly weight: number;
}

/** A bark or a celebration over the pose: start is a drawn time in ticks, and may be fractional. */
export interface Overlay {
  readonly start: number;
  readonly weight: number;
}

/** One terrier for one frame (D-27): its drawn pose, its animation and overlays, its coat and pack. */
export interface TerrierFrame {
  readonly id: string;
  readonly pack: Pack;
  readonly coat: number;
  /** This viewer's terrier: its mark is the DOM overlay's, so a drawer draws it as any other. */
  readonly mine: boolean;
  readonly x: number; readonly y: number; readonly z: number;
  readonly vx: number; readonly vy: number; readonly vz: number;
  /** Radians, and radians a tick. */
  readonly heading: number; readonly headingChange: number;
  /** The weights sum to 1; the newest last. */
  readonly layers: readonly AnimLayer[];
  /** A fraction of a cycle, 0 to 1. */
  readonly gait: number;
  readonly takeOffTick: number; readonly landingTick: number;
  readonly lastBallContactTick: number; readonly lastTerrierContactTick: number;
  readonly lastPushDir: number; readonly lastPushTick: number;
  /** The latest bark (D-16): a received input's tick, or the local press. */
  readonly bark: Overlay | null;
  /** Its pack's confirmed goal (D-14): start is the goal's tick. */
  readonly celebrate: Overlay | null;
}

export interface DrawerFrame {
  /** The drawn time, in ticks. */
  readonly time: number;
  readonly tick: number; readonly fraction: number;
  readonly terriers: readonly TerrierFrame[];
}

/** A drawer's own counts, for the drawing budget (PLAN §12). */
export interface DrawerCounts {
  readonly kind: 'code' | 'model';
  readonly terriers: number;
  readonly trianglesPerTerrier: number; readonly triangles: number;
  /** For every terrier drawn. */
  readonly drawCalls: number;
  readonly bonesPerTerrier: number; readonly bones: number;
  /** The model's own textures: their memory, mipmaps included, as RGBA8, and the largest's "W x H", or "" for none. */
  readonly textures: number; readonly textureBytes: number; readonly textureSize: string;
  readonly geometries: number;
  /** The coats and packs this drawer painted (D-27's convention). */
  readonly coatsPainted: readonly number[]; readonly packsPainted: readonly number[];
  /** Drawing now. */
  readonly overlays: { readonly barking: number; readonly celebrating: number; readonly pushing: number };
  /** Since the drawer was made, each counted once as it starts. */
  readonly overlaysShown: { readonly barking: number; readonly celebrating: number; readonly pushing: number };
}

export interface TerrierDrawer {
  readonly kind: 'code' | 'model';
  /** Everything it draws, on TERRIER_LAYER as well as the default layer. */
  readonly object: Object3D;
  draw(frame: DrawerFrame): void;
  counts(): DrawerCounts;
  /** Compiles its programs against the scene it joins, whose lights they depend on, before it's shown
   *  (PLAN §12: nothing compiles in play). */
  compile(renderer: WebGLRenderer, camera: Camera, scene: Scene): Promise<void>;
  dispose(): void;
}

/** Makes a drawer for `capacity` terriers, painted from `look`. */
export type DrawerFactory = (look: Look, capacity: number) => TerrierDrawer;

/** The layer the terriers are also on, so a pass can draw them alone and count them. */
export const TERRIER_LAYER = 1; // not a setting: three's layer for the counting pass

/** Seconds since a start, at a drawn time, both in ticks; never negative. */
export function secondsSince(time: number, start: number, ticksPerSecond: number): number {
  return Math.max(0, (time - start) / ticksPerSecond);
}

/** Bytes of an RGBA8 texture of w × h, with a full mipmap chain if mipmapped (the spike's textureBytes). */
export function textureBytes(w: number, h: number, mipmaps: boolean): number {
  let bytes = 0;
  let a = w;
  let b = h;
  for (;;) {
    bytes += a * b * 4;
    if (!mipmaps || (a === 1 && b === 1)) break;
    a = Math.max(1, a >> 1);
    b = Math.max(1, b >> 1);
  }
  return bytes;
}
