// Where the model drawer comes from (M4's design, research/m4/DESIGN.md,
// §1.6, §1.63, §2.10; D-27, L97, L100): the stage's slot for the drawer a
// model makes. From phase 3 it alone loads src/render/drawers/model.ts, by
// import(), so GLTFLoader and SkeletonUtils never reach the code-built
// path's chunks (§1.55): request(url) loads the model, builds a drawer for
// the capacity and compiles it against the stage's scene, and ready()
// hands it over once, between two frames. Until then, or if anything fails,
// the terriers stay code-built and nothing waits (L100); every failure is
// caught and reported in state and error, never logged as an error or left
// as an unhandled rejection.
//
// Phase 1's stub, by the stage builder, with the final signatures: it never
// loads. src/render/scene.ts asks ready() each frame from phase 1 and swaps
// in the drawer it returns. Phase 3's model builder fills it.

import type { TerrierDrawer } from './drawer';
import type { Look } from './look';
import type { RenderInfo } from './stage-types';

export interface ModelSlot {
  /** Starts loading the model at url; '' asks for none. */
  request(url: string): void;
  /** The model's drawer, compiled, once: the stage swaps it in. Null until then, and after. */
  ready(): TerrierDrawer | null;
  readonly state: RenderInfo['model']['state'];
  /** The load and compile's time, once drawn. */
  readonly ms: number | null;
  /** Why it failed. */
  readonly error: string | null;
}

/** Phase 1: a slot that never loads. */
export function createModelSlot(_o: { look: Look; capacity: number; compile: (d: TerrierDrawer) => Promise<void> }): ModelSlot {
  return {
    request(_url: string): void {},
    ready: () => null,
    state: 'none',
    ms: null,
    error: null,
  };
}
