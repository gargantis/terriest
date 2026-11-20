// The blob shadows (PLAN §12; M4's design, research/m4/DESIGN.md, §1.8,
// §2.1): one instanced quad on the floor under each terrier and one under
// the ball, a soft black disc, smaller and so fainter as a body rises. One
// draw call for all of them, its instances given out at prepare. A port of
// the M0 spike's (research/spike/src/scene/ball.ts's Shadows and
// blobTexture), with the radii from defaultParams, never a copy, and the
// spike's sizes as shares of them.

import { DataTexture, FrontSide, InstancedMesh, LinearFilter, LinearMipmapLinearFilter, Matrix4, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';
import { defaultParams } from '../core/sim/params';
import type { DrawnMatch } from './frame';

// The shadows' look, the spike's: a terrier's 0.62 m across on its 0.25 m
// radius and the ball's 1.7 m on its 0.8 m, shrinking as the body rises to
// at most this share of their size.
const TERRIER_SHADOW_RADII = 2.48;
const BALL_SHADOW_RADII = 2.125;
/** Shrinking with the body's height over the floor, to its smallest at this height. */
const FADE_HEIGHT_METRES = 5;
const SMALLEST_SHARE = 0.45;
/** Just above the floor, with a polygon offset too, under the floor's markings' lift. */
const LIFT_METRES = 0.004;
/** The disc's darkest, at its centre. */
const DARKEST = 0.62;

/** The blob's texture: black, its alpha a soft disc that falls to nothing at the edge. */
export function blobTexture(size = 64): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) * 2);
      data[(y * size + x) * 4 + 3] = Math.round(255 * DARKEST * Math.pow(1 - r * r, 1.5));
    }
  }
  const t = new DataTexture(data, size, size);
  t.name = 'blob shadow';
  t.colorSpace = SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** A shadow's width at a body's height over the floor: smaller as it rises, to SMALLEST_SHARE. */
export function shadowSize(across: number, height: number): number {
  return across * Math.max(SMALLEST_SHARE, 1 - Math.max(0, height) / FADE_HEIGHT_METRES);
}

/** One instanced quad per terrier and one for the ball, on the floor. */
export class Shadows {
  readonly mesh: InstancedMesh;
  readonly capacity: number;
  private readonly texture = blobTexture();
  private readonly m = new Matrix4();

  /** capacity: terriers; the ball takes one more. */
  constructor(capacity: number) {
    this.capacity = capacity;
    const material = new MeshBasicMaterial({
      map: this.texture, color: 0x000000, transparent: true, depthWrite: false, side: FrontSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, capacity + 1);
    this.mesh.name = 'blob shadows';
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 1;
  }

  /** Each drawn terrier's shadow, up to the capacity, then the ball's. */
  draw(m: Readonly<DrawnMatch>): void {
    const P = defaultParams;
    let i = 0;
    const put = (x: number, y: number, across: number, height: number): void => {
      const k = shadowSize(across, height);
      this.m.makeScale(k, k, 1).setPosition(x, y, LIFT_METRES);
      this.mesh.setMatrixAt(i++, this.m);
    };
    const terriers = m.terriers;
    for (let k = 0; k < terriers.length && k < this.capacity; k++) {
      const t = terriers[k]!;
      put(t.x, t.y, TERRIER_SHADOW_RADII * P.terrierRadius, t.z - P.terrierRadius);
    }
    put(m.ball.x, m.ball.y, BALL_SHADOW_RADII * P.ballRadius, m.ball.z - P.ballRadius);
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** No shadow drawn: the empty pitch. */
  clear(): void {
    this.mesh.count = 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.texture.dispose();
    this.mesh.removeFromParent();
  }
}
