// One simple camera, as the spike needs (PLAN D-28's ball view, simplified):
// behind terrier 0 on the line from it to the ball, aimed at the ball. Its
// yaw follows that line at up to 1 turn a second, with no lag below the cap,
// and holds while the ball is nearly overhead. It stays inside the pitch and
// under the net (L89).

import { PerspectiveCamera, Vector3 } from 'three';
import type { DrawFrame } from './interpolate';
import { PITCH } from './pitch';

const BACK = 4.2;
const UP = 2.1;
const CAP = 2 * Math.PI; // radians a second: 1 turn/s
const MARGIN = 0.4;

/** The signed angle from a to b, in (-π, π]. */
export function angleBetween(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Moves a point inside the walls, the cut corners and under the net. */
export function insidePitch(p: Vector3): Vector3 {
  const L = PITCH.halfLength - MARGIN;
  const W = PITCH.halfWidth - MARGIN;
  p.x = Math.max(-L, Math.min(L, p.x));
  p.y = Math.max(-W, Math.min(W, p.y));
  const reach = PITCH.halfLength + PITCH.halfWidth - PITCH.cut - MARGIN * Math.SQRT2;
  const over = Math.abs(p.x) + Math.abs(p.y) - reach;
  if (over > 0) {
    p.x -= Math.sign(p.x) * over / 2;
    p.y -= Math.sign(p.y) * over / 2;
  }
  p.z = Math.max(0.4, Math.min(PITCH.height - MARGIN, p.z));
  return p;
}

export class BallCamera {
  readonly camera: PerspectiveCamera;
  private yaw: number | null = null;
  private readonly at = new Vector3();
  private readonly target = new Vector3();

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(55, aspect, 0.05, 120);
    this.camera.up.set(0, 0, 1);
  }

  /** Follows terrier `index`; dt is the frame's real time in seconds. */
  update(frame: DrawFrame, index: number, dt: number): void {
    const me = frame.terriers[index];
    const b = frame.ball;
    if (!me) {
      this.camera.position.set(-18, -12, 5);
      this.camera.lookAt(b.x, b.y, b.z);
      return;
    }
    const dx = b.x - me.x;
    const dy = b.y - me.y;
    // Overhead (D-7's 0.3 m): the line has no direction, so the yaw holds.
    const line = Math.hypot(dx, dy) > 0.3 ? Math.atan2(dy, dx) : null;
    if (this.yaw === null) this.yaw = line ?? me.heading;
    else if (line !== null) {
      const d = angleBetween(this.yaw, line);
      const most = CAP * Math.min(dt, 0.1);
      this.yaw += Math.max(-most, Math.min(most, d));
    }
    const floorZ = me.z - 0.25;
    this.at.set(me.x - BACK * Math.cos(this.yaw), me.y - BACK * Math.sin(this.yaw), floorZ + UP);
    insidePitch(this.at);
    this.camera.position.copy(this.at);
    this.target.set(b.x, b.y, b.z);
    this.camera.lookAt(this.target);
  }

  /** D-28's spectator view, simplified: high above one side, outside the walls, on the ball. */
  spectate(frame: DrawFrame): void {
    const b = frame.ball;
    this.camera.position.set(b.x * 0.5, -PITCH.halfWidth - 9, 15);
    this.camera.lookAt(b.x * 0.8, b.y * 0.5, 0);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
