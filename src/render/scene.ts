// M1's placeholder drawing (PLAN §17): three's WebGL 2 renderer and one
// frame of an empty scene, so three is bundled and its notice ships. The
// empty pitch replaces it.
import { Color, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

/** Draws one frame on `canvas`, or returns false if the browser offers no WebGL 2 (D-26, D-30). */
export function drawEmptyScene(canvas: HTMLCanvasElement): boolean {
  const gl = canvas.getContext('webgl2', { antialias: false });
  if (!gl) return false;
  const renderer = new WebGLRenderer({ canvas, context: gl });
  renderer.setPixelRatio(1);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  const scene = new Scene();
  scene.background = new Color(0x3f7a3a);
  const camera = new PerspectiveCamera(50, canvas.clientWidth / Math.max(1, canvas.clientHeight), 0.1, 100);
  renderer.render(scene, camera);
  return true;
}
