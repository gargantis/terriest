import { describe, expect, it, vi } from 'vitest';
import { config, type PitchShape } from '../../config';
import { encodeInput, FRAME_BALL, FRAME_PITCH } from './input';
import { mix } from './math';
import { defaultParams } from './params';
import { buildPitch, deepestOverlap, insideRegion, PLANE, QUAD } from './pitch';
import { park, place, placeBall } from './scenes';
import { run, scenario, SECOND_SHAPE } from './testing';

// PLAN D-3, D-4, D-8, §16 on D-4's second shape, 50 × 30 m, point-symmetric
// but not mirror-symmetric: no tunnelling at 25 m/s, and the ball never
// leaves the pitch or sits wholly behind a goal line outside the goal
// (fuzzed). The M0 spike's tunnel.test.ts; tunnel-main.test.ts runs the
// main pitch, so the worker pool runs the two at once.
vi.setConfig({ testTimeout: 120_000 });

const SHAPE: PitchShape = SECOND_SHAPE;
const SUBSTEP_SCALE = 4 / defaultParams.substeps;
const BOUND = config.speedBoundMetresPerSecond;

const rnd = (seed: number): (() => number) => {
  let i = 0;
  return () => mix(seed, i++) / 4294967296;
};

describe('no tunnelling at 25 m/s, second shape', () => {
  it('the ball shot at every piece from many angles stays inside', () => {
    const pitch = buildPitch(SHAPE);
    const r = rnd(SHAPE.lengthMetres);
    let worst = 0;
    let shots = 0;
    let escaped = '';
    for (const piece of pitch.pieces) {
      if (piece.kind === PLANE) continue;
      // Aim at the middle of the piece from 3 m out on its pitch side.
      const cx = piece.kind === QUAD ? piece.ox + (piece.e1x + piece.e2x) / 2 : piece.ox + piece.e1x / 2;
      const cy = piece.kind === QUAD ? piece.oy + (piece.e1y + piece.e2y) / 2 : piece.oy + piece.e1y / 2;
      const cz = Math.min(4.5, Math.max(0.8, piece.kind === QUAD ? piece.oz + (piece.e1z + piece.e2z) / 2 : piece.oz + piece.e1z / 2));
      for (let k = 0; k < 24; k++) {
        const sx = cx * 0.8 + (r() - 0.5) * 2;
        const sy = cy * 0.8 + (r() - 0.5) * 2;
        if (!insideRegion(SHAPE, sx, sy, cz, -1)) continue;
        const dx = cx - sx, dy = cy - sy, dz = (r() - 0.5) * 2;
        const len = Math.hypot(dx, dy, dz);
        if (len === 0) continue;
        const sc = scenario(1, { pitch: SHAPE, gravityMetresPerSecond2: 0, rollingSlowdownMetresPerSecond2: 0 }, (s, P) => {
          park(P, s, 0);
          park(P, s, 1);
          placeBall(P, s, sx, sy, cz, (BOUND * dx) / len, (BOUND * dy) / len, (BOUND * dz) / len);
          s.ball.onFloor = false;
        });
        sc.sim.probe = (s) => {
          const b = s.ball;
          if (!escaped && !insideRegion(SHAPE, b.x, b.y, b.z, 1e-9)) escaped = `ball at ${b.x}, ${b.y}, ${b.z} (${piece.name})`;
          worst = Math.max(worst, deepestOverlap(pitch, b.x, b.y, b.z, 0.8).depth);
        };
        run(sc, 40);
        shots++;
      }
    }
    expect(escaped).toBe('');
    expect(shots).toBeGreaterThan(300);
    expect(worst).toBeLessThan(0.11 * SUBSTEP_SCALE);
  });
});

describe('the ball never leaves the second shape (fuzzed, D-8)', () => {
  it('60 seeded scrambles of 600 ticks at 4 a side, the ball shot at up to 25 m/s', () => {
    const pitch = buildPitch(SHAPE);
    let worst = 0;
    let behind = 0;
    let escaped = '';
    for (let n = 0; n < 60; n++) {
      const r = rnd(SHAPE.widthMetres * 1000 + n);
      const sc = scenario(4, { pitch: SHAPE }, (s, P) => {
        const hx = SHAPE.lengthMetres / 2 - 3, hy = SHAPE.widthMetres / 2 - 3;
        placeBall(P, s, (r() * 2 - 1) * hx, (r() * 2 - 1) * hy, 0.8 + r() * 3, (r() * 2 - 1) * BOUND, (r() * 2 - 1) * BOUND, (r() * 2 - 1) * 15);
        s.ball.onFloor = false;
        for (let k = 0; k < 8; k++) {
          let x = 0, y = 0, tries = 0;
          do {
            x = (r() * 2 - 1) * hx;
            y = (r() * 2 - 1) * hy;
            tries++;
          } while (tries < 50 && (Math.hypot(x - s.ball.x, y - s.ball.y) < 1.2 || s.terriers.slice(0, k).some((o) => Math.hypot(o.x - x, o.y - y) < 0.6)));
          place(P, s, k, x, y);
          s.terriers[k]!.vx = (r() * 2 - 1) * 9;
          s.terriers[k]!.vy = (r() * 2 - 1) * 9;
        }
      });
      sc.sim.probe = (s) => {
        const b = s.ball;
        if (!escaped && !insideRegion(SHAPE, b.x, b.y, b.z, 1e-9)) escaped = `run ${n}: ball at ${b.x}, ${b.y}, ${b.z}`;
        if (Math.abs(b.x) > SHAPE.lengthMetres / 2 + 0.8) {
          behind++;
          if (!escaped && Math.abs(b.y) > SHAPE.mouthWidthMetres / 2) escaped = `run ${n}: wholly behind the line outside the goal, at y = ${b.y}`;
        }
        worst = Math.max(worst, deepestOverlap(pitch, b.x, b.y, b.z, 0.8).depth);
      };
      const seedK = mix(SHAPE.widthMetres, n);
      run(sc, 600, (k, t) => {
        const h = mix(seedK + k, t >> 4);
        return encodeInput({ step: h & 31, frame: (h >> 5) & 1 ? FRAME_BALL : FRAME_PITCH, zoomies: (h & 0x300) === 0, jump: t >> 5, pounce: (t + k * 7) >> 6 });
      });
    }
    expect(escaped).toBe('');
    // Substeps with the ball wholly behind a goal line, all inside a goal:
    // M0's 1,449 (research/spike/REPORT.md §5.2).
    expect(behind).toBe(1449);
    expect(worst).toBeLessThan(0.11 * SUBSTEP_SCALE);
  });
});
