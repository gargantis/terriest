// The drawing's effects (PLAN §12, L101, Q-7, D-16; M4's design,
// research/m4/DESIGN.md, §1.17, §1.63, §2.6): dust behind zooming
// terriers, kicked up from the drawn feet at each step of the gait, a fixed
// pool of puffs made at prepare (fewer at the low quality, D-33), each
// fading over half a second by the drawing clock and left to fade by a
// correction; and a goal's netting bulging round the ball, at once from the
// predicted state, blended out if a correction takes the goal back, which
// src/render/pitch.ts's setBulge draws. The tumble's roll and shake are the
// pose's (src/render/drawers/pose.ts); the squash is the ball's (ball.ts).
//
// Phase 1's stub, by the stage builder, with the final signatures: an empty
// pool that draws nothing, and no bulge. src/render/scene.ts calls draw()
// every frame, the empty pitch's included; prepare()'s compile reaches
// every material in the scene, hidden or not, and its one render that
// uploads shows every object and puts every instanced mesh at its full
// count, so a pool made here is compiled and uploaded before play. Phase
// 3's effects builder fills it.

import { Group, type Object3D, type Scene } from 'three';
import type { Blends } from './blends';
import type { Bulge, DrawnMatch, StageFrame } from './frame';
import type { Look } from './look';
import type { DrawnPitch } from './pitch';
import type { QualityDetail } from './quality';

/** What src/render/scene.ts calls (§1.63's extension point). */
export interface Effects {
  /** The dust pool, made at prepare, in the scene. */
  readonly object: Object3D;
  /** Each frame: the dust from the drawn match; the bulge, found there too, into the pitch's netting. */
  draw(f: StageFrame): void;
  dispose(): void;
}

/** The effects for a stage's scene, their object added to it; phase 1's draws nothing. */
export function createEffects(scene: Scene, _look: Look, detail: QualityDetail, capacity: number, _pitch: DrawnPitch): Effects {
  const dust = new Dust(capacity, detail);
  scene.add(dust.object);
  return {
    object: dust.object,
    draw(_f: StageFrame): void {},
    dispose(): void {
      dust.dispose();
    },
  };
}

/** The dust's pool: detail.dustPuffs puffs for `capacity` terriers. Phase 1: empty. */
export class Dust {
  readonly object: Object3D = new Group();

  constructor(_capacity: number, _detail: QualityDetail) {
    this.object.name = 'dust';
  }

  draw(_m: DrawnMatch, _nowMs: number, _dtMs: number): void {}

  dispose(): void {
    this.object.removeFromParent();
  }
}

/** A goal's netting bulging round the ball, from the drawn match's last goal (Q-7), its weight from the
 *  blends; phase 1: none. */
export function netBulge(_m: DrawnMatch, _blends: Blends, _nowMs: number): Bulge | null {
  return null;
}
