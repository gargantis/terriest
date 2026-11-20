// The page's one WebGL 2 context, made, watched and made again (M4's
// design, research/m4/DESIGN.md, §1.63, §2.1, §2.8; D-30, D-33, M4-Q41):
// the renderer on a canvas at a quality's MSAA, which is fixed when the
// context is made, so a quality change needs a new renderer on a new
// canvas; from phase 3 the context's loss and restore, which the pitch
// screen turns into Practice's pause and the 5 s message, and the rebuild
// that compiles one material an animation frame while the old canvas draws
// on, as three's compileAsync without KHR_parallel_shader_compile blocks on
// the first link's status.
//
// Phase 1's stub, by the stage builder, with the final signatures:
// watchContext reports nothing, and rebuildRenderer re-creates the renderer
// at once, compiling everything in one go. Phase 3's robust builder fills
// it. createRenderer is the stage's and the rebuild's one way to make the
// context, as M1's scene.ts made it.

import { PerspectiveCamera, type Scene, WebGLRenderer } from 'three';
import type { RenderQuality } from '../config';
import { qualityDetail } from './quality';

/** A renderer on its canvas's WebGL 2 context, and the context's MSAA samples. */
export interface MadeRenderer {
  readonly renderer: WebGLRenderer;
  /** The drawing buffer's MSAA samples: 0 without MSAA. */
  readonly samples: number;
}

/** A WebGL 2 renderer on `canvas` at the quality's MSAA (D-33), alpha off, as M1 made it; null if the
 *  browser offers no WebGL 2 (D-30). */
export function createRenderer(canvas: HTMLCanvasElement, quality: RenderQuality): MadeRenderer | null {
  const detail = qualityDetail(quality);
  const gl = canvas.getContext('webgl2', {
    antialias: detail.msaa, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance',
  });
  if (!gl) return null;
  return { renderer: new WebGLRenderer({ canvas, context: gl }), samples: Number(gl.getParameter(gl.SAMPLES)) };
}

/** Calls `on` when the canvas's context is lost and when it's restored; returns its removal. Phase 1:
 *  reports nothing. */
export function watchContext(_canvas: HTMLCanvasElement, _on: (s: 'lost' | 'restored') => void): () => void {
  return () => {};
}

/** The stub's compile camera: compiling reads only its layers, for the lights. */
const COMPILE_CAMERA = new PerspectiveCamera();

/** A new renderer on a new canvas at `quality`, every material of `scene` compiled for it, or null
 *  without WebGL 2. The caller puts the canvas in the old one's place. From phase 3 it compiles one
 *  material each `nextFrame()`, while the old canvas draws on; phase 1's stub compiles them at once. */
export async function rebuildRenderer(o: {
  quality: RenderQuality; old: HTMLCanvasElement; scene: Scene; nextFrame: () => Promise<void>;
}): Promise<{ canvas: HTMLCanvasElement; renderer: WebGLRenderer } | null> {
  const canvas = document.createElement('canvas');
  const made = createRenderer(canvas, o.quality);
  if (made === null) return null;
  await made.renderer.compileAsync(o.scene, COMPILE_CAMERA);
  return { canvas, renderer: made.renderer };
}
