import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { buildPitch, pitch, type Pitch } from '../core/sim/pitch';
import { fitSpectator, framedPoints, spectatorCamera } from './camera';

// The spectators' camera (PLAN D-28, L91): at any window shape (D-30), the
// whole empty pitch is in view, tightly and centred, from high above one
// side, outside the walls and above the net, whatever the pitch's shape
// (D-4).
const shapes: [string, Pitch][] = [
  ['the pitch', pitch],
  // D-4's second shape, as src/config.test.ts builds it.
  ['50 × 30 m, cut 6 and 3 m', buildPitch({ ...config.pitch, lengthMetres: 50, widthMetres: 30, cornerCutsMetres: [6, 3, 6, 3], mouthWidthMetres: 10 })],
  ['walls 30 m high', buildPitch({ ...config.pitch, heightMetres: 30 })],
];

describe("the spectators' camera", () => {
  for (const [name, p] of shapes) {
    it.each([0.3, 0.75, 1, 4 / 3, 16 / 9, 2.4, 5])(`frames ${name} at aspect %f`, (aspect) => {
      const camera = spectatorCamera();
      fitSpectator(camera, aspect, p);
      const ndc = framedPoints(p).map((q) => q.project(camera));
      const xs = ndc.map((q) => q.x);
      const ys = ndc.map((q) => q.y);
      // Inside the view, with its 5 % margin, and between the near and far planes.
      for (const q of ndc) {
        expect(Math.abs(q.x)).toBeLessThanOrEqual(0.95 + 1e-9);
        expect(Math.abs(q.y)).toBeLessThanOrEqual(0.95 + 1e-9);
        expect(Math.abs(q.z)).toBeLessThan(1);
      }
      // As near as it can be: on one axis, the pitch reaches the margin at both edges.
      const tight = (vs: number[]): boolean => Math.abs(Math.max(...vs) - 0.95) < 1e-6 && Math.abs(Math.min(...vs) + 0.95) < 1e-6;
      expect(tight(xs) || tight(ys), 'edge to edge on one axis').toBe(true);
      // On the −y side, outside the wall and above the net.
      expect(camera.position.y).toBeLessThan(-p.shape.widthMetres / 2);
      expect(camera.position.z).toBeGreaterThan(p.shape.heightMetres);
    });
  }

  it('looks straight across the middle of a pitch that is symmetric end to end', () => {
    const camera = spectatorCamera();
    fitSpectator(camera, 16 / 9, pitch);
    expect(camera.position.x).toBeCloseTo(0, 9);
    const xs = framedPoints(pitch).map((q) => q.project(camera).x);
    expect(Math.max(...xs) + Math.min(...xs)).toBeCloseTo(0, 9);
  });

  it("holds the floor plan, the walls' tops and both goals", () => {
    // 8 outline corners at the floor and at the walls' tops, and each goal's 4 floor corners and its top.
    expect(framedPoints(pitch)).toHaveLength(8 * 2 + 2 * 4 * 2);
  });
});
