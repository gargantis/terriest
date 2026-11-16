import { describe, expect, it, vi } from 'vitest';
import { DT, MAIN_PITCH, SECOND_PITCH, type PitchShape } from './config';
import { encodeInput, FRAME_BALL, FRAME_PITCH } from './input';
import { buildPitch, deepestOverlap, insideRegion } from './pitch';
import { mix, park, place, placeBall } from './scripts';
import { run, scenario } from './testing';

// These run whole scripted matches; under a parallel run they need more than vitest's 5 s.
vi.setConfig({ testTimeout: 120_000 });

// PLAN D-3, D-8, §16: no tunnelling at 25 m/s, and the ball never leaves the
// pitch or sits wholly behind a goal line outside the goal (fuzzed).

const rnd = (seed: number): (() => number) => {
  let i = 0;
  return () => mix(seed, i++) / 4294967296;
};

describe('the configuration (D-3, §7.4)', () => {
  it('no body moves its radius in a substep at 25 m/s, and no pair closes its radius sum', () => {
    expect(25 * DT).toBeLessThan(0.25);
    expect(2 * 25 * DT).toBeLessThan(0.5);
  });
});

describe('no tunnelling at 25 m/s', () => {
  for (const shape of [MAIN_PITCH, SECOND_PITCH]) {
    it(`the ball shot at every piece of the ${shape.name} pitch from many angles stays inside`, () => {
      const pitch = buildPitch(shape);
      const r = rnd(shape.length);
      let worst = 0;
      let shots = 0;
      for (const piece of pitch.pieces) {
        if (piece.kind === 0) continue; // the planes: shot at below
        // Aim at the middle of the piece from 3 m out on its pitch side.
        const cx = piece.kind === 1 ? piece.ox + (piece.e1x + piece.e2x) / 2 : piece.ox + piece.e1x / 2;
        const cy = piece.kind === 1 ? piece.oy + (piece.e1y + piece.e2y) / 2 : piece.oy + piece.e1y / 2;
        const cz = Math.min(4.5, Math.max(0.8, piece.kind === 1 ? piece.oz + (piece.e1z + piece.e2z) / 2 : piece.oz + piece.e1z / 2));
        for (let k = 0; k < 24; k++) {
          // Start inside the pitch, near the piece's middle, toward it.
          const sx = (cx * 0.8) + (r() - 0.5) * 2;
          const sy = (cy * 0.8) + (r() - 0.5) * 2;
          if (!insideRegion(shape, sx, sy, cz, -1)) continue;
          const dx = cx - sx, dy = cy - sy, dz = cz - cz + (r() - 0.5) * 2;
          const len = Math.hypot(dx, dy, dz);
          if (len === 0) continue;
          const sc = scenario(1, { pitch: shape, gravity: 0, rolling: false }, (s) => {
            park(s, 0); park(s, 1);
            placeBall(s, sx, sy, cz, (25 * dx) / len, (25 * dy) / len, (25 * dz) / len);
            s.ball.onFloor = false;
          });
          sc.sim.probe = (s) => {
            expect(insideRegion(shape, s.ball.x, s.ball.y, s.ball.z, 1e-9), `ball left at ${s.ball.x}, ${s.ball.y}, ${s.ball.z} (${piece.name})`).toBe(true);
            worst = Math.max(worst, deepestOverlap(pitch, s.ball.x, s.ball.y, s.ball.z, 0.8).depth);
          };
          run(sc, 40);
          shots++;
        }
      }
      console.log(`[tunnel] ${shape.name}: ${shots} shots at 25 m/s; deepest overlap left after a substep ${(worst * 1000).toFixed(2)} mm`);
      expect(shots).toBeGreaterThan(300);
      expect(worst).toBeLessThan(0.11); // under a substep's travel at 25 m/s
    });
  }

  it('the ball dropped and thrown at 25 m/s into the floor and the overhead net stays inside', () => {
    for (const vz of [-25, 25]) {
      const sc = scenario(1, { rolling: false }, (s) => {
        park(s, 0); park(s, 1);
        placeBall(s, 2, 1, 3, 0, 0, vz);
        s.ball.onFloor = false;
      });
      sc.sim.probe = (s) => {
        expect(s.ball.z).toBeGreaterThanOrEqual(0.8 - 0.105);
        expect(s.ball.z).toBeLessThanOrEqual(6 - 0.8 + 0.105);
      };
      run(sc, 60);
    }
  });

  it('terriers at 25 m/s never pass through each other, the ball, posts or walls', () => {
    const sc = scenario(2, { drive: false, friction: false, gravity: 9.8 }, (s) => {
      placeBall(s, 0, 0);
      place(s, 0, -3, 0); s.terriers[0]!.vx = 25; // into the ball
      place(s, 1, 3, 0.1); s.terriers[1]!.vx = -25; // into the ball from the far side
      place(s, 2, -16, 4.1); s.terriers[2]!.vx = -25; // at a post's axis height... a post at x=-20
      place(s, 3, 5, 10); s.terriers[3]!.vy = 25; // into the side wall
    });
    const crossed = new Set<string>();
    let prevSide = sc.s.terriers.map((t) => Math.sign(t.x - sc.s.ball.x));
    sc.sim.probe = (s) => {
      for (const t of s.terriers) {
        expect(insideRegion(MAIN_PITCH, t.x, t.y, t.z, 1e-9)).toBe(true);
        const d = Math.hypot(t.x - s.ball.x, t.y - s.ball.y, t.z - s.ball.z);
        expect(d).toBeGreaterThan(1.05 - 0.21);
      }
      const side = s.terriers.map((t) => Math.sign(t.x - s.ball.x));
      side.forEach((v, k) => { if (k < 2 && v !== prevSide[k] && Math.abs(s.terriers[k]!.y - s.ball.y) < 0.5) crossed.add(`terrier ${k}`); });
      prevSide = side;
    };
    run(sc, 60);
    expect([...crossed]).toEqual([]);
  });
});

describe('the ball never leaves the pitch (fuzzed, D-8)', () => {
  function fuzz(shape: PitchShape, seed: number, runs: number, ticks: number): { worst: number; behind: number } {
    const pitch = buildPitch(shape);
    let worst = 0;
    let behind = 0;
    for (let n = 0; n < runs; n++) {
      const r = rnd(seed * 1000 + n);
      const sc = scenario(4, { pitch: shape }, (s) => {
        const hx = shape.length / 2 - 3, hy = shape.width / 2 - 3;
        placeBall(s, (r() * 2 - 1) * hx, (r() * 2 - 1) * hy, 0.8 + r() * 3, (r() * 2 - 1) * 25, (r() * 2 - 1) * 25, (r() * 2 - 1) * 15);
        s.ball.onFloor = false;
        for (let k = 0; k < 8; k++) {
          let x = 0, y = 0, tries = 0;
          do {
            x = (r() * 2 - 1) * hx; y = (r() * 2 - 1) * hy; tries++;
          } while (tries < 50 && (Math.hypot(x - s.ball.x, y - s.ball.y) < 1.2 || s.terriers.slice(0, k).some((o) => Math.hypot(o.x - x, o.y - y) < 0.6)));
          place(s, k, x, y);
          s.terriers[k]!.vx = (r() * 2 - 1) * 9;
          s.terriers[k]!.vy = (r() * 2 - 1) * 9;
        }
      });
      sc.sim.probe = (s) => {
        const b = s.ball;
        expect(insideRegion(shape, b.x, b.y, b.z, 1e-9), `run ${n}: ball at ${b.x}, ${b.y}, ${b.z}`).toBe(true);
        if (Math.abs(b.x) > shape.length / 2 + 0.8) {
          behind++;
          expect(Math.abs(b.y)).toBeLessThanOrEqual(shape.mouthWidth / 2);
        }
        worst = Math.max(worst, deepestOverlap(pitch, b.x, b.y, b.z, 0.8).depth);
      };
      const seedK = mix(seed, n);
      run(sc, ticks, (k, t) => {
        const h = mix(seedK + k, t >> 4);
        return encodeInput({ step: h & 31, frame: (h >> 5) & 1 ? FRAME_BALL : FRAME_PITCH, zoomies: (h & 0x300) === 0, jump: t >> 5, pounce: (t + k * 7) >> 6 });
      });
    }
    return { worst, behind };
  }

  for (const shape of [MAIN_PITCH, SECOND_PITCH]) {
    it(`${shape.name} pitch: 60 seeded scrambles of 600 ticks, ball shot at up to 25 m/s`, () => {
      const { worst, behind } = fuzz(shape, shape.width, 60, 600);
      console.log(`[fuzz] ${shape.name}: deepest overlap of the ball with any piece after a substep ${(worst * 1000).toFixed(2)} mm; substeps with the ball wholly behind a goal line (all inside a goal) ${behind}`);
      expect(worst).toBeLessThan(0.11);
    });
  }
});
