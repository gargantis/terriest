// The ball as drawn (PLAN §12, D-9, L59, L101; M4's design,
// research/m4/DESIGN.md, §1.7, §2.4, §2.6): glossy rubber in the look's
// colour, with two bands in its band colour so its roll shows. It squashes
// along its last hit's velocity change, the state's lastHitDv (A.1, D-9's
// M2 note), harder the harder it was hit, and wobbles back, by the hit's
// strength and its age at the drawn time; and it turns as if rolling from
// its drawn motion, by the drawing clock's dtMs, which is drawing's alone
// (C-29) and stands still while Practice is paused.
//
// A port of the M0 spike's research/spike/src/scene/ball.ts (squashAmount,
// squashMatrix, the bands and the roll), with M4's changes: the squash's
// axis is the state's, not the spike's velocity difference across frames,
// which a rollback or a frame skip got wrong; the radius is
// defaultParams.ballRadius, never a copy; the colours are the look's; the
// sphere's segments are the quality's; and its material is made in the
// occluders' two variants (src/render/fade.ts), the mesh drawing the
// dithered one only in a frame the ball crosses the fade's capsule, with a
// second object holding it for prepare()'s compile.

import { BufferAttribute, Color, Group, Matrix4, Mesh, MeshPhongMaterial, type Object3D, Quaternion, Sphere, SphereGeometry, Vector3 } from 'three';
import { config } from '../config';
import { NEVER } from '../core/sim/state';
import { secondsSince } from './drawer';
import { crossesFade, type Faded, fadeVariants } from './fade';
import type { DrawnBall } from './frame';
import type { Look } from './look';
import type { QualityDetail } from './quality';

// The squash's look, the spike's: its size per m/s of the hit and its cap,
// its decay and its wobble's period, and when it has settled.
const SQUASH_PER_METRE_PER_SECOND = 0.03;
const SQUASH_MOST = 0.22;
const SQUASH_DECAY_SECONDS = 0.09;
const SQUASH_WOBBLE_SECONDS = 0.18;
const SQUASH_SETTLED_SECONDS = 0.45;
/** The flattest the squash makes it along the hit, as a share of its radius. */
const SQUASH_FLATTEST = 0.05;
/** Each band's half-width, as a share of the radius: the spike's 0.11 m on its 0.8 m ball. */
const BAND_HALF_WIDTH_RADII = 0.1375;
/** The longest frame the roll turns it for, so a frame after a long gap doesn't spin it. */
const ROLL_STEP_MOST_MS = 100;
/** A hit's velocity change shorter than this has no direction: the squash goes along z. */
const AXIS_MIN = 1e-6;

/** The squash at `ageSeconds` after a hit of `strength` m/s: 0 is none, positive flatter along the hit.
 *  Harder for harder hits up to a cap, decaying with a wobble, and settled within 0.45 s. */
export function squashAmount(strength: number, ageSeconds: number): number {
  if (!(ageSeconds >= 0) || ageSeconds > SQUASH_SETTLED_SECONDS || !(strength > 0)) return 0;
  const a = Math.min(SQUASH_MOST, SQUASH_PER_METRE_PER_SECOND * strength);
  return a * Math.exp(-ageSeconds / SQUASH_DECAY_SECONDS) * Math.cos((2 * Math.PI * ageSeconds) / SQUASH_WOBBLE_SECONDS);
}

/** A matrix that squashes by `amount` along the unit `axis` and keeps the volume: (1 − amount) along it,
 *  1 / √(1 − amount) across it. */
export function squashMatrix(out: Matrix4, axis: Vector3, amount: number): Matrix4 {
  const along = 1 - amount;
  const across = 1 / Math.sqrt(Math.max(along, SQUASH_FLATTEST));
  // across · I + (along − across) · n nᵀ
  const d = along - across;
  const n = axis;
  return out.set(
    across + d * n.x * n.x, d * n.x * n.y, d * n.x * n.z, 0,
    d * n.y * n.x, across + d * n.y * n.y, d * n.y * n.z, 0,
    d * n.z * n.x, d * n.z * n.y, across + d * n.z * n.z, 0,
    0, 0, 0, 1,
  );
}

export class BallMesh {
  readonly object: Object3D = new Group();
  /** The ball itself. */
  readonly mesh: Mesh;
  /** One object for its material's other variant, hidden but for prepare()'s compile (§2.1). */
  readonly variants: readonly Object3D[];
  private readonly faded: Faded<MeshPhongMaterial>;
  private readonly radius: number;
  private readonly spin = new Quaternion();
  private readonly turn = new Quaternion();
  private readonly rollAxis = new Vector3();
  private readonly hitAxis = new Vector3();
  private readonly m = new Matrix4();
  private readonly s = new Matrix4();
  private readonly bounds = new Sphere();

  constructor(look: Look, detail: QualityDetail, radius: number) {
    this.radius = radius;
    const g = new SphereGeometry(radius, detail.ballWidthSegments, detail.ballHeightSegments);
    const position = g.getAttribute('position');
    const colours = new Float32Array(position.count * 3);
    const body = new Color(look.ball.colour);
    const band = new Color(look.ball.band);
    const half = BAND_HALF_WIDTH_RADII * radius;
    for (let i = 0; i < position.count; i++) {
      const banded = Math.abs(position.getY(i)) < half || Math.abs(position.getX(i)) < half;
      (banded ? band : body).toArray(colours, i * 3);
    }
    g.setAttribute('color', new BufferAttribute(colours, 3));
    this.faded = fadeVariants(new MeshPhongMaterial({ vertexColors: true, shininess: 90, specular: 0x5a5a5a }));
    this.mesh = new Mesh(g, this.faded.opaque);
    this.mesh.name = 'ball';
    this.mesh.matrixAutoUpdate = false;
    const variant = new Mesh(g, this.faded.dithered);
    variant.name = 'ball, dithered';
    variant.visible = false;
    this.variants = [variant];
    this.object.name = 'ball';
    this.object.add(this.mesh, variant);
  }

  /** The drawn ball: squashed by its last hit's strength along its velocity change (A.1, D-9), and turned
   *  as if rolling from its drawn motion, by dtMs (drawing only, C-29). `time` is the drawn time, ticks. */
  draw(b: Readonly<DrawnBall>, time: number, dtMs: number): void {
    const speed = Math.hypot(b.vx, b.vy);
    if (speed > 1e-4 && dtMs > 0) {
      // About the horizontal axis across the motion, by the distance over the radius.
      this.rollAxis.set(-b.vy / speed, b.vx / speed, 0);
      this.turn.setFromAxisAngle(this.rollAxis, (speed * Math.min(dtMs, ROLL_STEP_MOST_MS)) / 1000 / this.radius);
      this.spin.premultiply(this.turn).normalize();
    }
    let amount = 0;
    if (b.lastHitTick !== NEVER) {
      amount = squashAmount(b.lastHitStrength, secondsSince(time, b.lastHitTick, config.ticksPerSecond));
      const [dx, dy, dz] = b.lastHitDv;
      const length = Math.hypot(dx, dy, dz);
      if (length > AXIS_MIN) this.hitAxis.set(dx / length, dy / length, dz / length);
      else this.hitAxis.set(0, 0, 1);
    }
    this.m.makeTranslation(b.x, b.y, b.z);
    if (amount !== 0) this.m.multiply(squashMatrix(this.s, this.hitAxis, amount));
    this.m.multiply(this.s.makeRotationFromQuaternion(this.spin));
    this.mesh.matrix.copy(this.m);
    this.mesh.matrixWorldNeedsUpdate = true;
    this.bounds.center.set(b.x, b.y, b.z);
    this.bounds.radius = this.radius;
    this.mesh.material = crossesFade(this.bounds) ? this.faded.dithered : this.faded.opaque;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.faded.opaque.dispose();
    this.faded.dithered.dispose();
    this.object.removeFromParent();
  }
}
