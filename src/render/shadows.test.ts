import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { defaultParams } from '../core/sim/params';
import { newDrawnMatch } from './interpolate';
import { blobTexture, shadowSize, Shadows } from './shadows';
import type { DrawnMatch } from './frame';

// The blob shadows (PLAN §12; M4's design §1.8): one instanced quad on the
// floor under each terrier and one under the ball, the spike's sizes from
// defaultParams' radii, smaller and so fainter as a body rises, none past
// the capacity, and a soft black disc for a texture.

const P = defaultParams;

/** A drawn match with terriers at the given (x, y, z), and the ball at (bx, by, bz). */
function match(terriers: [number, number, number][], ball: [number, number, number] = [0, 0, P.ballRadius]): DrawnMatch {
  const m = newDrawnMatch();
  m.terriers = terriers.map(([x, y, z], k) => ({ ...placeholder(), id: `t${k}`, x, y, z }));
  [m.ball.x, m.ball.y, m.ball.z] = ball;
  return m;
}

function placeholder(): DrawnMatch['terriers'][number] {
  return {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, id: '', name: '', pack: 0, spot: 0, coat: 0, heading: 0, headingChange: 0,
    anim: 0, animStart: 0, gait: 0, takeOffTick: 0, landingTick: 0, lastBallContactTick: 0, lastTerrierContactTick: 0,
    lastPushDir: 0, lastPushTick: 0, sitting: false, ballOverhead: false, overheadRef: 0, meter: 1, pounceWait: 0, lunge: 0, tumble: 0, guard: 0,
  };
}

/** Instance i's centre and width, as its matrix's 32-bit floats hold them. */
function at(s: Shadows, i: number): { x: number; y: number; z: number; size: number } {
  const m = new Matrix4();
  s.mesh.getMatrixAt(i, m);
  const p = new Vector3().setFromMatrixPosition(m);
  return { x: p.x, y: p.y, z: p.z, size: new Vector3().setFromMatrixColumn(m, 0).length() };
}

describe('the blob shadows (PLAN §12)', () => {
  it("puts one under each terrier and one under the ball, the spike's 0.62 m and 1.7 m on the floor", () => {
    const s = new Shadows(8);
    s.draw(match([[1, 2, P.terrierRadius], [-3, 4, P.terrierRadius]], [5, -6, P.ballRadius]));
    expect(s.mesh.count).toBe(3);
    const [a, b, ball] = [at(s, 0), at(s, 1), at(s, 2)];
    expect([a.x, a.y, b.x, b.y, ball.x, ball.y]).toEqual([1, 2, -3, 4, 5, -6]);
    expect(a.size).toBeCloseTo(0.62, 6);
    expect(ball.size).toBeCloseTo(1.7, 6);
    // On the floor, just above it.
    for (const q of [a, b, ball]) expect(q.z > 0 && q.z < 0.01).toBe(true);
  });

  it('shrinks a shadow as its body rises, to a floor, from the height of its lowest point', () => {
    expect(shadowSize(1, 0)).toBe(1);
    expect(shadowSize(1, 2.5)).toBe(0.5);
    expect(shadowSize(1, 10)).toBe(0.45);
    expect(shadowSize(1, -0.2)).toBe(1);
    const s = new Shadows(8);
    s.draw(match([[0, 0, P.terrierRadius + 1]], [0, 0, P.ballRadius + 2.5]));
    expect(at(s, 0).size).toBeCloseTo(0.62 * 0.8, 6);
    expect(at(s, 1).size).toBeCloseTo(1.7 * 0.5, 6);
  });

  it('draws none past its capacity but the ball\'s, and none at all once cleared', () => {
    const s = new Shadows(2);
    expect(s.mesh.instanceMatrix.count).toBe(3);
    s.draw(match([[0, 0, P.terrierRadius], [1, 0, P.terrierRadius], [2, 0, P.terrierRadius]], [7, 0, P.ballRadius]));
    expect(s.mesh.count).toBe(3);
    expect(at(s, 2).x).toBe(7);
    s.clear();
    expect(s.mesh.count).toBe(0);
    expect(s.mesh.frustumCulled).toBe(false);
  });

  it('is a soft black disc, darkest at its centre and gone at its edge', () => {
    const t = blobTexture(32);
    const data = t.image.data as Uint8Array;
    const alpha = (x: number, y: number): number => data[(y * 32 + x) * 4 + 3]!;
    expect(alpha(16, 16)).toBeGreaterThan(150);
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(16, 0)).toBeLessThan(alpha(16, 8));
    for (let i = 0; i < data.length; i += 4) expect(data[i]! + data[i + 1]! + data[i + 2]!).toBe(0);
  });
});
