// The animations' cross-fades, for both drawers (M4's design,
// research/m4/DESIGN.md, §1.15, §2.4; D-27's "Corrections, for both
// drawers", L208): each terrier's current animation and those it has left
// within the blend, fading by the drawing clock, and the bark's and the
// celebration's overlays fading in and out. Every time it reads is the
// drawing clock's (§2.2), which stands still while Practice is paused, so a
// fade stops with play (Q-15).
//
// Phase 1's stub, by the stage builder, with the final signatures: one
// layer of weight 1, and an overlay at weight 1 while it's active, so phase
// 1 draws every bark and celebration (§2.5), switching at once. Phase 3's
// motion builder replaces the bodies. Three-free.

import type { AnimLayer, Overlay } from './drawer';
import type { DrawnTerrier } from './frame';

export class Blends {
  /** blendMs: config.animationBlendMs, which phase 3's fades run over. */
  constructor(_blendMs: number) {}

  /** This frame's layers for a terrier, by ID: its current (anim, animStart), and from phase 3 each one
   *  it has left within the blend, fading out by the drawing clock. Phase 1: the current one alone. */
  layers(t: Readonly<DrawnTerrier>, _nowMs: number): readonly AnimLayer[] {
    return [{ anim: t.anim, start: t.animStart, weight: 1 }];
  }

  /** An overlay's weight: from phase 3, in over the blend from `shownAtMs` and out over it once it ends.
   *  Phase 1: weight 1 while it's active, else none. */
  overlay(_key: string, active: boolean, start: number, _shownAtMs: number, _nowMs: number): Overlay | null {
    return active ? { start, weight: 1 } : null;
  }

  /** A terrier gone from the drawn state. */
  forget(_id: string): void {}

  /** Another timeline, or a snap: every fade dropped. */
  reset(): void {}
}
