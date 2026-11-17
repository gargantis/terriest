// The page's entry (PLAN §6). M1's placeholder draws one frame of an empty
// scene and then takes the boot message down; without WebGL 2 the message
// stays (D-30). The boot page and the empty pitch replace it.
import { drawEmptyScene } from './render/scene';

const canvas = document.createElement('canvas');
document.body.append(canvas);
if (drawEmptyScene(canvas)) {
  document.getElementById('fallback')?.remove();
  document.documentElement.dataset.drawn = '1';
} else {
  canvas.remove();
}
