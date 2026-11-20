import { Color, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { defaultParams } from '../core/sim/params';
import { NEVER } from '../core/sim/state';
import { BallMesh, squashAmount, squashMatrix } from './ball';
import type { DrawnBall } from './frame';
import { PLACEHOLDER_LOOK } from './look';
import { qualityDetail } from './quality';

// The ball as drawn (PLAN §12, D-9, C-29; M4's design §1.7): the M0 spike's
// squash, its volume, its cap and its settling; its axis the state's hit
// change, not its velocity; its roll from its drawn motion by the drawing
// clock, which stands still while paused; its look's colours and the
// quality's segments; and its material's other variant for prepare().

const R = defaultParams.ballRadius;
const rate = config.ticksPerSecond;

function ball(over: Partial<DrawnBall> = {}): DrawnBall {
  return {
    x: 1, y: 2, z: R, vx: 0, vy: 0, vz: 0, onFloor: true,
    lastHitTick: NEVER, lastHitStrength: 0, lastHitDv: [0, 0, 0], lastContactTick: NEVER, ...over,
  };
}

/** The mesh's matrix without its translation: the squash and the roll. */
function shape(b: BallMesh): Matrix4 {
  const m = b.mesh.matrix.clone();
  m.setPosition(0, 0, 0);
  return m;
}

describe('the squash (the spike\'s)', () => {
  it('squashes along its axis and keeps its volume', () => {
    const n = new Vector3(1, 2, 2).normalize();
    const m = squashMatrix(new Matrix4(), n, 0.2);
    expect(m.determinant()).toBeCloseTo(1, 12);
    expect(n.clone().applyMatrix4(m).length()).toBeCloseTo(0.8, 12);
    const across = new Vector3(2, -1, 0).normalize();
    expect(across.clone().applyMatrix4(m).length()).toBeCloseTo(1 / Math.sqrt(0.8), 12);
  });

  it('squashes harder for harder hits, up to a cap, and settles within 0.45 s', () => {
    expect(squashAmount(2, 0)).toBeCloseTo(0.06, 12);
    expect(squashAmount(5, 0)).toBeGreaterThan(squashAmount(2, 0));
    expect(squashAmount(50, 0)).toBe(0.22);
    expect(squashAmount(5, 0.46)).toBe(0);
    expect(squashAmount(5, -0.01)).toBe(0);
    expect(squashAmount(0, 0)).toBe(0);
    expect(Math.abs(squashAmount(5, 0.3))).toBeLessThan(0.01);
  });
});

describe('the drawn ball (D-9, C-29)', () => {
  const detail = qualityDetail('high');

  it("squashes along the state's hit change, not its velocity, by the hit's strength and age", () => {
    const b = new BallMesh(PLACEHOLDER_LOOK, detail, R);
    const hit = ball({ vx: 0, vy: 5, vz: 0, lastHitTick: 100, lastHitStrength: 4, lastHitDv: [3, 0, 4] });
    b.draw(hit, 100, 0);
    const s = squashAmount(4, 0);
    expect(s).toBeGreaterThan(0.1);
    const m = shape(b);
    const axis = new Vector3(0.6, 0, 0.8);
    expect(axis.clone().applyMatrix4(m).distanceTo(axis.clone().multiplyScalar(1 - s))).toBeLessThan(1e-12);
    // Across the hit, the velocity's own direction among it, it bulges to keep the volume.
    const across = new Vector3(0, 1, 0);
    expect(across.clone().applyMatrix4(m).length()).toBeCloseTo(1 / Math.sqrt(1 - s), 12);
    expect(m.determinant()).toBeCloseTo(1, 12);
    expect(new Vector3().setFromMatrixPosition(b.mesh.matrix).toArray()).toEqual([1, 2, R]);
    // A tick later it's settling: less.
    b.draw(hit, 106, 0);
    expect(axis.clone().applyMatrix4(shape(b)).length()).toBeGreaterThan(1 - s);
    // Settled by 0.45 s, and never squashed before it was hit or when never hit.
    for (const [b2, time] of [[hit, 100 + 0.46 * rate], [ball(), 100]] as const) {
      b.draw(b2, time, 0);
      expect(shape(b).equals(new Matrix4()), `at ${time}`).toBe(true);
    }
    // A hit with no velocity change squashes along z.
    b.draw(ball({ lastHitTick: 100, lastHitStrength: 4 }), 100, 0);
    expect(new Vector3(0, 0, 1).applyMatrix4(shape(b)).z).toBeCloseTo(1 - s, 12);
  });

  it('rolls from its drawn motion by the frame\'s dtMs, and not at all while paused', () => {
    const b = new BallMesh(PLACEHOLDER_LOOK, detail, R);
    const rolling = ball({ vx: 5 });
    b.draw(rolling, 0, 0);
    expect(shape(b).equals(new Matrix4())).toBe(true);
    b.draw(rolling, 0, 50);
    // About the horizontal axis across the motion, +y for +x, by the distance over the radius.
    const q = new Quaternion().setFromRotationMatrix(shape(b));
    const want = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (5 * 0.05) / R);
    // angleTo's acos near 1 reads to about 1e-8.
    expect(q.angleTo(want)).toBeLessThan(1e-6);
    // A long gap between frames turns it no more than 100 ms would.
    const gap = new BallMesh(PLACEHOLDER_LOOK, detail, R);
    gap.draw(rolling, 0, 5000);
    const most = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (5 * 0.1) / R);
    expect(new Quaternion().setFromRotationMatrix(shape(gap)).angleTo(most)).toBeLessThan(1e-6);
  });

  it("is painted in the look's colours, with the quality's segments, and holds its material's other variant", () => {
    const look = { ...PLACEHOLDER_LOOK, ball: { colour: 0x123456, band: 0xfedcba } };
    const high = new BallMesh(look, qualityDetail('high'), R);
    const low = new BallMesh(look, qualityDetail('low'), R);
    const colours = (b: BallMesh): Set<string> => {
      const c = b.mesh.geometry.getAttribute('color');
      const out = new Set<string>();
      for (let i = 0; i < c.count; i++) out.add(new Color(c.getX(i), c.getY(i), c.getZ(i)).getHexString());
      return out;
    };
    expect([...colours(high)].sort()).toEqual(['123456', 'fedcba']);
    expect(low.mesh.geometry.getAttribute('position').count).toBeLessThan(high.mesh.geometry.getAttribute('position').count);
    high.mesh.geometry.computeBoundingSphere();
    // The radius is defaultParams', to the geometry's 32-bit floats.
    expect(high.mesh.geometry.boundingSphere!.radius).toBeCloseTo(R, 6);
    expect(high.variants).toHaveLength(1);
    const variant = high.variants[0] as Mesh;
    expect(variant.visible).toBe(false);
    expect(variant.geometry).toBe(high.mesh.geometry);
    expect(high.object.children).toContain(variant);
    // Nothing crosses the fade in phase 1: the ball draws its opaque variant.
    high.draw(ball(), 0, 0);
    expect(high.mesh.material).toBe(variant.material);
  });
});
