import { describe, expect, it, vi } from 'vitest';
import { dir, fractionOfTurn, HALF_TURN } from './angle';
import { DT } from './config';
import { park, place, placeBall } from './scripts';
import { kineticEnergy, momentum, run, scenario } from './testing';

// These run whole scripted matches; under a parallel run they need more than vitest's 5 s.
vi.setConfig({ testTimeout: 120_000 });

// PLAN §16 "Simultaneous hits", M0 run 2: k = 1 to 4 terriers hit a
// resting ball at once, from the floor and level, with the drive, idle
// friction and the ball's rolling slowdown off.

const SPEED = 6;
const NO_FORCES = { drive: false, friction: false, rolling: false };
// Every hitter starts 20.5 substeps of travel short of contact, so all
// first overlap in substep 21, by half a substep's travel.
const LEAD = SPEED * DT * 20.5;

interface HitResult { ballSpeed: number; dp: number; worstKeGain: number; ke0: number; ke1: number }

function hit(k: number, level: boolean, layout: 'parallel' | 'centre'): HitResult {
  const dz = level ? 0 : 0.8 - 0.25;
  const z = level ? 0.8 : 0.25;
  const d = new Float64Array(2);
  const sc = scenario(4, { ...NO_FORCES, gravity: level ? 0 : 9.8 }, (s) => {
    for (let j = 0; j < 8; j++) park(s, j);
    placeBall(s, 0, 0);
    for (let j = 0; j < k; j++) {
      const t = 2 * j; // pack A's terriers
      if (layout === 'parallel') {
        const y = [[0], [-0.26, 0.26], [-0.52, 0, 0.52], [-0.78, -0.26, 0.26, 0.78]][k - 1]![j]!;
        const reach = Math.sqrt(1.05 * 1.05 - dz * dz - y * y);
        place(s, t, -reach - LEAD, y, z);
        s.terriers[t]!.vx = SPEED;
      } else {
        const deg = [[0], [-25, 25], [-35, 0, 35], [-55, -20, 20, 55]][k - 1]![j]!;
        dir((HALF_TURN + fractionOfTurn(deg < 0 ? 360 + deg : deg, 360)) >>> 0, d);
        const reach = Math.sqrt(1.05 * 1.05 - dz * dz);
        place(s, t, (reach + LEAD) * d[0]!, (reach + LEAD) * d[1]!, z);
        s.terriers[t]!.vx = -SPEED * d[0]!;
        s.terriers[t]!.vy = -SPEED * d[1]!;
      }
    }
  });
  const C = sc.sim.C;
  const p0 = momentum(sc.s, C);
  const ke0 = kineticEnergy(sc.s, C);
  let worstKeGain = -Infinity;
  sc.sim.probe = (s) => { worstKeGain = Math.max(worstKeGain, kineticEnergy(s, C) - ke0); };
  run(sc, 30);
  const p1 = momentum(sc.s, C);
  const b = sc.s.ball;
  return {
    ballSpeed: Math.hypot(b.vx, b.vy), dp: Math.hypot(p1[0] - p0[0], p1[1] - p0[1]),
    worstKeGain, ke0, ke1: kineticEnergy(sc.s, C),
  };
}

describe('simultaneous hits (D-5, §16)', () => {
  for (const level of [false, true]) {
    const where = level ? 'level' : 'from the floor';
    it(`k = 1–4 parallel hitters ${where}: momentum within 1e-9, no energy gained, the ball faster as k grows`, () => {
      const speeds: number[] = [];
      for (let k = 1; k <= 4; k++) {
        const r = hit(k, level, 'parallel');
        expect(r.dp, `k = ${k}: horizontal momentum change`).toBeLessThan(1e-9);
        expect(r.worstKeGain, `k = ${k}: kinetic energy gained`).toBeLessThanOrEqual(1e-9);
        speeds.push(r.ballSpeed);
      }
      console.log(`[hits ${where}, parallel] ball leaves at ${speeds.map((v) => v.toFixed(3)).join(', ')} m/s for k = 1–4`);
      for (let k = 2; k <= 4; k++) expect(speeds[k - 1]!, `k = ${k} beats one hitter`).toBeGreaterThan(speeds[0]!);
      for (let k = 2; k <= (level ? 4 : 3); k++) {
        expect(speeds[k - 1]!, `k = ${k} beats k = ${k - 1}`).toBeGreaterThan(speeds[k - 2]!);
      }
      if (!level) {
        // M0 finding: from the floor, four abreast (y = ±0.26, ±0.78) send the
        // ball slower than three (0, ±0.52), so §16's "faster as k grows for
        // parallel approaches" fails at k = 4. It is the model, not the
        // iterations: 8 and 512 give the same speeds, a hand solution of the
        // contact problem agrees, and the floor's reading (floorInSolve) keeps
        // the order. Pinned so a change to D-5 shows up here.
        expect(speeds[3]!).toBeLessThan(speeds[2]!);
      }
    });

    it(`k = 1–4 hitters aimed at the centre ${where}: measured and reported`, () => {
      const rows: string[] = [];
      for (let k = 1; k <= 4; k++) {
        const r = hit(k, level, 'centre');
        expect(r.dp).toBeLessThan(1e-9);
        expect(r.worstKeGain).toBeLessThanOrEqual(1e-9);
        rows.push(`k=${k} ${r.ballSpeed.toFixed(3)} m/s (KE ${r.ke0.toFixed(1)} → ${r.ke1.toFixed(2)} J)`);
      }
      console.log(`[hits ${where}, aimed at the centre] ${rows.join('; ')}`);
    });
  }
});
