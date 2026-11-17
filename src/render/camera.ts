// The spectators' camera (PLAN D-28, L91): high above one side of the
// pitch, outside the walls. At M1 it's fixed, on the whole empty pitch;
// from M4 it follows the ball or the chosen terrier. It looks across the
// pitch from the −y side, pack A's goal on the left, down at a fixed
// angle, from the nearest point at which the floor, the walls' tops and
// both goals fit the view at the canvas's aspect, so the pitch shows whole
// at any window size (D-30). Metres, z up (D-4).
//
// That point is always outside the walls and above the net: the angle
// down is steeper than half the field of view, so the view's lower edge
// still points down and ahead, and with the near wall's foot in view the
// camera is behind it; the far wall's top is below the view's upper edge,
// which points down too, so the camera is above the net.

import { PerspectiveCamera, Vector3 } from 'three';
import type { Pitch } from '../core/sim/pitch';

const FOV_DEGREES = 40; // vertical
const ELEVATION_DEGREES = 50; // the view's angle below the horizontal: more than half the field of view
/** The share of the view's half-width and half-height left clear at each edge. */
const EDGE_MARGIN = 0.05;

const UP = new Vector3(0, 0, 1);

export function spectatorCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(FOV_DEGREES, 1, 1, 1000);
  camera.up.copy(UP);
  return camera;
}

/** The points the view must hold: the floor plan at the floor and at the
 *  walls' tops, and each goal's floor and top. */
export function framedPoints(p: Pitch): Vector3[] {
  const height = p.shape.heightMetres;
  const out: Vector3[] = [];
  for (const [x, y] of p.outline) out.push(new Vector3(x, y, 0), new Vector3(x, y, height));
  for (const goal of p.goals) {
    for (const [x, y] of goal.floor) out.push(new Vector3(x, y, 0), new Vector3(x, y, goal.mouthHeight));
  }
  return out;
}

/**
 * Places the camera for an aspect (width / height). With the direction
 * fixed, each point P bounds the camera's position C along the view axis
 * w: |(P − C)·x| ≤ tan(fov_x / 2) (P − C)·w, and the same for y. The
 * nearest C meeting every bound sits midway between the tightest ones on
 * each axis, so the pitch reaches the margin at both edges on one axis.
 */
export function fitSpectator(camera: PerspectiveCamera, aspect: number, p: Pitch): void {
  const el = (ELEVATION_DEGREES * Math.PI) / 180;
  const w = new Vector3(0, Math.cos(el), -Math.sin(el)); // forward
  const x = new Vector3(1, 0, 0); // right
  const y = new Vector3().crossVectors(x, w); // up, in the view
  const ty = Math.tan(((FOV_DEGREES * Math.PI) / 180) / 2) * (1 - EDGE_MARGIN);
  const tx = ty * aspect;
  const points = framedPoints(p);
  const tightest = (axis: Vector3, t: number): { across: number; along: number } => {
    let a = Infinity;
    let b = Infinity;
    for (const q of points) {
      const depth = q.dot(w);
      const side = q.dot(axis) / t;
      a = Math.min(a, depth - side);
      b = Math.min(b, depth + side);
    }
    return { across: (t * (b - a)) / 2, along: (a + b) / 2 };
  };
  const h = tightest(x, tx);
  const v = tightest(y, ty);
  const c = new Vector3()
    .addScaledVector(x, h.across)
    .addScaledVector(y, v.across)
    .addScaledVector(w, Math.min(h.along, v.along));

  let far = 0;
  for (const q of points) far = Math.max(far, new Vector3().subVectors(q, c).dot(w));
  camera.position.copy(c);
  camera.lookAt(new Vector3().addVectors(c, w));
  camera.aspect = aspect;
  camera.near = 1;
  camera.far = far + 50;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}
