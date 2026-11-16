// The one replaceable terrier drawer (PLAN D-27). A drawer takes each
// frame's interpolated poses, with their animation state from the view, and
// returns its drawing counts; it never feeds anything back to the source.
// The code-built drawer and the model drawer both implement it.

import type { Camera, Object3D, Scene, WebGLRenderer } from 'three';
import type { DrawFrame } from './interpolate';

/** The terriers' own counts, for the drawing budget (PLAN §12). */
export interface DrawerCounts {
  kind: 'code' | 'model';
  terriers: number;
  /** Triangles for one terrier, and for all of them. */
  trianglesPerTerrier: number;
  triangles: number;
  /** Draw calls for all the terriers, if every one is drawn. */
  drawCalls: number;
  bonesPerTerrier: number;
  bones: number;
  textures: number;
  /** Texture memory, mipmaps included, as RGBA8. */
  textureBytes: number;
  /** The largest texture's size, as "W x H", or "" for none. */
  textureSize: string;
  geometries: number;
  /** Which coats and packs this drawer painted (D-27's convention). */
  coatsPainted: number[];
  packsPainted: number[];
}

export interface TerrierDrawer {
  readonly kind: 'code' | 'model';
  /** Everything the drawer draws, on TERRIER_LAYER as well as the default layer. */
  readonly object: Object3D;
  draw(frame: DrawFrame): void;
  counts(): DrawerCounts;
  /**
   * Compiles the drawer's programs before it's shown (PLAN §12: nothing
   * compiles in play), against the scene it joins, whose lights the programs
   * depend on.
   */
  compile(renderer: WebGLRenderer, camera: Camera, scene: Scene): Promise<void>;
  dispose(): void;
}

/** The layer the terriers are also on, so a pass can draw them alone and count them. */
export const TERRIER_LAYER = 1;

/** Seconds since the pose's phase began, at the drawn time. */
export function phaseSeconds(time: number, phaseStartTick: number, tickRate: number): number {
  return Math.max(0, (time - phaseStartTick) / tickRate);
}

/** Bytes of an RGBA8 texture of w x h, with a full mipmap chain if mipmapped. */
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
