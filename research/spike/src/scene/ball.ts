// The ball and the blob shadows (PLAN §12). The ball is glossy rubber, with
// two white bands so its drawn roll shows; it squashes along its last hit
// and wobbles back, by the hit's strength and age from the view (D-9), and
// turns as if rolling from its drawn motion, which is drawing only (§2).

import {
  BufferAttribute, Color, DataTexture, DoubleSide, Group, InstancedMesh, LinearFilter, LinearMipmapLinearFilter, Matrix4,
  Mesh, MeshBasicMaterial, MeshPhongMaterial, PlaneGeometry, Quaternion, SphereGeometry, SRGBColorSpace, Vector3,
} from 'three';
import { TICK_RATE } from '../contract';
import type { BallPose, DrawFrame } from './interpolate';

export const BALL_R = 0.8;

/** The squash at `age` seconds after a hit of `strength` m/s: 0 is none. */
export function squashAmount(strength: number, age: number): number {
  if (!(age >= 0) || age > 0.45 || !(strength > 0)) return 0;
  const a = Math.min(0.22, 0.03 * strength);
  return a * Math.exp(-age / 0.09) * Math.cos((2 * Math.PI * age) / 0.18);
}

/** A matrix that squashes by `s` along unit `n` and keeps the volume. */
export function squashMatrix(out: Matrix4, n: Vector3, s: number): Matrix4 {
  const along = 1 - s;
  const across = 1 / Math.sqrt(Math.max(along, 0.05));
  // across * I + (along - across) * n n^T
  const d = along - across;
  return out.set(
    across + d * n.x * n.x, d * n.x * n.y, d * n.x * n.z, 0,
    d * n.y * n.x, across + d * n.y * n.y, d * n.y * n.z, 0,
    d * n.z * n.x, d * n.z * n.y, across + d * n.z * n.z, 0,
    0, 0, 0, 1,
  );
}

export class Ball {
  readonly object = new Group();
  readonly mesh: Mesh;
  private readonly spin = new Quaternion();
  private readonly axis = new Vector3();
  private readonly hitAxis = new Vector3(0, 0, 1);
  private hitTick = -1;
  private readonly lastVel = new Vector3();
  private readonly m = new Matrix4();
  private readonly s = new Matrix4();
  private readonly q = new Quaternion();

  constructor(widthSegments: number, heightSegments: number) {
    const g = new SphereGeometry(BALL_R, widthSegments, heightSegments);
    const pos = g.getAttribute('position');
    const colours = new Float32Array(pos.count * 3);
    const red = new Color(0xe0412f);
    const white = new Color(0xf7f3ea);
    for (let i = 0; i < pos.count; i++) {
      const band = Math.abs(pos.getY(i)) < 0.11 || Math.abs(pos.getX(i)) < 0.11;
      (band ? white : red).toArray(colours, i * 3);
    }
    g.setAttribute('color', new BufferAttribute(colours, 3));
    this.mesh = new Mesh(g, new MeshPhongMaterial({ vertexColors: true, shininess: 90, specular: 0x5a5a5a }));
    this.mesh.name = 'ball';
    this.mesh.matrixAutoUpdate = false;
    this.object.add(this.mesh);
  }

  /** dt is the frame's real time in seconds, for the roll only. */
  draw(frame: DrawFrame, dt: number): void {
    const b: BallPose = frame.ball;
    // Roll: about the horizontal axis across the motion, by distance / radius.
    const speed = Math.hypot(b.vx, b.vy);
    if (speed > 1e-4 && dt > 0) {
      this.axis.set(-b.vy / speed, b.vx / speed, 0);
      this.q.setFromAxisAngle(this.axis, (speed * Math.min(dt, 0.1)) / BALL_R);
      this.spin.premultiply(this.q).normalize();
    }
    // The hit's axis: the velocity's change across it, or vertical.
    if (b.lastHitTick !== this.hitTick) {
      this.hitTick = b.lastHitTick;
      const dv = new Vector3(b.vx, b.vy, b.vz).sub(this.lastVel);
      if (dv.lengthSq() > 0.09) this.hitAxis.copy(dv.normalize());
      else this.hitAxis.set(0, 0, 1);
    }
    this.lastVel.set(b.vx, b.vy, b.vz);
    const age = (frame.time - b.lastHitTick) / TICK_RATE;
    const amount = b.lastHitTick >= 0 ? squashAmount(b.lastHitStrength, age) : 0;
    this.m.makeTranslation(b.x, b.y, b.z);
    if (amount !== 0) this.m.multiply(squashMatrix(this.s, this.hitAxis, amount));
    this.m.multiply(this.s.makeRotationFromQuaternion(this.spin));
    this.mesh.matrix.copy(this.m);
    this.mesh.matrixWorldNeedsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshPhongMaterial).dispose();
    this.object.removeFromParent();
  }
}

/** The blob shadow's texture: black, its alpha a soft disc. */
export function blobTexture(size = 64): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) * 2);
      data[(y * size + x) * 4 + 3] = Math.round(255 * 0.62 * Math.pow(1 - r * r, 1.5));
    }
  }
  const t = new DataTexture(data, size, size);
  t.name = 'blob-shadow';
  t.colorSpace = SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** One instanced quad per terrier and one for the ball, on the floor. */
export class Shadows {
  readonly mesh: InstancedMesh;
  readonly texture = blobTexture();
  private readonly m = new Matrix4();
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    const mat = new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), mat, capacity + 1);
    this.mesh.name = 'blob-shadows';
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 1;
  }

  draw(frame: DrawFrame): void {
    let i = 0;
    const put = (x: number, y: number, size: number, height: number): void => {
      // Smaller and so fainter-looking as the body rises.
      const k = size * Math.max(0.45, 1 - height / 5);
      this.m.makeScale(k, k, 1).setPosition(x, y, 0.004);
      this.mesh.setMatrixAt(i++, this.m);
    };
    for (const t of frame.terriers.slice(0, this.capacity)) put(t.x, t.y, 0.62, t.z - 0.25);
    put(frame.ball.x, frame.ball.y, 1.7, frame.ball.z - BALL_R);
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.texture.dispose();
    this.mesh.removeFromParent();
  }
}
