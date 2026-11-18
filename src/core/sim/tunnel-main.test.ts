import { describe, expect, it, vi } from 'vitest';
import { config, type PitchShape } from '../../config';
import { encodeInput, FRAME_BALL, FRAME_PITCH } from './input';
import { mix } from './math';
import { defaultParams } from './params';
import { buildPitch, deepestOverlap, insideRegion, PLANE, QUAD } from './pitch';
import { park, place, placeBall } from './scenes';
import { run, scenario } from './testing';

// PLAN D-3, D-8, §16 on the main pitch: no tunnelling at 25 m/s, and the
// ball never leaves the pitch or sits wholly behind a goal line outside the
// goal (fuzzed). The M0 spike's tunnel.test.ts; tunnel-second.test.ts runs
// D-4's second shape, so the worker pool runs the two at once. The depth
// bounds are about a substep's travel at 25 m/s: 0.104 m at 4 substeps.
vi.setConfig({ testTimeout: 120_000 });

const SHAPE: PitchShape = config.pitch;
const SUBSTEP_SCALE = 4 / defaultParams.substeps;
const BOUND = config.speedBoundMetresPerSecond;

const rnd = (seed: number): (() => number) => {
  let i = 0;
  return () => mix(seed, i++) / 4294967296;
};

describe('no tunnelling at 25 m/s, main pitch', () => {
  it('the ball shot at every piece from many angles stays inside', () => {
    const pitch = buildPitch(SHAPE);
    const r = rnd(SHAPE.lengthMetres);
    let worst = 0;
    let shots = 0;
    let escaped = '';
    for (const piece of pitch.pieces) {
      if (piece.kind === PLANE) continue; // shot at below
      // Aim at the middle of the piece from 3 m out on its pitch side.
      const cx = piece.kind === QUAD ? piece.ox + (piece.e1x + piece.e2x) / 2 : piece.ox + piece.e1x / 2;
      const cy = piece.kind === QUAD ? piece.oy + (piece.e1y + piece.e2y) / 2 : piece.oy + piece.e1y / 2;
      const cz = Math.min(4.5, Math.max(0.8, piece.kind === QUAD ? piece.oz + (piece.e1z + piece.e2z) / 2 : piece.oz + piece.e1z / 2));
      for (let k = 0; k < 24; k++) {
        // Start inside the pitch, near the piece's middle, toward it.
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

  it('the ball dropped and thrown at 25 m/s into the floor and the overhead net stays inside', () => {
    for (const vz of [-BOUND, BOUND]) {
      const sc = scenario(1, { rollingSlowdownMetresPerSecond2: 0 }, (s, P) => {
        park(P, s, 0);
        park(P, s, 1);
        placeBall(P, s, 2, 1, 3, 0, 0, vz);
        s.ball.onFloor = false;
      });
      let low = Infinity;
      let high = -Infinity;
      sc.sim.probe = (s) => {
        low = Math.min(low, s.ball.z);
        high = Math.max(high, s.ball.z);
      };
      run(sc, 60);
      expect(low).toBeGreaterThanOrEqual(0.8 - 0.105 * SUBSTEP_SCALE);
      expect(high).toBeLessThanOrEqual(6 - 0.8 + 0.105 * SUBSTEP_SCALE);
    }
  });

  it('terriers at 25 m/s never pass through each other, the ball, posts or walls', () => {
    const sc = scenario(2, { accelerationMetresPerSecond2: 0, idleFrictionMetresPerSecond2: 0 }, (s, P) => {
      placeBall(P, s, 0, 0);
      place(P, s, 0, -3, 0); s.terriers[0]!.vx = BOUND; // into the ball
      place(P, s, 1, 3, 0.1); s.terriers[1]!.vx = -BOUND; // into the ball from the far side
      place(P, s, 2, -16, 4.1); s.terriers[2]!.vx = -BOUND; // at a post, on its axis
      place(P, s, 3, 5, 10); s.terriers[3]!.vy = BOUND; // into the side wall
    });
    const crossed = new Set<string>();
    let outside = '';
    let nearest = Infinity;
    let prevSide = sc.s.terriers.map((t) => Math.sign(t.x - sc.s.ball.x));
    sc.sim.probe = (s) => {
      for (const t of s.terriers) {
        if (!outside && !insideRegion(SHAPE, t.x, t.y, t.z, 1e-9)) outside = `terrier ${t.spot}, ${t.pack} at ${t.x}, ${t.y}, ${t.z}`;
        nearest = Math.min(nearest, Math.hypot(t.x - s.ball.x, t.y - s.ball.y, t.z - s.ball.z));
      }
      // A crossing counts only inside the ball's footprint, deeper than the
      // overlap tolerated above. Height counts too: a terrier on the floor
      // crosses a resting ball's centre 0.55 m below it, but one running
      // under a ball popped into the air passes nothing (M0).
      const side = s.terriers.map((t) => Math.sign(t.x - s.ball.x));
      side.forEach((v, k) => {
        const t = s.terriers[k]!;
        if (k < 2 && v !== prevSide[k] && Math.hypot(t.y - s.ball.y, t.z - s.ball.z) < 1.05 - 0.21 * SUBSTEP_SCALE) crossed.add(`terrier ${k}`);
      });
      prevSide = side;
    };
    run(sc, 60);
    expect(outside).toBe('');
    expect(nearest).toBeGreaterThan(1.05 - 0.21 * SUBSTEP_SCALE);
    expect([...crossed]).toEqual([]);
  });

  it('terriers closing on each other at 50 m/s head on, or at 25 m/s on one standing, never pass through (D-3)', () => {
    // D-3's bound for a pair is their closing speed: 50 m/s is 0.21 m a
    // substep, under the 0.5 m their radii sum to (M2's review).
    const sc = scenario(2, { accelerationMetresPerSecond2: 0, idleFrictionMetresPerSecond2: 0 }, (s, P) => {
      placeBall(P, s, -10, 10);
      place(P, s, 0, -5, -5); s.terriers[0]!.vx = BOUND; // head on …
      place(P, s, 1, 5, -5); s.terriers[1]!.vx = -BOUND; // … with this one
      place(P, s, 2, -5, 5); s.terriers[2]!.vx = BOUND; // into …
      place(P, s, 3, 0, 5); // … this one, standing
    });
    const pairs: [number, number][] = [[0, 1], [2, 3]];
    let nearest = Infinity;
    let met = 0;
    const crossed: string[] = [];
    const sideOf = ([a, b]: [number, number]): number => Math.sign(sc.s.terriers[a]!.x - sc.s.terriers[b]!.x);
    let prev = pairs.map(sideOf);
    sc.sim.probe = (s) => {
      pairs.forEach(([a, b], k) => {
        const A = s.terriers[a]!, B = s.terriers[b]!;
        const d = Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z);
        nearest = Math.min(nearest, d);
        if (d < 0.5 + 1e-9) met |= 1 << k;
        const side = sideOf([a, b]);
        if (side !== prev[k]) crossed.push(`terriers ${a} and ${b} at tick ${s.tick + 1}`);
      });
      prev = pairs.map(sideOf);
    };
    run(sc, 60);
    expect(met, 'both pairs met').toBe(3);
    expect(crossed).toEqual([]);
    expect(nearest).toBeGreaterThan(0.5 - 0.21 * SUBSTEP_SCALE);
  });
});

describe('the ball never leaves the main pitch (fuzzed, D-8)', () => {
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
    // M0's 1,101 at A.5's starting netting bounce of 0.3
    // (research/spike/REPORT.md §5.2), and 15,051 at M2's settled 0, at
    // which the netting bounces nothing back.
    expect(behind).toBe(15051);
    expect(worst).toBeLessThan(0.11 * SUBSTEP_SCALE);
  });
});
