// The drawers' geometry and counts, in Node (three's maths and geometry need
// no WebGL): D-27's fit, L310's box, §12's starting guesses, D-27's
// painting, and the model drawer's change of axes.
import { Matrix4, Vector3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { squashAmount, squashMatrix } from './ball';
import { CodeDrawer, terrierGeometries, triangleCount } from './code-drawer';
import { TERRIER_LAYER } from './drawer';
import type { DrawFrame, TerrierPose } from './interpolate';
import { BASIS } from './model-drawer';
import { COLLIDER_R, PUSH_TICKS, newPartMatrices, poseParams, poseParts, type PartMatrices } from './terrier-pose';

const BALL_R = 0.8;

function pose(over: Partial<TerrierPose> = {}): TerrierPose {
  return {
    pack: 0, spot: 0, coat: 0, x: 0, y: 0, z: COLLIDER_R, vx: 0, vy: 0, vz: 0, heading: 0,
    phase: 'standing', phaseStartTick: 0, gait: 0, lastBallContactTick: -1, ...over,
  };
}

/** Every vertex of every part, in the terrier's own frame, for a pose at time 100. */
function vertices(p: TerrierPose, t = 0.5): Vector3[] {
  const g = terrierGeometries();
  const m: PartMatrices = newPartMatrices();
  poseParts(new Matrix4(), poseParams(p, t, 100), m);
  const parts: [BufferGeometry, Matrix4[]][] = [
    [g.body, [m.body]], [g.head, [m.head]], [g.snout, [m.head]], [g.face, [m.head]],
    [g.ear, m.ears], [g.leg, m.legs], [g.tail, [m.tail]], [g.bandanaPlain, [m.bandana]],
  ];
  const out: Vector3[] = [];
  for (const [geom, mats] of parts) {
    const pos = geom.getAttribute('position');
    for (const mat of mats) for (let i = 0; i < pos.count; i++) out.push(new Vector3().fromBufferAttribute(pos, i).applyMatrix4(mat));
  }
  return out;
}

describe('the code-built terrier (PLAN D-27)', () => {
  it("fits L310's 0.6 x 0.5 x 0.5 m box around its collider while standing", () => {
    const v = vertices(pose());
    const max = (f: (p: Vector3) => number): number => Math.max(...v.map(f));
    const min = (f: (p: Vector3) => number): number => Math.min(...v.map(f));
    expect(max((p) => p.x)).toBeLessThanOrEqual(0.305);
    expect(min((p) => p.x)).toBeGreaterThanOrEqual(-0.3);
    expect(max((p) => Math.abs(p.y))).toBeLessThanOrEqual(0.25);
    expect(max((p) => p.z)).toBeLessThanOrEqual(0.5);
    expect(min((p) => p.z)).toBeGreaterThanOrEqual(-0.001);
  });

  // D-4: a standing terrier touching a ball on the floor meets it 31.6
  // degrees above horizontal; higher contacts, up to a ball on top of it.
  for (const deg of [31.6, 45, 60, 75, 90]) {
    it(`keeps out of a touching ball at ${deg} degrees while pushing (D-27's fit)`, () => {
      const a = (deg * Math.PI) / 180;
      const ball = new Vector3((COLLIDER_R + BALL_R) * Math.cos(a), 0, COLLIDER_R + (COLLIDER_R + BALL_R) * Math.sin(a));
      for (const phase of ['standing', 'running', 'zooming', 'lunging', 'airborne'] as const) {
        const v = vertices(pose({ phase, vx: 6, vz: phase === 'airborne' ? -4 : 0, lastBallContactTick: 100 - PUSH_TICKS / 2, gait: 0.3 }));
        const nearest = Math.min(...v.map((p) => p.distanceTo(ball)));
        expect(nearest, `${phase}: the nearest vertex is ${(BALL_R - nearest).toFixed(3)} m inside`).toBeGreaterThanOrEqual(BALL_R - 0.005);
      }
    });
  }

  it('would put its head in the ball without the pushing pose, which is why it has one', () => {
    const a = (31.6 * Math.PI) / 180;
    const ball = new Vector3((COLLIDER_R + BALL_R) * Math.cos(a), 0, COLLIDER_R + (COLLIDER_R + BALL_R) * Math.sin(a));
    const nearest = Math.min(...vertices(pose()).map((p) => p.distanceTo(ball)));
    expect(nearest).toBeLessThan(BALL_R - 0.02);
  });

  it("stays inside §12's starting guesses: 2,000 triangles a terrier, 40 draw calls for 8", () => {
    const d = new CodeDrawer(8);
    const terriers = Array.from({ length: 8 }, (_, i) => pose({ pack: (i & 1) as 0 | 1, spot: i >> 1, coat: i, x: i }));
    const frame: DrawFrame = { time: 10, tick: 10, fraction: 0, terriers, ball: { x: 0, y: 0, z: 0.8, vx: 0, vy: 0, vz: 0, lastHitTick: -1, lastHitStrength: 0 } };
    d.draw(frame);
    const c = d.counts();
    expect(c.trianglesPerTerrier).toBeLessThanOrEqual(2000);
    expect(c.triangles).toBe(8 * c.trianglesPerTerrier);
    expect(c.drawCalls).toBe(9);
    expect(c.coatsPainted).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(c.packsPainted).toEqual([0, 1]);
    // Every part is on the terrier layer, for the counting pass.
    d.object.traverse((o) => {
      if (o !== d.object) expect(o.layers.isEnabled(TERRIER_LAYER)).toBe(true);
    });
    const g = terrierGeometries();
    expect(triangleCount(g.bandanaStriped)).toBe(triangleCount(g.bandanaPlain));
    d.dispose();
  });
});

describe('the ball (PLAN §12)', () => {
  it('squashes along the hit and keeps its volume', () => {
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

describe('the model drawer (PLAN D-27)', () => {
  it("turns glTF's axes into the scene's: forward to +x, up to +z, left to +y", () => {
    const v = (x: number, y: number, z: number): number[] => new Vector3(x, y, z).applyQuaternion(BASIS).toArray().map((c) => Math.round(c * 1e9) / 1e9 + 0);
    expect(v(0, 0, 1)).toEqual([1, 0, 0]);
    expect(v(0, 1, 0)).toEqual([0, 0, 1]);
    expect(v(1, 0, 0)).toEqual([0, 1, 0]);
  });
});
