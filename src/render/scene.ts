// The page's drawing (PLAN §12, D-26): three's WebGL 2 renderer, at the
// render quality's pixel-ratio cap and MSAA (D-33), drawing the empty
// pitch from the spectators' camera (D-28) on every animation frame, so
// the frame rate can be measured. The canvas fills the window at any size
// (D-30); each frame checks its size and pixel ratio, so a resize or a
// zoom redraws at the new size. Before the first frame every program is
// compiled and every buffer and texture uploaded: nothing compiles in play
// (§12).

import { AmbientLight, Color, DirectionalLight, HemisphereLight, Scene, WebGLRenderer, type Object3D } from 'three';
import type { RenderQuality } from '../config';
import { pitch } from '../core/sim/pitch';
import { fitSpectator, spectatorCamera } from './camera';
import { SKY } from './palette';
import { drawPitch } from './pitch';
import { qualityDetail } from './quality';

/** The renderer's figures, for the end-to-end tests (window.terriestTest). */
export interface RenderInfo {
  /** Frames drawn since the first. */
  frames: number;
  quality: RenderQuality;
  pixelRatio: number;
  /** The drawing buffer's MSAA samples: 0 without MSAA. */
  samples: number;
  /** The drawing buffer, in pixels. */
  width: number;
  height: number;
  /** The last frame's. */
  calls: number;
  triangles: number;
  lines: number;
  /** Compiled programs, and the geometries and textures uploaded. */
  programs: number;
  geometries: number;
  textures: number;
}

export interface PitchView {
  /** Compiles, uploads and draws the first frame, then draws on every animation frame. */
  start(): Promise<void>;
  info(): RenderInfo;
}

/** The empty pitch on `canvas`, or null if the browser offers no WebGL 2
 *  (D-30). The canvas must be in the page before start(). */
export function createPitchView(canvas: HTMLCanvasElement, quality: RenderQuality): PitchView | null {
  const detail = qualityDetail(quality);
  const gl = canvas.getContext('webgl2', {
    antialias: detail.msaa, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance',
  });
  if (!gl) return null;
  const samples = Number(gl.getParameter(gl.SAMPLES));
  const renderer = new WebGLRenderer({ canvas, context: gl });

  const scene = new Scene();
  scene.background = new Color(SKY);
  const sky = new HemisphereLight(0xffffff, 0x5f7f4f, 1.6);
  sky.position.set(0, 0, 1);
  const sun = new DirectionalLight(0xfff3dd, 2.2);
  sun.position.set(-10, -6, 22);
  scene.add(sky, new AmbientLight(0xffffff, 0.25), sun);
  const anisotropy = Math.min(detail.anisotropyMax, renderer.capabilities.getMaxAnisotropy());
  scene.add(drawPitch(pitch, { ...detail, anisotropy }).object);
  const camera = spectatorCamera();

  let width = 0;
  let height = 0;
  let ratio = 0;
  let frames = 0;
  const fit = (): void => {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    const r = Math.min(devicePixelRatio, detail.pixelRatioMax);
    if (w === width && h === height && r === ratio) return;
    width = w;
    height = h;
    ratio = r;
    renderer.setPixelRatio(r);
    renderer.setSize(w, h, false);
    fitSpectator(camera, w / h, pitch);
  };
  const frame = (): void => {
    fit();
    renderer.render(scene, camera);
    frames += 1;
  };

  return {
    async start() {
      fit();
      await renderer.compileAsync(scene, camera);
      // The first frame, drawn with culling off, uploads every buffer and
      // texture now rather than when it first comes into view (§12, M0).
      const culled: Object3D[] = [];
      scene.traverse((o) => {
        if (o.frustumCulled) culled.push(o);
        o.frustumCulled = false;
      });
      frame();
      for (const o of culled) o.frustumCulled = true;
      const loop = (): void => {
        frame();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },
    info: () => ({
      frames,
      quality,
      pixelRatio: renderer.getPixelRatio(),
      samples,
      width: canvas.width,
      height: canvas.height,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      lines: renderer.info.render.lines,
      programs: renderer.info.programs?.length ?? 0,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
    }),
  };
}
