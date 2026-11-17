import { describe, expect, it, vi } from 'vitest';
import type { Config } from '../../config';
import { dir, fractionOfTurn, HALF_TURN } from './math';
import { defaultParams } from './params';
import { park, place, placeBall } from './scenes';
import { kineticEnergy, momentum, run, scenario } from './testing';

// PLAN §16 "Simultaneous hits", M0 run 2 (D-5, L56): k = 1 to 4 terriers hit
// a resting ball at once, from the floor and level, with the drive, idle
// friction and the ball's rolling slowdown off: settings of 0, which give
// the spike's switches' bits (design §4.1). M0's speeds are pinned to the
// digits research/spike/REPORT.md §5.2 prints.
vi.setConfig({ testTimeout: 120_000 });

const SPEED = 6;
const NO_FORCES: Partial<Config> = { accelerationMetresPerSecond2: 0, idleFrictionMetresPerSecond2: 0, rollingSlowdownMetresPerSecond2: 0 };
// Every hitter starts 20.5 substeps of travel short of contact, so all
// first overlap in substep 21, by half a substep's travel.
const LEAD = SPEED * defaultParams.dt * 20.5;

interface HitResult { ballSpeed: number; dp: number; worstKeGain: number; ke0: number; ke1: number }

function hit(k: number, level: boolean, layout: 'parallel' | 'centre'): HitResult {
  const dz = level ? 0 : 0.8 - 0.25;
  const z = level ? 0.8 : 0.25;
  const d = new Float64Array(2);
  const sc = scenario(4, { ...NO_FORCES, gravityMetresPerSecond2: level ? 0 : 9.8 }, (s, P) => {
    for (let j = 0; j < 8; j++) park(P, s, j);
    placeBall(P, s, 0, 0);
    for (let j = 0; j < k; j++) {
      const t = 2 * j; // pack A's terriers
      if (layout === 'parallel') {
        const y = [[0], [-0.26, 0.26], [-0.52, 0, 0.52], [-0.78, -0.26, 0.26, 0.78]][k - 1]![j]!;
        const reach = Math.sqrt(1.05 * 1.05 - dz * dz - y * y);
        place(P, s, t, -reach - LEAD, y, z);
        s.terriers[t]!.vx = SPEED;
      } else {
        const deg = [[0], [-25, 25], [-35, 0, 35], [-55, -20, 20, 55]][k - 1]![j]!;
        dir((HALF_TURN + fractionOfTurn(deg < 0 ? 360 + deg : deg, 360)) >>> 0, d);
        const reach = Math.sqrt(1.05 * 1.05 - dz * dz);
        place(P, s, t, (reach + LEAD) * d[0]!, (reach + LEAD) * d[1]!, z);
        s.terriers[t]!.vx = -SPEED * d[0]!;
        s.terriers[t]!.vy = -SPEED * d[1]!;
      }
    }
  });
  const P = sc.sim.P;
  const p0 = momentum(sc.s, P);
  const ke0 = kineticEnergy(sc.s, P);
  let worstKeGain = -Infinity;
  sc.sim.probe = (s) => { worstKeGain = Math.max(worstKeGain, kineticEnergy(s, P) - ke0); };
  run(sc, 30);
  const p1 = momentum(sc.s, P);
  const b = sc.s.ball;
  return {
    ballSpeed: Math.hypot(b.vx, b.vy), dp: Math.hypot(p1[0] - p0[0], p1[1] - p0[1]),
    worstKeGain, ke0, ke1: kineticEnergy(sc.s, P),
  };
}

/** M0's speeds for k = 1–4 (research/spike/REPORT.md §5.2). */
const M0_SPEEDS = {
  'from the floor, parallel': ['2.656', '3.571', '3.810', '3.685'],
  'level, parallel': ['3.000', '4.354', '4.999', '5.213'],
  'from the floor, aimed at the centre': ['2.656', '3.690', '4.300', '4.477'],
  'level, aimed at the centre': ['3.000', '4.478', '5.469', '6.157'],
} as const;

describe('simultaneous hits (D-5, §16)', () => {
  for (const level of [false, true]) {
    const where = level ? 'level' : 'from the floor';
    it(`k = 1–4 parallel hitters ${where}: momentum within 1e-9, no energy gained, every k > 1 faster than one, M0's speeds`, () => {
      const speeds: number[] = [];
      for (let k = 1; k <= 4; k++) {
        const r = hit(k, level, 'parallel');
        expect(r.dp, `k = ${k}: horizontal momentum change`).toBeLessThan(1e-9);
        expect(r.worstKeGain, `k = ${k}: kinetic energy gained`).toBeLessThanOrEqual(1e-9);
        speeds.push(r.ballSpeed);
      }
      expect(speeds.map((v) => v.toFixed(3))).toEqual(M0_SPEEDS[`${where}, parallel`]);
      for (let k = 2; k <= 4; k++) expect(speeds[k - 1]!, `k = ${k} beats one hitter`).toBeGreaterThan(speeds[0]!);
      for (let k = 2; k <= (level ? 4 : 3); k++) expect(speeds[k - 1]!, `k = ${k} beats k = ${k - 1}`).toBeGreaterThan(speeds[k - 2]!);
      // M0's finding: from the floor, four abreast (y = ±0.26, ±0.78) send the
      // ball slower than three (0, ±0.52), under D-5's frictionless contacts.
      if (!level) expect(speeds[3]!, 'from the floor, k = 4 parallel is slower than k = 3').toBeLessThan(speeds[2]!);
    });

    it(`k = 1–4 hitters aimed at the centre ${where}: momentum and energy, and M0's speeds`, () => {
      const speeds: number[] = [];
      for (let k = 1; k <= 4; k++) {
        const r = hit(k, level, 'centre');
        expect(r.dp).toBeLessThan(1e-9);
        expect(r.worstKeGain).toBeLessThanOrEqual(1e-9);
        speeds.push(r.ballSpeed);
      }
      expect(speeds.map((v) => v.toFixed(3))).toEqual(M0_SPEEDS[`${where}, aimed at the centre`]);
    });
  }
});
